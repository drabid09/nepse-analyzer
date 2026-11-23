#!/usr/bin/env python3
"""Daily analytics: data checks, then signals and price ranges.

Runs after the end-of-day job. For the latest final trading day it:

  1. checks the data (is the day final and complete, does every price respect
     NEPSE's 10% daily limit, are open/high/low/close in order, does an
     independent source agree on the closing prices, is any bonus or right
     adjustment still unconfirmed) and records each failure in quality_issues;
  2. computes, for every tradable equity, the indicators, score, call
     (buy / hold / sell / avoid), trade levels and reasons, and writes them to
     signals. A company whose data failed a check gets data_ok = false and no
     call, so the website never shows a call built on doubtful numbers;
  3. writes 80% price ranges for 1 week, 1 month and 3 months to forecasts,
     weighted and calibrated by the latest backtest;
  4. fills in the outcome of forecasts whose date has passed, and prunes old
     daily rows.

Educational analysis, not financial advice.
"""

from __future__ import annotations

import math
import os
import sys
from datetime import date, time, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ingest"))
import engine  # noqa: E402
from common import JobError, JobRun, Supabase, now_npt, run, write_summary  # noqa: E402

MODEL_VERSION = "rules-v1"
HISTORY_DAYS = 1100           # calendar days of prices loaded (about 3 years of trading)
CHUNK = 40                    # companies per series request
CIRCUIT_TOLERANCE = 0.105     # 10% limit plus rounding to the Rs 0.10 tick


# ---------------------------------------------------------------- loading


def latest_final_day(db: Supabase) -> date | None:
    rows = db.select("market_daily", select="date", is_final="eq.true", order="date.desc", limit=1)
    return date.fromisoformat(rows[0]["date"]) if rows else None


def universe(db: Supabase) -> tuple[list[dict], dict[int, str | None]]:
    sectors = {r["id"]: r["name"] for r in db.select("sectors", select="id,name")}
    companies = db.select_all("companies", select="id,symbol,sector_id", instrument_type="eq.Equity",
                              is_tradable="eq.true", order="id")
    return companies, {c["id"]: sectors.get(c["sector_id"]) for c in companies}


def load_frames(db: Supabase, ids: list[int], since: date) -> dict[str, pd.DataFrame]:
    columns = {k: {} for k in ("open", "high", "low", "close", "volume")}
    for start in range(0, len(ids), CHUNK):
        for row in db.rpc("analytics_series", {"p_since": since.isoformat(), "p_company_ids": ids[start:start + CHUNK]}):
            s = row["series"]
            index = pd.to_datetime(s["date"])
            for key in columns:
                columns[key][row["company_id"]] = pd.Series(s[key], index=index, dtype="float64")
    frames = {k: pd.DataFrame(v).sort_index() for k, v in columns.items()}
    calendar = frames["close"].index
    return {k: f.reindex(calendar) for k, f in frames.items()}


def add_weekdays(day: date, n: int) -> date:
    while n:
        day += timedelta(days=1)
        if day.weekday() < 5:
            n -= 1
    return day


# ---------------------------------------------------------------- data checks


class Issues:
    def __init__(self, trade_date: date):
        self.trade_date = trade_date
        self.rows: list[dict] = []
        self.by_company: dict[int, list[str]] = {}

    def add(self, check: str, severity: str, detail: str, company_id: int | None = None) -> None:
        self.rows.append({"trade_date": self.trade_date.isoformat(), "company_id": company_id,
                          "check_name": check, "severity": severity, "detail": detail[:500]})
        if company_id is not None and severity != "info":
            self.by_company.setdefault(company_id, []).append(detail)

    def market_errors(self) -> list[str]:
        return [r["detail"] for r in self.rows if r["company_id"] is None and r["severity"] == "error"]


def check_data(db: Supabase, trade_date: date, companies: list[dict], issues: Issues) -> dict:
    """Checks on the day's raw rows. Returns facts for the run summary."""
    facts: dict = {}
    day = trade_date.isoformat()
    ids = {c["id"] for c in companies}
    symbol_of = {c["id"]: c["symbol"] for c in companies}

    market = db.select("market_daily", select="scrips_traded,is_final", date=f"eq.{day}")
    rows = db.select_all("daily_prices", select="company_id,open,high,low,close,prev_close,volume,source",
                         date=f"eq.{day}", is_final="eq.true")
    facts["rows_on_day"] = len(rows)
    expected = market[0]["scrips_traded"] if market else None
    facts["scrips_traded_reported"] = expected
    if expected and abs(len(rows) - expected) > max(2, 0.02 * expected):
        issues.add("row_count", "warning", f"{len(rows)} prices stored for {day}, NEPSE reported {expected} traded securities")

    eod = db.select("job_runs", select="status,message", job="eq.eod", trade_date=f"eq.{day}", order="started_at.desc", limit=1)
    if eod and eod[0]["status"] not in ("ok",):
        issues.add("eod_status", "warning", f"End-of-day run for {day} was '{eod[0]['status']}': {eod[0]['message']}")

    sources = {}
    for r in rows:
        sources[r["source"]] = sources.get(r["source"], 0) + 1
        cid = r["company_id"]
        if cid not in ids:
            continue
        close, prev = float(r["close"]), (float(r["prev_close"]) if r["prev_close"] else None)
        if prev and abs(close / prev - 1) > CIRCUIT_TOLERANCE:
            issues.add("circuit_limit", "error",
                       f"{symbol_of[cid]}: close {close:.2f} is {100 * (close / prev - 1):+.1f}% from the previous close {prev:.2f}, beyond NEPSE's 10% daily limit", cid)
        prices = [float(r[k]) for k in ("open", "close") if r[k] is not None]
        if r["high"] is not None and r["low"] is not None and prices:
            if not float(r["low"]) - 0.01 <= min(prices) <= max(prices) <= float(r["high"]) + 0.01:
                issues.add("ohlc_order", "error", f"{symbol_of[cid]}: open/close outside the day's low-high range", cid)
    facts["price_sources"] = sources
    if sources.get("sharesansar"):
        issues.add("fallback_source", "info", f"{sources['sharesansar']} prices for {day} came from the Sharesansar fallback")

    pending = db.select_all("price_adjustments", select="company_id,factor,note", ex_date=f"eq.{day}", status="eq.unconfirmed")
    for p in pending:
        if p["company_id"] in ids:
            issues.add("adjustment_review", "warning",
                       f"{symbol_of[p['company_id']]}: previous close differs from our last price by factor {p['factor']:.3f} ({p['note']}); held until reviewed",
                       p["company_id"])

    facts["cross_source"] = cross_check(rows, companies, trade_date, issues)
    return facts


def cross_check(rows: list[dict], companies: list[dict], trade_date: date, issues: Issues) -> dict:
    """Compare our closes with Sharesansar's page for the same day (one request).
    Both start from NEPSE, so a difference means a fault in our own pipeline."""
    try:
        import sharesansar  # from scripts/ingest
        as_of, theirs = sharesansar.fetch_today()
    except (JobError, Exception) as exc:  # noqa: BLE001 - the check is optional
        issues.add("cross_source", "info", f"independent check skipped: {str(exc)[:200]}")
        return {"checked": 0, "skipped": str(exc)[:200]}
    if as_of != trade_date:
        issues.add("cross_source", "info", f"independent check skipped: Sharesansar is dated {as_of}, not {trade_date}")
        return {"checked": 0, "skipped": f"Sharesansar dated {as_of}"}
    by_symbol = {r["symbol"]: r for r in theirs}
    symbol_of = {c["id"]: c["symbol"] for c in companies}
    checked, mismatched = 0, []
    for r in rows:
        sym = symbol_of.get(r["company_id"])
        other = by_symbol.get(sym) if sym else None
        if not other or other["close"] is None:
            continue
        checked += 1
        ours = float(r["close"])
        if abs(ours - other["close"]) > max(0.1, 0.001 * ours):
            mismatched.append(sym)
            issues.add("cross_source", "warning",
                       f"{sym}: our close {ours:.2f}, Sharesansar {other['close']:.2f}", r["company_id"])
    if checked and len(mismatched) > 0.1 * checked:
        issues.add("cross_source", "error", f"{len(mismatched)} of {checked} closes differ from Sharesansar: the day's data is doubtful")
    return {"checked": checked, "mismatched": len(mismatched), "examples": mismatched[:10]}


def check_freshness(db: Supabase, trade_date: date, issues: Issues) -> None:
    """After the evening run, today's data should be final unless today was a holiday."""
    now = now_npt()
    today = now.date()
    if now.weekday() >= 5 or now.time() < time(16, 30) or trade_date >= today:
        return
    holiday = db.select("job_runs", select="id", job="eq.eod", status="eq.holiday", trade_date=f"eq.{today.isoformat()}")
    if not holiday:
        issues.add("stale", "error", f"It is {now:%H:%M} on {today:%A}, but the latest final trading day is {trade_date}: today's end-of-day data is missing")


# ---------------------------------------------------------------- backtest inputs


def backtest_lookup(db: Supabase) -> tuple[dict, dict]:
    rows = db.select_all("backtest_results", select="company_id,kind,name,variant,sample_size,hit_rate,mae_pct,band_coverage_pct,reliable",
                         company_id="not.is.null")
    forecast, strategy = {}, {}
    for r in rows:
        if r["kind"] == "forecast":
            forecast[(r["company_id"], r["name"], r["variant"])] = r
        elif r["kind"] == "strategy" and r["name"] == "signal":
            strategy[r["company_id"]] = r
    return forecast, strategy


def range_settings(cid: int, horizon: str, forecast_bt: dict) -> tuple[dict | None, float, bool, str]:
    ens = forecast_bt.get((cid, "ensemble", horizon))
    rw = forecast_bt.get((cid, "random_walk", horizon))
    weights = {}
    for model in ("random_walk", "trend", "mean_reversion"):
        r = forecast_bt.get((cid, model, horizon))
        if r and r["mae_pct"]:
            weights[model] = 1 / max(r["mae_pct"], 0.1)
    if not ens or not ens["sample_size"]:
        return (weights or None), 1.0, False, "No backtest yet for this range"
    coverage = (ens["band_coverage_pct"] or 0) / 100
    widen = min(max(1 + (engine.BAND - coverage), 0.8), 1.5)
    beats_naive = rw is not None and ens["mae_pct"] is not None and rw["mae_pct"] is not None and ens["mae_pct"] <= rw["mae_pct"] * 1.05
    reliable = ens["sample_size"] >= 20 and 0.70 <= coverage <= 0.90 and beats_naive
    note = (f"Backtest: the range held {coverage * 100:.0f}% of the time (target 80%) over {ens['sample_size']} past forecasts"
            + ("" if beats_naive else "; the middle estimate did not beat 'no change'"))
    return (weights or None), widen, reliable, note


def confidence(score: float, aligned: bool, data_ok: bool, strategy_bt: dict | None) -> str:
    strength = abs(score - 50)
    if not data_ok:
        return "low"
    n = strategy_bt["sample_size"] if strategy_bt else 0
    hit = strategy_bt["hit_rate"] if strategy_bt else None
    if n < 8 or hit is None:
        return "low" if strength < 20 else "medium"
    if hit >= 0.55 and strength >= 20 and aligned:
        return "high"
    if hit < 0.45 or strength < 10:
        return "low"
    return "medium"


# ---------------------------------------------------------------- main


def num(x, digits=4):
    if x is None:
        return None
    try:
        value = float(x)
    except (TypeError, ValueError):
        return None
    return round(value, digits) if math.isfinite(value) else None


def main() -> None:
    forced = os.environ.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch") or os.environ.get("ANALYTICS_FORCE") == "1"
    db = Supabase()
    trade_date = latest_final_day(db)
    if not trade_date:
        print("No final trading day yet. Nothing to do.")
        return
    issues = Issues(trade_date)
    check_freshness(db, trade_date, issues)
    done = db.select("signals", select="company_id", date=f"eq.{trade_date.isoformat()}", limit=1)
    if done and not forced and not issues.market_errors():
        print(f"Signals for {trade_date} already exist. Nothing to do.")
        return

    run_log = JobRun(db, "analytics", trade_date=trade_date, source="database")
    try:
        summary = analyse(db, trade_date, issues)
    except JobError as exc:
        run_log.finish("failed", str(exc))
        raise
    status = "ok" if not issues.market_errors() else "partial"
    run_log.finish(status, summary["message"], rows_written=summary["rows"], details=summary["details"])
    write_summary(summary["report"])


def analyse(db: Supabase, trade_date: date, issues: Issues) -> dict:
    companies, sector_of = universe(db)
    if len(companies) < 100:
        raise JobError(f"only {len(companies)} tradable equities found; companies table looks incomplete")
    facts = check_data(db, trade_date, companies, issues)
    if issues.rows:
        db.upsert("quality_issues", issues.rows, on_conflict="trade_date,company_id,check_name")
    market_errors = issues.market_errors()
    if market_errors:
        # No new calls on a doubtful day; the website shows the issue instead.
        return {"rows": len(issues.rows), "message": f"no signals for {trade_date}: {market_errors[0]}",
                "details": {"facts": facts, "market_errors": market_errors},
                "report": f"## Analytics {trade_date}\n\n- **No signals published.** {'; '.join(market_errors)}\n"}

    ids = [c["id"] for c in companies]
    frames = load_frames(db, ids, trade_date - timedelta(days=HISTORY_DAYS))
    stamp = pd.Timestamp(trade_date)
    if stamp not in frames["close"].index:
        raise JobError(f"no prices stored for {trade_date}")
    frames = {k: f.loc[:stamp] for k, f in frames.items()}
    ind = engine.indicators(frames["close"], frames["high"], frames["low"], frames["volume"], sector_of)
    tr = engine.trends(ind)
    sc = engine.scores(ind, tr)
    eligible = engine.eligibility(ind)
    rec = engine.recommendations(sc["score"], tr["short"], eligible)
    lv = engine.levels(ind)
    forecast_bt, strategy_bt = backtest_lookup(db)

    last_trade_day = frames["volume"].fillna(0).gt(0).apply(lambda col: col[col].index.max() if col.any() else pd.NaT)
    signals, forecasts = [], []
    counts = {"buy": 0, "hold": 0, "sell": 0, "avoid": 0, "data_issue": 0, "too_new": 0}
    for cid in ids:
        if cid not in ind["close"].columns:
            continue
        score = sc["score"].at[stamp, cid]
        if pd.isna(score):
            counts["too_new"] += 1
            continue
        get = lambda name: ind[name].at[stamp, cid]  # noqa: E731
        call = rec.at[stamp, cid]
        data_problems = issues.by_company.get(cid, [])
        data_ok = not data_problems
        row = {
            "trend_short": tr["short"].at[stamp, cid], "trend_medium": tr["medium"].at[stamp, cid],
            "trend_long": tr["long"].at[stamp, cid], "rsi_14": num(get("rsi14"), 1), "macd_hist": num(get("macd_hist")),
            "volatility_30d": num(get("vol30")), "volume_ratio": num(get("volume_ratio"), 2),
            "rel_strength_sector": num(get("rel_sector")), "rel_strength_index": num(get("rel_index")),
            "up_day": bool(get("up_day")),
        }
        pro, con = engine.reasons(row)
        if call == "avoid":
            why = []
            if get("days_since_trade") > engine.MAX_DAYS_SINCE_TRADE:
                why.append(f"not traded for {int(get('days_since_trade'))} trading days")
            if not get("turnover20") >= engine.MIN_TURNOVER:
                why.append(f"thin trading: about Rs {get('turnover20') / 1000:,.0f} thousand a day")
            if not get("vol30") <= engine.MAX_VOLATILITY:
                why.append("extremely volatile")
            con = [f"No call: {', '.join(why) or 'not enough recent data'}"] + con
        if not data_ok:
            call = "avoid"
            con = ["Data check failed: " + data_problems[0]] + con
            counts["data_issue"] += 1
        else:
            counts[call] += 1
        aligned = len({row["trend_short"], row["trend_medium"], row["trend_long"]}) == 1
        close = float(ind["close"].at[stamp, cid])
        has_levels = call in ("buy", "hold", "sell")
        level = {k: (engine.tick(lv[k].at[stamp, cid]) if has_levels else None) for k in lv}
        last_day = last_trade_day.get(cid)
        signals.append({
            "company_id": cid, "date": trade_date.isoformat(), "recommendation": call, "score": int(score),
            "confidence": confidence(score, aligned, data_ok, strategy_bt.get(cid)),
            "trend_short": row["trend_short"], "trend_medium": row["trend_medium"], "trend_long": row["trend_long"],
            "buy_low": level["buy_low"], "buy_high": level["buy_high"],
            "take_profit_low": level["take_profit_low"], "take_profit_high": level["take_profit_high"],
            "stop_loss": level["stop_loss"], "support": level["support"], "resistance": level["resistance"],
            "rsi_14": row["rsi_14"], "macd_hist": row["macd_hist"], "volatility_30d": row["volatility_30d"],
            "volume_ratio": row["volume_ratio"], "rel_strength_sector": row["rel_strength_sector"],
            "rel_strength_index": row["rel_strength_index"], "pe": None, "pb": None, "eps": None, "dividend_yield": None,
            "reasons_for": pro, "reasons_against": con, "close": engine.tick(close),
            "last_traded": last_day.date().isoformat() if isinstance(last_day, pd.Timestamp) and not pd.isna(last_day) else None,
            "data_ok": data_ok, "data_note": "; ".join(data_problems)[:500] or None, "model_version": MODEL_VERSION,
        })

        if call == "avoid":
            continue
        series = np.log(ind["close"][cid].dropna().to_numpy())
        sma50 = float(ind["sma50"].at[stamp, cid]) if not pd.isna(ind["sma50"].at[stamp, cid]) else 0.0
        for horizon, h in engine.HORIZONS.items():
            weights, widen, reliable, note = range_settings(cid, horizon, forecast_bt)
            rng = engine.price_range(series, sma50, h, weights, widen)
            if not rng:
                continue
            low, mid, high = engine.tick(rng["low"]), engine.tick(rng["mid"]), engine.tick(rng["high"])
            low, high = min(low, mid), max(high, mid)
            forecasts.append({
                "company_id": cid, "made_on": trade_date.isoformat(), "horizon": horizon, "model": "ensemble",
                "target_date": add_weekdays(trade_date, h).isoformat(), "base_close": engine.tick(close),
                "low": low, "mid": mid, "high": high, "band_pct": int(engine.BAND * 100),
                "reliable": reliable, "note": note,
            })

    written = db.upsert("signals", signals, on_conflict="company_id,date")
    if forecasts:
        written += db.upsert("forecasts", forecasts, on_conflict="company_id,made_on,horizon,model")
    scored = int(db.rpc("score_forecasts", {"p_date": trade_date.isoformat()}) or 0)
    pruned = int(db.rpc("prune_analytics", {}) or 0)

    track = db.select_all("forecasts", select="horizon,low,high,actual_close", model="eq.ensemble", actual_close="not.is.null")
    live_record = {}
    for horizon in engine.HORIZONS:
        done = [t for t in track if t["horizon"] == horizon]
        inside = sum(1 for t in done if float(t["low"]) <= float(t["actual_close"]) <= float(t["high"]))
        live_record[horizon] = {"scored": len(done), "inside_range_pct": round(100 * inside / len(done), 1) if done else None}

    details = {"facts": facts, "counts": counts, "forecasts": len(forecasts), "forecasts_scored_today": scored,
               "rows_pruned": pruned, "live_track_record": live_record, "issues": len(issues.rows),
               "backtests_available": bool(forecast_bt), "model_version": MODEL_VERSION}
    message = (f"{trade_date}: {len(signals)} signals (buy {counts['buy']}, hold {counts['hold']}, sell {counts['sell']}, "
               f"avoid {counts['avoid']}, data issue {counts['data_issue']}), {len(forecasts)} ranges")
    cross = facts.get("cross_source", {})
    report = "\n".join([
        f"## Analytics {trade_date}",
        "",
        f"- **{len(signals)} signals**: buy {counts['buy']}, hold {counts['hold']}, sell {counts['sell']}, "
        f"avoid {counts['avoid']}, held back for a data issue {counts['data_issue']}; {counts['too_new']} companies have too little history.",
        f"- {len(forecasts)} price ranges (1 week, 1 month, 3 months). Backtest available: {'yes' if forecast_bt else 'not yet'}.",
        f"- Data checks: {facts['rows_on_day']} prices stored, NEPSE reported {facts['scrips_traded_reported']}; "
        f"independent check against Sharesansar: {cross.get('checked', 0)} closes compared, {cross.get('mismatched', 0)} differed"
        + (f" ({cross['skipped']})" if cross.get("skipped") else "") + f"; {len(issues.rows)} issues recorded.",
        "- Live track record so far: " + ", ".join(
            f"{h}: {v['scored']} scored" + (f", {v['inside_range_pct']}% inside the range" if v["scored"] else "") for h, v in live_record.items()) + ".",
        f"- Forecasts scored today: {scored}. Old daily rows pruned: {pruned}.",
        "",
    ])
    return {"rows": written, "message": message, "details": details, "report": report}


if __name__ == "__main__":
    run(main)
