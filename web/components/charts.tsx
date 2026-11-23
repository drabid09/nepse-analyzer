"use client";

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

/** Small line chart of an intraday series (e.g. the NEPSE index today). */
export function IntradayLine({ points, up }: { points: { ts: string; value: number }[]; up: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || points.length < 2) return;
    let chart: { remove: () => void } | undefined;
    let cancelled = false;
    import("lightweight-charts").then(({ createChart, AreaSeries }) => {
      if (cancelled || !el.current) return;
      const c = createChart(el.current, { ...baseOptions(), timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false } } as never);
      const color = cssVar(up ? "--green" : "--red");
      const s = c.addSeries(AreaSeries, { lineColor: color, topColor: `${color}33`, bottomColor: `${color}00`, lineWidth: 2, priceLineVisible: false } as never);
      const seen = new Set<number>();
      const data = points
        .map((p) => ({ time: Math.floor(new Date(p.ts).getTime() / 1000) + NPT_OFFSET, value: Number(p.value) }))
        .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)));
      s.setData(data as never);
      c.timeScale().fitContent();
      chart = c;
    });
    return () => { cancelled = true; chart?.remove(); };
  }, [points, up]);
  if (points.length < 2) return <div className="h-[180px] flex items-center justify-center text-[13px] text-faint">The intraday chart appears once the session starts.</div>;
  return <div ref={el} className="h-[180px] w-full" />;
}

export type Bar = { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; adj: number };
export type Levels = { buy_low?: number | null; buy_high?: number | null; stop_loss?: number | null; take_profit_low?: number | null; take_profit_high?: number | null };

const RANGES: [string, number][] = [["1M", 22], ["3M", 66], ["6M", 130], ["1Y", 250], ["3Y", 750]];

/** Daily candles with volume, signal levels and a range selector. Adjusted prices by default. */
export function PriceChart({ bars, levels, intraday }: { bars: Bar[]; levels?: Levels; intraday?: { ts: string; ltp: number }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState("1Y");
  const [adjusted, setAdjusted] = useState(true);
  const [view, setView] = useState<"daily" | "today">("daily");

  const candles = useMemo(() => {
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

  useEffect(() => {
    if (!el.current) return;
    let chart: { remove: () => void } | undefined;
    let cancelled = false;
    import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle }) => {
      if (cancelled || !el.current) return;
      const up = cssVar("--green"), down = cssVar("--red");
      const c = createChart(el.current, { ...baseOptions(), handleScroll: true, handleScale: true, timeScale: { borderVisible: false, timeVisible: view === "today" } } as never);
      if (view === "today") {
        const s = c.addSeries(LineSeries, { color: cssVar("--blue"), lineWidth: 2, priceLineVisible: false } as never);
        const seen = new Set<number>();
        s.setData((intraday ?? []).map((p) => ({ time: Math.floor(new Date(p.ts).getTime() / 1000) + NPT_OFFSET, value: Number(p.ltp) }))
          .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true))) as never);
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
        const n = RANGES.find(([k]) => k === range)?.[1] ?? 250;
        const from = candles[Math.max(0, candles.length - n)]?.time;
        const to = candles.at(-1)?.time;
        if (from && to) c.timeScale().setVisibleRange({ from, to } as never);
      }
      chart = c;
    });
    return () => { cancelled = true; chart?.remove(); };
  }, [candles, levels, range, view, intraday]);

  const button = (active: boolean) => `rounded-full px-3 py-1 text-[13px] ${active ? "bg-ink text-bg" : "text-muted hover:text-ink"}`;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex gap-1">
          {intraday && intraday.length > 1 ? <button className={button(view === "today")} onClick={() => setView("today")}>Today</button> : null}
          {RANGES.map(([k]) => (
            <button key={k} className={button(view === "daily" && range === k)} onClick={() => { setView("daily"); setRange(k); }}>{k}</button>
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
