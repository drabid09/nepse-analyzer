"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CallBadge, Change, ScoreBar, Trend } from "@/components/ui";
import { StarButton, useWatchlist } from "@/components/watchlist";
import { companyHref } from "@/lib/symbols";
import { CALLS, DEFAULT_VIEW, readView, viewQuery, type SortKey, type View } from "./view";

export type Row = {
  symbol: string; name: string; sector: string; close: number | null; change: number | null; call: string; dataOk: boolean;
  score: number; confidence: string; trend: string | null; rsi: number | null; low: number | null; high: number | null;
  reliable: boolean; note: string | null;
};


function fmt(n: number | null) {
  return n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SignalsTable({ rows }: { rows: Row[] }) {
  // The filters live in the address (?call=buy&q=bank...), so they survive going to a
  // company and back, a refresh, and can be shared. The first render uses the defaults
  // (as the server did), then the address is read once the page is in the browser.
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [ready, setReady] = useState(false);
  const watch = useWatchlist();
  const sectors = useMemo(() => ["All sectors", ...Array.from(new Set(rows.map((r) => r.sector))).sort()], [rows]);
  const { call, sector, q, sort, mine: onlyMine } = view;
  const update = (change: Partial<View>) => setView((v) => ({ ...v, ...change }));
  const setCall = (c: View["call"]) => update({ call: c });
  const setSector = (s: string) => update({ sector: s });
  const setQ = (text: string) => update({ q: text });
  const setOnlyMine = (f: (v: boolean) => boolean) => setView((v) => ({ ...v, mine: f(v.mine) }));
  const setSort = (f: (s: View["sort"]) => View["sort"]) => setView((v) => ({ ...v, sort: f(v.sort) }));

  // Read the address once, when the table appears (also after coming back to the page).
  // Not again when the rows refresh, or a refresh would undo typing still in flight.
  useEffect(() => {
    setView(readView(window.location.search, sectors));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    // Debounced: typing in the filter would otherwise rewrite the address on every key,
    // and Safari refuses more than 100 address changes in 30 seconds.
    const id = setTimeout(() => {
      const query = viewQuery(view);
      const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
      if (url === window.location.pathname + window.location.search) return;
      try {
        window.history.replaceState(null, "", url); // Next.js keeps its own router state and syncs the address
      } catch {
        // address not updated: the filters still work on the page
      }
    }, 250);
    return () => clearTimeout(id);
  }, [view, ready]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows.filter((r) => (call === "all" || r.call === call) && (sector === "All sectors" || r.sector === sector)
      && (!term || r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term))
      && (!onlyMine || watch.list.includes(r.symbol)));
    const dir = sort.desc ? -1 : 1;
    // Missing values last in either direction; ties keep a fixed order by symbol.
    return list.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null || y === null) return x === y ? a.symbol.localeCompare(b.symbol) : x === null ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.symbol.localeCompare(b.symbol);
    });
  }, [rows, call, sector, q, sort, onlyMine, watch.list]);

  const head = (key: SortKey, label: string, cls = "") => (
    <th className={`px-2 py-2 font-normal ${cls}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="select-none hover:text-ink"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "symbol" }))}>
        {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="rounded-[22px] bg-card border border-line p-4 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
        <div className="flex flex-wrap gap-1">
          {CALLS.map((k) => (
            <button key={k} type="button" onClick={() => setCall(k)} aria-pressed={call === k}
              className={`rounded-full px-3 py-1.5 text-[13px] capitalize ${call === k ? "bg-ink text-bg" : "bg-soft text-muted hover:text-ink"}`}>
              {k === "avoid" ? "No call" : k} <span className="num">{k === "all" ? rows.length : rows.filter((r) => r.call === k).length}</span>
            </button>
          ))}
          {watch.mounted ? (
            <button type="button" onClick={() => setOnlyMine((v) => !v)} aria-pressed={onlyMine}
              className={`rounded-full px-3 py-1.5 text-[13px] ${onlyMine ? "bg-warn-soft text-warn" : "bg-soft text-muted hover:text-ink"}`}>
              Your stocks <span className="num">{watch.list.filter((s) => rows.some((r) => r.symbol === s)).length}</span>
            </button>
          ) : null}
        </div>
        <div className="flex gap-2 min-w-0">
          <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector"
            className="min-w-0 max-w-[50%] rounded-full bg-soft px-3 py-1.5 text-[13px] outline-none">
            {sectors.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} placeholder="Filter" aria-label="Filter companies"
            className="min-w-0 flex-1 sm:flex-none sm:w-44 rounded-full bg-soft px-3 py-1.5 text-[13px] outline-none placeholder:text-faint" />
        </div>
      </div>
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-[14px]">
          <thead className="text-[12px] text-muted text-left">
            <tr>
              {head("symbol", "Company")}
              {head("close", "Price", "text-right")}
              {head("change", "Today", "text-right")}
              <th className="px-2 py-2 font-normal">Call</th>
              {head("score", "Score")}
              <th className="px-2 py-2 font-normal hidden md:table-cell">Short trend</th>
              <th className="px-2 py-2 font-normal text-right hidden lg:table-cell">RSI</th>
              <th className="px-2 py-2 font-normal text-right hidden sm:table-cell">1-month range (80%)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.symbol} className="border-t border-line align-top">
                <td className="px-2 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <Link href={companyHref(r.symbol)} className="font-semibold hover:text-accent">{r.symbol}</Link>
                    <StarButton symbol={r.symbol} />
                  </span>
                  <div className="text-[12px] text-muted truncate max-w-[200px] sm:max-w-[260px]">{r.name}</div>
                  {r.note ? <div className="text-[11px] text-warn mt-0.5 max-w-[260px]">{r.note}</div> : null}
                </td>
                <td className="px-2 py-2.5 text-right num">{fmt(r.close)}</td>
                <td className="px-2 py-2.5 text-right"><Change value={r.change} /></td>
                <td className="px-2 py-2.5"><CallBadge call={r.call} dataOk={r.dataOk} /><div className="text-[11px] text-faint mt-1 capitalize">{r.call === "avoid" ? "" : `${r.confidence} confidence`}</div></td>
                <td className="px-2 py-2.5"><ScoreBar score={r.score} /></td>
                <td className="px-2 py-2.5 hidden md:table-cell text-[13px]"><Trend value={r.trend} /></td>
                <td className="px-2 py-2.5 text-right num text-muted hidden lg:table-cell">{r.rsi?.toFixed(0) ?? "—"}</td>
                <td className="px-2 py-2.5 text-right num text-muted hidden sm:table-cell">
                  {r.low !== null && r.high !== null ? `${fmt(r.low)} – ${fmt(r.high)}` : "—"}
                  {r.low !== null && !r.reliable ? <div className="text-[11px] text-faint">not yet reliable</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length ? <p className="text-center text-muted py-8 text-[14px]">{onlyMine && !watch.list.length ? "No stars yet: tap the star next to a company to add it to your stocks." : "No companies match."}</p> : null}
      </div>
    </div>
  );
}
