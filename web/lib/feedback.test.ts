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
