import assert from "node:assert/strict";
import { test } from "node:test";
import { settlePrevClose } from "./indices.ts";

const NEPSE = 58, SENSITIVE = 57;

test("the previous trading day's stored close is the previous close", () => {
  // 23 Nov 2026: NEPSE closed 2,623.56; NEPSE reported previousClose 2,623.56; Friday's close was 2,621.29.
  const [r] = settlePrevClose([{ index_id: NEPSE, close: 2623.56, prev_close: 2623.56 }], new Map([[NEPSE, 2621.29]]));
  assert.equal(r.prev_close, 2621.29);
});

test("a rolled-over value a rounding step away from the close is replaced too", () => {
  // Sensitive showed -0.00%: NEPSE's previous close was 478.53 against a close of 478.52.
  const [r] = settlePrevClose([{ index_id: SENSITIVE, close: 478.52, prev_close: 478.53 }], new Map([[SENSITIVE, 477.9]]));
  assert.equal(r.prev_close, 477.9);
});

test("without a stored close NEPSE's value is kept", () => {
  assert.equal(settlePrevClose([{ index_id: 51, close: 1596.27, prev_close: 1586 }], new Map())[0].prev_close, 1586);
  assert.equal(settlePrevClose([{ index_id: 51, close: 1596.27, prev_close: null }], new Map([[58, 1]]))[0].prev_close, null);
});
