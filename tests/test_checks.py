"""The daily data checks that run before any call is made: a doubtful day must
be caught and written down, never silently used."""

from __future__ import annotations

from datetime import date, datetime

import pytest

import daily_analytics as da
import sharesansar
from common import NPT
from conftest import FakeDB

DAY = date(2026, 11, 20)  # a Friday
COMPANIES = [{"id": i, "symbol": f"S{i}"} for i in range(1, 21)]


def price(cid, close, prev=None, open_=None, high=None, low=None):
    prev = close if prev is None else prev
    return {"company_id": cid, "date": DAY.isoformat(), "is_final": True, "source": "nepse",
            "open": open_ if open_ is not None else close, "high": high if high is not None else close * 1.01,
            "low": low if low is not None else close * 0.99, "close": close, "prev_close": prev, "volume": 1000}


def fake_db(rows, reported=None, eod_status="ok", pending=()):
    return FakeDB(tables={
        "market_daily": [{"date": DAY.isoformat(), "scrips_traded": len(rows) if reported is None else reported, "is_final": True}],
        "daily_prices": rows,
        "job_runs": [{"job": "eod", "trade_date": DAY.isoformat(), "status": eod_status, "message": "test"}],
        "price_adjustments": list(pending),
    })


@pytest.fixture(autouse=True)
def sharesansar_agrees(monkeypatch):
    """By default the independent source agrees with whatever we stored."""
    state = {"rows": []}
    monkeypatch.setattr(sharesansar, "fetch_today", lambda: (DAY, state["rows"]))
    return state


def run(rows, sharesansar_rows=None, state=None, **kw):
    if state is not None:
        sym = {c["id"]: c["symbol"] for c in COMPANIES}
        state["rows"] = sharesansar_rows if sharesansar_rows is not None else [{"symbol": sym[r["company_id"]], "close": r["close"]} for r in rows]
    issues = da.Issues(DAY)
    facts = da.check_data(fake_db(rows, **kw), DAY, COMPANIES, issues)
    return issues, facts


def by_check(issues, name):
    return [r for r in issues.rows if r["check_name"] == name]


def test_a_clean_day_has_no_warnings(sharesansar_agrees):
    issues, facts = run([price(i, 100 + i) for i in range(1, 21)], state=sharesansar_agrees)
    assert [r for r in issues.rows if r["severity"] != "info"] == []
    assert facts["cross_source"]["checked"] == 20


def test_a_move_beyond_the_daily_limit_is_an_error(sharesansar_agrees):
    rows = [price(i, 100) for i in range(1, 21)]
    rows[0] = price(1, 112, prev=100, high=112)  # +12% is impossible on NEPSE
    issues, _ = run(rows, state=sharesansar_agrees)
    hits = by_check(issues, "circuit_limit")
    assert len(hits) == 1 and hits[0]["severity"] == "error" and hits[0]["company_id"] == 1
    assert 1 in issues.by_company  # so this company gets no call today


def test_a_ten_percent_move_with_tick_rounding_is_allowed(sharesansar_agrees):
    rows = [price(i, 100) for i in range(1, 21)]
    rows[0] = price(1, 110.4, prev=100.4, high=110.4)  # +9.96%
    issues, _ = run(rows, state=sharesansar_agrees)
    assert by_check(issues, "circuit_limit") == []


def test_open_or_close_outside_the_high_low_range_is_an_error(sharesansar_agrees):
    rows = [price(i, 100) for i in range(1, 21)]
    rows[4] = price(5, 100, high=99, low=95)
    issues, _ = run(rows, state=sharesansar_agrees)
    assert [r["company_id"] for r in by_check(issues, "ohlc_order")] == [5]


def test_missing_rows_against_nepse_count_are_flagged(sharesansar_agrees):
    issues, _ = run([price(i, 100) for i in range(1, 16)], reported=20, state=sharesansar_agrees)
    assert by_check(issues, "row_count")[0]["severity"] == "warning"


def test_a_failed_end_of_day_run_is_flagged(sharesansar_agrees):
    issues, _ = run([price(i, 100) for i in range(1, 21)], eod_status="partial", state=sharesansar_agrees)
    assert by_check(issues, "eod_status")


def test_unreviewed_adjustment_holds_the_company(sharesansar_agrees):
    pending = [{"company_id": 3, "ex_date": DAY.isoformat(), "status": "unconfirmed", "factor": 1.25, "note": "factor above 1"}]
    issues, _ = run([price(i, 100) for i in range(1, 21)], pending=pending, state=sharesansar_agrees)
    assert 3 in issues.by_company


def test_one_close_differing_from_sharesansar_is_a_company_warning(sharesansar_agrees):
    rows = [price(i, 100) for i in range(1, 21)]
    theirs = [{"symbol": f"S{i}", "close": 100.0} for i in range(1, 21)]
    theirs[6]["close"] = 101.0
    issues, facts = run(rows, theirs, state=sharesansar_agrees)
    hits = by_check(issues, "cross_source")
    assert [(h["severity"], h["company_id"]) for h in hits] == [("warning", 7)]
    assert issues.market_errors() == []
    assert facts["cross_source"]["mismatched"] == 1


def test_many_closes_differing_from_sharesansar_stop_the_day(sharesansar_agrees):
    rows = [price(i, 100) for i in range(1, 21)]
    theirs = [{"symbol": f"S{i}", "close": 100.0 if i > 5 else 105.0} for i in range(1, 21)]
    issues, _ = run(rows, theirs, state=sharesansar_agrees)
    assert len(issues.market_errors()) == 1  # the website then shows no new calls


def test_sharesansar_for_another_day_is_not_compared(monkeypatch):
    monkeypatch.setattr(sharesansar, "fetch_today", lambda: (date(2026, 11, 19), [{"symbol": "S1", "close": 1.0}]))
    issues, facts = run([price(i, 100) for i in range(1, 21)])
    assert facts["cross_source"]["checked"] == 0
    assert all(r["severity"] == "info" for r in by_check(issues, "cross_source"))


def test_sharesansar_down_does_not_block_the_day(monkeypatch):
    def down():
        raise RuntimeError("timeout")
    monkeypatch.setattr(sharesansar, "fetch_today", down)
    issues, facts = run([price(i, 100) for i in range(1, 21)])
    assert issues.market_errors() == []
    assert facts["cross_source"]["checked"] == 0


@pytest.mark.parametrize("now, holiday, stale", [
    (datetime(2026, 11, 23, 17, 0, tzinfo=NPT), False, True),    # Monday evening, Friday is the latest final day
    (datetime(2026, 11, 23, 17, 0, tzinfo=NPT), True, False),    # ... unless Monday was a holiday
    (datetime(2026, 11, 23, 15, 30, tzinfo=NPT), False, False),  # before 16:30: not yet expected
    (datetime(2026, 11, 22, 17, 0, tzinfo=NPT), False, False),   # Sunday: no trading
])
def test_missing_end_of_day_is_noticed(monkeypatch, now, holiday, stale):
    monkeypatch.setattr(da, "now_npt", lambda: now)
    runs = [{"job": "eod", "status": "holiday", "trade_date": now.date().isoformat(), "id": 1}] if holiday else []
    issues = da.Issues(DAY)
    da.check_freshness(FakeDB(tables={"job_runs": runs}), DAY, issues)
    assert bool(issues.market_errors()) is stale
