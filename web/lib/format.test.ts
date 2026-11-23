// Numbers as Nepali investors read them (lakh and crore), in Nepal time.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, change, day, num, pct, price, rupees, time, whole } from "./format.ts";

test("lakh and crore", () => {
  assert.equal(rupees(1_368_500_000), "Rs 136.85 crore");
  assert.equal(rupees(250_000), "Rs 2.5 lakh");
  assert.equal(rupees(9_500), "Rs 9,500");
  assert.equal(whole(3_616_813), "36,16,813");
  assert.equal(price(12561.1), "12,561.10");
});

test("missing numbers show a dash, never 0 or NaN", () => {
  for (const f of [price, whole, rupees]) {
    assert.equal(f(null), "—");
    assert.equal(f(undefined), "—");
    assert.equal(f("not a number"), "—");
  }
  assert.equal(pct(null), "—");
  assert.equal(pct(Number.NaN), "—");
  assert.equal(num(""), null);
});

test("percent change", () => {
  assert.equal(pct(4.1312), "+4.13%");
  assert.equal(pct(-0.5), "-0.50%");
  assert.equal(pct(0), "0.00%");
  assert.ok(Math.abs(change(281, 268.9)! - 4.4998) < 0.001);
  assert.equal(change(100, 0), null);
  assert.equal(change(100, null), null);
  assert.equal(change("110.00", "100.00"), 10.000000000000009);
});

test("dates and times are Nepal time", () => {
  assert.equal(day("2026-11-23"), "Mon, 23 Nov 2026");
  assert.equal(time("2026-11-23T05:45:00Z"), "11:30");
  const now = Date.parse("2026-11-23T06:00:00Z");
  assert.equal(ago("2026-11-23T05:58:00Z", now), "2 min ago");
  assert.equal(ago("2026-11-23T05:59:50Z", now), "just now");
  assert.equal(ago(null, now), "never");
});
