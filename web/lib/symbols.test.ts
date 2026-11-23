// Company symbols in links and addresses, including debentures with a slash.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { companyHref, normalizeSymbol, symbolFromParam } from "./symbols.ts";

test("links keep a debenture's slash inside one path segment", () => {
  assert.equal(companyHref("NABIL"), "/c/NABIL");
  assert.equal(companyHref("GBD80/81"), "/c/GBD80%2F81");
});

test("an address part becomes a symbol, or null when malformed", () => {
  assert.equal(symbolFromParam("nabil"), "NABIL");
  assert.equal(symbolFromParam("GBD80%2F81"), "GBD80/81");
  assert.equal(symbolFromParam("GBD80/81"), "GBD80/81");
  for (const bad of ["%E0%A4", "NABIL%00", "%3Cscript%3E", "A".repeat(300), "..%2F..%2Fetc", "", "%20", "NA BIL"]) {
    assert.equal(symbolFromParam(bad), null, bad);
  }
});

test("normalizeSymbol accepts NEPSE symbols only", () => {
  assert.equal(normalizeSymbol(" ntc "), "NTC");
  assert.equal(normalizeSymbol("NIFRAUR85/86"), "NIFRAUR85/86");
  for (const bad of [null, 7, "", "-NABIL", "NA\\u0000BIL", "A".repeat(21), "<b>"]) assert.equal(normalizeSymbol(bad), null, String(bad));
});
