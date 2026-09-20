import { AppError } from "../../middleware/error";
import type { WorkflowNodeExecutionResult, WorkflowNodeSnapshot } from "./execution.node-runtime";

/** Persist a local action's structured evidence instead of discarding the underlying error. */
export function workflowActionFailure(node: WorkflowNodeSnapshot, executorRef: string, error: unknown): WorkflowNodeExecutionResult {
  const message = error instanceof Error ? error.message : String(error);
  const actionFailure = {
    version: 1,
    name: error instanceof Error ? error.name : "UnknownError",
    message,
    ...(error instanceof AppError ? { code: error.code, httpStatus: error.status, details: error.details } : {}),
  };
  return {
    ok: false,
    errorCode: "workflow_node_runtime_failed",
    errorMessage: message,
    outputRefs: {
      protocolVersion: "1", executorRef, nodeId: node.id, executionMode: "once",
      ports: {}, artifacts: [], itemRuns: [], evidence: { executorCompleted: false, actionFailure },
    },
  };
}
