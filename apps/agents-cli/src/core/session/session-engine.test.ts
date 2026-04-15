import assert from "node:assert/strict";
import test from "node:test";

import { AgentSessionEngine, createToolRuntimeState } from "./session-engine.js";
import type { Message } from "../../types/index.js";
import type { RunHookContext } from "../hooks/types.js";
import type { WorkspaceContext } from "../workspace-context/types.js";

function createWorkspaceContext(): WorkspaceContext {
  return {
    rootDir: "/repo",
    files: [],
    evidenceBundles: [],
    promptFragment: "workspace fragment",
    summary: "workspace summary",
  };
}

function createHookContext(toolCalls = []): RunHookContext {
  return {
    runId: "run-1",
    cwd: "/repo",
    workspaceRoot: "/repo",
    prompt: "user prompt",
    requiredSkills: [],
    workspaceContext: createWorkspaceContext(),
    toolCalls,
  };
}

test("createToolRuntimeState creates default runtime caches and duplicate guard", () => {
  const state = createToolRuntimeState(undefined, 5);
  assert.equal(state.guard.duplicateToolCallLimit, 5);
  assert.equal(state.cache.readFile.size, 0);
  assert.equal(state.cache.bash.size, 0);
});

test("AgentSessionEngine appends messages and records current system", () => {
  const messages: Message[] = [];
  const runtimeMeta: Record<string, unknown> = {};
  const session = new AgentSessionEngine(messages, runtimeMeta, createHookContext(), {
    loadedSkills: new Set(["agents-team"]),
  });

  session.appendUserPrompt("hello", true);
  session.appendAssistantMessage("done", [
    {
      id: "call-1",
      name: "read_file",
      arguments: "{\"path\":\"README.md\"}",
    },
  ]);
  session.appendToolMessage({
    role: "tool",
    content: "tool output",
    toolCallId: "call-1",
  });
  session.recordCurrentMessages();
  const system = session.buildSystem("base", "collab");

  assert.equal(system, "base\n\ncollab");
  assert.equal(runtimeMeta.currentSystem, "base\n\ncollab");
  assert.equal(runtimeMeta.currentMessages, messages);
  assert.equal(messages.length, 3);
  assert.equal(messages[0]?.ephemeral, true);
  assert.equal(messages[1]?.toolCalls?.[0]?.name, "read_file");
  assert.equal(session.getLoadedSkills().has("agents-team"), true);
});
