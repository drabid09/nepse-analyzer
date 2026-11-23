// The Signals table: filters kept in the address bar, counts that match the rows, stable sort.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { chipCounts, DEFAULTS, filtersToSearch, parseFilters, visibleRows, type Row } from "./signals.ts";

const row = (symbol: string, call: string, score: number, sector: string, change: number | null = null): Row => ({
  symbol, name: `${symbol} Limited`, sector, close: 100, change, call, dataOk: call !== "avoid", score, confidence: "medium",
  trend: "up", rsi: 50, low: 90, high: 110, reliable: true, note: null,
});
const ROWS = [
  row("AAA", "buy", 90, "Banks", 2), row("BBB", "buy", 80, "Hydro", -1), row("CCC", "hold", 50, "Hydro", null),
  row("DDD", "sell", 20, "Banks", 0.5), row("EEE", "sell", 20, "Hydro", -3), row("FFF", "avoid", 40, "Hydro", null),
];
const SECTORS = ["All sectors", "Banks", "Hydro"];
const none = new Set<string>();

test("filters round-trip through the address bar", () => {
  const f = { call: "sell", sector: "Hydro", q: "ee", sort: "change", desc: false, mine: true } as const;
  const search = filtersToSearch(f);
  assert.deepEqual(parseFilters(search, SECTORS), f);
});

test("the default view has a clean address", () => {
  assert.equal(filtersToSearch(DEFAULTS), "");
  assert.deepEqual(parseFilters("", SECTORS), DEFAULTS);
  // A column clicked once sorts in its natural direction, which needs no "dir".
  assert.equal(filtersToSearch({ ...DEFAULTS, sort: "symbol", desc: false }), "?sort=symbol");
});

test("malformed or hostile parameters fall back to defaults", () => {
  const f = parseFilters("?call=<script>&sector=Nowhere&sort=__proto__&dir=sideways&q=" + "x".repeat(500) + "&mine=yes", SECTORS);
  assert.equal(f.call, "all");
  assert.equal(f.sector, "All sectors");
  assert.equal(f.sort, "score");
  assert.equal(f.desc, true);
  assert.equal(f.q.length, 40);
  assert.equal(f.mine, false);
});

test("chip counts match the rows each chip would show", () => {
  const f = { ...DEFAULTS, sector: "Hydro" };
  const counts = chipCounts(ROWS, f, new Set(["BBB", "AAA"]));
  assert.deepEqual(counts, { all: 4, buy: 1, hold: 1, sell: 1, avoid: 1, mine: 1 });
  for (const call of ["all", "buy", "hold", "sell", "avoid"] as const) {
    assert.equal(visibleRows(ROWS, { ...f, call }, none).length, counts[call]);
  }
  assert.equal(visibleRows(ROWS, { ...f, mine: true }, new Set(["BBB", "AAA"])).length, counts.mine);
});

test("Your stocks narrows the current call instead of replacing it", () => {
  const starred = new Set(["AAA", "DDD"]);
  assert.deepEqual(visibleRows(ROWS, { ...DEFAULTS, call: "sell", mine: true }, starred).map((r) => r.symbol), ["DDD"]);
  assert.equal(chipCounts(ROWS, { ...DEFAULTS, call: "sell" }, starred).mine, 1);
});

test("sorting keeps nulls last and breaks ties by symbol", () => {
  const asc = visibleRows(ROWS, { ...DEFAULTS, sort: "change", desc: false }, none).map((r) => r.symbol);
  const desc = visibleRows(ROWS, { ...DEFAULTS, sort: "change", desc: true }, none).map((r) => r.symbol);
  assert.deepEqual(asc, ["EEE", "BBB", "DDD", "AAA", "CCC", "FFF"]);
  assert.deepEqual(desc, ["AAA", "DDD", "BBB", "EEE", "CCC", "FFF"]);
  // DDD and EEE share a score: the same order every time.
  const byScore = visibleRows(ROWS, DEFAULTS, none).map((r) => r.symbol);
  assert.deepEqual(byScore.slice(-2), ["DDD", "EEE"]);
});

test("search matches symbol or name, ignoring case and spaces around it", () => {
  assert.deepEqual(visibleRows(ROWS, { ...DEFAULTS, q: "  ccc " }, none).map((r) => r.symbol), ["CCC"]);
  assert.equal(visibleRows(ROWS, { ...DEFAULTS, q: "limited" }, none).length, 6);
});
