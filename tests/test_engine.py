"""The signal rules, trade levels and price ranges, on synthetic prices whose
right answer is obvious (a steady riser, a steady faller, an illiquid stock)."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

import engine

DAYS = 320
UP, DOWN, FLAT, ILLIQUID, THIN = 1, 2, 3, 4, 5
PEERS = [6, 7, 8, 9]


def make_market(seed: int = 7):
    rng = np.random.default_rng(seed)
    index = pd.bdate_range("2025-01-01", periods=DAYS)
    drift = {UP: 0.004, DOWN: -0.004, FLAT: 0.0, ILLIQUID: 0.003, THIN: 0.003, **{p: 0.0 for p in PEERS}}
    close, high, low, volume = {}, {}, {}, {}
    for cid, mu in drift.items():
        steps = mu + rng.normal(0, 0.008, DAYS)
        price = 200 * np.exp(np.cumsum(steps))
        close[cid] = price
        high[cid] = price * (1 + np.abs(rng.normal(0, 0.006, DAYS)))
        low[cid] = price * (1 - np.abs(rng.normal(0, 0.006, DAYS)))
        vol = np.full(DAYS, 20_000.0)
        if cid == THIN:
            vol[:] = 50.0                      # about Rs 10,000 a day: below the turnover floor
        if cid == ILLIQUID:
            vol[-15:] = 0.0                    # no trade for 15 days
        volume[cid] = vol
    frames = [pd.DataFrame(d, index=index) for d in (close, high, low, volume)]
    # A company that did not trade keeps its last price (the market convention).
    frames[0].loc[frames[3][ILLIQUID] == 0, ILLIQUID] = np.nan
    return frames


@pytest.fixture(scope="module")
def market():
    close, high, low, volume = make_market()
    sectors = {cid: "Hydro Power" for cid in close.columns}
    ind = engine.indicators(close, high, low, volume, sectors)
    tr = engine.trends(ind)
    sc = engine.scores(ind, tr)
    ok = engine.eligibility(ind)
    rec = engine.recommendations(sc["score"], tr["short"], ok)
    return {"close": close, "high": high, "low": low, "volume": volume, "sectors": sectors,
            "ind": ind, "trends": tr, "scores": sc, "eligible": ok, "rec": rec}


def test_indicators_use_no_future_data(market):
    """Every indicator on a day must be the same whether or not later days exist,
    or the backtest would be cheating."""
    cut = 250
    frames = [market[k].iloc[:cut] for k in ("close", "high", "low", "volume")]
    early = engine.indicators(*frames, market["sectors"])
    for key, full in market["ind"].items():
        a = full.iloc[:cut].astype(float)
        b = early[key].astype(float)
        assert np.allclose(a.to_numpy(), b.to_numpy(), equal_nan=True), key


def test_rsi_stays_between_0_and_100(market):
    rsi = market["ind"]["rsi14"].to_numpy()
    rsi = rsi[~np.isnan(rsi)]
    assert rsi.min() >= 0 and rsi.max() <= 100


def test_rsi_is_100_when_a_price_only_rises():
    index = pd.bdate_range("2025-01-01", periods=40)
    close = pd.DataFrame({1: np.linspace(100, 140, 40)}, index=index)
    ind = engine.indicators(close, close, close, close * 0 + 1000, {1: None})
    assert ind["rsi14"][1].iloc[-1] == pytest.approx(100)


def test_scores_rank_the_obvious_cases(market):
    last = market["scores"]["score"].iloc[-1]
    assert last.between(0, 100).all()
    assert last[UP] > last[DOWN] + 25
    assert last[UP] >= engine.BUY_AT
    assert last[DOWN] <= engine.SELL_AT


def test_recommendations(market):
    rec = market["rec"].iloc[-1]
    assert rec[UP] == "buy"
    assert rec[DOWN] == "sell"
    assert rec[ILLIQUID] == "avoid"   # last trade 15 days ago
    assert rec[THIN] == "avoid"       # turnover below Rs 5 lakh a day


def test_buy_is_held_back_when_the_short_trend_is_down():
    index = pd.RangeIndex(1)
    score = pd.DataFrame({1: [90.0], 2: [90.0]}, index=index)
    short = pd.DataFrame({1: ["down"], 2: ["up"]}, index=index)
    eligible = pd.DataFrame({1: [True], 2: [True]}, index=index)
    rec = engine.recommendations(score, short, eligible).iloc[0]
    assert rec[1] == "hold" and rec[2] == "buy"


def test_no_call_without_enough_history():
    close, high, low, volume = (f.iloc[: engine.MIN_HISTORY - 1] for f in make_market())
    ind = engine.indicators(close, high, low, volume, {c: None for c in close.columns})
    assert not engine.eligibility(ind).iloc[-1].any()


def test_trade_levels_are_in_order(market):
    lv = {k: v.iloc[-1] for k, v in engine.levels(market["ind"]).items()}
    close, atr = market["ind"]["close"].iloc[-1], market["ind"]["atr14"].iloc[-1]
    for cid in close.index:
        if not market["eligible"].iloc[-1][cid]:
            continue
        assert 0 < lv["stop_loss"][cid] < lv["buy_low"][cid] <= lv["buy_high"][cid] == close[cid]
        assert close[cid] < lv["take_profit_low"][cid] < lv["take_profit_high"][cid]
        # The first target stays within reach: at most 4 ATR above the close.
        assert lv["take_profit_low"][cid] <= close[cid] + 4 * atr[cid] + 1e-9


@pytest.mark.parametrize("horizon", ["1W", "1M", "3M"])
def test_price_range_is_ordered_and_within_the_daily_limit(market, horizon):
    h = engine.HORIZONS[horizon]
    log_close = np.log(market["ind"]["close"][FLAT].to_numpy())
    sma50 = float(market["ind"]["sma50"][FLAT].iloc[-1])
    r = engine.price_range(log_close, sma50, h)
    last = math.exp(log_close[-1])
    assert r["low"] < r["mid"] < r["high"]
    assert r["low"] >= last * (1 - engine.CIRCUIT) ** h - 1e-6
    assert r["high"] <= last * (1 + engine.CIRCUIT) ** h + 1e-6


def test_price_range_widens_with_the_horizon(market):
    log_close = np.log(market["ind"]["close"][FLAT].to_numpy())
    sma50 = float(market["ind"]["sma50"][FLAT].iloc[-1])
    widths = [engine.price_range(log_close, sma50, engine.HORIZONS[k]) for k in ("1W", "1M", "3M")]
    widths = [r["high"] / r["low"] for r in widths]
    assert widths[0] < widths[1] < widths[2]


def test_price_range_needs_history():
    assert engine.price_range(np.log(np.linspace(100, 110, 50)), 105.0, 21) is None


def test_tick_rounds_to_ten_paisa():
    assert engine.tick(123.456) == 123.5
    assert engine.tick(99.94) == 99.9
    assert engine.tick(None) is None
    assert engine.tick(float("nan")) is None


def test_reasons_explain_the_numbers():
    pro, con = engine.reasons({"trend_short": "up", "trend_medium": "down", "trend_long": None, "rsi_14": 75.0,
                               "macd_hist": 0.5, "rel_strength_index": -0.08, "volume_ratio": 1.5, "up_day": True,
                               "volatility_30d": 0.7})
    assert "Rising short-term (20-day) trend" in pro
    assert "Falling medium-term (20 vs 50-day) trend" in con
    assert any("overbought" in r for r in con)
    assert any("Lagged the median NEPSE stock by 8 points" in r for r in con)
    assert any("Very volatile" in r for r in con)
    assert len(pro) <= 5 and len(con) <= 5
