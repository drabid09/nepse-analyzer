// The Signals filters in the address. Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_VIEW, readView, viewQuery } from "./view.ts";

const SECTORS = ["All sectors", "Commercial Banks", "Hydropower"];

test("a view survives a round trip through the address", () => {
  const v = { call: "buy" as const, sector: "Hydropower", q: "bank", sort: { key: "change" as const, desc: true }, mine: true };
  assert.equal(viewQuery(v), "call=buy&sector=Hydropower&q=bank&sort=-change&mine=1");
  assert.deepEqual(readView(`?${viewQuery(v)}`, SECTORS), v);
});

test("the default view has a plain address", () => {
  assert.equal(viewQuery(DEFAULT_VIEW), "");
  assert.deepEqual(readView("", SECTORS), DEFAULT_VIEW);
});

test("unknown or malformed values fall back to the default", () => {
  const v = readView("?call=<script>&sector=Nope&q=" + "x".repeat(500) + "%00&sort=-password&mine=yes", SECTORS);
  assert.equal(v.call, "all");
  assert.equal(v.sector, "All sectors");
  assert.equal(v.q.length, 40);
  assert.deepEqual(v.sort, DEFAULT_VIEW.sort);
  assert.equal(v.mine, false);
  assert.doesNotThrow(() => readView("?q=%E0%A4", SECTORS));
});
