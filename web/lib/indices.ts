// Index previous closes. Pure, so it is tested (lib/indices.test.ts).

type Day = { index_id: number; close: number; prev_close: number | null };

/**
 * After the close NEPSE reports the main indices' previous close equal to the close
 * (23 Nov 2026: NEPSE 0.00% instead of +0.09% from 2,621.29). A previous close that is
 * missing or identical to the close is replaced with the last final close stored; one
 * that differs is trusted.
 */
export function settlePrevClose<T extends Day>(rows: T[], previous: Map<number, number>): T[] {
  return rows.map((r) => {
    const stored = previous.get(r.index_id);
    const close = Number(r.close), prev = r.prev_close === null || r.prev_close === undefined ? null : Number(r.prev_close);
    if (stored === undefined || !Number.isFinite(stored) || !Number.isFinite(close)) return r;
    return prev === null || Math.abs(prev - close) < 0.005 ? { ...r, prev_close: stored } : r;
  });
}
