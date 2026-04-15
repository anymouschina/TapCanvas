import type { LLMClient } from "../llm/client.js";
import type { LLMResponse, ToolDefinition } from "../types/index.js";
import { compactMessagesForTurn, recordCompactionEvent, shouldRetryWithCompaction } from "./message-compaction.js";
import type { AgentSessionEngine } from "./session/session-engine.js";

export async function executeAgentTurn(input: {
  client: LLMClient;
  session: AgentSessionEngine;
  system: string;
  tools: ToolDefinition[];
  modelOverride?: string;
  onTextDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
}): Promise<LLMResponse> {
  const preflight = compactMessagesForTurn({
    messages: input.session.getMessages(),
    kind: "preflight",
  });
  recordCompactionEvent(input.session.getRuntimeMeta(), preflight.event);
  try {
    return await input.client.call({
      system: input.system,
      messages: preflight.messages,
      tools: input.tools,
      ...(input.modelOverride ? { model: input.modelOverride } : {}),
      ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
  } catch (error) {
    if (!shouldRetryWithCompaction(error)) {
      throw error;
    }
    const recovery = compactMessagesForTurn({
      messages: preflight.messages,
      kind: "recovery",
      maxChars: Math.max(8_000, Math.trunc((preflight.event?.compactedChars ?? 24_000) * 0.7)),
      preserveLastMessages: 6,
    });
    recordCompactionEvent(input.session.getRuntimeMeta(), recovery.event);
    return input.client.call({
      system: input.system,
      messages: recovery.messages,
      tools: input.tools,
      ...(input.modelOverride ? { model: input.modelOverride } : {}),
      ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
  }
}
