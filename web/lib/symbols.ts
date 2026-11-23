// Company symbols as NEPSE writes them: capital letters and digits, and for
// debentures a slash, e.g. "GBD80/81". A slash cannot go into a link as it is
// (it would start a new path segment), so every company link is built here.

export const SYMBOL_MAX = 20;
export const SYMBOL = /^[A-Z0-9][A-Z0-9/._&-]{0,19}$/;

/** The symbol in a canonical form, or null when it cannot be a NEPSE symbol. */
export function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  return SYMBOL.test(s) ? s : null;
}

/** Link to a company page. "GBD80/81" becomes /c/GBD80%2F81. */
export function companyHref(symbol: string): string {
  return `/c/${encodeURIComponent(symbol)}`;
}

/**
 * The symbol from the [symbol] part of a company address, or null for anything
 * malformed (bad percent-encoding, control characters, too long), which the page
 * then answers with "not found" instead of an error.
 */
export function symbolFromParam(param: string): string | null {
  if (param.length > SYMBOL_MAX * 3) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    return null;
  }
  return normalizeSymbol(decoded);
}
