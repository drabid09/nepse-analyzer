#!/usr/bin/env python3
"""End-of-day job: turns the day's live rows into final ones.

Runs after the 15:00 close (scheduled 15:20 Nepal time, with two backups).
For the business date NEPSE reports as its last session it writes:

  * daily_prices      final open, high, low, close, volume, turnover and trades,
  * floorsheet_daily  one summary row per company from the day's floorsheet
                      (the raw trades are never stored),
  * index_daily       final values for all 17 indices, with open, high and low
                      taken from NEPSE's intraday graph of each index,
  * index_intraday    that graph, replacing the 5-minute points of the live job,
  * market_daily      the day's totals, advancers and decliners,
  * price_adjustments bonus and right-share events, where NEPSE's previous close
                      differs from the last price we stored,

then deletes intraday rows past their retention period, records how much of
the 500 MB free database is used, and logs the run in job_runs.

On a weekday when NEPSE did not trade it records a 'holiday' run instead, which
is how the trading calendar learns about holidays.

Safe to re-run: every write is an upsert keyed on company or index and date.
"""

from __future__ import annotations

import os
import sys
import time as clock
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    NPT, JobError, JobRun, NepseSource, Supabase, company_maps, lookup_company,
    now_npt, num, run, started_by_hand, whole, write_summary,
)
from live_market import parse_npt, summary_fields  # noqa: E402
import sharesansar  # noqa: E402

EARLIEST = time(15, 12)       # leave the live job time to take its last snapshot
NO_RUN_FROM = time(10, 15)    # from pre-open until EARLIEST, NEPSE's "latest day" is changing
FLOORSHEET_PAGE = 500
PAUSE = 0.6                   # seconds between floorsheet and graph requests
SNAPSHOT_DAYS = 21            # intraday_snapshots retention
INDEX_POINT_DAYS = 30         # index_intraday retention
STORAGE_WARN_MB = 400         # of the free plan's 500 MB
ADJUST_THRESHOLD = 0.01       # previous close differing by more than 1% is a candidate event

INDEX_GRAPHS = {
    58: "getDailyNepseIndexGraph", 57: "getDailySensitiveIndexGraph",
    62: "getDailyFloatIndexGraph", 63: "getDailySensitiveFloatIndexGraph",
    51: "getDailyBankSubindexGraph", 55: "getDailyDevelopmentBankSubindexGraph",
    60: "getDailyFinanceSubindexGraph", 52: "getDailyHotelTourismSubindexGraph",
    54: "getDailyHydroSubindexGraph", 67: "getDailyInvestmentSubindexGraph",
    65: "getDailyLifeInsuranceSubindexGraph", 56: "getDailyManufacturingSubindexGraph",
    64: "getDailyMicrofinanceSubindexGraph", 66: "getDailyMutualfundSubindexGraph",
    59: "getDailyNonLifeInsuranceSubindexGraph", 53: "getDailyOthersSubindexGraph",
    61: "getDailyTradingSubindexGraph",
}


def npt_day_bounds(day: date) -> tuple[str, str]:
    start = datetime.combine(day, time(0), NPT)
    return start.astimezone(timezone.utc).isoformat(), (start + timedelta(days=1)).astimezone(timezone.utc).isoformat()


# ---------------------------------------------------------------- floorsheet


def fetch_floorsheet(nepse: NepseSource, trade_date: date) -> tuple[list[dict], dict]:
    """All of the day's trades, page by page. Raises JobError if any page fails twice."""
    api = nepse.api
    url = f"{api.api_end_points['floor_sheet']}?&size={FLOORSHEET_PAGE}&sort=contractId,desc"

    def page(number: int) -> dict:
        target = url if number == 0 else f"{url}&page={number}"
        for attempt in range(2):
            try:
                result = nepse.call("requestPOSTAPI", url=target, payload_generator=api.getPOSTPayloadIDForFloorSheet)
                if isinstance(result, dict) and isinstance(result.get("floorsheets"), dict):
                    return result
                raise JobError(f"floorsheet page {number} had an unexpected shape")
            except JobError:
                if attempt:
                    raise
                clock.sleep(3)
        raise AssertionError("unreachable")

    first = page(0)
    pages = whole(first["floorsheets"].get("totalPages")) or 1
    trades = list(first["floorsheets"].get("content") or [])
    for number in range(1, pages):
        clock.sleep(PAUSE)
        trades.extend(page(number)["floorsheets"].get("content") or [])
    info = {
        "pages": pages,
        "reported_trades": whole(first.get("totalTrades")),
        "reported_qty": whole(first.get("totalQty")),
        "reported_amount": num(first.get("totalAmount")),
        "fetched_trades": len(trades),
    }
    other_days = {str(t.get("businessDate")) for t in trades} - {trade_date.isoformat()}
    if other_days:
        raise JobError(f"floorsheet contains trades from other days ({', '.join(sorted(other_days))}); not used")
    return trades, info


def summarise_floorsheet(trades: list[dict], by_security, by_symbol, trade_date: date) -> tuple[list[dict], set[str]]:
    groups: dict[int, list[dict]] = defaultdict(list)
    unmapped = set()
    seen = set()
    for t in trades:
        contract = t.get("contractId")
        if contract in seen:      # pages can overlap if NEPSE adds rows mid-fetch
            continue
        seen.add(contract)
        company_id = lookup_company(t, by_security, by_symbol)
        if company_id is None:
            unmapped.add(str(t.get("stockSymbol")))
            continue
        groups[company_id].append(t)

    rows = []
    for company_id, items in groups.items():
        qty = sum(whole(t.get("contractQuantity")) or 0 for t in items)
        amount = sum(num(t.get("contractAmount"), None) or 0 for t in items)
        buyers: dict[int, list] = defaultdict(lambda: [0, 0.0])
        sellers: dict[int, list] = defaultdict(lambda: [0, 0.0])
        for t in items:
            q = whole(t.get("contractQuantity")) or 0
            a = num(t.get("contractAmount"), None) or 0.0
            b, s = whole(t.get("buyerMemberId")), whole(t.get("sellerMemberId"))
            if b is not None:
                buyers[b][0] += q
                buyers[b][1] += a
            if s is not None:
                sellers[s][0] += q
                sellers[s][1] += a

        def top(side):
            ranked = sorted(side.items(), key=lambda kv: kv[1][0], reverse=True)[:5]
            return [{"broker": broker, "qty": q, "amount": round(a, 2)} for broker, (q, a) in ranked]

        rows.append({
            "company_id": company_id, "date": trade_date.isoformat(),
            "trades": len(items), "quantity": qty, "amount": round(amount, 2),
            "vwap": round(amount / qty, 2) if qty else None,
            "largest_trade_qty": max(whole(t.get("contractQuantity")) or 0 for t in items),
            "buyer_brokers": len(buyers), "seller_brokers": len(sellers),
            "top_buyers": top(buyers), "top_sellers": top(sellers),
        })
    return rows, unmapped


# ---------------------------------------------------------------- prices


def first_of(row: dict, *keys):
    for key in keys:
        if row.get(key) is not None:
            return row[key]
    return None


def rows_from_live(live: list[dict], closes: list[dict], trade_date: date) -> list[dict]:
    """Normalise the live market list (the verified source after the close)."""
    close_by_symbol = {str(r.get("symbol")).upper(): num(r.get("closePrice")) for r in closes if num(r.get("closePrice"))}
    out = []
    for r in live:
        updated = parse_npt(r.get("lastUpdatedDateTime"))
        if updated and updated.date() != trade_date:
            continue
        out.append({
            "securityId": r.get("securityId"), "symbol": r.get("symbol"),
            "open": num(r.get("openPrice")), "high": num(r.get("highPrice")), "low": num(r.get("lowPrice")),
            "close": close_by_symbol.get(str(r.get("symbol")).upper()) or num(r.get("lastTradedPrice")),
            "prev_close": num(r.get("previousClose")), "volume": whole(r.get("totalTradeQuantity")) or 0,
            "turnover": num(r.get("totalTradeValue")), "trades": None,
        })
    return out


def rows_from_today_price(nepse: NepseSource, trade_date: date) -> tuple[list[dict], dict]:
    """NEPSE's "today's price" list for a business date: the fallback when the
    live market list has already been cleared (for example on a catch-up run
    the next morning). Field names are matched loosely; the first row's keys are
    recorded in the run details so the shape is documented by real data."""
    api = nepse.api
    url = f"{api.api_end_points['todays_price']}?&size=500&businessDate={trade_date.isoformat()}"
    items, number, pages, shape = [], 0, 1, None
    while number < pages:
        target = url if number == 0 else f"{url}&page={number}"
        result = nepse.call("requestPOSTAPI", url=target, payload_generator=api.getPOSTPayloadIDForFloorSheet)
        content = result.get("content") if isinstance(result, dict) else result
        if not isinstance(content, list):
            raise JobError(f"today's price list for {trade_date} had an unexpected shape: {type(result).__name__}")
        if isinstance(result, dict):
            pages = whole(result.get("totalPages")) or 1
        items.extend(content)
        number += 1
        clock.sleep(PAUSE)
    if items:
        shape = sorted(items[0].keys())
    out = []
    for r in items:
        if str(first_of(r, "businessDate") or trade_date) != trade_date.isoformat():
            continue
        out.append({
            "securityId": first_of(r, "securityId", "stockId"), "symbol": first_of(r, "symbol", "stockSymbol"),
            "open": num(first_of(r, "openPrice", "open")), "high": num(first_of(r, "highPrice", "high")),
            "low": num(first_of(r, "lowPrice", "low")), "close": num(first_of(r, "closePrice", "close", "lastTradedPrice")),
            "prev_close": num(first_of(r, "previousDayClosePrice", "previousClose")),
            "volume": whole(first_of(r, "totalTradedQuantity", "totalTradeQuantity")) or 0,
            "turnover": num(first_of(r, "totalTradedValue", "totalTradeValue")),
            "trades": whole(first_of(r, "totalTrades")),
        })
    return out, {"pages": pages, "rows": len(items), "fields": shape}


def get_prices(nepse: NepseSource, trade_date: date) -> tuple[list[dict], dict]:
    """The day's prices, from the first source that has them: NEPSE's live market
    list (verified in Phase 0), NEPSE's today's-price list, then Sharesansar."""
    attempts: list[str] = []

    def traded(rows):
        return sum(1 for r in rows if r["volume"] > 0 and r["close"] is not None)

    try:
        live = nepse.call("getLiveMarket") or []
        newest = max((d for d in (parse_npt(r.get("lastUpdatedDateTime")) for r in live if isinstance(r, dict)) if d), default=None)
        if newest and newest.date() == trade_date:
            rows = rows_from_live(live, nepse.call("getPriceVolume") or [], trade_date)
            if traded(rows) >= 50:
                return rows, {"source": "live market", "price_source": "nepse"}
            attempts.append(f"live market: only {traded(rows)} traded")
        else:
            attempts.append(f"live market dated {newest.date() if newest else 'nothing'}")
    except JobError as exc:
        attempts.append(f"live market: {exc}")
    try:
        rows, info = rows_from_today_price(nepse, trade_date)
        if traded(rows) >= 50:
            return rows, {**info, "source": "today's price", "price_source": "nepse", "attempts": attempts}
        attempts.append(f"today's price: only {traded(rows)} traded")
    except JobError as exc:
        attempts.append(f"today's price: {exc}")
    as_of, rows = sharesansar.fetch_today()
    if as_of != trade_date:
        raise JobError(f"no source has prices for {trade_date}: {'; '.join(attempts)}; Sharesansar is dated {as_of}")
    return rows, {"source": "Sharesansar", "price_source": "sharesansar", "attempts": attempts}


# ---------------------------------------------------------------- price adjustments


def detect_adjustments(db: Supabase, prices: list[dict], trade_date: date) -> list[dict]:
    """Compare NEPSE's previous close with our last stored close for each traded company."""
    since = trade_date - timedelta(days=60)
    previous = {r["company_id"]: r for r in db.rpc("latest_closes_before", {"p_date": trade_date.isoformat(), "p_since": since.isoformat()})}
    if not previous:
        return []
    known_days = {r["date"] for r in db.rpc("trading_days", {"p_since": since.isoformat()})}
    holidays = {r["trade_date"] for r in db.select_all(
        "job_runs", select="trade_date", status="eq.holiday", trade_date=f"gte.{since.isoformat()}")}

    events = []
    for row in prices:
        before = previous.get(row["company_id"])
        reported = row.get("prev_close")
        if not before or not reported:
            continue
        actual = float(before["close"])
        if actual <= 0:
            continue
        factor = reported / actual
        if abs(factor - 1) <= ADJUST_THRESHOLD:
            continue
        prev_day = date.fromisoformat(str(before["date"]))
        gaps = []
        day = prev_day + timedelta(days=1)
        while day < trade_date:
            if day.weekday() < 5 and day.isoformat() not in known_days and day.isoformat() not in holidays:
                gaps.append(day.isoformat())
            day += timedelta(days=1)
        if gaps:
            status, note = "unconfirmed", f"no data for {', '.join(gaps[:5])}: the difference may be a missed day"
        elif not 0.3 < factor < 1:
            status, note = "unconfirmed", "factor above 1 or unusually small; not a typical bonus or right adjustment"
        else:
            status, note = "confirmed", None
        events.append({
            "company_id": row["company_id"], "ex_date": trade_date.isoformat(), "factor": round(factor, 6),
            "prev_close_reported": reported, "prev_close_actual": round(actual, 2), "prev_date": prev_day.isoformat(),
            "status": status, "source": "nepse", "note": note,
        })
    return events


# ---------------------------------------------------------------- indices


def index_rows(nepse: NepseSource, known: set[int], trade_date: date) -> tuple[list[dict], dict[int, list[dict]], list[str]]:
    main = nepse.call("getNepseIndex") or []
    subs = nepse.call("getNepseSubIndices") or []
    latest: dict[int, dict] = {}
    for item in main:
        index_id = whole(item.get("id"))
        if index_id in known and num(item.get("currentValue")) is not None:
            latest[index_id] = {
                "close": num(item.get("currentValue")), "high": num(item.get("high")),
                "low": num(item.get("low")), "prev_close": num(item.get("previousClose")),
            }
    for item in subs:
        index_id = whole(item.get("id"))
        value, change = num(item.get("currentValue")), num(item.get("change"))
        if index_id in known and value is not None:
            latest[index_id] = {"close": value, "high": None, "low": None,
                                "prev_close": round(value - change, 2) if change is not None else None}

    days, points, problems = [], {}, []
    for index_id, values in sorted(latest.items()):
        open_ = high = low = None
        method = INDEX_GRAPHS.get(index_id)
        if method:
            clock.sleep(PAUSE)
            try:
                graph = nepse.call(method) or []
                series = []
                for point in graph:
                    if isinstance(point, (list, tuple)) and len(point) >= 2 and num(point[1]) is not None:
                        at = datetime.fromtimestamp(int(point[0]), timezone.utc)
                        if at.astimezone(NPT).date() == trade_date:
                            series.append((at, num(point[1])))
                if series:
                    open_ = series[0][1]
                    high, low = max(v for _, v in series), min(v for _, v in series)
                    points[index_id] = [{"index_id": index_id, "ts": at.isoformat(), "value": v} for at, v in series]
                else:
                    problems.append(f"index {index_id}: graph had no points for {trade_date}")
            except JobError as exc:
                problems.append(f"index {index_id}: {exc}")
        days.append({
            "index_id": index_id, "date": trade_date.isoformat(),
            "open": open_,
            "high": values["high"] if values["high"] is not None else high,
            "low": values["low"] if values["low"] is not None else low,
            "close": values["close"], "prev_close": values["prev_close"], "is_final": True,
        })
    return days, points, problems


# ---------------------------------------------------------------- main


def storage(db: Supabase) -> dict:
    rows = db.rpc("storage_report")
    total = next((r["total_bytes"] for r in rows if r["name"] == "(database)"), None)
    tables = {r["name"]: round(r["total_bytes"] / 1e6, 1) for r in rows if r["name"] != "(database)"}
    return {"database_mb": round(total / 1e6, 1) if total else None,
            "largest_tables_mb": dict(sorted(tables.items(), key=lambda kv: -kv[1])[:6])}


def main() -> None:
    now = now_npt()
    forced = started_by_hand() or os.environ.get("EOD_FORCE") == "1"
    if now.weekday() < 5 and NO_RUN_FROM <= now.time() < EARLIEST:
        print(f"{now:%H:%M}: the session is on or about to start. The end-of-day job runs after {EARLIEST:%H:%M}.")
        return

    db = Supabase()
    nepse = NepseSource()
    try:
        status = nepse.call("getMarketStatus") or {}
    except JobError as exc:
        sharesansar_only(db, exc, forced)
        return
    if str(status.get("isOpen", "")).strip().upper() == "OPEN":
        print("NEPSE reports the market open. Nothing to do yet.")
        return
    as_of = parse_npt(status.get("asOf"))
    if not as_of:
        raise JobError(f"NEPSE market status has no usable date: {status}")
    trade_date = as_of.date()

    # A weekday afternoon whose date is newer than NEPSE's last session: no trading today.
    today = now.date()
    if now.weekday() < 5 and now.time() >= EARLIEST and trade_date < today:
        already = db.select("job_runs", select="id", job="eq.eod", status="eq.holiday", trade_date=f"eq.{today.isoformat()}")
        if not already:
            JobRun(db, "eod", trade_date=today).finish(
                "holiday", f"NEPSE's last session is {trade_date}; no trading on {today:%A %d %b %Y}",
                requests=nepse.budget.total)
            write_summary(f"## End of day\n\nNo trading on {today:%A %d %b %Y}; NEPSE's last session was {trade_date}. Recorded as a holiday.\n")

    existing = db.select("market_daily", select="is_final", date=f"eq.{trade_date.isoformat()}")
    if existing and existing[0]["is_final"] and not forced:
        print(f"{trade_date} is already final. Nothing to do.")
        return

    run_log = JobRun(db, "eod", trade_date=trade_date)
    try:
        finalise(db, nepse, run_log, trade_date)
    except JobError as exc:
        run_log.finish("failed", str(exc), requests=nepse.budget.total)
        raise


def sharesansar_only(db: Supabase, nepse_error: JobError, forced: bool) -> None:
    """NEPSE itself is unreachable: store the day's prices from Sharesansar so the
    site still has a close. market_daily stays non-final, so a later run (the
    backups at 16:40 and 19:10) completes the day from NEPSE if it comes back."""
    as_of, rows = sharesansar.fetch_today()
    if not as_of:
        raise JobError(f"NEPSE unreachable ({nepse_error}) and Sharesansar's page has no date")
    existing = db.select("market_daily", select="is_final", date=f"eq.{as_of.isoformat()}")
    if existing and existing[0]["is_final"] and not forced:
        print(f"NEPSE unreachable, but {as_of} is already final. Nothing to do.")
        return
    run_log = JobRun(db, "eod", trade_date=as_of, source="sharesansar")
    by_security, by_symbol = company_maps(db)
    prices = []
    for r in rows:
        company_id = lookup_company(r, by_security, by_symbol)
        if company_id is None or r["volume"] <= 0 or r["close"] is None:
            continue
        prices.append({"company_id": company_id, "date": as_of.isoformat(), "open": r["open"], "high": r["high"],
                       "low": r["low"], "close": r["close"], "prev_close": r["prev_close"], "volume": r["volume"],
                       "turnover": r["turnover"], "trades": r["trades"], "is_final": True, "source": "sharesansar"})
    if len(prices) < 50:
        run_log.finish("failed", f"NEPSE unreachable ({nepse_error}); Sharesansar gave only {len(prices)} prices")
        raise JobError(f"NEPSE unreachable ({nepse_error}); Sharesansar gave only {len(prices)} prices; nothing written")
    events = detect_adjustments(db, prices, as_of)
    written = db.upsert("daily_prices", prices, on_conflict="company_id,date")
    if events:
        written += db.upsert("price_adjustments", events, on_conflict="company_id,ex_date")
        for event in events:
            if event["status"] == "confirmed":
                db.rpc("apply_price_adjustments", {"p_company_id": event["company_id"]})
    up = sum(p["close"] > p["prev_close"] for p in prices if p["prev_close"])
    down = sum(p["close"] < p["prev_close"] for p in prices if p["prev_close"])
    same = sum(p["close"] == p["prev_close"] for p in prices if p["prev_close"])
    written += db.upsert("market_daily", [{
        "date": as_of.isoformat(), "turnover": round(sum(p["turnover"] or 0 for p in prices), 2),
        "traded_shares": sum(p["volume"] for p in prices), "transactions": sum(p["trades"] or 0 for p in prices),
        "scrips_traded": len(prices), "advancers": up, "decliners": down, "unchanged": same, "is_final": False,
    }], on_conflict="date")
    message = f"NEPSE unreachable ({str(nepse_error)[:120]}); {len(prices)} prices for {as_of} from Sharesansar, no floorsheet or indices"
    run_log.finish("partial", message, rows_written=written, details={"prices": {"source": "Sharesansar"}, "adjustments": len(events)})
    write_summary(f"## End of day {as_of} (fallback)\n\n- {message}.\n- A later run completes the day from NEPSE if it is reachable again.\n")


def finalise(db: Supabase, nepse: NepseSource, run_log: JobRun, trade_date: date) -> None:
    problems: list[str] = []
    by_security, by_symbol = company_maps(db)

    # 1. Prices
    source_rows, price_info = get_prices(nepse, trade_date)

    # 2. Floorsheet (optional: prices are still written if it fails)
    floor_rows, floor_info, trades_by_company = [], {}, {}
    try:
        trades, floor_info = fetch_floorsheet(nepse, trade_date)
        floor_rows, unmapped = summarise_floorsheet(trades, by_security, by_symbol, trade_date)
        trades_by_company = {r["company_id"]: r for r in floor_rows}
        floor_info["unmapped_symbols"] = sorted(unmapped)[:20]
        if floor_info["reported_trades"] and floor_info["reported_trades"] != floor_info["fetched_trades"]:
            problems.append(f"floorsheet: NEPSE reported {floor_info['reported_trades']} trades, fetched {floor_info['fetched_trades']}")
    except JobError as exc:
        problems.append(f"floorsheet not stored: {exc}")

    prices, volume_mismatch = [], []
    advancers = decliners = unchanged = 0
    for r in source_rows:
        company_id = lookup_company(r, by_security, by_symbol)
        volume, close = r["volume"], r["close"]
        if company_id is None or volume <= 0 or close is None:
            continue
        prev = r["prev_close"]
        floor = trades_by_company.get(company_id)
        if floor and floor["quantity"] != volume:
            volume_mismatch.append(company_id)
        if prev:
            advancers += close > prev
            decliners += close < prev
            unchanged += close == prev
        prices.append({
            "company_id": company_id, "date": trade_date.isoformat(),
            "open": r["open"], "high": r["high"], "low": r["low"],
            "close": close, "prev_close": prev, "volume": volume, "turnover": r["turnover"],
            "trades": floor["trades"] if floor else r["trades"], "is_final": True, "source": price_info["price_source"],
        })
    if len(prices) < 50:
        raise JobError(f"only {len(prices)} traded securities for {trade_date} ({price_info}); suspiciously few, nothing written")
    if volume_mismatch:
        problems.append(f"volume differs between the price list and the floorsheet for {len(volume_mismatch)} companies")

    # 3. Adjustments (before writing today's rows, so "previous close" means the day before)
    events = detect_adjustments(db, prices, trade_date)

    written = db.upsert("daily_prices", prices, on_conflict="company_id,date")
    if floor_rows:
        written += db.upsert("floorsheet_daily", floor_rows, on_conflict="company_id,date")
    adjusted_rows = 0
    if events:
        written += db.upsert("price_adjustments", events, on_conflict="company_id,ex_date")
        for event in events:
            if event["status"] == "confirmed":
                adjusted_rows += int(db.rpc("apply_price_adjustments", {"p_company_id": event["company_id"]}) or 0)

    # 4. Indices
    known = {r["id"] for r in db.select("indices", select="id")}
    index_days, index_points, index_problems = index_rows(nepse, known, trade_date)
    problems += index_problems
    if index_days:
        written += db.upsert("index_daily", index_days, on_conflict="index_id,date")
    start, _ = npt_day_bounds(trade_date)
    for index_id, points in index_points.items():
        # Nothing newer than trade_date exists yet: NEPSE's latest session is trade_date.
        db.delete("index_intraday", index_id=f"eq.{index_id}", ts=f"gte.{start}")
        written += db.upsert("index_intraday", points, on_conflict="index_id,ts", ignore_duplicates=True)

    # 5. Market totals
    summary = summary_fields(nepse.call("getSummary"))
    # Only a day with NEPSE prices and a floorsheet counts as final; otherwise the
    # backup runs try again later the same day.
    complete = price_info["price_source"] == "nepse" and bool(floor_rows)
    market = {"date": trade_date.isoformat(), "advancers": advancers, "decliners": decliners,
              "unchanged": unchanged, "is_final": complete, **summary}
    written += db.upsert("market_daily", [market], on_conflict="date")

    # 6. Retention and storage
    cutoff = datetime.now(timezone.utc)
    removed = db.delete("intraday_snapshots", ts=f"lt.{(cutoff - timedelta(days=SNAPSHOT_DAYS)).isoformat()}")
    removed += db.delete("index_intraday", ts=f"lt.{(cutoff - timedelta(days=INDEX_POINT_DAYS)).isoformat()}")
    space = storage(db)
    if space["database_mb"] and space["database_mb"] > STORAGE_WARN_MB:
        problems.append(f"database is {space['database_mb']} MB of the free plan's 500 MB")

    confirmed = [e for e in events if e["status"] == "confirmed"]
    details = {
        "traded_securities": len(prices), "prices": price_info, "floorsheet": floor_info, "floorsheet_companies": len(floor_rows),
        "indices": len(index_days), "index_graph_points": sum(len(p) for p in index_points.values()),
        "adjustments": {"confirmed": len(confirmed), "unconfirmed": len(events) - len(confirmed), "rows_adjusted": adjusted_rows},
        "rows_removed_by_retention": removed, "storage": space, "problems": problems[:10],
    }
    status_word = "ok" if not problems else "partial"
    message = f"{trade_date}: {len(prices)} prices, {len(floor_rows)} floorsheet summaries, {len(index_days)} indices"
    run_log.finish(status_word, message, requests=nepse.budget.total, rows_written=written, details=details)

    write_summary("\n".join([
        f"## End of day {trade_date}",
        "",
        f"- **{len(prices)} traded securities** finalised from NEPSE's {price_info['source']} list; advancers {advancers}, decliners {decliners}, unchanged {unchanged}.",
        f"- Floorsheet: {floor_info.get('fetched_trades', 0)} trades in {floor_info.get('pages', 0)} pages "
        f"(NEPSE reported {floor_info.get('reported_trades')}), summarised for {len(floor_rows)} companies.",
        f"- Indices: {len(index_days)} final, {details['index_graph_points']} intraday graph points.",
        f"- Price adjustments found: {len(confirmed)} confirmed, {len(events) - len(confirmed)} for review; {adjusted_rows} historical rows re-adjusted.",
        f"- Retention removed {removed} old intraday rows. Database size: **{space['database_mb']} MB** of 500 MB.",
        f"- NEPSE requests: {nepse.budget.total}. Rows written: {written}.",
        *([f"- Problems: {'; '.join(problems)}"] if problems else []),
        "",
    ]))


if __name__ == "__main__":
    run(main)
