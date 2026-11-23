// A small stand-in for Supabase's REST API (PostgREST), with made-up market data, so the
// dashboard can be built and clicked through without touching the real database.
//
//   node e2e/mock-postgrest.mjs            # listens on http://127.0.0.1:54321
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=sb_publishable_test npm run build
//
// It understands the filters the dashboard uses (eq, lt, lte, gt, gte, is.null, not.is.null,
// and=(...)), select, order, limit and the Range header. GET /__mode?db=down|slow|ok&feedback=ok|fail|toomany
// switches failure modes for the tests (db=flaky fails the first attempt of every read with a
// 503). GET /__seen lists the latest read URLs.

import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const LATEST = "2026-11-23"; // a Monday
const PREV = "2026-11-20"; // the Friday before

// ------------------------------------------------------------------ data
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const sectors = [
  { id: 1, name: "Commercial Banks" }, { id: 2, name: "Hydro Power" }, { id: 3, name: "Microfinance" }, { id: 4, name: "Finance" },
];
const SYMBOLS = [
  ["NABIL", 1], ["NICA", 1], ["GBIME", 1], ["SCB", 1], ["EBL", 1], ["HBL", 1], ["NMB", 1], ["SBL", 1], ["KBL", 1], ["PRVU", 1],
  ["AHPC", 2], ["API", 2], ["UPPER", 2], ["CHCL", 2], ["CKHL", 2], ["MHNL", 2], ["SIKLES", 2], ["RFPL", 2], ["SHEL", 2], ["NLO", 2],
  ["CBBL", 3], ["DDBL", 3], ["SKBBL", 3], ["NUBL", 3], ["SWBBL", 3], ["MLBBL", 3], ["ACLBSL", 3],
  ["CFCL", 4], ["GUFL", 4], ["ICFC", 4], ["MFIL", 4], ["PROFL", 4],
];
const companies = SYMBOLS.map(([symbol, sector_id], i) => ({
  id: i + 1, symbol, name: `${symbol[0]}${symbol.slice(1).toLowerCase()} Limited`, sector_id, instrument_type: "Equity", is_tradable: true,
  isin: `NPE${String(i).padStart(9, "0")}`, listing_date: "2010-01-01", face_value: 100, listed_shares: 1e7 + i * 1e5,
  paid_up_capital: 1e9, market_cap: 5e9 + i * 1e8, promoter_pct: 51, public_pct: 49, nepse_security_id: 100 + i,
}));
// A debenture: NEPSE writes these symbols with a slash.
companies.push({
  id: companies.length + 1, symbol: "GBD80/81", name: "Garima Bikas Bank Debenture 2080/81", sector_id: null,
  instrument_type: "Non-Convertible Debentures", is_tradable: true, isin: "NPE000000999", listing_date: "2020-01-01", face_value: 1000,
  listed_shares: 1e5, paid_up_capital: null, market_cap: null, promoter_pct: null, public_pct: null, nepse_security_id: 999,
});
const NOT_TRADED_TODAY = new Set(["NLO"]);
// SKBBL's details have not been read from NEPSE yet (the details job has not reached it).
for (const c of companies.filter((x) => x.symbol === "SKBBL")) {
  Object.assign(c, { isin: null, listing_date: null, face_value: null, listed_shares: null, paid_up_capital: null, market_cap: null, promoter_pct: null, public_pct: null });
}

function weekdays(end, n) {
  const out = [];
  const d = new Date(`${end}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const days = weekdays(LATEST, 420);

const daily_prices = [];
for (const c of companies) {
  let close = 200 + rand() * 800;
  let prev = null;
  for (const date of days) {
    if (date === LATEST && NOT_TRADED_TODAY.has(c.symbol)) continue;
    const open = close;
    close = Math.max(20, close * (1 + (rand() - 0.5) * 0.04));
    const high = Math.max(open, close) * (1 + rand() * 0.01), low = Math.min(open, close) * (1 - rand() * 0.01);
    daily_prices.push({
      company_id: c.id, date, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2),
      prev_close: prev === null ? null : +prev.toFixed(2), volume: Math.round(1000 + rand() * 50000), turnover: Math.round(close * 20000),
      trades: Math.round(10 + rand() * 300), adj_factor: 1, is_final: true,
    });
    prev = close;
  }
}
// API's latest close is +10.6% from the day before, beyond NEPSE's 10% limit, like MCHL on
// 23 Nov 2026: its data check fails (data_ok false below) and it heads the gainers.
{
  const rows = daily_prices.filter((p) => p.company_id === companies.find((c) => c.symbol === "API").id);
  const last = rows.at(-1), before = rows.at(-2);
  last.close = +(before.close * 1.106).toFixed(2);
  last.high = Math.max(last.high, last.close);
  last.prev_close = before.close;
}
const lastClose = new Map();
for (const p of daily_prices) lastClose.set(p.company_id, p);

const signals = [], forecasts = [];
companies.forEach((c, i) => {
  const p = lastClose.get(c.id);
  const score = Math.round(5 + ((i * 37) % 90));
  const dataOk = c.symbol !== "API";
  const rec = !dataOk ? "avoid" : c.symbol === "PROFL" ? "avoid" : score >= 65 ? "buy" : score <= 35 ? "sell" : "hold";
  const close = p.close;
  signals.push({
    company_id: c.id, date: LATEST, recommendation: rec, score, confidence: ["low", "medium", "high"][i % 3],
    trend_short: score > 60 ? "up" : score < 40 ? "down" : "sideways", trend_medium: "up", trend_long: "sideways",
    buy_low: +(close * 0.97).toFixed(2), buy_high: close, take_profit_low: +(close * 1.08).toFixed(2), take_profit_high: +(close * 1.12).toFixed(2),
    stop_loss: +(close * 0.93).toFixed(2), support: +(close * 0.95).toFixed(2), resistance: +(close * 1.1).toFixed(2),
    rsi_14: 30 + (i * 7) % 40, macd_hist: 0.1, volatility_30d: 0.3, volume_ratio: 1.2, rel_strength_sector: 0.02, rel_strength_index: -0.01,
    reasons_for: ["Rising short-term (20-day) trend"], reasons_against: dataOk ? ["RSI is high"] : ["Data check failed: close beyond the daily limit"],
    close, last_traded: p.date, data_ok: dataOk, data_note: dataOk ? null : `${c.symbol}: close is +10.6% from the previous close, beyond NEPSE's 10% daily limit`,
    model_version: "test",
  });
  if (rec === "avoid") return;
  for (const [horizon, k] of [["1W", 0.05], ["1M", 0.1], ["3M", 0.18]]) {
    forecasts.push({
      company_id: c.id, made_on: LATEST, horizon, model: "ensemble", target_date: "2026-12-22", base_close: close,
      low: +(close * (1 - k)).toFixed(2), mid: close, high: +(close * (1 + k)).toFixed(2), band_pct: 80, reliable: i % 4 !== 0, note: "Backtest note", actual_close: null,
    });
  }
});
// Scored forecasts for the track record: more than one page (1000 rows), to test paging.
for (let i = 0; i < 1500; i++) {
  const c = companies[i % companies.length];
  forecasts.push({
    company_id: c.id, made_on: days[days.length - 30 - Math.floor(i / companies.length)], horizon: ["1W", "1M", "3M"][i % 3], model: "ensemble",
    target_date: PREV, base_close: 100, low: 90, mid: 100, high: 110, band_pct: 80, reliable: true, note: null, actual_close: i % 5 === 0 ? 120 : 100,
  });
}

const indices = [
  { id: 58, code: "NEPSE", name: "NEPSE Index", kind: "main" },
  { id: 57, code: "SENSITIVE", name: "Sensitive Index", kind: "main" },
  { id: 51, code: "BANKING", name: "Banking SubIndex", kind: "sector" },
  { id: 54, code: "HYDRO", name: "HydroPower Index", kind: "sector" },
];
const index_daily = [
  // After the close NEPSE reports previousClose = close for the main indices: the bug being tested.
  { index_id: 58, date: LATEST, open: 2615, high: 2624.21, low: 2607.99, close: 2623.56, prev_close: 2623.56, is_final: true },
  { index_id: 57, date: LATEST, open: 478, high: 480, low: 476, close: 478.52, prev_close: 478.52, is_final: true },
  { index_id: 51, date: LATEST, open: 1586, high: 1597, low: 1585, close: 1596.27, prev_close: 1586.0, is_final: true },
  { index_id: 54, date: LATEST, open: 3596, high: 3600, low: 3580, close: 3586.27, prev_close: 3596.3, is_final: true },
  { index_id: 58, date: PREV, open: 2628, high: 2630, low: 2618, close: 2621.29, prev_close: 2628.67, is_final: true },
  { index_id: 57, date: PREV, open: 479, high: 480, low: 477, close: 477.9, prev_close: 479.1, is_final: true },
  { index_id: 51, date: PREV, open: 1590, high: 1592, low: 1584, close: 1586.0, prev_close: 1590, is_final: true },
  { index_id: 54, date: PREV, open: 3600, high: 3602, low: 3590, close: 3596.3, prev_close: 3600, is_final: true },
];
const index_intraday = [];
for (let m = 0; m <= 240; m += 5) {
  const ts = new Date(Date.parse(`${LATEST}T11:00:00+05:45`) + m * 60000).toISOString();
  index_intraday.push({ index_id: 58, ts, value: +(2615 + Math.sin(m / 40) * 6 + m / 30).toFixed(2) });
}
// Breadth as the jobs write it since 24 Nov 2026: ordinary shares only, by NEPSE's own day change
// (last trade). To show that this, not the closing price, is what the Market page uses, the
// smallest rise counts as unchanged here, as a share whose last trade equalled its previous
// close would.
const breadthLatest = (() => {
  const equity = new Set(companies.filter((c) => c.instrument_type === "Equity").map((c) => c.id));
  const moves = daily_prices.filter((p) => p.date === LATEST && equity.has(p.company_id) && p.prev_close)
    .map((p) => p.close / p.prev_close - 1);
  const up = moves.filter((m) => m > 0).length, down = moves.filter((m) => m < 0).length, same = moves.length - up - down;
  return { advancers: up - 1, decliners: down, unchanged: same + 1 };
})();
const market_daily = [
  { date: LATEST, turnover: 3.8276e9, traded_shares: 10826913, transactions: 42854, scrips_traded: 360, market_cap: 4.3e12, ...breadthLatest, is_final: true },
  { date: PREV, turnover: 3.8876e9, traded_shares: 10000000, transactions: 40000, scrips_traded: 352, market_cap: 4.3e12, advancers: 100, decliners: 200, unchanged: 20, is_final: true },
];
const at = (hhmm, date = LATEST) => new Date(`${date}T${hhmm}:00+05:45`).toISOString();
const job_runs = [
  ["live", "ok", "15:05", "50 snapshots, 0 failed"], ["eod", "ok", "15:35", "360 prices"], ["analytics", "ok", "15:36", "signals"],
  ["watchdog", "ok", "11:34", "all checks passed"], ["backtest", "ok", "11:44", "backtest"], ["details", "ok", "10:09", "110 of 110"],
  ["timer", "ok", "16:09", "Started 1 GitHub job on time since the last check."],
].map(([job, status, hhmm, message], i) => ({
  id: i + 1, job, trade_date: LATEST, status, started_at: at(hhmm), heartbeat_at: at(hhmm), finished_at: at(hhmm), runner: "github-actions",
  run_url: null, requests: 1, rows_written: 1, message, details: {},
}));
// The watchdog stopped reporting 30 hours before the test runs, so it is late at any time of day
// (hourly on weekday afternoons, daily otherwise); a fixed 11:34 was late only in the afternoon.
{
  const stale = new Date(Date.now() - 30 * 3600e3).toISOString();
  Object.assign(job_runs.find((r) => r.job === "watchdog"), { started_at: stale, heartbeat_at: stale, finished_at: stale });
}
const quality_issues = [{ id: 1, trade_date: LATEST, company_id: 12, check_name: "circuit_limit", severity: "error", detail: "API: close beyond NEPSE's 10% daily limit", detected_at: at("15:36") }];
const backtest_results = [
  ...["buy", "hold", "sell", "all"].map((variant, i) => ({ company_id: null, kind: "strategy", name: "call_next_21_days", variant, period_start: "2023-11-01", period_end: "2026-11-20", sample_size: 1000, hit_rate: 0.55, avg_gain_pct: [1.94, 1.1, 1.03, 1.2][i], avg_loss_pct: null, total_return_pct: null, max_drawdown_pct: null, mae_pct: null, band_coverage_pct: null, reliable: true, note: null, trades: null, computed_at: at("11:44") })),
  { company_id: null, kind: "strategy", name: "signal", variant: "default", period_start: "2023-11-01", period_end: "2026-11-20", sample_size: 4863, hit_rate: 0.48, avg_gain_pct: 6.1, avg_loss_pct: -4.2, total_return_pct: 2, max_drawdown_pct: -20, mae_pct: null, band_coverage_pct: null, reliable: true, note: "after costs", trades: null, computed_at: at("11:44") },
  ...["1W", "1M", "3M"].flatMap((variant) => ["ensemble", "random_walk", "trend", "mean_reversion"].map((name) => ({ company_id: null, kind: "forecast", name, variant, period_start: "2023-11-01", period_end: "2026-11-20", sample_size: 5000, hit_rate: null, avg_gain_pct: null, avg_loss_pct: null, total_return_pct: null, max_drawdown_pct: null, mae_pct: 4.2, band_coverage_pct: 80.5, reliable: true, note: null, trades: null, computed_at: at("11:44") }))),
];
const floorsheet_daily = [{ company_id: 1, date: LATEST, trades: 120, quantity: 30000, amount: 16500000, vwap: 549.5, largest_trade_qty: 2000, buyer_brokers: 30, seller_brokers: 28, top_buyers: [{ broker: 58, qty: 5000, amount: 1 }], top_sellers: [{ broker: 34, qty: 4000, amount: 1 }] }];

// The view forecast_live_record (supabase/migrations/20261124000100): checked ranges per horizon.
const scored = forecasts.filter((f) => f.model === "ensemble" && f.actual_close !== null);
const forecast_live_record = ["1W", "1M", "3M"].map((horizon) => {
  const rows = scored.filter((f) => f.horizon === horizon);
  return { horizon, checked: rows.length, inside: rows.filter((f) => f.low <= f.actual_close && f.actual_close <= f.high).length };
}).filter((r) => r.checked);

const TABLES = {
  sectors, companies, daily_prices, signals, forecasts, indices, index_daily, index_intraday, market_daily, job_runs,
  latest_job_runs: job_runs, quality_issues, backtest_results, floorsheet_daily, price_adjustments: [], intraday_snapshots: [],
  forecast_live_record,
};

// ------------------------------------------------------------------ query engine
const mode = { db: "ok", feedback: "ok" };
const feedback = [];
let requests = 0;

function test(row, col, expr) {
  const v = row[col];
  if (expr === "is.null") return v === null || v === undefined;
  if (expr === "not.is.null") return v !== null && v !== undefined;
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot), raw = expr.slice(dot + 1);
  const val = raw === "true" ? true : raw === "false" ? false : raw;
  const cmp = (a, b) => (typeof a === "number" ? a - Number(b) : String(a).localeCompare(String(b)));
  switch (op) {
    case "eq": return typeof v === "boolean" ? v === val : String(v) === String(val);
    case "lt": return v !== null && cmp(v, val) < 0;
    case "lte": return v !== null && cmp(v, val) <= 0;
    case "gt": return v !== null && cmp(v, val) > 0;
    case "gte": return v !== null && cmp(v, val) >= 0;
    default: throw new Error(`unsupported operator ${op}`);
  }
}

function query(table, params, range) {
  let rows = TABLES[table];
  if (!rows) return { status: 404, body: { message: `relation "${table}" does not exist` } };
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (k === "and") {
      for (const part of v.replace(/^\(|\)$/g, "").split(",")) {
        const [col, ...rest] = part.split(".");
        rows = rows.filter((r) => test(r, col, rest.join(".")));
      }
      continue;
    }
    rows = rows.filter((r) => test(r, k, v));
  }
  const order = params.get("order");
  if (order) {
    const keys = order.split(",").map((o) => { const [c, d] = o.split("."); return [c, d === "desc" ? -1 : 1]; });
    rows = [...rows].sort((a, b) => {
      for (const [c, d] of keys) {
        const x = a[c], y = b[c];
        if (x === y) continue;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x < y ? -1 : 1) * d;
      }
      return 0;
    });
  } else {
    // Like Postgres without ORDER BY: no promised order. Shuffle to expose reads that rely on one.
    rows = [...rows].sort(() => rand() - 0.5);
  }
  let start = 0, end = rows.length - 1;
  if (range) { const m = /^(\d+)-(\d+)$/.exec(range); if (m) { start = +m[1]; end = +m[2]; } }
  end = Math.min(end, start + 999); // PostgREST max-rows
  if (params.get("limit")) end = Math.min(end, start + Number(params.get("limit")) - 1);
  rows = rows.slice(start, end + 1);
  const select = params.get("select");
  if (select && select !== "*") {
    const cols = select.split(",");
    rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  }
  return { status: 200, body: rows };
}

const flakySeen = new Set();
const seen = []; // the last 2,000 read URLs, for tests that check which reads were made
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  if (url.pathname === "/__mode") {
    for (const k of ["db", "feedback"]) if (url.searchParams.get(k)) mode[k] = url.searchParams.get(k);
    return send(200, { ...mode, requests, feedback: feedback.length });
  }
  if (url.pathname === "/__stats") return send(200, { requests, feedback });
  if (url.pathname === "/__seen") return send(200, seen);
  requests++;
  try { seen.push(decodeURIComponent(req.url)); } catch { seen.push(req.url); }
  if (seen.length > 2000) seen.shift();
  const key = req.headers.apikey;
  if (!key) return send(401, { message: "No API key found in request" });
  if (mode.db === "down") return send(503, { message: "upstream connect error: internal host db.internal:5432" });
  // "flaky": the first attempt of every read gets a gateway error, as a brief Supabase hiccup does.
  if (mode.db === "flaky" && req.method === "GET") {
    const key = `${req.url} ${req.headers.range ?? ""}`;
    if (!flakySeen.has(key)) { flakySeen.add(key); return send(503, { message: "upstream connect error" }); }
  }
  if (mode.db === "slow") await new Promise((r) => setTimeout(r, 4000));
  const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
  if (!m) return send(404, { message: "not found" });
  if (req.method === "POST" && m[1] === "feedback") {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (mode.feedback === "fail") return send(500, { message: "boom" });
    if (mode.feedback === "toomany") return send(400, { code: "P0001", message: "Too many messages right now. Please try again later." });
    // Like Postgres: text cannot contain a NUL character.
    if (body.includes("\\u0000")) return send(400, { code: "22P05", message: "unsupported Unicode escape sequence" });
    feedback.push(JSON.parse(body));
    return send(201);
  }
  if (req.method !== "GET") return send(405, { message: "read only" });
  const { status, body } = query(m[1], url.searchParams, req.headers.range);
  send(status, body);
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock PostgREST on http://127.0.0.1:${PORT} (${daily_prices.length} price rows)`));
