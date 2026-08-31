import type { WorkflowNodeItemRunV1 } from "./execution.node-runtime";

/**
 * A terminal media failure is evidence, not authorization to pay for another
 * submission. Recovery may reconcile accepted receipts, but a fresh provider
 * submission requires a new explicit execution family.
 */
export function isRetryableTerminalMediaItemRun(
	_executorRef: string,
	_itemRun: WorkflowNodeItemRunV1,
): boolean {
	return false;
}
