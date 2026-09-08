import type { Message } from "../types/index.js";

export type MessageCompactionEvent = {
  kind: "preflight" | "recovery";
  originalMessageCount: number;
  compactedMessageCount: number;
  originalChars: number;
  compactedChars: number;
  preserveStartIndex: number;
};

function readEnvInt(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.trunc(raw));
}

function estimateMessageChars(messages: Message[]): number {
  return messages.reduce((sum, message) => {
    const textChars = String(message.content || "").length;
    const toolChars = Array.isArray(message.toolCalls)
      ? message.toolCalls.reduce(
          (toolSum, toolCall) =>
            toolSum + String(toolCall.name || "").length + String(toolCall.arguments || "").length,
          0,
        )
      : 0;
    return sum + textChars + toolChars;
  }, 0);
}

function buildCompactionSummary(prefix: Message[]): string {
  const lines: string[] = [
    "<runtime_compaction_summary>",
    "Earlier conversation history was compacted to stay within runtime context budget.",
  ];
  const recent = prefix.slice(-12);
  for (const message of recent) {
    const role = String(message.role || "unknown").trim();
    const content = String(message.content || "").replace(/\s+/g, " ").trim();
    const preview = content.length > 220 ? `${content.slice(0, 220)}…` : content;
    const toolNames = Array.isArray(message.toolCalls)
      ? message.toolCalls.map((toolCall) => String(toolCall.name || "").trim()).filter(Boolean)
      : [];
    lines.push(`- ${role}: ${preview || "(empty)"}`);
    if (toolNames.length > 0) {
      lines.push(`  tools: ${toolNames.join(", ")}`);
    }
  }
  lines.push("</runtime_compaction_summary>");
  return lines.join("\n");
}

function buildAssistantToolCallIndex(messages: Message[]): Map<string, number> {
  const indexByToolCallId = new Map<string, number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.toolCalls)) continue;
    for (const toolCall of message.toolCalls) {
      const id = String(toolCall?.id || "").trim();
      if (!id || indexByToolCallId.has(id)) continue;
      indexByToolCallId.set(id, index);
    }
  }
  return indexByToolCallId;
}

function resolvePreserveStartIndex(messages: Message[], preserveLastMessages: number): number {
  const assistantToolCallIndex = buildAssistantToolCallIndex(messages);
  const expandLinkedToolBoundary = (candidate: number): number => {
    let boundary = candidate;
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = boundary; index < messages.length; index += 1) {
        const message = messages[index];
        if (message?.role !== "tool") continue;
        const toolCallId = String(message.toolCallId || "").trim();
        const linkedAssistantIndex = assistantToolCallIndex.get(toolCallId);
        if (typeof linkedAssistantIndex === "number" && linkedAssistantIndex < boundary) {
          boundary = linkedAssistantIndex;
          changed = true;
          break;
        }
      }
    }
    return boundary;
  };

  const requestedBoundary = Math.max(
    messages.length > 1 ? 1 : 0,
    messages.length - Math.max(1, preserveLastMessages),
  );
  const expandedBoundary = expandLinkedToolBoundary(requestedBoundary);
  if (expandedBoundary > 0) return expandedBoundary;

  for (let candidate = requestedBoundary + 1; candidate < messages.length; candidate += 1) {
    if (messages[candidate]?.role === "tool") continue;
    const nextBoundary = expandLinkedToolBoundary(candidate);
    if (nextBoundary > 0) {
      return nextBoundary;
    }
  }
  return 0;
}

export function compactMessagesForTurn(input: {
  messages: Message[];
  kind: MessageCompactionEvent["kind"];
  maxChars?: number;
  preserveLastMessages?: number;
}): { messages: Message[]; event: MessageCompactionEvent | null } {
  const maxChars = input.maxChars ?? readEnvInt("AGENTS_MESSAGE_HISTORY_MAX_CHARS", 45_000);
  const preserveLastMessages = input.preserveLastMessages ?? readEnvInt("AGENTS_MESSAGE_HISTORY_PRESERVE_MESSAGES", 10);
  const originalChars = estimateMessageChars(input.messages);
  if (originalChars <= maxChars) {
    return { messages: input.messages, event: null };
  }
  const preserveStartIndex = resolvePreserveStartIndex(input.messages, preserveLastMessages);
  if (preserveStartIndex <= 0) {
    return { messages: input.messages, event: null };
  }
  const prefix = input.messages.slice(0, preserveStartIndex);
  const suffix = input.messages.slice(preserveStartIndex);
  const summaryMessage: Message = {
    role: "user",
    content: buildCompactionSummary(prefix),
    ephemeral: true,
  };
  const compactedMessages = [summaryMessage, ...suffix];
  const compactedChars = estimateMessageChars(compactedMessages);
  return {
    messages: compactedMessages,
    event: {
      kind: input.kind,
      originalMessageCount: input.messages.length,
      compactedMessageCount: compactedMessages.length,
      originalChars,
      compactedChars,
      preserveStartIndex,
    },
  };
}

export function shouldRetryWithCompaction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("request too large") ||
    normalized.includes("context length") ||
    normalized.includes("maximum context") ||
    normalized.includes("too many tokens") ||
    normalized.includes("prompt too long") ||
    normalized.includes("413")
  );
}

export function recordCompactionEvent(
  meta: Record<string, unknown> | undefined,
  event: MessageCompactionEvent | null,
): void {
  if (!meta || !event) return;
  const current = Array.isArray(meta.compactionEvents)
    ? meta.compactionEvents.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
  meta.compactionEvents = [...current, event].slice(-8);
}
