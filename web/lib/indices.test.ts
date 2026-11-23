import assert from "node:assert/strict";
import { test } from "node:test";
import { settlePrevClose } from "./indices.ts";

const NEPSE = 58;

test("a previous close rolled over to the close is replaced by the stored close", () => {
  // 23 Nov 2026: NEPSE closed 2,623.56; NEPSE reported previousClose 2,623.56; Friday's close was 2,621.29.
  const [r] = settlePrevClose([{ index_id: NEPSE, close: 2623.56, prev_close: 2623.56 }], new Map([[NEPSE, 2621.29]]));
  assert.equal(r.prev_close, 2621.29);
});

test("database numerics arrive as strings and are compared as numbers", () => {
  const [r] = settlePrevClose([{ index_id: NEPSE, close: "2623.56" as never, prev_close: "2623.56" as never }], new Map([[NEPSE, 2621.29]]));
  assert.equal(r.prev_close, 2621.29);
});

test("a different previous close, or no stored close, is left alone", () => {
  assert.equal(settlePrevClose([{ index_id: 51, close: 1596.27, prev_close: 1586 }], new Map([[51, 1500]]))[0].prev_close, 1586);
  assert.equal(settlePrevClose([{ index_id: NEPSE, close: 2623.56, prev_close: 2623.56 }], new Map())[0].prev_close, 2623.56);
  assert.equal(settlePrevClose([{ index_id: NEPSE, close: 2623.56, prev_close: null }], new Map([[NEPSE, 2621.29]]))[0].prev_close, 2621.29);
});
