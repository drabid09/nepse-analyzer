import { test } from "node:test";
import assert from "node:assert/strict";
import { companyHref, normalizeSymbol, parseSymbol } from "./symbol.ts";

test("symbols are upper-cased and checked", () => {
  assert.equal(parseSymbol("NABIL"), "NABIL");
  assert.equal(parseSymbol("nabil"), "NABIL");
  assert.equal(parseSymbol("NABILD87"), "NABILD87");
});

test("anything that cannot be a symbol is refused before a database read", () => {
  assert.equal(parseSymbol(""), null);
  assert.equal(parseSymbol(undefined), null);
  assert.equal(parseSymbol("%"), null); // malformed percent-encoding
  assert.equal(parseSymbol("%E0%A4%A"), null);
  assert.equal(parseSymbol("AB,CD"), null);
  assert.equal(parseSymbol("<script>"), null);
  assert.equal(parseSymbol("A".repeat(21)), null);
  assert.equal(parseSymbol("NABIL%20"), "NABIL");
});

test("company links are encoded", () => {
  assert.equal(companyHref("NABIL"), "/c/NABIL");
  assert.equal(companyHref("A/B?x"), "/c/A%2FB%3Fx");
});

test("debentures keep their slash, inside one path segment", () => {
  assert.equal(parseSymbol("GBD80%2F81"), "GBD80/81");
  assert.equal(parseSymbol("gbd80%2f81"), "GBD80/81");
  assert.equal(companyHref("GBD80/81"), "/c/GBD80%2F81");
  assert.equal(normalizeSymbol(" nifraur85/86 "), "NIFRAUR85/86");
});

test("control characters, path tricks and very long segments are refused", () => {
  for (const bad of ["NABIL%00", "..%2F..%2Fetc", "%2FNABIL", "A".repeat(300), "-NABIL"]) assert.equal(parseSymbol(bad), null, bad);
  assert.equal(normalizeSymbol(7), null);
});
