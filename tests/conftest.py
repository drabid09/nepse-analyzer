"""Shared test setup. Run with:  pytest tests

The unit tests need no network and no database. tests/test_database.py also
needs a disposable Postgres (PG_ADMIN_DSN); it is skipped without one.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts/ingest"))
sys.path.insert(0, str(REPO / "scripts/analytics"))


class FakeDB:
    """Stands in for common.Supabase: canned rows per table or function.

    tables:    {"daily_prices": [...rows...]}  returned by select/select_all, filtered
               by simple eq.<value> filters on the given columns
    functions: {"trading_days": [...rows...]}  returned by rpc
    """

    def __init__(self, tables: dict | None = None, functions: dict | None = None):
        self.tables = tables or {}
        self.functions = functions or {}
        self.calls: list[tuple] = []

    def _rows(self, table: str, params: dict) -> list[dict]:
        rows = self.tables.get(table, [])
        for key, value in params.items():
            if key in ("select", "order", "limit", "offset") or not isinstance(value, str):
                continue
            op, _, expected = value.partition(".")
            if op != "eq":
                continue
            rows = [r for r in rows if key not in r or str(r[key]).lower() == expected.lower()]
        if "limit" in params:
            rows = rows[: int(params["limit"])]
        return rows

    def select(self, table: str, **params) -> list[dict]:
        self.calls.append(("select", table, params))
        return self._rows(table, params)

    def select_all(self, table: str, page: int = 1000, **params) -> list[dict]:
        self.calls.append(("select_all", table, params))
        return self._rows(table, params)

    def rpc(self, function: str, args: dict | None = None, *, page: int = 1000):
        self.calls.append(("rpc", function, args))
        return self.functions.get(function, [])
