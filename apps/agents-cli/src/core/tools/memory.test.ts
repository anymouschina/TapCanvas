import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMemoryTools } from "./memory.js";

function createState() {
  return {
    cache: { readFile: new Map(), bash: new Map() },
    guard: { duplicateToolCallLimit: 3, duplicateToolCallCount: new Map() },
  };
}

test("memory tools honor user scoped memory root instead of default root", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-memory-tool-"));
  const defaultRoot = path.join(tempRoot, "default-memory");
  const userRoot = path.join(tempRoot, "users", "user-7");
  const saveTool = createMemoryTools(defaultRoot).find((item) => item.definition.name === "memory_save");
  const searchTool = createMemoryTools(defaultRoot).find((item) => item.definition.name === "memory_search");
  if (!saveTool || !searchTool) {
    throw new Error("memory tools are missing");
  }

  await saveTool.execute(
    {
      content: "这条记忆必须写到 user scoped root。",
      tags: ["user-7", "scoped"],
      store: "core",
    },
    {
      cwd: tempRoot,
      depth: 0,
      meta: { userMemoryRoot: userRoot },
      state: createState(),
    },
    "memory-save-1",
  );

  assert.ok(fs.existsSync(path.join(userRoot, "notes.jsonl")));
  assert.ok(fs.existsSync(path.join(userRoot, "memory_summary.md")));
  assert.equal(fs.existsSync(path.join(defaultRoot, "notes.jsonl")), false);

  const result = await searchTool.execute(
    {
      query: "user scoped root",
      limit: 5,
    },
    {
      cwd: tempRoot,
      depth: 0,
      meta: { userMemoryRoot: userRoot },
      state: createState(),
    },
    "memory-search-1",
  );

  assert.match(result.content, /user scoped root/);
  assert.doesNotMatch(result.content, /default-memory/);
});
