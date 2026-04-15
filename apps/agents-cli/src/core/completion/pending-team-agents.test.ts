import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { maybeWaitForPendingTeamAgents } from "./pending-team-agents.js";
import type { ToolCallTrace } from "../hooks/types.js";

function createToolCallTrace(
  overrides: Partial<ToolCallTrace> & Pick<ToolCallTrace, "toolCallId" | "name" | "args" | "output" | "status">,
): ToolCallTrace {
  const output = String(overrides.output ?? "");
  return {
    toolCallId: overrides.toolCallId,
    name: overrides.name,
    args: overrides.args,
    output,
    outputChars: output.length,
    outputHead: output.trim().slice(0, 120),
    outputTail: output.trim().slice(Math.max(0, output.trim().length - 120)),
    status: overrides.status,
    startedAt: overrides.startedAt ?? "2026-03-28T00:00:00.000Z",
    finishedAt: overrides.finishedAt ?? "2026-03-28T00:00:00.100Z",
    durationMs: overrides.durationMs ?? 100,
    ...(overrides.errorMessage ? { errorMessage: overrides.errorMessage } : {}),
    ...(overrides.outputJson ? { outputJson: overrides.outputJson } : {}),
  };
}

test("maybeWaitForPendingTeamAgents ignores queued agents that have no pending work", async () => {
  const result = await maybeWaitForPendingTeamAgents({
    toolCalls: [
      createToolCallTrace({
        toolCallId: "tool_spawn_agent",
        name: "spawn_agent",
        args: { agent_type: "reviewer" },
        output: '{"agent_id":"agent_orphan","submission_id":"submission_unused"}',
        status: "succeeded",
      }),
    ],
    meta: {
      collabManager: {
        status(id: string) {
          return {
            id,
            description: "queued reviewer",
            agent_type: "reviewer",
            status: "queued",
            agent_work_root: path.join("/tmp", id),
            autonomous: false,
            depth: 1,
            pending_tasks: 0,
            completed_tasks: 0,
            updated_at: "2026-03-28T00:00:00.100Z",
            unread_mailbox_count: 0,
            pending_protocol_count: 0,
            recent_artifacts: [],
            recent_submissions: [],
            handoff_file_count: 0,
            result_preview: "",
          };
        },
        listSubmissionsForAgents() {
          return [];
        },
      },
    },
    waitCycle: 1,
    diagnosticAfterCycles: 4,
    maxTotalWaitMs: 90_000,
    timeoutMs: 20,
    pollMs: 10,
  });

  assert.deepEqual(result, { kind: "none" });
});

test("maybeWaitForPendingTeamAgents keeps intermediate retries out of failed trace state", async () => {
  const result = await maybeWaitForPendingTeamAgents({
    toolCalls: [
      createToolCallTrace({
        toolCallId: "tool_spawn_agent",
        name: "spawn_agent",
        args: { agent_type: "reviewer" },
        output: '{"agent_id":"agent_running","submission_id":"submission_running"}',
        status: "succeeded",
      }),
    ],
    meta: {
      collabManager: {
        status(id: string) {
          return {
            id,
            description: "running reviewer",
            agent_type: "reviewer",
            status: "running",
            agent_work_root: path.join("/tmp", id),
            autonomous: false,
            depth: 1,
            pending_tasks: 1,
            completed_tasks: 0,
            active_submission_id: "submission_running",
            updated_at: "2026-03-28T00:00:00.100Z",
            unread_mailbox_count: 0,
            pending_protocol_count: 0,
            recent_artifacts: [],
            recent_submissions: [],
            handoff_file_count: 0,
            result_preview: "",
          };
        },
        listSubmissionsForAgents() {
          return [
            {
              id: "submission_running",
              agent_id: "agent_running",
              status: "running",
              created_at: "2026-03-28T00:00:00.000Z",
              updated_at: "2026-03-28T00:00:00.100Z",
              prompt_preview: "review current patch",
              result_preview: "",
            },
          ];
        },
      },
    },
    waitCycle: 1,
    diagnosticAfterCycles: 4,
    maxTotalWaitMs: 90_000,
    timeoutMs: 20,
    pollMs: 10,
  });

  assert.equal(result.kind, "retry");
  if (result.kind !== "retry") return;
  assert.equal(result.completed, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.trace.status, "succeeded");
  assert.equal(result.trace.errorMessage, undefined);
});

test("maybeWaitForPendingTeamAgents keeps waiting after diagnostic threshold and exposes over-budget facts", async () => {
  const result = await maybeWaitForPendingTeamAgents({
    toolCalls: [
      createToolCallTrace({
        toolCallId: "tool_spawn_agent",
        name: "spawn_agent",
        args: { agent_type: "reviewer" },
        output: '{"agent_id":"agent_stuck","submission_id":"submission_stuck"}',
        status: "succeeded",
      }),
    ],
    meta: {
      collabManager: {
        status(id: string) {
          return {
            id,
            description: "stuck reviewer",
            agent_type: "reviewer",
            status: "running",
            agent_work_root: path.join("/tmp", id),
            autonomous: false,
            depth: 1,
            pending_tasks: 1,
            completed_tasks: 0,
            active_submission_id: "submission_stuck",
            updated_at: "2026-03-28T00:00:00.100Z",
            unread_mailbox_count: 0,
            pending_protocol_count: 0,
            recent_artifacts: [],
            recent_submissions: [],
            handoff_file_count: 0,
            result_preview: "",
          };
        },
        listSubmissionsForAgents() {
          return [
            {
              id: "submission_stuck",
              agent_id: "agent_stuck",
              status: "running",
              created_at: "2026-03-28T00:00:00.000Z",
              updated_at: "2026-03-28T00:00:00.100Z",
              prompt_preview: "review current patch",
              result_preview: "",
              run_started_at: "2026-03-28T00:00:00.000Z",
              run_elapsed_ms: 8000,
              budget_ms: 5000,
              budget_exceeded_at: "2026-03-28T00:00:05.000Z",
              over_budget_ms: 3000,
              last_progress_at: "2026-03-28T00:00:00.100Z",
              last_progress_age_ms: 7900,
              last_progress_summary: "tool=read_file status=succeeded",
            },
          ];
        },
      },
    },
    waitCycle: 4,
    diagnosticAfterCycles: 4,
    maxTotalWaitMs: 90_000,
    timeoutMs: 20,
    pollMs: 10,
  });

  assert.equal(result.kind, "retry");
  if (result.kind !== "retry") return;
  assert.equal(result.completed, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.trace.status, "succeeded");
  assert.equal(result.trace.errorMessage, undefined);
  assert.match(result.message, /overBudgetDiagnostics/);
  assert.match(result.message, /tool=read_file status=succeeded/);
});

test("maybeWaitForPendingTeamAgents does not auto-wait closed agents even when stale pending fields remain", async () => {
  const result = await maybeWaitForPendingTeamAgents({
    toolCalls: [
      createToolCallTrace({
        toolCallId: "tool_spawn_agent",
        name: "spawn_agent",
        args: { agent_type: "research" },
        output: '{"agent_id":"agent_closed","submission_id":"submission_running"}',
        status: "succeeded",
      }),
      createToolCallTrace({
        toolCallId: "tool_close_agent",
        name: "close_agent",
        args: { id: "agent_closed" },
        output: '{"id":"agent_closed","status":"closed"}',
        status: "succeeded",
      }),
    ],
    meta: {
      collabManager: {
        status(id: string) {
          return {
            id,
            description: "closed research child",
            agent_type: "research",
            status: "closed",
            agent_work_root: path.join("/tmp", id),
            autonomous: false,
            depth: 1,
            pending_tasks: 2,
            completed_tasks: 0,
            active_submission_id: "submission_running",
            updated_at: "2026-03-28T00:00:00.100Z",
            unread_mailbox_count: 0,
            pending_protocol_count: 0,
            recent_artifacts: [],
            recent_submissions: [],
            handoff_file_count: 0,
            result_preview: "",
          };
        },
        listSubmissionsForAgents() {
          return [
            {
              id: "submission_running",
              agent_id: "agent_closed",
              status: "running",
              created_at: "2026-03-28T00:00:00.000Z",
              updated_at: "2026-03-28T00:00:00.100Z",
              prompt_preview: "extract chapter 1 scene assets",
              result_preview: "",
            },
          ];
        },
      },
    },
    waitCycle: 1,
    diagnosticAfterCycles: 4,
    maxTotalWaitMs: 90_000,
    timeoutMs: 20,
    pollMs: 10,
  });

  assert.deepEqual(result, { kind: "none" });
});

test("maybeWaitForPendingTeamAgents prefers status subscription wakeups over coarse polling", async () => {
  let running = true;
  const listeners = new Set<() => void>();
  const startedAt = Date.now();
  setTimeout(() => {
    running = false;
    for (const listener of Array.from(listeners)) listener();
  }, 15);

  const result = await maybeWaitForPendingTeamAgents({
    toolCalls: [
      createToolCallTrace({
        toolCallId: "tool_spawn_agent",
        name: "spawn_agent",
        args: { agent_type: "reviewer" },
        output: '{"agent_id":"agent_subscribed","submission_id":"submission_subscribed"}',
        status: "succeeded",
      }),
    ],
    meta: {
      collabManager: {
        status(id: string) {
          return {
            id,
            description: "subscribed reviewer",
            agent_type: "reviewer",
            status: running ? "running" : "completed",
            agent_work_root: path.join("/tmp", id),
            autonomous: false,
            depth: 1,
            pending_tasks: running ? 1 : 0,
            completed_tasks: running ? 0 : 1,
            active_submission_id: running ? "submission_subscribed" : undefined,
            updated_at: "2026-03-28T00:00:00.100Z",
            unread_mailbox_count: 0,
            pending_protocol_count: 0,
            recent_artifacts: [],
            recent_submissions: [],
            handoff_file_count: 0,
            result_preview: running ? "" : "done",
          };
        },
        listSubmissionsForAgents() {
          return [
            {
              id: "submission_subscribed",
              agent_id: "agent_subscribed",
              status: running ? "running" : "completed",
              created_at: "2026-03-28T00:00:00.000Z",
              updated_at: "2026-03-28T00:00:00.100Z",
              finished_at: running ? undefined : "2026-03-28T00:00:00.120Z",
              prompt_preview: "review current patch",
              result_preview: running ? "" : "done",
            },
          ];
        },
        subscribeStatus(_id: string, listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
    waitCycle: 1,
    diagnosticAfterCycles: 4,
    maxTotalWaitMs: 90_000,
    timeoutMs: 200,
    pollMs: 500,
  });

  assert.equal(result.kind, "retry");
  if (result.kind !== "retry") return;
  assert.equal(result.completed, true);
  assert.equal(result.timedOut, false);
  assert.ok(result.waitedMs < 120, `expected subscribed wakeup, got waitedMs=${result.waitedMs}`);
  assert.ok(Date.now() - startedAt < 180, "subscription path should settle well before coarse poll fallback");
  assert.match(result.trace.output, /"completed":true/);
});
