// Index previous closes. Pure, so it is tested (lib/indices.test.ts).

type Day = { index_id: number; close: number; prev_close: number | null };

/**
 * After the close NEPSE reports the main indices' previous close equal (or within a
 * rounding step) to the close: on 23 Nov 2026 NEPSE showed 0.00% instead of +0.09% from
 * Friday's 2,621.29, and Sensitive and Float showed -0.00% and -0.01%.
 *
 * `previous` holds each index's final close on the previous trading day, from our own
 * tables. When an index has one, it is the previous close; NEPSE's own field is used only
 * when we have nothing stored for that day.
 */
export function settlePrevClose<T extends Day>(rows: T[], previous: Map<number, number>): T[] {
  return rows.map((r) => {
    const stored = previous.get(r.index_id);
    return stored !== undefined && Number.isFinite(stored) ? { ...r, prev_close: stored } : r;
  });
}
