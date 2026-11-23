// "Your stocks": what is read from and written to the browser's storage.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWatchlist, toggleSymbol, WATCHLIST_MAX } from "./watchlist.ts";

test("reads a stored list, cleaning it up", () => {
  assert.deepEqual(parseWatchlist('["nabil", "NTC", "NABIL", "bad symbol!", 7]'), ["NABIL", "NTC"]);
});

test("anything malformed reads as an empty list", () => {
  for (const raw of [null, "", "not json", "{}", '"NABIL"']) assert.deepEqual(parseWatchlist(raw), []);
});

test("starring adds at the end, starring again removes", () => {
  assert.deepEqual(toggleSymbol(["NABIL"], "ntc"), ["NABIL", "NTC"]);
  assert.deepEqual(toggleSymbol(["NABIL", "NTC"], "NABIL"), ["NTC"]);
  assert.deepEqual(toggleSymbol(["NABIL"], "no spaces"), ["NABIL"]);
});

test("the list is capped", () => {
  const full = Array.from({ length: WATCHLIST_MAX }, (_, i) => `S${i}`);
  assert.equal(toggleSymbol(full, "EXTRA").length, WATCHLIST_MAX);
  assert.equal(parseWatchlist(JSON.stringify([...full, "EXTRA"])).length, WATCHLIST_MAX);
});
