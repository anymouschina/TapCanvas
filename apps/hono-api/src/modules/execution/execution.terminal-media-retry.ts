import type { WorkflowNodeItemRunV1 } from "./execution.node-runtime";

/**
 * A terminal media failure is evidence, not authorization to pay for another
 * submission. Ordinary recovery only reconciles receipts. Explicit mediaRetries
 * admission removes the authorized item from the new replay cursor and assigns
 * a separate effect identity in the same family; this predicate grants no retry.
 */
export function isRetryableTerminalMediaItemRun(
	_executorRef: string,
	_itemRun: WorkflowNodeItemRunV1,
): boolean {
	return false;
}
