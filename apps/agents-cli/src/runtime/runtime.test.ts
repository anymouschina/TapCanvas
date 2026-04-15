import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentConfig } from "../types/index.js";
import { createAssistantRuntime } from "./runtime.js";
import type { RuntimeRunEvent } from "./events.js";
import { createRuntimeChannelMeta } from "./channel.js";

type RuntimeToolContextMeta = {
  runtimeProfile: string;
  registeredToolNames: string[];
  registeredTeamToolNames: string[];
  runtimeChannelPolicy?: {
    responseStyle: string;
    sessionMode: string;
    eventMode: string;
  };
};

function createConfig(workspaceRoot: string): AgentConfig {
  return {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: true,
    memoryDir: ".agents/memory",
    skillsDir: "skills",
    workspaceRoot,
    worldApiUrl: "",
    maxTurns: 8,
    maxSubagentDepth: 2,
    agentIntro: "你是一个智能体。",
  };
}

test("createAssistantRuntime exposes a surface-neutral tool context for general profile", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-runtime-general-"));
  fs.mkdirSync(path.join(workspaceRoot, "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: demo\n---\n");

  const runtime = createAssistantRuntime({
    cwd: workspaceRoot,
    config: createConfig(workspaceRoot),
    profile: "general",
  });

  const meta = runtime.createToolContextMeta() as RuntimeToolContextMeta;

  assert.equal(runtime.profile, "general");
  assert.equal(meta.runtimeProfile, "general");
  assert.ok(meta.registeredToolNames.includes("TodoWrite"));
  assert.ok(meta.registeredToolNames.includes("Skill"));
  assert.equal(meta.registeredToolNames.includes("exec_command"), false);
  assert.equal(meta.registeredTeamToolNames.includes("spawn_agent"), false);
  assert.equal(runtime.registeredToolNames.includes("spawn_agent"), false);
});

test("createAssistantRuntime registers execution and team tools for code profile", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-runtime-code-"));
  const runtime = createAssistantRuntime({
    cwd: workspaceRoot,
    config: createConfig(workspaceRoot),
    profile: "code",
  });

  const meta = runtime.createToolContextMeta() as RuntimeToolContextMeta;

  assert.equal(runtime.profile, "code");
  assert.ok(runtime.registeredToolNames.includes("exec_command"));
  assert.ok(runtime.registeredToolNames.includes("spawn_agent"));
  assert.ok(meta.registeredToolNames.includes("exec_command"));
  assert.ok(meta.registeredTeamToolNames.includes("spawn_agent"));
});

test("assistant runtime emits stable run events while delegating to the underlying runner", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-runtime-events-"));
  const runtime = createAssistantRuntime({
    cwd: workspaceRoot,
    config: createConfig(workspaceRoot),
    profile: "general",
  });

  const recorded: RuntimeRunEvent[] = [];
  const originalRun = runtime.runner.run.bind(runtime.runner);
  runtime.runner.run = (async (_prompt, _cwd, options) => {
    options?.onToolStart?.({
      toolCallId: "tool-1",
      name: "TodoWrite",
      args: { items: ["step"] },
      startedAt: "2026-04-10T00:00:00.000Z",
    });
    options?.onToolCall?.({
      toolCallId: "tool-1",
      name: "TodoWrite",
      args: { items: ["step"] },
      output: "[>] step 1",
      outputChars: 10,
      outputHead: "[>] step 1",
      outputTail: "[>] step 1",
      status: "succeeded",
      startedAt: "2026-04-10T00:00:00.000Z",
      finishedAt: "2026-04-10T00:00:01.000Z",
      durationMs: 1000,
    });
    options?.onTextDelta?.("你好");
    options?.onTurn?.({
      turn: 1,
      text: "最终答案",
      textPreview: "最终答案",
      textChars: 4,
      toolCallCount: 0,
      toolNames: [],
      finished: true,
    });
    return "最终答案";
  }) as typeof runtime.runner.run;

  try {
    const result = await runtime.run("测试事件", {
      sessionId: "session-1",
      eventSink: (event) => {
        recorded.push(event);
      },
    });

    assert.equal(result, "最终答案");
    assert.equal(recorded[0]?.type, "run.started");
    assert.equal(recorded[1]?.type, "tool.started");
    assert.equal(recorded[2]?.type, "todo.updated");
    assert.equal(recorded[3]?.type, "tool.completed");
    assert.equal(recorded[4]?.type, "text.delta");
    assert.equal(recorded[5]?.type, "turn.completed");
    assert.equal(recorded[6]?.type, "run.completed");
  } finally {
    runtime.runner.run = originalRun;
  }
});

test("createRuntimeChannelMeta derives compact interactive policy for tui", () => {
  const meta = createRuntimeChannelMeta({
    kind: "tui",
    transport: "interactive",
    surface: "repl",
    sessionId: "session-1",
  }) as RuntimeToolContextMeta;
  assert.equal(meta.runtimeChannelPolicy?.responseStyle, "compact");
  assert.equal(meta.runtimeChannelPolicy?.sessionMode, "persistent");
  assert.equal(meta.runtimeChannelPolicy?.eventMode, "interactive");
});
