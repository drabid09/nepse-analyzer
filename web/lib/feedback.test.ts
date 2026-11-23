// The feedback form's checks (the database enforces the same limits).
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFeedback, MESSAGE_MAX } from "./feedback.ts";

test("a normal message is accepted and trimmed", () => {
  const r = checkFeedback({ kind: "request", message: "  Show dividends on company pages  ", about: " NABIL " }, "Sanjeev");
  assert.deepEqual(r, { ok: true, spam: false, row: { kind: "request", message: "Show dividends on company pages", page: "NABIL", name: "Sanjeev" } });
});

test("missing or unknown kind, empty or overlong message are refused", () => {
  assert.equal(checkFeedback({ kind: "spam", message: "hello there" }, "Sanjeev").ok, false);
  assert.equal(checkFeedback({ kind: undefined, message: "hello there" }, "Sanjeev").ok, false);
  assert.equal(checkFeedback({ kind: "idea", message: "  " }, "Sanjeev").ok, false);
  assert.equal(checkFeedback({ kind: "idea", message: "x".repeat(MESSAGE_MAX + 1) }, "Sanjeev").ok, false);
});

test("the hidden field catches automated form fillers without saving anything", () => {
  assert.deepEqual(checkFeedback({ kind: "idea", message: "buy cheap pills", website: "http://spam.example" }, "Sanjeev"), { ok: true, spam: true, row: null });
});

test("an empty 'about' becomes no page", () => {
  const r = checkFeedback({ kind: "other", message: "Thanks!", about: "" }, "Sanjeev");
  assert.equal(r.ok && r.row?.page, null);
});

test("control characters are removed instead of making the save fail", () => {
  const c = checkFeedback({ kind: "idea", message: "nul \u0000 bell \u0007 ok\r\nnext line", about: "NABIL\u0000" }, "S");
  assert.ok(c.ok && c.row);
  assert.equal(c.row.message, "nul  bell  ok\nnext line");
  assert.equal(c.row.page, "NABIL");
});

test("lengths count characters as the database does", () => {
  const two = checkFeedback({ kind: "idea", message: "😀😀" }, "S");
  assert.equal(two.ok, false); // 2 characters, below the minimum of 3, though JavaScript counts 4
  const max = checkFeedback({ kind: "idea", message: "😀".repeat(4000) }, "S");
  assert.equal(max.ok, true);
  const about = checkFeedback({ kind: "idea", message: "hello", about: "😀".repeat(300) }, "S");
  assert.ok(about.ok && about.row && [...about.row.page!].length === 200);
});

test("an unpaired surrogate half is dropped", () => {
  const c = checkFeedback({ kind: "other", message: "abc\uD800def" }, "S");
  assert.ok(c.ok && c.row && c.row.message === "abcdef");
});
