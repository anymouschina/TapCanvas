export type WorkflowSubmissionHandoff = Readonly<{
  version: 1;
  completionBoundary: "submission";
  executionOwner: "durable_executor";
  receipts: readonly Record<string, unknown>[];
  expectedDelivery?: Record<string, unknown>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Acceptance closes only the chat submission boundary; media stays owned by Workflow. */
export function parseWorkflowSubmissionHandoff(value: unknown): WorkflowSubmissionHandoff | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || value.version !== 1 || value.completionBoundary !== "submission"
    || value.executionOwner !== "durable_executor" || !Array.isArray(value.receipts) || value.receipts.length === 0) {
    throw new Error("Workflow submission handoff has no explicit durable owner");
  }
  const receipts = value.receipts.map((receipt: unknown) => {
    if (!isRecord(receipt) || receipt.protocolVersion !== "tapcanvas.workflow-execution-receipt/v1"
      || typeof receipt.executionId !== "string" || !receipt.executionId.trim()
      || receipt.acceptedAsync !== true || (receipt.status !== "queued" && receipt.status !== "running")
      || receipt.completionBoundary !== "submission" || receipt.executionOwner !== "durable_executor") {
      throw new Error("Workflow submission handoff requires an accepted durable execution receipt");
    }
    return receipt;
  });
  return { version: 1, completionBoundary: "submission", executionOwner: "durable_executor", receipts,
    ...(isRecord(value.expectedDelivery) ? { expectedDelivery: value.expectedDelivery } : {}) };
}
