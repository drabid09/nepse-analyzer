"""Company details: never-checked ordinary shares come first, the batch is capped."""

import importlib

import company_details


class Companies:
    """Answers the two reads due_companies makes, the way PostgREST would."""

    def __init__(self, rows):
        self.rows = rows

    def select(self, table, **params):
        rows = [r for r in self.rows if r["is_tradable"]]
        if params.get("instrument_type") == "eq.Equity":
            rows = [r for r in rows if r["type"] == "Equity"]
        if params.get("details_checked_at") == "is.null":
            rows = sorted((r for r in rows if r["checked"] is None), key=lambda r: r["id"])
        else:
            rows = sorted(rows, key=lambda r: (r["checked"] is not None, r["checked"] or "", r["id"]))
        return [{"id": r["id"], "symbol": r["symbol"], "name": r["symbol"]} for r in rows][: params["limit"]]


ROWS = [
    {"id": 1, "symbol": "NBF2", "type": "Mutual Fund", "is_tradable": True, "checked": None},
    {"id": 2, "symbol": "MCHL", "type": "Equity", "is_tradable": True, "checked": None},
    {"id": 3, "symbol": "NABIL", "type": "Equity", "is_tradable": True, "checked": "2026-11-22T11:00:00Z"},
    {"id": 4, "symbol": "GBD80/81", "type": "Non-Convertible Debentures", "is_tradable": True, "checked": None},
    {"id": 5, "symbol": "SHL", "type": "Equity", "is_tradable": True, "checked": None},
    {"id": 6, "symbol": "OLD", "type": "Equity", "is_tradable": False, "checked": None},
]


def test_never_checked_shares_come_before_funds_and_debentures():
    due = company_details.due_companies(Companies(ROWS), 4)
    assert [c["symbol"] for c in due] == ["MCHL", "SHL", "NBF2", "GBD80/81"]


def test_then_the_rest_by_oldest_check_without_repeats():
    due = company_details.due_companies(Companies(ROWS), 10)
    assert [c["symbol"] for c in due] == ["MCHL", "SHL", "NBF2", "GBD80/81", "NABIL"]


def test_batch_size_from_the_environment_is_capped(monkeypatch):
    for value, expected in [("110", 110), ("5000", 600), ("0", 1), ("", 110)]:
        monkeypatch.setenv("DETAILS_BATCH", value)
        assert importlib.reload(company_details).BATCH == expected
    monkeypatch.delenv("DETAILS_BATCH")
    assert importlib.reload(company_details).BATCH == 110
