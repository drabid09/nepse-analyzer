// The rules that decide when the dashboard warns that data is late.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { breadth, freshness, jobLate, nepalNow, refreshEvery, settleBreadth, statusLine } from "./market.ts";

// Nepal time is UTC+05:45.
const npt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:45`);
const MON = "2026-11-23", FRI = "2026-11-20", SAT = "2026-11-21";

type Run = { job: string; trade_date: string | null; status: string; heartbeat_at: string };
const run = (job: string, trade_date: string, status: string, beat: Date): Run =>
  ({ job, trade_date, status, heartbeat_at: beat.toISOString() });
const check = (runs: Run[], latestFinal: string | null, errors: string[], now: Date) =>
  freshness(runs as never, latestFinal, errors, now);

test("Nepal clock", () => {
  assert.deepEqual(nepalNow(npt(MON, "11:30")), { date: MON, minutes: 690, weekday: true });
  assert.equal(nepalNow(npt(SAT, "12:00")).weekday, false);
  // 23:50 UTC on Sunday is already Monday 05:35 in Nepal.
  assert.equal(nepalNow(new Date("2026-11-22T23:50:00Z")).date, MON);
});

test("open and fresh: no warning", () => {
  const f = check([run("live", MON, "running", npt(MON, "11:27"))], FRI, [], npt(MON, "11:30"));
  assert.equal(f.session, "open");
  assert.deepEqual(f.problems, []);
});

test("live prices more than 15 minutes old are flagged", () => {
  const f = check([run("live", MON, "running", npt(MON, "11:10"))], FRI, [], npt(MON, "11:30"));
  assert.equal(f.problems.length, 1);
  assert.match(f.problems[0].text, /delayed/);
});

test("live prices that never started today are flagged after 11:15", () => {
  const runs = [run("live", FRI, "ok", npt(FRI, "15:05"))];
  assert.deepEqual(check(runs, FRI, [], npt(MON, "11:10")).problems, []); // grace period after the open
  const f = check(runs, FRI, [], npt(MON, "11:30"));
  assert.match(f.problems[0].text, /not started/);
});

test("pre-open and weekends", () => {
  assert.equal(check([], FRI, [], npt(MON, "10:45")).session, "pre-open");
  const sat = check([], FRI, [], npt(SAT, "12:00"));
  assert.equal(sat.session, "closed");
  assert.deepEqual(sat.problems, []);
});

test("a holiday is not a late market", () => {
  const runs = [run("eod", MON, "holiday", npt(MON, "15:20"))];
  const midday = check(runs, FRI, [], npt(MON, "12:00"));
  assert.equal(midday.session, "closed");
  assert.deepEqual(midday.problems, []);
  assert.deepEqual(check(runs, FRI, [], npt(MON, "17:00")).problems, []);
});

test("a live job that found the market closed means closed", () => {
  const f = check([run("live", MON, "skipped", npt(MON, "11:05"))], FRI, [], npt(MON, "12:00"));
  assert.equal(f.session, "closed");
  assert.deepEqual(f.problems, []);
});

test("today's close not final by 16:30 is flagged", () => {
  assert.deepEqual(check([], FRI, [], npt(MON, "16:00")).problems, []);
  assert.match(check([], FRI, [], npt(MON, "17:00")).problems[0].text, /not final/);
  assert.deepEqual(check([], MON, [], npt(MON, "17:00")).problems, []);
});

test("a failed market-wide data check is an error", () => {
  const f = check([], FRI, ["12 of 300 closes differ from Sharesansar"], npt(SAT, "10:00"));
  assert.equal(f.problems[0].level, "error");
  assert.match(f.problems[0].text, /No new calls/);
});

test("last update is the newest heartbeat", () => {
  const f = check([run("eod", FRI, "ok", npt(FRI, "15:20")), run("live", MON, "running", npt(MON, "11:25"))], FRI, [], npt(MON, "11:30"));
  assert.equal(f.lastUpdate, npt(MON, "11:25").toISOString());
});

test("status line under the greeting", () => {
  const label = (d: string | null) => `[${d}]`;
  const line = (live: boolean, priceDate: string, signalDate: string, at: Date) => statusLine({ live, priceDate, signalDate, now: at }, label);
  assert.match(line(true, MON, FRI, npt(MON, "12:00")), /market is open/);
  // After 15:00, before the end-of-day job: not "open" any more.
  assert.match(line(true, MON, FRI, npt(MON, "15:10")), /Trading has ended for today/);
  // End of day done, calls not yet.
  assert.match(line(false, MON, FRI, npt(MON, "15:30")), /today's final prices; new calls arrive/);
  // Calls done.
  assert.match(line(false, MON, MON, npt(MON, "16:00")), /today's final prices and today's new calls/);
  // Trading hours with no live prices (late start or a holiday).
  assert.equal(line(false, FRI, FRI, npt(MON, "11:30")), "Live prices have not arrived yet today. These are the prices from [2026-11-20].");
  // Weekend.
  assert.equal(line(false, FRI, FRI, npt(SAT, "10:00")), "The market is closed. These are the prices from [2026-11-20].");
  // Yesterday's prices never finalised: say so rather than "open".
  assert.match(line(true, FRI, FRI, npt(MON, "09:00")), /not confirmed yet/);
});



test("the update stamp comes from data jobs, never from housekeeping", () => {
  const runs = [
    run("eod", MON, "ok", npt(MON, "15:35")),
    run("analytics", MON, "ok", npt(MON, "15:36")),
    run("timer", MON, "ok", npt(MON, "16:09")),
    run("watchdog", MON, "ok", npt(MON, "16:05")),
    run("details", MON, "ok", npt(MON, "17:20")),
  ];
  assert.equal(check(runs, MON, [], npt(MON, "16:45")).lastUpdate, npt(MON, "15:36").toISOString());
  // A failed run is not an update either.
  const failed = [run("eod", MON, "ok", npt(MON, "15:35")), run("analytics", MON, "failed", npt(MON, "15:50"))];
  assert.equal(check(failed, MON, [], npt(MON, "16:45")).lastUpdate, npt(MON, "15:35").toISOString());
});

test("missing calls after a final close are flagged after 16:30", () => {
  const f = (signal: string | null, at: string, errors: string[] = []) => freshness([], MON, errors, npt(MON, at), signal).problems;
  assert.deepEqual(f(MON, "17:00"), []);
  assert.deepEqual(f(FRI, "16:00"), []); // calls usually arrive at about 15:50; give them time
  assert.match(f(FRI, "17:00")[0].text, /calls are not ready yet.*Fri,? 20 Nov/);
  assert.match(f(null, "17:00")[0].text, /not ready yet/);
  // A failed market-wide check already says why there are no calls.
  assert.equal(f(FRI, "17:00", ["row count"]).length, 1);
  // Without a signal date, nothing is judged (older callers).
  assert.deepEqual(freshness([], MON, [], npt(MON, "17:00")).problems, []);
});

test("jobs that stop reporting are marked late", () => {
  assert.equal(jobLate("timer", npt(MON, "15:00").toISOString(), npt(MON, "16:30")), null);
  assert.match(jobLate("timer", npt(MON, "11:00").toISOString(), npt(MON, "16:30")) ?? "", /Late/);
  // Watchdog: hourly on weekday afternoons, daily otherwise.
  assert.match(jobLate("watchdog", npt(MON, "11:34").toISOString(), npt(MON, "16:45")) ?? "", /every hour/);
  assert.equal(jobLate("watchdog", npt(MON, "16:05").toISOString(), npt(MON, "16:45")), null);
  assert.equal(jobLate("watchdog", npt(FRI, "18:05").toISOString(), npt(SAT, "12:00")), null);
  assert.equal(jobLate("live", npt(FRI, "15:05").toISOString(), npt(MON, "16:45")), null);
  assert.equal(jobLate("timer", null, npt(MON, "16:45")), null);
});

test("open pages re-read every minute while prices or calls can still change", () => {
  assert.equal(refreshEvery(true, npt(MON, "12:00")), 55_000);
  // After the close the final prices (~15:20) and calls (~15:50) still arrive.
  assert.equal(refreshEvery(false, npt(MON, "15:30")), 55_000);
  assert.equal(refreshEvery(false, npt(MON, "16:40")), 55_000);
  assert.equal(refreshEvery(false, npt(MON, "16:50")), 590_000);
  assert.equal(refreshEvery(false, npt(MON, "09:00")), 590_000);
  assert.equal(refreshEvery(false, npt(SAT, "15:30")), 590_000);
});

test("breadth counts rising, falling and unchanged, skipping unknown changes", () => {
  assert.deepEqual(breadth([1.2, -0.5, 0, null, Number.NaN, 3, -2]), { up: 2, down: 2, same: 1, total: 5 });
  assert.deepEqual(breadth([]), { up: 0, down: 0, same: 0, total: 0 });
});

test("breadth: NEPSE's day change from the jobs when it covers the same shares, closing prices otherwise", () => {
  const fromPrices = { up: 106, down: 165, same: 9, total: 280 };
  // The jobs' count (by last trade) over the same 280 shares wins.
  assert.deepEqual(settleBreadth(fromPrices, { advancers: 105, decliners: 165, unchanged: 10 }), { up: 105, down: 165, same: 10, total: 280, basis: "nepse" });
  // A row from before the change counted all 360 securities: not comparable.
  assert.equal(settleBreadth(fromPrices, { advancers: 132, decliners: 211, unchanged: 17 }).basis, "close");
  assert.equal(settleBreadth(fromPrices, { advancers: 105, decliners: 165, unchanged: null }).basis, "close");
  assert.equal(settleBreadth(fromPrices, null).basis, "close");
  assert.equal(settleBreadth({ up: 0, down: 0, same: 0, total: 0 }, { advancers: 0, decliners: 0, unchanged: 0 }).basis, "close");
});
