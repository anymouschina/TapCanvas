import { ToolHandler } from "./registry.js";
import { CapabilityGrant } from "../../types/index.js";
import { AgentType, getTeamAgentDescriptions } from "../subagent/types.js";
import { CollabAgentManagerLike } from "../collab/public.js";
import {
  ensureAllowedSubagentType,
  ensureExplicitRole,
  getManager,
  readCurrentSystem,
  readCurrentModel,
  readCurrentRequiredSkills,
  readCurrentMessages,
  sleep,
  TEAM_AGENT_TYPES,
} from "./collab-tool-helpers.js";

type AgentStatus = "queued" | "running" | "idle" | "completed" | "failed" | "closed";

function isFinal(status: AgentStatus) {
  return status === "completed" || status === "failed" || status === "closed";
}

function areRequestsDone(requests: Array<{ status: string }>) {
  return requests.every((request) => request.status === "responded");
}

function readCapabilityGrant(meta: Record<string, unknown> | undefined): CapabilityGrant | undefined {
  const raw = meta?.capabilityGrant;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as CapabilityGrant;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeReadCurrentAgentTaskId(
  mgr: CollabAgentManagerLike,
  currentAgentId: string,
): string {
  try {
    return normalizeOptionalString(mgr.get(currentAgentId).claimedTaskId);
  } catch {
    return "";
  }
}

type SpawnTaskBindingDecision = {
  taskId?: string;
  binding?: {
    status: "bound" | "skipped_current_task" | "skipped_existing_owner";
    task_id: string;
    owner?: string;
    reason: string;
  };
};

function preflightSpawnTaskId(input: {
  mgr: CollabAgentManagerLike;
  taskId: unknown;
  currentAgentId?: string;
  autonomous?: boolean;
}): SpawnTaskBindingDecision {
  const requestedTaskId = normalizeOptionalString(input.taskId);
  if (!requestedTaskId) return {};

  const currentAgentId = normalizeOptionalString(input.currentAgentId);
  if (currentAgentId) {
    const currentClaimedTaskId = safeReadCurrentAgentTaskId(input.mgr, currentAgentId);
    if (currentClaimedTaskId === requestedTaskId) {
      return {
        binding: {
          status: "skipped_current_task",
          task_id: requestedTaskId,
          reason: "current_agent_already_claimed_task",
        },
      };
    }
  }

  if (typeof input.mgr.getTask === "function") {
    const task = input.mgr.getTask(requestedTaskId);
    if (task?.owner) {
      if (currentAgentId && task.owner === currentAgentId) {
        return {
          binding: {
            status: "skipped_existing_owner",
            task_id: requestedTaskId,
            owner: task.owner,
            reason: "current_agent_matches_task_owner",
          },
        };
      }
      if (input.autonomous !== true) {
        return {
          binding: {
            status: "skipped_existing_owner",
            task_id: requestedTaskId,
            owner: task.owner,
            reason: "task_already_owned",
          },
        };
      }
      throw new Error(
        `task already owned by ${task.owner}: ${task.id}。若只需要派一个未绑定 helper，请省略 task_id。`
      );
    }
  }

  return {
    taskId: requestedTaskId,
    binding: {
      status: "bound",
      task_id: requestedTaskId,
      reason: "task_claim_requested",
    },
  };
}

export function createSpawnAgentTool(): ToolHandler {
  return {
    definition: {
      name: "spawn_agent",
      description:
        `Spawn a team sub-agent and assign an explicit team role.\n\nAvailable team roles:\n${getTeamAgentDescriptions()}`,
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short label for this agent" },
          prompt: { type: "string", description: "Initial task for the agent" },
          agent_type: { type: "string", enum: TEAM_AGENT_TYPES },
          fork_context: {
            type: "boolean",
            description:
              "When true, seed the child agent with the parent's current conversation history before running the prompt",
          },
          autonomous: {
            type: "boolean",
            description:
              "When true, keep polling the persistent task board after current work finishes and auto-claim ready tasks.",
          },
          task_id: {
            type: "string",
            description:
              "Optional persistent task id to claim and bind to this agent's execution lane immediately at spawn time.",
          },
        },
        required: ["prompt", "agent_type"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const agentType = String(args.agent_type ?? "") as AgentType;
        ensureExplicitRole(agentType);
        ensureAllowedSubagentType(agentType, ctx.meta);

        const depth = ctx.depth + 1;
        const maxDepthRaw = ctx.meta?.maxSubagentDepth;
        const maxDepth =
          typeof maxDepthRaw === "number" && Number.isFinite(maxDepthRaw)
            ? maxDepthRaw
            : 3;
        if (depth > maxDepth) {
          throw new Error("已达到子代理最大深度。");
        }

        const parentAgentId =
          typeof ctx.meta?.currentAgentId === "string" ? ctx.meta.currentAgentId : undefined;
        const shouldFork = args.fork_context === true;
        const parentMessages = shouldFork ? readCurrentMessages(ctx.meta) : [];
        const parentModel = readCurrentModel(ctx.meta);
        const parentRequiredSkills = readCurrentRequiredSkills(ctx.meta);
        const parentSystem = readCurrentSystem(ctx.meta);
        const taskBinding = preflightSpawnTaskId({
          mgr,
          taskId: args.task_id,
          currentAgentId: parentAgentId,
          autonomous: args.autonomous === true,
        });
        const spawned = mgr.spawn({
          description: String(args.description ?? agentType),
          prompt: String(args.prompt ?? ""),
          agentType,
          ...(parentRequiredSkills.length > 0 ? { requiredSkills: parentRequiredSkills } : {}),
          ...(parentModel ? { modelOverride: parentModel } : {}),
          ...(parentSystem ? { systemOverride: parentSystem } : {}),
          ...(args.autonomous === true ? { autonomous: true } : {}),
          ...(taskBinding.taskId ? { taskId: taskBinding.taskId } : {}),
          ...(readCapabilityGrant(ctx.meta) ? { capabilityGrant: readCapabilityGrant(ctx.meta) } : {}),
          depth,
          ...(parentAgentId ? { parentAgentId } : {}),
          ...(parentMessages.length > 0 ? { initialHistory: parentMessages } : {}),
        });
        return {
          toolCallId,
          content: JSON.stringify({
            agent_id: spawned.agentId,
            submission_id: spawned.submissionId,
            ...(taskBinding.binding ? { task_binding: taskBinding.binding } : {}),
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createSendInputTool(): ToolHandler {
  return {
    definition: {
      name: "send_input",
      description: "Queue additional work for an existing team agent.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Agent id returned by spawn_agent" },
          prompt: { type: "string", description: "Additional instruction to queue" },
          interrupt: {
            type: "boolean",
            description:
              "Reserved for future interrupt semantics. If true while the agent is busy, this tool fails explicitly instead of pretending to interrupt.",
          },
        },
        required: ["id", "prompt"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const id = String(args.id ?? "");
        const prompt = String(args.prompt ?? "");
        const record = mgr.get(id);
        if (args.interrupt === true && (record.status === "running" || record.pendingTasks > 0)) {
          throw new Error("当前实现不支持中断正在执行或排队中的 agent；请等待完成后再 send_input。");
        }
        const queued = mgr.enqueue(id, prompt);
        return {
          toolCallId,
          content: JSON.stringify({
            id,
            submission_id: queued.submissionId,
            status: record.status,
            queued: true,
            pending_tasks: record.pendingTasks,
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createResumeAgentTool(): ToolHandler {
  return {
    definition: {
      name: "resume_agent",
      description:
        "Resume a previously closed team agent so it can receive future send_input calls. Does not cancel or replay past work.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Closed agent id returned by spawn_agent" },
        },
        required: ["id"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const id = String(args.id ?? "");
        return {
          toolCallId,
          content: JSON.stringify(mgr.resume(id)),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createIdleAgentTool(): ToolHandler {
  return {
    definition: {
      name: "idle_agent",
      description:
        "Mark the current team agent as idle after it has finished its local work and is waiting for new tasks.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    async execute(_args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const currentAgentId =
          typeof ctx.meta?.currentAgentId === "string" ? ctx.meta.currentAgentId.trim() : "";
        if (!currentAgentId) {
          throw new Error("idle_agent 只能在 team agent 上下文中调用。");
        }
        return {
          toolCallId,
          content: JSON.stringify(mgr.markIdle(currentAgentId)),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createWaitTool(): ToolHandler {
  return {
    definition: {
      name: "wait",
      description: "Wait for team agents and/or protocol requests to reach terminal state.",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "Optional agent ids" },
          request_ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional protocol request ids",
          },
          timeout_ms: { type: "number", description: "Optional timeout in ms (default 30000)" },
        },
        required: [],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const ids = Array.isArray(args.ids) ? args.ids.map(String).filter(Boolean) : [];
        const requestIds = Array.isArray(args.request_ids)
          ? args.request_ids.map(String).filter(Boolean)
          : [];
        if (ids.length === 0 && requestIds.length === 0) {
          throw new Error("wait 至少需要 ids 或 request_ids 之一。");
        }
        const timeoutMs = Number(args.timeout_ms ?? 30000);
        const deadline = Date.now() + (Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 30000);
        while (Date.now() < deadline) {
          const statuses = ids.map((id) => mgr.status(id));
          const requests = requestIds.map((id) => mgr.getProtocolRequest(id));
          const agentDone = statuses.every((status) => isFinal(status.status as AgentStatus));
          const requestDone = areRequestsDone(requests);
          if (agentDone && requestDone) {
            break;
          }
          await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
        }

        const statuses = ids.map((id) => mgr.status(id));
        const submissions = mgr.listSubmissionsForAgents(ids);
        const requests = requestIds.map((id) => mgr.getProtocolRequest(id));
        const done =
          statuses.every((status) => isFinal(status.status as AgentStatus)) &&
          areRequestsDone(requests);
        return {
          toolCallId,
          content: JSON.stringify({
            done,
            agents: statuses,
            submissions,
            requests: requests.map((request) => ({
              id: request.id,
              from_agent_id: request.fromAgentId,
              to_agent_id: request.toAgentId,
              action: request.action,
              status: request.status,
              created_at: request.createdAt,
              updated_at: request.updatedAt,
              response: request.response
                ? {
                    responder_agent_id: request.response.responderAgentId,
                    status: request.response.status,
                    output: request.response.output,
                    responded_at: request.response.respondedAt,
                  }
                : null,
            })),
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createCloseAgentTool(): ToolHandler {
  return {
    definition: {
      name: "close_agent",
      description:
        "Close a team agent. Note: in-flight work cannot be force-cancelled; closing only prevents future queued work.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Agent id" },
        },
        required: ["id"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const id = String(args.id ?? "");
        const status = mgr.close(id);
        return { toolCallId, content: JSON.stringify({ id, status }) };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createListAgentsTool(): ToolHandler {
  return {
    definition: {
      name: "list_agents",
      description: "List current team agents and their status.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    async execute(_args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        return {
          toolCallId,
          content: JSON.stringify({
            agents: mgr.list(),
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createAgentWorkspaceImportTool(): ToolHandler {
  return {
    definition: {
      name: "agent_workspace_import",
      description:
        "Inspect or import staged repo files from a worker agent workspace into the shared workspace root.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Worker agent id" },
          mode: {
            type: "string",
            enum: ["dry_run", "apply"],
            description: "Use dry_run to inspect staged files, apply to copy them into the shared workspace root.",
          },
          conflict_policy: {
            type: "string",
            enum: ["fail", "overwrite"],
            description:
              "Optional apply policy when target files already differ. Default is fail. overwrite must be explicit.",
          },
        },
        required: ["agent_id", "mode"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const mode = String(args.mode ?? "");
        if (mode !== "dry_run" && mode !== "apply") {
          throw new Error('agent_workspace_import.mode 必须为 "dry_run" 或 "apply"。');
        }
        const conflictPolicyRaw = String(args.conflict_policy ?? "").trim();
        if (
          conflictPolicyRaw &&
          conflictPolicyRaw !== "fail" &&
          conflictPolicyRaw !== "overwrite"
        ) {
          throw new Error('agent_workspace_import.conflict_policy 必须为 "fail" 或 "overwrite"。');
        }
        const result = mgr.importAgentWorkspace({
          agentId: String(args.agent_id ?? ""),
          mode,
          ...(conflictPolicyRaw
            ? { conflictPolicy: conflictPolicyRaw as "fail" | "overwrite" }
            : {}),
        });
        return {
          toolCallId,
          content: JSON.stringify(result),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}
