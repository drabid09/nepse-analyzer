// Access to the Supabase REST API, on the server only.
//
// The key is the project's publishable (anon) key: row level security lets it
// read, and send a feedback message, and nothing else. It never reaches the
// browser because every query runs on the server. Set SUPABASE_URL and
// SUPABASE_ANON_KEY in the Vercel project's environment variables.

/** An error whose message is safe to show visitors. Details stay in the server log. */
export class DataError extends Error {}

if (typeof window !== "undefined") throw new Error("lib/db.ts runs on the server only: it holds the database key.");

export function configured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** The website must only ever hold the read-only key. A secret (service) key would bypass row level security. */
export function keyProblem(key: string): string | null {
  if (key.startsWith("sb_secret_")) return "SUPABASE_ANON_KEY is a secret key. Replace it with the publishable key (sb_publishable_…).";
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (claims?.role === "service_role") return "SUPABASE_ANON_KEY is the service_role key. Replace it with the publishable key.";
    } catch {
      // not a readable token: leave it to the database to refuse
    }
  }
  return null;
}

const TIMEOUT_MS = 10_000;

type Params = Record<string, string | number | undefined>;

function connection() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) throw new DataError("The dashboard is not connected to the database yet (SUPABASE_URL / SUPABASE_ANON_KEY).");
  const problem = keyProblem(key);
  if (problem) throw new DataError(problem);
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  // Legacy anon keys are JWTs and also go in Authorization; new publishable keys go in apikey only.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  return { base, headers };
}

/**
 * The one write the website makes: a feedback message. The public key may insert
 * the message columns of the feedback table and nothing else (see the migration).
 */
export async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  const { base, headers } = connection();
  let response: Response;
  try {
    response = await fetch(`${base}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DataError("The database did not answer. Please try again in a minute.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (text.includes("Too many messages")) throw new DataError("Too many messages right now. Please try again later.");
    console.error(`insert ${table} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    throw new DataError(`The database refused the message (HTTP ${response.status}).`);
  }
}

export async function rest<T>(table: string, params: Params = {}, options: { revalidate?: number; all?: boolean } = {}): Promise<T[]> {
  const { base, headers } = connection();
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, String(v));

  const page = 1000;
  const rows: T[] = [];
  for (let start = 0; ; start += page) {
    let response: Response;
    try {
      response = await fetch(`${base}/rest/v1/${table}?${query}`, {
        headers: options.all ? { ...headers, "Range-Unit": "items", Range: `${start}-${start + page - 1}` } : headers,
        next: { revalidate: options.revalidate ?? 60 },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000} s` : "network error";
      throw new DataError(`Database did not answer a read of ${table} (${reason}). It may be paused or busy.`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // The database's own message can name columns and settings: log it, show only the status.
      console.error(`read ${table} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
      throw new DataError(`The database refused a read of ${table} (HTTP ${response.status}).`);
    }
    let chunk: T[];
    try {
      chunk = (await response.json()) as T[];
    } catch {
      throw new DataError(`The database sent an unreadable answer for ${table}.`);
    }
    if (!Array.isArray(chunk)) throw new DataError(`The database sent an unexpected answer for ${table}.`);
    rows.push(...chunk);
    if (!options.all || chunk.length < page) return rows;
  }
}
