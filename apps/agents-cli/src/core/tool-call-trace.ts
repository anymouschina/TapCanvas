import type { ToolCallTrace } from "./hooks/types.js";

const TOOL_OUTPUT_EDGE_CHARS = 400;

type BuildToolCallTraceInput = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  output: string;
  status: ToolCallTrace["status"];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorMessage?: string;
  structuredOutput?: unknown;
};

export function buildToolCallTrace(input: BuildToolCallTraceInput): ToolCallTrace {
  const output = String(input.output ?? "");
  const outputJson = extractToolOutputJson({
    output,
    structuredOutput: input.structuredOutput,
  });
  const outputEdges = extractTextEdges(output, TOOL_OUTPUT_EDGE_CHARS);
  return {
    toolCallId: input.toolCallId,
    name: input.name,
    args: input.args,
    output,
    ...(outputJson ? { outputJson } : {}),
    outputChars: output.length,
    outputHead: outputEdges.head,
    outputTail: outputEdges.tail,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };
}

export function extractTextEdges(input: unknown, edgeChars: number): { head: string; tail: string } {
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

export function extractToolOutputJson(input: {
  output: string;
  structuredOutput?: unknown;
}): Record<string, unknown> | null {
  const structured = normalizeRecord(input.structuredOutput);
  if (structured) return structured;
  const trimmed = String(input.output ?? "").trim();
  if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return normalizeRecord(parsed);
  } catch {
    return null;
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
