import type { Message } from "../types/index.js";
import type { ToolCallTrace, RunHookContext } from "./hooks/types.js";
import { HookRunner } from "./hooks/runner.js";
import { syncLayeredMemory } from "./memory/layered.js";

export function joinSystemSections(...parts: string[]): string {
  const sections = parts.map((part) => String(part || "").trim()).filter(Boolean);
  return sections.join("\n\n");
}

function syncRootRunMemory(input: {
  memoryRoot: string;
  currentAgentId?: unknown;
  prompt: string;
  resultText: string;
  messages: Message[];
  toolCalls: ToolCallTrace[];
  sessionId?: string;
  requiredSkills: string[];
  model?: string;
  extractedInsights?: string[];
}): void {
  const currentAgentId =
    typeof input.currentAgentId === "string" ? input.currentAgentId.trim() : "";
  if (currentAgentId) return;
  syncLayeredMemory({
    memoryRoot: input.memoryRoot,
    prompt: input.prompt,
    resultText: input.resultText,
    messages: input.messages,
    toolCalls: input.toolCalls,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requiredSkills.length > 0 ? { requiredSkills: input.requiredSkills } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.extractedInsights && input.extractedInsights.length > 0
      ? { extractedInsights: input.extractedInsights }
      : {}),
  });
}

export async function finalizeRunResult(params: {
  hooks: HookRunner;
  hookContext: RunHookContext;
  runtimeMeta?: Record<string, unknown>;
  memoryRoot: string;
  prompt: string;
  resultText: string;
  messages: Message[];
  toolCalls: ToolCallTrace[];
  sessionId?: string;
  requiredSkills: string[];
  model?: string;
  extractedInsights?: string[];
}): Promise<string> {
  syncRootRunMemory({
    memoryRoot: params.memoryRoot,
    currentAgentId: params.runtimeMeta?.currentAgentId,
    prompt: params.prompt,
    resultText: params.resultText,
    messages: params.messages,
    toolCalls: params.toolCalls,
    sessionId: params.sessionId,
    requiredSkills: params.requiredSkills,
    model: params.model,
    extractedInsights: params.extractedInsights,
  });
  await params.hooks.afterRun({ ...params.hookContext, resultText: params.resultText });
  return params.resultText;
}

export async function reportRunError(params: {
  hooks: HookRunner;
  hookContext: RunHookContext;
  error: unknown;
}): Promise<void> {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  await params.hooks.onRunError({ ...params.hookContext, errorMessage: message });
}
