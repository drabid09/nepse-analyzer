"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

const NPT_OFFSET = 20700; // seconds: show Nepal clock time on intraday axes

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

// Charts read their colours once, so they are rebuilt when the device switches light/dark.
const DARK = "(prefers-color-scheme: dark)";
function subscribeScheme(onChange: () => void) {
  const m = window.matchMedia(DARK);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}
function useScheme() {
  return useSyncExternalStore(subscribeScheme, () => (window.matchMedia(DARK).matches ? "dark" : "light"), () => "light");
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

/** Unique, ascending times: the chart library refuses anything else. */
function intradaySeries<T>(points: T[], ts: (p: T) => string, value: (p: T) => number) {
  const seen = new Set<number>();
  return points
    .map((p) => ({ time: Math.floor(new Date(ts(p)).getTime() / 1000) + NPT_OFFSET, value: Number(value(p)) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value) && (seen.has(p.time) ? false : (seen.add(p.time), true)))
    .sort((a, b) => a.time - b.time);
}

/**
 * A key that changes only when the numbers change. Pages are re-read from the server every
 * minute during trading; rebuilding a chart for an identical series made it flicker and
 * threw away the reader's zoom and scroll.
 */
function seriesKey(...parts: unknown[]) {
  return JSON.stringify(parts);
}

/** Small line chart of an intraday series (e.g. the NEPSE index today). */
export function IntradayLine({ points, up }: { points: { ts: string; value: number }[]; up: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const scheme = useScheme();
  const data = useMemo(() => intradaySeries(points, (p) => p.ts, (p) => p.value), [points]);
  const key = seriesKey(data.length, data[0]?.time, data.at(-1)?.time, data.at(-1)?.value);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    if (!el.current || latest.current.length < 2) return;
    let chart: { remove: () => void } | undefined;
    let cancelled = false;
    import("lightweight-charts").then(({ createChart, AreaSeries }) => {
      if (cancelled || !el.current) return;
      const c = createChart(el.current, { ...baseOptions(), timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false } } as never);
      const color = cssVar(up ? "--green" : "--red");
      const s = c.addSeries(AreaSeries, { lineColor: color, topColor: `${color}33`, bottomColor: `${color}00`, lineWidth: 2, priceLineVisible: false } as never);
      s.setData(latest.current as never);
      c.timeScale().fitContent();
      chart = c;
    }).catch(() => { /* the chart is decoration; the numbers are shown beside it */ });
    return () => { cancelled = true; chart?.remove(); };
  }, [key, up, scheme]);

  if (data.length < 2) return <div className="h-[180px] flex items-center justify-center text-[13px] text-faint">The intraday chart appears once the session starts.</div>;
  return <div ref={el} className="h-[180px] w-full" />;
}

export type Bar = { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; adj: number };
export type Levels = { buy_low?: number | null; buy_high?: number | null; stop_loss?: number | null; take_profit_low?: number | null; take_profit_high?: number | null };

const RANGES: [string, number][] = [["1M", 22], ["3M", 66], ["6M", 130], ["1Y", 250], ["3Y", 750]];

type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
type ChartApi = { remove: () => void; timeScale: () => { setVisibleRange: (r: unknown) => void } };

function showRange(chart: ChartApi, candles: Candle[], range: string) {
  const n = RANGES.find(([k]) => k === range)?.[1] ?? 250;
  const from = candles[Math.max(0, candles.length - n)]?.time;
  const to = candles.at(-1)?.time;
  if (from && to) chart.timeScale().setVisibleRange({ from, to });
}

/** Daily candles with volume, signal levels and a range selector. Adjusted prices by default. */
export function PriceChart({ bars, levels, intraday }: { bars: Bar[]; levels?: Levels; intraday?: { ts: string; ltp: number }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const [range, setRange] = useState("1Y");
  const [adjusted, setAdjusted] = useState(true);
  const [view, setView] = useState<"daily" | "today">("daily");
  const scheme = useScheme();

  const candles = useMemo<Candle[]>(() => {
    let prev: number | null = null;
    return bars.map((b) => {
      const k = adjusted ? b.adj : 1;
      const close = b.close * k;
      const open = (b.open ?? prev ?? b.close) * (b.open !== null ? k : prev !== null ? 1 : k);
      const high = Math.max(b.high !== null ? b.high * k : close, open, close);
      const low = Math.min(b.low !== null ? b.low * k : close, open, close);
      prev = close;
      return { time: b.date, open, high, low, close, volume: b.volume ?? 0 };
    });
  }, [bars, adjusted]);
  const today = useMemo(() => intradaySeries(intraday ?? [], (p) => p.ts, (p) => p.ltp), [intraday]);
  // "Today" disappears when a new day starts without trades yet; fall back to the daily view.
  const shownView = view === "today" && today.length > 1 ? "today" : "daily";

  const dataKey = shownView === "today"
    ? seriesKey("today", today.length, today.at(-1)?.time, today.at(-1)?.value)
    : seriesKey("daily", adjusted, candles.length, candles[0]?.time, candles.at(-1)?.time, candles.at(-1)?.close, candles.at(-1)?.volume);
  const levelsKey = seriesKey(levels?.buy_low, levels?.buy_high, levels?.stop_loss, levels?.take_profit_low, levels?.take_profit_high);

  // The latest values, read by the effects without making them re-run on every new array.
  const latest = useRef({ candles, today, levels, range });
  latest.current = { candles, today, levels, range };

  useEffect(() => {
    if (!el.current) return;
    let chart: ChartApi | undefined;
    let cancelled = false;
    import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle }) => {
      if (cancelled || !el.current) return;
      const { candles, today, levels, range } = latest.current;
      const up = cssVar("--green"), down = cssVar("--red");
      // Drag sideways or pinch to explore; the mouse wheel and vertical swipes keep scrolling the page.
      const c = createChart(el.current, {
        ...baseOptions(),
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
        timeScale: { borderVisible: false, timeVisible: shownView === "today" },
      } as never);
      if (shownView === "today") {
        const s = c.addSeries(LineSeries, { color: cssVar("--blue"), lineWidth: 2, priceLineVisible: false } as never);
        s.setData(today as never);
        c.timeScale().fitContent();
      } else {
        const s = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceLineVisible: false } as never);
        s.setData(candles.map(({ volume: _v, ...rest }) => rest) as never);
        const v = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: cssVar("--line"), lastValueVisible: false, priceLineVisible: false } as never);
        v.setData(candles.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? `${up}55` : `${down}55` })) as never);
        c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        if (levels) {
          const lines: [number | null | undefined, string, string][] = [
            [levels.take_profit_high, up, "Target 2"], [levels.take_profit_low, up, "Target 1"],
            [levels.buy_high, cssVar("--blue"), "Buy zone"], [levels.buy_low, cssVar("--blue"), ""],
            [levels.stop_loss, down, "Stop loss"],
          ];
          for (const [price, color, title] of lines) {
            if (price) s.createPriceLine({ price: Number(price), color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: Boolean(title), title } as never);
          }
        }
        showRange(c as unknown as ChartApi, candles, range);
      }
      chart = c as unknown as ChartApi;
      chartRef.current = chart;
    }).catch(() => { /* leave the empty frame; the numbers are on the page */ });
    return () => {
      cancelled = true;
      chart?.remove();
      chartRef.current = null;
    };
  }, [dataKey, levelsKey, shownView, scheme]);

  // A range button moves the visible window of the existing chart: no rebuild, no flicker.
  useEffect(() => {
    if (chartRef.current && shownView === "daily") showRange(chartRef.current, latest.current.candles, range);
  }, [range, shownView]);

  const button = (active: boolean) => `rounded-full px-3 py-1 text-[13px] ${active ? "bg-ink text-bg" : "text-muted hover:text-ink"}`;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 min-h-[30px]">
        <div className="flex gap-1" role="group" aria-label="Chart period">
          {today.length > 1 ? <button type="button" aria-pressed={shownView === "today"} className={button(shownView === "today")} onClick={() => setView("today")}>Today</button> : null}
          {RANGES.map(([k]) => (
            <button key={k} type="button" aria-pressed={shownView === "daily" && range === k} className={button(shownView === "daily" && range === k)}
              onClick={() => { setView("daily"); setRange(k); }}>{k}</button>
          ))}
        </div>
        {shownView === "daily" ? (
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
