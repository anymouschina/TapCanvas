import type { WorkflowPipelineRunSpecV1 } from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";

export type PipelineDependencyFailure = Readonly<{
  stepId: string;
  runtimeNodeId: string;
  itemId?: string;
  taskId?: string;
  providerStatus?: string;
  errorCode?: string;
  errorMessage: string;
}>;

type StepReceipt = Readonly<{
  status: string;
  outputRefs?: WorkflowNodeOutputV1;
  errorCode?: string;
  errorMessage?: string;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Report causal ancestors' actual failed receipts, never infer failure from prose or missing URLs. */
export function collectPipelineDependencyFailures(input: Readonly<{
  stepId: string;
  bindings: WorkflowPipelineRunSpecV1["bindings"];
  receipts: Readonly<Record<string, StepReceipt>>;
}>): PipelineDependencyFailure[] {
  const ancestors = new Set<string>();
  const pending = [input.stepId];
  while (pending.length > 0) {
    const target = pending.pop();
    for (const binding of input.bindings) {
      if (binding.to.stepId !== target || binding.from.kind !== "step") continue;
      const source = binding.from.stepId;
      if (source === input.stepId || ancestors.has(source)) continue;
      ancestors.add(source);
      pending.push(source);
    }
  }
  const failures: PipelineDependencyFailure[] = [];
  const visited = new Set<unknown>();
  const visit = (stepId: string, value: unknown, runtimeNodeId: string): void => {
    if (!record(value) || visited.has(value)) return;
    visited.add(value);
    const identity = typeof value.runtimeNodeId === "string" ? value.runtimeNodeId
      : typeof value.nodeId === "string" ? value.nodeId : runtimeNodeId;
    const evidence = record(value.evidence) ? value.evidence : {};
    if (value.status === "failed" && typeof value.errorMessage === "string" && value.errorMessage.trim()) {
      failures.push({ stepId, runtimeNodeId: identity, errorMessage: value.errorMessage,
        ...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}),
        ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
        ...(typeof evidence.taskId === "string" ? { taskId: evidence.taskId } : {}),
        ...(typeof evidence.providerStatus === "string" ? { providerStatus: evidence.providerStatus } : {}),
      });
    }
    if (Array.isArray(value.itemRuns)) for (const item of value.itemRuns) visit(stepId, item, identity);
    if (record(value.outputRefs)) visit(stepId, value.outputRefs, identity);
    const pipeline = evidence.pipelineState;
    if (record(pipeline) && pipeline.protocolVersion === "workflow.pipeline.state/v1" && record(pipeline.steps)) {
      for (const receipt of Object.values(pipeline.steps)) visit(stepId, receipt, identity);
    }
  };
  for (const stepId of ancestors) {
    const receipt = input.receipts[stepId];
    if (receipt) visit(stepId, receipt, receipt.outputRefs?.nodeId ?? stepId);
  }
  return failures;
}

export function describePipelineDependencyFailure(message: string, failures: readonly PipelineDependencyFailure[]): string {
  const first = failures[0];
  if (!first) return message;
  return `${message}; upstream dependency failed at ${first.stepId}${first.itemId ? ` / ${first.itemId}` : ""}: ${first.errorMessage}${failures.length > 1 ? ` (${failures.length} recorded dependency failures)` : ""}`;
}
