import { WORKFLOW_AGENT_RATE_LIMIT_FAILURE_CODE } from "./execution.agent-backpressure";

/** Physical executor failures are action receipts, independent of candidate submission policy. */
const PHYSICAL_CONTINUATION_REASONS = new Set([
	WORKFLOW_AGENT_RATE_LIMIT_FAILURE_CODE,
	"workflow_agent_role_timeout",
	"provider_stream_interrupted",
	"workflow_runtime_restarted",
	"llm_response_too_large",
	"async_dependency_terminal",
	"workflow_agent_orphaned_checkpoint",
	"workflow_agent_durable_turn_missing",
	"workflow_agent_no_progress_window_exhausted",
]);

/** Normalize protocol subtypes only; retain the original receipt alongside the durable cursor. */
export function resolveWorkflowAgentPhysicalContinuationReason(value: unknown): string | null {
	if (value === "structured_submission_provider_stream_interrupted" ||
		value === "structured_submission_provider_output_incomplete") return "provider_stream_interrupted";
	return typeof value === "string" && PHYSICAL_CONTINUATION_REASONS.has(value) ? value : null;
}
