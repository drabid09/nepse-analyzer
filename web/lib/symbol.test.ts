import { test } from "node:test";
import assert from "node:assert/strict";
import { companyHref, parseSymbol } from "./symbol.ts";

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
