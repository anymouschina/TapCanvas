import { ToolHandler } from "./registry.js";
import { TaskStore, TaskStatus } from "../tasks/store.js";

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function createTaskCreateTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: "task_create",
      description: "创建持久化任务节点。用于真正的任务图，而不是临时待办。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "任务标题" },
          description: { type: "string", description: "任务说明" },
          blockedBy: { type: "array", items: { type: "string" } },
          blocks: { type: "array", items: { type: "string" } },
          owner: { type: "string", description: "任务 owner" },
          workspaceLane: { type: "string", description: "任务执行 lane / 工作区标识" },
        },
        required: ["subject"],
      },
    },
    async execute(args, _ctx, toolCallId) {
      try {
        const task = store.create({
          subject: String(args.subject ?? ""),
          ...(typeof args.description === "string" ? { description: args.description } : {}),
          ...(Array.isArray(args.blockedBy) ? { blockedBy: normalizeStringArray(args.blockedBy) } : {}),
          ...(Array.isArray(args.blocks) ? { blocks: normalizeStringArray(args.blocks) } : {}),
          ...(typeof args.owner === "string" ? { owner: args.owner } : {}),
          ...(typeof args.workspaceLane === "string" ? { workspaceLane: args.workspaceLane } : {}),
        });
        return { toolCallId, content: JSON.stringify(task, null, 2) };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

export function createTaskUpdateTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: "task_update",
      description: "更新持久化任务状态、依赖或 owner。",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "任务 ID" },
          subject: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "blocked"] },
          owner: { type: "string" },
          workspaceLane: { type: "string" },
          addBlockedBy: { type: "array", items: { type: "string" } },
          addBlocks: { type: "array", items: { type: "string" } },
        },
        required: ["taskId"],
      },
    },
    async execute(args, _ctx, toolCallId) {
      try {
        const update: {
          subject?: string;
          description?: string;
          status?: TaskStatus;
          owner?: string;
          workspaceLane?: string;
          addBlockedBy?: string[];
          addBlocks?: string[];
        } = {};
        if (typeof args.subject === "string") update.subject = args.subject;
        if (typeof args.description === "string") update.description = args.description;
        if (typeof args.status === "string") update.status = args.status as TaskStatus;
        if (typeof args.owner === "string") update.owner = args.owner;
        if (typeof args.workspaceLane === "string") update.workspaceLane = args.workspaceLane;
        if (Array.isArray(args.addBlockedBy)) update.addBlockedBy = normalizeStringArray(args.addBlockedBy);
        if (Array.isArray(args.addBlocks)) update.addBlocks = normalizeStringArray(args.addBlocks);
        const task = store.update(String(args.taskId ?? ""), update);
        return { toolCallId, content: JSON.stringify(task, null, 2) };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

function readCurrentAgentId(meta: Record<string, unknown> | undefined): string {
  const currentAgentId = typeof meta?.currentAgentId === "string" ? meta.currentAgentId.trim() : "";
  if (!currentAgentId) {
    throw new Error("task_claim 需要 currentAgentId；请在 team agent 上下文中调用。");
  }
  return currentAgentId;
}

function readWorkspaceLane(meta: Record<string, unknown> | undefined): string {
  const repoStageRoot = typeof meta?.repoStageRoot === "string" ? meta.repoStageRoot.trim() : "";
  if (repoStageRoot) return repoStageRoot;
  const agentWorkRoot = typeof meta?.agentWorkRoot === "string" ? meta.agentWorkRoot.trim() : "";
  if (agentWorkRoot) return agentWorkRoot;
  const workspaceRoot = typeof meta?.workspaceRoot === "string" ? meta.workspaceRoot.trim() : "";
  return workspaceRoot;
}

export function createTaskClaimTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: "task_claim",
      description: "认领一个可执行任务；默认使用当前 agent 作为 owner，并绑定当前 execution lane。",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "可选。指定任务 ID；缺省时认领第一个可执行未认领任务。" },
          owner: { type: "string", description: "可选。覆盖默认 owner。" },
          workspaceLane: { type: "string", description: "可选。覆盖默认 workspace lane。" },
        },
        required: [],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const owner =
          typeof args.owner === "string" && args.owner.trim()
            ? args.owner.trim()
            : readCurrentAgentId(ctx.meta);
        const workspaceLane =
          typeof args.workspaceLane === "string" && args.workspaceLane.trim()
            ? args.workspaceLane.trim()
            : readWorkspaceLane(ctx.meta);
        const task =
          typeof args.taskId === "string" && args.taskId.trim()
            ? store.claim(args.taskId.trim(), { owner, workspaceLane })
            : store.claimNextAvailable({ owner, workspaceLane });
        if (!task) {
          throw new Error("当前没有可认领的任务。");
        }
        return { toolCallId, content: JSON.stringify(task, null, 2) };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

export function createTaskGetTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: "task_get",
      description: "读取单个持久化任务。",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "任务 ID" },
        },
        required: ["taskId"],
      },
    },
    async execute(args, _ctx, toolCallId) {
      try {
        const task = store.get(String(args.taskId ?? ""));
        return { toolCallId, content: JSON.stringify(task, null, 2) };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

export function createTaskListTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: "task_list",
      description: "列出全部持久化任务与依赖概览。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    async execute(_args, _ctx, toolCallId) {
      try {
        return { toolCallId, content: store.renderBoard() };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}
