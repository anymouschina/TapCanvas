import test from "node:test";
import assert from "node:assert/strict";

import { resolveResumeSessionKey } from "./repl-session.js";

test("resolveResumeSessionKey supports numeric selection from recent sessions", () => {
  const key = resolveResumeSessionKey("2", [
    { key: "chapter-1" },
    { key: "chapter-2" },
  ]);

  assert.equal(key, "chapter-2");
});

test("resolveResumeSessionKey returns empty string for invalid numeric selection", () => {
  const key = resolveResumeSessionKey("4", [
    { key: "chapter-1" },
    { key: "chapter-2" },
  ]);

  assert.equal(key, "");
});

test("resolveResumeSessionKey preserves explicit session ids", () => {
  const key = resolveResumeSessionKey("custom-session", [
    { key: "chapter-1" },
  ]);

  assert.equal(key, "custom-session");
});
