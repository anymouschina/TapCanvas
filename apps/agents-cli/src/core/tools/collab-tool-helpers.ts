import { AgentType, getTeamAgentTypes, isAgentType } from "../subagent/types.js";
import { Message, ToolCall } from "../../types/index.js";
import { CollabAgentManagerLike } from "../collab/public.js";

export const TEAM_AGENT_TYPES = getTeamAgentTypes();

export function ensureExplicitRole(agentType: AgentType) {
  if (!TEAM_AGENT_TYPES.includes(agentType)) {
    throw new Error(
      `agent_type 必须显式声明为团队角色之一：${TEAM_AGENT_TYPES.join(", ")}`
    );
  }
}

export function readAllowedSubagentTypes(meta: Record<string, unknown> | undefined): AgentType[] {
  const raw = meta?.allowedSubagentTypes;
  if (!Array.isArray(raw)) return [];
  const out: AgentType[] = [];
  const seen = new Set<AgentType>();
  for (const item of raw) {
    const normalized = String(item || "").trim();
    if (!isAgentType(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function ensureAllowedSubagentType(
  agentType: AgentType,
  meta: Record<string, unknown> | undefined,
): void {
  const allowedTypes = readAllowedSubagentTypes(meta);
  if (allowedTypes.length === 0) return;
  if (allowedTypes.includes(agentType)) return;
  throw new Error(
    `本轮仅允许以下 agent_type：${allowedTypes.join(", ")}；收到: ${agentType}`
  );
}

export function getManager(meta: Record<string, unknown> | undefined): CollabAgentManagerLike {
  const mgr = meta?.collabManager;
  if (!mgr || typeof mgr !== "object") throw new Error("collab manager unavailable");
  return mgr as CollabAgentManagerLike;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (toolCall): toolCall is { id: string; name: string; arguments: string } =>
        !!toolCall &&
        typeof toolCall === "object" &&
        typeof (toolCall as { id?: unknown }).id === "string" &&
        typeof (toolCall as { name?: unknown }).name === "string" &&
        typeof (toolCall as { arguments?: unknown }).arguments === "string"
    )
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    }));
}

function cloneMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<Message>;
  if (
    candidate.role !== "user" &&
    candidate.role !== "assistant" &&
    candidate.role !== "tool"
  ) {
    return null;
  }
  if (typeof candidate.content !== "string") return null;

  const toolCalls = cloneToolCalls(candidate.toolCalls);
  return {
    role: candidate.role,
    content: candidate.content,
    ...(typeof candidate.toolCallId === "string" ? { toolCallId: candidate.toolCallId } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

export function sanitizeForkedMessages(messages: Message[]): Message[] {
  const resolvedToolCallIds = new Set<string>();
  const openToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        openToolCallIds.add(toolCall.id);
      }
      continue;
    }
    if (
      message.role === "tool" &&
      typeof message.toolCallId === "string" &&
      openToolCallIds.has(message.toolCallId)
    ) {
      resolvedToolCallIds.add(message.toolCallId);
    }
  }

  const sanitized: Message[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const toolCalls =
        message.toolCalls
          ?.filter((toolCall) => resolvedToolCallIds.has(toolCall.id))
          .map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          })) ?? [];
      if (message.content.length === 0 && toolCalls.length === 0) {
        continue;
      }
      sanitized.push({
        role: "assistant",
        content: message.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
      continue;
    }

    if (message.role === "tool") {
      if (
        typeof message.toolCallId !== "string" ||
        !resolvedToolCallIds.has(message.toolCallId)
      ) {
        continue;
      }
      sanitized.push({
        role: "tool",
        content: message.content,
        toolCallId: message.toolCallId,
      });
      continue;
    }

    sanitized.push({
      role: "user",
      content: message.content,
    });
  }

  return sanitized;
}

export function readCurrentMessages(meta: Record<string, unknown> | undefined): Message[] {
  const raw = meta?.currentMessages;
  if (!Array.isArray(raw)) return [];
  const valid = raw
    .map((item) => cloneMessage(item))
    .filter((message): message is Message => message !== null);
  return sanitizeForkedMessages(valid);
}

export function readCurrentModel(meta: Record<string, unknown> | undefined): string | undefined {
  const raw = typeof meta?.currentModel === "string" ? meta.currentModel.trim() : "";
  return raw || undefined;
}

export function readCurrentRequiredSkills(meta: Record<string, unknown> | undefined): string[] {
  const raw = meta?.currentRequiredSkills;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function readCurrentSystem(meta: Record<string, unknown> | undefined): string | undefined {
  const raw = typeof meta?.currentSystem === "string" ? meta.currentSystem.trim() : "";
  return raw || undefined;
}
