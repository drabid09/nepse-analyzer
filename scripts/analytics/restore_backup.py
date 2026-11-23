#!/usr/bin/env python3
"""Restore a backup made by backup.py into the database in SUPABASE_URL.

    python scripts/analytics/restore_backup.py path/to/backup-folder --yes

Writes with the service key (SUPABASE_URL and SUPABASE_SERVICE_KEY in the
environment). Existing rows with the same key are updated, so running it twice
is safe. Afterwards it re-applies every confirmed bonus and right-share
adjustment. The full disaster-recovery order is in docs/phase5-quality.md.
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "ingest"))
from common import JobError, Supabase  # noqa: E402


def read_rows(folder: Path, name: str) -> list[dict]:
    with gzip.open(folder / name, "rt", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def restore(db: Supabase, folder: Path) -> dict[str, int]:
    manifest = json.loads((folder / "manifest.json").read_text())
    # Read and check every file before writing anything, so a damaged backup restores nothing.
    tables = []
    for entry in manifest["tables"]:
        rows = read_rows(folder, entry["file"])
        if len(rows) != entry["rows"]:
            raise JobError(f"{entry['file']} has {len(rows)} rows, the manifest says {entry['rows']}: the backup is damaged")
        tables.append((entry, rows))
    restored: dict[str, int] = {}
    for entry, rows in tables:
        if entry["key"] is None:
            print(f"{entry['table']}: kept in the backup for reference, not restored", flush=True)
            continue
        if "id" not in entry["key"].split(","):
            rows = [{k: v for k, v in r.items() if k != "id"} for r in rows]  # the database assigns its own ids
        if rows:
            db.upsert(entry["table"], rows, on_conflict=entry["key"], batch=500)
        restored[entry["table"]] = len(rows)
        print(f"{entry['table']}: {len(rows):,} rows", flush=True)
    confirmed = {r["company_id"] for r in read_rows(folder, "price_adjustments.jsonl.gz") if r["status"] == "confirmed"}
    for company_id in sorted(confirmed):
        db.rpc("apply_price_adjustments", {"p_company_id": company_id})
    restored["companies_readjusted"] = len(confirmed)
    return restored


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1 or "--yes" not in sys.argv:
        raise JobError("usage: restore_backup.py <backup folder> --yes   (writes to the database in SUPABASE_URL)")
    print(restore(Supabase(), Path(args[0])))


if __name__ == "__main__":
    try:
        main()
    except JobError as exc:
        print(f"Restore failed: {exc}")
        sys.exit(1)
