import type { ToolCallTrace } from "./hooks/types.js";

export type ToolBatchSummary = {
  label: string;
  startedAt: string;
  finishedAt: string;
  toolNames: string[];
  succeededCount: number;
  failedCount: number;
  blockedCount: number;
  deniedCount: number;
};

function uniqueOrdered(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function buildLabel(calls: ToolCallTrace[]): string {
  const names = uniqueOrdered(calls.map((call) => call.name)).slice(0, 4);
  const statuses = calls.reduce(
    (acc, call) => {
      if (call.status === "succeeded") acc.succeeded += 1;
      if (call.status === "failed") acc.failed += 1;
      if (call.status === "blocked") acc.blocked += 1;
      if (call.status === "denied") acc.denied += 1;
      return acc;
    },
    { succeeded: 0, failed: 0, blocked: 0, denied: 0 },
  );
  const parts = [
    `tools=${names.join(", ") || "none"}`,
    `ok=${statuses.succeeded}`,
  ];
  if (statuses.failed > 0) parts.push(`failed=${statuses.failed}`);
  if (statuses.blocked > 0) parts.push(`blocked=${statuses.blocked}`);
  if (statuses.denied > 0) parts.push(`denied=${statuses.denied}`);
  return parts.join(" ");
}

export function summarizeToolBatch(calls: ToolCallTrace[]): ToolBatchSummary | null {
  if (calls.length === 0) return null;
  return {
    label: buildLabel(calls),
    startedAt: calls[0]?.startedAt || new Date().toISOString(),
    finishedAt: calls[calls.length - 1]?.finishedAt || new Date().toISOString(),
    toolNames: uniqueOrdered(calls.map((call) => call.name)),
    succeededCount: calls.filter((call) => call.status === "succeeded").length,
    failedCount: calls.filter((call) => call.status === "failed").length,
    blockedCount: calls.filter((call) => call.status === "blocked").length,
    deniedCount: calls.filter((call) => call.status === "denied").length,
  };
}

export function recordToolBatchSummary(
  meta: Record<string, unknown> | undefined,
  calls: ToolCallTrace[],
): ToolBatchSummary | null {
  const summary = summarizeToolBatch(calls);
  if (!meta || !summary) return summary;
  const current = Array.isArray(meta.toolBatchSummaries)
    ? meta.toolBatchSummaries.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
  meta.toolBatchSummaries = [...current, summary].slice(-8);
  return summary;
}
