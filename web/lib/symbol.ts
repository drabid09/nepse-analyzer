// Company symbols as NEPSE writes them: capital letters and digits, and for debentures a
// slash ("GBD80/81", 11 of them in Nov 2026). Checked before any database read, so a
// made-up address never costs a query or a cached page.

export const SYMBOL = /^[A-Z0-9][A-Z0-9/._&-]{0,19}$/;

/** The canonical (upper-case) symbol from a URL segment, or null if it cannot be one. */
export function parseSymbol(segment: string | null | undefined): string | null {
  if (!segment || segment.length > 60) return null;
  let raw = segment;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    return null; // malformed percent-encoding
  }
  const s = raw.trim().toUpperCase();
  return SYMBOL.test(s) ? s : null;
}

/** Path of a company page, safe to put in an href whatever the symbol contains. */
export function companyHref(symbol: string): string {
  return `/c/${encodeURIComponent(symbol)}`;
}

/** A symbol from anywhere (stored lists, form fields), upper-cased, or null. */
export function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toUpperCase();
  return SYMBOL.test(s) ? s : null;
}
