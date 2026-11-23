#!/usr/bin/env python3
"""Weekly backtest: how well would the daily rules have done on real history?

Uses exactly the functions of the daily job (engine.py), on prices adjusted
for bonus and right shares, with only data available on each day.

1. Signal strategy, per company: buy on the day after a "buy" call, sell when
   the price closes below the stop loss or above the first take-profit level,
   when the call turns to "sell", or after 63 trading days. Costs per round
   trip and capital gains tax on profits are deducted (see COSTS below).
2. Calls against what followed, whole market: the average return over the
   next 21 trading days after buy, hold and sell calls, against all stocks.
   This is the plainest test of whether the score means anything.
3. Price ranges, per company, model and horizon: how far the middle estimate
   was from the outcome (mean absolute error) and how often the outcome fell
   inside the 80% range (band coverage).

Results go to backtest_results; the daily job uses them to weight and widen
its ranges and to set the confidence of each call.
"""

from __future__ import annotations

import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ingest"))
import engine  # noqa: E402
from common import JobError, JobRun, Supabase, run, write_summary  # noqa: E402
from daily_analytics import MODEL_VERSION, latest_final_day, load_frames, universe  # noqa: E402

HISTORY_DAYS = 1600           # calendar days loaded: warm-up plus about three years tested
TEST_DAYS = 750               # trading days tested (about three years)
MAX_HOLD = 63
FORWARD = 21
FORECAST_STEP = 10            # a forecast every 10 trading days per company
FORECAST_WARMUP = 300
# Costs, from ShareHub Nepal's published rates (Oct 2026): broker commission
# 0.33% each way for trades of Rs 50,000 to 5 lakh, SEBON fee 0.015% each way,
# DP charge Rs 25 per sale. About 0.75% per round trip. Capital gains tax for
# individuals: 5% of the gain on shares held up to 365 days (3.75% beyond),
# effective 22 Sep 2026. Check with a broker before relying on these.
ROUND_TRIP_COST = 0.0075
CGT_SHORT = 0.05


def strategy(dates, close, rec, stop, target, start: int) -> list[tuple]:
    """Trades for one company: (entry_day, exit_day, net_return, reason)."""
    trades = []
    i, n = start, len(close)
    while i < n - 1:
        if rec[i] != "buy" or not np.isfinite(close[i + 1]):
            i += 1
            continue
        entry_i, entry = i + 1, close[i + 1]
        stop_level, target_level = stop[i], target[i]
        j = entry_i
        reason = "end of test"
        while j < n - 1:
            j += 1
            price = close[j]
            if price <= stop_level:
                reason = "stop loss"
                break
            if price >= target_level:
                reason = "take profit"
                break
            if rec[j] == "sell":
                reason = "sell call"
                break
            if j - entry_i >= MAX_HOLD:
                reason = "time limit"
                break
        gross = close[j] / entry - 1
        net = gross - ROUND_TRIP_COST
        if net > 0:
            net *= 1 - CGT_SHORT
        trades.append((dates[entry_i], dates[j], net, reason))
        i = j + 1
    return trades


def summarise_trades(trades: list[tuple]) -> dict:
    if not trades:
        return {"sample_size": 0}
    nets = np.array([t[2] for t in trades])
    equity = np.cumprod(1 + nets)
    peak = np.maximum.accumulate(np.concatenate([[1.0], equity]))[1:]
    drawdown = (equity / peak - 1).min()
    gains, losses = nets[nets > 0], nets[nets <= 0]
    return {
        "sample_size": len(trades),
        "hit_rate": round(float((nets > 0).mean()), 4),
        "avg_gain_pct": round(float(gains.mean() * 100), 2) if len(gains) else None,
        "avg_loss_pct": round(float(losses.mean() * 100), 2) if len(losses) else None,
        "total_return_pct": round(float((equity[-1] - 1) * 100), 2),
        "max_drawdown_pct": round(float(drawdown * 100), 2),
    }


def forecast_errors(log_close: np.ndarray, sma50: np.ndarray, start: int) -> dict:
    """{(model, horizon): [abs_pct_errors], [inside_band]} for one company."""
    out: dict = {}
    n = len(log_close)
    for horizon, h in engine.HORIZONS.items():
        for origin in range(max(start, FORECAST_WARMUP), n - h, FORECAST_STEP):
            past = log_close[: origin + 1]
            lo_q, hi_q, scale = engine._quantiles(past, h)
            if math.isnan(lo_q):
                continue
            mids = engine.model_mids(past, float(sma50[origin]) if np.isfinite(sma50[origin]) else 0.0, h)
            mids["ensemble"] = sum(mids.values()) / len(mids)
            actual = log_close[origin + h]
            for model, mid in mids.items():
                err = abs(math.exp(mid - actual) - 1)
                inside = mid + lo_q * scale <= actual <= mid + hi_q * scale
                bucket = out.setdefault((model, horizon), ([], []))
                bucket[0].append(err)
                bucket[1].append(inside)
    return out


def main() -> None:
    db = Supabase()
    trade_date = latest_final_day(db)
    if not trade_date:
        print("No final trading day yet. Nothing to do.")
        return
    run_log = JobRun(db, "backtest", trade_date=trade_date, source="database")
    try:
        report, rows, details = backtest(db, trade_date)
    except JobError as exc:
        run_log.finish("failed", str(exc))
        raise
    run_log.finish("ok", details["message"], rows_written=rows, details=details)
    write_summary(report)


def backtest(db: Supabase, trade_date: date) -> tuple[str, int, dict]:
    companies, sector_of = universe(db)
    ids = [c["id"] for c in companies]
    frames = load_frames(db, ids, trade_date - timedelta(days=HISTORY_DAYS))
    ind = engine.indicators(frames["close"], frames["high"], frames["low"], frames["volume"], sector_of)
    tr = engine.trends(ind)
    sc = engine.scores(ind, tr)
    rec = engine.recommendations(sc["score"], tr["short"], engine.eligibility(ind))
    lv = engine.levels(ind)
    dates = [d.date() for d in ind["close"].index]
    n = len(dates)
    start = max(0, n - TEST_DAYS)
    period = (dates[start].isoformat(), dates[-1].isoformat())
    params = {"rules": MODEL_VERSION, "round_trip_cost": ROUND_TRIP_COST, "capital_gains_tax": CGT_SHORT,
              "max_hold_days": MAX_HOLD, "test_days": TEST_DAYS}

    results, all_trades = [], []
    # 1. Signal strategy per company
    for cid in ids:
        if cid not in ind["close"].columns:
            continue
        close = ind["close"][cid].to_numpy()
        trades = strategy(dates, close, rec[cid].to_numpy(), lv["stop_loss"][cid].to_numpy(),
                          lv["take_profit_low"][cid].to_numpy(), start)
        all_trades.extend(trades)
        stats = summarise_trades(trades)
        first, last = close[start], close[-1]
        hold = (last / first - 1) * 100 if np.isfinite(first) and first > 0 else None
        note = f"Buy and hold over the same period: {hold:+.1f}%" if hold is not None else None
        results.append({
            "company_id": cid, "kind": "strategy", "name": "signal", "variant": "", "params": params,
            "period_start": period[0], "period_end": period[1], "sample_size": stats["sample_size"],
            "hit_rate": stats.get("hit_rate"), "avg_gain_pct": stats.get("avg_gain_pct"),
            "avg_loss_pct": stats.get("avg_loss_pct"), "total_return_pct": stats.get("total_return_pct"),
            "max_drawdown_pct": stats.get("max_drawdown_pct"), "mae_pct": None, "band_coverage_pct": None,
            "reliable": stats["sample_size"] >= 8, "note": note,
            "trades": [[a.isoformat(), b.isoformat(), round(r * 100, 2), why] for a, b, r, why in trades[-40:]],
        })
    pooled = summarise_trades(all_trades)

    # 2. Calls against the next 21 trading days, whole market
    c = ind["close"]
    forward = (c.shift(-FORWARD) / c - 1).iloc[start:n - FORWARD]
    calls = rec.iloc[start:n - FORWARD]
    forward_rows = {}
    for variant in ("buy", "hold", "sell", "all"):
        mask = calls.isin(["buy", "hold", "sell"]) if variant == "all" else (calls == variant)
        values = forward.where(mask).stack().dropna()
        forward_rows[variant] = values
        results.append({
            "company_id": None, "kind": "strategy", "name": "call_next_21_days", "variant": variant, "params": params,
            "period_start": period[0], "period_end": dates[n - FORWARD - 1].isoformat(), "sample_size": int(len(values)),
            "hit_rate": round(float((values > 0).mean()), 4) if len(values) else None,
            "avg_gain_pct": round(float(values.mean() * 100), 2) if len(values) else None,
            "avg_loss_pct": None, "total_return_pct": None, "max_drawdown_pct": None, "mae_pct": None,
            "band_coverage_pct": None, "reliable": len(values) >= 200,
            "note": "Average price change over the next 21 trading days after this call (before costs)",
            "trades": None,
        })

    results.append({
        "company_id": None, "kind": "strategy", "name": "signal", "variant": "", "params": params,
        "period_start": period[0], "period_end": period[1], "sample_size": pooled["sample_size"],
        "hit_rate": pooled.get("hit_rate"), "avg_gain_pct": pooled.get("avg_gain_pct"),
        "avg_loss_pct": pooled.get("avg_loss_pct"), "total_return_pct": None, "max_drawdown_pct": None,
        "mae_pct": None, "band_coverage_pct": None, "reliable": pooled["sample_size"] >= 100,
        "note": "All companies' trades pooled. Total return is not meaningful when trades overlap, so it is left empty.",
        "trades": None,
    })

    # 3. Price ranges per company, model and horizon
    pooled_f: dict = {}
    for cid in ids:
        if cid not in c.columns:
            continue
        col = c[cid]
        valid = col.notna().to_numpy()
        if valid.sum() < FORECAST_WARMUP + 70:
            continue
        log_close = np.log(col[valid].to_numpy())
        sma50 = ind["sma50"][cid][valid].to_numpy()
        first_test = int(np.cumsum(valid)[start - 1]) if start > 0 else 0  # first tested day in this company's own series
        errors = forecast_errors(log_close, sma50, first_test)
        rw_mae = {}
        for (model, horizon), (errs, inside) in sorted(errors.items(), key=lambda kv: kv[0][0] != "random_walk"):
            if not errs:
                continue
            mae = float(np.mean(errs) * 100)
            coverage = float(np.mean(inside) * 100)
            if model == "random_walk":
                rw_mae[horizon] = mae
            beats = mae <= rw_mae.get(horizon, mae) * 1.05
            results.append({
                "company_id": cid, "kind": "forecast", "name": model, "variant": horizon, "params": {"band": engine.BAND, "step": FORECAST_STEP},
                "period_start": period[0], "period_end": period[1], "sample_size": len(errs),
                "hit_rate": None, "avg_gain_pct": None, "avg_loss_pct": None, "total_return_pct": None,
                "max_drawdown_pct": None, "mae_pct": round(mae, 2), "band_coverage_pct": round(coverage, 1),
                "reliable": len(errs) >= 20 and 70 <= coverage <= 90 and beats, "note": None, "trades": None,
            })
            agg = pooled_f.setdefault((model, horizon), ([], []))
            agg[0].extend(errs)
            agg[1].extend(inside)
    for (model, horizon), (errs, inside) in pooled_f.items():
        results.append({
            "company_id": None, "kind": "forecast", "name": model, "variant": horizon, "params": {"band": engine.BAND, "step": FORECAST_STEP},
            "period_start": period[0], "period_end": period[1], "sample_size": len(errs),
            "hit_rate": None, "avg_gain_pct": None, "avg_loss_pct": None, "total_return_pct": None,
            "max_drawdown_pct": None, "mae_pct": round(float(np.mean(errs) * 100), 2),
            "band_coverage_pct": round(float(np.mean(inside) * 100), 1), "reliable": len(errs) >= 500,
            "note": "All companies pooled", "trades": None,
        })

    computed = datetime.now(timezone.utc).isoformat()
    for r in results:
        r["computed_at"] = computed
    written = db.upsert("backtest_results", results, on_conflict="company_id,kind,name,variant", batch=200)

    def pct(series):
        return f"{series.mean() * 100:+.2f}% (n={len(series)}, up {100 * (series > 0).mean():.0f}% of the time)" if len(series) else "n/a"

    lines = [
        f"## Backtest to {trade_date}",
        "",
        f"Period tested: {period[0]} to {period[1]}, {len(ids)} tradable equities, rules {MODEL_VERSION}. "
        f"Costs {ROUND_TRIP_COST * 100:.2f}% per round trip and {CGT_SHORT * 100:.0f}% tax on gains.",
        "",
        "**After each call, the next 21 trading days (before costs):**",
        "",
        *[f"- {k}: {pct(v)}" for k, v in forward_rows.items()],
        "",
        f"**Signal strategy, all companies pooled:** {pooled.get('sample_size', 0)} trades, "
        f"{(pooled.get('hit_rate') or 0) * 100:.0f}% profitable after costs and tax, "
        f"average gain {pooled.get('avg_gain_pct')}%, average loss {pooled.get('avg_loss_pct')}%.",
        "",
        "**Price ranges, all companies pooled** (target: 80% of outcomes inside):",
        "",
        "| Horizon | Model | Forecasts | Mean error | Inside the range |",
        "|---|---|---|---|---|",
        *[f"| {h} | {m} | {len(e)} | {np.mean(e) * 100:.1f}% | {np.mean(i) * 100:.0f}% |"
          for (m, h), (e, i) in sorted(pooled_f.items(), key=lambda kv: (list(engine.HORIZONS).index(kv[0][1]), kv[0][0]))],
        "",
    ]
    details = {
        "message": f"{pooled.get('sample_size', 0)} strategy trades, {sum(len(e) for e, _ in pooled_f.values())} range forecasts tested",
        "period": period,
        "forward_21d": {k: {"n": int(len(v)), "avg_pct": round(float(v.mean() * 100), 2) if len(v) else None} for k, v in forward_rows.items()},
        "strategy_pooled": pooled,
        "ranges_pooled": {f"{m} {h}": {"n": len(e), "mae_pct": round(float(np.mean(e) * 100), 2), "coverage_pct": round(float(np.mean(i) * 100), 1)}
                          for (m, h), (e, i) in pooled_f.items()},
    }
    return "\n".join(lines), written, details


if __name__ == "__main__":
    run(main)
