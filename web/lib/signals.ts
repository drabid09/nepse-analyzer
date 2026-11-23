// The Signals table's filters, sort and counts. Pure, so every case is tested
// (lib/signals.test.ts), and kept in the address bar so Back, refresh and a shared
// link all show the same table.

export type Row = {
  symbol: string; name: string; sector: string; close: number | null; change: number | null; call: string; dataOk: boolean;
  score: number; confidence: string; trend: string | null; rsi: number | null; low: number | null; high: number | null;
  reliable: boolean; note: string | null;
};

export const CALLS = ["all", "buy", "hold", "sell", "avoid"] as const;
export type Call = (typeof CALLS)[number];
export const SORT_KEYS = ["score", "symbol", "change", "close"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const ALL_SECTORS = "All sectors";
export const QUERY_MAX = 40;

export type Filters = { call: Call; sector: string; q: string; sort: SortKey; desc: boolean; mine: boolean };
export const DEFAULTS: Filters = { call: "all", sector: ALL_SECTORS, q: "", sort: "score", desc: true, mine: false };

/** A column's natural first direction: names A to Z, numbers highest first. */
export const firstDesc = (key: SortKey) => key !== "symbol";

/** Reads filters from a query string. Anything unknown or malformed falls back to the default. */
export function parseFilters(search: string, sectors: readonly string[]): Filters {
  const p = new URLSearchParams(search);
  const call = p.get("call");
  const sector = p.get("sector");
  const sort = p.get("sort");
  const dir = p.get("dir");
  const key = (SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as SortKey) : DEFAULTS.sort;
  return {
    call: (CALLS as readonly string[]).includes(call ?? "") ? (call as Call) : DEFAULTS.call,
    sector: sector && sectors.includes(sector) ? sector : ALL_SECTORS,
    q: (p.get("q") ?? "").slice(0, QUERY_MAX),
    sort: key,
    desc: dir === "asc" ? false : dir === "desc" ? true : firstDesc(key),
    mine: p.get("mine") === "1",
  };
}

/** The query string for the filters: only what differs from the default, so the plain page stays /signals. */
export function filtersToSearch(f: Filters): string {
  const p = new URLSearchParams();
  if (f.call !== DEFAULTS.call) p.set("call", f.call);
  if (f.sector !== ALL_SECTORS) p.set("sector", f.sector);
  const q = f.q.trim();
  if (q) p.set("q", q.slice(0, QUERY_MAX));
  if (f.sort !== DEFAULTS.sort || f.desc !== DEFAULTS.desc) {
    p.set("sort", f.sort);
    if (f.desc !== firstDesc(f.sort)) p.set("dir", f.desc ? "desc" : "asc");
  }
  if (f.mine) p.set("mine", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const isDefault = (f: Filters) => filtersToSearch(f) === "";

type Skip = "call" | "mine" | null;

function matches(r: Row, f: Filters, starred: ReadonlySet<string>, skip: Skip): boolean {
  const term = f.q.trim().toLowerCase();
  return (skip === "call" || f.call === "all" || r.call === f.call)
    && (f.sector === ALL_SECTORS || r.sector === f.sector)
    && (!term || r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term))
    && (skip === "mine" || !f.mine || starred.has(r.symbol));
}

/**
 * Each chip's count is the number of rows that clicking it would show, given the other
 * filters (sector, search, the other chip group). So a count always matches the table.
 */
export function chipCounts(rows: readonly Row[], f: Filters, starred: ReadonlySet<string>) {
  const counts: Record<Call | "mine", number> = { all: 0, buy: 0, hold: 0, sell: 0, avoid: 0, mine: 0 };
  for (const r of rows) {
    if (matches(r, f, starred, "call")) {
      counts.all++;
      if (r.call in counts) counts[r.call as Call]++;
    }
    if (starred.has(r.symbol) && matches(r, f, starred, "mine")) counts.mine++;
  }
  return counts;
}

/** Nulls last in either direction; ties broken by symbol so the order never jumps between refreshes. */
export function compareRows(a: Row, b: Row, key: SortKey, desc: boolean): number {
  const x = a[key], y = b[key];
  if (x === null && y === null) return a.symbol.localeCompare(b.symbol);
  if (x === null) return 1;
  if (y === null) return -1;
  const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : x < y ? -1 : x > y ? 1 : 0;
  return c !== 0 ? (desc ? -c : c) : a.symbol.localeCompare(b.symbol);
}

export function visibleRows(rows: readonly Row[], f: Filters, starred: ReadonlySet<string>): Row[] {
  return rows.filter((r) => matches(r, f, starred, null)).sort((a, b) => compareRows(a, b, f.sort, f.desc));
}
