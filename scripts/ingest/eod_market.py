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
    now_npt, num, run, whole, write_summary,
)
from live_market import parse_npt, summary_fields  # noqa: E402

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
    forced = os.environ.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch") or os.environ.get("EOD_FORCE") == "1"
    if now.weekday() < 5 and NO_RUN_FROM <= now.time() < EARLIEST:
        print(f"{now:%H:%M}: the session is on or about to start. The end-of-day job runs after {EARLIEST:%H:%M}.")
        return

    db = Supabase()
    nepse = NepseSource()
    status = nepse.call("getMarketStatus") or {}
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
    problems: list[str] = []
    by_security, by_symbol = company_maps(db)

    # 1. Prices
    live = nepse.call("getLiveMarket")
    closes = nepse.call("getPriceVolume")
    if not isinstance(live, list) or not isinstance(closes, list):
        raise JobError("NEPSE returned an unexpected shape for the live market or price list")
    newest = max((d for d in (parse_npt(r.get("lastUpdatedDateTime")) for r in live) if d), default=None)
    if not newest or newest.date() != trade_date:
        raise JobError(f"NEPSE's live market is dated {newest.date() if newest else 'nothing'}, not {trade_date}; nothing written")
    close_by_company = {}
    for r in closes:
        company_id = lookup_company(r, by_security, by_symbol)
        if company_id is not None and num(r.get("closePrice")):
            close_by_company[company_id] = num(r.get("closePrice"))

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
    for r in live:
        company_id = lookup_company(r, by_security, by_symbol)
        volume = whole(r.get("totalTradeQuantity")) or 0
        if company_id is None or volume <= 0:
            continue
        updated = parse_npt(r.get("lastUpdatedDateTime"))
        if updated and updated.date() != trade_date:
            continue
        close = close_by_company.get(company_id) or num(r.get("lastTradedPrice"))
        if close is None:
            continue
        prev = num(r.get("previousClose"))
        floor = trades_by_company.get(company_id)
        if floor and floor["quantity"] != volume:
            volume_mismatch.append(company_id)
        if prev:
            advancers += close > prev
            decliners += close < prev
            unchanged += close == prev
        prices.append({
            "company_id": company_id, "date": trade_date.isoformat(),
            "open": num(r.get("openPrice")), "high": num(r.get("highPrice")), "low": num(r.get("lowPrice")),
            "close": close, "prev_close": prev, "volume": volume, "turnover": num(r.get("totalTradeValue")),
            "trades": floor["trades"] if floor else None, "is_final": True, "source": "nepse",
        })
    if len(prices) < 50:
        raise JobError(f"only {len(prices)} traded securities for {trade_date}; suspiciously few, nothing written")
    if volume_mismatch:
        problems.append(f"volume differs between live market and floorsheet for {len(volume_mismatch)} companies")

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
    market = {"date": trade_date.isoformat(), "advancers": advancers, "decliners": decliners,
              "unchanged": unchanged, "is_final": True, **summary}
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
        "traded_securities": len(prices), "floorsheet": floor_info, "floorsheet_companies": len(floor_rows),
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
        f"- **{len(prices)} traded securities** finalised; advancers {advancers}, decliners {decliners}, unchanged {unchanged}.",
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
