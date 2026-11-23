#!/usr/bin/env python3
"""Seed and refresh the companies table from NEPSE.

Reads two lists from NEPSE:
  * the company list (name, sector, instrument type, status), and
  * the active security list (what can actually be traded today),
and upserts them into Supabase by symbol. Nothing here is typed in by hand.

Safe to re-run at any time. It only touches the columns it knows about, so
details filled in by other jobs (ISIN, listing date, market cap) are left alone.
"""

from __future__ import annotations

import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import JobError, NepseSource, Supabase, run  # noqa: E402


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def clean(value) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def build_rows(companies: list[dict], securities: list[dict], sector_ids: dict[str, int]) -> list[dict]:
    """Merge the two NEPSE lists into one row per symbol."""
    security_by_symbol = {clean(s.get("symbol")): s for s in securities if clean(s.get("symbol"))}
    rows: dict[str, dict] = {}

    for company in companies:
        symbol = clean(company.get("symbol"))
        if not symbol:
            continue
        symbol = symbol.upper()
        # NEPSE can list a symbol twice (for example after a merger). Keep the active entry.
        if symbol in rows and clean(company.get("status")) != "A":
            continue
        security = security_by_symbol.get(symbol)
        rows[symbol] = {
            "symbol": symbol,
            "name": clean(company.get("companyName")) or clean(company.get("securityName")) or symbol,
            "sector_id": sector_ids.get(clean(company.get("sectorName")) or ""),
            "instrument_type": clean(company.get("instrumentType")),
            "status": clean(company.get("status")),
            "is_tradable": bool(security and clean(security.get("activeStatus")) == "A"),
            "nepse_company_id": company.get("id"),
            "nepse_security_id": security.get("id") if security else None,
            "regulator": clean(company.get("regulatoryBody")),
            "website": clean(company.get("website")),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    # Tradable securities that NEPSE's company list leaves out (promoter shares
    # and similar). They need a row so their prices have somewhere to go.
    for symbol, security in security_by_symbol.items():
        symbol = symbol.upper()
        if symbol in rows:
            continue
        rows[symbol] = {
            "symbol": symbol,
            "name": clean(security.get("securityName")) or symbol,
            "sector_id": None,
            "instrument_type": None,
            "status": clean(security.get("activeStatus")),
            "is_tradable": clean(security.get("activeStatus")) == "A",
            "nepse_company_id": None,
            "nepse_security_id": security.get("id"),
            "regulator": None,
            "website": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    return list(rows.values())


def main() -> None:
    db = Supabase()
    nepse = NepseSource()

    companies = nepse.call("getCompanyList")
    securities = nepse.call("getSecurityList")
    if not (isinstance(companies, list) and isinstance(securities, list)):
        raise JobError("NEPSE returned an unexpected shape for the company or security list")
    # Guard against writing a truncated answer over a good table.
    if len(companies) < 200 or len(securities) < 200:
        raise JobError(f"NEPSE returned suspiciously few rows ({len(companies)} companies, {len(securities)} securities); nothing written")

    # Add any sector NEPSE uses that we have not seen before.
    known = {s["name"] for s in db.select("sectors", select="name")}
    new_sectors = sorted({clean(c.get("sectorName")) for c in companies} - known - {None})
    if new_sectors:
        db.upsert("sectors", [{"name": n, "slug": slugify(n)} for n in new_sectors], on_conflict="name", ignore_duplicates=True)
    sector_ids = {s["name"]: s["id"] for s in db.select("sectors", select="id,name")}

    rows = build_rows(companies, securities, sector_ids)
    db.upsert("companies", rows, on_conflict="symbol")

    # Report what is in the database now, read back from the database itself.
    total = db.count("companies")
    tradable = db.count("companies", is_tradable="eq.true")
    names = {v: k for k, v in sector_ids.items()}
    by_sector = Counter(names.get(r["sector_id"], "(not in NEPSE's company list)") for r in rows if r["is_tradable"])
    lines = [
        "## Company sync",
        "",
        f"- NEPSE returned {len(companies)} companies and {len(securities)} active securities ({nepse.budget.total} requests).",
        f"- Rows written this run: {len(rows)}. New sectors added: {', '.join(new_sectors) or 'none'}.",
        f"- In the database now: **{total} companies, {tradable} tradable**.",
        "",
        "| Sector | Tradable securities |",
        "|---|---|",
        *[f"| {sector} | {count} |" for sector, count in sorted(by_sector.items())],
        "",
    ]
    report = "\n".join(lines)
    print(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write(report)


if __name__ == "__main__":
    run(main)
