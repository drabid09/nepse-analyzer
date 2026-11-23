#!/usr/bin/env python3
"""One-time history import, safe to repeat.

Step 1, CSV history (Phase 0 decision 2). Reads the per-company daily CSVs of
the MIT-licensed Aabishkar2/nepse-data repository, checked out by the workflow
at a pinned commit, and inserts them into daily_prices with source 'csv'.
Rows already present (for example from NEPSE itself) are left alone.

While reading, it detects bonus and right-share adjustments. The CSV's percent
change is measured against NEPSE's adjusted previous close, so

    implied previous close = close / (1 + percent change / 100)

and on an adjustment day that differs from the previous row's close. The ratio
is the adjustment factor: NABIL on 2019-02-26 gives 708.91 / 794.00 = 0.8928,
which is 1 / 1.12, its 12% bonus. Confirmed events set daily_prices.adj_factor.

Step 2, NEPSE gap fill. For tradable companies with no CSV, it reads NEPSE's own
history (about one year, no opening price) one company at a time, slowly. It
also checks, on a few companies with a recent adjustment, whether NEPSE's
history is raw or already adjusted, and reports which.

A storage guard stops before writing if the import would take the database
past STORAGE_LIMIT_MB of the free plan's 500 MB.
"""

from __future__ import annotations

import csv
import os
import sys
import time as clock
from datetime import date, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import JobError, JobRun, NepseSource, Supabase, now_npt, num, run, whole, write_summary  # noqa: E402

STORAGE_LIMIT_MB = 430         # stop if current size + estimate would pass this
BYTES_PER_ROW = 235            # daily_prices row with its two indexes (230 measured on a local copy)
ADJUST_THRESHOLD = 0.01
NEPSE_PAUSE = 3.0              # seconds between companies in the gap fill
QUIET_FROM, QUIET_UNTIL = time(10, 15), time(15, 15)  # no gap fill during the session
COMPARE_COMPANIES = 8          # raw-or-adjusted check on NEPSE history
# Before March 2018 the dataset's "open" is NEPSE's previous close (it matches
# the previous row 97-100% of the time, against 10-25% afterwards) and its
# percent change is unreliable. From March 2018 the open is a real opening price
# and the percent change matches the previous row 98-100% of the time.
REAL_OPEN_FROM = "2018-03-01"
MASS_EVENT_DAY = 5             # more events than this on one date: an artefact of the source


# ---------------------------------------------------------------- step 1: CSV


def read_csv(path: Path) -> tuple[list[dict], dict]:
    """Rows of one company file, cleaned, oldest first, plus counts of what was fixed."""
    fixes = {"open_outside_range": 0, "high_below_low": 0, "bad_close": 0, "duplicate_dates": 0}
    by_date: dict[str, dict] = {}
    with path.open(newline="") as handle:
        for raw in csv.DictReader(handle):
            day = (raw.get("published_date") or "").strip()[:10]
            close = num(raw.get("close"))
            if not day or close is None or close <= 0:
                fixes["bad_close"] += 1
                continue
            try:
                date.fromisoformat(day)
            except ValueError:
                fixes["bad_close"] += 1
                continue
            high, low, open_ = num(raw.get("high")), num(raw.get("low")), num(raw.get("open"))
            raw_open = open_
            if day < REAL_OPEN_FROM:
                open_ = None  # it is the previous close, kept as prev_close below
            if high is not None and low is not None and high < low:
                fixes["high_below_low"] += 1
                high = low = None
            if open_ is not None and (open_ <= 0 or (high is not None and low is not None and not low <= open_ <= high)):
                fixes["open_outside_range"] += 1
                open_ = None
            if day in by_date:
                fixes["duplicate_dates"] += 1
            by_date[day] = {
                "date": day, "open": open_, "high": high, "low": low, "close": close,
                "pct": num(raw.get("per_change"), None), "raw_open": raw_open,
                "volume": whole(raw.get("traded_quantity")), "turnover": num(raw.get("traded_amount")),
            }
    return [by_date[d] for d in sorted(by_date)], fixes


def implied_prev(row: dict) -> float | None:
    """NEPSE's (adjusted) previous close for this row, as the source recorded it:
    the "open" column before March 2018, derived from the percent change after."""
    if row["date"] < REAL_OPEN_FROM:
        value = row["raw_open"]
    else:
        pct = row["pct"]
        if pct is None or pct <= -100:
            return None
        value = row["close"] / (1 + pct / 100)
    if value is None:
        return None
    value = round(value, 2)
    return value if 0 < value < row["close"] * 20 else None


def csv_events(company_id: int, rows: list[dict]) -> list[dict]:
    events = []
    for before, row in zip(rows, rows[1:]):
        implied = implied_prev(row)
        if implied is None:
            continue
        factor = implied / before["close"]
        if abs(factor - 1) <= ADJUST_THRESHOLD or not 0.05 < factor < 20:
            continue  # no event, or an obvious error in the source
        if 0.3 < factor < 1:
            status, note = "confirmed", None
        else:
            status, note = "unconfirmed", "factor above 1 or unusually small: possibly a gap or an error in the source data"
        events.append({
            "company_id": company_id, "ex_date": row["date"], "factor": round(factor, 6),
            "prev_close_reported": implied, "prev_close_actual": before["close"],
            "prev_date": before["date"], "status": status, "source": "csv", "note": note,
        })
    # A jump that reverses on the very next row is one misplaced price, not an event.
    for first, second in zip(events, events[1:]):
        if second["prev_date"] == first["ex_date"] and abs(first["factor"] * second["factor"] - 1) < 0.02:
            for e in (first, second):
                e["status"] = "unconfirmed"
                e["note"] = "reversed on the next trading day: a misplaced price in the source data"
    return events


def demote_mass_days(events: list[dict]) -> int:
    """Real adjustments are company events: on a busy bonus day (early January,
    say) several companies have one, all below 1. When many companies show a
    "factor" on the same date and many of those are above 1 or within 3% of 1,
    the source skipped a trading day or changed its reference price. Those are
    kept for review and not applied."""
    per_day: dict[str, list[float]] = {}
    for e in events:
        per_day.setdefault(e["ex_date"], []).append(e["factor"])
    artefact_days = {}
    for day, factors in per_day.items():
        if len(factors) <= MASS_EVENT_DAY:
            continue
        above = sum(f > 1 for f in factors) / len(factors)
        near = sum(0.97 <= f <= 1.03 for f in factors) / len(factors)
        if above >= 0.15 or near >= 0.5:
            artefact_days[day] = len(factors)
    demoted = 0
    for e in events:
        if e["ex_date"] in artefact_days:
            demoted += e["status"] == "confirmed"
            e["status"] = "unconfirmed"
            e["note"] = (f"{artefact_days[e['ex_date']]} companies on the same date, many near or above 1: "
                         "likely a skipped day or a change of reference in the source data")
    return demoted


def import_csv(db: Supabase, folder: Path, companies: dict[str, dict], summary: dict) -> set[int]:
    files = sorted(folder.glob("*.csv"))
    if not files:
        raise JobError(f"no CSV files in {folder}")
    price_rows, events, unmapped = [], [], []
    fixes_total: dict[str, int] = {}
    covered: set[int] = set()
    first_day, last_day = None, None
    for path in files:
        company = companies.get(path.stem.upper())
        if not company:
            unmapped.append(path.stem)
            continue
        rows, fixes = read_csv(path)
        for key, value in fixes.items():
            fixes_total[key] = fixes_total.get(key, 0) + value
        if not rows:
            continue
        covered.add(company["id"])
        first_day = min(first_day or rows[0]["date"], rows[0]["date"])
        last_day = max(last_day or rows[-1]["date"], rows[-1]["date"])
        events.extend(csv_events(company["id"], rows))
        for r in rows:
            price_rows.append({
                "company_id": company["id"], "date": r["date"], "open": r["open"], "high": r["high"],
                "low": r["low"], "close": r["close"],
                "prev_close": implied_prev(r),
                "volume": r["volume"], "turnover": r["turnover"], "is_final": True, "source": "csv",
            })

    space = storage_mb(db)
    estimate = round(len(price_rows) * BYTES_PER_ROW / 1e6, 1)
    summary.update({
        "csv_files": len(files), "csv_companies": len(covered), "csv_unmapped": len(unmapped),
        "csv_unmapped_sample": unmapped[:15], "csv_rows": len(price_rows), "csv_range": [first_day, last_day],
        "csv_fixes": fixes_total, "storage_before_mb": space, "estimate_mb": estimate,
    })
    if space is not None and space + estimate > STORAGE_LIMIT_MB:
        raise JobError(f"importing {len(price_rows)} rows (~{estimate} MB) would take the database from {space} MB "
                       f"past {STORAGE_LIMIT_MB} MB; nothing written. Shorten the history or raise the limit.")

    started = clock.monotonic()
    db.upsert("daily_prices", price_rows, on_conflict="company_id,date", ignore_duplicates=True, batch=1000)
    summary["csv_write_seconds"] = round(clock.monotonic() - started)
    summary["adjustments_mass_day_demoted"] = demote_mass_days(events)
    if events:
        db.upsert("price_adjustments", events, on_conflict="company_id,ex_date", batch=1000)
    confirmed = [e for e in events if e["status"] == "confirmed"]
    summary["adjustments_confirmed"] = len(confirmed)
    summary["adjustments_unconfirmed"] = len(events) - len(confirmed)
    adjusted = 0
    for company_id in sorted({e["company_id"] for e in confirmed}):
        adjusted += int(db.rpc("apply_price_adjustments", {"p_company_id": company_id}) or 0)
    summary["rows_adjusted"] = adjusted
    return covered


def csv_companies(folder: Path, companies: dict[str, dict]) -> set[int]:
    """Companies that have a CSV file, without reading the files."""
    return {companies[p.stem.upper()]["id"] for p in folder.glob("*.csv") if p.stem.upper() in companies}


# ---------------------------------------------------------------- step 2: NEPSE


def nepse_history(nepse: NepseSource, symbol: str, start: date, end: date) -> list[dict]:
    result = nepse.call("getCompanyPriceVolumeHistory", symbol, start_date=start, end_date=end)
    content = result.get("content") if isinstance(result, dict) else result
    return content if isinstance(content, list) else []


def compare_with_nepse(db: Supabase, nepse: NepseSource, companies_by_id: dict[int, dict], summary: dict) -> None:
    """On companies with a recent adjustment: is NEPSE's history raw or adjusted?"""
    since = (date.today() - timedelta(days=330)).isoformat()
    recent = [(r["company_id"], r["ex_date"], r["factor"]) for r in db.select(
        "price_adjustments", select="company_id,ex_date,factor", status="eq.confirmed",
        ex_date=f"gte.{since}", order="ex_date.desc", limit=50)]
    verdicts = []
    seen = set()
    for company_id, ex_date, factor in recent:
        if company_id in seen or len(verdicts) >= COMPARE_COMPANIES:
            continue
        ex = date.fromisoformat(str(ex_date))
        seen.add(company_id)
        symbol = companies_by_id[company_id]["symbol"]
        clock.sleep(NEPSE_PAUSE)
        try:
            history = nepse_history(nepse, symbol, ex - timedelta(days=20), ex - timedelta(days=1))
        except JobError as exc:
            verdicts.append({"symbol": symbol, "error": str(exc)[:120]})
            continue
        ours = {r["date"]: float(r["close"]) for r in db.select(
            "daily_prices", select="date,close", company_id=f"eq.{company_id}",
            date=f"gte.{(ex - timedelta(days=20)).isoformat()}", source="eq.csv")}
        raw = adjusted = 0
        for item in history:
            day, close = str(item.get("businessDate")), num(item.get("closePrice"))
            if day in ours and close:
                if abs(close - ours[day]) <= 0.05:
                    raw += 1
                elif abs(close - ours[day] * factor) <= max(0.05, 0.002 * ours[day]):
                    adjusted += 1
        verdicts.append({"symbol": symbol, "ex_date": ex_date, "factor": factor, "days_matching_raw": raw, "days_matching_adjusted": adjusted})
    summary["nepse_history_check"] = verdicts


def gap_fill(db: Supabase, nepse: NepseSource, missing: list[dict], summary: dict) -> None:
    end = now_npt().date()
    start = end - timedelta(days=365)
    written, failed, empty = 0, [], 0
    for company in missing:
        clock.sleep(NEPSE_PAUSE)
        try:
            history = nepse_history(nepse, company["symbol"], start, end)
        except JobError as exc:
            failed.append(company["symbol"])
            print(f"::warning::{company['symbol']}: {exc}", flush=True)
            if len(failed) >= 10 and len(failed) > len(missing) // 4:
                raise JobError(f"NEPSE history failing for many companies ({len(failed)}); stopped") from exc
            continue
        rows = []
        for item in history:
            close = num(item.get("closePrice"))
            day = str(item.get("businessDate") or "")[:10]
            if not close or len(day) != 10:
                continue
            rows.append({
                "company_id": company["id"], "date": day, "open": None,
                "high": num(item.get("highPrice")), "low": num(item.get("lowPrice")), "close": close,
                "prev_close": None, "volume": whole(item.get("totalTradedQuantity")),
                "turnover": num(item.get("totalTradedValue")), "trades": whole(item.get("totalTrades")),
                "is_final": True, "source": "nepse",
            })
        if not rows:
            empty += 1
            continue
        db.upsert("daily_prices", rows, on_conflict="company_id,date", ignore_duplicates=True)
        written += len(rows)
    summary.update({"nepse_companies": len(missing), "nepse_rows": written, "nepse_empty": empty,
                    "nepse_failed": failed[:20]})


# ---------------------------------------------------------------- main


def storage_mb(db: Supabase) -> float | None:
    rows = db.rpc("storage_report")
    total = next((r["total_bytes"] for r in rows if r["name"] == "(database)"), None)
    return round(total / 1e6, 1) if total else None


def main() -> None:
    steps = set(os.environ.get("BACKFILL_STEPS", "csv,nepse").split(","))
    folder = Path(os.environ.get("DATASET_DIR", "dataset/data/company-wise"))
    db = Supabase()
    run_log = JobRun(db, "backfill", source="csv")
    summary: dict = {"steps": sorted(steps)}
    try:
        rows = db.select_all("companies", select="id,symbol,is_tradable", order="id")
        companies = {r["symbol"].upper(): r for r in rows}
        by_id = {r["id"]: r for r in rows}
        covered: set[int] = set()
        if "csv" in steps:
            covered = import_csv(db, folder, companies, summary)
        if "nepse" in steps:
            now = now_npt()
            if now.weekday() < 5 and QUIET_FROM <= now.time() < QUIET_UNTIL:
                summary["nepse"] = f"deferred: {now:%H:%M} is during the trading session; re-run after {QUIET_UNTIL:%H:%M}"
            else:
                covered = covered or csv_companies(folder, companies)
                nepse = NepseSource()
                compare_with_nepse(db, nepse, by_id, summary)
                missing = [r for r in rows if r["is_tradable"] and r["id"] not in covered]
                gap_fill(db, nepse, missing, summary)
                summary["nepse_requests"] = nepse.budget.total
        summary["storage_after_mb"] = storage_mb(db)
    except JobError as exc:
        run_log.finish("failed", str(exc), details=summary)
        raise
    written = summary.get("csv_rows", 0) + summary.get("nepse_rows", 0)
    run_log.finish("ok", f"{summary.get('csv_rows', 0)} CSV rows, {summary.get('nepse_rows', 0)} NEPSE rows",
                   rows_written=written, requests=summary.get("nepse_requests", 0), details=summary)

    lines = ["## History backfill", ""]
    if "csv_rows" in summary:
        lines += [
            f"- CSV: {summary['csv_files']} files, {summary['csv_companies']} matched to companies, "
            f"{summary['csv_unmapped']} not in our companies table (e.g. {', '.join(summary['csv_unmapped_sample'][:8])}).",
            f"- **{summary['csv_rows']} daily rows** from {summary['csv_range'][0]} to {summary['csv_range'][1]}, "
            f"written in {summary['csv_write_seconds']} s. Rows already in the table were left alone.",
            f"- Cleaned: {summary['csv_fixes']}.",
            f"- Adjustments: **{summary['adjustments_confirmed']} confirmed**, {summary['adjustments_unconfirmed']} for review; "
            f"{summary['rows_adjusted']} rows given an adjustment factor.",
        ]
    if "nepse" in summary:
        lines.append(f"- NEPSE gap fill: {summary['nepse']}.")
    elif "nepse_rows" in summary:
        lines.append(f"- NEPSE gap fill: {summary['nepse_companies']} tradable companies without a CSV, "
                     f"{summary['nepse_rows']} rows; {summary['nepse_empty']} had no history, {len(summary['nepse_failed'])} failed.")
        for v in summary.get("nepse_history_check", []):
            lines.append(f"  - {v}")
    lines += [f"- Database: {summary.get('storage_before_mb')} MB before, **{summary['storage_after_mb']} MB after** (estimate was +{summary.get('estimate_mb')} MB).", ""]
    write_summary("\n".join(lines))


if __name__ == "__main__":
    run(main)
