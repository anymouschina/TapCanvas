import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentWorkspaceImportTool,
  createIdleAgentTool,
  createListAgentsTool,
  createSpawnAgentTool,
  createWaitTool,
} from "./collab-agent-tools.js";
import { ToolRuntimeState } from "./registry.js";
import { CollabAgentManagerLike } from "../collab/public.js";

function createState(): ToolRuntimeState {
  return {
    cache: {
      readFile: new Map(),
      bash: new Map(),
    },
    guard: {
      duplicateToolCallLimit: 3,
      duplicateToolCallCount: new Map(),
    },
  };
}

function createManager(): CollabAgentManagerLike {
  return {
    spawn() {
      throw new Error("not implemented");
    },
    enqueue() {
      throw new Error("not implemented");
    },
    close() {
      throw new Error("not implemented");
    },
    markIdle(id) {
      return {
        id,
        description: "worker",
        agent_type: "worker",
        model: "gpt-5.4",
        status: "idle",
        agent_work_root: process.cwd(),
        autonomous: true,
        idle_since: "2026-03-15T00:02:00.000Z",
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: 0,
        completed_tasks: 1,
        updated_at: "2026-03-15T00:02:00.000Z",
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: "",
      };
    },
    resume() {
      throw new Error("not implemented");
    },
    status(id) {
      return {
        id,
        description: "worker",
        agent_type: "worker",
        model: "gpt-5.4",
        status: "completed",
        agent_work_root: process.cwd(),
        autonomous: false,
        artifact_count: 0,
        recent_artifacts: [],
        handoff_file_count: 0,
        depth: 1,
        pending_tasks: 0,
        completed_tasks: 1,
        updated_at: "2026-03-15T00:00:00.000Z",
        unread_mailbox_count: 0,
        pending_protocol_count: 0,
        recent_submissions: [],
        result_preview: "",
      };
    },
    list() {
      return [
        {
          id: "agent_worker",
          description: "worker",
          agent_type: "worker",
          model: "gpt-5.4",
          status: "completed",
          agent_work_root: process.cwd(),
          autonomous: false,
          artifact_count: 0,
          recent_artifacts: [],
          handoff_file_count: 0,
          depth: 1,
          pending_tasks: 0,
          completed_tasks: 1,
          updated_at: "2026-03-15T00:00:00.000Z",
          unread_mailbox_count: 0,
          pending_protocol_count: 0,
          recent_submissions: [],
          result_preview: "",
        },
      ];
    },
    get() {
      return {
        id: "agent_worker",
        description: "worker",
        agentType: "worker",
        capabilityGrant: {
          tools: ["bash"],
          readableRoots: [process.cwd()],
          writableRoots: [],
          network: "approved",
          budgets: {
            maxToolCalls: 8,
            maxTokens: 1000,
            maxWallTimeMs: 1000,
          },
        },
        agentWorkRoot: process.cwd(),
        autonomous: false,
        depth: 1,
        history: [],
        status: "completed",
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
        pendingTasks: 0,
        completedTasks: 1,
        recentSubmissionIds: [],
        closed: false,
      };
    },
    getTask() {
      return null;
    },
    listSubmissionsForAgents() {
      return [];
    },
    sendMailboxMessage() {
      throw new Error("not implemented");
    },
    readMailbox() {
      return [];
    },
    unreadMailboxCount() {
      return 0;
    },
    requestProtocol() {
      throw new Error("not implemented");
    },
    readProtocolInbox() {
      return [];
    },
    protocolPendingCount() {
      return 0;
    },
    getProtocolRequest(id) {
      return {
        id,
        toAgentId: "agent_worker",
        fromAgentId: "agent_root",
        action: "review_patch",
        input: "{\"path\":\"src/a.ts\"}",
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:01:00.000Z",
        status: "responded",
        response: {
          responderAgentId: "agent_worker",
          status: "completed",
          output: "{\"ok\":true}",
          respondedAt: "2026-03-15T00:01:00.000Z",
        },
      };
    },
    respondProtocol() {
      throw new Error("not implemented");
    },
    listWorkspaceHandoff() {
      return [];
    },
    importAgentWorkspace(input) {
      return {
        agent_id: input.agentId,
        mode: input.mode,
        conflict_policy: input.conflictPolicy ?? "fail",
        source_root: `${process.cwd()}/.agents/runtime/collab/workspaces/${input.agentId}/repo`,
        target_root: process.cwd(),
        audit: {
          agent_id: input.agentId,
          agent_type: "worker",
          agent_work_root: `${process.cwd()}/.agents/runtime/collab/workspaces/${input.agentId}`,
          workspace_lane: `${process.cwd()}/.agents/runtime/collab/workspaces/${input.agentId}/repo`,
        },
        summary: {
          file_count: 0,
          create_count: 0,
          unchanged_count: 0,
          conflict_count: 0,
          copied_count: 0,
          skipped_count: 0,
        },
        files: [],
      };
    },
  };
}

test("wait supports protocol request ids and returns request summaries", async () => {
  const tool = createWaitTool();
  const result = await tool.execute(
    {
      ids: ["agent_worker"],
      request_ids: ["req_1"],
      timeout_ms: 10,
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_1"
  );

  const parsed = JSON.parse(result.content) as {
    done: boolean;
    agents?: Array<{ model?: string }>;
    requests: Array<{ id: string; status: string; response: { status: string } | null }>;
  };
  assert.equal(parsed.done, true);
  assert.equal(parsed.agents?.[0]?.model, "gpt-5.4");
  assert.equal(parsed.requests.length, 1);
  assert.equal(parsed.requests[0]?.id, "req_1");
  assert.equal(parsed.requests[0]?.status, "responded");
  assert.equal(parsed.requests[0]?.response?.status, "completed");
});

test("spawn_agent respects allowedSubagentTypes", async () => {
  const tool = createSpawnAgentTool();
  const result = await tool.execute(
    {
      agent_type: "writer",
      prompt: "起草提示词",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
        allowedSubagentTypes: ["research"],
      },
      state: createState(),
    },
    "tool_spawn_restricted"
  );

  assert.match(result.content, /本轮仅允许以下 agent_type：research；收到: writer/);
});

test("spawn_agent omits task_id when it matches the current agent claimed task", async () => {
  const tool = createSpawnAgentTool();
  let capturedTaskId: string | undefined;

  const manager: CollabAgentManagerLike = {
    ...createManager(),
    get(id) {
      return {
        id,
        description: "orchestrator",
        agentType: "orchestrator",
        capabilityGrant: {
          tools: ["bash", "spawn_agent"],
          readableRoots: [process.cwd()],
          writableRoots: [],
          network: "approved",
          budgets: {
            maxToolCalls: 8,
            maxTokens: 1000,
            maxWallTimeMs: 1000,
          },
        },
        agentWorkRoot: process.cwd(),
        autonomous: false,
        claimedTaskId: "task_0005",
        depth: 0,
        history: [],
        status: "completed",
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
        pendingTasks: 0,
        completedTasks: 1,
        recentSubmissionIds: [],
        closed: false,
      };
    },
    getTask(taskId) {
      return {
        id: taskId,
        subject: "第一章3个关键帧提示词与双次出图",
        status: "in_progress",
        owner: "agent_root",
        workspaceLane: "tapcanvas-auto",
      };
    },
    spawn(options) {
      capturedTaskId = options.taskId;
      return {
        agentId: "agent_writer",
        submissionId: "submission_writer",
      };
    },
  };

  const result = await tool.execute(
    {
      agent_type: "writer",
      prompt: "整理连续性约束",
      task_id: "task_0005",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: manager,
        currentAgentId: "agent_root",
      },
      state: createState(),
    },
    "tool_spawn_same_task"
  );

  const parsed = JSON.parse(result.content) as { agent_id: string; submission_id: string };
  assert.equal(parsed.agent_id, "agent_writer");
  assert.equal(parsed.submission_id, "submission_writer");
  assert.equal(capturedTaskId, undefined);
});

test("spawn_agent skips task binding for non-autonomous helpers when task_id is already owned", async () => {
  const tool = createSpawnAgentTool();
  let spawnCalled = false;
  let capturedTaskId: string | undefined;

  const manager: CollabAgentManagerLike = {
    ...createManager(),
    getTask(taskId) {
      return {
        id: taskId,
        subject: "第一章3个关键帧提示词与双次出图",
        status: "in_progress",
        owner: "小T",
        workspaceLane: "tapcanvas-auto",
      };
    },
    spawn(options) {
      spawnCalled = true;
      capturedTaskId = options.taskId;
      return {
        agentId: "agent_writer",
        submissionId: "submission_writer",
      };
    },
  };

  const result = await tool.execute(
    {
      agent_type: "writer",
      prompt: "整理连续性约束",
      task_id: "task_0005",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: manager,
        currentAgentId: "agent_root",
      },
      state: createState(),
    },
    "tool_spawn_foreign_task"
  );

  assert.equal(spawnCalled, true);
  assert.equal(capturedTaskId, undefined);
  const parsed = JSON.parse(result.content) as {
    agent_id: string;
    submission_id: string;
    task_binding?: { status: string; task_id: string; owner?: string; reason: string };
  };
  assert.equal(parsed.agent_id, "agent_writer");
  assert.equal(parsed.submission_id, "submission_writer");
  assert.deepEqual(parsed.task_binding, {
    status: "skipped_existing_owner",
    task_id: "task_0005",
    owner: "小T",
    reason: "task_already_owned",
  });
});

test("spawn_agent still fails for autonomous agents when task_id is already owned by another owner", async () => {
  const tool = createSpawnAgentTool();
  let spawnCalled = false;

  const manager: CollabAgentManagerLike = {
    ...createManager(),
    getTask(taskId) {
      return {
        id: taskId,
        subject: "第一章3个关键帧提示词与双次出图",
        status: "in_progress",
        owner: "小T",
        workspaceLane: "tapcanvas-auto",
      };
    },
    spawn() {
      spawnCalled = true;
      return {
        agentId: "agent_writer",
        submissionId: "submission_writer",
      };
    },
  };

  const result = await tool.execute(
    {
      agent_type: "writer",
      prompt: "整理连续性约束",
      task_id: "task_0005",
      autonomous: true,
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: manager,
        currentAgentId: "agent_root",
      },
      state: createState(),
    },
    "tool_spawn_foreign_task_autonomous"
  );

  assert.equal(spawnCalled, false);
  assert.match(result.content, /task already owned by 小T: task_0005/);
  assert.match(result.content, /请省略 task_id/);
});

test("spawn_agent fork_context forwards only fully linked parent history", async () => {
  const tool = createSpawnAgentTool();
  let capturedHistory:
    | Array<{
        role: string;
        content: string;
        toolCallId?: string;
        toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      }>
    | undefined;
  let capturedSystemOverride: string | undefined;

  const manager: CollabAgentManagerLike = {
    ...createManager(),
    spawn(options) {
      capturedHistory = options.initialHistory;
      capturedSystemOverride = options.systemOverride;
      return {
        agentId: "agent_writer",
        submissionId: "submission_writer",
      };
    },
  };

  const result = await tool.execute(
    {
      agent_type: "writer",
      prompt: "整理 6 张图的执行映射",
      fork_context: true,
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: manager,
        currentModel: "gpt-5.4",
        currentSystem: "## Effective System\n只允许读取已授权证据。",
        currentMessages: [
          {
            role: "user",
            content: "重试，刚刚生成失败了",
          },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call_task_update",
                name: "task_update",
                arguments: '{"taskId":"task_0005"}',
              },
            ],
          },
          {
            role: "tool",
            content: '{"id":"task_0005","status":"in_progress"}',
            toolCallId: "call_task_update",
          },
          {
            role: "assistant",
            content: "我现在派 writer 子代理继续整理。",
            toolCalls: [
              {
                id: "call_spawn_inflight",
                name: "spawn_agent",
                arguments: '{"agent_type":"writer","fork_context":true}',
              },
            ],
          },
        ],
      },
      state: createState(),
    },
    "tool_spawn_fork_context"
  );

  const parsed = JSON.parse(result.content) as { agent_id: string; submission_id: string };
  assert.equal(parsed.agent_id, "agent_writer");
  assert.equal(parsed.submission_id, "submission_writer");
  assert.deepEqual(capturedHistory, [
    {
      role: "user",
      content: "重试，刚刚生成失败了",
    },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_task_update",
          name: "task_update",
          arguments: '{"taskId":"task_0005"}',
        },
      ],
    },
    {
      role: "tool",
      content: '{"id":"task_0005","status":"in_progress"}',
      toolCallId: "call_task_update",
    },
    {
      role: "assistant",
      content: "我现在派 writer 子代理继续整理。",
    },
  ]);
  assert.equal(capturedSystemOverride, "## Effective System\n只允许读取已授权证据。");
});

test("spawn_agent forwards current requiredSkills into child spawn contract", async () => {
  const tool = createSpawnAgentTool();
  let capturedRequiredSkills: string[] | undefined;

  const manager: CollabAgentManagerLike = {
    ...createManager(),
    spawn(options) {
      capturedRequiredSkills = options.requiredSkills;
      return {
        agentId: "agent_reviewer",
        submissionId: "submission_reviewer",
      };
    },
  };

  const result = await tool.execute(
    {
      agent_type: "reviewer",
      prompt: "核对交付是否完整",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: manager,
        currentRequiredSkills: ["agents-team", "cognitive-memory", "agents-team"],
      },
      state: createState(),
    },
    "tool_spawn_required_skills"
  );

  const parsed = JSON.parse(result.content) as { agent_id: string; submission_id: string };
  assert.equal(parsed.agent_id, "agent_reviewer");
  assert.equal(parsed.submission_id, "submission_reviewer");
  assert.deepEqual(capturedRequiredSkills, ["agents-team", "cognitive-memory"]);
});

test("wait fails explicitly when neither ids nor request_ids are provided", async () => {
  const tool = createWaitTool();
  const result = await tool.execute(
    {},
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_2"
  );

  assert.match(result.content, /wait 至少需要 ids 或 request_ids 之一/);
});

test("agent_workspace_import rejects invalid mode", async () => {
  const tool = createAgentWorkspaceImportTool();
  const result = await tool.execute(
    {
      agent_id: "agent_worker",
      mode: "invalid_mode",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_3"
  );

  assert.match(result.content, /agent_workspace_import\.mode 必须为 "dry_run" 或 "apply"/);
});

test("agent_workspace_import returns explicit dry_run payload", async () => {
  const tool = createAgentWorkspaceImportTool();
  const result = await tool.execute(
    {
      agent_id: "agent_worker",
      mode: "dry_run",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_4"
  );

  const parsed = JSON.parse(result.content) as {
    agent_id: string;
    mode: string;
    conflict_policy: string;
    source_root: string;
    target_root: string;
    audit: { workspace_lane: string };
    summary: { file_count: number };
    files: unknown[];
  };
  assert.equal(parsed.agent_id, "agent_worker");
  assert.equal(parsed.mode, "dry_run");
  assert.equal(parsed.conflict_policy, "fail");
  assert.match(parsed.source_root, /\/repo$/);
  assert.equal(parsed.target_root, process.cwd());
  assert.match(parsed.audit.workspace_lane, /\/repo$/);
  assert.equal(parsed.summary.file_count, 0);
  assert.deepEqual(parsed.files, []);
});

test("agent_workspace_import rejects invalid conflict policy", async () => {
  const tool = createAgentWorkspaceImportTool();
  const result = await tool.execute(
    {
      agent_id: "agent_worker",
      mode: "apply",
      conflict_policy: "merge",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_conflict_policy"
  );

  assert.match(result.content, /agent_workspace_import\.conflict_policy 必须为 "fail" 或 "overwrite"/);
});

test("list_agents exposes inherited model for observability", async () => {
  const tool = createListAgentsTool();
  const result = await tool.execute(
    {},
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_list_agents"
  );

  const parsed = JSON.parse(result.content) as {
    agents: Array<{ id: string; model?: string }>;
  };
  assert.equal(parsed.agents.length, 1);
  assert.equal(parsed.agents[0]?.id, "agent_worker");
  assert.equal(parsed.agents[0]?.model, "gpt-5.4");
});

test("agent_workspace_import works without any team-mode runtime flag", async () => {
  const tool = createAgentWorkspaceImportTool();
  const result = await tool.execute(
    {
      agent_id: "agent_worker",
      mode: "dry_run",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_5"
  );

  const parsed = JSON.parse(result.content) as {
    agent_id: string;
    mode: string;
  };
  assert.equal(parsed.agent_id, "agent_worker");
  assert.equal(parsed.mode, "dry_run");
});

test("agent_workspace_import fails explicitly when collab manager is missing", async () => {
  const tool = createAgentWorkspaceImportTool();
  const result = await tool.execute(
    {
      agent_id: "agent_worker",
      mode: "dry_run",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {},
      state: createState(),
    },
    "tool_6"
  );

  assert.match(result.content, /collab manager unavailable/);
});

test("idle_agent marks the current team agent idle", async () => {
  const tool = createIdleAgentTool();
  const result = await tool.execute(
    {},
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
        currentAgentId: "agent_worker",
      },
      state: createState(),
    },
    "tool_idle"
  );

  const parsed = JSON.parse(result.content) as {
    id: string;
    model?: string;
    status: string;
    idle_since?: string;
    autonomous: boolean;
  };
  assert.equal(parsed.id, "agent_worker");
  assert.equal(parsed.model, "gpt-5.4");
  assert.equal(parsed.status, "idle");
  assert.equal(parsed.autonomous, true);
  assert.equal(parsed.idle_since, "2026-03-15T00:02:00.000Z");
});

test("idle_agent records idle intent instead of failing for the current busy agent", async () => {
  const tool = createIdleAgentTool();
  const busyManager = {
    markIdle(id: string) {
      return {
        id,
        status: "running",
        status_source: "live",
        autonomous: false,
      };
    },
  };
  const result = await tool.execute(
    {},
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: busyManager,
        currentAgentId: "agent_busy",
      },
      state: createState(),
    },
    "tool_idle_busy"
  );

  const parsed = JSON.parse(result.content) as {
    id: string;
    status: string;
    status_source?: string;
  };
  assert.equal(parsed.id, "agent_busy");
  assert.equal(parsed.status, "running");
  assert.equal(parsed.status_source, "live");
});

test("idle_agent fails explicitly without currentAgentId", async () => {
  const tool = createIdleAgentTool();
  const result = await tool.execute(
    {},
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
      },
      state: createState(),
    },
    "tool_idle_missing"
  );

  assert.match(result.content, /idle_agent 只能在 team agent 上下文中调用/);
});

test("idle_agent works without any team-mode runtime flag", async () => {
  const tool = createIdleAgentTool();
  const result = await tool.execute(
    {},
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        collabManager: createManager(),
        currentAgentId: "agent_worker",
      },
      state: createState(),
    },
    "tool_idle_team_mode"
  );

  const parsed = JSON.parse(result.content) as {
    id: string;
    status: string;
  };
  assert.equal(parsed.id, "agent_worker");
  assert.equal(parsed.status, "idle");
});
