// Market clock and data freshness. NEPSE trades 11:00-15:00 Nepal time, Monday to Friday.

import type { JobRun } from "./data";

const TZ = "Asia/Kathmandu";

export function nepalNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes, weekday };
}

export type Freshness = {
  session: "open" | "pre-open" | "closed";
  problems: { level: "warning" | "error"; text: string }[];
  lastUpdate: string | null;
};

export function freshness(runs: JobRun[], latestFinal: string | null, marketErrors: string[], now = new Date()): Freshness {
  const { date, minutes, weekday } = nepalNow(now);
  const byJob = Object.fromEntries(runs.map((r) => [r.job, r]));
  const live = byJob.live;
  const eod = byJob.eod;
  const holiday = eod?.status === "holiday" && eod.trade_date === date;
  const liveToday = live && live.trade_date === date;
  const marketClosedToday = holiday || (liveToday && live.status === "skipped");
  const problems: Freshness["problems"] = [];

  let session: Freshness["session"] = "closed";
  if (weekday && !marketClosedToday) {
    if (minutes >= 11 * 60 && minutes < 15 * 60) session = "open";
    else if (minutes >= 10 * 60 + 30 && minutes < 11 * 60) session = "pre-open";
  }

  if (session === "open" && minutes >= 11 * 60 + 15) {
    const beat = liveToday ? new Date(live.heartbeat_at).getTime() : 0;
    if (!beat || now.getTime() - beat > 15 * 60 * 1000) {
      problems.push({ level: "warning", text: liveToday ? `Live prices are delayed: the last update was at ${new Date(live.heartbeat_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ })}.` : "Live prices have not started today. Prices shown are from the last close." });
    }
  }
  if (weekday && !holiday && minutes >= 16 * 60 + 30 && latestFinal && latestFinal < date) {
    problems.push({ level: "warning", text: "Today's closing prices are not final yet. Calls and ranges are from the previous close." });
  }
  for (const e of marketErrors) problems.push({ level: "error", text: `Data check failed: ${e}. No new calls are shown until it is resolved.` });

  const stamps = runs.map((r) => r.heartbeat_at).filter(Boolean).sort();
  return { session, problems, lastUpdate: stamps.at(-1) ?? null };
}
