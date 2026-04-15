import { BackgroundTaskManager } from "../background/manager.js";
import { ToolHandler } from "./registry.js";

function readRequestedBy(meta: Record<string, unknown> | undefined): string {
  const currentAgentId = typeof meta?.currentAgentId === "string" ? meta.currentAgentId.trim() : "";
  return currentAgentId || "root";
}

function readBackgroundManager(meta: Record<string, unknown> | undefined): BackgroundTaskManager {
  const manager = meta?.backgroundTaskManager;
  if (!(manager instanceof BackgroundTaskManager)) {
    throw new Error("background task manager unavailable");
  }
  return manager;
}

function buildBackgroundEnv(meta: Record<string, unknown> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (typeof meta?.agentWorkRoot === "string" && meta.agentWorkRoot.trim()) {
    env.AGENT_WORK_ROOT = meta.agentWorkRoot.trim();
  }
  if (typeof meta?.repoStageRoot === "string" && meta.repoStageRoot.trim()) {
    env.AGENT_REPO_STAGING_ROOT = meta.repoStageRoot.trim();
  }
  if (typeof meta?.sharedWorkspaceRoot === "string" && meta.sharedWorkspaceRoot.trim()) {
    env.AGENTS_SHARED_WORKSPACE_ROOT = meta.sharedWorkspaceRoot.trim();
  }
  return env;
}

export function createBackgroundRunTool(): ToolHandler {
  return {
    definition: {
      name: "background_run",
      description: "在后台执行一个 shell 命令，并在后续轮次自动注入完成通知。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "后台执行的 shell 命令" },
        },
        required: ["command"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const manager = readBackgroundManager(ctx.meta);
        const task = manager.start({
          command: String(args.command ?? ""),
          cwd: ctx.cwd,
          requestedBy: readRequestedBy(ctx.meta),
          env: buildBackgroundEnv(ctx.meta),
        });
        return { toolCallId, content: JSON.stringify(task, null, 2) };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

export function createBackgroundGetTool(): ToolHandler {
  return {
    definition: {
      name: "background_get",
      description: "读取单个后台任务状态与最近输出。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "后台任务 ID" },
          output_limit: { type: "number", description: "最近输出字符数，默认 4000" },
        },
        required: ["task_id"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const manager = readBackgroundManager(ctx.meta);
        const taskId = String(args.task_id ?? "").trim();
        const outputLimit = Number(args.output_limit ?? 4000);
        const task = manager.get(taskId);
        const output = manager.readOutput(
          taskId,
          Number.isFinite(outputLimit) ? Math.max(200, Math.trunc(outputLimit)) : 4000
        );
        return {
          toolCallId,
          content: JSON.stringify(
            {
              ...task,
              recent_output: output,
            },
            null,
            2
          ),
        };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

export function createBackgroundListTool(): ToolHandler {
  return {
    definition: {
      name: "background_list",
      description: "列出后台任务状态概览。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    async execute(_args, ctx, toolCallId) {
      try {
        const manager = readBackgroundManager(ctx.meta);
        return {
          toolCallId,
          content: JSON.stringify(
            {
              tasks: manager.list(),
            },
            null,
            2
          ),
        };
      } catch (error) {
        return { toolCallId, content: `Error: ${(error as Error).message}` };
      }
    },
  };
}
