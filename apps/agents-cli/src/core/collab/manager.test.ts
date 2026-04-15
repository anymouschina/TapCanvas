import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRunner } from "../agent-loop.js";
import { HookRunner } from "../hooks/runner.js";
import { SkillLoader } from "../skills/loader.js";
import { getActiveAgentDefinitions, setActiveAgentDefinitions } from "../subagent/definitions.js";
import { ToolRegistry } from "../tools/registry.js";
import { LLMClient } from "../../llm/client.js";
import { AgentConfig, AgentDefinition, CapabilityGrant } from "../../types/index.js";
import { CollabMailboxStore } from "./mailbox-store.js";
import { CollabAgentManager } from "./manager.js";
import { CollabProtocolStore } from "./protocol-store.js";
import { CollabRuntimeStore } from "./runtime-store.js";
import { TaskStore } from "../tasks/store.js";
import { Message } from "../../types/index.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createConfig(workspaceRoot: string, skillsDir: string): AgentConfig {
  return {
    apiBaseUrl: "https://example.invalid/v1",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: false,
    memoryDir: path.join(workspaceRoot, ".agents", "memory"),
    skillsDir,
    workspaceRoot,
    worldApiUrl: "",
    maxTurns: 4,
    maxSubagentDepth: 2,
    agentIntro: "test",
  };
}

function createCapabilityGrant(workspaceRoot: string): CapabilityGrant {
  return {
    tools: ["read_file", "write_file", "edit_file", "bash"],
    readableRoots: [workspaceRoot],
    writableRoots: [workspaceRoot],
    network: "none",
    budgets: {
      maxToolCalls: 8,
      maxTokens: 2000,
      maxWallTimeMs: 1000,
    },
  };
}

function createManager(workspaceRoot: string, runnerOverride?: AgentRunner): CollabAgentManager {
  const skillsDir = createTempDir("agents-collab-skills-");
  const config = createConfig(workspaceRoot, skillsDir);
  const runner =
    runnerOverride ??
    new AgentRunner(
      config,
      new ToolRegistry(),
      new LLMClient(config),
      new SkillLoader(skillsDir),
      new HookRunner([])
    );
  const store = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
  return new CollabAgentManager({
    runner,
    cwd: workspaceRoot,
    systemOverride: "",
    maxDepth: 2,
    baseCapabilityGrant: createCapabilityGrant(workspaceRoot),
    tasks: new TaskStore(path.join(workspaceRoot, ".agents", "runtime", "tasks")),
    store,
    mailbox: new CollabMailboxStore(path.join(workspaceRoot, ".agents", "runtime", "mailbox")),
    protocol: new CollabProtocolStore(path.join(workspaceRoot, ".agents", "runtime", "protocol")),
  });
}

type TestAgentRecord = {
  id: string;
  description: string;
  agentType: "worker";
  skillBundle?: string[];
  capabilityGrant: CapabilityGrant;
  modelOverride?: string;
  agentWorkRoot: string;
  autonomous: boolean;
  claimedTaskId?: string;
  idleSince?: string;
  depth: number;
  history: Message[];
  status: "queued" | "running" | "idle" | "completed" | "failed" | "closed";
  createdAt: string;
  updatedAt: string;
  pendingTasks: number;
  completedTasks: number;
  recentSubmissionIds: string[];
  closed: boolean;
  chain: Promise<void>;
  getDrainPromise: () => Promise<void>;
  activeSubmissionId?: string;
};

function getPrivateAgentsMap(manager: CollabAgentManager): Map<string, TestAgentRecord> {
  const value = Reflect.get(manager, "agents");
  if (!(value instanceof Map)) {
    throw new Error("agents map unavailable");
  }
  return value as Map<string, TestAgentRecord>;
}

function getPrivateEnsureAutonomyLoop(manager: CollabAgentManager): (record: TestAgentRecord) => void {
  const value = Reflect.get(manager, "ensureAutonomyLoop");
  if (typeof value !== "function") {
    throw new Error("ensureAutonomyLoop unavailable");
  }
  return value.bind(manager) as (record: TestAgentRecord) => void;
}

function createLiveWorkerRecord(workspaceRoot: string, overrides?: Partial<TestAgentRecord>): TestAgentRecord {
  const now = "2026-03-15T00:00:00.000Z";
  const agentWorkRoot = path.join(
    workspaceRoot,
    ".agents",
    "runtime",
    "collab",
    "workspaces",
    overrides?.id ?? "agent_worker"
  );
  fs.mkdirSync(path.join(agentWorkRoot, "repo"), { recursive: true });
  return {
    id: overrides?.id ?? "agent_worker",
    description: "worker",
    agentType: "worker",
    ...(overrides?.skillBundle?.length ? { skillBundle: overrides.skillBundle } : {}),
    capabilityGrant: createCapabilityGrant(workspaceRoot),
    ...(overrides?.modelOverride ? { modelOverride: overrides.modelOverride } : {}),
    agentWorkRoot,
    autonomous: overrides?.autonomous ?? false,
    ...(overrides?.claimedTaskId ? { claimedTaskId: overrides.claimedTaskId } : {}),
    ...(overrides?.idleSince ? { idleSince: overrides.idleSince } : {}),
    depth: overrides?.depth ?? 1,
    history: [],
    status: overrides?.status ?? "completed",
    createdAt: now,
    updatedAt: overrides?.updatedAt ?? now,
    pendingTasks: overrides?.pendingTasks ?? 0,
    completedTasks: overrides?.completedTasks ?? 1,
    recentSubmissionIds: overrides?.recentSubmissionIds ?? [],
    closed: overrides?.closed ?? false,
    chain: Promise.resolve(),
    getDrainPromise: () => Promise.resolve(),
    ...(overrides?.activeSubmissionId ? { activeSubmissionId: overrides.activeSubmissionId } : {}),
  };
}

async function withAgentDefinitions<T>(
  overrides: AgentDefinition[],
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map(getActiveAgentDefinitions());
  const next = new Map(previous);
  for (const definition of overrides) {
    next.set(definition.name, definition);
  }
  setActiveAgentDefinitions(next);
  try {
    return await fn();
  } finally {
    setActiveAgentDefinitions(previous);
  }
}

test("CollabAgentManager imports only staged worker repo files into the shared workspace", () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const manager = createManager(workspaceRoot);
  const agentWorkRoot = path.join(workspaceRoot, ".agents", "runtime", "collab", "workspaces", "agent_worker");
  const repoStageRoot = path.join(agentWorkRoot, "repo");
  fs.mkdirSync(path.join(repoStageRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoStageRoot, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(repoStageRoot, "src", "feature.ts"), "export const ok = true;\n", "utf-8");
  fs.writeFileSync(path.join(repoStageRoot, ".agents", "hidden.json"), "{\"bad\":true}\n", "utf-8");

  const store = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
  store.saveAgent({
    id: "agent_worker",
    description: "worker",
    agentType: "worker",
    capabilityGrant: createCapabilityGrant(workspaceRoot),
    agentWorkRoot,
    depth: 1,
    status: "completed",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    pendingTasks: 0,
    completedTasks: 1,
    recentSubmissionIds: [],
    closed: false,
  });

  const preview = manager.importAgentWorkspace({
    agentId: "agent_worker",
    mode: "dry_run",
  });
  assert.equal(preview.files.length, 1);
  assert.equal(preview.audit.agent_type, "worker");
  assert.match(preview.audit.workspace_lane, /\/repo$/);
  assert.equal(preview.summary.create_count, 1);
  assert.equal(preview.summary.conflict_count, 0);
  assert.equal(preview.files[0]?.target_path, path.join(workspaceRoot, "src", "feature.ts"));
  assert.equal(preview.files[0]?.import_decision, "create");
  assert.equal(fs.existsSync(path.join(workspaceRoot, "src", "feature.ts")), false);

  const applied = manager.importAgentWorkspace({
    agentId: "agent_worker",
    mode: "apply",
  });
  assert.equal(applied.files.length, 1);
  assert.equal(applied.audit.agent_id, "agent_worker");
  assert.equal(applied.summary.copied_count, 1);
  assert.equal(applied.summary.skipped_count, 0);
  assert.equal(
    fs.readFileSync(path.join(workspaceRoot, "src", "feature.ts"), "utf-8"),
    "export const ok = true;\n"
  );
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".agents", "hidden.json")), false);
});

test("CollabAgentManager rejects workspace import for non-worker agents", () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const manager = createManager(workspaceRoot);
  const store = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
  const agentWorkRoot = path.join(workspaceRoot, ".agents", "runtime", "collab", "workspaces", "agent_reviewer");
  fs.mkdirSync(agentWorkRoot, { recursive: true });

  store.saveAgent({
    id: "agent_reviewer",
    description: "reviewer",
    agentType: "reviewer",
    capabilityGrant: createCapabilityGrant(workspaceRoot),
    agentWorkRoot,
    depth: 1,
    status: "completed",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    pendingTasks: 0,
    completedTasks: 1,
    recentSubmissionIds: [],
    closed: false,
  });

  assert.throws(
    () =>
      manager.importAgentWorkspace({
        agentId: "agent_reviewer",
        mode: "dry_run",
      }),
    /仅允许导入 worker agent/
  );
});

test("CollabAgentManager dry_run reports conflicts and apply fails unless overwrite is explicit", () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const manager = createManager(workspaceRoot);
  const store = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
  const agentWorkRoot = path.join(workspaceRoot, ".agents", "runtime", "collab", "workspaces", "agent_worker");
  const repoStageRoot = path.join(agentWorkRoot, "repo");
  fs.mkdirSync(path.join(repoStageRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoStageRoot, "src", "feature.ts"), "export const next = 2;\n", "utf-8");
  fs.writeFileSync(path.join(workspaceRoot, "src", "feature.ts"), "export const prev = 1;\n", "utf-8");

  store.saveAgent({
    id: "agent_worker",
    description: "worker",
    agentType: "worker",
    capabilityGrant: createCapabilityGrant(workspaceRoot),
    agentWorkRoot,
    depth: 1,
    status: "completed",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    pendingTasks: 0,
    completedTasks: 1,
    recentSubmissionIds: [],
    closed: false,
  });

  const preview = manager.importAgentWorkspace({
    agentId: "agent_worker",
    mode: "dry_run",
  });
  assert.equal(preview.summary.conflict_count, 1);
  assert.equal(preview.files[0]?.import_decision, "conflict");
  assert.equal(preview.conflict_policy, "fail");

  assert.throws(
    () =>
      manager.importAgentWorkspace({
        agentId: "agent_worker",
        mode: "apply",
      }),
    /检测到 1 个冲突文件/
  );

  const applied = manager.importAgentWorkspace({
    agentId: "agent_worker",
    mode: "apply",
    conflictPolicy: "overwrite",
  });
  assert.equal(applied.conflict_policy, "overwrite");
  assert.equal(applied.summary.conflict_count, 1);
  assert.equal(applied.summary.copied_count, 1);
  assert.equal(
    fs.readFileSync(path.join(workspaceRoot, "src", "feature.ts"), "utf-8"),
    "export const next = 2;\n"
  );
});

test("CollabAgentManager spawn does not persist an orphan queued agent when task claim fails", () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const manager = createManager(workspaceRoot);
  const taskStore = new TaskStore(path.join(workspaceRoot, ".agents", "runtime", "tasks"));
  const task = taskStore.create({
    subject: "already owned task",
    owner: "小T",
  });

  assert.throws(
    () =>
      manager.spawn({
        description: "reviewer",
        prompt: "Check the finished images",
        agentType: "reviewer",
        taskId: task.id,
        depth: 1,
      }),
    /task already owned by 小T/,
  );

  assert.equal(manager.list().length, 0);

  const persistedStore = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
  assert.equal(persistedStore.listAgents().length, 0);

  const workspacesDir = path.join(workspaceRoot, ".agents", "runtime", "collab", "workspaces");
  assert.equal(fs.existsSync(workspacesDir), false);
});

test("CollabAgentManager markIdle persists idle status and timestamp", () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const manager = createManager(workspaceRoot);
  const record = createLiveWorkerRecord(workspaceRoot, {
    autonomous: true,
    status: "completed",
    completedTasks: 2,
  });
  getPrivateAgentsMap(manager).set(record.id, record);

  const status = manager.markIdle(record.id);
  assert.equal(status.status, "idle");
  assert.equal(status.status_source, "live");
  assert.equal(status.autonomous, true);
  assert.equal(typeof status.idle_since, "string");

  const persistedStore = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
  const persisted = persistedStore.loadAgent(record.id);
  assert.equal(persisted?.status, "idle");
  assert.equal(typeof persisted?.idleSince, "string");
});

test("CollabAgentManager subscribeStatus notifies listeners on persisted status transitions", () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const manager = createManager(workspaceRoot);
  const record = createLiveWorkerRecord(workspaceRoot, {
    id: "agent_watch",
    status: "completed",
    pendingTasks: 0,
    completedTasks: 1,
  });
  getPrivateAgentsMap(manager).set(record.id, record);

  let notificationCount = 0;
  const unsubscribe = manager.subscribeStatus(record.id, () => {
    notificationCount += 1;
  });

  manager.resume(record.id);
  manager.markIdle(record.id);
  unsubscribe();
  manager.close(record.id);

  assert.ok(notificationCount >= 2, `expected >=2 notifications, got ${notificationCount}`);
});

test("CollabAgentManager passes inherited modelOverride into child runs and persists it", async () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const observed: Array<{ prompt: string; modelOverride?: string }> = [];
  const fakeRunner = {
    async run(prompt: string, _cwd: string, options?: { modelOverride?: string }) {
      observed.push({
        prompt,
        ...(options?.modelOverride ? { modelOverride: options.modelOverride } : {}),
      });
      return "ok";
    },
  } as unknown as AgentRunner;
  const manager = createManager(workspaceRoot, fakeRunner);

  const spawned = manager.spawn({
    description: "worker",
    prompt: "Implement the task",
    agentType: "worker",
    modelOverride: "gpt-5.4",
    depth: 1,
  });
  await manager.get(spawned.agentId).getDrainPromise();

  assert.deepEqual(observed, [{ prompt: "Implement the task", modelOverride: "gpt-5.4" }]);
  const persistedStore = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
  const persisted = persistedStore.loadAgent(spawned.agentId);
  assert.equal(persisted?.modelOverride, "gpt-5.4");
  assert.equal(manager.get(spawned.agentId).modelOverride, "gpt-5.4");
  assert.equal(manager.status(spawned.agentId).model, "gpt-5.4");
});

test("CollabAgentManager applies definition skillBundle and inheritFromParent model policy to child runs", async () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const observed: Array<{
    prompt: string;
    modelOverride?: string;
    requiredSkills: string[];
  }> = [];
  const fakeRunner = {
    async run(
      prompt: string,
      _cwd: string,
      options?: {
        modelOverride?: string;
        requiredSkills?: string[];
      }
    ) {
      observed.push({
        prompt,
        ...(options?.modelOverride ? { modelOverride: options.modelOverride } : {}),
        requiredSkills: Array.isArray(options?.requiredSkills) ? options.requiredSkills : [],
      });
      return "ok";
    },
  } as unknown as AgentRunner;

  await withAgentDefinitions(
    [
      {
        name: "writer",
        description: "writer",
        tools: ["Skill", "read_file"],
        prompt: "writer prompt",
        team: true,
        executionMode: "direct",
        isolationMode: "shared_workspace",
        skillBundle: ["agents-team", "tapcanvas"],
        modelPolicy: {
          inheritFromParent: true,
        },
      },
    ],
    async () => {
      const manager = createManager(workspaceRoot, fakeRunner);
      const spawned = manager.spawn({
        description: "writer",
        prompt: "Draft the plan",
        agentType: "writer",
        requiredSkills: ["cognitive-memory", "agents-team"],
        modelOverride: "gpt-5.4",
        depth: 1,
      });
      await manager.get(spawned.agentId).getDrainPromise();

      assert.deepEqual(observed, [
        {
          prompt: "Draft the plan",
          modelOverride: "gpt-5.4",
          requiredSkills: ["agents-team", "tapcanvas", "cognitive-memory"],
        },
      ]);

      const persistedStore = new CollabRuntimeStore(path.join(workspaceRoot, ".agents", "runtime", "collab"));
      const persisted = persistedStore.loadAgent(spawned.agentId);
      assert.deepEqual(persisted?.skillBundle, ["agents-team", "tapcanvas", "cognitive-memory"]);
      assert.equal(persisted?.modelOverride, "gpt-5.4");
      assert.deepEqual(manager.get(spawned.agentId).skillBundle, ["agents-team", "tapcanvas", "cognitive-memory"]);
      assert.deepEqual(manager.status(spawned.agentId).skill_bundle, ["agents-team", "tapcanvas", "cognitive-memory"]);
    },
  );
});

test("CollabAgentManager applies definition defaultModel when the role pins a child model", async () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const observed: Array<{ modelOverride?: string }> = [];
  const fakeRunner = {
    async run(
      _prompt: string,
      _cwd: string,
      options?: {
        modelOverride?: string;
      }
    ) {
      observed.push({
        ...(options?.modelOverride ? { modelOverride: options.modelOverride } : {}),
      });
      return "ok";
    },
  } as unknown as AgentRunner;

  await withAgentDefinitions(
    [
      {
        name: "reviewer",
        description: "reviewer",
        tools: ["read_file"],
        prompt: "reviewer prompt",
        team: true,
        executionMode: "direct",
        isolationMode: "shared_workspace",
        modelPolicy: {
          defaultModel: "gpt-5.5-review",
        },
      },
    ],
    async () => {
      const manager = createManager(workspaceRoot, fakeRunner);
      const spawned = manager.spawn({
        description: "reviewer",
        prompt: "Review the patch",
        agentType: "reviewer",
        modelOverride: "gpt-5.4",
        depth: 1,
      });
      await manager.get(spawned.agentId).getDrainPromise();

      assert.deepEqual(observed, [{ modelOverride: "gpt-5.5-review" }]);
      assert.equal(manager.get(spawned.agentId).modelOverride, "gpt-5.5-review");
      assert.equal(manager.status(spawned.agentId).model, "gpt-5.5-review");
    },
  );
});

test("CollabAgentManager gives team children the parent grant tools except delegation and forwards provider bundle", async () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const observed: Array<{
    cwd: string;
    allowedTools: string[];
    capabilityProviderBundle: string[];
  }> = [];
  const fakeRunner = {
    async run(
      _prompt: string,
      cwd: string,
      options?: {
        allowedTools?: Set<string> | null;
        toolContextMeta?: Record<string, unknown>;
      }
    ) {
      observed.push({
        cwd,
        allowedTools: Array.from(options?.allowedTools ?? []).sort(),
        capabilityProviderBundle: Array.isArray(options?.toolContextMeta?.capabilityProviderBundle)
          ? options?.toolContextMeta?.capabilityProviderBundle
              .map((item) => String(item))
              .sort()
          : [],
      });
      return "ok";
    },
  } as unknown as AgentRunner;
  const manager = createManager(workspaceRoot, fakeRunner);

  const spawned = manager.spawn({
    description: "research",
    prompt: "Inspect the workflow files",
    agentType: "research",
    capabilityGrant: {
      tools: [
        "read_file",
        "read_file_range",
        "bash",
        "write_file",
        "edit_file",
        "background_run",
        "memory_search",
        "task_update",
        "spawn_agent",
      ],
      readableRoots: [workspaceRoot],
      writableRoots: [workspaceRoot],
      network: "none",
      budgets: {
        maxToolCalls: 8,
        maxTokens: 2000,
        maxWallTimeMs: 1000,
      },
    },
    depth: 1,
  });
  await manager.get(spawned.agentId).getDrainPromise();

  assert.deepEqual(observed, [
    {
      cwd: workspaceRoot,
      allowedTools: [
        "Skill",
        "background_run",
        "bash",
        "edit_file",
        "mailbox_read",
        "mailbox_send",
        "memory_search",
        "protocol_get",
        "protocol_read",
        "protocol_request",
        "protocol_respond",
        "read_file",
        "read_file_range",
        "task_update",
        "write_file",
      ],
      capabilityProviderBundle: ["local", "mcp", "remote"],
    },
  ]);

  const child = manager.get(spawned.agentId);
  assert.deepEqual(child.capabilityProviderBundle, ["local", "remote", "mcp"]);
  assert.ok(child.capabilityGrant.readableRoots.includes(workspaceRoot));
  assert.ok(child.capabilityGrant.readableRoots.includes(child.agentWorkRoot));
  assert.ok(child.capabilityGrant.writableRoots.includes(workspaceRoot));
  assert.ok(child.capabilityGrant.writableRoots.includes(child.agentWorkRoot));
  assert.equal(child.capabilityGrant.tools.includes("spawn_agent"), false);
  assert.deepEqual(manager.status(spawned.agentId).capability_provider_bundle, ["local", "remote", "mcp"]);
});

test("CollabAgentManager records over-budget diagnostics without failing the child submission", async () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const fakeRunner = {
    async run(
      _prompt: string,
      _cwd: string,
      _options?: { abortSignal?: AbortSignal }
    ) {
      return await new Promise<string>((resolve) => {
        setTimeout(() => resolve("child completed"), 60);
      });
    },
  } as unknown as AgentRunner;
  const manager = createManager(workspaceRoot, fakeRunner);

  const previousBudgetMs = process.env.AGENTS_SUBAGENT_RUN_BUDGET_MS;
  process.env.AGENTS_SUBAGENT_RUN_BUDGET_MS = "20";

  try {
    const spawned = manager.spawn({
      description: "research",
      prompt: "Inspect the workflow files",
      agentType: "research",
      depth: 1,
    });
    await manager.get(spawned.agentId).getDrainPromise();

    const status = manager.status(spawned.agentId);
    const submission = manager.submissionStatus(spawned.submissionId);
    assert.equal(status.status, "completed");
    assert.equal(status.pending_tasks, 0);
    assert.equal(status.active_submission_id, undefined);
    assert.equal(status.error, undefined);
    assert.equal(submission?.status, "completed");
    assert.equal(submission?.budget_ms, 20);
    assert.ok((submission?.run_elapsed_ms ?? 0) >= 20);
    assert.ok((submission?.over_budget_ms ?? 0) > 0);
    assert.match(submission?.last_progress_summary || "", /尚无后续 tool 或文本进展事件/);
  } finally {
    if (previousBudgetMs === undefined) delete process.env.AGENTS_SUBAGENT_RUN_BUDGET_MS;
    else process.env.AGENTS_SUBAGENT_RUN_BUDGET_MS = previousBudgetMs;
  }
});

test("CollabAgentManager autonomous agents auto-close after idle timeout", async () => {
  const workspaceRoot = createTempDir("agents-collab-manager-");
  const manager = createManager(workspaceRoot);
  const record = createLiveWorkerRecord(workspaceRoot, {
    id: "agent_idle_timeout",
    autonomous: true,
    status: "completed",
  });
  getPrivateAgentsMap(manager).set(record.id, record);

  const previousPollMs = process.env.AGENTS_AUTONOMOUS_POLL_MS;
  const previousIdleTimeoutMs = process.env.AGENTS_AUTONOMOUS_IDLE_TIMEOUT_MS;
  process.env.AGENTS_AUTONOMOUS_POLL_MS = "10";
  process.env.AGENTS_AUTONOMOUS_IDLE_TIMEOUT_MS = "20";

  try {
    getPrivateEnsureAutonomyLoop(manager)(record);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const status = manager.status(record.id);
    assert.equal(status.status, "closed");
    assert.equal(status.idle_since, undefined);
  } finally {
    manager.close(record.id);
    if (previousPollMs === undefined) delete process.env.AGENTS_AUTONOMOUS_POLL_MS;
    else process.env.AGENTS_AUTONOMOUS_POLL_MS = previousPollMs;
    if (previousIdleTimeoutMs === undefined) delete process.env.AGENTS_AUTONOMOUS_IDLE_TIMEOUT_MS;
    else process.env.AGENTS_AUTONOMOUS_IDLE_TIMEOUT_MS = previousIdleTimeoutMs;
  }
});
