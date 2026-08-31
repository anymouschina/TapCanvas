import { randomUUID } from "node:crypto";

import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";

import type { JsonObject } from "./contracts.js";
import { isJsonObject } from "./contracts.js";
import type { RemoteToolExecution } from "./mcp-gateway.js";

export type BridgeStreamEvent = Readonly<{
  event: string;
  data: JsonObject;
}>;

export type BridgeStreamEmitter = (event: BridgeStreamEvent) => void;

export type ProjectedToolCall = Readonly<{
  toolCallId: string;
  name: string;
  status: "succeeded" | "failed";
  input: unknown;
  outputPreview: string;
  outputJson?: JsonObject;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorMessage?: string;
}>;

type PendingToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: unknown;
  startedAt: string;
  startedAtMs: number;
}>;

function normalizeToolName(name: string): string {
  const prefix = "mcp__tapcanvas__";
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const output: string[] = [];
  const visit = (block: unknown): void => {
    if (!isJsonObject(block)) return;
    if (block.type === "text" && typeof block.text === "string") {
      output.push(block.text);
      return;
    }
    if (block.type === "tool-result") visit(block.content);
    if (Array.isArray(block.content)) {
      for (const child of block.content) visit(child);
    }
  };
  for (const block of value) visit(block);
  return output.join("");
}

function eventEnvelope(notification: HarnessNotification): JsonObject | null {
  if (notification.method !== "session.event") return null;
  const event = notification.params.event;
  return isJsonObject(event) ? event : null;
}

function eventTime(event: JsonObject): number {
  return typeof event.time === "number" && Number.isFinite(event.time)
    ? event.time
    : Date.now();
}

function eventData(event: JsonObject): JsonObject {
  return isJsonObject(event.data) ? event.data : {};
}

function boundedPreview(text: string, limit = 4_000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export class HarnessEventProjector {
  readonly threadId: string;
  readonly turnId = `turn_${randomUUID()}`;
  readonly assistantItemId = `message_${randomUUID()}`;
  private readonly emit: BridgeStreamEmitter;
  private readonly pendingTools = new Map<string, PendingToolCall>();
  private readonly completedTools: ProjectedToolCall[] = [];
  private assistantStarted = false;
  private turnStarted = false;
  private lastAssistantText = "";
  private turnEndReason: JsonObject | null = null;
  private latestTodos: JsonObject[] = [];

  constructor(sessionId: string | undefined, emit: BridgeStreamEmitter) {
    this.threadId = sessionId || `thread_${randomUUID()}`;
    this.emit = emit;
  }

  start(_promptPreview: string): void {
    this.emit({
      event: "thread.started",
      data: { threadId: this.threadId },
    });
    this.emit({
      event: "status-update",
      data: {
        threadId: this.threadId,
        turnId: this.turnId,
        phase: "agent_reasoning",
        llmTurn: 1,
        startedAt: new Date().toISOString(),
      },
    });
  }

  accept(notification: HarnessNotification): void {
    const event = eventEnvelope(notification);
    if (!event || typeof event.type !== "string") return;
    const data = eventData(event);
    if (event.type === "turn/start") {
      this.ensureTurnStarted(data);
      return;
    }
    if (event.type === "assistant/chunk") {
      this.acceptChunk(data);
      return;
    }
    if (event.type === "assistant/message") {
      const message = isJsonObject(data.message) ? data.message : {};
      const text = contentText(message.content);
      if (text) this.lastAssistantText = text;
      return;
    }
    if (event.type === "tool/call") {
      this.acceptToolCall(data, eventTime(event));
      return;
    }
    if (event.type === "tool/result") {
      this.acceptToolResult(data, eventTime(event));
      return;
    }
    if (event.type === "todo/write") {
      this.acceptTodos(data);
      return;
    }
    if (event.type === "turn/end") {
      this.turnEndReason = isJsonObject(data.reason) ? data.reason : { kind: "unknown" };
    }
  }

  private ensureTurnStarted(data: JsonObject = {}): void {
    if (this.turnStarted) return;
    this.turnStarted = true;
    this.emit({
      event: "turn.started",
      data: {
        threadId: this.threadId,
        turnId: this.turnId,
        runtime: "deepseek-harness",
        ...(typeof data.turn === "number" ? { turn: data.turn } : {}),
      },
    });
  }

  private ensureAssistantStarted(): void {
    this.ensureTurnStarted();
    if (this.assistantStarted) return;
    this.assistantStarted = true;
    this.emit({
      event: "item.started",
      data: {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: this.assistantItemId,
        itemType: "message",
        role: "assistant",
      },
    });
  }

  private acceptChunk(data: JsonObject): void {
    const chunk = isJsonObject(data.chunk) ? data.chunk : {};
    if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
      this.ensureAssistantStarted();
      this.emit({ event: "content", data: { delta: chunk.text } });
      return;
    }
    if (chunk.type === "reasoning-delta" && typeof chunk.text === "string" && chunk.text) {
      this.ensureTurnStarted();
      this.emit({
        event: "item.updated",
        data: {
          threadId: this.threadId,
          turnId: this.turnId,
          itemType: "reasoning",
          delta: chunk.text,
        },
      });
    }
  }

  private acceptToolCall(data: JsonObject, time: number): void {
    const toolCallId = typeof data.callId === "string" ? data.callId : `call_${randomUUID()}`;
    const rawName = typeof data.name === "string" ? data.name : "tool";
    const pending: PendingToolCall = {
      toolCallId,
      name: normalizeToolName(rawName),
      input: parseArguments(data.arguments),
      startedAt: new Date(time).toISOString(),
      startedAtMs: time,
    };
    this.pendingTools.set(toolCallId, pending);
    this.emit({
      event: "tool",
      data: {
        toolCallId,
        toolName: pending.name,
        transportToolName: rawName,
        phase: "started",
        input: pending.input,
        startedAt: pending.startedAt,
      },
    });
  }

  private acceptToolResult(data: JsonObject, time: number): void {
    const message = isJsonObject(data.message) ? data.message : {};
    const content = Array.isArray(message.content) ? message.content : [];
    const toolResultBlock = content.find(
      (block) => isJsonObject(block) && block.type === "tool-result",
    );
    const resultBlock = isJsonObject(toolResultBlock) ? toolResultBlock : {};
    const toolCallId =
      typeof resultBlock.toolCallId === "string"
        ? resultBlock.toolCallId
        : `call_${randomUUID()}`;
    const pending = this.pendingTools.get(toolCallId);
    const output = contentText(content);
    const isError = resultBlock.isError === true || isJsonObject(data.error);
    const finishedAt = new Date(time).toISOString();
    const completed: ProjectedToolCall = {
      toolCallId,
      name: pending?.name ?? "tool",
      status: isError ? "failed" : "succeeded",
      input: pending?.input ?? null,
      outputPreview: boundedPreview(output),
      startedAt: pending?.startedAt ?? finishedAt,
      finishedAt,
      durationMs: pending ? Math.max(0, time - pending.startedAtMs) : 0,
      ...(isError ? { errorMessage: output || "tool execution failed" } : {}),
    };
    this.pendingTools.delete(toolCallId);
    this.completedTools.push(completed);
    this.emit({
      event: "tool",
      data: {
        toolCallId,
        toolName: completed.name,
        phase: "completed",
        status: completed.status,
        input: completed.input,
        outputPreview: completed.outputPreview,
        startedAt: completed.startedAt,
        finishedAt: completed.finishedAt,
        durationMs: completed.durationMs,
        ...(completed.errorMessage ? { errorMessage: completed.errorMessage } : {}),
      },
    });
  }

  private acceptTodos(data: JsonObject): void {
    const todos = Array.isArray(data.todos)
      ? data.todos.filter(isJsonObject).map((todo) => ({ ...todo }))
      : [];
    this.latestTodos = todos;
    const completedCount = todos.filter((todo) => todo.status === "completed").length;
    const inProgressCount = todos.filter((todo) => todo.status === "in_progress").length;
    this.emit({
      event: "todo_list",
      data: {
        threadId: this.threadId,
        turnId: this.turnId,
        sourceToolCallId:
          typeof data.callId === "string" && data.callId.trim()
            ? data.callId.trim()
            : `harness-todo-${this.turnId}`,
        items: todos.map((todo) => ({
          text: typeof todo.content === "string" ? todo.content : "",
          status: todo.status,
          completed: todo.status === "completed",
        })),
        totalCount: todos.length,
        completedCount,
        inProgressCount,
      },
    });
  }

  responseText(fallback: string): string {
    return fallback || this.lastAssistantText;
  }

  termination(): JsonObject {
    return this.turnEndReason ?? { kind: "missing_turn_end" };
  }

  isCompleted(): boolean {
    return this.turnEndReason?.kind === "completed";
  }

  tools(remoteExecutions: readonly RemoteToolExecution[]): ProjectedToolCall[] {
    let remoteIndex = 0;
    return this.completedTools.map((tool) => {
      const remote = remoteExecutions.slice(remoteIndex).find((entry) => entry.name === tool.name);
      if (remote) remoteIndex = remoteExecutions.indexOf(remote) + 1;
      if (!remote) return tool;
      return {
        ...tool,
        status: remote.status,
        input: remote.args,
        outputPreview: boundedPreview(remote.outputText),
        ...(remote.structuredOutput ? { outputJson: remote.structuredOutput } : {}),
        startedAt: remote.startedAt,
        finishedAt: remote.finishedAt,
        durationMs: remote.durationMs,
        ...(remote.status === "failed" ? { errorMessage: remote.outputText } : {}),
      };
    });
  }

  todoTrace(): JsonObject | undefined {
    if (this.latestTodos.length === 0) return undefined;
    const completedCount = this.latestTodos.filter((todo) => todo.status === "completed").length;
    const inProgressCount = this.latestTodos.filter((todo) => todo.status === "in_progress").length;
    return {
      source: "deepseek-harness.todo/write",
      items: this.latestTodos,
      totalCount: this.latestTodos.length,
      completedCount,
      inProgressCount,
    };
  }

  finish(response: JsonObject, text: string): void {
    this.ensureAssistantStarted();
    this.emit({
      event: "item.completed",
      data: {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: this.assistantItemId,
        itemType: "message",
        role: "assistant",
        text,
        textChars: text.length,
      },
    });
    this.emit({ event: "result", data: { response } });
    this.emit({
      event: "turn.completed",
      data: {
        threadId: this.threadId,
        turnId: this.turnId,
        status: this.isCompleted() ? "completed" : "failed",
        termination: this.termination(),
      },
    });
    this.emit({
      event: "done",
      data: { reason: this.isCompleted() ? "logical_succeeded" : "logical_failed" },
    });
  }
}
