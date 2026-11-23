"""Bonus and right-share adjustments: a real event must be applied, and a missed
day or a glitch in the source must never pass as one."""

from __future__ import annotations

from datetime import date

import backfill_history as bf
import eod_market as eod
from conftest import FakeDB

MON, FRI, THU = date(2026, 11, 23), date(2026, 11, 20), date(2026, 11, 19)


def db_with(last_close_day=FRI, known_days=("2026-11-19", "2026-11-20"), holidays=()):
    return FakeDB(
        tables={"job_runs": [{"trade_date": d, "status": "holiday"} for d in holidays]},
        functions={
            "latest_closes_before": [{"company_id": 1, "date": last_close_day.isoformat(), "close": 110.0}],
            "trading_days": [{"date": d} for d in known_days],
        },
    )


def test_a_ten_percent_bonus_is_confirmed():
    events = eod.detect_adjustments(db_with(), [{"company_id": 1, "prev_close": 100.0}], MON)
    assert len(events) == 1
    e = events[0]
    assert e["status"] == "confirmed"
    assert e["factor"] == round(100 / 110, 6)
    assert e["prev_date"] == FRI.isoformat()


def test_a_small_difference_is_not_an_event():
    assert eod.detect_adjustments(db_with(), [{"company_id": 1, "prev_close": 109.5}], MON) == []


def test_a_missed_trading_day_is_not_taken_for_a_bonus():
    # Our last close is Thursday's; Friday is not in our data and was not a holiday.
    db = db_with(last_close_day=THU, known_days=("2026-11-19",))
    e = eod.detect_adjustments(db, [{"company_id": 1, "prev_close": 100.0}], MON)[0]
    assert e["status"] == "unconfirmed"
    assert "2026-11-20" in e["note"]


def test_a_recorded_holiday_is_not_a_missed_day():
    db = db_with(last_close_day=THU, known_days=("2026-11-19",), holidays=("2026-11-20",))
    e = eod.detect_adjustments(db, [{"company_id": 1, "prev_close": 100.0}], MON)[0]
    assert e["status"] == "confirmed"


def test_a_factor_above_one_is_held_for_review():
    e = eod.detect_adjustments(db_with(), [{"company_id": 1, "prev_close": 130.0}], MON)[0]
    assert e["status"] == "unconfirmed"


def row(day, close, pct=None, raw_open=None):
    return {"date": day, "close": close, "pct": pct, "raw_open": raw_open}


def test_csv_previous_close_comes_from_open_before_march_2018_and_from_change_after():
    assert bf.implied_prev(row("2017-05-01", 120.0, raw_open=100.0)) == 100.0
    assert bf.implied_prev(row("2020-05-01", 110.0, pct=10.0)) == 100.0
    assert bf.implied_prev(row("2020-05-01", 110.0, pct=None)) is None


def test_csv_bonus_is_confirmed():
    rows = [row("2020-01-01", 200.0, pct=0.0), row("2020-01-02", 100.0, pct=0.0)]  # 1:1 bonus: previous close halves
    events = bf.csv_events(1, rows)
    assert [(e["status"], e["factor"]) for e in events] == [("confirmed", 0.5)]


def test_csv_jump_that_reverses_the_next_day_is_a_glitch():
    rows = [row("2020-01-01", 200.0, pct=0.0), row("2020-01-02", 100.0, pct=0.0), row("2020-01-03", 200.0, pct=0.0)]
    events = bf.csv_events(1, rows)
    assert len(events) == 2 and all(e["status"] == "unconfirmed" for e in events)


def test_many_companies_on_one_day_near_one_is_a_source_artefact():
    events = [{"ex_date": "2026-10-06", "factor": f, "status": "confirmed", "note": None}
              for f in (0.98, 0.99, 1.01, 1.02, 0.97, 0.995, 1.005)]
    events.append({"ex_date": "2026-01-05", "factor": 0.8, "status": "confirmed", "note": None})
    assert bf.demote_mass_days(events) == 7
    assert events[-1]["status"] == "confirmed"  # a lone real bonus on another day is untouched


# ---------------------------------------------------------------- index previous close

from common import settle_index_prev_close  # noqa: E402


def test_rolled_over_previous_close_is_replaced_by_the_stored_close():
    # 23 Nov 2026: NEPSE reported previousClose == close after the close (0.00%).
    rows = [{"index_id": 58, "close": 2623.56, "prev_close": 2623.56}]
    settle_index_prev_close(rows, {58: 2621.29})
    assert rows[0]["prev_close"] == 2621.29


def test_missing_previous_close_is_filled_from_the_stored_close():
    rows = [{"index_id": 51, "close": 1596.27, "prev_close": None}]
    settle_index_prev_close(rows, {51: 1586.0})
    assert rows[0]["prev_close"] == 1586.0


def test_a_reported_previous_close_that_differs_is_trusted():
    rows = [{"index_id": 51, "close": 1596.27, "prev_close": 1586.00}]
    settle_index_prev_close(rows, {51: 1500.0})
    assert rows[0]["prev_close"] == 1586.00


def test_without_a_stored_close_nothing_changes():
    rows = [{"index_id": 58, "close": 2623.56, "prev_close": 2623.56}]
    settle_index_prev_close(rows, {})
    assert rows[0]["prev_close"] == 2623.56
