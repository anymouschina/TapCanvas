import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ToolCallTrace } from "../hooks/types.js";
import { buildMemoryPromptFragment, searchLayeredMemory, syncLayeredMemory } from "./layered.js";
import { MemoryStore } from "./store.js";

function createToolCallTrace(name: string, status: ToolCallTrace["status"]): ToolCallTrace {
  return {
    toolCallId: `${name}-1`,
    name,
    args: {},
    output: "ok",
    outputChars: 2,
    outputHead: "ok",
    outputTail: "ok",
    status,
    startedAt: "2026-03-29T10:00:00.000Z",
    finishedAt: "2026-03-29T10:00:01.000Z",
    durationMs: 1000,
  };
}

test("layered memory sync writes session rollup, summary artifacts, and prompt fragment", async () => {
  const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-layered-memory-"));
  const store = new MemoryStore(memoryRoot);
  await store.save("默认用中文回复，并在证据不足时显式失败。", ["style", "policy"], {
    store: "core",
    source: "test",
    importance: 0.95,
  });

  syncLayeredMemory({
    memoryRoot,
    sessionId: "session-alpha",
    prompt: "继续按中文输出并维护 session summary。",
    resultText: "已完成 session rollup 和全局 summary。",
    messages: [
      { role: "user", content: "继续按中文输出并维护 session summary。" },
      { role: "assistant", content: '<skill-loaded name="cognitive-memory">\n...\n</skill-loaded>' },
      { role: "assistant", content: "已完成 session rollup 和全局 summary。" },
    ],
    toolCalls: [
      createToolCallTrace("read_file", "succeeded"),
      createToolCallTrace("write_file", "failed"),
    ],
    requiredSkills: ["cognitive-memory"],
    model: "gpt-5.2",
  });

  assert.ok(fs.existsSync(path.join(memoryRoot, "session-rollups", "session-alpha.json")));
  assert.ok(fs.existsSync(path.join(memoryRoot, "memory-candidates", "runs", "session-alpha")));
  assert.ok(fs.existsSync(path.join(memoryRoot, "memory-candidates", "consolidated.json")));
  assert.ok(fs.existsSync(path.join(memoryRoot, "memory_summary.md")));
  assert.ok(fs.existsSync(path.join(memoryRoot, "MEMORY.md")));
  assert.ok(fs.existsSync(path.join(memoryRoot, "index.json")));

  const promptFragment = buildMemoryPromptFragment({
    memoryRoot,
    prompt: "继续按中文输出并读取 session summary",
    sessionId: "session-alpha",
  });
  assert.match(promptFragment, /Persisted Memory/);
  assert.match(promptFragment, /Session Recall/);
  assert.match(promptFragment, /Relevant Memory Hits/);
  assert.match(promptFragment, /Consolidated Patterns/);
  assert.match(promptFragment, /Consolidated Summary/);
  assert.match(promptFragment, /默认用中文回复/);

  const hits = searchLayeredMemory({
    memoryRoot,
    query: "中文 session summary",
    limit: 6,
  });
  assert.ok(hits.some((item) => item.kind === "note"));
  assert.ok(hits.some((item) => item.kind === "session_rollup"));
  assert.ok(hits.some((item) => item.kind === "consolidated_candidate"));
});

test("layered memory consolidates repeated run paths across sessions", () => {
  const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-layered-memory-consolidated-"));

  syncLayeredMemory({
    memoryRoot,
    sessionId: "session-a",
    prompt: "读取文件并生成摘要",
    resultText: "完成一次摘要。",
    messages: [
      { role: "user", content: "读取文件并生成摘要" },
      { role: "assistant", content: '<skill-loaded name="cognitive-memory">\n...\n</skill-loaded>' },
      { role: "assistant", content: "完成一次摘要。" },
    ],
    toolCalls: [createToolCallTrace("read_file", "succeeded")],
    requiredSkills: ["cognitive-memory"],
    model: "gpt-5.2",
  });

  syncLayeredMemory({
    memoryRoot,
    sessionId: "session-b",
    prompt: "读取文件并生成摘要",
    resultText: "完成第二次摘要。",
    messages: [
      { role: "user", content: "读取文件并生成摘要" },
      { role: "assistant", content: '<skill-loaded name="cognitive-memory">\n...\n</skill-loaded>' },
      { role: "assistant", content: "完成第二次摘要。" },
    ],
    toolCalls: [createToolCallTrace("read_file", "succeeded")],
    requiredSkills: ["cognitive-memory"],
    model: "gpt-5.2",
  });

  const consolidatedPath = path.join(memoryRoot, "memory-candidates", "consolidated.json");
  const consolidated = JSON.parse(fs.readFileSync(consolidatedPath, "utf-8")) as Array<{
    occurrenceCount?: number;
    sessionIds?: string[];
    content?: string;
  }>;

  assert.ok(consolidated.length > 0);
  assert.ok(consolidated.some((item) => item.occurrenceCount === 2));
  assert.ok(consolidated.some((item) => (item.sessionIds ?? []).length === 2));
  assert.ok(consolidated.some((item) => String(item.content || "").includes("successfulTools=read_file")));
});
