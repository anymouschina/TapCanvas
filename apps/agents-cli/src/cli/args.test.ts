import assert from "node:assert/strict";
import test from "node:test";

import { positiveInteger } from "./args.js";

test("positiveInteger parses a positive integer", () => {
  assert.equal(positiveInteger("8000000", "body-limit"), 8000000);
  assert.equal(positiveInteger("8799", "port"), 8799);
});

test("positiveInteger rejects zero and negative values", () => {
  assert.throws(() => positiveInteger("0", "port"), /必须是正整数/);
  assert.throws(() => positiveInteger("-1", "port"), /必须是正整数/);
});

test("positiveInteger rejects non-numeric and fractional input", () => {
  assert.throws(() => positiveInteger("abc", "port"), /必须是正整数/);
  assert.throws(() => positiveInteger("1.5", "port"), /必须是正整数/);
});
