// "Your stocks": companies starred on this device, kept in the browser's storage.
// Pure helpers here; the React hook is in components/watchlist.tsx.

import { normalizeSymbol } from "./symbol.ts";

export const WATCHLIST_KEY = "nepse-watchlist-v1";
export const WATCHLIST_MAX = 50;

/** Reads a stored list defensively: anything malformed becomes an empty list. */
export function parseWatchlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      const s = normalizeSymbol(item);
      if (s && !out.includes(s)) out.push(s);
      if (out.length >= WATCHLIST_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Adds the symbol at the end, or removes it if already there. */
export function toggleSymbol(list: string[], symbol: string): string[] {
  const s = normalizeSymbol(symbol);
  if (!s) return list;
  if (list.includes(s)) return list.filter((x) => x !== s);
  return list.length >= WATCHLIST_MAX ? list : [...list, s];
}
