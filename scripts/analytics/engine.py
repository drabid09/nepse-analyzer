"""Indicators, signal rules, trade levels and price-range models.

Everything here works on prices adjusted for bonus and right shares
(close * adj_factor), so a bonus never looks like a crash. The same functions
serve the daily job (which uses the last row) and the backtest (which uses
every row), so the rules the website shows are exactly the rules that were
measured.

All inputs are "wide" tables: one row per trading day, one column per company.
A company that did not trade on a day keeps its last price (the market
convention) and has zero volume that day.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

TRADING_DAYS = 240            # NEPSE trades Monday to Friday, about 240 days a year
HORIZONS = {"1W": 5, "1M": 21, "3M": 63}
BAND = 0.80                   # forecasts are 80% ranges: 1 in 5 outcomes should fall outside
CIRCUIT = 0.10                # NEPSE's daily price limit for listed shares

MIN_HISTORY = 120             # trading days of history before a company gets a signal
MAX_DAYS_SINCE_TRADE = 10     # older last trade: too illiquid for a call
MIN_TURNOVER = 500_000        # Rs, 20-day average daily turnover
MAX_VOLATILITY = 1.0          # annualised; above this a call is not meaningful

WEIGHTS = {"trend": 0.30, "momentum": 0.20, "relative": 0.20, "rsi": 0.15, "volume": 0.15}
BUY_AT, SELL_AT = 65, 35


# ---------------------------------------------------------------- indicators


def indicators(close: pd.DataFrame, high: pd.DataFrame, low: pd.DataFrame, volume: pd.DataFrame,
               sector_of: dict[int, str | None]) -> dict[str, pd.DataFrame]:
    """Every indicator the signal uses, for every company and day. Causal: the
    value on a day uses only that day and earlier."""
    c = close.ffill()
    traded = volume.fillna(0) > 0
    v = volume.fillna(0)
    h = high.where(traded).fillna(c)
    lo = low.where(traded).fillna(c)

    out: dict[str, pd.DataFrame] = {"close": c}
    out["history"] = c.notna().cumsum()
    out["sma20"] = c.rolling(20, min_periods=20).mean()
    out["sma50"] = c.rolling(50, min_periods=50).mean()
    long_window = c.rolling(200, min_periods=120).mean()
    out["sma_long"] = long_window

    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    out["macd_hist"] = macd - macd.ewm(span=9, adjust=False).mean()

    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    out["rsi14"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    out["rsi14"] = out["rsi14"].where(loss != 0, 100.0).where(c.notna())

    prev = c.shift()
    tr = np.fmax(np.fmax(h - lo, (h - prev).abs()), (lo - prev).abs())
    out["atr14"] = tr.ewm(alpha=1 / 14, adjust=False).mean()

    logret = np.log(c / prev)
    out["vol30"] = logret.rolling(30, min_periods=20).std() * math.sqrt(TRADING_DAYS)
    out["ret20"] = c / c.shift(20) - 1
    out["ret60"] = c / c.shift(60) - 1
    avg_volume = v.rolling(20, min_periods=10).mean()
    out["volume_ratio"] = v / avg_volume.replace(0, np.nan)
    out["turnover20"] = (c * v).rolling(20, min_periods=10).mean()
    out["up_day"] = delta > 0

    # Days since the company last traded (0 = traded on this day)
    last_trade_pos = pd.DataFrame(np.where(traded, np.arange(len(c))[:, None], np.nan), index=c.index, columns=c.columns).ffill()
    out["days_since_trade"] = np.arange(len(c))[:, None] - last_trade_pos

    out["support"] = lo.rolling(20, min_periods=10).min()
    out["resistance"] = h.rolling(60, min_periods=20).max()

    # Relative strength: 60-day return against the median of all companies, and of sector peers.
    ret60 = out["ret60"]
    market = ret60.median(axis=1)
    out["rel_index"] = ret60.sub(market, axis=0)
    sectors = pd.Series({cid: sector_of.get(cid) for cid in ret60.columns})
    rel_sector = pd.DataFrame(np.nan, index=ret60.index, columns=ret60.columns)
    for sector, members in sectors.groupby(sectors):
        cols = list(members.index)
        if len(cols) >= 3:
            rel_sector[cols] = ret60[cols].sub(ret60[cols].median(axis=1), axis=0)
    out["rel_sector"] = rel_sector
    out["rel_rank"] = ret60.rank(axis=1, pct=True)
    return out


# ---------------------------------------------------------------- signal


def trends(ind: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    c = ind["close"]

    def classify(price, average, slope_days):
        slope = average - average.shift(slope_days)
        up = (price > average) & (slope > 0)
        down = (price < average) & (slope < 0)
        out = pd.DataFrame(np.where(up, "up", np.where(down, "down", "sideways")), index=c.index, columns=c.columns)
        return out.where(average.notna())

    return {
        "short": classify(c, ind["sma20"], 5),
        "medium": classify(ind["sma20"], ind["sma50"], 10),
        "long": classify(c, ind["sma_long"], 20),
    }


def scores(ind: dict[str, pd.DataFrame], tr: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """The 0-100 score and its five parts, each 0..1."""
    def points(t: pd.DataFrame) -> pd.DataFrame:
        values = np.select([t == "up", t == "sideways", t == "down"], [1.0, 0.5, 0.0], default=np.nan)
        return pd.DataFrame(values, index=t.index, columns=t.columns)

    trend = sum(points(tr[k]) for k in ("short", "medium", "long")) / 3

    z = ind["ret20"] / (ind["vol30"] * math.sqrt(20 / TRADING_DAYS)).replace(0, np.nan)
    momentum = 1 / (1 + np.exp(-z.clip(-6, 6)))
    momentum = (momentum + (ind["macd_hist"] > 0).astype(float)) / 2

    relative = ind["rel_rank"]

    rsi = ind["rsi14"]
    rsi_part = pd.DataFrame(np.select(
        [rsi < 30, rsi < 50, rsi < 70, rsi < 80],
        [0.55, 0.6, 0.8, 0.4], default=0.2), index=rsi.index, columns=rsi.columns).where(rsi.notna())

    vr = ind["volume_ratio"]
    volume = pd.DataFrame(np.select(
        [(vr > 1.2) & ind["up_day"], (vr > 1.2) & ~ind["up_day"]], [1.0, 0.0], default=0.5),
        index=vr.index, columns=vr.columns).where(vr.notna(), 0.5)

    parts = {"trend": trend, "momentum": momentum, "relative": relative, "rsi": rsi_part, "volume": volume}
    total = sum(WEIGHTS[k] * parts[k] for k in parts)
    penalty = (ind["vol30"] > 0.6).astype(float) * 0.10
    score = ((total - penalty) * 100).clip(0, 100).round()
    complete = trend.notna() & momentum.notna() & relative.notna() & rsi_part.notna()
    parts["score"] = score.where(complete)
    return parts


def eligibility(ind: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return ((ind["history"] >= MIN_HISTORY)
            & (ind["days_since_trade"] <= MAX_DAYS_SINCE_TRADE)
            & (ind["turnover20"] >= MIN_TURNOVER)
            & (ind["vol30"] <= MAX_VOLATILITY))


def recommendations(score: pd.DataFrame, short_trend: pd.DataFrame, eligible: pd.DataFrame) -> pd.DataFrame:
    rec = np.where(score >= BUY_AT, "buy", np.where(score <= SELL_AT, "sell", "hold"))
    rec = np.where((rec == "buy") & (short_trend == "down"), "hold", rec)
    rec = np.where(eligible & score.notna(), rec, "avoid")
    return pd.DataFrame(rec, index=score.index, columns=score.columns)


def levels(ind: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """Trade plan levels. Simple on purpose: 20-day low, 60-day high and the
    average true range (ATR), so the backtest can test exactly these."""
    c, atr = ind["close"], ind["atr14"]
    support = ind["support"].clip(upper=c)
    resistance = ind["resistance"].where(ind["resistance"] > c * 1.01, c + 2 * atr)
    return {
        "support": support,
        "resistance": resistance,
        "buy_low": np.maximum(support, c - atr),
        "buy_high": c,
        "stop_loss": np.maximum(support - 0.5 * atr, c - 3 * atr).clip(lower=0.01),
        # First target: the 60-day high, but no closer than 1.5 ATR and no
        # further than 4 ATR, so a stock far below an old high gets a target it
        # can plausibly reach within weeks.
        "take_profit_low": np.minimum(np.maximum(resistance, c + 1.5 * atr), c + 4 * atr),
        "take_profit_high": np.minimum(np.maximum(resistance, c + 1.5 * atr), c + 4 * atr) + atr,
    }


def reasons(row: dict) -> tuple[list[str], list[str]]:
    """Plain-language reasons for and against, from one company's numbers."""
    pro, con = [], []
    names = {"short": "short-term (20-day)", "medium": "medium-term (20 vs 50-day)", "long": "long-term (200-day)"}
    for key, label in names.items():
        t = row.get(f"trend_{key}")
        if t == "up":
            pro.append(f"Rising {label} trend")
        elif t == "down":
            con.append(f"Falling {label} trend")
    rsi = row.get("rsi_14")
    if rsi is not None:
        if rsi >= 70:
            con.append(f"RSI {rsi:.0f}: overbought, pullbacks are common from here")
        elif rsi <= 30:
            con.append(f"RSI {rsi:.0f}: oversold; can bounce, but the trend is weak")
        elif 50 <= rsi < 70:
            pro.append(f"RSI {rsi:.0f}: healthy momentum")
    macd = row.get("macd_hist")
    if macd is not None:
        (pro if macd > 0 else con).append("MACD momentum " + ("improving" if macd > 0 else "weakening"))
    rel = row.get("rel_strength_index")
    if rel is not None:
        if rel >= 0.05:
            pro.append(f"Beat the median NEPSE stock by {rel * 100:.0f} points over 3 months")
        elif rel <= -0.05:
            con.append(f"Lagged the median NEPSE stock by {-rel * 100:.0f} points over 3 months")
    vr = row.get("volume_ratio")
    if vr is not None and vr > 1.2:
        (pro if row.get("up_day") else con).append(f"Volume {vr:.1f}x its 20-day average on an {'up' if row.get('up_day') else 'down'} day")
    vol = row.get("volatility_30d")
    if vol is not None and vol > 0.6:
        con.append(f"Very volatile: {vol * 100:.0f}% annualised")
    return pro[:5], con[:5]


# ---------------------------------------------------------------- price ranges


def _quantiles(log_close: np.ndarray, h: int, lookback: int = 500) -> tuple[float, float, float]:
    """Empirical 10th and 90th percentile of h-day log returns (demeaned), and
    the scale to adjust them to today's volatility."""
    x = log_close[-(lookback + h):]
    if len(x) < h + 60:
        return math.nan, math.nan, math.nan
    moves = x[h:] - x[:-h]
    moves = moves - moves.mean()
    lo, hi = np.quantile(moves, [(1 - BAND) / 2, 1 - (1 - BAND) / 2])
    daily = np.diff(x)
    hist_vol = daily.std()
    recent = daily[-60:]
    w = 0.94 ** np.arange(len(recent))[::-1]
    ewma_vol = math.sqrt(float(np.sum(w * recent ** 2) / np.sum(w)))
    scale = (0.5 * ewma_vol + 0.5 * hist_vol) / hist_vol if hist_vol > 0 else 1.0
    return float(lo), float(hi), float(min(max(scale, 0.6), 1.8))


def model_mids(log_close: np.ndarray, sma50: float, h: int) -> dict[str, float]:
    """Middle estimates of log price after h trading days, one per model."""
    last = log_close[-1]
    mids = {"random_walk": last}

    window = log_close[-120:]
    if len(window) >= 60:
        t = np.arange(len(window))
        slope = np.polyfit(t, window, 1)[0]
        daily_vol = np.diff(log_close[-120:]).std()
        slope = float(np.clip(0.5 * slope, -0.2 * daily_vol, 0.2 * daily_vol))  # damped, capped
        mids["trend"] = last + slope * h

    if sma50 and sma50 > 0 and len(log_close) >= 300:
        prices = np.exp(log_close[-300:])
        sma = pd.Series(prices).rolling(50).mean().to_numpy()
        dev = np.log(prices[49:] / sma[49:])
        x, y = dev[:-1], dev[1:]
        phi = float(np.dot(x, y) / np.dot(x, x)) if np.dot(x, x) > 0 else 1.0
        phi = min(max(phi, 0.0), 0.999)
        current = last - math.log(sma50)
        mids["mean_reversion"] = math.log(sma50) + current * phi ** h
    return mids


def price_range(log_close: np.ndarray, sma50: float, h: int, weights: dict[str, float] | None = None,
                widen: float = 1.0) -> dict | None:
    """Ensemble 80% range after h trading days, in price terms.
    Returns None when there is not enough history."""
    lo_q, hi_q, scale = _quantiles(log_close, h)
    if math.isnan(lo_q):
        return None
    mids = model_mids(log_close, sma50, h)
    w = {m: (weights or {}).get(m, 1.0) for m in mids}
    total = sum(w.values()) or 1.0
    mid = sum(w[m] * mids[m] for m in mids) / total
    lo = mid + lo_q * scale * widen
    hi = mid + hi_q * scale * widen
    last = log_close[-1]
    floor, cap = last + h * math.log(1 - CIRCUIT), last + h * math.log(1 + CIRCUIT)
    return {
        "mid": math.exp(min(max(mid, floor), cap)),
        "low": math.exp(min(max(lo, floor), cap)),
        "high": math.exp(min(max(hi, floor), cap)),
        "models": {m: math.exp(v) for m, v in mids.items()},
    }


def tick(value: float | None) -> float | None:
    """NEPSE prices move in steps of Rs 0.10."""
    if value is None or not math.isfinite(value):
        return None
    return round(round(value * 10) / 10, 2)
