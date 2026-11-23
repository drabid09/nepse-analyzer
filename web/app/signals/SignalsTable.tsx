"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CallBadge, Change, ScoreBar, Trend } from "@/components/ui";

export type Row = {
  symbol: string; name: string; sector: string; close: number | null; change: number | null; call: string; dataOk: boolean;
  score: number; confidence: string; trend: string | null; rsi: number | null; low: number | null; high: number | null;
  reliable: boolean; note: string | null;
};

const CALLS = ["all", "buy", "hold", "sell", "avoid"] as const;
type SortKey = "score" | "symbol" | "change" | "close";

function fmt(n: number | null) {
  return n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SignalsTable({ rows }: { rows: Row[] }) {
  const [call, setCall] = useState<(typeof CALLS)[number]>("all");
  const [sector, setSector] = useState("All sectors");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "score", desc: true });
  const sectors = useMemo(() => ["All sectors", ...Array.from(new Set(rows.map((r) => r.sector))).sort()], [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows.filter((r) => (call === "all" || r.call === call) && (sector === "All sectors" || r.sector === sector)
      && (!term || r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, call, sector, q, sort]);

  const head = (key: SortKey, label: string, cls = "") => (
    <th className={`px-2 py-2 font-normal cursor-pointer select-none hover:text-ink ${cls}`}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "symbol" }))}>
      {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div className="rounded-[22px] bg-card border border-line p-4 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
        <div className="flex flex-wrap gap-1">
          {CALLS.map((k) => (
            <button key={k} onClick={() => setCall(k)}
              className={`rounded-full px-3 py-1.5 text-[13px] capitalize ${call === k ? "bg-ink text-bg" : "bg-soft text-muted hover:text-ink"}`}>
              {k === "avoid" ? "No call" : k} <span className="opacity-60">{k === "all" ? rows.length : rows.filter((r) => r.call === k).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 min-w-0">
          <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector"
            className="min-w-0 max-w-[50%] rounded-full bg-soft px-3 py-1.5 text-[13px] outline-none">
            {sectors.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter companies"
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
                  <Link href={`/c/${r.symbol}`} className="font-semibold hover:text-accent">{r.symbol}</Link>
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
        {!shown.length ? <p className="text-center text-muted py-8 text-[14px]">No companies match.</p> : null}
      </div>
    </div>
  );
}
