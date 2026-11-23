"""Backup and restore: what goes out must come back the same, and a damaged
backup must be refused rather than half-restored."""

from __future__ import annotations

import gzip
import json

import pytest

import backup
import restore_backup
from common import JobError


class MemoryDB:
    """A tiny in-memory stand-in: select_all (with neq filters), upsert by key, rpc."""

    def __init__(self, tables=None):
        self.tables = {name: list(rows) for name, rows in (tables or {}).items()}
        self.rpcs = []

    def select_all(self, table, page=1000, **params):
        rows = self.tables.get(table, [])
        for col, expr in params.items():
            if col in ("select", "order"):
                continue
            op, _, value = expr.partition(".")
            if op == "neq":
                rows = [r for r in rows if str(r.get(col)) != value]
        return rows

    def upsert(self, table, rows, on_conflict, *, ignore_duplicates=False, batch=500):
        keys = on_conflict.split(",")
        store = {tuple(r.get(k) for k in keys): r for r in self.tables.get(table, [])}
        for r in rows:
            store[tuple(r.get(k) for k in keys)] = r
        self.tables[table] = list(store.values())
        return len(rows)

    def rpc(self, function, args=None, *, page=1000):
        self.rpcs.append((function, args))


SOURCE = {
    "companies": [{"id": 1, "symbol": "AAA"}, {"id": 2, "symbol": "BBB"}],
    "price_adjustments": [{"company_id": 1, "ex_date": "2026-01-07", "factor": 0.5, "status": "confirmed"},
                          {"company_id": 2, "ex_date": "2026-02-01", "factor": 1.2, "status": "unconfirmed"}],
    "daily_prices": [{"company_id": 1, "date": "2026-11-20", "close": 100, "source": "nepse"},
                     {"company_id": 1, "date": "2015-01-01", "close": 50, "source": "csv"}],
    "quality_issues": [{"id": 7, "trade_date": "2026-11-20", "company_id": None, "check_name": "x", "severity": "info", "detail": "d"}],
    "job_runs": [{"id": 3, "job": "eod", "status": "ok"}],
}


def test_round_trip(tmp_path):
    manifest = backup.backup(MemoryDB(SOURCE), tmp_path)
    counts = {t["table"]: t["rows"] for t in manifest["tables"]}
    assert counts["daily_prices"] == 1          # the CSV history is rebuilt by the history import instead
    assert counts["job_runs"] == 1

    target = MemoryDB()
    restored = restore_backup.restore(target, tmp_path)
    assert target.tables["companies"] == SOURCE["companies"]
    assert target.tables["daily_prices"] == SOURCE["daily_prices"][:1]
    assert "id" not in target.tables["quality_issues"][0]   # the database assigns its own id
    assert "job_runs" not in target.tables                  # kept for reference only
    assert target.rpcs == [("apply_price_adjustments", {"p_company_id": 1})]  # confirmed adjustments only
    assert restored["companies_readjusted"] == 1


def test_restoring_twice_changes_nothing(tmp_path):
    backup.backup(MemoryDB(SOURCE), tmp_path)
    target = MemoryDB()
    restore_backup.restore(target, tmp_path)
    first = json.dumps(target.tables, sort_keys=True)
    restore_backup.restore(target, tmp_path)
    assert json.dumps(target.tables, sort_keys=True) == first


def test_a_damaged_backup_is_refused(tmp_path):
    backup.backup(MemoryDB(SOURCE), tmp_path)
    with gzip.open(tmp_path / "companies.jsonl.gz", "wt") as handle:
        handle.write(json.dumps(SOURCE["companies"][0]) + "\n")   # one row lost
    target = MemoryDB()
    with pytest.raises(JobError, match="damaged"):
        restore_backup.restore(target, tmp_path)
    assert target.tables == {}  # nothing at all was written


def test_every_table_with_a_generated_id_restores_on_a_natural_key():
    for table, _, restore_key, _ in backup.TABLES:
        if restore_key is not None and table in ("quality_issues", "issues", "corporate_actions"):
            assert "id" not in restore_key.split(",")
