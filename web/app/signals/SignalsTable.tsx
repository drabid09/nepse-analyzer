"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RESELECT_EVENT } from "@/components/client";
import { CallBadge, Change, ScoreBar, Trend } from "@/components/ui";
import { StarButton, useWatchlist } from "@/components/watchlist";
import {
  ALL_SECTORS, CALLS, chipCounts, DEFAULTS, filtersToSearch, firstDesc, isDefault, parseFilters, QUERY_MAX,
  visibleRows, type Filters, type Row, type SortKey,
} from "@/lib/signals";
import { companyHref } from "@/lib/symbol";

export type { Row } from "@/lib/signals";

function fmt(n: number | null) {
  return n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Filters live in the address bar (replaceState, so they do not add Back steps). Back from a
 * company page, a refresh and a shared link all restore the same table.
 */
function useUrlFilters(sectors: readonly string[]) {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const restored = useRef(false);
  // The latest sector list without re-running the effect below: a background refresh brings
  // new rows (and a new array) every minute, and must not reset what is being typed.
  const sectorList = useRef(sectors);
  sectorList.current = sectors;

  // Read the address once mounted (the server renders the default table), and again when
  // the browser moves between history entries of this page. A layout effect, so the
  // filtered table is what the first painted frame after hydration shows.
  useLayoutEffect(() => {
    const read = () => setFilters(parseFilters(window.location.search, sectorList.current));
    read();
    restored.current = true;
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  // Write it back, debounced so typing in the filter does not rewrite history on every key
  // (Safari also refuses more than 100 history rewrites in 30 seconds).
  const pending = useRef<string | null>(null);
  const write = useCallback(() => {
    const search = pending.current;
    pending.current = null;
    if (search !== null && search !== window.location.search) {
      window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
    }
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    pending.current = filtersToSearch(filters);
    const id = window.setTimeout(write, 250);
    return () => window.clearTimeout(id);
  }, [filters, write]);

  // Opening a company right after choosing a filter (inside the 250 ms) used to leave the old
  // address behind, so Back showed every company again. Any link click, and leaving or
  // refreshing the page, writes the pending filters first. Capture phase: before the link
  // starts its navigation.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (pending.current !== null && e.target instanceof Element && e.target.closest("a[href]")) write();
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", write);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", write);
    };
  }, [write]);

  // Pressing the Signals tab while on Signals opens the plain /signals address; the table is
  // the same component, so it must drop its filters too or it would no longer match the address.
  useEffect(() => {
    const onReselect = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== window.location.pathname) return;
      pending.current = null;
      setFilters(DEFAULTS);
    };
    window.addEventListener(RESELECT_EVENT, onReselect);
    return () => window.removeEventListener(RESELECT_EVENT, onReselect);
  }, []);

  const update = useCallback((change: Partial<Filters>) => setFilters((f) => ({ ...f, ...change })), []);
  return { filters, update, reset: () => setFilters(DEFAULTS) };
}

export function SignalsTable({ rows }: { rows: Row[] }) {
  const sectors = useMemo(() => [ALL_SECTORS, ...Array.from(new Set(rows.map((r) => r.sector))).sort()], [rows]);
  const { filters, update, reset } = useUrlFilters(sectors);
  const watch = useWatchlist();
  const starred = useMemo(() => new Set(watch.list), [watch.list]);
  // Typing stays responsive: the table catches up with the search box a moment later.
  const q = useDeferredValue(filters.q);
  const applied = useMemo(() => ({ ...filters, q }), [filters, q]);
  const shown = useMemo(() => visibleRows(rows, applied, starred), [rows, applied, starred]);
  const counts = useMemo(() => chipCounts(rows, applied, starred), [rows, applied, starred]);

  const sortBy = (key: SortKey) =>
    update({ sort: key, desc: filters.sort === key ? !filters.desc : firstDesc(key) });

  const head = (key: SortKey, label: string, cls = "") => {
    const active = filters.sort === key;
    return (
      <th className={`px-2 py-2 font-normal ${cls}`} aria-sort={active ? (filters.desc ? "descending" : "ascending") : "none"}>
        <button type="button" onClick={() => sortBy(key)} className="select-none hover:text-ink focus-visible:outline-2 focus-visible:outline-accent rounded">
          {label}<span aria-hidden className="inline-block w-3 text-left">{active ? (filters.desc ? "↓" : "↑") : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="rounded-[22px] bg-card border border-line p-4 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by call">
          {CALLS.map((k) => (
            <button key={k} type="button" onClick={() => update({ call: k })} aria-pressed={filters.call === k}
              className={`rounded-full px-3 py-1.5 text-[13px] capitalize ${filters.call === k ? "bg-ink text-bg" : "bg-soft text-muted hover:text-ink"}`}>
              {k === "avoid" ? "No call" : k} <span className="num">{counts[k]}</span>
            </button>
          ))}
          {/* Not one of the call tabs: it narrows whichever call is chosen. Rendered on the server
              too (disabled until the browser's stars are known), so the row never shifts. */}
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <button type="button" onClick={() => update({ mine: !filters.mine })} aria-pressed={filters.mine} disabled={!watch.mounted}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] disabled:opacity-60 ${filters.mine ? "bg-warn-soft text-warn" : "bg-soft text-muted hover:text-ink"}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill={filters.mine ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
            Only your stocks <span className="num">{watch.mounted ? counts.mine : "–"}</span>
          </button>
        </div>
        <div className="flex gap-2 min-w-0">
          <select value={filters.sector} onChange={(e) => update({ sector: e.target.value })} aria-label="Sector"
            className="min-w-0 max-w-[50%] rounded-full bg-soft px-3 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="search" value={filters.q} maxLength={QUERY_MAX} onChange={(e) => update({ q: e.target.value })}
            placeholder="Filter" aria-label="Filter companies" enterKeyHint="search" autoComplete="off"
            className="min-w-0 flex-1 sm:flex-none sm:w-44 rounded-full bg-soft px-3 py-1.5 text-[13px] outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent/40" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 min-h-6 mb-1 text-[12px] text-faint" aria-live="polite">
        <span className="num">{shown.length === rows.length ? `${rows.length} companies` : `${shown.length} of ${rows.length} companies`}</span>
        {!isDefault(filters) ? <button type="button" onClick={reset} className="text-accent hover:underline">Clear filters</button> : null}
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
                    {/* No prefetch: 269 rows would otherwise download every company page in the background. */}
                    <Link href={companyHref(r.symbol)} prefetch={false} className="font-semibold hover:text-accent">{r.symbol}</Link>
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
        {!shown.length ? (
          <p className="text-center text-muted py-8 text-[14px]">
            {filters.mine && !watch.list.length ? "No stars yet: tap the star next to a company to add it to your stocks." : "No companies match these filters."}
            {!isDefault(filters) ? <> <button type="button" onClick={reset} className="text-accent hover:underline">Clear filters</button></> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
