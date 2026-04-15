import test from "node:test";
import assert from "node:assert/strict";

import { normalizeToolOutput } from "./message-limits.js";

test("normalizeToolOutput keeps small bash output intact except ansi stripping", () => {
  const output = "\u001b[31mhello\u001b[0m\nworld";
  const normalized = normalizeToolOutput(output, "tool:bash");

  assert.equal(normalized, "hello\nworld");
});

test("normalizeToolOutput compacts large noisy bash output and preserves signal lines", () => {
  const lines = Array.from({ length: 120 }, (_, index) => `progress line ${index + 1}`);
  lines[40] = "WARNING: cache miss";
  lines[90] = "Error: build failed";

  const normalized = normalizeToolOutput(lines.join("\n"), "tool:bash");

  assert.match(normalized, /compacted noisy command output/);
  assert.match(normalized, /WARNING: cache miss/);
  assert.match(normalized, /Error: build failed/);
  assert.match(normalized, /omitted \d+ lines/);
  assert.doesNotMatch(normalized, /13\| progress line 13\n14\| progress line 14\n15\| progress line 15\n16\| progress line 16\n17\| progress line 17\n18\| progress line 18\n19\| progress line 19\n20\| progress line 20\n21\| progress line 21\n22\| progress line 22\n23\| progress line 23\n24\| progress line 24\n25\| progress line 25/);
});

test("normalizeToolOutput does not compact non-bash tool output", () => {
  const lines = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n");
  const normalized = normalizeToolOutput(lines, "tool:read_file");

  assert.equal(normalized, lines);
});
