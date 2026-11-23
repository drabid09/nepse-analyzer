// Every read the dashboard makes. Tables and columns are documented in
// docs/phase1-database.md, docs/phase2-ingestion.md and docs/phase3-analytics.md.

import { rest } from "./db";

export type Company = {
  id: number; symbol: string; name: string; sector_id: number | null; instrument_type: string | null;
  is_tradable: boolean; isin: string | null; listing_date: string | null; face_value: number | null;
  listed_shares: number | null; paid_up_capital: number | null; market_cap: number | null;
  promoter_pct: number | null; public_pct: number | null;
};
export type Sector = { id: number; name: string };
export type Signal = {
  company_id: number; date: string; recommendation: "buy" | "hold" | "sell" | "avoid"; score: number;
  confidence: "low" | "medium" | "high"; trend_short: string | null; trend_medium: string | null; trend_long: string | null;
  buy_low: number | null; buy_high: number | null; take_profit_low: number | null; take_profit_high: number | null;
  stop_loss: number | null; support: number | null; resistance: number | null; rsi_14: number | null;
  macd_hist: number | null; volatility_30d: number | null; volume_ratio: number | null;
  rel_strength_sector: number | null; rel_strength_index: number | null;
  reasons_for: string[]; reasons_against: string[]; close: number | null; last_traded: string | null;
  data_ok: boolean; data_note: string | null; model_version: string | null;
};
export type Forecast = {
  company_id: number; made_on: string; horizon: "1W" | "1M" | "3M"; model: string; target_date: string;
  base_close: number; low: number; mid: number; high: number; band_pct: number; reliable: boolean;
  note: string | null; actual_close: number | null;
};
export type Price = {
  company_id: number; date: string; open: number | null; high: number | null; low: number | null; close: number;
  prev_close: number | null; volume: number | null; turnover: number | null; trades: number | null;
  adj_factor: number; is_final: boolean;
};
export type IndexInfo = { id: number; code: string; name: string; kind: "main" | "sector" };
export type IndexDay = { index_id: number; date: string; open: number | null; high: number | null; low: number | null; close: number; prev_close: number | null; is_final: boolean };
export type MarketDay = {
  date: string; turnover: number | null; traded_shares: number | null; transactions: number | null;
  scrips_traded: number | null; market_cap: number | null; advancers: number | null; decliners: number | null;
  unchanged: number | null; is_final: boolean;
};
export type JobRun = {
  id: number; job: string; trade_date: string | null; status: string; started_at: string; heartbeat_at: string;
  finished_at: string | null; run_url: string | null; requests: number; rows_written: number; message: string | null;
};
export type Issue = { id: number; trade_date: string; company_id: number | null; check_name: string; severity: "info" | "warning" | "error"; detail: string };
export type Backtest = {
  company_id: number | null; kind: "strategy" | "forecast"; name: string; variant: string; period_start: string;
  period_end: string; sample_size: number; hit_rate: number | null; avg_gain_pct: number | null; avg_loss_pct: number | null;
  total_return_pct: number | null; max_drawdown_pct: number | null; mae_pct: number | null; band_coverage_pct: number | null;
  reliable: boolean; note: string | null; trades: [string, string, number, string][] | null; computed_at: string;
};
export type Floorsheet = {
  company_id: number; date: string; trades: number; quantity: number; amount: number; vwap: number | null;
  largest_trade_qty: number | null; buyer_brokers: number | null; seller_brokers: number | null;
  top_buyers: { broker: number; qty: number; amount: number }[] | null; top_sellers: { broker: number; qty: number; amount: number }[] | null;
};
export type Adjustment = { company_id: number; ex_date: string; factor: number; status: string; source: string; note: string | null };

// How long a read may be reused before Supabase is asked again. Live prices change every
// 5 minutes during trading; calls, ranges and the floorsheet change once a day, after the
// close. Reusing reads keeps the database's monthly data transfer well inside the free plan
// (see docs/phase5-quality.md).
const LIVE = 60;
const DAILY = 600;
const HISTORY = 900;
const HOUR = 3600;

/** Columns the list pages need from a price row. */
export type PriceLite = Pick<Price, "company_id" | "date" | "close" | "prev_close" | "is_final">;
/** Columns the list pages need from a signal row. */
export type SignalLite = Pick<Signal, "company_id" | "date" | "recommendation" | "score" | "confidence" | "trend_short" | "rsi_14" | "close" | "data_ok" | "data_note">;

export async function companies() {
  const [list, sectors] = await Promise.all([
    rest<Company>("companies", { select: "id,symbol,name,sector_id,instrument_type,is_tradable,isin,listing_date,face_value,listed_shares,paid_up_capital,market_cap,promoter_pct,public_pct", order: "symbol" }, { revalidate: HOUR, all: true }),
    rest<Sector>("sectors", { select: "id,name", order: "name" }, { revalidate: HOUR }),
  ]);
  const sectorName = new Map(sectors.map((s) => [s.id, s.name]));
  return { list, byId: new Map(list.map((c) => [c.id, c])), sectorName, sectors };
}

export async function health() {
  const [runs, finalDay] = await Promise.all([
    rest<JobRun>("latest_job_runs", { select: "*" }),
    rest<{ date: string }>("market_daily", { select: "date", is_final: "eq.true", order: "date.desc", limit: 1 }),
  ]);
  const latestFinal = finalDay[0]?.date ?? null;
  const errors = latestFinal
    ? await rest<Issue>("quality_issues", { select: "detail", trade_date: `eq.${latestFinal}`, severity: "eq.error", company_id: "is.null" })
    : [];
  return { runs, latestFinal, marketErrors: errors.map((e) => e.detail) };
}

export async function latestSignalDate(): Promise<string | null> {
  const rows = await rest<{ date: string }>("signals", { select: "date", order: "date.desc", limit: 1 }, { revalidate: LIVE });
  return rows[0]?.date ?? null;
}

export const signalsOn = (date: string) =>
  rest<SignalLite>("signals", { select: "company_id,date,recommendation,score,confidence,trend_short,rsi_14,close,data_ok,data_note", date: `eq.${date}` }, { all: true, revalidate: DAILY });
export const forecastsOn = (date: string, horizon = "1M") =>
  rest<Forecast>("forecasts", { select: "company_id,horizon,low,mid,high,reliable,target_date,base_close", made_on: `eq.${date}`, horizon: `eq.${horizon}`, model: "eq.ensemble" }, { all: true, revalidate: DAILY });

export async function latestPriceDate(): Promise<string | null> {
  const last = await rest<{ date: string }>("daily_prices", { select: "date", order: "date.desc", limit: 1 }, { revalidate: LIVE });
  return last[0]?.date ?? null;
}

export async function latestPrices() {
  const date = await latestPriceDate();
  if (!date) return { date: null as string | null, rows: [] as PriceLite[] };
  const rows = await rest<PriceLite>("daily_prices", { select: "company_id,date,close,prev_close,is_final", date: `eq.${date}` }, { all: true, revalidate: LIVE });
  return { date, rows };
}

export const marketDays = (n = 2) => rest<MarketDay>("market_daily", { select: "*", order: "date.desc", limit: n });
export const indices = () => rest<IndexInfo>("indices", { select: "id,code,name,kind", order: "id" }, { revalidate: HOUR });

export async function indexDays() {
  const last = await rest<{ date: string }>("index_daily", { select: "date", order: "date.desc", limit: 1 });
  const date = last[0]?.date;
  if (!date) return { date: null as string | null, rows: [] as IndexDay[] };
  return { date, rows: await rest<IndexDay>("index_daily", { select: "*", date: `eq.${date}` }) };
}

export const indexIntraday = (indexId: number, sinceIso: string) =>
  rest<{ ts: string; value: number }>("index_intraday", { select: "ts,value", index_id: `eq.${indexId}`, ts: `gte.${sinceIso}`, order: "ts" }, { all: true });

export async function companyBySymbol(symbol: string) {
  const rows = await rest<Company>("companies", { select: "*", symbol: `eq.${symbol.toUpperCase()}` });
  return rows[0] ?? null;
}

const PRICE_COLUMNS = "date,open,high,low,close,prev_close,volume,turnover,trades,adj_factor,is_final";

/** Daily bars from `since`: the history before the latest day is reused for 15 minutes, the latest day for one minute. */
export async function companyPrices(companyId: number, since: string) {
  const latest = await latestPriceDate();
  if (!latest) return [] as Price[];
  const [history, today] = await Promise.all([
    rest<Price>("daily_prices", { select: PRICE_COLUMNS, company_id: `eq.${companyId}`, and: `(date.gte.${since},date.lt.${latest})`, order: "date" }, { all: true, revalidate: HISTORY }),
    rest<Price>("daily_prices", { select: PRICE_COLUMNS, company_id: `eq.${companyId}`, date: `eq.${latest}` }, { revalidate: LIVE }),
  ]);
  return [...history, ...today];
}
export const companyIntraday = (companyId: number, sinceIso: string) =>
  rest<{ ts: string; ltp: number; volume: number | null }>("intraday_snapshots", { select: "ts,ltp,volume", company_id: `eq.${companyId}`, ts: `gte.${sinceIso}`, order: "ts" }, { all: true });
export async function companySignal(companyId: number) {
  const rows = await rest<Signal>("signals", { select: "*", company_id: `eq.${companyId}`, order: "date.desc", limit: 1 }, { revalidate: DAILY });
  return rows[0] ?? null;
}
export const companyCallHistory = (companyId: number, limit = 12) =>
  rest<Pick<Signal, "date" | "recommendation" | "score" | "data_ok">>("signals", { select: "date,recommendation,score,data_ok", company_id: `eq.${companyId}`, order: "date.desc", limit }, { revalidate: DAILY });
export const companyForecasts = (companyId: number, madeOn: string) =>
  rest<Forecast>("forecasts", { select: "*", company_id: `eq.${companyId}`, made_on: `eq.${madeOn}`, model: "eq.ensemble" }, { revalidate: DAILY });
export const companyBacktests = (companyId: number) =>
  rest<Backtest>("backtest_results", { select: "*", company_id: `eq.${companyId}` }, { revalidate: HOUR });
export const marketBacktests = () =>
  rest<Backtest>("backtest_results", { select: "*", company_id: "is.null" }, { revalidate: HOUR });
export const companyFloorsheet = (companyId: number) =>
  rest<Floorsheet>("floorsheet_daily", { select: "*", company_id: `eq.${companyId}`, order: "date.desc", limit: 1 }, { revalidate: DAILY });
export const companyAdjustments = (companyId: number) =>
  rest<Adjustment>("price_adjustments", { select: "company_id,ex_date,factor,status,source,note", company_id: `eq.${companyId}`, order: "ex_date.desc", limit: 30 }, { revalidate: HOUR });
export const issues = (filters: Record<string, string> = {}, limit = 50) =>
  rest<Issue>("quality_issues", { select: "*", order: "trade_date.desc,severity", limit, ...filters });
export const recentRuns = (limit = 40) =>
  rest<JobRun>("job_runs", { select: "id,job,trade_date,status,started_at,heartbeat_at,finished_at,run_url,requests,rows_written,message", order: "started_at.desc", limit });
export const scoredForecasts = () =>
  rest<Pick<Forecast, "horizon" | "low" | "high" | "mid" | "actual_close" | "made_on">>("forecasts", { select: "horizon,low,mid,high,actual_close,made_on", model: "eq.ensemble", actual_close: "not.is.null" }, { revalidate: HOUR, all: true });
