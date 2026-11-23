#!/usr/bin/env python3
"""Live market job: one run covers one trading session.

Started by GitHub Actions shortly before the 11:00 open, it takes a snapshot
every 5 minutes until the market closes, then exits. Each snapshot:

  * keeps today's row in daily_prices current (is_final = false), so the
    latest quote is always today's row,
  * adds intraday points for companies whose price or volume changed,
  * records every index value, and the day's market totals so far,
  * updates the run's row in job_runs (the website's "last updated" stamp).

About 5 NEPSE requests per snapshot, the load planned in Phase 0. The
end-of-day job turns today's rows into final ones after the close.

Exits quietly on weekends, and after the session. If the market has not
opened by 11:30 the run ends as 'skipped'; deciding that a day was a holiday
is the end-of-day job's work.
"""

from __future__ import annotations

import statistics
import sys
import time as clock
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    NPT, JobError, JobRun, NepseSource, Supabase, company_maps, lookup_company,
    now_npt, num, previous_index_closes, run, settle_index_prev_close, whole, write_summary,
)

INTERVAL = timedelta(minutes=5)
OFFSET = timedelta(seconds=20)      # snapshot at :00:20, :05:20, ... so NEPSE has published the minute
OPEN_DEADLINE = time(11, 30)        # not open by now: no session today
STOP_AFTER = time(15, 10)           # never run past this, whatever NEPSE says
MAX_CONSECUTIVE_FAILURES = 6        # about half an hour of failed snapshots


def summary_fields(summary: list[dict]) -> dict:
    """NEPSE's market summary is a list of {detail, value}. Match labels loosely."""
    out = {}
    for item in summary or []:
        label = str(item.get("detail", "")).lower()
        value = item.get("value")
        if "float" in label and "capital" in label:
            out["float_market_cap"] = num(value)
        elif "capital" in label:
            out["market_cap"] = num(value)
        elif "turnover" in label:
            out["turnover"] = num(value)
        elif "share" in label:
            out["traded_shares"] = whole(value)
        elif "transaction" in label:
            out["transactions"] = whole(value)
        elif "scrip" in label:
            out["scrips_traded"] = whole(value)
    return out


def parse_npt(text) -> datetime | None:
    """NEPSE timestamps are Nepal local time without a zone, e.g. '2026-11-20 14:59:59.968499'."""
    if not text:
        return None
    try:
        return datetime.fromisoformat(str(text).replace(" ", "T")).replace(tzinfo=NPT)
    except ValueError:
        return None


class Session:
    def __init__(self, db: Supabase, nepse: NepseSource):
        self.db = db
        self.nepse = nepse
        self.by_security, self.by_symbol = company_maps(db)
        self.run: JobRun | None = None
        self.last_point: dict[int, tuple] = {}            # company -> (ltp, volume) last written
        self.index_range: dict[int, tuple[float, float]] = {}  # sub-index -> (low, high) seen today
        self.known_indices = {r["id"] for r in db.select("indices", select="id")}
        self.snapshots = 0
        self.failures = 0
        self.consecutive_failures = 0
        self.rows_written = 0
        self.lags: list[float] = []
        self.errors: list[str] = []
        self.unmapped: set[str] = set()
        self.seen_open = False
        self.previous_index: dict[int, float] | None = None  # last final close per index, read once

    # ------------------------------------------------------------------ one snapshot

    def snapshot(self, at: datetime) -> bool:
        """Returns True while the market is open."""
        status = self.nepse.call("getMarketStatus") or {}
        is_open = str(status.get("isOpen", "")).strip().upper() == "OPEN"
        if not is_open and not self.seen_open:
            return False
        if is_open and not self.seen_open:
            self.seen_open = True
            self.run = JobRun(self.db, "live", trade_date=at.date())

        live = self.nepse.call("getLiveMarket")
        main_indices = self.nepse.call("getNepseIndex")
        sub_indices = self.nepse.call("getNepseSubIndices")
        summary = self.nepse.call("getSummary")
        if not isinstance(live, list) or not isinstance(main_indices, list) or not isinstance(sub_indices, list):
            raise JobError("NEPSE returned an unexpected shape for the live market or indices")

        today = at.date().isoformat()
        ts = at.astimezone(timezone.utc).isoformat()
        prices, points, newest = [], [], None
        advancers = decliners = unchanged = 0
        for row in live:
            company_id = lookup_company(row, self.by_security, self.by_symbol)
            volume = whole(row.get("totalTradeQuantity")) or 0
            ltp = num(row.get("lastTradedPrice"))
            if company_id is None:
                self.unmapped.add(str(row.get("symbol")))
                continue
            if volume <= 0 or ltp is None:
                continue
            updated = parse_npt(row.get("lastUpdatedDateTime"))
            if updated and updated.date() == at.date():
                newest = max(newest, updated) if newest else updated
            change = num(row.get("percentageChange"))
            if change is not None:
                advancers += change > 0
                decliners += change < 0
                unchanged += change == 0
            prices.append({
                "company_id": company_id, "date": today,
                "open": num(row.get("openPrice")), "high": num(row.get("highPrice")),
                "low": num(row.get("lowPrice")), "close": ltp,
                "prev_close": num(row.get("previousClose")), "volume": volume,
                "turnover": num(row.get("totalTradeValue")), "is_final": False, "source": "nepse",
            })
            if self.last_point.get(company_id) != (ltp, volume):
                points.append({"company_id": company_id, "ts": ts, "ltp": ltp, "volume": volume})
                self.last_point[company_id] = (ltp, volume)

        index_days, index_points = [], []
        for item in main_indices:
            index_id = whole(item.get("id"))
            value = num(item.get("currentValue"))
            if index_id not in self.known_indices or value is None:
                continue
            index_days.append({
                "index_id": index_id, "date": today, "close": value,
                "high": num(item.get("high")), "low": num(item.get("low")),
                "prev_close": num(item.get("previousClose")), "is_final": False,
            })
            index_points.append({"index_id": index_id, "ts": ts, "value": value})
        for item in sub_indices:
            index_id = whole(item.get("id"))
            value = num(item.get("currentValue"))
            if index_id not in self.known_indices or value is None:
                continue
            low, high = self.index_range.get(index_id, (value, value))
            low, high = min(low, value), max(high, value)
            self.index_range[index_id] = (low, high)
            change = num(item.get("change"))
            index_days.append({
                "index_id": index_id, "date": today, "close": value, "high": high, "low": low,
                "prev_close": round(value - change, 2) if change is not None else None, "is_final": False,
            })
            index_points.append({"index_id": index_id, "ts": ts, "value": value})

        if self.previous_index is None:
            self.previous_index = previous_index_closes(self.db, at.date())
        settle_index_prev_close(index_days, self.previous_index)

        market = {"date": today, "advancers": advancers, "decliners": decliners, "unchanged": unchanged,
                  "is_final": False, **summary_fields(summary)}

        db = self.db
        if not is_open:
            # The capture just after the close. If the end-of-day job has somehow
            # already run, its final rows win.
            final = db.select("market_daily", select="is_final", date=f"eq.{today}")
            if final and final[0]["is_final"]:
                print(f"{at:%H:%M:%S} {today} is already final; last snapshot not written", flush=True)
                return False
        written = 0
        written += db.upsert("daily_prices", prices, on_conflict="company_id,date")
        if points:
            written += db.upsert("intraday_snapshots", points, on_conflict="company_id,ts", ignore_duplicates=True)
        if index_days:
            written += db.upsert("index_daily", index_days, on_conflict="index_id,date")
            written += db.upsert("index_intraday", index_points, on_conflict="index_id,ts", ignore_duplicates=True)
        written += db.upsert("market_daily", [market], on_conflict="date")
        self.rows_written += written

        lag = (at - newest).total_seconds() if newest else None
        if lag is not None:
            self.lags.append(lag)
        self.snapshots += 1
        print(f"{at:%H:%M:%S} open={is_open} traded={len(prices)} points={len(points)} "
              f"indices={len(index_days)} lag={'?' if lag is None else f'{lag:.0f}s'} "
              f"requests={self.nepse.budget.total}", flush=True)
        if self.run:
            self.run.update(requests=self.nepse.budget.total, rows_written=self.rows_written, details=self.details(at))
        return is_open

    # ------------------------------------------------------------------ reporting

    def details(self, at: datetime) -> dict:
        lags = sorted(self.lags)
        return {
            "snapshots": self.snapshots,
            "failed_snapshots": self.failures,
            "last_snapshot_npt": at.strftime("%H:%M:%S"),
            "data_lag_seconds": {
                "median": round(statistics.median(lags)) if lags else None,
                "max": round(lags[-1]) if lags else None,
                "min": round(lags[0]) if lags else None,
            },
            "unmapped_symbols": sorted(self.unmapped)[:20],
            "recent_errors": self.errors[-5:],
        }


def next_slot(now: datetime) -> datetime:
    """The next :00:20, :05:20, ... after now."""
    base = now.replace(second=0, microsecond=0)
    base -= timedelta(minutes=base.minute % 5)
    slot = base + OFFSET
    while slot <= now:
        slot += INTERVAL
    return slot


def main() -> None:
    start = now_npt()
    if start.weekday() >= 5:
        print(f"{start:%A}: NEPSE does not trade on weekends. Nothing to do.")
        return
    if start.time() >= time(15, 0):
        # Includes backup runs that waited in the queue behind the day's main run.
        print(f"{start:%H:%M} is after the session. Nothing to do.")
        return

    db = Supabase()
    nepse = NepseSource()
    session = Session(db, nepse)

    while True:
        slot = next_slot(now_npt())
        clock.sleep(max(0.0, (slot - now_npt()).total_seconds()))
        at = now_npt()
        if at.time() >= STOP_AFTER:
            break
        try:
            is_open = session.snapshot(at)
            session.consecutive_failures = 0
        except JobError as exc:
            session.failures += 1
            session.consecutive_failures += 1
            session.errors.append(f"{at:%H:%M} {exc}"[:300])
            print(f"::warning::{at:%H:%M:%S} snapshot failed: {exc}", flush=True)
            if session.run:
                session.run.update(details=session.details(at))
            if session.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                if session.run:
                    session.run.finish("failed", f"{session.consecutive_failures} snapshots in a row failed; last error: {exc}",
                                       requests=nepse.budget.total, rows_written=session.rows_written)
                raise JobError(f"{session.consecutive_failures} snapshots in a row failed; last error: {exc}")
            continue

        if not is_open:
            if session.seen_open:
                break  # the close: the last snapshot above recorded the final state
            if at.time() >= OPEN_DEADLINE:
                run_log = JobRun(db, "live", trade_date=at.date())
                run_log.finish("skipped", f"NEPSE reported the market closed from {start:%H:%M} to {at:%H:%M}",
                               requests=nepse.budget.total)
                write_summary(f"## Live market\n\nThe market did not open by {OPEN_DEADLINE:%H:%M} Nepal time. Nothing written.\n")
                return
            print(f"{at:%H:%M:%S} market not open yet", flush=True)

    end = now_npt()
    details = session.details(end)
    status = "ok" if session.failures == 0 else "partial"
    message = f"{session.snapshots} snapshots, {session.failures} failed"
    if session.run:
        session.run.finish(status, message, requests=nepse.budget.total, rows_written=session.rows_written, details=details)
    lag = details["data_lag_seconds"]
    write_summary("\n".join([
        "## Live market session",
        "",
        f"- Ran {start:%H:%M} to {end:%H:%M} Nepal time: **{message}**, {nepse.budget.total} NEPSE requests, {session.rows_written} rows written.",
        f"- NEPSE data lag at snapshot time (newest trade timestamp vs our clock): median {lag['median']} s, max {lag['max']} s.",
        f"- Securities NEPSE listed that are not in our companies table: {', '.join(details['unmapped_symbols']) or 'none'}.",
        *([f"- Errors: {'; '.join(details['recent_errors'])}"] if details["recent_errors"] else []),
        "",
    ]))
    if not session.seen_open:
        print("The market never opened during this run.")


if __name__ == "__main__":
    run(main)
