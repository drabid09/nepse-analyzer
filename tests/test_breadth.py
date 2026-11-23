"""Market breadth: ordinary shares only, judged by NEPSE's own day change."""

from common import breadth

SHARES = {1, 2, 3, 4, 5}


def row(company_id, close, prev, ltp=None, change=None, symbol=None):
    return {"company_id": company_id, "symbol": symbol or f"S{company_id}", "close": close, "prev_close": prev,
            "ltp": ltp, "change": change}


def test_only_ordinary_shares_are_counted():
    rows = [row(1, 101, 100, change=1.0), row(2, 99, 100, change=-1.0), row(99, 105, 100, change=5.0)]  # 99: a debenture
    assert breadth(rows, SHARES) == {"advancers": 1, "decliners": 1, "unchanged": 0, "differs": []}


def test_nepse_change_decides_when_the_closing_price_disagrees():
    # Closing price a step above the previous close, last trade equal to it: NEPSE says unchanged.
    rows = [row(3, 420.1, 420.0, ltp=420.0, change=0.0, symbol="XYZ")]
    counts = breadth(rows, SHARES)
    assert (counts["advancers"], counts["unchanged"]) == (0, 1)
    assert counts["differs"] == ["XYZ (close 420.1, last trade 420.0, previous 420.0)"]


def test_without_nepse_change_the_last_trade_then_the_close_is_used():
    rows = [row(4, 249.6, 249.4, ltp=250.0), row(5, 300.0, 300.0)]
    assert breadth(rows, SHARES) == {"advancers": 1, "decliners": 0, "unchanged": 1, "differs": []}


def test_a_row_without_a_previous_close_or_price_is_skipped():
    rows = [row(1, 100, None), row(2, None, 100)]
    assert breadth(rows, SHARES)["advancers"] + breadth(rows, SHARES)["unchanged"] == 0
