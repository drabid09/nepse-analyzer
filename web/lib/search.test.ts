import assert from "node:assert/strict";
import { test } from "node:test";
import { pickOnEnter, searchCompanies } from "./search.ts";

const list = [
  { symbol: "NABBC", name: "Narayani Development Bank" },
  { symbol: "NABIL", name: "Nabil Bank Limited" },
  { symbol: "SBL", name: "Siddhartha Bank Limited" },
  { symbol: "SCB", name: "Standard Chartered Bank" },
  { symbol: "SHL", name: "Soaltee Hotel Limited" },
  { symbol: "API", name: "Api Power Company" },
];

test("exact symbol first, then prefixes, then names", () => {
  assert.deepEqual(searchCompanies(list, "sbl").map((c) => c.symbol), ["SBL"]);
  assert.deepEqual(searchCompanies(list, "nab").map((c) => c.symbol), ["NABBC", "NABIL"]);
  assert.deepEqual(searchCompanies(list, " NABIL ").map((c) => c.symbol), ["NABIL"]);
  assert.deepEqual(searchCompanies(list, "hotel").map((c) => c.symbol), ["SHL"]);
  assert.deepEqual(searchCompanies(list, "   "), []);
  assert.equal(searchCompanies(list, "b", 2).length, 2);
});

test("Enter acts on what is typed, even when the list on screen lags behind", () => {
  // Typed "sbl" quickly: the list on screen is still for "s" (SBL, SCB, SHL) or for nothing.
  const forS = searchCompanies(list, "s");
  assert.equal(pickOnEnter(list, "sbl", "s", forS, 0)?.symbol, "SBL");
  assert.equal(pickOnEnter(list, "sbl", "", [], 0)?.symbol, "SBL");
  // Typed "nabil" while the list still shows "nab" (NABBC first): NABIL, not NABBC.
  assert.equal(pickOnEnter(list, "nabil", "nab", searchCompanies(list, "nab"), 0)?.symbol, "NABIL");
});

test("Enter keeps the row chosen with the arrow keys when the list is current", () => {
  const forNab = searchCompanies(list, "nab");
  assert.equal(pickOnEnter(list, "nab", "nab", forNab, 1)?.symbol, "NABIL");
  assert.equal(pickOnEnter(list, "nab", "nab", forNab, 9)?.symbol, "NABIL");
});

test("Enter with no match opens nothing", () => {
  assert.equal(pickOnEnter(list, "zzzz", "zzzz", [], 0), null);
  assert.equal(pickOnEnter(list, "", "", [], 0), null);
});
