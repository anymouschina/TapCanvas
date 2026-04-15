import fs from "node:fs";
import path from "node:path";

import type { AgentsHook, AfterRunHookPayload, RunErrorHookPayload } from "../types.js";

export function createFileTraceHook(runtimeCwd: string): AgentsHook {
  return {
    name: "file-trace",
    async afterRun(payload: AfterRunHookPayload): Promise<void> {
      appendTrace(runtimeCwd, {
        type: "afterRun",
        runId: payload.runId,
        prompt: payload.prompt,
        sessionId: payload.sessionId ?? "",
        workspaceRoot: payload.workspaceRoot,
        workspaceContextSummary: payload.workspaceContext.summary,
        runtimeMeta: payload.runtimeMeta ?? {},
        toolCalls: payload.toolCalls.map((item) => ({
          toolCallId: item.toolCallId,
          name: item.name,
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
        })),
        resultPreview: truncate(payload.resultText, 500),
        recordedAt: new Date().toISOString(),
      });
    },
    async onRunError(payload: RunErrorHookPayload): Promise<void> {
      appendTrace(runtimeCwd, {
        type: "runError",
        runId: payload.runId,
        prompt: payload.prompt,
        sessionId: payload.sessionId ?? "",
        workspaceRoot: payload.workspaceRoot,
        workspaceContextSummary: payload.workspaceContext.summary,
        runtimeMeta: payload.runtimeMeta ?? {},
        toolCalls: payload.toolCalls.map((item) => ({
          toolCallId: item.toolCallId,
          name: item.name,
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
        })),
        errorMessage: payload.errorMessage,
        recordedAt: new Date().toISOString(),
      });
    },
  };
}

function appendTrace(runtimeCwd: string, value: Record<string, unknown>): void {
  try {
    const dir = path.join(runtimeCwd, ".agents", "runtime", "traces");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "runs.jsonl");
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    console.warn(`[agents:file-trace] failed to persist trace: ${message}`);
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}
