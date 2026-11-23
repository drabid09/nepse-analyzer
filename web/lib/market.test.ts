// The rules that decide when the dashboard warns that data is late.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { freshness, nepalNow } from "./market.ts";

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
