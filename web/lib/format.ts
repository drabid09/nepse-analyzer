// Formatting in Nepali conventions: lakh/crore grouping, Nepal time.

const TZ = "Asia/Kathmandu";

export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function price(value: number | string | null | undefined, digits = 2): string {
  const n = num(value);
  return n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function whole(value: number | string | null | undefined): string {
  const n = num(value);
  return n === null ? "—" : Math.round(n).toLocaleString("en-IN");
}

/** Rupees in crore (1 crore = 10 million) or lakh, as Nepali investors read them. */
export function rupees(value: number | string | null | undefined): string {
  const n = num(value);
  if (n === null) return "—";
  if (Math.abs(n) >= 1e7) return `Rs ${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} crore`;
  if (Math.abs(n) >= 1e5) return `Rs ${(n / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} lakh`;
  return `Rs ${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function pct(value: number | null | undefined, digits = 2, signed = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const s = value.toFixed(digits);
  return `${signed && value > 0 ? "+" : ""}${s}%`;
}

export function change(close: unknown, prev: unknown): number | null {
  const c = num(close as number), p = num(prev as number);
  return c !== null && p ? (c / p - 1) * 100 : null;
}

export function day(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(`${date.slice(0, 10)}T00:00:00+05:45`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

export function time(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function dateTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function ago(ts: string | null | undefined, now = Date.now()): string {
  if (!ts) return "never";
  const minutes = Math.round((now - new Date(ts).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
