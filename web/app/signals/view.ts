// The Signals table's filters and sort, and how they are written in the address
// (?call=buy&sector=Hydropower&q=bank&sort=-change&mine=1). Pure, so it is tested
// (view.test.ts). Anything unknown or malformed in the address falls back to the default.

export const CALLS = ["all", "buy", "hold", "sell", "avoid"] as const;
export type SortKey = "score" | "symbol" | "change" | "close";
const SORT_KEYS: SortKey[] = ["score", "symbol", "change", "close"];
export const Q_MAX = 40;

export type View = {
  call: (typeof CALLS)[number];
  sector: string;
  q: string;
  sort: { key: SortKey; desc: boolean };
  mine: boolean;
};

export const DEFAULT_VIEW: View = { call: "all", sector: "All sectors", q: "", sort: { key: "score", desc: true }, mine: false };

export function readView(search: string, sectors: string[]): View {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return DEFAULT_VIEW;
  }
  const call = CALLS.find((c) => c === params.get("call")) ?? DEFAULT_VIEW.call;
  const sectorParam = params.get("sector");
  const sector = sectorParam && sectors.includes(sectorParam) ? sectorParam : DEFAULT_VIEW.sector;
  const q = (params.get("q") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, Q_MAX);
  const sortParam = params.get("sort") ?? "";
  const key = SORT_KEYS.find((k) => k === sortParam.replace(/^-/, ""));
  const sort = key ? { key, desc: sortParam.startsWith("-") } : DEFAULT_VIEW.sort;
  return { call, sector, q, sort, mine: params.get("mine") === "1" };
}

/** The address query for a view; defaults are left out, so the plain page has a plain address. */
export function viewQuery(v: View): string {
  const params = new URLSearchParams();
  if (v.call !== DEFAULT_VIEW.call) params.set("call", v.call);
  if (v.sector !== DEFAULT_VIEW.sector) params.set("sector", v.sector);
  if (v.q.trim()) params.set("q", v.q.slice(0, Q_MAX));
  if (v.sort.key !== DEFAULT_VIEW.sort.key || v.sort.desc !== DEFAULT_VIEW.sort.desc) params.set("sort", `${v.sort.desc ? "-" : ""}${v.sort.key}`);
  if (v.mine) params.set("mine", "1");
  return params.toString();
}
