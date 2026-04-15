import path from "node:path";

import { AgentRunner } from "../core/agent-loop.js";
import { getAllTeamToolNames } from "../core/subagent/types.js";
import type { Message, AgentConfig, CapabilityGrant } from "../types/index.js";
import type { LlmTurnTrace, ToolCallTrace } from "../core/hooks/types.js";
import { ToolRegistry } from "../core/tools/registry.js";
import { HookRegistry } from "../core/hooks/registry.js";
import { createFileTraceHook } from "../core/hooks/builtins/file-trace.js";
import { shellTool } from "../core/tools/shell.js";
import { readFileTool, readFileRangeTool, writeFileTool, editFileTool } from "../core/tools/fs.js";
import { createExecCommandTool, createExecSessionListTool, createWriteStdinTool } from "../core/tools/interactive-exec.js";
import { createBackgroundGetTool, createBackgroundListTool, createBackgroundRunTool } from "../core/tools/background.js";
import { createMemoryTools } from "../core/tools/memory.js";
import { TodoManager } from "../core/planner/todo.js";
import { createTodoTool } from "../core/tools/todo.js";
import { TaskStore } from "../core/tasks/store.js";
import {
  createTaskClaimTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskUpdateTool,
} from "../core/tools/tasks.js";
import { BackgroundTaskManager } from "../core/background/manager.js";
import { TerminalSessionManager } from "../core/terminal/session-manager.js";
import { SkillLoader } from "../core/skills/loader.js";
import { createSkillTool } from "../core/tools/skill.js";
import { LLMClient } from "../llm/client.js";
import { HookRunner } from "../core/hooks/runner.js";
import { WorldLogger } from "../core/logs/world-logger.js";
import {
  CollabAgentManager,
  createAgentWorkspaceImportTool,
  createCloseAgentTool,
  createIdleAgentTool,
  createListAgentsTool,
  createMailboxReadTool,
  createMailboxSendTool,
  createProtocolGetTool,
  createProtocolReadTool,
  createProtocolRequestTool,
  createProtocolRespondTool,
  createResumeAgentTool,
  createSendInputTool,
  createSpawnAgentTool,
  createWaitTool,
} from "../core/tools/collab.js";
import { CollabRuntimeStore } from "../core/collab/runtime-store.js";
import { CollabMailboxStore } from "../core/collab/mailbox-store.js";
import { CollabProtocolStore } from "../core/collab/protocol-store.js";
import {
  loadAgentDefinitions,
  resolveAgentDefinitionFiles,
  setActiveAgentDefinitions,
} from "../core/subagent/definitions.js";
import { listSessionSummaries, loadSessionMessages, saveSessionMessages, type SessionSummary } from "../core/memory/session.js";
import type { AgentRuntimeProfile } from "../core/root-persona.js";

import { buildRuntimeSystemOverride } from "./profile.js";
import { createRuntimeChannelMeta, type RuntimeChannelDescriptor } from "./channel.js";
import { resolveSkillsDirs } from "./skills.js";
import { resolveRuntimeSessionStoreDir } from "./session.js";
import type { RuntimeRunEventSink } from "./events.js";
import { parseRuntimeTodoUpdate } from "./todo-events.js";

export type RuntimeSessionStore = {
  dir: string;
  key: string;
};

export type AssistantRuntime = {
  cwd: string;
  config: AgentConfig;
  profile: AgentRuntimeProfile;
  skills: SkillLoader;
  runner: AgentRunner;
  memoryRoot: string;
  logger?: WorldLogger;
  systemOverride: string;
  collabManager: CollabAgentManager;
  backgroundTaskManager: BackgroundTaskManager;
  terminalSessionManager: TerminalSessionManager;
  baseCapabilityGrant: CapabilityGrant;
  registeredToolNames: string[];
  registeredTeamToolNames: string[];
  createToolContextMeta: (capabilityGrant?: CapabilityGrant) => Record<string, unknown>;
  resolveSessionStoreDir: () => string;
  createSessionStore: (sessionKey: string) => RuntimeSessionStore;
  loadSessionHistory: (sessionKey: string) => Message[];
  saveSessionHistory: (sessionKey: string, history: Message[]) => void;
  listSessions: (limit?: number) => SessionSummary[];
  run: (prompt: string, options?: AssistantRuntimeRunOptions) => Promise<string>;
  shutdown: (status: "ok" | "stopped" | "error") => Promise<void>;
};

export type AssistantRuntimeRunOptions = {
  sessionId?: string;
  history?: Message[];
  channel?: RuntimeChannelDescriptor;
  eventSink?: RuntimeRunEventSink;
  onToolStart?: (payload: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    startedAt: string;
  }) => void;
  onTextDelta?: (delta: string) => void;
  onTurn?: (turn: LlmTurnTrace) => void;
  onToolCall?: (toolCall: ToolCallTrace) => void;
};

type CreateAssistantRuntimeInput = {
  cwd: string;
  config: AgentConfig;
  profile: AgentRuntimeProfile;
};

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function createCapabilityGrant(input: {
  tools: string[];
  workspaceRoot: string;
  readableRoots?: string[];
  writableRoots?: string[];
}): CapabilityGrant {
  return {
    tools: uniqueStrings(input.tools),
    readableRoots: uniqueStrings([input.workspaceRoot, ...(input.readableRoots ?? [])]),
    writableRoots: uniqueStrings(input.writableRoots ?? [input.workspaceRoot]),
    network: "approved",
    budgets: {
      maxToolCalls: 64,
      maxTokens: 120000,
      maxWallTimeMs: 300000,
    },
  };
}

function logRuntimeMeta(logger?: WorldLogger): void {
  if (!logger) return;
  const entries: [string, string | undefined][] = [
    ["task", process.env.AGENTS_TASK_ID],
    ["task_title", process.env.AGENTS_TASK_TITLE],
    ["worktree", process.env.AGENTS_WORKTREE_PATH],
    ["repo", process.env.AGENTS_REPO_PATH],
    ["branch", process.env.AGENTS_TASK_BRANCH],
    ["profile", process.env.AGENTS_PROFILE],
  ];
  for (const [key, value] of entries) {
    if (!value) continue;
    void logger.log("event", `${key}: ${value}`);
  }
}

export function createAssistantRuntime(input: CreateAssistantRuntimeInput): AssistantRuntime {
  const { cwd, config, profile } = input;
  const systemOverride = buildRuntimeSystemOverride(profile);
  setActiveAgentDefinitions(loadAgentDefinitions(resolveAgentDefinitionFiles(config.workspaceRoot)));

  const registry = new ToolRegistry();
  const hookRegistry = new HookRegistry();
  hookRegistry.register(createFileTraceHook(cwd));
  const memoryRoot = path.join(cwd, config.memoryDir);
  if (profile !== "general") {
    registry.register(shellTool);
    registry.register(readFileTool);
    registry.register(readFileRangeTool);
    registry.register(writeFileTool);
    registry.register(editFileTool);
    registry.register(createExecCommandTool());
    registry.register(createWriteStdinTool());
    registry.register(createExecSessionListTool());
    registry.register(createBackgroundRunTool());
    registry.register(createBackgroundGetTool());
    registry.register(createBackgroundListTool());
    for (const memoryTool of createMemoryTools(memoryRoot)) {
      registry.register(memoryTool);
    }
  }

  const todoManager = new TodoManager();
  registry.register(createTodoTool(todoManager));
  const taskStore = new TaskStore(path.join(config.workspaceRoot, ".agents", "runtime", "tasks"));
  registry.register(createTaskCreateTool(taskStore));
  registry.register(createTaskUpdateTool(taskStore));
  registry.register(createTaskGetTool(taskStore));
  registry.register(createTaskListTool(taskStore));
  registry.register(createTaskClaimTool(taskStore));
  const backgroundTaskManager = new BackgroundTaskManager(
    path.join(config.workspaceRoot, ".agents", "runtime", "background"),
  );
  const terminalSessionManager = new TerminalSessionManager();

  const skills = new SkillLoader(resolveSkillsDirs(cwd, config.workspaceRoot, config.skillsDir));
  registry.register(createSkillTool(skills));

  if (profile !== "general") {
    registry.register(createSpawnAgentTool());
    registry.register(createSendInputTool());
    registry.register(createResumeAgentTool());
    registry.register(createIdleAgentTool());
    registry.register(createWaitTool());
    registry.register(createCloseAgentTool());
    registry.register(createListAgentsTool());
    registry.register(createAgentWorkspaceImportTool());
    registry.register(createMailboxSendTool());
    registry.register(createMailboxReadTool());
    registry.register(createProtocolRequestTool());
    registry.register(createProtocolReadTool());
    registry.register(createProtocolRespondTool());
    registry.register(createProtocolGetTool());
  }

  const registeredToolNames = registry.list().map((tool) => tool.name);
  const teamToolNames = new Set(getAllTeamToolNames());
  const registeredTeamToolNames = registeredToolNames.filter((toolName) => teamToolNames.has(toolName));
  const client = new LLMClient(config);
  const runner = new AgentRunner(config, registry, client, skills, new HookRunner(hookRegistry.list()));
  const baseCapabilityGrant = createCapabilityGrant({
    tools: registeredToolNames,
    workspaceRoot: config.workspaceRoot,
  });
  const logger =
    config.worldApiUrl && config.worldApiUrl.length > 0
      ? new WorldLogger({
          apiUrl: config.worldApiUrl,
          processName: path.basename(cwd),
        })
      : undefined;

  logger?.start();
  logRuntimeMeta(logger);

  const collabManager = new CollabAgentManager({
    runner,
    cwd,
    systemOverride,
    maxDepth: config.maxSubagentDepth,
    baseCapabilityGrant,
    tasks: taskStore,
    store: new CollabRuntimeStore(path.join(config.workspaceRoot, ".agents", "runtime", "collab")),
    mailbox: new CollabMailboxStore(path.join(config.workspaceRoot, ".agents", "runtime", "collab", "mailbox")),
    protocol: new CollabProtocolStore(path.join(config.workspaceRoot, ".agents", "runtime", "collab", "protocol")),
    worldApiUrl: config.worldApiUrl,
    parentLoggerId: logger?.id,
    processName: path.basename(cwd),
  });

  const createToolContextMeta = (
    capabilityGrant = baseCapabilityGrant,
    extraMeta?: Record<string, unknown>,
  ): Record<string, unknown> => ({
    collabManager,
    backgroundTaskManager,
    terminalSessionManager,
    maxSubagentDepth: config.maxSubagentDepth,
    workspaceRoot: config.workspaceRoot,
    defaultMemoryRoot: memoryRoot,
    runtimeProfile: profile,
    registeredToolNames,
    registeredTeamToolNames,
    capabilityGrant,
    ...(extraMeta ?? {}),
  });

  const resolveSessionStoreDir = (): string =>
    resolveRuntimeSessionStoreDir({
      cwd,
      memoryDir: config.memoryDir,
    });

  const createSessionStore = (sessionKey: string): RuntimeSessionStore => ({
    dir: resolveSessionStoreDir(),
    key: sessionKey,
  });

  const loadSessionHistory = (sessionKey: string): Message[] => loadSessionMessages(createSessionStore(sessionKey));
  const persistSessionHistory = (sessionKey: string, history: Message[]): void => {
    saveSessionMessages(createSessionStore(sessionKey), history);
  };
  const listSessions = (limit = 20): SessionSummary[] => listSessionSummaries(resolveSessionStoreDir(), limit);
  const run = async (prompt: string, options?: AssistantRuntimeRunOptions): Promise<string> => {
    await Promise.resolve(options?.eventSink?.({
      type: "run.started",
      prompt,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    }));
    try {
      const result = await runner.run(prompt, cwd, {
        depth: 0,
        ...(options?.history ? { history: options.history } : {}),
        ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
        systemOverride,
        toolContextMeta: createToolContextMeta(
          baseCapabilityGrant,
          createRuntimeChannelMeta(options?.channel),
        ),
        onToolStart: (toolStart) => {
          options?.onToolStart?.(toolStart);
          void options?.eventSink?.({
            type: "tool.started",
            toolCallId: toolStart.toolCallId,
            name: toolStart.name,
            args: toolStart.args,
            startedAt: toolStart.startedAt,
          });
        },
        onTextDelta: (delta) => {
          options?.onTextDelta?.(delta);
          void options?.eventSink?.({ type: "text.delta", delta });
        },
        onTurn: (turn) => {
          options?.onTurn?.(turn);
          void options?.eventSink?.({ type: "turn.completed", turn });
        },
        onToolCall: (toolCall) => {
          options?.onToolCall?.(toolCall);
          const todoUpdate = parseRuntimeTodoUpdate(toolCall);
          if (todoUpdate) {
            void options?.eventSink?.({ type: "todo.updated", todo: todoUpdate });
          }
          void options?.eventSink?.({ type: "tool.completed", toolCall });
        },
      });
      await Promise.resolve(options?.eventSink?.({ type: "run.completed", result }));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await Promise.resolve(options?.eventSink?.({ type: "run.failed", message }));
      throw error;
    }
  };

  const shutdown = async (status: "ok" | "stopped" | "error"): Promise<void> => {
    terminalSessionManager.closeAll();
    await logger?.updateStatus(status);
  };

  return {
    cwd,
    config,
    profile,
    skills,
    runner,
    memoryRoot,
    logger,
    systemOverride,
    collabManager,
    backgroundTaskManager,
    terminalSessionManager,
    baseCapabilityGrant,
    registeredToolNames,
    registeredTeamToolNames,
    createToolContextMeta,
    resolveSessionStoreDir,
    createSessionStore,
    loadSessionHistory,
    saveSessionHistory: persistSessionHistory,
    listSessions,
    run,
    shutdown,
  };
}
