// Company symbols as NEPSE writes them: capital letters and digits. Checked before any
// database read, so a made-up address never costs a query or a cached page.

export const SYMBOL = /^[A-Z0-9]{1,20}$/;

/** The canonical (upper-case) symbol from a URL segment, or null if it cannot be one. */
export function parseSymbol(segment: string | null | undefined): string | null {
  if (!segment) return null;
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
