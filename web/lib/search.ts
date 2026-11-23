// The header's company search. Pure, so it is tested (lib/search.test.ts).

export type Listing = { symbol: string; name: string };
export const SEARCH_LIMIT = 8;

/** Exact symbol first, then symbols that start with the term, then symbols or names that contain it. */
export function searchCompanies<T extends Listing>(companies: readonly T[], query: string, limit = SEARCH_LIMIT): T[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const exact: T[] = [], starts: T[] = [], contains: T[] = [];
  for (const c of companies) {
    const symbol = c.symbol.toLowerCase();
    if (symbol === term) exact.push(c);
    else if (symbol.startsWith(term)) starts.push(c);
    else if (symbol.includes(term) || c.name.toLowerCase().includes(term)) contains.push(c);
  }
  return [...exact, ...starts, ...contains].slice(0, limit);
}

/**
 * The company Enter opens. The list on screen can lag a fast typist by a moment (it is
 * rendered from a deferred copy of the box); Enter must act on what is typed now, so the
 * highlighted row is used only when the list on screen is for the same text.
 */
export function pickOnEnter<T extends Listing>(
  companies: readonly T[], typed: string, shownFor: string, shown: readonly T[], active: number,
): T | null {
  if (typed.trim().toLowerCase() === shownFor.trim().toLowerCase() && shown.length) {
    return shown[Math.min(Math.max(active, 0), shown.length - 1)];
  }
  return searchCompanies(companies, typed, 1)[0] ?? null;
}
