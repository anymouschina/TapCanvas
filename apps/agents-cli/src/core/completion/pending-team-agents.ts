import type {
  AgentStatusSummary,
  CollabAgentManagerLike,
  SubmissionStatusSummary,
} from "../collab/public.js";
import type { ToolCallTrace } from "../hooks/types.js";

type PendingAgentSnapshot = {
  trackedAgentIds: string[];
  agentStatuses: AgentStatusSummary[];
  submissions: SubmissionStatusSummary[];
  pendingAgents: AgentStatusSummary[];
};

type RuntimeWaitTrace = {
  args: Record<string, unknown>;
  output: string;
  status: "succeeded" | "failed";
  errorMessage?: string;
};

export type PendingTeamAgentsWaitDecision =
  | { kind: "none" }
  | {
      kind: "retry";
      message: string;
      trace: RuntimeWaitTrace;
      completed: boolean;
      timedOut: boolean;
      waitedMs: number;
    };

export async function maybeWaitForPendingTeamAgents(input: {
  toolCalls: ToolCallTrace[];
  meta?: Record<string, unknown>;
  waitCycle: number;
  diagnosticAfterCycles: number;
  maxTotalWaitMs: number;
  timeoutMs: number;
  pollMs: number;
  forceSummaryOnNoPending?: boolean;
  abortSignal?: AbortSignal;
}): Promise<PendingTeamAgentsWaitDecision> {
  const manager = readCollabManager(input.meta);
  if (!manager) return { kind: "none" };

  const before = inspectPendingTeamAgents(manager, input.toolCalls);
  if (before.pendingAgents.length === 0) {
    if (
      before.trackedAgentIds.length === 0 ||
      before.submissions.length === 0 ||
      input.forceSummaryOnNoPending !== true
    ) {
      return { kind: "none" };
    }
    const trace = buildRuntimeWaitTrace({
      before,
      after: before,
      waitedMs: 0,
      waitCycle: input.waitCycle,
      diagnosticAfterCycles: input.diagnosticAfterCycles,
      maxTotalWaitMs: input.maxTotalWaitMs,
      timeoutMs: input.timeoutMs,
      pollMs: input.pollMs,
      completed: true,
    });
    return {
      kind: "retry",
      completed: true,
      timedOut: false,
      waitedMs: 0,
      trace,
      message: buildRuntimeWaitRetryMessage({
        before,
        after: before,
        waitedMs: 0,
        waitCycle: input.waitCycle,
        diagnosticAfterCycles: input.diagnosticAfterCycles,
        maxTotalWaitMs: input.maxTotalWaitMs,
        completed: true,
      }),
    };
  }

  const startedAt = Date.now();
  let latest = before;
  const deadline = startedAt + Math.max(0, input.timeoutMs);

  while (Date.now() < deadline) {
    throwIfAborted(input.abortSignal);
    await waitForPendingAgentUpdate({
      manager,
      pendingAgentIds: latest.pendingAgents.map((agent) => agent.id),
      timeoutMs: Math.max(0, deadline - Date.now()),
      pollMs: input.pollMs,
      abortSignal: input.abortSignal,
    });
    throwIfAborted(input.abortSignal);
    latest = inspectPendingTeamAgents(manager, input.toolCalls);
    if (latest.pendingAgents.length === 0) break;
  }

  const waitedMs = Math.max(0, Date.now() - startedAt);
  const completed = latest.pendingAgents.length === 0;
  const timedOut = !completed && waitedMs >= Math.max(0, input.timeoutMs);
  const trace = buildRuntimeWaitTrace({
    before,
    after: latest,
    waitedMs,
    waitCycle: input.waitCycle,
    diagnosticAfterCycles: input.diagnosticAfterCycles,
    maxTotalWaitMs: input.maxTotalWaitMs,
    timeoutMs: input.timeoutMs,
    pollMs: input.pollMs,
    completed,
  });

  return {
    kind: "retry",
    completed,
    timedOut,
    waitedMs,
    trace,
    message: buildRuntimeWaitRetryMessage({
      before,
      after: latest,
      waitedMs,
      waitCycle: input.waitCycle,
      diagnosticAfterCycles: input.diagnosticAfterCycles,
      maxTotalWaitMs: input.maxTotalWaitMs,
      completed,
    }),
  };
}

function readCollabManager(
  meta: Record<string, unknown> | undefined,
): CollabAgentManagerLike | null {
  const manager = meta?.collabManager;
  if (!manager || typeof manager !== "object") return null;
  const candidate = manager as Partial<CollabAgentManagerLike>;
  if (
    typeof candidate.status !== "function" ||
    typeof candidate.listSubmissionsForAgents !== "function"
  ) {
    return null;
  }
  return manager as CollabAgentManagerLike;
}

function inspectPendingTeamAgents(
  manager: CollabAgentManagerLike,
  toolCalls: ToolCallTrace[],
): PendingAgentSnapshot {
  const trackedAgentIds = collectTrackedTeamAgentIds(toolCalls);
  if (trackedAgentIds.length === 0) {
    return {
      trackedAgentIds: [],
      agentStatuses: [],
      submissions: [],
      pendingAgents: [],
    };
  }

  const agentStatuses = trackedAgentIds
    .map((id) => safeReadAgentStatus(manager, id))
    .filter((item): item is AgentStatusSummary => item !== null);
  const submissions = safeListSubmissions(manager, trackedAgentIds);
  const submissionsByAgentId = new Map<string, SubmissionStatusSummary[]>();
  for (const submission of submissions) {
    const current = submissionsByAgentId.get(submission.agent_id) ?? [];
    current.push(submission);
    submissionsByAgentId.set(submission.agent_id, current);
  }
  const pendingAgents = agentStatuses.filter((agent) =>
    isAgentStillRunning(agent, submissionsByAgentId.get(agent.id) ?? []),
  );
  return {
    trackedAgentIds,
    agentStatuses,
    submissions,
    pendingAgents,
  };
}

function collectTrackedTeamAgentIds(toolCalls: ToolCallTrace[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  for (const toolCall of toolCalls) {
    if (toolCall.status !== "succeeded") continue;
    const normalizedName = String(toolCall.name || "").trim().toLowerCase();
    if (normalizedName === "spawn_agent") {
      const parsed = tryParseJsonRecord(toolCall.output);
      push(parsed?.agent_id);
      continue;
    }
    if (
      normalizedName === "send_input" ||
      normalizedName === "resume_agent" ||
      normalizedName === "close_agent"
    ) {
      push(toolCall.args.id);
      continue;
    }
    if (normalizedName === "wait" && Array.isArray(toolCall.args.ids)) {
      for (const id of toolCall.args.ids) {
        push(id);
      }
    }
  }

  return out;
}

function safeReadAgentStatus(
  manager: CollabAgentManagerLike,
  id: string,
): AgentStatusSummary | null {
  try {
    return manager.status(id);
  } catch {
    return null;
  }
}

function safeListSubmissions(
  manager: CollabAgentManagerLike,
  ids: string[],
): SubmissionStatusSummary[] {
  try {
    return manager.listSubmissionsForAgents(ids);
  } catch {
    return [];
  }
}

async function waitForPendingAgentUpdate(input: {
  manager: CollabAgentManagerLike;
  pendingAgentIds: string[];
  timeoutMs: number;
  pollMs: number;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const timeoutMs = Math.max(0, Math.trunc(input.timeoutMs));
  if (timeoutMs <= 0) return;

  const subscribeStatus = input.manager.subscribeStatus;
  if (typeof subscribeStatus !== "function" || input.pendingAgentIds.length === 0) {
    await sleep(Math.min(Math.max(50, input.pollMs), Math.max(50, timeoutMs)));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          continue;
        }
      }
      handler();
    };

    const timer = setTimeout(() => finish(resolve), timeoutMs);
    cleanups.push(() => clearTimeout(timer));

    const onAbort = () => {
      const reason = input.abortSignal?.reason;
      finish(() => reject(reason instanceof Error ? reason : new Error("等待子代理时运行已中止。")));
    };
    if (input.abortSignal) {
      if (input.abortSignal.aborted) {
        onAbort();
        return;
      }
      input.abortSignal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => input.abortSignal?.removeEventListener("abort", onAbort));
    }

    for (const agentId of input.pendingAgentIds) {
      try {
        const unsubscribe = subscribeStatus.call(input.manager, agentId, () => finish(resolve));
        if (typeof unsubscribe === "function") {
          cleanups.push(unsubscribe);
        }
      } catch {
        continue;
      }
    }
  });
}

function isAgentStillRunning(
  agent: AgentStatusSummary,
  _submissions: SubmissionStatusSummary[],
): boolean {
  if (agent.status === "closed" || agent.status === "completed" || agent.status === "failed") {
    return false;
  }
  if (agent.status === "running") return true;
  if (agent.pending_tasks > 0) return true;
  if (typeof agent.active_submission_id === "string" && agent.active_submission_id.trim()) {
    return true;
  }
  if (agent.status === "queued") return false;
  return false;
}

function buildRuntimeWaitTrace(input: {
  before: PendingAgentSnapshot;
  after: PendingAgentSnapshot;
  waitedMs: number;
  waitCycle: number;
  diagnosticAfterCycles: number;
  maxTotalWaitMs: number;
  timeoutMs: number;
  pollMs: number;
  completed: boolean;
}): RuntimeWaitTrace {
  const overBudgetSubmissions = input.after.submissions
    .filter((submission) => typeof submission.over_budget_ms === "number" && submission.over_budget_ms > 0)
    .map((submission) => summarizeSubmission(submission));
  const payload = {
    waitCycle: input.waitCycle,
    diagnosticAfterCycles: input.diagnosticAfterCycles,
    maxTotalWaitMs: input.maxTotalWaitMs,
    waitedMs: input.waitedMs,
    timedOut: !input.completed && input.waitedMs >= Math.max(0, input.timeoutMs),
    trackedAgentIds: input.after.trackedAgentIds,
    pendingBefore: input.before.pendingAgents.map((agent) => summarizeAgent(agent)),
    pendingAfter: input.after.pendingAgents.map((agent) => summarizeAgent(agent)),
    finalStatuses: input.after.agentStatuses.map((agent) => summarizeAgent(agent)),
    submissions: input.after.submissions.map((submission) => summarizeSubmission(submission)),
    overBudgetSubmissions,
    completed: input.completed,
  };
  return {
    args: {
      wait_cycle: input.waitCycle,
      diagnostic_after_cycles: input.diagnosticAfterCycles,
      max_total_wait_ms: input.maxTotalWaitMs,
      tracked_agent_ids: input.after.trackedAgentIds,
      timeout_ms: input.timeoutMs,
      poll_ms: input.pollMs,
      waited_ms: input.waitedMs,
      completed: input.completed,
    },
    output: JSON.stringify(payload),
    status: "succeeded",
  };
}

function buildRuntimeWaitRetryMessage(input: {
  before: PendingAgentSnapshot;
  after: PendingAgentSnapshot;
  waitedMs: number;
  waitCycle: number;
  diagnosticAfterCycles: number;
  maxTotalWaitMs: number;
  completed: boolean;
}): string {
  const beforeLines = input.before.pendingAgents.map((agent) => `- ${summarizeAgent(agent)}`);
  const afterLines =
    input.after.agentStatuses.length > 0
      ? input.after.agentStatuses.map((agent) => `- ${summarizeAgent(agent)}`)
      : ["- none"];
  const submissionLines =
    input.after.submissions.length > 0
      ? input.after.submissions.map((submission) => `- ${summarizeSubmission(submission)}`)
      : ["- none"];
  const overBudgetLines = input.after.submissions
    .filter((submission) => typeof submission.over_budget_ms === "number" && submission.over_budget_ms > 0)
    .map((submission) => `- ${summarizeSubmission(submission)}`);
  return [
    "<agents-team-runtime-wait>",
    `waitCycle=${input.waitCycle}`,
    `diagnosticAfterCycles=${input.diagnosticAfterCycles}`,
    `maxTotalWaitMs=${input.maxTotalWaitMs}`,
    `waitedMs=${input.waitedMs}`,
    "pendingBefore:",
    ...(beforeLines.length > 0 ? beforeLines : ["- none"]),
    "finalStatuses:",
    ...afterLines,
    "submissions:",
    ...submissionLines,
    ...(overBudgetLines.length > 0
      ? [
          "overBudgetDiagnostics:",
          ...overBudgetLines,
          "diagnosticNote: 以上仅说明子代理已超过 budget，且最近一次可观测进展停在 lastProgress；不能仅凭这些字段主观断定是模型、网络还是工具故障。",
        ]
      : []),
    "</agents-team-runtime-wait>",
    input.completed
      ? "运行时检测到本轮存在未完成子代理，已自动轮询等待到这些子代理进入终态。该等待不计入生成轮次。请基于这些子代理的最终状态继续汇总，不要忽略失败或完成结果。"
      : "运行时检测到本轮存在未完成子代理，已自动轮询等待，但当前仍有子代理未结束。该等待不计入生成轮次。在这些子代理结束前，禁止把本轮写成已完成；请继续等待、检查阻塞，或显式处理未完成子代理。",
  ].join("\n");
}

function summarizeAgent(agent: AgentStatusSummary): string {
  const pieces = [
    agent.id,
    `[${agent.status}]`,
    agent.description || agent.agent_type,
    `pending=${agent.pending_tasks}`,
  ];
  if (agent.active_submission_id) pieces.push(`activeSubmission=${agent.active_submission_id}`);
  if (agent.error) pieces.push(`error=${agent.error}`);
  return pieces.join(" ");
}

function summarizeSubmission(submission: SubmissionStatusSummary): string {
  const pieces = [
    submission.id,
    `[${submission.status}]`,
    `agent=${submission.agent_id}`,
  ];
  if (typeof submission.run_elapsed_ms === "number") pieces.push(`elapsed=${submission.run_elapsed_ms}ms`);
  if (typeof submission.budget_ms === "number") pieces.push(`budget=${submission.budget_ms}ms`);
  if (typeof submission.over_budget_ms === "number") pieces.push(`overBudget=${submission.over_budget_ms}ms`);
  if (typeof submission.last_progress_age_ms === "number") {
    pieces.push(`lastProgressAge=${submission.last_progress_age_ms}ms`);
  }
  if (submission.last_progress_summary) pieces.push(`lastProgress=${submission.last_progress_summary}`);
  if (submission.error) pieces.push(`error=${submission.error}`);
  return pieces.join(" ");
}

function tryParseJsonRecord(text: string): Record<string, unknown> | null {
  const trimmed = String(text || "").trim();
  if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const text = typeof reason === "string" ? reason.trim() : "";
  throw new Error(text || "等待子代理时运行已中止。");
}
