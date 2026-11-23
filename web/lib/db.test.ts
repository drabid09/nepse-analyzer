// The website must refuse to run with a key that can write.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { keyProblem } from "./db.ts";

const jwt = (claims: object) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

test("publishable and legacy anon keys are accepted", () => {
  assert.equal(keyProblem("sb_publishable_abc123"), null);
  assert.equal(keyProblem(jwt({ role: "anon", iss: "supabase" })), null);
});

test("secret and service_role keys are refused", () => {
  assert.match(keyProblem("sb_secret_abc123")!, /secret key/);
  assert.match(keyProblem(jwt({ role: "service_role", iss: "supabase" }))!, /service_role/);
});
