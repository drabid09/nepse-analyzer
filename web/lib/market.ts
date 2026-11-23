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

function shortDay(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00+05:45`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
}

export type Freshness = {
  session: "open" | "pre-open" | "closed";
  problems: { level: "warning" | "error"; text: string }[];
  lastUpdate: string | null;
};

/** Jobs that change what the dashboard shows. The header's "updated … ago" comes from these only,
 * never from housekeeping jobs (timer, watchdog, company details), which would make old prices look new. */
export const DATA_JOBS = ["live", "eod", "analytics"] as const;

/**
 * `signalDate`: the newest day with calls. When given, a trading day whose close is final
 * by 16:30 but whose calls are missing is flagged (the calls arrive at about 15:50).
 */
export function freshness(
  runs: JobRun[], latestFinal: string | null, marketErrors: string[], now = new Date(), signalDate?: string | null,
): Freshness {
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
  if (signalDate !== undefined && weekday && !holiday && minutes >= 16 * 60 + 30 && latestFinal === date
      && !marketErrors.length && (signalDate === null || signalDate < date)) {
    problems.push({ level: "warning", text: signalDate
      ? `Today's calls are not ready yet. The calls shown are from the close of ${shortDay(signalDate)}.`
      : "Today's calls are not ready yet." });
  }
  for (const e of marketErrors) problems.push({ level: "error", text: `Data check failed: ${e}. No new calls are shown until it is resolved.` });

  const stamps = runs
    .filter((r) => (DATA_JOBS as readonly string[]).includes(r.job) && ["ok", "partial", "running"].includes(r.status))
    .map((r) => r.heartbeat_at).filter(Boolean).sort();
  return { session, problems, lastUpdate: stamps.at(-1) ?? null };
}

/**
 * Whether a job's latest report is older than its schedule allows, in words, or null.
 * Only jobs with a fixed rhythm are judged; live prices and the end of day are already
 * covered by freshness().
 */
export function jobLate(job: string, heartbeatAt: string | null | undefined, now = new Date()): string | null {
  if (!heartbeatAt) return null;
  const ageH = (now.getTime() - new Date(heartbeatAt).getTime()) / 3_600_000;
  const { minutes, weekday } = nepalNow(now);
  const limit = (hours: number, rhythm: string) => (ageH > hours ? `Late: expected ${rhythm}, last report ${Math.floor(ageH)} h ago.` : null);
  switch (job) {
    case "timer":
      return limit(3, "every hour");
    case "watchdog":
      // Hourly 11:05 to 18:05 on weekdays, and daily at 08:25.
      return weekday && minutes >= 12 * 60 + 30 && minutes <= 19 * 60 ? limit(2, "every hour this afternoon") : limit(26, "daily");
    case "backtest":
      return limit(8 * 24, "every Saturday");
    case "details":
      return limit(3 * 24, "daily, Sunday to Friday");
    case "companies":
      return limit(8 * 24, "every Sunday");
    default:
      return null;
  }
}

/**
 * The one-line market status under the greeting. Pure, so every case is tested
 * (lib/market.test.ts). `dayLabel` formats a date for display.
 */
export function statusLine(
  o: { live: boolean; priceDate: string | null; signalDate: string | null; now: Date },
  dayLabel: (date: string | null) => string,
): string {
  const { date, minutes, weekday } = nepalNow(o.now);
  const tradingHours = weekday && minutes >= 11 * 60 && minutes < 15 * 60;
  const today = o.priceDate === date;
  if (o.live && tradingHours && today) return "The market is open. Prices update about every 5 minutes.";
  if (o.live && today) return "Trading has ended for today. Final prices arrive at about 15:20 and new calls at about 15:50.";
  if (o.live) return `These are the latest prices, from ${dayLabel(o.priceDate)}; the final close for that day is not confirmed yet.`;
  if (tradingHours) return `Live prices have not arrived yet today. These are the prices from ${dayLabel(o.priceDate)}.`;
  if (today && o.signalDate === date) return "The market has closed. These are today's final prices and today's new calls.";
  if (today) return "The market has closed. These are today's final prices; new calls arrive at about 15:50.";
  return `The market is closed. These are the prices from ${dayLabel(o.priceDate)}.`;
}

