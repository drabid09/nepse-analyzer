#!/usr/bin/env python3
"""Refresh company details a few companies at a time.

NEPSE's company detail call gives ISIN, listing date, face value, listed
shares, paid-up capital, market capitalisation and the promoter/public split,
one company per request. Asking for all ~540 tradable companies at once would
be a burst far above the load planned in Phase 0, so each run refreshes the
BATCH companies checked longest ago (never-checked first), with a pause
between requests. Run daily after the close, every company is refreshed about
once a week.

Only columns this job knows about are touched.
"""

from __future__ import annotations

import os
import sys
import time as clock
from datetime import datetime, time, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import JobError, JobRun, NepseSource, Supabase, now_npt, num, run, whole, write_summary  # noqa: E402

BATCH = int(os.environ.get("DETAILS_BATCH", "110"))
PAUSE = 3.0
QUIET_FROM, QUIET_UNTIL = time(10, 15), time(15, 15)   # not during the session


def pct(value) -> float | None:
    result = num(value, 4)
    return result if result is not None and 0 <= result <= 100 else None


def main() -> None:
    now = now_npt()
    if now.weekday() < 5 and QUIET_FROM <= now.time() < QUIET_UNTIL:
        print(f"{now:%H:%M} is during the trading session. Company details run after {QUIET_UNTIL:%H:%M}.")
        return
    db = Supabase()
    due = db.select("companies", select="id,symbol,name", is_tradable="eq.true",
                    order="details_checked_at.asc.nullsfirst,id.asc", limit=BATCH)
    if not due:
        print("No tradable companies.")
        return
    run_log = JobRun(db, "details")
    nepse = NepseSource()
    rows, failed, odd = [], [], []
    retry_later: list[dict] = []  # failures go to the back of the queue too, so the rotation moves on
    try:
        for company in due:
            clock.sleep(PAUSE)
            checked = datetime.now(timezone.utc).isoformat()
            try:
                detail = nepse.call("getCompanyDetails", company["symbol"])
            except JobError as exc:
                failed.append(company["symbol"])
                retry_later.append({"symbol": company["symbol"], "name": company["name"], "details_checked_at": checked})
                print(f"::warning::{company['symbol']}: {exc}", flush=True)
                if len(failed) >= 8 and len(failed) > len(rows):
                    raise JobError(f"company details failing for most companies ({len(failed)} so far); stopped") from exc
                continue
            security = detail.get("security") if isinstance(detail, dict) else None
            if not isinstance(security, dict):
                odd.append(company["symbol"])
                continue
            listing = str(security.get("listingDate") or "")[:10] or None
            rows.append({
                "symbol": company["symbol"], "name": company["name"],
                "isin": security.get("isin") or None,
                "listing_date": listing if listing and len(listing) == 10 else None,
                "face_value": num(security.get("faceValue")),
                "listed_shares": whole(detail.get("stockListedShares")),
                "paid_up_capital": num(detail.get("paidUpCapital")),
                "market_cap": num(detail.get("marketCapitalization")),
                "promoter_pct": pct(detail.get("promoterPercentage")),
                "public_pct": pct(detail.get("publicPercentage")),
                "details_checked_at": checked,
            })
        if rows:
            db.upsert("companies", rows, on_conflict="symbol")
        if retry_later:
            db.upsert("companies", retry_later, on_conflict="symbol")
    except JobError as exc:
        run_log.finish("failed", str(exc), requests=nepse.budget.total, rows_written=len(rows))
        raise

    status = "ok" if not failed and not odd else "partial"
    run_log.finish(status, f"{len(rows)} of {len(due)} companies refreshed", requests=nepse.budget.total,
                   rows_written=len(rows), details={"failed": failed[:20], "unexpected_shape": odd[:20]})
    write_summary("\n".join([
        "## Company details",
        "",
        f"- Refreshed **{len(rows)} of {len(due)}** tradable companies (those checked longest ago), {nepse.budget.total} NEPSE requests.",
        f"- Failed: {', '.join(failed) or 'none'}. Unexpected answer: {', '.join(odd) or 'none'}.",
        "",
    ]))


if __name__ == "__main__":
    run(main)
