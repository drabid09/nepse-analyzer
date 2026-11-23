#!/usr/bin/env python3
"""Watchdog: are the jobs running and is the data fresh?

Runs hourly on trading afternoons and once a day otherwise. Every check that
fails is listed in the run summary and in job_runs, and the run exits with an
error, which makes GitHub email the repository owner. The website reads the
same job_runs rows for its health badge.

Checks:
  * the database answers (and so stays active on Supabase's free plan, which
    pauses projects after a week of low activity);
  * during the session, the live job has reported in the last 15 minutes;
  * after 16:45 on a weekday, today's end-of-day run finished, or today is a
    recorded holiday;
  * after 17:45, today's analytics run finished;
  * no job failed in the last 26 hours, and no run is stuck;
  * the backtest is less than 8 days old;
  * no market-wide data error is open for the latest trading day;
  * the database is below 400 MB of the free plan's 500 MB;
  * the Supabase timer is starting jobs: its latest hourly check passed and is
    under 3 hours old.
"""

from __future__ import annotations

import sys
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "ingest"))
from common import JobError, JobRun, Supabase, now_npt, run, write_summary  # noqa: E402

LIVE_STALE = timedelta(minutes=15)
STUCK = timedelta(minutes=30)
STORAGE_LIMIT_MB = 400
TIMER_SILENT = timedelta(hours=3)


def parse_ts(text: str | None) -> datetime | None:
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def timer_state(latest: dict | None, utc_now: datetime) -> tuple[bool, str, str] | None:
    """(ok, good text, bad text) for the Supabase timer's latest check, if it has run."""
    if not latest:
        return None
    beat = parse_ts(latest["heartbeat_at"])
    if latest["status"] != "ok":
        return False, "", f"the Supabase timer cannot start jobs: {latest['message'] or 'no detail'}"
    if utc_now - beat > TIMER_SILENT:
        return False, "", f"the Supabase timer has not checked in for {int((utc_now - beat).total_seconds() // 3600)} hours"
    return True, "the Supabase timer is starting jobs", ""


def main() -> None:
    db = Supabase()
    now = now_npt()
    utc_now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    weekday = now.weekday() < 5
    failures: list[str] = []
    passed: list[str] = []

    def check(ok: bool, good: str, bad: str) -> None:
        (passed if ok else failures).append(good if ok else bad)

    recent = db.select_all("job_runs", select="id,job,status,trade_date,started_at,heartbeat_at,message",
                           started_at=f"gte.{(utc_now - timedelta(hours=26)).isoformat()}", order="started_at.desc")
    passed.append(f"database answered ({len(recent)} runs in the last 26 hours)")

    holiday = any(r["job"] == "eod" and r["status"] == "holiday" and r["trade_date"] == today for r in recent)
    live_today = [r for r in recent if r["job"] == "live" and r["trade_date"] == today]
    market_closed_today = holiday or any(r["status"] == "skipped" for r in live_today)

    if weekday and time(11, 15) <= now.time() <= time(14, 55) and not market_closed_today:
        running = [r for r in live_today if r["status"] == "running"]
        beat = max((parse_ts(r["heartbeat_at"]) for r in running), default=None)
        check(beat is not None and utc_now - beat <= LIVE_STALE,
              f"live job reported in at {beat.astimezone(now.tzinfo):%H:%M}" if beat else "live job ok",
              "live job has not reported in the last 15 minutes during trading hours"
              + (f" (last at {beat.astimezone(now.tzinfo):%H:%M})" if beat else " (no run today)"))

    if weekday and now.time() >= time(16, 45):
        eod = [r for r in recent if r["job"] == "eod" and r["trade_date"] == today and r["status"] in ("ok", "partial")]
        check(bool(eod) or holiday, "today's end-of-day run finished" if eod else "today is a recorded holiday",
              "today's end-of-day run has not finished and today is not a recorded holiday")
    if weekday and now.time() >= time(17, 45) and not holiday:
        analytics = [r for r in recent if r["job"] == "analytics" and r["trade_date"] == today and r["status"] in ("ok", "partial")]
        check(bool(analytics), "today's analytics run finished", "today's analytics run has not finished")

    # A failure counts until a later run of the same job succeeds. The watchdog's
    # own failures are not counted, or one bad hour would echo for a day.
    def resolved(failure: dict) -> bool:
        return any(r["job"] == failure["job"] and r["started_at"] > failure["started_at"]
                   and r["status"] in ("ok", "partial", "holiday", "skipped") for r in recent)

    # The timer has its own check below.
    failed = [r for r in recent if r["status"] == "failed" and r["job"] not in ("watchdog", "timer") and not resolved(r)]
    check(not failed, "no unresolved failed runs in the last 26 hours",
          "failed runs: " + "; ".join(f"{r['job']} at {parse_ts(r['started_at']).astimezone(now.tzinfo):%d %b %H:%M}: {(r['message'] or '')[:120]}" for r in failed[:5]))

    stuck = [r for r in recent if r["status"] == "running" and utc_now - parse_ts(r["heartbeat_at"]) > STUCK]
    check(not stuck, "no stuck runs", "runs still marked running with no heartbeat for 30 minutes: "
          + ", ".join(f"{r['job']} #{r['id']}" for r in stuck))

    timer = timer_state(next(iter(db.select("job_runs", select="status,message,heartbeat_at", job="eq.timer",
                                            order="started_at.desc", limit=1)), None), utc_now)
    if timer:
        check(*timer)

    backtests = db.select("job_runs", select="started_at", job="eq.backtest", status="eq.ok", order="started_at.desc", limit=1)
    if backtests:
        age = utc_now - parse_ts(backtests[0]["started_at"])
        check(age <= timedelta(days=8), f"backtest is {age.days} days old", f"backtest is {age.days} days old (weekly run missed)")

    latest = db.select("market_daily", select="date", is_final="eq.true", order="date.desc", limit=1)
    if latest:
        day = latest[0]["date"]
        errors = db.select("quality_issues", select="check_name,detail", trade_date=f"eq.{day}", severity="eq.error",
                           company_id="is.null")
        check(not errors, f"no market-wide data errors for {day}",
              f"market-wide data errors for {day}: " + "; ".join(e["detail"][:150] for e in errors[:3]))

    rows = db.rpc("storage_report")
    total = next((r["total_bytes"] for r in rows if r["name"] == "(database)"), 0) / 1e6
    check(total < STORAGE_LIMIT_MB, f"database {total:.0f} MB of 500 MB", f"database is {total:.0f} MB, close to the free plan's 500 MB")

    status = "ok" if not failures else "failed"
    JobRun(db, "watchdog", trade_date=now.date(), source="database").finish(
        status, "all checks passed" if not failures else "; ".join(failures)[:500],
        details={"failed": failures, "passed": passed})
    write_summary("\n".join(["## Watchdog", "", *[f"- FAILED: {f}" for f in failures], *[f"- ok: {p}" for p in passed], ""]))
    if failures:
        raise JobError(f"{len(failures)} check(s) failed: {failures[0]}")


if __name__ == "__main__":
    run(main)
