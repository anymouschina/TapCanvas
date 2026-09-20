import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import type { WorkflowNodeExecutionResult } from "./execution.node-runtime";
import { parseWorkflowAgentPhysicalFailureEvidence, remainingWorkflowAgentPhysicalRetryDelayMs } from "./execution.agent-backpressure";
import { readWorkflowAgentOutputRepair } from "./execution.agent-output-repair";

type ExecuteOnce = (context: WorkflowNodeExecutionContext, dependencies: WorkflowNodeExecutorDependencies) => Promise<WorkflowNodeExecutionResult>;

/** Persist the exact rejected candidate before giving its author one immediate correction. */
export async function executeWithImmediateOutputRepair(
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
	executeOnce: ExecuteOnce,
): Promise<WorkflowNodeExecutionResult> {
	context.abortSignal?.throwIfAborted();
	const result = await executeOnce(context, dependencies);
	if (result.ok || !result.waitingExternal
		|| result.outputRefs.evidence.continuationReason !== "structured_output_repair_required"
		|| context.resumeOutputRefs?.evidence.outputRepair !== undefined
		|| !context.checkpointOutputRefs) return result;
	const repair = readWorkflowAgentOutputRepair(result.outputRefs.evidence);
	if (!repair) return result;
	// A process loss at either side of this write resumes this same candidate;
	// no business action or prior successful collection item is replayed.
	await context.checkpointOutputRefs({ ...result.outputRefs, externalCheck: result.externalCheck });
	context.abortSignal?.throwIfAborted();
	let repaired = await executeOnce({ ...context, resumeOnly: true, resumeOutputRefs: result.outputRefs }, dependencies);
	// Recovering a completed physical turn may only allocate its successor.
	// Persist that transition before dispatching the one promised correction;
	// otherwise the collection waits for unrelated siblings before even starting it.
	const physicalRetry = repaired.outputRefs
		? parseWorkflowAgentPhysicalFailureEvidence(repaired.outputRefs.evidence) : null;
	if (!repaired.ok && repaired.waitingExternal && repaired.outputRefs
		&& physicalRetry?.reason === "structured_output_invalid"
		&& remainingWorkflowAgentPhysicalRetryDelayMs(physicalRetry) === 0
		&& readWorkflowAgentOutputRepair(repaired.outputRefs.evidence)?.sourceTurnId === repair.sourceTurnId) {
		await context.checkpointOutputRefs({ ...repaired.outputRefs, externalCheck: repaired.externalCheck });
		context.abortSignal?.throwIfAborted();
		repaired = await executeOnce({ ...context, resumeOnly: true, resumeOutputRefs: repaired.outputRefs }, dependencies);
	}
	if (!repaired.outputRefs) return repaired;
	return {
		...repaired,
		outputRefs: {
			...repaired.outputRefs,
			evidence: { ...repaired.outputRefs.evidence, immediateOutputRepair: {
				version: 1, sourceTurnId: repair.sourceTurnId, attemptCount: 1,
				outcome: repaired.ok ? "accepted" : "continued_recovery",
			} },
		},
	};
}
