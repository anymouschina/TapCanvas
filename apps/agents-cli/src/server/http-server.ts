import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { URL } from "node:url";

import type { AgentRunner } from "../core/agent-loop.js";
import type {
  CapabilitySnapshot,
  ContextDiagnostics,
  Message,
  ToolPolicySummary,
} from "../types/index.js";
import { loadSessionMessages, saveSessionMessages } from "../core/memory/session.js";
import path from "node:path";
import { createClient } from "redis";
import type { CollabAgentManager } from "../core/tools/collab.js";
import type { RemoteToolDefinition } from "../types/index.js";
import {
  formatGenerationContractPromptLines,
  parseGenerationContract,
  type GenerationContract,
} from "../contracts/generation-contract.js";
import type { RuntimeRunEvent } from "../runtime/events.js";
import { createRuntimeChannelMeta } from "../runtime/channel.js";
import { parseRuntimeTodoUpdate } from "../runtime/todo-events.js";

export type AgentsHttpServerOptions = {
  host: string;
  port: number;
  token?: string;
  bodyLimitBytes?: number;
};

export type AgentsChatRequest = {
  prompt: string;
  stream?: boolean;
  diagnosticContext?: Record<string, unknown>;
  canvasCapabilityManifest?: {
    version?: string;
    summary?: string;
    localCanvasTools?: Array<{
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
    remoteTools?: Array<{
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
    nodeSpecs?: Record<string, unknown>;
    protocols?: Record<string, unknown>;
  };
  generationContract?: GenerationContract;
  systemPrompt?: string;
  responseFormat?: unknown;
  response_format?: unknown;
  model?: string;
  modelAlias?: string;
  modelKey?: string;
  referenceImages?: string[];
  assetInputs?: Array<{
    assetId?: string;
    assetRefId?: string;
    url?: string;
    role?: string;
    note?: string;
    name?: string;
    weight?: number;
  }>;
  referenceImageSlots?: Array<{
    slot?: string;
    url?: string;
    role?: string;
    label?: string;
    note?: string;
  }>;
  requiredSkills?: string[];
  allowedTools?: string[];
  allowedSubagentTypes?: string[];
  requireAgentsTeamExecution?: boolean;
  resourceWhitelist?: {
    projectIds?: string[];
    allowUserScopedPublicAssets?: boolean;
    allowSystemPublicMetadata?: boolean;
  };
  maxTurns?: number;
  compactPrelude?: boolean;
  sessionId?: string;
  userId?: string;
  resetSession?: boolean;
  privilegedLocalAccess?: boolean;
  forceLocalResourceViaBash?: boolean;
  localResourcePaths?: string[];
  remoteTools?: RemoteToolDefinition[];
  mcpTools?: RemoteToolDefinition[];
  remoteToolConfig?: {
    endpoint: string;
    authToken?: string;
    apiKey?: string;
    projectId?: string;
    flowId?: string;
    nodeId?: string;
  };
  mcpToolConfig?: {
    endpoint: string;
    authToken?: string;
    apiKey?: string;
  };
};

type AgentsChatReferenceImageSlot = {
  slot: string;
  url: string;
  role: string | null;
  label: string | null;
  note: string | null;
};

type AgentsChatAssetInput = {
  assetId: string | null;
  assetRefId: string | null;
  url: string;
  role: string | null;
  note: string | null;
  name: string | null;
  weight: number | null;
};

type AgentsChatCanvasCapabilityTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type AgentsChatCanvasCapabilityManifest = {
  version: string | null;
  summary: string | null;
  localCanvasTools: AgentsChatCanvasCapabilityTool[];
  remoteTools: AgentsChatCanvasCapabilityTool[];
  nodeSpecs: Record<string, Record<string, unknown>>;
  protocols: Record<string, unknown> | null;
};

export type AgentsChatAsset = {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  vendor?: string;
  taskId?: string;
  toolName?: string;
};

export type AgentsChatToolCall = {
  seq: number;
  atMs: number;
  name: string;
  status: "succeeded" | "failed" | "denied" | "blocked";
  input: unknown;
  outputPreview: string;
  outputJson?: Record<string, unknown>;
  outputChars: number;
  outputHead: string;
  outputTail: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorMessage?: string;
  pathHint?: string;
};

export type AgentsChatTodoListItem = {
  text: string;
  completed: boolean;
  status: "pending" | "in_progress" | "completed";
};

export type AgentsChatTodoListTrace = {
  sourceToolCallId: string;
  items: AgentsChatTodoListItem[];
  totalCount: number;
  completedCount: number;
  inProgressCount: number;
};

export type AgentsChatTodoEventTrace = AgentsChatTodoListTrace & {
  pendingCount: number;
  atMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type AgentsChatPlanningTrace = {
  source: "todo_list";
  planningRequired: boolean;
  minimumStepCount: number;
  hasChecklist: boolean;
  latestStepCount: number;
  maxObservedStepCount: number;
  completedCount: number;
  inProgressCount: number;
  pendingCount: number;
  meetsMinimumStepCount: boolean;
  checklistComplete: boolean;
};

export type AgentsChatRuntimeTrace = {
  profile: "general" | "code" | "unknown";
  registeredToolNames: string[];
  registeredTeamToolNames: string[];
  requiredSkills: string[];
  loadedSkills: string[];
  allowedSubagentTypes: string[];
  requireAgentsTeamExecution: boolean;
  systemSnapshot?: {
    currentDate: string;
    gitBranch: string | null;
    gitStatus: string | null;
    recentCommits: string[];
  };
  toolBatchSummaries?: Array<{
    label: string;
    startedAt: string;
    finishedAt: string;
    toolNames: string[];
    succeededCount: number;
    failedCount: number;
    blockedCount: number;
    deniedCount: number;
  }>;
  compactionEvents?: Array<{
    kind: string;
    originalMessageCount: number;
    compactedMessageCount: number;
    originalChars: number;
    compactedChars: number;
    preserveStartIndex: number;
  }>;
  contextDiagnostics?: ContextDiagnostics;
  capabilitySnapshot?: CapabilitySnapshot;
  policySummary?: ToolPolicySummary;
  canvasCapabilities?: {
    version: string | null;
    localCanvasToolNames: string[];
    remoteToolNames: string[];
    nodeKinds: string[];
  };
};

export type AgentsChatCompletionTrace = {
  source: "deterministic";
  terminal: "success" | "explicit_failure" | "blocked";
  allowFinish: boolean;
  failureReason: string | null;
  rationale: string;
  successCriteria: string[];
  missingCriteria: string[];
  requiredActions: string[];
  retryCount?: number;
  recoveredAfterRetry?: boolean;
};

export type AgentsChatTrace = {
  toolCalls: AgentsChatToolCall[];
  turns: Array<{
    turn: number;
    text: string;
    textPreview: string;
    textChars: number;
    toolCallCount: number;
    toolNames: string[];
    finished: boolean;
  }>;
  output: {
    textChars: number;
    preview: string;
    head: string;
    tail: string;
  };
  summary: {
    totalToolCalls: number;
    succeededToolCalls: number;
    failedToolCalls: number;
    deniedToolCalls: number;
    blockedToolCalls: number;
    runMs: number;
  };
  completion?: AgentsChatCompletionTrace;
  runtime?: AgentsChatRuntimeTrace;
  planning?: AgentsChatPlanningTrace;
  todoList?: AgentsChatTodoListTrace;
  todoEvents?: AgentsChatTodoEventTrace[];
};

export type AgentsChatResponse = {
  id: string;
  text: string;
  assets?: AgentsChatAsset[];
  trace?: AgentsChatTrace;
};

type AgentsChatStreamEvent =
  | {
      event: "thread.started";
      data: {
        threadId: string;
        sessionId: string | null;
        userId: string;
      };
    }
  | {
      event: "turn.started";
      data: {
        threadId: string;
        turnId: string;
        userId: string;
        promptPreview: string;
      };
    }
  | {
      event: "item.started";
      data: {
        threadId: string;
        turnId: string;
        itemId: string;
        itemType: "message" | "tool_call" | "result";
        role?: "assistant";
        toolName?: string;
      };
    }
  | {
      event: "item.updated";
      data: {
        threadId: string;
        turnId: string;
        itemId: string;
        itemType: "message" | "tool_call" | "result";
        delta?: string;
        outputPreview?: string;
        phase?: "started" | "completed";
        status?: "succeeded" | "failed" | "denied" | "blocked";
      };
    }
  | {
      event: "item.completed";
      data: {
        threadId: string;
        turnId: string;
        itemId: string;
        itemType: "message" | "tool_call" | "result";
        role?: "assistant";
        text?: string;
        textChars?: number;
        toolName?: string;
        status?: "succeeded" | "failed" | "denied" | "blocked";
        outputPreview?: string;
      };
    }
  | { event: "content"; data: { delta: string } }
  | {
      event: "todo_list";
      data: {
        threadId: string;
        turnId: string;
        sourceToolCallId: string;
        items: AgentsChatTodoListItem[];
        totalCount: number;
        completedCount: number;
        inProgressCount: number;
      };
    }
  | {
      event: "tool";
      data: {
        toolCallId: string;
        toolName: string;
        phase: "started" | "completed";
        status?: "succeeded" | "failed" | "denied" | "blocked";
        input?: unknown;
        outputPreview?: string;
        errorMessage?: string;
        startedAt: string;
        finishedAt?: string;
        durationMs?: number;
      };
    }
  | { event: "result"; data: { response: AgentsChatResponse } }
  | {
      event: "turn.completed";
      data: {
        threadId: string;
        turnId: string;
        responseId: string;
        textChars: number;
        toolCallCount: number;
      };
    }
  | { event: "error"; data: { message: string; code?: string; details?: unknown } }
  | { event: "done"; data: { reason: "finished" | "error" } };

const TRACE_SENSITIVE_KEYS = new Set<string>([
  "apikey",
  "api_key",
  "key",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "client_secret",
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "secretToken",
]);

const TRACE_MAX_DEPTH = 6;
const TRACE_MAX_KEYS = 60;
const TRACE_MAX_ARRAY = 40;
const TRACE_MAX_STRING = 800;

function stringifyStructuredOutputSpec(value: unknown, maxChars = 4_000): string {
  try {
    const raw = JSON.stringify(value, null, 2);
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars)}\n...truncated`;
  } catch {
    return String(value);
  }
}

function buildStructuredOutputPrompt(value: unknown): string {
  if (typeof value === "undefined") return "";
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const type = typeof record?.type === "string" ? record.type.trim() : "";
  const jsonSchema =
    record?.json_schema && typeof record.json_schema === "object" && !Array.isArray(record.json_schema)
      ? (record.json_schema as Record<string, unknown>)
      : null;
  const schemaName = typeof jsonSchema?.name === "string" ? jsonSchema.name.trim() : "";
  const lines = [
    "StructuredOutputPreference:",
    "- 上游请求显式提供了结构化输出约束。若你本轮最终返回正文而不是继续工具调用，必须严格遵守该格式。",
    "- 若格式要求 JSON，则只能输出 JSON 本体；禁止 Markdown 代码块、禁止额外解释性前后缀、禁止注释。",
  ];
  if (type) lines.push(`- type: ${type}`);
  if (schemaName) lines.push(`- schemaName: ${schemaName}`);
  lines.push("- rawSpec:");
  lines.push(stringifyStructuredOutputSpec(value));
  return lines.join("\n");
}

function sanitizeTraceValue(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const sanitizeString = (str: string): string => {
    const trimmed = (str || "").trim();
    if (trimmed.length <= TRACE_MAX_STRING) return trimmed;
    return `${trimmed.slice(0, TRACE_MAX_STRING)}…(truncated,len=${trimmed.length})`;
  };

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") return sanitizeString(v);
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return String(v);
    if (typeof v === "function") return "[Function]";
    if (typeof v !== "object") return String(v);

    const obj = v as object;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);

    if (depth >= TRACE_MAX_DEPTH) return `[MaxDepth:${TRACE_MAX_DEPTH}]`;

    if (Array.isArray(v)) {
      const items = v.slice(0, TRACE_MAX_ARRAY).map((item) => walk(item, depth + 1));
      if (v.length > TRACE_MAX_ARRAY) items.push(`[...omitted ${v.length - TRACE_MAX_ARRAY} items]`);
      return items;
    }

    const entries = Object.entries(v as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, val] of entries) {
      if (kept >= TRACE_MAX_KEYS) break;
      const lower = key.toLowerCase();
      out[key] = TRACE_SENSITIVE_KEYS.has(lower) ? "***" : walk(val, depth + 1);
      kept += 1;
    }
    if (entries.length > kept) out.__omittedKeys = entries.length - kept;
    return out;
  };

  return walk(value, 0);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const raw = (error as { code?: unknown }).code;
  return typeof raw === "string" ? raw.trim() : "";
}

function errorDetails(error: unknown): unknown {
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const raw = (error as { details?: unknown }).details;
  if (typeof raw === "undefined") return undefined;
  return sanitizeTraceValue(raw);
}

function sanitizeToolOutputPreview(output: unknown): { preview: string; chars: number } {
  const text = String(output ?? "");
  const chars = text.length;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return { preview: "", chars };
  const previewMax = 1200;
  const preview = compact.length > previewMax ? `${compact.slice(0, previewMax)}…(truncated)` : compact;
  return { preview, chars };
}

function extractStructuredOutputJson(output: unknown): Record<string, unknown> | null {
  const text = String(output ?? "").trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return sanitizeTraceValue(parsed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTextEdges(input: unknown, edgeChars: number): { head: string; tail: string } {
  const text = String(input ?? "");
  if (!text) return { head: "", tail: "" };
  const normalized = text.trim();
  if (!normalized) return { head: "", tail: "" };
  if (normalized.length <= edgeChars) {
    return { head: normalized, tail: normalized };
  }
  return {
    head: normalized.slice(0, edgeChars),
    tail: normalized.slice(Math.max(0, normalized.length - edgeChars)),
  };
}

function extractInputPathHint(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const record = input as Record<string, unknown>;
  const candidateKeys = ["path", "filePath", "rawPath", "analysisFile", "sourceCase"];
  for (const key of candidateKeys) {
    const value = typeof record[key] === "string" ? record[key].trim() : "";
    if (value) return value;
  }
  return "";
}

function truncateForLog(input: unknown, maxChars = 800): string {
  const text = String(input ?? "");
  if (!text) return "";
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}...` : compact;
}

function truncateJsonForLog(input: unknown, maxChars = 400): string {
  try {
    return truncateForLog(JSON.stringify(input ?? {}), maxChars);
  } catch {
    return "<unserializable>";
  }
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function collectLoadedSkillsForTrace(input: {
  requiredSkills: string[];
  toolCalls: AgentsChatToolCall[];
  messages?: Array<{ content?: unknown }> | null;
}): string[] {
  const out = new Set<string>();
  void input.requiredSkills;
  for (const toolCall of input.toolCalls) {
    if (String(toolCall.name || "").trim() !== "Skill") continue;
    const record = toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
      ? toolCall.input as Record<string, unknown>
      : null;
    const requested = typeof record?.skill === "string" ? record.skill.trim() : "";
    if (requested) out.add(requested);
  }
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) return [...out].slice(0, 64);
  for (const message of messages) {
    const content = typeof message?.content === "string" ? message.content : "";
    if (!content) continue;
    const re = /<skill-loaded\s+name="([^"]+)">/gi;
    let match: RegExpExecArray | null = null;
    while ((match = re.exec(content))) {
      const name = String(match[1] || "").trim();
      if (name) out.add(name);
    }
  }
  return [...out].slice(0, 64);
}

function parseTodoListTraceFromToolCall(input: {
  toolCallId: string;
  toolName: string;
  status: "succeeded" | "failed" | "denied" | "blocked";
  output: string;
}): AgentsChatTodoListTrace | null {
  const parsed = parseRuntimeTodoUpdate({
    toolCallId: input.toolCallId,
    name: input.toolName,
    args: {},
    output: input.output,
    outputChars: String(input.output || "").length,
    outputHead: "",
    outputTail: "",
    status: input.status,
    startedAt: "",
    finishedAt: "",
    durationMs: 0,
  });
  if (!parsed) return null;
  return {
    sourceToolCallId: parsed.sourceToolCallId,
    items: parsed.items,
    totalCount: parsed.totalCount,
    completedCount: parsed.completedCount,
    inProgressCount: parsed.inProgressCount,
  };
}

function toTodoEventTrace(input: {
  todoListTrace: AgentsChatTodoListTrace;
  atMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}): AgentsChatTodoEventTrace {
  const pendingCount = Math.max(
    input.todoListTrace.totalCount - input.todoListTrace.completedCount - input.todoListTrace.inProgressCount,
    0,
  );
  return {
    ...input.todoListTrace,
    pendingCount,
    atMs: Math.max(0, Math.trunc(input.atMs)),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
  };
}

type RuntimeStreamProjectionContext = {
  threadId: string;
  turnId: string;
  userId: string;
  sessionId: string | null;
  promptPreview: string;
  assistantItemId: string;
  emitStreamEvent: (payload: AgentsChatStreamEvent) => void;
  ensureAssistantItemStarted: () => void;
};

function projectRuntimeEventToStream(
  context: RuntimeStreamProjectionContext,
  event: RuntimeRunEvent,
): void {
  if (event.type === "run.started") {
    context.emitStreamEvent({
      event: "thread.started",
      data: {
        threadId: context.threadId,
        sessionId: context.sessionId,
        userId: context.userId,
      },
    });
    context.emitStreamEvent({
      event: "turn.started",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        userId: context.userId,
        promptPreview: context.promptPreview,
      },
    });
    context.ensureAssistantItemStarted();
    return;
  }
  if (event.type === "text.delta") {
    if (typeof event.delta !== "string" || !event.delta) return;
    context.ensureAssistantItemStarted();
    context.emitStreamEvent({
      event: "item.updated",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: context.assistantItemId,
        itemType: "message",
        delta: event.delta,
      },
    });
    context.emitStreamEvent({ event: "content", data: { delta: event.delta } });
    return;
  }
  if (event.type === "tool.started") {
    context.emitStreamEvent({
      event: "item.started",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCallId,
        itemType: "tool_call",
        toolName: String(event.name || "").trim() || "tool",
      },
    });
    context.emitStreamEvent({
      event: "item.updated",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCallId,
        itemType: "tool_call",
        phase: "started",
      },
    });
    context.emitStreamEvent({
      event: "tool",
      data: {
        toolCallId: event.toolCallId,
        toolName: String(event.name || "").trim() || "tool",
        phase: "started",
        input: sanitizeTraceValue(event.args),
        startedAt: event.startedAt,
      },
    });
    return;
  }
  if (event.type === "todo.updated") {
    context.emitStreamEvent({
      event: "todo_list",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        sourceToolCallId: event.todo.sourceToolCallId,
        items: event.todo.items,
        totalCount: event.todo.totalCount,
        completedCount: event.todo.completedCount,
        inProgressCount: event.todo.inProgressCount,
      },
    });
    return;
  }
  if (event.type === "tool.completed") {
    const sanitizedOutput = sanitizeToolOutputPreview(event.toolCall.output);
    context.emitStreamEvent({
      event: "item.updated",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCall.toolCallId,
        itemType: "tool_call",
        phase: "completed",
        status: event.toolCall.status,
        ...(sanitizedOutput.preview ? { outputPreview: sanitizedOutput.preview } : {}),
      },
    });
    context.emitStreamEvent({
      event: "item.completed",
      data: {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: event.toolCall.toolCallId,
        itemType: "tool_call",
        toolName: String(event.toolCall.name || "").trim() || "tool",
        status: event.toolCall.status,
        ...(sanitizedOutput.preview ? { outputPreview: sanitizedOutput.preview } : {}),
      },
    });
    context.emitStreamEvent({
      event: "tool",
      data: {
        toolCallId: event.toolCall.toolCallId,
        toolName: String(event.toolCall.name || "").trim() || "tool",
        phase: "completed",
        status: event.toolCall.status,
        input: sanitizeTraceValue(event.toolCall.args),
        ...(sanitizedOutput.preview ? { outputPreview: sanitizedOutput.preview } : {}),
        ...(event.toolCall.errorMessage ? { errorMessage: event.toolCall.errorMessage } : {}),
        startedAt: event.toolCall.startedAt,
        finishedAt: event.toolCall.finishedAt,
        durationMs: Math.max(0, Math.trunc(event.toolCall.durationMs)),
      },
    });
    return;
  }
}

const STRICT_TEAM_COMPLETION_TOOL_NAMES = new Set<string>([
  "spawn_agent",
  "send_input",
  "resume_agent",
  "idle_agent",
  "wait",
  "close_agent",
  "list_agents",
  "agent_workspace_import",
  "mailbox_send",
  "mailbox_read",
  "protocol_request",
  "protocol_read",
  "protocol_respond",
  "protocol_get",
]);

const CHAPTER_ASSET_REPAIR_GENERATION_TOOL_NAMES = new Set<string>([
  "tapcanvas_image_generate_to_canvas",
  "tapcanvas_video_generate_to_canvas",
]);

const IMAGE_LIKE_CANVAS_NODE_KINDS = new Set<string>([
  "image",
  "imageedit",
  "storyboard",
  "storyboardimage",
]);

type ChapterAssetRepairRequirement = {
  active: boolean;
  requiredCount: number;
  missingAssetNames: string[];
  missingRoleReferenceNames: string[];
  missingStateRoleNames: string[];
  missingThreeViewRoleNames: string[];
  missingScenePropNames: string[];
};

type CompletionBlockedStateSnapshot = {
  failureReason: string | null;
  runtimeWaitFailed: boolean;
  runtimeWaitStopped: boolean;
  strictTeamFailureCount: number;
  planningRequired: boolean;
  planningHasChecklist: boolean;
  planningMeetsMinimumStepCount: boolean;
  planningChecklistComplete: boolean;
  planningLatestStepCount: number;
  planningCompletedCount: number;
  planningInProgressCount: number;
  planningPendingCount: number;
  chapterAssetRepairEvidenceCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeComparableText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readDiagnosticStringArray(
  value: Record<string, unknown> | null,
  key: string,
  limit = 20,
): string[] {
  const raw = value?.[key];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function readChapterAssetRepairRequirement(
  diagnosticContext: Record<string, unknown> | null,
): ChapterAssetRepairRequirement | null {
  const workspaceAction = typeof diagnosticContext?.workspaceAction === "string"
    ? diagnosticContext.workspaceAction.trim()
    : "";
  const requiredFlag = diagnosticContext?.chapterAssetRepairRequired === true;
  const rawRequiredCount = Number(diagnosticContext?.chapterAssetPreproductionRequiredCount);
  const requiredCount = Number.isFinite(rawRequiredCount) ? Math.max(0, Math.trunc(rawRequiredCount)) : 0;
  if (workspaceAction !== "chapter_asset_generation" || (!requiredFlag && requiredCount <= 0)) {
    return null;
  }
  const missingAssetNames = readDiagnosticStringArray(diagnosticContext, "chapterMissingReusableAssets");
  const missingRoleReferenceNames = readDiagnosticStringArray(
    diagnosticContext,
    "chapterMissingRoleReferences",
  );
  const missingStateRoleNames = readDiagnosticStringArray(diagnosticContext, "chapterMissingRoleStates");
  const missingThreeViewRoleNames = readDiagnosticStringArray(
    diagnosticContext,
    "chapterMissingRoleThreeViews",
  );
  const missingScenePropNames = readDiagnosticStringArray(diagnosticContext, "chapterMissingSceneProps");
  const effectiveRequiredCount = Math.max(requiredCount, missingAssetNames.length, 1);
  return {
    active: true,
    requiredCount: effectiveRequiredCount,
    missingAssetNames,
    missingRoleReferenceNames,
    missingStateRoleNames,
    missingThreeViewRoleNames,
    missingScenePropNames,
  };
}

function recordLooksVisualGenerationPayload(record: Record<string, unknown>): boolean {
  return (
    "prompt" in record ||
    "imagePrompt" in record ||
    "referenceImages" in record ||
    "assetInputs" in record ||
    "imageUrl" in record ||
    "storyboardEditorCells" in record ||
    "modelAlias" in record ||
    "model" in record
  );
}

function recordCountsAsChapterAssetRepairNode(record: Record<string, unknown>): boolean {
  const productionLayer = normalizeComparableText(record.productionLayer);
  const creationStage = normalizeComparableText(record.creationStage);
  const kind = normalizeComparableText(record.kind);
  if (kind && !IMAGE_LIKE_CANVAS_NODE_KINDS.has(kind)) return false;
  if (!kind && !recordLooksVisualGenerationPayload(record)) return false;
  return (
    productionLayer === "preproduction" ||
    productionLayer === "anchors" ||
    creationStage === "preproduction" ||
    creationStage === "authority_base_frame" ||
    creationStage === "shot_anchor_lock"
  );
}

function countChapterAssetPreproductionNodeWrites(toolCalls: AgentsChatToolCall[]): number {
  const repairedNodeIds = new Set<string>();
  for (const toolCall of toolCalls) {
    if (toolCall.status !== "succeeded" || toolCall.name !== "tapcanvas_flow_patch") continue;
    const inputRecord = asRecord(toolCall.input);
    if (!inputRecord) continue;
    const createNodes = Array.isArray(inputRecord.createNodes) ? inputRecord.createNodes : [];
    for (const node of createNodes) {
      const nodeRecord = asRecord(node);
      const dataRecord = asRecord(nodeRecord?.data);
      const nodeId = typeof nodeRecord?.id === "string" ? nodeRecord.id.trim() : "";
      if (!nodeId || !dataRecord) continue;
      if (!recordCountsAsChapterAssetRepairNode(dataRecord)) continue;
      repairedNodeIds.add(nodeId);
    }
    const patchNodeData = Array.isArray(inputRecord.patchNodeData) ? inputRecord.patchNodeData : [];
    for (const patch of patchNodeData) {
      const patchRecord = asRecord(patch);
      const dataRecord = asRecord(patchRecord?.data);
      const nodeId = typeof patchRecord?.id === "string" ? patchRecord.id.trim() : "";
      if (!nodeId || !dataRecord) continue;
      if (!recordCountsAsChapterAssetRepairNode(dataRecord)) continue;
      repairedNodeIds.add(nodeId);
    }
  }
  return repairedNodeIds.size;
}

function countSuccessfulChapterAssetGenerationCalls(toolCalls: AgentsChatToolCall[]): number {
  return toolCalls.filter((toolCall) => {
    if (toolCall.status !== "succeeded") return false;
    return CHAPTER_ASSET_REPAIR_GENERATION_TOOL_NAMES.has(String(toolCall.name || "").trim());
  }).length;
}

function countChapterAssetRepairEvidence(toolCalls: AgentsChatToolCall[]): number {
  return Math.max(
    countSuccessfulChapterAssetGenerationCalls(toolCalls),
    countChapterAssetPreproductionNodeWrites(toolCalls),
  );
}

function buildChapterAssetRepairRequiredActions(
  requirement: ChapterAssetRepairRequirement,
): string[] {
  const actions: string[] = [];
  if (requirement.missingRoleReferenceNames.length > 0) {
    actions.push(`先补角色卡资产：${requirement.missingRoleReferenceNames.join("、")}`);
  }
  if (requirement.missingStateRoleNames.length > 0) {
    actions.push(`补齐角色年龄/状态锚点：${requirement.missingStateRoleNames.join("、")}`);
  }
  if (requirement.missingThreeViewRoleNames.length > 0) {
    actions.push(`补齐角色三视图资产：${requirement.missingThreeViewRoleNames.join("、")}`);
  }
  if (requirement.missingScenePropNames.length > 0) {
    actions.push(`补齐场景/道具参考图：${requirement.missingScenePropNames.join("、")}`);
  }
  const summaryNames =
    requirement.missingAssetNames.length > 0
      ? requirement.missingAssetNames.join("、")
      : "当前章节缺失的复用资产";
  actions.push(`将上述缺失资产优先写回当前工作台后，再继续章节分镜/图片节点生产：${summaryNames}`);
  return actions;
}

function parseRuntimeWaitPayload(text: string): Record<string, unknown> | null {
  const trimmed = String(text || "").trim();
  if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasRuntimeWaitFailed(toolCalls: AgentsChatToolCall[]): boolean {
  return toolCalls.some((toolCall) => {
    return String(toolCall.name || "").trim().toLowerCase() === "agents_team_runtime_wait" && toolCall.status === "failed";
  });
}

function hasRuntimeWaitStopped(toolCalls: AgentsChatToolCall[]): boolean {
  return toolCalls.some((toolCall) => {
    if (String(toolCall.name || "").trim().toLowerCase() !== "agents_team_runtime_wait") return false;
    if (toolCall.status !== "succeeded") return false;
    if (toolCall.outputJson?.stopped === true) return true;
    const payload = parseRuntimeWaitPayload(toolCall.outputHead) ?? parseRuntimeWaitPayload(toolCall.outputTail);
    return payload?.stopped === true;
  });
}

function countStrictTeamFailures(toolCalls: AgentsChatToolCall[]): number {
  return toolCalls.filter((toolCall) => {
    const name = String(toolCall.name || "").trim();
    if (!STRICT_TEAM_COMPLETION_TOOL_NAMES.has(name)) return false;
    return toolCall.status === "failed" || toolCall.status === "denied";
  }).length;
}

function buildCompletionBlockedStateSnapshot(input: {
  completion: AgentsChatCompletionTrace;
  planningTrace: AgentsChatPlanningTrace | null;
  toolCalls: AgentsChatToolCall[];
  diagnosticContext: Record<string, unknown> | null;
}): CompletionBlockedStateSnapshot | null {
  if (input.completion.allowFinish) return null;
  const chapterAssetRepairRequirement = readChapterAssetRepairRequirement(input.diagnosticContext);
  return {
    failureReason: input.completion.failureReason,
    runtimeWaitFailed: hasRuntimeWaitFailed(input.toolCalls),
    runtimeWaitStopped: hasRuntimeWaitStopped(input.toolCalls),
    strictTeamFailureCount: countStrictTeamFailures(input.toolCalls),
    planningRequired: input.planningTrace?.planningRequired === true,
    planningHasChecklist: input.planningTrace?.hasChecklist === true,
    planningMeetsMinimumStepCount: input.planningTrace?.meetsMinimumStepCount === true,
    planningChecklistComplete: input.planningTrace?.checklistComplete === true,
    planningLatestStepCount: input.planningTrace?.latestStepCount ?? 0,
    planningCompletedCount: input.planningTrace?.completedCount ?? 0,
    planningInProgressCount: input.planningTrace?.inProgressCount ?? 0,
    planningPendingCount: input.planningTrace?.pendingCount ?? 0,
    chapterAssetRepairEvidenceCount: chapterAssetRepairRequirement ? countChapterAssetRepairEvidence(input.toolCalls) : 0,
  };
}

function blockedStateSnapshotEquals(
  left: CompletionBlockedStateSnapshot | null,
  right: CompletionBlockedStateSnapshot | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.failureReason === right.failureReason &&
    left.runtimeWaitFailed === right.runtimeWaitFailed &&
    left.runtimeWaitStopped === right.runtimeWaitStopped &&
    left.strictTeamFailureCount === right.strictTeamFailureCount &&
    left.planningRequired === right.planningRequired &&
    left.planningHasChecklist === right.planningHasChecklist &&
    left.planningMeetsMinimumStepCount === right.planningMeetsMinimumStepCount &&
    left.planningChecklistComplete === right.planningChecklistComplete &&
    left.planningLatestStepCount === right.planningLatestStepCount &&
    left.planningCompletedCount === right.planningCompletedCount &&
    left.planningInProgressCount === right.planningInProgressCount &&
    left.planningPendingCount === right.planningPendingCount &&
    left.chapterAssetRepairEvidenceCount === right.chapterAssetRepairEvidenceCount
  );
}

function buildCompletionTrace(input: {
  responseText: string;
  toolCalls: AgentsChatToolCall[];
  planningTrace: AgentsChatPlanningTrace | null;
  diagnosticContext: Record<string, unknown> | null;
}): AgentsChatCompletionTrace {
  const runtimeWaitFailed = hasRuntimeWaitFailed(input.toolCalls);
  const runtimeWaitStopped = hasRuntimeWaitStopped(input.toolCalls);
  const strictTeamFailures = countStrictTeamFailures(input.toolCalls) > 0;
  const explicitFailureText = (() => {
    const text = String(input.responseText || "").trim();
    if (!text) return false;
    return (
      text.includes("显式失败") ||
      text.includes("明确失败") ||
      text.includes("任务失败") ||
      text.includes("无法完成") ||
      text.includes("未完成")
    );
  })();
  const planningRequired = input.planningTrace?.planningRequired === true;
  const planningChecklistMissing = planningRequired && input.planningTrace?.hasChecklist !== true;
  const planningTooShort =
    planningRequired &&
    input.planningTrace?.hasChecklist === true &&
    input.planningTrace.meetsMinimumStepCount !== true;
  const planningIncomplete =
    planningRequired &&
    input.planningTrace?.hasChecklist === true &&
    input.planningTrace.checklistComplete !== true;
  const chapterAssetRepairRequirement = readChapterAssetRepairRequirement(input.diagnosticContext);
  const chapterAssetRepairSatisfied =
    chapterAssetRepairRequirement === null
      ? true
      : countChapterAssetRepairEvidence(input.toolCalls) >= chapterAssetRepairRequirement.requiredCount;

  if (runtimeWaitFailed) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "runtime_wait_failed",
      rationale: "agents_team_runtime_wait 返回 failed，子代理协调未完成。",
      successCriteria: ["所有团队等待调用成功收敛"],
      missingCriteria: ["runtime_wait_success"],
      requiredActions: ["继续等待子代理终态或显式失败"],
    };
  }
  if (runtimeWaitStopped) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "runtime_wait_stopped",
      rationale: "runtime 已停止自动等待未终态子代理，当前回合不能标记完成。",
      successCriteria: ["子代理进入终态或用户可见显式失败"],
      missingCriteria: ["pending_team_agents_settled"],
      requiredActions: ["报告阻塞点并停止宣称已完成"],
    };
  }
  if (strictTeamFailures) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "team_tool_failed",
      rationale: "团队协作关键工具存在 failed/denied，不能直接收敛为完成态。",
      successCriteria: ["团队关键工具无失败终态"],
      missingCriteria: ["team_tool_success_path"],
      requiredActions: ["修复失败工具调用并重试"],
    };
  }
  if (planningChecklistMissing) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "planning_checklist_missing",
      rationale: "本轮被标记为执行型任务，但 trace 中没有任何 TodoWrite checklist 证据。",
      successCriteria: ["执行前先建立至少一份结构化 checklist"],
      missingCriteria: ["planning_checklist_present"],
      requiredActions: ["先调用 TodoWrite 建立 checklist，再继续执行"],
    };
  }
  if (planningTooShort) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "planning_checklist_too_short",
      rationale: `执行型任务的 checklist 步骤数不足，当前少于 ${input.planningTrace?.minimumStepCount ?? 2} 项。`,
      successCriteria: ["checklist 至少覆盖两个以上可验证步骤"],
      missingCriteria: ["planning_checklist_minimum_depth"],
      requiredActions: ["补足更细的 TodoWrite checklist，再继续执行"],
    };
  }
  if (planningIncomplete) {
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "planning_checklist_incomplete",
      rationale: "执行型任务的 checklist 仍有 pending 或 in_progress 项，不能直接收口为完成态。",
      successCriteria: ["checklist 中的关键项全部完成"],
      missingCriteria: ["planning_checklist_completed"],
      requiredActions: ["继续推进 checklist，直到所有项完成或显式失败"],
    };
  }
  if (chapterAssetRepairRequirement && !chapterAssetRepairSatisfied) {
    const requiredActions = buildChapterAssetRepairRequiredActions(chapterAssetRepairRequirement);
    return {
      source: "deterministic",
      terminal: "blocked",
      allowFinish: false,
      failureReason: "chapter_asset_preproduction_missing",
      rationale:
        `当前章节资产生产仍缺少可复用前置资产，至少还需补齐 ${chapterAssetRepairRequirement.requiredCount} 项 preproduction 资产，` +
        "不能直接收口为“章节资产已完成”。",
      successCriteria: [
        `至少补齐 ${chapterAssetRepairRequirement.requiredCount} 项章节预生产资产`,
        "缺失资产已写回当前工作台或生成到画布节点",
      ],
      missingCriteria: [
        "chapter_asset_preproduction_delivered",
        "chapter_missing_reusable_assets_repaired",
      ],
      requiredActions,
    };
  }
  if (explicitFailureText) {
    return {
      source: "deterministic",
      terminal: "explicit_failure",
      allowFinish: true,
      failureReason: "assistant_explicit_failure",
      rationale: "主代理在最终回复中已显式声明失败。",
      successCriteria: ["失败原因对用户可见且可追踪"],
      missingCriteria: [],
      requiredActions: [],
    };
  }
  return {
    source: "deterministic",
    terminal: "success",
    allowFinish: true,
    failureReason: null,
    rationale: "未检测到阻塞态或显式失败信号，按成功收口。",
    successCriteria: ["存在最终用户可见回复"],
    missingCriteria: [],
    requiredActions: [],
  };
}

function readPlanningRequired(value: Record<string, unknown> | null): boolean {
  return value?.planningRequired === true;
}

function readPlanningMinimumStepCount(value: Record<string, unknown> | null): number {
  const raw = value?.planningMinimumSteps;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return 2;
  return Math.max(2, Math.min(8, Math.trunc(num)));
}

function buildExecutionPlanningPrompt(value: Record<string, unknown> | null): string {
  if (!readPlanningRequired(value)) return "";
  const minimumStepCount = readPlanningMinimumStepCount(value);
  const reason =
    typeof value?.planningReason === "string" ? value.planningReason.trim() : "";
  const checklistFirst = value?.planningChecklistFirst === true;
  return [
    "ExecutionPlanningRequirement: true",
    `Before any side-effectful execution, create a TodoWrite checklist with at least ${minimumStepCount} steps and keep it updated until all key steps are completed.`,
    ...(checklistFirst
      ? [
          "ChecklistFirstRequirement: true",
          "For chapter-grounded storyboard/comic production, the first non-Skill action must be TodoWrite. Do not read book/chapter/flow evidence until the checklist exists.",
        ]
      : []),
    "Loading Skill provides domain knowledge but never replaces planning.",
    ...(reason ? [`PlanningReason: ${reason}`] : []),
  ].join("\n");
}

function buildPlanningTrace(input: {
  diagnosticContext: Record<string, unknown> | null;
  latestTodoListTrace: AgentsChatTodoListTrace | null;
  todoEvents: AgentsChatTodoEventTrace[];
}): AgentsChatPlanningTrace | null {
  const planningRequired = readPlanningRequired(input.diagnosticContext);
  const minimumStepCount = readPlanningMinimumStepCount(input.diagnosticContext);
  const latest = input.latestTodoListTrace;
  const maxObservedStepCount = input.todoEvents.reduce((max, item) => Math.max(max, item.totalCount), 0);
  const latestStepCount = latest?.totalCount ?? 0;
  const completedCount = latest?.completedCount ?? 0;
  const inProgressCount = latest?.inProgressCount ?? 0;
  const pendingCount = latest ? Math.max(latest.totalCount - completedCount - inProgressCount, 0) : 0;
  const hasChecklist = latestStepCount > 0 || maxObservedStepCount > 0;
  if (!hasChecklist && !planningRequired) {
    return null;
  }
  return {
    source: "todo_list",
    planningRequired,
    minimumStepCount,
    hasChecklist,
    latestStepCount,
    maxObservedStepCount,
    completedCount,
    inProgressCount,
    pendingCount,
    meetsMinimumStepCount: Math.max(latestStepCount, maxObservedStepCount) >= minimumStepCount,
    checklistComplete: hasChecklist && pendingCount <= 0 && inProgressCount <= 0,
  };
}

function getCompletionSelfCheckRetryBudget(): number {
  const raw = Number(process.env.AGENTS_COMPLETION_SELF_CHECK_MAX_RETRIES);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(4, Math.trunc(raw)));
}

function getCompletionSelfCheckMaxTotalRetries(): number {
  const raw = Number(process.env.AGENTS_COMPLETION_SELF_CHECK_MAX_TOTAL_RETRIES);
  if (!Number.isFinite(raw)) return 6;
  return Math.max(1, Math.min(12, Math.trunc(raw)));
}

function buildCompletionSelfCheckSteerMessage(input: {
  originalPrompt: string;
  completion: AgentsChatCompletionTrace;
  planning: AgentsChatPlanningTrace | null;
  retryIndex: number;
  retryBudget: number;
}): string {
  const lines = [
    "<runtime_completion_self_check>",
    "本轮尚不能结束。上一轮输出未通过 runtime completion gate，请基于当前真实历史与工具证据继续修正，而不是重复宣称已完成。",
    `originalPrompt: ${input.originalPrompt}`,
    `retryIndex: ${input.retryIndex}`,
    `retryBudget: ${input.retryBudget}`,
    `failureReason: ${input.completion.failureReason || "unknown_blocked_completion"}`,
    `rationale: ${input.completion.rationale}`,
  ];
  if (input.completion.missingCriteria.length > 0) {
    lines.push("missingCriteria:");
    input.completion.missingCriteria.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }
  if (input.completion.requiredActions.length > 0) {
    lines.push("requiredActions:");
    input.completion.requiredActions.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }
  if (input.planning) {
    lines.push(
      `planningStatus: required=${input.planning.planningRequired} hasChecklist=${input.planning.hasChecklist} latestStepCount=${input.planning.latestStepCount} completed=${input.planning.completedCount} inProgress=${input.planning.inProgressCount} pending=${input.planning.pendingCount}`,
    );
  }
  lines.push(
    "要求：如果仍需执行，请直接继续调用必要工具完成缺失项；如果客观上无法完成，必须显式说明失败原因，禁止继续输出伪完成态。",
  );
  lines.push("</runtime_completion_self_check>");
  return lines.join("\n");
}

function normalizeWhitelistIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeDiagnosticContext(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(source)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) out[normalizedKey] = trimmed.slice(0, 500);
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      out[normalizedKey] = raw;
      continue;
    }
    if (Array.isArray(raw)) {
      const values = raw
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 20);
      if (values.length) out[normalizedKey] = values;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeCanvasCapabilityTools(value: unknown, limit: number): AgentsChatCanvasCapabilityTool[] {
  if (!Array.isArray(value)) return [];
  const out: AgentsChatCanvasCapabilityTool[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const parameters =
      record.parameters && typeof record.parameters === "object" && !Array.isArray(record.parameters)
        ? (sanitizeTraceValue(record.parameters) as Record<string, unknown>)
        : {};
    if (!name || !description || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name: name.slice(0, 120),
      description: description.slice(0, 600),
      parameters,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeCanvasNodeSpecs(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey || "").trim();
    if (!key || !(rawValue && typeof rawValue === "object" && !Array.isArray(rawValue))) continue;
    out[key] = sanitizeTraceValue(rawValue) as Record<string, unknown>;
    if (Object.keys(out).length >= 32) break;
  }
  return out;
}

function normalizeCanvasCapabilityManifest(value: unknown): AgentsChatCanvasCapabilityManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const version =
    typeof record.version === "string" && record.version.trim() ? record.version.trim().slice(0, 80) : null;
  const summary =
    typeof record.summary === "string" && record.summary.trim() ? record.summary.trim().slice(0, 1200) : null;
  const localCanvasTools = normalizeCanvasCapabilityTools(record.localCanvasTools, 24);
  const remoteTools = normalizeCanvasCapabilityTools(record.remoteTools, 48);
  const nodeSpecs = normalizeCanvasNodeSpecs(record.nodeSpecs);
  const protocols =
    record.protocols && typeof record.protocols === "object" && !Array.isArray(record.protocols)
      ? (sanitizeTraceValue(record.protocols) as Record<string, unknown>)
      : null;
  if (
    !version &&
    !summary &&
    localCanvasTools.length === 0 &&
    remoteTools.length === 0 &&
    Object.keys(nodeSpecs).length === 0 &&
    !protocols
  ) {
    return null;
  }
  return {
    version,
    summary,
    localCanvasTools,
    remoteTools,
    nodeSpecs,
    protocols,
  };
}

function buildCanvasCapabilityPrompt(manifest: AgentsChatCanvasCapabilityManifest | null): string {
  if (!manifest) return "";
  const lines: string[] = ["CanvasCapabilityManifest:"];
  if (manifest.version) lines.push(`- version: ${manifest.version}`);
  if (manifest.summary) lines.push(`- summary: ${manifest.summary}`);
  if (manifest.localCanvasTools.length) {
    lines.push("- localCanvasTools:");
    manifest.localCanvasTools.forEach((tool) => {
      lines.push(`  - ${tool.name}: ${tool.description}`);
    });
  }
  if (manifest.remoteTools.length) {
    lines.push("- remoteCanvasTools:");
    manifest.remoteTools.forEach((tool) => {
      lines.push(`  - ${tool.name}: ${tool.description}`);
    });
  }
  const nodeKinds = Object.keys(manifest.nodeSpecs);
  if (nodeKinds.length) {
    lines.push("- nodeKinds:");
    nodeKinds.slice(0, 24).forEach((kind) => {
      const spec = manifest.nodeSpecs[kind];
      const label = typeof spec.label === "string" ? spec.label : kind;
      const purpose = typeof spec.purpose === "string" ? spec.purpose : "";
      lines.push(`  - ${kind} (${label})${purpose ? `: ${purpose}` : ""}`);
    });
  }
  if (manifest.protocols) {
    lines.push("- protocols:");
    lines.push(stringifyStructuredOutputSpec(manifest.protocols, 4000));
  }
  lines.push("- Treat this manifest as the source of truth for TapCanvas interfaces and graph contracts.");
  lines.push("- Do not invent unsupported node kinds, handles, remote tools, or write paths outside this manifest.");
  return lines.join("\n");
}

function normalizeReferenceImageSlots(value: unknown): AgentsChatReferenceImageSlot[] {
  if (!Array.isArray(value)) return [];
  const out: AgentsChatReferenceImageSlot[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const slot = typeof record.slot === "string" ? record.slot.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!slot || !/^https?:\/\//i.test(url)) continue;
    const dedupeKey = `${slot}|${url}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      slot,
      url,
      role: typeof record.role === "string" && record.role.trim() ? record.role.trim().slice(0, 80) : null,
      label: typeof record.label === "string" && record.label.trim() ? record.label.trim().slice(0, 160) : null,
      note: typeof record.note === "string" && record.note.trim() ? record.note.trim().slice(0, 240) : null,
    });
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeAssetInputs(value: unknown): AgentsChatAssetInput[] {
  if (!Array.isArray(value)) return [];
  const out: AgentsChatAssetInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const assetId = typeof record.assetId === "string" && record.assetId.trim() ? record.assetId.trim().slice(0, 160) : null;
    const assetRefId =
      typeof record.assetRefId === "string" && record.assetRefId.trim() ? record.assetRefId.trim().slice(0, 160) : null;
    const role = typeof record.role === "string" && record.role.trim() ? record.role.trim().slice(0, 80) : null;
    const note = typeof record.note === "string" && record.note.trim() ? record.note.trim().slice(0, 240) : null;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 160) : null;
    const weight =
      typeof record.weight === "number" && Number.isFinite(record.weight) ? Number(record.weight) : null;
    const dedupeKey = `${assetId || ""}|${assetRefId || ""}|${url}|${role || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      assetId,
      assetRefId,
      url,
      role,
      note,
      name,
      weight,
    });
    if (out.length >= 12) break;
  }
  return out;
}

function readCollabManager(meta: Record<string, unknown> | undefined): CollabAgentManager | null {
  const raw = meta?.collabManager;
  if (!raw || typeof raw !== "object") return null;
  return raw as CollabAgentManager;
}

export function startAgentsHttpServer(
  input: {
    runner: AgentRunner;
    cwd: string;
    systemOverride?: string;
    toolContextMeta?: Record<string, unknown>;
    memoryDir?: string;
  },
  options: AgentsHttpServerOptions
): Promise<{ url: string; close: () => Promise<void> }> {
  const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(options.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("无效的端口号。");
  }

  const token = typeof options.token === "string" ? options.token.trim() : "";
  const bodyLimitBytes =
    typeof options.bodyLimitBytes === "number" && Number.isFinite(options.bodyLimitBytes)
      ? Math.max(1024, Math.min(32_000_000, Math.trunc(options.bodyLimitBytes)))
      : 8_000_000;

  const sanitizeKey = (key: string) => {
    const trimmed = String(key || "").trim();
    if (!trimmed) return "default";
    const normalized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
    const prefix = normalized.slice(0, 48) || "session";
    const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
    return `${prefix}__${digest}`;
  };

  const resolveUserSessionKey = (userId: string, sessionId: string) =>
    `${sanitizeKey(userId || "anon")}:${sanitizeKey(sessionId || "default")}`;

  const resolveSessionStoreDir = (userId: string) => {
    const memoryDir = typeof input.memoryDir === "string" && input.memoryDir.trim() ? input.memoryDir.trim() : ".agents/memory";
    // Scope to user id; upstream is authenticated so we trust it, but still sanitize for filesystem.
    return path.join(input.cwd, memoryDir, "users", sanitizeKey(userId || "anon"), "sessions");
  };

  const redisUrl = String(process.env.AGENTS_REDIS_URL || process.env.REDIS_URL || "").trim();
  const redisKeyPrefix = String(process.env.AGENTS_SESSION_CACHE_PREFIX || "agents:chat:session").trim();
  const redisTtlSeconds = (() => {
    const raw = Number(process.env.AGENTS_SESSION_CACHE_TTL_SECONDS ?? 600);
    if (!Number.isFinite(raw) || raw <= 0) return 600;
    return Math.max(30, Math.trunc(raw));
  })();
  let redisClient: ReturnType<typeof createClient> | null = null;
  let redisInitFailed = false;

  const redisCacheKey = (userId: string, sessionId: string) =>
    `${redisKeyPrefix}:${resolveUserSessionKey(userId, sessionId)}`;

  const parseMessageArray = (raw: string): Message[] | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      const valid = parsed.filter((msg): msg is Message => {
        if (!msg || typeof msg !== "object") return false;
        const rec = msg as Record<string, unknown>;
        return typeof rec.role === "string" && typeof rec.content === "string";
      });
      return valid;
    } catch {
      return null;
    }
  };

  const getRedisClient = async (): Promise<ReturnType<typeof createClient> | null> => {
    if (!redisUrl || redisInitFailed) return null;
    if (redisClient && redisClient.isOpen) return redisClient;
    try {
      const client = createClient({ url: redisUrl });
      client.on("error", (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[agents] redis runtime error: ${message}`);
      });
      await client.connect();
      redisClient = client;
      console.log(`[agents] redis connected url=${redisUrl} sessionTtlSeconds=${redisTtlSeconds}`);
      return redisClient;
    } catch (err: unknown) {
      redisInitFailed = true;
      const message = errorMessage(err);
      console.error(`[agents] redis init failed, fallback to file store. reason=${message}`);
      return null;
    }
  };

  const loadSessionFromRedis = async (userId: string, sessionId: string): Promise<Message[] | null> => {
    const client = await getRedisClient();
    if (!client) return null;
    const key = redisCacheKey(userId, sessionId);
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      const parsed = parseMessageArray(raw);
      if (!parsed) {
        console.warn(`[agents] redis session parse failed key=${key}`);
        return null;
      }
      console.log(`[agents] redis session hit key=${key} messages=${parsed.length}`);
      return parsed;
    } catch (err: unknown) {
      const message = errorMessage(err);
      console.error(`[agents] redis session read failed key=${key} reason=${message}`);
      return null;
    }
  };

  const saveSessionToRedis = async (userId: string, sessionId: string, history: Message[]): Promise<void> => {
    const client = await getRedisClient();
    if (!client) return;
    const key = redisCacheKey(userId, sessionId);
    try {
      await client.setEx(
        key,
        redisTtlSeconds,
        JSON.stringify(history.filter((message) => message.ephemeral !== true)),
      );
      console.log(`[agents] redis session saved key=${key} messages=${history.length} ttlSeconds=${redisTtlSeconds}`);
    } catch (err: unknown) {
      const message = errorMessage(err);
      console.error(`[agents] redis session write failed key=${key} reason=${message}`);
    }
  };

  const deleteSessionFromRedis = async (userId: string, sessionId: string): Promise<void> => {
    const client = await getRedisClient();
    if (!client) return;
    const key = redisCacheKey(userId, sessionId);
    try {
      await client.del(key);
      console.log(`[agents] redis session deleted key=${key}`);
    } catch (err: unknown) {
      const message = errorMessage(err);
      console.error(`[agents] redis session delete failed key=${key} reason=${message}`);
    }
  };

  const json = (res: ServerResponse, status: number, data: unknown) => {
    const body = JSON.stringify(data);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
  };

  const text = (res: ServerResponse, status: number, body: string) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
  };

  const beginSse = (res: ServerResponse) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
  };

  const writeSse = (res: ServerResponse, payload: AgentsChatStreamEvent) =>
    new Promise<void>((resolve, reject) => {
      if (res.writableEnded || res.destroyed) {
        reject(new Error("SSE response already closed."));
        return;
      }
      try {
        res.write(`event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  const createResponseAbortController = (req: IncomingMessage, res: ServerResponse) => {
    const controller = new AbortController();
    let responseFinished = false;
    const abort = (reason: string) => {
      if (controller.signal.aborted) return;
      controller.abort(new Error(reason));
    };
    const onFinish = () => {
      responseFinished = true;
    };
    const onAborted = () => {
      abort("客户端在响应完成前中断了请求。");
    };
    const onClose = () => {
      if (!responseFinished) {
        abort("客户端在响应完成前关闭了连接。");
      }
    };
    res.on("finish", onFinish);
    req.on("aborted", onAborted);
    res.on("close", onClose);
    return {
      signal: controller.signal,
      abort,
      cleanup() {
        res.off("finish", onFinish);
        req.off("aborted", onAborted);
        res.off("close", onClose);
      },
    };
  };

  const notFound = (res: ServerResponse) => {
    json(res, 404, { error: "not_found" });
  };

  const unauthorized = (res: ServerResponse) => {
    json(res, 401, { error: "unauthorized" });
  };

  const badRequest = (res: ServerResponse, message: string) => {
    json(res, 400, { error: "invalid_request", message });
  };

  const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of req) {
      const buf =
        Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === "string"
            ? Buffer.from(chunk)
            : ArrayBuffer.isView(chunk)
              ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
              : chunk instanceof ArrayBuffer
                ? Buffer.from(new Uint8Array(chunk))
                : Buffer.from(String(chunk));
      size += buf.length;
      if (size > bodyLimitBytes) {
        throw new Error(`请求体过大。size=${size} limit=${bodyLimitBytes}`);
      }
      chunks.push(buf);
    }

    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("请求体不是合法 JSON。");
    }
  };

  const requireAuth = (req: IncomingMessage): boolean => {
    if (!token) return true;
    const headerRaw =
      typeof req.headers["authorization"] === "string"
        ? req.headers["authorization"]
        : Array.isArray(req.headers["authorization"])
          ? req.headers["authorization"][0] || ""
          : "";
    const xTokenRaw =
      typeof req.headers["x-agents-token"] === "string"
        ? req.headers["x-agents-token"]
        : Array.isArray(req.headers["x-agents-token"])
          ? req.headers["x-agents-token"][0] || ""
          : "";

    const bearer = headerRaw.toLowerCase().startsWith("bearer ")
      ? headerRaw.slice(7).trim()
      : "";
    const provided = bearer || String(xTokenRaw || "").trim();
    return provided === token;
  };

  const server = createServer(async (req, res) => {
    let requestClosedEarly = false;
    try {
      const method = (req.method || "GET").toUpperCase();
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname || "/";

      if (method === "GET" && pathname === "/health") {
        return json(res, 200, { ok: true });
      }

      if (!requireAuth(req)) {
        return unauthorized(res);
      }

      if (method === "GET" && pathname === "/collab/status") {
        const collabManager = readCollabManager(input.toolContextMeta);
        if (!collabManager) {
          return json(res, 200, { enabled: false, agents: [], submissions: [] });
        }
        const idsParam = String(url.searchParams.get("ids") || "").trim();
        const requestedIds = idsParam
          ? idsParam
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean)
              .slice(0, 32)
          : [];
        let agents;
        try {
          agents = requestedIds.length
            ? requestedIds.map((id) => collabManager.status(id))
            : collabManager.list();
        } catch (error) {
          return badRequest(res, (error as Error).message);
        }
        const submissions = collabManager.listSubmissionsForAgents(
          agents.map((agent) => String((agent as { id: string }).id))
        );
        return json(res, 200, {
          enabled: true,
          agents,
          submissions,
        });
      }

      if (method === "POST" && pathname === "/chat") {
        const startedAt = Date.now();
        const body = (await readJsonBody(req)) as AgentsChatRequest;
        const contentLength = (() => {
          const raw: unknown = (req.headers as Record<string, unknown>)["content-length"];
          if (typeof raw === "string") return raw.trim();
          if (Array.isArray(raw)) return String(raw[0] || "").trim();
          return "";
        })();
        const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return badRequest(res, "prompt 不能为空。");

        const userIdFromBody = typeof body?.userId === "string" ? body.userId.trim() : "";
        const userIdFromHeader =
          typeof req.headers["x-agents-user-id"] === "string"
            ? req.headers["x-agents-user-id"].trim()
            : Array.isArray(req.headers["x-agents-user-id"])
              ? (req.headers["x-agents-user-id"][0] || "").trim()
              : "";
        const userId = userIdFromBody || userIdFromHeader || "anon";
        const systemPrompt = typeof body?.systemPrompt === "string" ? body.systemPrompt.trim() : "";
        const responseFormat =
          typeof body?.responseFormat !== "undefined"
            ? body.responseFormat
            : typeof body?.response_format !== "undefined"
              ? body.response_format
              : undefined;
        const wantsStream = body?.stream === true;
        const modelOverride =
          typeof body?.modelAlias === "string" && body.modelAlias.trim()
            ? body.modelAlias.trim()
            : typeof body?.model === "string" && body.model.trim()
              ? body.model.trim()
              : typeof body?.modelKey === "string" && body.modelKey.trim()
                ? body.modelKey.trim()
                : "";
        console.log(
          `[agents] /chat request started user=${userId} promptChars=${prompt.length} systemChars=${systemPrompt.length} model=${modelOverride || "default"} contentLength=${contentLength || "n/a"} bodyLimit=${bodyLimitBytes}`
        );

        const requiredSkills = Array.isArray(body?.requiredSkills)
          ? body.requiredSkills.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 8)
          : [];
        const allowedToolsRaw = Array.isArray(body?.allowedTools) ? body.allowedTools : null;
        const allowedTools = allowedToolsRaw
          ? new Set(
              allowedToolsRaw
                .map((name) => String(name || "").trim())
                .filter(Boolean)
                .slice(0, 32)
            )
          : null;
        const maxTurnsRaw = Number(body?.maxTurns);
        const maxTurns =
          Number.isFinite(maxTurnsRaw) && maxTurnsRaw > 0
            ? Math.max(1, Math.min(128, Math.trunc(maxTurnsRaw)))
            : undefined;
        const allowedSubagentTypes = Array.isArray(body?.allowedSubagentTypes)
          ? body.allowedSubagentTypes
              .map((item: unknown) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 12)
          : [];
        const requireAgentsTeamExecution = body?.requireAgentsTeamExecution === true;
        const compactPrelude = body?.compactPrelude === true || requiredSkills.length > 0;
        const userSessionStoreDir = resolveSessionStoreDir(userId);
        const userMemoryRoot = path.dirname(userSessionStoreDir);
        const novelsRoot = path.join(userMemoryRoot, "novels");
        const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
        const shouldReset = body?.resetSession === true;
        if (sessionId && shouldReset) {
          await deleteSessionFromRedis(userId, sessionId);
        }

        const privilegedLocalAccess = body?.privilegedLocalAccess === true;
        const forceLocalResourceViaBash = body?.forceLocalResourceViaBash === true;
        const localResourcePaths = normalizeStringList(body?.localResourcePaths, 12);
        const resourceWhitelistRaw =
          body?.resourceWhitelist && typeof body.resourceWhitelist === "object"
            ? (body.resourceWhitelist as {
                projectIds?: unknown;
                allowUserScopedPublicAssets?: unknown;
                allowSystemPublicMetadata?: unknown;
                allowRepoKnowledgeRead?: unknown;
                restrictRepoKnowledgeRead?: unknown;
              })
            : null;
        const allowedProjectIds = normalizeWhitelistIds(resourceWhitelistRaw?.projectIds, 8);
        const resourceWhitelist =
          allowedProjectIds.length ||
          resourceWhitelistRaw?.allowUserScopedPublicAssets === true ||
          resourceWhitelistRaw?.allowSystemPublicMetadata === true ||
          resourceWhitelistRaw?.allowRepoKnowledgeRead === true ||
          resourceWhitelistRaw?.restrictRepoKnowledgeRead === true
            ? {
                ...(allowedProjectIds.length ? { allowedProjectIds } : {}),
                ...(resourceWhitelistRaw?.allowUserScopedPublicAssets === true
                  ? { allowUserScopedPublicAssets: true }
                  : {}),
                ...(resourceWhitelistRaw?.allowSystemPublicMetadata === true
                  ? { allowSystemPublicMetadata: true }
                  : {}),
                ...(resourceWhitelistRaw?.allowRepoKnowledgeRead === true
                  ? { allowRepoKnowledgeRead: true }
                  : {}),
                ...(resourceWhitelistRaw?.restrictRepoKnowledgeRead === true
                  ? { restrictRepoKnowledgeRead: true }
                  : {}),
              }
            : null;
        const referenceImages = Array.isArray(body?.referenceImages)
          ? body.referenceImages
              .map((item) => String(item || "").trim())
              .filter((item) => /^https?:\/\//i.test(item))
              .slice(0, 3)
          : [];
        const assetInputs = normalizeAssetInputs(body?.assetInputs);
        const referenceImageSlots = normalizeReferenceImageSlots(body?.referenceImageSlots);
        const diagnosticContext = normalizeDiagnosticContext(body?.diagnosticContext);
        const canvasCapabilityManifest = normalizeCanvasCapabilityManifest(body?.canvasCapabilityManifest);
        const parsedGenerationContract = parseGenerationContract(body?.generationContract);
        if (!parsedGenerationContract.ok) {
          return badRequest(res, `generationContract 无效: ${parsedGenerationContract.error}`);
        }
        const generationContract = parsedGenerationContract.value;
        const hasUpstreamSystemPrompt = systemPrompt.trim().length > 0;
        const resourceHint = resourceWhitelist
          ? [
              "ResourceWhitelist:",
              ...(resourceWhitelist.allowedProjectIds?.length
                ? [`- allowedProjectIds: ${resourceWhitelist.allowedProjectIds.join(", ")}`]
                : []),
              ...(resourceWhitelist.allowUserScopedPublicAssets
                ? ["- allowUserScopedPublicAssets: true"]
                : []),
              ...(resourceWhitelist.allowSystemPublicMetadata
                ? ["- allowSystemPublicMetadata: true"]
                : []),
              ...((resourceWhitelist as Record<string, unknown>).allowRepoKnowledgeRead === true
                ? ["- allowRepoKnowledgeRead: true (read-only under top-level knowledge roots)"]
                : []),
              ...((resourceWhitelist as Record<string, unknown>).restrictRepoKnowledgeRead === true
                ? ["- restrictRepoKnowledgeRead: true (only top-level knowledge roots are readable)"]
                : []),
              ...((resourceWhitelist as Record<string, unknown>).restrictRepoKnowledgeRead === true
                ? [
                    "- repoKnowledgeRoots: ai-metadata, assets, docs, skills",
                  ]
                : []),
              "Only access resources inside this whitelist. Treat repository source code and arbitrary local files as forbidden unless upstream explicitly grants them.",
            ]
          : [];
        const userHint = [
          `UserId: ${userId}`,
          `MemoryRoot (scoped): ${userMemoryRoot}`,
          `NovelsRoot: ${novelsRoot}`,
          "When writing progress/artifacts, always store under NovelsRoot to avoid cross-user mixing.",
          ...(assetInputs.length
            ? [
                "AssetInputs:",
                ...assetInputs.map((item, index) => {
                  const parts = [`#${index + 1}`];
                  if (item.role) parts.push(`role=${item.role}`);
                  if (item.assetRefId) parts.push(`assetRefId=${item.assetRefId}`);
                  if (item.name) parts.push(`name=${item.name}`);
                  if (item.assetId) parts.push(`assetId=${item.assetId}`);
                  if (item.note) parts.push(`note=${item.note}`);
                  parts.push(`url=${item.url}`);
                  return `- ${parts.join(" | ")}`;
                }),
                "These asset inputs are authoritative named references resolved by the bridge.",
                "When a listed asset has assetRefId or a stable name, you may refer to it directly in the final execution prompt via @assetRefId or @name semantics.",
                "Do not invent new @ identifiers. Only use the assetRefId or stable names explicitly listed in AssetInputs.",
                ...(assetInputs.length > 2
                  ? [
                      "When effective references exceed 2 assets, prefer @assetRefId / stable-name references over a long 图1 / 图2 / 图3 enumeration.",
                    ]
                  : []),
              ]
            : []),
          ...(!hasUpstreamSystemPrompt && referenceImageSlots.length
            ? [
                "ReferenceImageSlots:",
                ...referenceImageSlots.map((item) => {
                  const parts = [item.slot];
                  if (item.label) parts.push(item.label);
                  if (item.role) parts.push(`role=${item.role}`);
                  if (item.note) parts.push(`note=${item.note}`);
                  parts.push(`url=${item.url}`);
                  return `- ${parts.join(" | ")}`;
                }),
                "For third-party visual models, these images are defined by slot order, not by the field name referenceImages.",
                "When writing the final execution prompt, explicitly refer to them as 图1 / 图2 / 图3 and keep the mapping consistent with the slot list above.",
                ...(assetInputs.some((item) => item.assetRefId || item.name)
                  ? [
                      "If AssetInputs also provide stable assetRefId / names, you may keep those @references in the prompt text as semantic anchors, but never contradict the slot order above.",
                    ]
                  : []),
              ]
            : []),
          ...(requireAgentsTeamExecution
            ? [
                "AgentsTeamExecutionRequirement: true",
                "This run may not finish until real agents-team execution evidence exists in the trace. Do not end the run in single-agent mode.",
              ]
            : []),
          ...(generationContract ? formatGenerationContractPromptLines(generationContract) : []),
          ...(canvasCapabilityManifest ? [buildCanvasCapabilityPrompt(canvasCapabilityManifest)] : []),
          ...resourceHint,
        ].join("\n");
        const structuredOutputPrompt = buildStructuredOutputPrompt(responseFormat);
        const executionPlanningPrompt = buildExecutionPlanningPrompt(diagnosticContext);
        const combinedSystem = [String(input.systemOverride || "").trim(), userHint, structuredOutputPrompt, systemPrompt]
          .filter(Boolean)
          .join("\n\n");
        const effectiveSystem = [combinedSystem, executionPlanningPrompt]
          .filter(Boolean)
          .join("\n\n");
        const toolContextMeta = {
          ...(input.toolContextMeta ? input.toolContextMeta : {}),
          ...createRuntimeChannelMeta({
            kind: "http",
            transport: wantsStream ? "stream" : "request_response",
            surface: "/chat",
            ...(sessionId ? { sessionId } : {}),
            ...(userId ? { userId } : {}),
          }),
          workspaceRoot:
            typeof input.toolContextMeta?.workspaceRoot === "string" && input.toolContextMeta.workspaceRoot.trim()
              ? input.toolContextMeta.workspaceRoot.trim()
              : input.cwd,
          userId,
          userMemoryRoot,
          novelsRoot,
          ...(referenceImages.length ? { sessionReferenceImages: referenceImages } : {}),
          ...(assetInputs.length ? { sessionAssetInputs: assetInputs } : {}),
          ...(allowedSubagentTypes.length ? { allowedSubagentTypes } : {}),
          ...(requireAgentsTeamExecution ? { requireAgentsTeamExecution: true } : {}),
          ...(privilegedLocalAccess ? { privilegedLocalAccess: true } : {}),
          ...(forceLocalResourceViaBash ? { forceLocalResourceViaBash: true } : {}),
          ...(localResourcePaths.length ? { localResourcePaths } : {}),
          ...(diagnosticContext ? { diagnosticContext } : {}),
          ...(generationContract ? { generationContract } : {}),
          ...(referenceImageSlots.length ? { referenceImageSlots } : {}),
          ...(resourceWhitelist ? { resourceWhitelist } : {}),
          ...(canvasCapabilityManifest ? { canvasCapabilityManifest } : {}),
          ...(Array.isArray(body?.remoteTools) ? { remoteTools: body.remoteTools } : {}),
          ...(Array.isArray(body?.mcpTools) ? { mcpTools: body.mcpTools } : {}),
          ...(body?.remoteToolConfig && typeof body.remoteToolConfig === "object" && !Array.isArray(body.remoteToolConfig)
            ? { remoteToolConfig: body.remoteToolConfig }
            : {}),
          ...(body?.mcpToolConfig && typeof body.mcpToolConfig === "object" && !Array.isArray(body.mcpToolConfig)
            ? { mcpToolConfig: body.mcpToolConfig }
            : {}),
        };

        const history =
          sessionId
            ? ((await loadSessionFromRedis(userId, sessionId)) ??
                loadSessionMessages({ dir: userSessionStoreDir, key: sessionId }))
            : [];
        const responseAbort = createResponseAbortController(req, res);
        responseAbort.signal.addEventListener("abort", () => {
          requestClosedEarly = true;
        }, { once: true });

        const toolCalls: AgentsChatToolCall[] = [];
        const turns: AgentsChatTrace["turns"] = [];
        let latestTodoListTrace: AgentsChatTodoListTrace | null = null;
        const todoEvents: AgentsChatTodoEventTrace[] = [];
        let toolSeq = 0;
        let sseClosed = false;
        let sseWriteQueue = Promise.resolve();
        const threadId = sessionId || `thread_${randomUUID()}`;
        const turnId = `turn_${randomUUID()}`;
        const assistantItemId = `message_${randomUUID()}`;
        const resultItemId = `result_${randomUUID()}`;
        let assistantItemStarted = false;
        const completionSelfCheckRetryBudget = getCompletionSelfCheckRetryBudget();
        const completionSelfCheckMaxTotalRetries = getCompletionSelfCheckMaxTotalRetries();
        if (wantsStream) {
          beginSse(res);
          responseAbort.signal.addEventListener("abort", () => {
            sseClosed = true;
          }, { once: true });
        }
        const emitStreamEvent = (payload: AgentsChatStreamEvent) => {
          if (!wantsStream || sseClosed) return;
          sseWriteQueue = sseWriteQueue
            .then(async () => {
              if (sseClosed) return;
              await writeSse(res, payload);
            })
            .catch(() => {
              sseClosed = true;
              responseAbort.abort("SSE 写入失败，客户端连接已断开。");
            });
        };
        const ensureAssistantItemStarted = () => {
          if (!wantsStream || assistantItemStarted) return;
          assistantItemStarted = true;
          emitStreamEvent({
            event: "item.started",
            data: {
              threadId,
              turnId,
              itemId: assistantItemId,
              itemType: "message",
              role: "assistant",
            },
          });
        };
        const emitRuntimeEvent = (event: RuntimeRunEvent) => {
          if (!wantsStream) return;
          projectRuntimeEventToStream(
            {
              threadId,
              turnId,
              userId,
              sessionId,
              promptPreview: truncateForLog(prompt, 240),
              assistantItemId,
              emitStreamEvent,
              ensureAssistantItemStarted,
            },
            event,
          );
        };
        try {
          if (wantsStream) {
            emitRuntimeEvent({
              type: "run.started",
              prompt,
              ...(sessionId ? { sessionId } : {}),
            });
          }
          let currentPrompt = prompt;
          let responseText = "";
          let planningTrace: AgentsChatPlanningTrace | null = null;
          let completionTrace: AgentsChatCompletionTrace | null = null;
          let completionRetryCount = 0;
          let consecutiveBlockedFinishCount = 0;
          let previousBlockedCompletionState: CompletionBlockedStateSnapshot | null = null;

          while (true) {
            const toolCallCountBeforeAttempt = toolCalls.length;
            const attemptResultText = await input.runner.run(currentPrompt, input.cwd, {
              depth: 0,
              ...(sessionId ? { sessionId } : {}),
              history,
              ...(completionRetryCount > 0 ? { ephemeralUserPrompt: true } : {}),
              systemOverride: effectiveSystem,
              ...(modelOverride ? { modelOverride } : {}),
              ...(requiredSkills.length ? { requiredSkills } : {}),
              ...(allowedTools ? { allowedTools } : {}),
              ...(typeof maxTurns === "number" ? { maxTurns } : {}),
              ...(compactPrelude ? { compactPrelude: true } : {}),
              ...(Object.keys(toolContextMeta).length ? { toolContextMeta } : {}),
              abortSignal: responseAbort.signal,
              onTurn: (turn) => {
                turns.push({
                  turn: turn.turn,
                  text: turn.text,
                  textPreview: turn.textPreview,
                  textChars: turn.textChars,
                  toolCallCount: turn.toolCallCount,
                  toolNames: [...turn.toolNames],
                  finished: turn.finished,
                });
                emitRuntimeEvent({ type: "turn.completed", turn });
              },
              onToolStart: (toolStart) => {
                emitRuntimeEvent({
                  type: "tool.started",
                  toolCallId: toolStart.toolCallId,
                  name: toolStart.name,
                  args: toolStart.args,
                  startedAt: toolStart.startedAt,
                });
              },
              onTextDelta: (delta) => {
                emitRuntimeEvent({ type: "text.delta", delta });
              },
              onToolCall: (toolCall) => {
                const toolStartedAt = Date.parse(toolCall.startedAt);
                const atMs = Number.isFinite(toolStartedAt)
                  ? Math.max(0, toolStartedAt - startedAt)
                  : Math.max(0, Date.now() - startedAt);
                toolSeq += 1;
                const sanitizedInput = sanitizeTraceValue(toolCall.args);
                const sanitizedOutput = sanitizeToolOutputPreview(toolCall.output);
                const structuredOutputJson = toolCall.outputJson ?? extractStructuredOutputJson(toolCall.output);
                const fallbackOutputEdges = extractTextEdges(toolCall.output, 400);
                const outputEdges = {
                  head: toolCall.outputHead.trim() || fallbackOutputEdges.head,
                  tail: toolCall.outputTail.trim() || fallbackOutputEdges.tail,
                };
                const outputChars =
                  Number.isFinite(toolCall.outputChars) && toolCall.outputChars >= 0
                    ? Math.max(0, Math.trunc(toolCall.outputChars))
                    : sanitizedOutput.chars;
                const pathHint = extractInputPathHint(toolCall.args);
                toolCalls.push({
                  seq: toolSeq,
                  atMs,
                  name: String(toolCall.name || "").trim() || "tool",
                  status: toolCall.status,
                  input: sanitizedInput,
                  outputPreview: sanitizedOutput.preview,
                  ...(structuredOutputJson ? { outputJson: structuredOutputJson } : {}),
                  outputChars,
                  outputHead: outputEdges.head,
                  outputTail: outputEdges.tail,
                  startedAt: toolCall.startedAt,
                  finishedAt: toolCall.finishedAt,
                  durationMs: Math.max(0, Math.trunc(toolCall.durationMs)),
                  ...(toolCall.errorMessage ? { errorMessage: toolCall.errorMessage } : {}),
                  ...(pathHint ? { pathHint } : {}),
                });
                const todoListTrace = parseTodoListTraceFromToolCall({
                  toolCallId: toolCall.toolCallId,
                  toolName: String(toolCall.name || "").trim(),
                  status: toolCall.status,
                  output: String(toolCall.output || ""),
                });
                if (todoListTrace) {
                  latestTodoListTrace = todoListTrace;
                  todoEvents.push(toTodoEventTrace({
                    todoListTrace,
                    atMs,
                    startedAt: toolCall.startedAt,
                    finishedAt: toolCall.finishedAt,
                    durationMs: toolCall.durationMs,
                  }));
                }
                const runtimeTodoUpdate = parseRuntimeTodoUpdate(toolCall);
                if (runtimeTodoUpdate) {
                  emitRuntimeEvent({ type: "todo.updated", todo: runtimeTodoUpdate });
                }
                emitRuntimeEvent({ type: "tool.completed", toolCall });
                console.log(
                  `[agents] /chat tool user=${userId} name=${toolCall.name} status=${toolCall.status} args=${truncateJsonForLog(toolCall.args)} outputPreview=${truncateForLog(toolCall.output)}`,
                );
              },
            });

            responseText = String(attemptResultText || "");
            planningTrace = buildPlanningTrace({
              diagnosticContext,
              latestTodoListTrace,
              todoEvents,
            });
            const completionCandidate = buildCompletionTrace({
              responseText,
              toolCalls,
              planningTrace,
              diagnosticContext,
            });
            if (completionCandidate.allowFinish) {
              completionTrace = {
                ...completionCandidate,
                ...(completionRetryCount > 0 ? { retryCount: completionRetryCount, recoveredAfterRetry: true } : {}),
              };
              break;
            }

            const toolCorrectionObserved = toolCalls.length > toolCallCountBeforeAttempt;
            const currentBlockedCompletionState = buildCompletionBlockedStateSnapshot({
              completion: completionCandidate,
              planningTrace,
              toolCalls,
              diagnosticContext,
            });
            const blockedStateAdvanced =
              toolCorrectionObserved &&
              !blockedStateSnapshotEquals(previousBlockedCompletionState, currentBlockedCompletionState);
            if (blockedStateAdvanced) {
              consecutiveBlockedFinishCount = 0;
            }
            consecutiveBlockedFinishCount += 1;
            previousBlockedCompletionState = currentBlockedCompletionState;

            const totalRetryBudgetExceeded =
              completionRetryCount >= completionSelfCheckMaxTotalRetries;
            const consecutiveRetryBudgetExceeded =
              consecutiveBlockedFinishCount > completionSelfCheckRetryBudget;
            if (totalRetryBudgetExceeded || consecutiveRetryBudgetExceeded) {
              completionTrace = {
                ...completionCandidate,
                ...(completionRetryCount > 0 ? { retryCount: completionRetryCount } : {}),
              };
              console.warn(
                `[agents] /chat completion blocked after retry budget exhausted user=${userId} failureReason=${completionCandidate.failureReason || "unknown"} retries=${completionRetryCount}/${completionSelfCheckRetryBudget} totalLimit=${completionSelfCheckMaxTotalRetries}`,
              );
              break;
            }

            completionRetryCount += 1;
            const steerPrompt = buildCompletionSelfCheckSteerMessage({
              originalPrompt: prompt,
              completion: completionCandidate,
              planning: planningTrace,
              retryIndex: completionRetryCount,
              retryBudget: completionSelfCheckRetryBudget,
            });
            currentPrompt = steerPrompt;
            console.warn(
              `[agents] /chat completion blocked; retrying self-check user=${userId} failureReason=${completionCandidate.failureReason || "unknown"} retry=${completionRetryCount}/${completionSelfCheckRetryBudget}`,
            );
          }

          if (sessionId) {
            try {
              saveSessionMessages({ dir: userSessionStoreDir, key: sessionId }, history);
            } catch {
              // ignore persistence failures
            }
            await saveSessionToRedis(userId, sessionId, history);
          }

          const outputPreview = sanitizeToolOutputPreview(responseText);
          const outputEdges = extractTextEdges(responseText, 1200);
          const toolStatusCounts = toolCalls.reduce(
            (acc, item) => {
              if (item.status === "succeeded") acc.succeededToolCalls += 1;
              if (item.status === "failed") acc.failedToolCalls += 1;
              if (item.status === "denied") acc.deniedToolCalls += 1;
              if (item.status === "blocked") acc.blockedToolCalls += 1;
              return acc;
            },
            {
              succeededToolCalls: 0,
              failedToolCalls: 0,
              deniedToolCalls: 0,
              blockedToolCalls: 0,
            }
          );
          const registeredToolNames = normalizeStringList(input.toolContextMeta?.registeredToolNames, 256);
          const registeredTeamToolNames = normalizeStringList(
            input.toolContextMeta?.registeredTeamToolNames,
            64,
          );
          const loadedSkills = collectLoadedSkillsForTrace({
            requiredSkills,
            toolCalls,
            messages: history,
          });
          const traceCanvasCapabilities = canvasCapabilityManifest
            ? {
                version: canvasCapabilityManifest.version,
                localCanvasToolNames: canvasCapabilityManifest.localCanvasTools.map((tool) => tool.name),
                remoteToolNames: canvasCapabilityManifest.remoteTools.map((tool) => tool.name),
                nodeKinds: Object.keys(canvasCapabilityManifest.nodeSpecs),
              }
            : undefined;
          const runtimeTrace: AgentsChatRuntimeTrace = {
            profile:
              typeof input.toolContextMeta?.runtimeProfile === "string" &&
              (input.toolContextMeta.runtimeProfile === "general" ||
                input.toolContextMeta.runtimeProfile === "code")
                ? input.toolContextMeta.runtimeProfile
                : "unknown",
            registeredToolNames,
            registeredTeamToolNames,
            requiredSkills,
            loadedSkills,
            allowedSubagentTypes,
            requireAgentsTeamExecution,
            ...(input.toolContextMeta?.systemSnapshot &&
            typeof input.toolContextMeta.systemSnapshot === "object" &&
            !Array.isArray(input.toolContextMeta.systemSnapshot)
              ? {
                  systemSnapshot: input.toolContextMeta.systemSnapshot as AgentsChatRuntimeTrace["systemSnapshot"],
                }
              : {}),
            ...(Array.isArray(input.toolContextMeta?.toolBatchSummaries)
              ? {
                  toolBatchSummaries: input.toolContextMeta.toolBatchSummaries as NonNullable<
                    AgentsChatRuntimeTrace["toolBatchSummaries"]
                  >,
                }
              : {}),
            ...(Array.isArray(input.toolContextMeta?.compactionEvents)
              ? {
                  compactionEvents: input.toolContextMeta.compactionEvents as NonNullable<
                    AgentsChatRuntimeTrace["compactionEvents"]
                  >,
                }
              : {}),
            ...(input.toolContextMeta?.contextDiagnostics &&
            typeof input.toolContextMeta.contextDiagnostics === "object" &&
            !Array.isArray(input.toolContextMeta.contextDiagnostics)
              ? { contextDiagnostics: input.toolContextMeta.contextDiagnostics as ContextDiagnostics }
              : {}),
            ...(input.toolContextMeta?.capabilitySnapshot &&
            typeof input.toolContextMeta.capabilitySnapshot === "object" &&
            !Array.isArray(input.toolContextMeta.capabilitySnapshot)
              ? { capabilitySnapshot: input.toolContextMeta.capabilitySnapshot as CapabilitySnapshot }
              : {}),
            ...(input.toolContextMeta?.policySummary &&
            typeof input.toolContextMeta.policySummary === "object" &&
            !Array.isArray(input.toolContextMeta.policySummary)
              ? { policySummary: input.toolContextMeta.policySummary as ToolPolicySummary }
              : {}),
            ...(traceCanvasCapabilities ? { canvasCapabilities: traceCanvasCapabilities } : {}),
          };
          const finalPlanningTrace = planningTrace;
          const finalCompletionTrace =
            completionTrace ??
            buildCompletionTrace({
              responseText,
              toolCalls,
              planningTrace: finalPlanningTrace,
              diagnosticContext,
            });
          const responseId = `agents_${randomUUID()}`;
          const resp: AgentsChatResponse = {
            id: responseId,
            text: responseText,
            trace: {
              toolCalls,
              turns,
              output: {
                textChars: responseText.length,
                preview: outputPreview.preview,
                head: outputEdges.head,
                tail: outputEdges.tail,
              },
              summary: {
                totalToolCalls: toolCalls.length,
                ...toolStatusCounts,
                runMs: Math.max(0, Date.now() - startedAt),
              },
              completion: finalCompletionTrace,
              runtime: runtimeTrace,
              ...(finalPlanningTrace ? { planning: finalPlanningTrace } : {}),
              ...(latestTodoListTrace ? { todoList: latestTodoListTrace } : {}),
              ...(todoEvents.length > 0 ? { todoEvents } : {}),
            },
          };
          console.log(
            `[agents] /chat request finished status=200 user=${userId} elapsedMs=${Date.now() - startedAt} textChars=${resp.text.length} outputPreview=${truncateForLog(resp.text)}`
          );
          if (wantsStream) {
            ensureAssistantItemStarted();
            emitStreamEvent({
              event: "item.completed",
              data: {
                threadId,
                turnId,
                itemId: assistantItemId,
                itemType: "message",
                role: "assistant",
                text: responseText,
                textChars: responseText.length,
              },
            });
            emitStreamEvent({
              event: "item.started",
              data: {
                threadId,
                turnId,
                itemId: resultItemId,
                itemType: "result",
              },
            });
            emitStreamEvent({
              event: "item.completed",
              data: {
                threadId,
                turnId,
                itemId: resultItemId,
                itemType: "result",
                text: responseText,
                textChars: responseText.length,
              },
            });
            emitStreamEvent({ event: "result", data: { response: resp } });
            emitStreamEvent({
              event: "turn.completed",
              data: {
                threadId,
                turnId,
                responseId,
                textChars: responseText.length,
                toolCallCount: toolCalls.length,
              },
            });
            emitStreamEvent({ event: "done", data: { reason: "finished" } });
            await sseWriteQueue.catch(() => {});
            if (!sseClosed) res.end();
            return;
          }
          return json(res, 200, resp);
        } finally {
          responseAbort.cleanup();
        }
      }

      return notFound(res);
    } catch (err: unknown) {
      if (requestClosedEarly) {
        return;
      }
      const message = errorMessage(err);
      const code = errorCode(err);
      const details = errorDetails(err);
      const isBodyTooLarge = message.includes("请求体过大");
      const status = isBodyTooLarge ? 413 : 500;
      const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : "";
      console.error(`[agents] request failed status=${status} message=${message}${stack ? ` stack=${truncateForLog(stack, 2000)}` : ""}`);
      if (!res.headersSent) {
        return json(res, status, {
          error: "internal_error",
          message,
          ...(code ? { code } : {}),
          ...(typeof details !== "undefined" ? { details } : {}),
        });
      }
      if (res.writableEnded || res.destroyed) {
        return;
      }
      try {
        await writeSse(res, {
          event: "error",
          data: {
            message,
            ...(code ? { code } : {}),
            ...(typeof details !== "undefined" ? { details } : {}),
          },
        });
        await writeSse(res, { event: "done", data: { reason: "error" } });
      } catch {
        // ignore secondary stream failures
      }
      res.end();
      return;
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => reject(err));
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort =
        addr && typeof addr === "object" ? (addr as AddressInfo).port : port;
      const url = `http://${host}:${actualPort}`;
      resolve({
        url,
        close: () =>
          new Promise((r) => {
            server.close(async () => {
              if (redisClient && redisClient.isOpen) {
                try {
                  await redisClient.quit();
                } catch {
                  // ignore close failures
                }
              }
              r();
            });
          }),
      });
    });
  });
}
