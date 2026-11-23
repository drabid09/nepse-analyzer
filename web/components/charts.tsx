"use client";

// Charts. The page re-reads its data every minute during trading hours (AutoRefresh),
// which hands these components new arrays with mostly the same numbers. So each chart
// is created once and its data is updated in place: a refresh never rebuilds the chart,
// and never resets the range, zoom or scroll position someone is looking at.

import type { IChartApi, IPriceLine, ISeriesApi, SeriesType } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

const NPT_OFFSET = 20700; // seconds: show Nepal clock time on intraday axes

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function baseOptions() {
  return {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: cssVar("--muted"), fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--line") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: { mode: 0 },
    handleScroll: false,
    handleScale: false,
  };
}

/** Points in time order, one per second at most, on the Nepal clock (the chart library needs strictly increasing times). */
export function timeSeries(points: { ts: string; value: number }[]) {
  const byTime = new Map<number, number>();
  for (const p of points) {
    const t = Math.floor(new Date(p.ts).getTime() / 1000);
    const v = Number(p.value);
    if (Number.isFinite(t) && Number.isFinite(v)) byTime.set(t + NPT_OFFSET, v);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
}

/** Small line chart of an intraday series (e.g. the NEPSE index today). */
export function IntradayLine({ points, up }: { points: { ts: string; value: number }[]; up: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const series = useRef<{ chart: IChartApi; line: ISeriesApi<"Area"> } | null>(null);
  const [built, setBuilt] = useState(0);
  const enough = points.length >= 2;
  // Compare by content: a refresh with the same points changes nothing.
  const key = useMemo(() => JSON.stringify(points), [points]);

  useEffect(() => {
    if (!enough || !el.current) return;
    let cancelled = false;
    let chart: IChartApi | undefined;
    import("lightweight-charts").then(({ createChart, AreaSeries }) => {
      if (cancelled || !el.current) return;
      chart = createChart(el.current, { ...baseOptions(), timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false } } as never);
      const line = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false } as never);
      series.current = { chart, line };
      setBuilt((n) => n + 1);
    });
    return () => { cancelled = true; series.current = null; chart?.remove(); };
  }, [enough]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const color = cssVar(up ? "--green" : "--red");
    s.line.applyOptions({ lineColor: color, topColor: `${color}33`, bottomColor: `${color}00` });
    s.line.setData(timeSeries(JSON.parse(key)) as never);
    s.chart.timeScale().fitContent();
  }, [built, key, up]);

  if (!enough) return <div className="h-[180px] flex items-center justify-center text-[13px] text-faint">The intraday chart appears once the session starts.</div>;
  return <div ref={el} className="h-[180px] w-full" />;
}

export type Bar = { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; adj: number };
export type Levels = { buy_low?: number | null; buy_high?: number | null; stop_loss?: number | null; take_profit_low?: number | null; take_profit_high?: number | null };

const RANGES: [string, number][] = [["1M", 22], ["3M", 66], ["6M", 130], ["1Y", 250], ["3Y", 750]];

/** Candles from daily bars: one per date, in date order, adjusted for bonus and right shares when asked. */
export function toCandles(bars: Bar[], adjusted: boolean) {
  const byDate = new Map<string, Bar>();
  for (const b of bars) if (b.date && Number.isFinite(b.close)) byDate.set(b.date, b);
  let prev: number | null = null;
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((b) => {
    const k = adjusted ? b.adj : 1;
    const close = b.close * k;
    const open = (b.open ?? prev ?? b.close) * (b.open !== null ? k : prev !== null ? 1 : k);
    const high = Math.max(b.high !== null ? b.high * k : close, open, close);
    const low = Math.min(b.low !== null ? b.low * k : close, open, close);
    prev = close;
    return { time: b.date, open, high, low, close, volume: b.volume ?? 0 };
  });
}

type Built = {
  chart: IChartApi;
  main: ISeriesApi<SeriesType>;
  volume: ISeriesApi<"Histogram"> | null;
  lines: IPriceLine[];
  dashed: number;
};

/** Daily candles with volume, signal levels and a range selector. Adjusted prices by default. */
export function PriceChart({ bars, levels, intraday }: { bars: Bar[]; levels?: Levels; intraday?: { ts: string; ltp: number }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Built | null>(null);
  const [built, setBuilt] = useState(0);
  const [range, setRange] = useState("1Y");
  // Counts range clicks, so choosing the range already shown still resets a dragged or zoomed view.
  const [rangeClicks, setRangeClicks] = useState(0);
  const [adjusted, setAdjusted] = useState(true);
  const [view, setView] = useState<"daily" | "today">("daily");
  const hasToday = (intraday?.length ?? 0) > 1;

  // Content keys: a background refresh with the same numbers is a no-op.
  const barsKey = useMemo(() => JSON.stringify(bars), [bars]);
  const levelsKey = JSON.stringify(levels ?? null);
  const todayKey = useMemo(() => JSON.stringify(intraday ?? []), [intraday]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candles = useMemo(() => toCandles(JSON.parse(barsKey), adjusted), [barsKey, adjusted]);

  // The intraday view disappears after the session; fall back to the daily candles.
  useEffect(() => {
    if (view === "today" && !hasToday) setView("daily");
  }, [view, hasToday]);

  // 1. Create the chart, once per view.
  useEffect(() => {
    if (!el.current) return;
    let cancelled = false;
    let chart: IChartApi | undefined;
    import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle }) => {
      if (cancelled || !el.current) return;
      const up = cssVar("--green"), down = cssVar("--red");
      // Drag sideways or pinch to explore; the mouse wheel and vertical swipes keep scrolling the page.
      chart = createChart(el.current, {
        ...baseOptions(),
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
        timeScale: { borderVisible: false, timeVisible: view === "today" },
      } as never);
      let main: ISeriesApi<SeriesType>;
      let volume: ISeriesApi<"Histogram"> | null = null;
      if (view === "today") {
        main = chart.addSeries(LineSeries, { color: cssVar("--blue"), lineWidth: 2, priceLineVisible: false } as never);
      } else {
        main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceLineVisible: false } as never);
        volume = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: cssVar("--line"), lastValueVisible: false, priceLineVisible: false } as never);
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      api.current = { chart, main, volume, lines: [], dashed: LineStyle.Dashed };
      setBuilt((n) => n + 1);
    });
    return () => { cancelled = true; api.current = null; chart?.remove(); };
  }, [view]);

  // 2. Data and level lines, updated in place.
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (view === "today") {
      a.main.setData(timeSeries((JSON.parse(todayKey) as { ts: string; ltp: number }[]).map((p) => ({ ts: p.ts, value: p.ltp }))) as never);
      return;
    }
    const up = cssVar("--green"), down = cssVar("--red");
    a.main.setData(candles.map(({ volume: _v, ...rest }) => rest) as never);
    a.volume?.setData(candles.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? `${up}55` : `${down}55` })) as never);
    for (const line of a.lines) a.main.removePriceLine(line);
    a.lines = [];
    const lv = JSON.parse(levelsKey) as Levels | null;
    if (lv) {
      const lines: [number | null | undefined, string, string][] = [
        [lv.take_profit_high, up, "Target 2"], [lv.take_profit_low, up, "Target 1"],
        [lv.buy_high, cssVar("--blue"), "Buy zone"], [lv.buy_low, cssVar("--blue"), ""],
        [lv.stop_loss, down, "Stop loss"],
      ];
      for (const [price, color, title] of lines) {
        if (price) a.lines.push(a.main.createPriceLine({ price: Number(price), color, lineWidth: 1, lineStyle: a.dashed, axisLabelVisible: Boolean(title), title } as never));
      }
    }
  }, [built, view, candles, levelsKey, todayKey]);

  // 3. Visible range: for a new chart, or when another range is chosen. Not when the data refreshes.
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (view === "today") {
      a.chart.timeScale().fitContent();
      return;
    }
    const n = RANGES.find(([k]) => k === range)?.[1] ?? 250;
    const from = candles[Math.max(0, candles.length - n)]?.time;
    const to = candles.at(-1)?.time;
    if (from && to) a.chart.timeScale().setVisibleRange({ from, to } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, view, range, rangeClicks]);

  const button = (active: boolean) => `rounded-full px-3 py-1 text-[13px] ${active ? "bg-ink text-bg" : "text-muted hover:text-ink"}`;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex gap-1">
          {hasToday ? <button type="button" aria-pressed={view === "today"} className={button(view === "today")} onClick={() => setView("today")}>Today</button> : null}
          {RANGES.map(([k]) => (
            <button key={k} type="button" aria-pressed={view === "daily" && range === k} className={button(view === "daily" && range === k)} onClick={() => { setView("daily"); setRange(k); setRangeClicks((n) => n + 1); }}>{k}</button>
          ))}
        </div>
        {view === "daily" ? (
          <label className="flex items-center gap-2 text-[13px] text-muted cursor-pointer select-none">
            <input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} className="accent-[var(--blue)]" />
            Adjusted for bonus and right shares
          </label>
        ) : null}
      </div>
      <div ref={el} className="h-[360px] w-full" />
    </div>
  );
}
