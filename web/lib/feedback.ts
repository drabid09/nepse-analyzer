// The feedback form's choices and checks. Pure, so it can be tested; the database
// enforces the same limits (supabase/migrations/20261123000300_feedback.sql).

export const KINDS = [
  { id: "request", label: "Show me something new", hint: "A number, chart, company detail or alert you would like to see" },
  { id: "idea", label: "My view or an idea", hint: "Your own take on a stock or the market, or how the calls should work" },
  { id: "problem", label: "Something looks wrong", hint: "A price, a call or a page that does not look right" },
  { id: "other", label: "Something else", hint: "Anything you want Drabid to know" },
] as const;

export type Kind = (typeof KINDS)[number]["id"];
export const MESSAGE_MIN = 3;
export const MESSAGE_MAX = 4000;
export const ABOUT_MAX = 200;

export type FeedbackRow = { kind: Kind; message: string; page: string | null; name: string };
export type Checked = { ok: true; spam: boolean; row: FeedbackRow | null } | { ok: false; error: string };

export function checkFeedback(input: { kind: unknown; message: unknown; about?: unknown; website?: unknown }, name: string): Checked {
  // "website" is a field people never see; automated form fillers do. Pretend success, save nothing.
  if (typeof input.website === "string" && input.website.trim() !== "") return { ok: true, spam: true, row: null };
  const kind = KINDS.find((k) => k.id === input.kind)?.id;
  if (!kind) return { ok: false, error: "Choose what kind of message this is." };
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (message.length < MESSAGE_MIN) return { ok: false, error: "Write a few words first." };
  if (message.length > MESSAGE_MAX) return { ok: false, error: `Please keep it under ${MESSAGE_MAX.toLocaleString("en-IN")} characters.` };
  const about = typeof input.about === "string" ? input.about.trim().slice(0, ABOUT_MAX) : "";
  return { ok: true, spam: false, row: { kind, message, page: about || null, name } };
}

export const SEND_LIMIT = 5;
export const SEND_WINDOW_MS = 10 * 60 * 1000;

/** Sliding window: true (and the send is counted) if this visitor sent fewer than 5 in 10 minutes. */
export function allowSend(log: Map<string, number[]>, visitor: string, now: number): boolean {
  const kept = (log.get(visitor) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  if (kept.length >= SEND_LIMIT) {
    log.set(visitor, kept);
    return false;
  }
  kept.push(now);
  log.set(visitor, kept);
  if (log.size > 5000) for (const key of log.keys()) { log.delete(key); if (log.size <= 4000) break; }
  return true;
}
