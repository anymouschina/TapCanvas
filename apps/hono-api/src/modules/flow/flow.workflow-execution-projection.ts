export const WORKFLOW_EXECUTION_PROJECTION_OWNER = "workflow_execution";
export const WORKFLOW_EXECUTION_STATUS_NODE_ID = "workflow-execution-status";

type FlowRecord = Record<string, unknown>;

function readRecord(value: unknown): FlowRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as FlowRecord
		: null;
}

/** Server-owned singleton that makes an accepted durable execution visible on its delivery canvas. */
export function isWorkflowExecutionProjectionNode(value: unknown): boolean {
	const node = readRecord(value);
	const data = readRecord(node?.data);
	return node?.type === "workflowExecutionNode"
		&& data?.kind === "workflowExecution"
		&& data.managedProjection === WORKFLOW_EXECUTION_PROJECTION_OWNER;
}
