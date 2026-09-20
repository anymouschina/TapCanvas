import { createLogicalTaskBudget, type LogicalTaskBudget } from "../../../../../packages/schemas/logical-task-budget/index.cjs";
import type { ExecutionTraceLifecycleSnapshot } from "../memory/execution-trace-events.repo";
import type { ExecutionRow } from "../execution/execution.repo";

/** Workflow admission lives in the execution ledger, not the chat trace table. */
export async function resolveWorkflowExecutionBudget(input: {
  executionFamilyId: string;
  readExecution: (id: string) => Promise<Pick<ExecutionRow, "id" | "execution_family_id" | "created_at"> | null>;
}): Promise<LogicalTaskBudget> {
  const root = await input.readExecution(input.executionFamilyId);
  if (!root) throw new Error(`workflow_budget_admission_missing:${input.executionFamilyId}`);
  if (root.id !== input.executionFamilyId || root.execution_family_id !== root.id) {
    throw new Error("workflow_budget_admission_identity_mismatch");
  }
  return createLogicalTaskBudget(root.id, root.created_at);
}

/** Admission timestamps are durable facts; physical retries cannot mint a new target. */
export async function resolveLogicalTaskBudget(input: {
  traceId: string;
  admissionTraceId?: string;
  readTrace: (traceId: string) => Promise<ExecutionTraceLifecycleSnapshot | null>;
}): Promise<LogicalTaskBudget> {
  const seen = new Set<string>();
  let traceId = input.traceId.trim() || input.admissionTraceId?.trim() || "";
  while (!seen.has(traceId)) {
    seen.add(traceId);
    const trace = await input.readTrace(traceId);
    if (!trace) throw new Error(`logical_task_budget_admission_missing:${traceId}`);
    if (trace.traceId !== traceId) throw new Error("logical_task_budget_admission_identity_mismatch");
    if (trace.rootTraceId === traceId) return createLogicalTaskBudget(trace.logicalTaskId, trace.startedAt);
    traceId = trace.rootTraceId;
  }
  throw new Error("logical_task_budget_admission_cycle");
}
