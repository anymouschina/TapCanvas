/**
 * Node data written by execution/UI telemetry rather than workflow authoring.
 *
 * These fields may change after a saved workflow version has been inspected,
 * but they do not change the executable DAG contract. Keep the list shared by
 * capability staleness checks and checkpoint compatibility so both compare the
 * same authoring surface.
 */
export const WORKFLOW_AUTHORING_RUNTIME_DATA_KEYS = new Set<string>([
	"status",
	"progress",
	"logs",
	"canceled",
	"lastError",
	"httpStatus",
	"isQuotaExceeded",
	"runToken",
	"lastResult",
	"imageTaskId",
	"imageTaskKind",
	"videoTaskId",
	"videoTaskKind",
	"audioTaskId",
	"audioTaskKind",
	"imageModel",
	"videoModel",
	"modelVendor",
	"triggerStatus",
	"workflowStatus",
	"workflowRequestedAt",
	"previousWorkflowTraceId",
	"workflowTraceId",
	"workflowTraceStatus",
	"workflowTraceUpdatedAt",
	"workflowLogicalTaskId",
	"workflowPhysicalRunId",
	"workflowExecutionId",
	"workflowNodeRunId",
	"workflowExecutionEvidence",
	"workflowExecutionStartedAt",
	"workflowExecutionFinishedAt",
	"workflowLocalTestStatus",
	"workflowLocalTestOutput",
	"workflowLocalTestError",
	"workflowLocalTestDurationMs",
	"workflowLocalTestedAt",
	"workflowInputArtifactIds",
	"workflowOutputArtifactIds",
	"workflowEffectIds",
	"workflowItemRuns",
	"workflowCompletedUnits",
	"workflowTotalUnits",
	"workflowErrorCount",
	"workflowErrorDetail",
	"workflowRuntimeExpanded",
	"workflowPinnedOutputSource",
	"workflowResolvedOutputReuse",
	"workflowResolvedReplayCheckpoint",
	"workflowTriggerPayload",
]);

export function stripWorkflowAuthoringRuntimeData(
	data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return Object.fromEntries(Object.entries(data).filter(
		([key, value]) => !WORKFLOW_AUTHORING_RUNTIME_DATA_KEYS.has(key) && value !== undefined,
	));
}
