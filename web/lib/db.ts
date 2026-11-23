// Read-only access to the Supabase REST API, on the server only.
//
// The key is the project's publishable (anon) key: row level security lets it
// read and nothing else, and it never reaches the browser because every query
// runs in a server component. Set SUPABASE_URL and SUPABASE_ANON_KEY in the
// Vercel project's environment variables.

export class DataError extends Error {}

export function configured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

type Params = Record<string, string | number | undefined>;

export async function rest<T>(table: string, params: Params = {}, options: { revalidate?: number; all?: boolean } = {}): Promise<T[]> {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) throw new DataError("The dashboard is not connected to the database yet (SUPABASE_URL / SUPABASE_ANON_KEY).");

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, String(v));
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  // Legacy anon keys are JWTs and also go in Authorization; new publishable keys go in apikey only.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  const page = 1000;
  const rows: T[] = [];
  for (let start = 0; ; start += page) {
    const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
      headers: options.all ? { ...headers, "Range-Unit": "items", Range: `${start}-${start + page - 1}` } : headers,
      next: { revalidate: options.revalidate ?? 60 },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new DataError(`Database refused a read of ${table}: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    const chunk = (await response.json()) as T[];
    rows.push(...chunk);
    if (!options.all || chunk.length < page) return rows;
  }
}
