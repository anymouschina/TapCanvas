import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRunner } from "./agent-loop.js";
import { HookRunner } from "./hooks/runner.js";
import { SkillLoader } from "./skills/loader.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig, LLMRequest, LLMResponse, Message, ToolResult } from "../types/index.js";
import type { ToolCallTrace } from "./hooks/types.js";

test("agent loop no longer blocks finish on legacy agents-team completion gate", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_writer","submission_id":"submission_1"}',
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: '{"imagePrompt":"图1里的主角站在废墟前，阴天，低机位。"}',
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 6,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("给我最终图片提示词", tempDir, {
    maxTurns: 6,
    toolContextMeta: {
      requireAgentsTeamExecution: true,
    },
    onToolCall: (toolCall) => {
      observedToolCalls.push(toolCall);
    },
  });

  assert.match(result, /imagePrompt/);
  assert.equal(observedToolCalls.length, 0);
  assert.equal(requests.length, 1);
});

test("agent loop does not preload agents-team required skill before direct spawn_agent use", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-preload-"));
  const skillsDir = path.join(tempDir, "skills", "agents-team");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, "SKILL.md"),
    [
      "---",
      "name: agents-team",
      "description: test team skill",
      "---",
      "",
      "# agents-team",
      "",
      "Enable team mode.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_writer","submission_id":"submission_1"}',
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        assert.equal(
          request.messages.some((message) => /<agents-team-enabled\s*\/?>/i.test(message.content)),
          false,
        );
        assert.equal(
          request.messages.some((message) => /<skill-loaded\s+name="agents-team">/i.test(message.content)),
          false,
        );
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_direct",
              name: "spawn_agent",
              arguments: '{"agent_type":"writer","prompt":"先起草图片提示词"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        return {
          text: "已委派 writer 起草提示词。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("委派一个 writer 子代理", tempDir, {
    maxTurns: 4,
    requiredSkills: ["agents-team"],
    onToolCall: (toolCall) => {
      observedToolCalls.push(toolCall);
    },
  });

  assert.match(result, /已委派 writer/);
  assert.equal(observedToolCalls.length, 1);
  assert.equal(observedToolCalls[0]?.name, "spawn_agent");
  assert.equal(observedToolCalls[0]?.status, "succeeded");
  assert.equal(requests.length, 2);
});

test("agent loop returns the first tool-free answer directly", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-direct-finish-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "read_file",
      description: "read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: "已读取到真实文件证据。",
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "先给一个还没完成的阶段性结论。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 6,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("完成最终答复", tempDir, {
    maxTurns: 6,
  });

  assert.match(result, /阶段性结论/);
  assert.equal(requests.length, 1);
});

test("agent loop blocks finish when TodoWrite checklist is incomplete after a failed tool", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-checklist-block-"));
  const registry = new ToolRegistry();
  let todoCallCount = 0;
  registry.register({
    definition: {
      name: "TodoWrite",
      description: "ephemeral todo list",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      todoCallCount += 1;
      return {
        toolCallId,
        content:
          todoCallCount === 1
            ? [
                "[>] 确认 xlsx 文件内容结构与可提取方式",
                "[ ] 提取与详情页设计相关的文本/图片线索",
                "[ ] 基于提取结果输出详情页设计建议或指出缺失信息",
                "(0/3 done)",
              ].join("\n")
            : [
                "[x] 确认 xlsx 文件内容结构与可提取方式",
                "[x] 提取与详情页设计相关的文本/图片线索",
                "[x] 基于提取结果输出详情页设计建议或指出缺失信息",
                "(3/3 done)",
              ].join("\n"),
      };
    },
  });
  registry.register({
    definition: {
      name: "exec_command",
      description: "run command",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string" },
        },
        required: ["cmd"],
      },
    },
    async execute(_args, _ctx, _toolCallId): Promise<ToolResult> {
      throw new Error("bash path not allowed outside capability readableRoots");
    },
  });
  registry.register({
    definition: {
      name: "read_file",
      description: "read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: "已确认当前仓库内没有可读的 xlsx 副本。",
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "todo_1",
              name: "TodoWrite",
              arguments: "{\"todos\":[\"确认结构\",\"提取线索\",\"输出设计\"]}",
            },
            {
              id: "exec_1",
              name: "exec_command",
              arguments: "{\"cmd\":\"read xlsx\"}",
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        assert.ok(request.messages.length > 0);
        return {
          text: "",
          toolCalls: [
            {
              id: "todo_2",
              name: "TodoWrite",
              arguments: "{\"todos\":[\"确认结构\",\"提取线索\",\"输出设计\"]}",
            },
          ],
        };
      }
      if (callCount === 2) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "read_1",
              name: "read_file",
              arguments: "{\"path\":\"README.md\"}",
            },
          ],
        };
      }
      if (callCount === 3) {
        callCount += 1;
        return {
          text: "文件当前不可读，已确认阻塞点是 capability readableRoots 限制，需要把文件移到允许目录后继续。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 6,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("分析 xlsx 并给出详情页设计", tempDir, {
    maxTurns: 6,
  });

  assert.match(result, /capability readableRoots 限制/);
  assert.equal(requests.length, 4);
});

test("agent loop records tool batch summaries in runtime meta", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-tool-batch-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "read_file",
      description: "read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: "file content",
      };
    },
  });

  let callCount = 0;
  const client = {
    async call(_request: LLMRequest): Promise<LLMResponse> {
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_read_1",
              name: "read_file",
              arguments: '{"path":"README.md"}',
            },
          ],
        };
      }
      return {
        text: "done",
        toolCalls: [],
      };
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 2,
    agentIntro: "你是一个智能体系统。",
  };

  const runtimeMeta: Record<string, unknown> = {};
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("read one file", tempDir, {
    toolContextMeta: runtimeMeta,
  });

  assert.equal(result, "done");
  const summaries = Array.isArray(runtimeMeta.toolBatchSummaries) ? runtimeMeta.toolBatchSummaries : [];
  assert.equal(summaries.length, 1);
  assert.match(String((summaries[0] as Record<string, unknown>).label || ""), /read_file/);
});

test("agent loop compacts long message history before model call and records the event", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-compaction-"));
  const originalMaxChars = process.env.AGENTS_MESSAGE_HISTORY_MAX_CHARS;
  process.env.AGENTS_MESSAGE_HISTORY_MAX_CHARS = "300";

  try {
    const registry = new ToolRegistry();
    const requests: LLMRequest[] = [];
    const client = {
      async call(request: LLMRequest): Promise<LLMResponse> {
        requests.push(request);
        return {
          text: "compacted",
          toolCalls: [],
        };
      },
    };

    const config: AgentConfig = {
      apiBaseUrl: "https://example.com",
      apiKey: "test-key",
      model: "gpt-5.2",
      apiStyle: "responses",
      stream: false,
      memoryDir: ".agents/memory",
      skillsDir: path.join(tempDir, "skills"),
      workspaceRoot: tempDir,
      worldApiUrl: "",
      maxTurns: 3,
      maxSubagentDepth: 2,
      agentIntro: "你是一个智能体系统。",
    };

    const history: Message[] = Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}-${"x".repeat(120)}`,
    }));
    const runtimeMeta: Record<string, unknown> = {};
    const runner = new AgentRunner(
      config,
      registry,
      client as unknown as import("../llm/client.js").LLMClient,
      new SkillLoader(path.join(tempDir, "skills")),
      new HookRunner([]),
    );

    const result = await runner.run("final prompt", tempDir, {
      history,
      toolContextMeta: runtimeMeta,
    });

    assert.equal(result, "compacted");
    assert.equal(requests.length, 1);
    assert.equal(Array.isArray(runtimeMeta.compactionEvents), true);
    assert.equal((runtimeMeta.compactionEvents as unknown[]).length > 0, true);
  } finally {
    if (typeof originalMaxChars === "string") {
      process.env.AGENTS_MESSAGE_HISTORY_MAX_CHARS = originalMaxChars;
    } else {
      delete process.env.AGENTS_MESSAGE_HISTORY_MAX_CHARS;
    }
  }
});

test("agent loop auto-waits unfinished spawned agents before the next llm turn without consuming turn budget", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-wait-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_writer","submission_id":"submission_1"}',
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_wait",
              name: "spawn_agent",
              arguments: '{"agent_type":"writer","prompt":"先整理连续性摘要"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        assert.match(
          request.messages[request.messages.length - 1]?.content ?? "",
          /agents-team-runtime-wait/,
        );
        return {
          text: "子代理已经完成，现在汇总最终结果。",
          toolCalls: [],
        };
      }
      callCount += 1;
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  let statusReadCount = 0;
  const collabManager = {
    status(id: string) {
      statusReadCount += 1;
      const running = statusReadCount < 2;
      return {
        id,
        description: "writer child",
        agent_type: "writer",
        status: running ? "running" : "completed",
        agent_work_root: path.join(tempDir, ".agents", "runtime", "collab", "workspaces", id),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: running ? 1 : 0,
        completed_tasks: running ? 0 : 1,
        active_submission_id: running ? "submission_1" : undefined,
        last_submission_id: "submission_1",
        updated_at: new Date().toISOString(),
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: running ? "" : "连续性摘要已完成",
      };
    },
    listSubmissionsForAgents(ids: string[]) {
      return ids.map((id) => ({
        id: "submission_1",
        agent_id: id,
        status: statusReadCount < 2 ? "running" : "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        finished_at: statusReadCount < 2 ? undefined : new Date().toISOString(),
        prompt_preview: "先整理连续性摘要",
        result_preview: statusReadCount < 2 ? "" : "连续性摘要已完成",
      }));
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 2,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const previousTimeout = process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
  const previousPoll = process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
  process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = "80";
  process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = "50";

  try {
    const result = await runner.run("先等子代理完成再汇总", tempDir, {
      maxTurns: 2,
      toolContextMeta: {
        requireAgentsTeamExecution: true,
        collabManager,
      },
      onToolCall: (toolCall) => {
        observedToolCalls.push(toolCall);
      },
    });

    assert.match(result, /子代理已经完成/);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      observedToolCalls.map((item) => item.name),
      ["spawn_agent", "agents_team_runtime_wait"],
    );
  } finally {
    if (previousTimeout === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = previousTimeout;
    if (previousPoll === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = previousPoll;
  }
});

test("agent loop blocks later tool calls in the same assistant turn until spawned agents settle", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-block-rest-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_worker","submission_id":"submission_1"}',
      };
    },
  });

  let readFileCalls = 0;
  registry.register({
    definition: {
      name: "read_file",
      description: "read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      readFileCalls += 1;
      return {
        toolCallId,
        content: "unexpected read_file execution",
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_then_wait",
              name: "spawn_agent",
              arguments: '{"agent_type":"worker","prompt":"先执行子代理任务"}',
            },
            {
              id: "tool_read_after_spawn",
              name: "read_file",
              arguments: '{"path":"should-not-run.txt"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        assert.match(
          request.messages[request.messages.length - 1]?.content ?? "",
          /agents-team-runtime-wait/,
        );
        assert.ok(
          request.messages.some((message) =>
            message.role === "tool" &&
            message.toolCallId === "tool_read_after_spawn" &&
            /已有 team 子代理尚未结束/.test(message.content),
          ),
        );
        return {
          text: "子代理结束后我才继续了。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  let statusReadCount = 0;
  const collabManager = {
    status(id: string) {
      statusReadCount += 1;
      const running = statusReadCount < 2;
      return {
        id,
        description: "worker child",
        agent_type: "worker",
        status: running ? "running" : "completed",
        agent_work_root: path.join(tempDir, ".agents", "runtime", "collab", "workspaces", id),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: running ? 1 : 0,
        completed_tasks: running ? 0 : 1,
        active_submission_id: running ? "submission_1" : undefined,
        last_submission_id: "submission_1",
        updated_at: new Date().toISOString(),
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: running ? "" : "worker 已完成",
      };
    },
    listSubmissionsForAgents(ids: string[]) {
      return ids.map((id) => ({
        id: "submission_1",
        agent_id: id,
        status: statusReadCount < 2 ? "running" : "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        finished_at: statusReadCount < 2 ? undefined : new Date().toISOString(),
        prompt_preview: "先执行子代理任务",
        result_preview: statusReadCount < 2 ? "" : "worker 已完成",
      }));
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 3,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const previousTimeout = process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
  const previousPoll = process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
  process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = "80";
  process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = "50";

  try {
    const result = await runner.run("spawn 后不要继续执行同轮其他工具", tempDir, {
      maxTurns: 3,
      toolContextMeta: {
        requireAgentsTeamExecution: true,
        collabManager,
      },
      onToolCall: (toolCall) => {
        observedToolCalls.push(toolCall);
      },
    });

    assert.match(result, /子代理结束后我才继续了/);
    assert.equal(readFileCalls, 0);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      observedToolCalls.map((item) => [item.name, item.status]),
      [
        ["spawn_agent", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
        ["read_file", "blocked"],
      ],
    );
  } finally {
    if (previousTimeout === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = previousTimeout;
    if (previousPoll === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = previousPoll;
  }
});

test("agent loop does not auto-wait a child that was explicitly closed earlier in the same turn", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-closed-child-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_closed","submission_id":"submission_1"}',
      };
    },
  });
  registry.register({
    definition: {
      name: "close_agent",
      description: "close a team agent",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
    async execute(args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: JSON.stringify({
          id: String(args.id ?? ""),
          status: "closed",
        }),
      };
    },
  });

  let readFileCalls = 0;
  registry.register({
    definition: {
      name: "read_file",
      description: "read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      readFileCalls += 1;
      return {
        toolCallId,
        content: "closed child no longer blocks the turn",
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_then_close",
              name: "spawn_agent",
              arguments: '{"agent_type":"research","prompt":"提炼第一章场景资产"}',
            },
            {
              id: "tool_close_child",
              name: "close_agent",
              arguments: '{"id":"agent_closed"}',
            },
            {
              id: "tool_read_after_close",
              name: "read_file",
              arguments: '{"path":"should-run.txt"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        assert.doesNotMatch(
          request.messages[request.messages.length - 1]?.content ?? "",
          /agents-team-runtime-wait/,
        );
        assert.ok(
          request.messages.some((message) =>
            message.role === "tool" &&
            message.toolCallId === "tool_read_after_close" &&
            /closed child no longer blocks the turn/.test(message.content),
          ),
        );
        return {
          text: "我已关闭不再需要的子代理，并继续执行了同轮剩余工具。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const collabManager = {
    status(id: string) {
      return {
        id,
        description: "closed research child",
        agent_type: "research",
        status: "closed",
        agent_work_root: path.join(tempDir, ".agents", "runtime", "collab", "workspaces", id),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: 2,
        completed_tasks: 0,
        active_submission_id: "submission_1",
        last_submission_id: "submission_1",
        updated_at: new Date().toISOString(),
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: "",
      };
    },
    listSubmissionsForAgents(ids: string[]) {
      return ids.map((id) => ({
        id: "submission_1",
        agent_id: id,
        status: "running",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        prompt_preview: "提炼第一章场景资产",
        result_preview: "",
      }));
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 3,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("关闭子代理后继续执行同轮工具", tempDir, {
    maxTurns: 3,
    toolContextMeta: {
      requireAgentsTeamExecution: true,
      collabManager,
    },
    onToolCall: (toolCall) => {
      observedToolCalls.push(toolCall);
    },
  });

  assert.match(result, /继续执行了同轮剩余工具/);
  assert.equal(readFileCalls, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    observedToolCalls.map((item) => [item.name, item.status]),
    [
      ["spawn_agent", "succeeded"],
      ["close_agent", "succeeded"],
      ["read_file", "succeeded"],
    ],
  );
});

test("agent loop finishes pure project text evidence tasks without an extra final round", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-project-text-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "read_file",
      description: "read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: [
          "月光照在书页的恶鬼画像上，那勾勒的线条便彷如活了过来。",
          "李长安推门而出，长街白灯笼高悬，鬼市喧闹。",
          "面摊老板把自己的脑袋拧下来丢进锅里，沸汤翻滚。",
          "那也不打紧。",
          "头颅笑吟吟地说着，一边说一边将脑袋摁回了脖子。",
        ].join("\n"),
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_read_chapter",
              name: "read_file",
              arguments: '{"path":"chapter-2.txt"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        return {
          text: "下面是第二章正文的已证实内容：月光照在书页的恶鬼画像上，那勾勒的线条便彷如活了过来……头颅笑吟吟地说着，一边说一边将脑袋摁回了脖子。",
          toolCalls: [],
        };
      }
      throw new Error("should not enter an extra final llm round");
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("第二章正文", tempDir, {
    maxTurns: 4,
    toolContextMeta: {
      diagnosticContext: {
        requireProjectTextEvidence: true,
      },
    },
  });

  assert.match(result, /第二章正文的已证实内容/);
  assert.equal(requests.length, 2);
});

test("agent loop no longer blocks pure project text evidence tasks before evidence is read", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-project-text-block-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "read_file",
      description: "read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: "月光照在书页的恶鬼画像上。\n李长安推门而出，外面是鬼市。\n头颅笑吟吟地说着。",
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "第二章主要是鬼市和面摊。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 5,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("第二章正文", tempDir, {
    maxTurns: 5,
    toolContextMeta: {
      diagnosticContext: {
        requireProjectTextEvidence: true,
      },
    },
  });

  assert.match(result, /第二章主要是鬼市和面摊/);
  assert.equal(requests.length, 1);
});

test("agent loop keeps waiting past the diagnostic threshold until the child settles when it is not over budget", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-wait-forever-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_stuck","submission_id":"submission_stuck"}',
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_stuck",
              name: "spawn_agent",
              arguments: '{"agent_type":"research","prompt":"继续补齐完整分镜切分"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        assert.match(
          request.messages[request.messages.length - 1]?.content ?? "",
          /totalWaitCycles="4"/,
        );
        return {
          text: "子代理终于完成了，我现在基于最终状态继续汇总。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  let statusReadCount = 0;
  const collabManager = {
    status(id: string) {
      statusReadCount += 1;
      const running = statusReadCount < 4;
      return {
        id,
        description: "stuck research child",
        agent_type: "research",
        status: running ? "running" : "completed",
        agent_work_root: path.join(tempDir, ".agents", "runtime", "collab", "workspaces", id),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: running ? 1 : 0,
        completed_tasks: running ? 0 : 1,
        active_submission_id: running ? "submission_stuck" : undefined,
        last_submission_id: "submission_stuck",
        updated_at: new Date().toISOString(),
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: running ? "" : "完整分镜切分已完成",
      };
    },
    listSubmissionsForAgents(ids: string[]) {
      return ids.map((id) => {
        const running = statusReadCount < 4;
        return {
          id: "submission_stuck",
          agent_id: id,
          status: running ? "running" : "completed",
          created_at: "2026-03-28T00:00:00.000Z",
          updated_at: "2026-03-28T00:00:00.100Z",
          finished_at: running ? undefined : new Date().toISOString(),
          prompt_preview: "继续补齐完整分镜切分",
          result_preview: running ? "" : "完整分镜切分已完成",
        };
      });
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 2,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const previousTimeout = process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
  const previousPoll = process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
  const previousDiagnosticAfterCycles = process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES;
  process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = "0";
  process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = "0";
  process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES = "1";

  try {
    const result = await runner.run("补齐完整分镜", tempDir, {
      maxTurns: 2,
      toolContextMeta: {
        collabManager,
      },
      onToolCall: (toolCall) => {
        observedToolCalls.push(toolCall);
      },
    });

    assert.match(result, /子代理终于完成了/);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      observedToolCalls.map((item) => [item.name, item.status]),
      [
        ["spawn_agent", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
      ],
    );
  } finally {
    if (previousTimeout === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = previousTimeout;
    if (previousPoll === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = previousPoll;
    if (previousDiagnosticAfterCycles === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES;
    else process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES = previousDiagnosticAfterCycles;
  }
});

test("agent loop stops auto-waiting once a pending child is over budget and still running", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-overbudget-abort-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_stuck","submission_id":"submission_stuck"}',
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_stuck",
              name: "spawn_agent",
              arguments: '{"agent_type":"research","prompt":"提炼第二章首张关键帧文本依据"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        assert.match(
          request.messages[request.messages.length - 1]?.content ?? "",
          /runtime 已停止继续自动等待这些子代理/,
        );
        assert.match(
          request.messages[request.messages.length - 1]?.content ?? "",
          /超预算/,
        );
        return {
          text: "子代理超预算未终态；我已停止继续等待，并基于当前已确认事实给出结论。",
          toolCalls: [],
        };
      }
      callCount += 1;
      return {
        text: JSON.stringify({
          isComplete: true,
          shouldContinue: false,
          userGoal: "等待 team 子代理，但子代理已超时卡死",
          successCriteria: ["显式暴露子代理阻塞事实", "避免无限等待"],
          satisfiedCriteria: ["显式暴露子代理阻塞事实", "避免无限等待"],
          missingCriteria: [],
          requiredActions: [],
          failureReason: null,
          rationale: "已明确报告阻塞并停止自动等待。",
        }),
        toolCalls: [],
      };
    },
  };

  const collabManager = {
    status(id: string) {
      return {
        id,
        description: "stuck research child",
        agent_type: "research",
        status: "running",
        agent_work_root: path.join(tempDir, ".agents", "runtime", "collab", "workspaces", id),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: 1,
        completed_tasks: 0,
        active_submission_id: "submission_stuck",
        last_submission_id: "submission_stuck",
        updated_at: new Date().toISOString(),
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: "",
      };
    },
    listSubmissionsForAgents(ids: string[]) {
      return ids.map((id) => ({
        id: "submission_stuck",
        agent_id: id,
        status: "running",
        created_at: "2026-03-28T00:00:00.000Z",
        updated_at: "2026-03-28T00:00:00.100Z",
        prompt_preview: "提炼第二章首张关键帧文本依据",
        result_preview: "",
        run_started_at: "2026-03-28T00:00:00.000Z",
        run_elapsed_ms: 330_000,
        budget_ms: 300_000,
        budget_exceeded_at: "2026-03-28T00:05:00.000Z",
        over_budget_ms: 30_000,
        last_progress_at: "2026-03-28T00:05:03.000Z",
        last_progress_age_ms: 26_000,
        last_progress_summary: "tool=agents_team_runtime_wait status=succeeded",
      }));
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 2,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const previousTimeout = process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
  const previousPoll = process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
  const previousDiagnosticAfterCycles = process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES;
  process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = "0";
  process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = "0";
  process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES = "1";

  try {
    const result = await runner.run("提取第二章正文，但子代理卡死", tempDir, {
      maxTurns: 2,
      toolContextMeta: {
        collabManager,
      },
      onToolCall: (toolCall) => {
        observedToolCalls.push(toolCall);
      },
    });

    assert.match(result, /停止继续等待/);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      observedToolCalls.map((item) => [item.name, item.status]),
      [
        ["spawn_agent", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
      ],
    );
  } finally {
    if (previousTimeout === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = previousTimeout;
    if (previousPoll === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = previousPoll;
    if (previousDiagnosticAfterCycles === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES;
    else process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES = previousDiagnosticAfterCycles;
  }
});

test("agent loop stops auto-waiting once runtime total wait cap is reached before child over-budget", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-total-wait-cap-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_slow","submission_id":"submission_slow"}',
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_slow",
              name: "spawn_agent",
              arguments: '{"agent_type":"research","prompt":"审计第三章节点结构差异"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        assert.match(
          request.messages[request.messages.length - 1]?.content ?? "",
          /自动等待总时长已达到上限/,
        );
        assert.doesNotMatch(
          request.messages[request.messages.length - 1]?.content ?? "",
          /超预算/,
        );
        return {
          text: "runtime 自动等待总时长已达上限；我已停止继续等待，并按当前已确认事实报告阻塞。",
          toolCalls: [],
        };
      }
      callCount += 1;
      return {
        text: JSON.stringify({
          isComplete: true,
          shouldContinue: false,
          userGoal: "等待 team 子代理，但不要被长时间轮询拖住",
          successCriteria: ["显式暴露 runtime wait 上限命中", "避免继续自动等待"],
          satisfiedCriteria: ["显式暴露 runtime wait 上限命中", "避免继续自动等待"],
          missingCriteria: [],
          requiredActions: [],
          failureReason: null,
          rationale: "已明确说明 runtime 等待上限命中并停止继续等待。",
        }),
        toolCalls: [],
      };
    },
  };

  const collabManager = {
    status(id: string) {
      return {
        id,
        description: "slow research child",
        agent_type: "research",
        status: "running",
        agent_work_root: path.join(tempDir, ".agents", "runtime", "collab", "workspaces", id),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: 1,
        completed_tasks: 0,
        active_submission_id: "submission_slow",
        last_submission_id: "submission_slow",
        updated_at: new Date().toISOString(),
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: "",
      };
    },
    listSubmissionsForAgents(ids: string[]) {
      return ids.map((id) => ({
        id: "submission_slow",
        agent_id: id,
        status: "running",
        created_at: "2026-03-28T00:00:00.000Z",
        updated_at: "2026-03-28T00:00:00.100Z",
        prompt_preview: "审计第三章节点结构差异",
        result_preview: "",
        run_started_at: "2026-03-28T00:00:00.000Z",
        run_elapsed_ms: 60_000,
        budget_ms: 300_000,
        last_progress_at: "2026-03-28T00:00:30.000Z",
        last_progress_age_ms: 30_000,
        last_progress_summary: "tool=read_file status=succeeded",
      }));
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 2,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const previousTimeout = process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
  const previousPoll = process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
  const previousMaxTotal = process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS;
  process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = "60";
  process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = "10";
  process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS = "50";

  try {
    const result = await runner.run("等待 team 子代理，但别一直卡住", tempDir, {
      maxTurns: 2,
      toolContextMeta: {
        collabManager,
      },
      onToolCall: (toolCall) => {
        observedToolCalls.push(toolCall);
      },
    });

    assert.match(result, /已达上限/);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      observedToolCalls.map((item) => [item.name, item.status]),
      [
        ["spawn_agent", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
      ],
    );
  } finally {
    if (previousTimeout === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = previousTimeout;
    if (previousPoll === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = previousPoll;
    if (previousMaxTotal === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS = previousMaxTotal;
  }
});

test("agent loop performs a final recheck before stopping auto-wait at runtime cap", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-team-final-recheck-"));
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn a team agent",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["agent_type", "prompt"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      return {
        toolCallId,
        content: '{"agent_id":"agent_recheck","submission_id":"submission_recheck"}',
      };
    },
  });

  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_spawn_recheck",
              name: "spawn_agent",
              arguments: '{"agent_type":"reviewer","prompt":"审查第二章连续性"}',
            },
          ],
        };
      }
      callCount += 1;
      assert.match(
        request.messages[request.messages.length - 1]?.content ?? "",
        /已自动轮询等待到这些子代理进入终态/,
      );
      return {
        text: "最终重检已捕获 reviewer 完成态，我已继续汇总。",
        toolCalls: [],
      };
    },
  };

  let statusReadCount = 0;
  const collabManager = {
    status(id: string) {
      statusReadCount += 1;
      const completed = statusReadCount >= 3;
      return {
        id,
        description: "reviewer child",
        agent_type: "reviewer",
        status: completed ? "completed" : "running",
        agent_work_root: path.join(tempDir, ".agents", "runtime", "collab", "workspaces", id),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: completed ? 0 : 1,
        completed_tasks: completed ? 1 : 0,
        active_submission_id: completed ? undefined : "submission_recheck",
        last_submission_id: "submission_recheck",
        updated_at: new Date().toISOString(),
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: completed ? "审查已完成" : "",
      };
    },
    listSubmissionsForAgents(ids: string[]) {
      return ids.map((id) => ({
        id: "submission_recheck",
        agent_id: id,
        status: statusReadCount >= 3 ? "completed" : "running",
        created_at: "2026-03-28T00:00:00.000Z",
        updated_at: "2026-03-28T00:00:00.100Z",
        finished_at: statusReadCount >= 3 ? "2026-03-28T00:00:00.120Z" : undefined,
        prompt_preview: "审查第二章连续性",
        result_preview: statusReadCount >= 3 ? "完成" : "",
        run_started_at: "2026-03-28T00:00:00.000Z",
        run_elapsed_ms: 20,
        budget_ms: 300_000,
        last_progress_at: "2026-03-28T00:00:00.100Z",
        last_progress_age_ms: 20,
        last_progress_summary: "tool=idle_agent status=failed",
      }));
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 2,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const observedToolCalls: ToolCallTrace[] = [];
  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const previousTimeout = process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
  const previousPoll = process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
  const previousMaxTotal = process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS;
  process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = "20";
  process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = "20";
  process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS = "10";

  try {
    const result = await runner.run("等待 reviewer 完成后再汇总", tempDir, {
      maxTurns: 2,
      toolContextMeta: {
        collabManager,
      },
      onToolCall: (toolCall) => {
        observedToolCalls.push(toolCall);
      },
    });

    assert.match(result, /最终重检已捕获 reviewer 完成态/);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      observedToolCalls.map((item) => [item.name, item.status]),
      [
        ["spawn_agent", "succeeded"],
        ["agents_team_runtime_wait", "succeeded"],
      ],
    );
    const runtimeWait = observedToolCalls.find((item) => item.name === "agents_team_runtime_wait");
    assert.ok(runtimeWait);
    assert.match(runtimeWait.output, /"completed":true/);
    assert.doesNotMatch(runtimeWait.output, /"stopped":true/);
  } finally {
    if (previousTimeout === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS = previousTimeout;
    if (previousPoll === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_POLL_MS = previousPoll;
    if (previousMaxTotal === undefined) delete process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS;
    else process.env.AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS = previousMaxTotal;
  }
});

test("agent loop injects persisted memory into system prompt and syncs rollups after run", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-memory-"));
  const memoryRoot = path.join(tempDir, ".agents", "memory");
  const skillsDir = path.join(tempDir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const memoryStoreModule = await import("./memory/store.js");
  const store = new memoryStoreModule.MemoryStore(memoryRoot);
  await store.save("默认使用中文回答，并显式报告缺失证据。", ["style", "failure"], {
    store: "core",
    source: "test",
    importance: 0.9,
  });

  let capturedSystem = "";
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      callCount += 1;
      if (callCount === 1) {
        capturedSystem = request.system;
        return {
          text: "已按记忆要求完成。",
          toolCalls: [],
        };
      }
      return {
        text: JSON.stringify({
          isComplete: true,
          shouldContinue: false,
          userGoal: "按记忆要求完成回答",
          successCriteria: ["输出最终回答"],
          satisfiedCriteria: ["输出最终回答"],
          missingCriteria: [],
          requiredActions: [],
          failureReason: null,
          rationale: "已满足。",
        }),
        toolCalls: [],
      };
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir,
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 2,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    new ToolRegistry(),
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(skillsDir),
    new HookRunner([]),
  );

  const result = await runner.run("继续按中文输出，并把本轮结果写入记忆。", tempDir, {
    sessionId: "memory-session",
  });

  assert.equal(result, "已按记忆要求完成。");
  assert.match(capturedSystem, /Persisted Memory/);
  assert.match(capturedSystem, /默认使用中文回答/);
  assert.ok(fs.existsSync(path.join(memoryRoot, "session-rollups", "memory-session.json")));
  assert.ok(fs.existsSync(path.join(memoryRoot, "memory_summary.md")));
});

test("agent loop allows tapcanvas read-only get tools before TodoWrite under planning gate", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-tapcanvas-flow-get-"));
  const registry = new ToolRegistry();
  let flowGetCalls = 0;
  registry.register({
    definition: {
      name: "tapcanvas_flow_get",
      description: "read the current flow",
      parameters: {
        type: "object",
        properties: {
          flowId: { type: "string" },
        },
        required: ["flowId"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      flowGetCalls += 1;
      return {
        toolCallId,
        content: '{"id":"flow_1","nodes":[],"edges":[]}',
      };
    },
  });

  const observedToolCalls: ToolCallTrace[] = [];
  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_flow_get",
              name: "tapcanvas_flow_get",
              arguments: '{"flowId":"flow_1"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        return {
          text: "已读取当前画布结构。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("先读当前 flow，再决定如何调整", tempDir, {
    maxTurns: 4,
    toolContextMeta: {
      diagnosticContext: {
        planningRequired: true,
        planningMinimumSteps: 3,
      },
    },
    onToolCall: (toolCall) => {
      observedToolCalls.push(toolCall);
    },
  });

  assert.match(result, /已读取当前画布结构/);
  assert.equal(flowGetCalls, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    observedToolCalls.map((item) => [item.name, item.status]),
    [["tapcanvas_flow_get", "succeeded"]],
  );
});

test("agent loop still blocks tapcanvas_flow_patch without TodoWrite under planning gate", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-tapcanvas-flow-patch-"));
  const registry = new ToolRegistry();
  let flowPatchCalls = 0;
  registry.register({
    definition: {
      name: "tapcanvas_flow_patch",
      description: "patch the current flow",
      parameters: {
        type: "object",
        properties: {
          flowId: { type: "string" },
        },
        required: ["flowId"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      flowPatchCalls += 1;
      return {
        toolCallId,
        content: '{"ok":true}',
      };
    },
  });

  const observedToolCalls: ToolCallTrace[] = [];
  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_flow_patch",
              name: "tapcanvas_flow_patch",
              arguments: '{"flowId":"flow_1"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        return {
          text: "flow patch 因缺少 checklist 被阻塞。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("直接改当前 flow", tempDir, {
    maxTurns: 4,
    toolContextMeta: {
      diagnosticContext: {
        planningRequired: true,
        planningMinimumSteps: 3,
      },
    },
    onToolCall: (toolCall) => {
      observedToolCalls.push(toolCall);
    },
  });

  assert.match(result, /被阻塞/);
  assert.equal(flowPatchCalls, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    observedToolCalls.map((item) => [item.name, item.status]),
    [["tapcanvas_flow_patch", "blocked"]],
  );
});

test("agent loop blocks tapcanvas read-only tools before TodoWrite when checklist-first is required", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-tapcanvas-checklist-first-"));
  const registry = new ToolRegistry();
  let flowGetCalls = 0;
  registry.register({
    definition: {
      name: "tapcanvas_flow_get",
      description: "read the current flow",
      parameters: {
        type: "object",
        properties: {
          flowId: { type: "string" },
        },
        required: ["flowId"],
      },
    },
    async execute(_args, _ctx, toolCallId): Promise<ToolResult> {
      flowGetCalls += 1;
      return {
        toolCallId,
        content: '{"id":"flow_1"}',
      };
    },
  });

  const observedToolCalls: ToolCallTrace[] = [];
  const requests: LLMRequest[] = [];
  let callCount = 0;
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      if (callCount === 0) {
        callCount += 1;
        return {
          text: "",
          toolCalls: [
            {
              id: "tool_flow_get",
              name: "tapcanvas_flow_get",
              arguments: '{"flowId":"flow_1"}',
            },
          ],
        };
      }
      if (callCount === 1) {
        callCount += 1;
        return {
          text: "chapter checklist-first 已阻止过早读取。",
          toolCalls: [],
        };
      }
      throw new Error(`unexpected call ${callCount}`);
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 3,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("完成第二章节的漫剧创作", tempDir, {
    maxTurns: 4,
    toolContextMeta: {
      diagnosticContext: {
        planningRequired: true,
        planningMinimumSteps: 4,
        planningChecklistFirst: true,
      },
    },
    onToolCall: (toolCall) => {
      observedToolCalls.push(toolCall);
    },
  });

  assert.match(result, /checklist-first 已阻止过早读取/);
  assert.equal(flowGetCalls, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    observedToolCalls.map((item) => [item.name, item.status]),
    [["tapcanvas_flow_get", "blocked"]],
  );
});

test("agent loop injects channel contract into shared system prompt", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-loop-channel-system-"));
  const registry = new ToolRegistry();
  let observedSystem = "";
  const client = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      observedSystem = request.system;
      return {
        text: "这是项目说明。",
        toolCalls: [],
      };
    },
  };

  const config: AgentConfig = {
    apiBaseUrl: "https://example.com",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: ".agents/memory",
    skillsDir: path.join(tempDir, "skills"),
    workspaceRoot: tempDir,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 2,
    agentIntro: "你是一个智能体系统。",
  };

  const runner = new AgentRunner(
    config,
    registry,
    client as unknown as import("../llm/client.js").LLMClient,
    new SkillLoader(path.join(tempDir, "skills")),
    new HookRunner([]),
  );

  const result = await runner.run("这个项目是什么？", tempDir, {
    toolContextMeta: {
      runtimeChannel: {
        kind: "tui",
        transport: "interactive",
        sessionId: "session-1",
        surface: "repl",
      },
    },
  });

  assert.equal(result, "这是项目说明。");
  assert.match(observedSystem, /Channel Contract/);
  assert.match(observedSystem, /简单问答优先控制在 1 段或最多 4 个要点/);
  assert.match(observedSystem, /阻塞时只给最小可执行下一步/);
});
