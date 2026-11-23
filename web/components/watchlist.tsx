"use client";

// "Your stocks": companies starred on this phone or computer. Kept in the
// browser's own storage, so it needs no account and nothing is sent anywhere.

import Link from "next/link";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CallBadge, Card, Change, ScoreBar, Title } from "@/components/ui";
import { price } from "@/lib/format";
import { companyHref } from "@/lib/symbol";
import { parseWatchlist, toggleSymbol, WATCHLIST_KEY } from "@/lib/watchlist";

const CHANGED = "nepse-watchlist-changed";

function read(): string | null {
  try {
    return window.localStorage.getItem(WATCHLIST_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

const noSubscribe = () => () => {};

export function useWatchlist() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const list = useMemo(() => parseWatchlist(raw), [raw]);
  const toggle = useCallback((symbol: string) => {
    const next = toggleSymbol(parseWatchlist(read()), symbol);
    try {
      window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    } catch {
      // storage blocked (private window): the star simply does not stick
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { list, toggle, mounted, has: (symbol: string) => list.includes(symbol.toUpperCase()) };
}

function StarIcon({ on, size = 18 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
        fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

/** Star toggle. With a label it reads "Add to your stocks" / "In your stocks". */
export function StarButton({ symbol, label = false }: { symbol: string; label?: boolean }) {
  const { has, toggle, mounted } = useWatchlist();
  const on = mounted && has(symbol);
  const text = on ? `Remove ${symbol} from your stocks` : `Add ${symbol} to your stocks`;
  if (label) {
    return (
      <button type="button" onClick={() => toggle(symbol)} aria-pressed={on} title={text}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] ${on ? "bg-warn-soft text-warn" : "bg-soft text-muted hover:text-ink"}`}>
        <StarIcon on={on} size={16} />{on ? "In your stocks" : "Add to your stocks"}
      </button>
    );
  }
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); toggle(symbol); }} aria-pressed={on} aria-label={text} title={text}
      className={`inline-flex align-middle p-1 -m-1 rounded-full ${on ? "text-warn" : "text-faint hover:text-ink"}`}>
      <StarIcon on={on} />
    </button>
  );
}

export type WatchRow = {
  symbol: string; name: string; close: number | null; change: number | null; call: string | null; dataOk: boolean;
  score: number | null; low: number | null; high: number | null;
  /** Set when the price is not from the latest trading day (the company did not trade). */
  asOf?: string | null;
};

/** The "Your stocks" card on the Market page. */
export function YourStocks({ rows, viewer }: { rows: WatchRow[]; viewer: string }) {
  const { list, mounted } = useWatchlist();
  // The stars live in this browser, so the server cannot know them. It renders a placeholder
  // the size of the hint below, so the page does not jump when the browser fills it in.
  if (!mounted) return <div aria-hidden className="min-h-[76px] sm:min-h-[52px] rounded-2xl border border-line bg-card" />;
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const mine = list.map((s) => bySymbol.get(s)).filter((r): r is WatchRow => Boolean(r));
  if (!mine.length) {
    return (
      <p className="min-h-[76px] sm:min-h-[52px] rounded-2xl bg-card border border-line px-4 py-3 text-[14px] text-muted leading-relaxed">
        <span className="inline-flex align-middle text-warn mr-1.5"><StarIcon on size={15} /></span>
        {viewer}, tap the star on any company page or in <Link href="/signals" className="text-accent underline underline-offset-2">Signals</Link> to
        pin it here as Your stocks, with its price, today&apos;s change and call.
      </p>
    );
  }
  return (
    <Card>
      <Title sub="The companies you starred, in the order you added them. Saved on this phone or computer.">Your stocks</Title>
      {mine.length ? (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-[14px]">
            <thead className="text-[12px] text-muted text-left">
              <tr>
                <th className="px-2 py-2 font-normal">Company</th>
                <th className="px-2 py-2 font-normal text-right">Price</th>
                <th className="px-2 py-2 font-normal text-right">Today</th>
                <th className="px-2 py-2 font-normal">Call</th>
                <th className="px-2 py-2 font-normal hidden sm:table-cell">Score</th>
                <th className="px-2 py-2 font-normal text-right hidden md:table-cell">1-month range</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.symbol} className="border-t border-line">
                  <td className="px-2 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <Link href={companyHref(r.symbol)} prefetch={false} className="font-semibold hover:text-accent">{r.symbol}</Link>
                      <StarButton symbol={r.symbol} />
                    </span>
                    <div className="text-[12px] text-muted truncate max-w-[200px]">{r.name}</div>
                  </td>
                  <td className="px-2 py-2.5 text-right num">{price(r.close)}{r.asOf ? <div className="text-[11px] text-faint">{r.asOf}</div> : null}</td>
                  <td className="px-2 py-2.5 text-right"><Change value={r.change} /></td>
                  <td className="px-2 py-2.5">{r.call ? <CallBadge call={r.call} dataOk={r.dataOk} /> : <span className="text-faint">—</span>}</td>
                  <td className="px-2 py-2.5 hidden sm:table-cell">{r.score !== null ? <ScoreBar score={r.score} /> : <span className="text-faint">—</span>}</td>
                  <td className="px-2 py-2.5 text-right num text-muted hidden md:table-cell">{r.low !== null && r.high !== null ? `${price(r.low)} – ${price(r.high)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
