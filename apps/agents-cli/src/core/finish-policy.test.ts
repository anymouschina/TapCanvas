import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { finalizeRunResult, joinSystemSections, reportRunError } from "./finish-policy.js";
import { HookRunner } from "./hooks/runner.js";
import type { RunHookContext } from "./hooks/types.js";
import type { WorkspaceContext } from "./workspace-context/types.js";

function createWorkspaceContext(): WorkspaceContext {
  return {
    rootDir: "/repo",
    files: [],
    evidenceBundles: [],
    promptFragment: "",
    summary: "summary",
  };
}

function createHookContext(): RunHookContext {
  return {
    runId: "run-1",
    cwd: "/repo",
    workspaceRoot: "/repo",
    prompt: "user prompt",
    requiredSkills: [],
    workspaceContext: createWorkspaceContext(),
    toolCalls: [],
  };
}

test("joinSystemSections ignores blank parts", () => {
  assert.equal(joinSystemSections("a", "", "  ", "b"), "a\n\nb");
});

test("reportRunError forwards normalized error message to hooks", async () => {
  let received = "";
  const hooks = new HookRunner([
    {
      name: "test-hook",
      async onRunError(payload) {
        received = payload.errorMessage;
      },
    },
  ]);

  await reportRunError({
    hooks,
    hookContext: createHookContext(),
    error: new Error("boom"),
  });

  assert.equal(received, "boom");
});

test("finalizeRunResult calls afterRun hook and syncs root memory artifacts", async () => {
  let afterRunResult = "";
  const hooks = new HookRunner([
    {
      name: "test-hook",
      async afterRun(payload) {
        afterRunResult = payload.resultText;
      },
    },
  ]);
  const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-finish-"));

  const result = await finalizeRunResult({
    hooks,
    hookContext: createHookContext(),
    runtimeMeta: {},
    memoryRoot,
    prompt: "user prompt",
    resultText: "final answer",
    messages: [
      { role: "user", content: "user prompt" },
      { role: "assistant", content: "final answer" },
    ],
    toolCalls: [],
    sessionId: "session-1",
    requiredSkills: [],
    model: "gpt-5.2",
  });

  assert.equal(result, "final answer");
  assert.equal(afterRunResult, "final answer");
  assert.equal(fs.existsSync(path.join(memoryRoot, "memory_summary.md")), true);
});
