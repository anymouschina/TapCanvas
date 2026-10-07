import { parseWorkflowPipelineRunSpec } from "@tapcanvas/workflow-kernel-protocol";
import { workflowAgentRepairSource } from "./execution.agent-repair-handoff";
import { bindWorkflowAcceptedAuthorRecovery } from "./execution.accepted-author-recovery";
import { bindWorkflowAgentInitialRecovery } from "./execution.agent-initial-recovery";
import { parseWorkflowNodeOutputV1, resolveWorkflowNodeExecutionMode, resolveWorkflowNodeExecutorRef,
	type WorkflowNodeOutputV1, type WorkflowNodeSnapshot } from "./execution.node-runtime";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A derived checkpoint must keep its actual predecessor, not adopt the next recovery execution. */
function receiptSourceExecution(evidence: Record<string, unknown>, nominatedSource: string): string {
	const retained = evidence.agentRepairSource;
	if (record(retained) && typeof retained.sourceExecutionId === "string" && retained.sourceExecutionId.trim()) {
		return retained.sourceExecutionId;
	}
	for (const key of ["replayCheckpoint", "outputReuse"] as const) {
		const provenance = evidence[key];
		if (record(provenance) && typeof provenance.sourceExecutionId === "string" && provenance.sourceExecutionId.trim()) {
			return provenance.sourceExecutionId;
		}
	}
	return nominatedSource;
}

/**
 * Bind failed structured author leaves through the frozen each/pipeline tree.
 * This nominates an inactive source for the existing verified chat-status handoff;
 * it neither reads a draft nor changes any accepted result, status or paid cursor.
 */
export function bindWorkflowNestedAgentRepairSources(input: Readonly<{
	node: WorkflowNodeSnapshot;
	output: WorkflowNodeOutputV1;
	sourceExecutionId: string;
	sourceNodeRunId: string;
	preserveAgentRepair: boolean;
}>): WorkflowNodeOutputV1 {
	if (!input.preserveAgentRepair) return input.output;
	if (!input.sourceExecutionId.trim()) throw new Error("workflow_nested_agent_repair_source_execution_missing");
	const walk = (node: WorkflowNodeSnapshot, output: WorkflowNodeOutputV1, source: string,
		unboxed = false): WorkflowNodeOutputV1 => {
		if (output.nodeId !== node.id || output.executorRef !== resolveWorkflowNodeExecutorRef(node)
			|| (!unboxed && output.executionMode !== resolveWorkflowNodeExecutionMode(node))) {
			throw new Error(`workflow_nested_agent_repair_receipt_identity_invalid:${output.nodeId}`);
		}
		const owner = receiptSourceExecution(output.evidence, source);
		if (output.executionMode === "each") {
			const itemIds = new Set<string>();
			return { ...output, itemRuns: output.itemRuns.map(item => {
				if (itemIds.has(item.itemId)) throw new Error("workflow_nested_agent_repair_duplicate_item");
				itemIds.add(item.itemId);
				if (item.status !== "failed") return item;
				if (item.runtimeNodeId !== `${output.nodeId}::item::${encodeURIComponent(item.itemId)}`) {
					throw new Error("workflow_nested_agent_repair_item_identity_invalid");
				}
				const child = walk({ ...node, id: item.runtimeNodeId }, { ...output,
					nodeId: item.runtimeNodeId, executionMode: "once", evidence: item.evidence,
					ports: item.ports, artifacts: item.artifacts, itemRuns: [] }, owner, true);
				return { ...item, evidence: child.evidence };
			}) };
		}
		if (output.executorRef === "workflow.pipeline.run/v1") {
			const state = output.evidence.pipelineState;
			if (state === undefined || state === null) return output;
			if (!record(state) || state.protocolVersion !== "workflow.pipeline.state/v1" || !record(state.steps)) {
				throw new Error("workflow_nested_agent_repair_pipeline_state_invalid");
			}
			const spec = parseWorkflowPipelineRunSpec(node.data.workflowPipeline);
			const steps = { ...state.steps };
			for (const [stepId, receipt] of Object.entries(steps)) {
				if (!record(receipt) || receipt.status !== "failed") continue;
				// An unexecuted failed action has no source draft to nominate.
				if (receipt.outputRefs === undefined || receipt.outputRefs === null) continue;
				const definition = spec.steps.find(step => step.stepId === stepId);
				const child = parseWorkflowNodeOutputV1(receipt.outputRefs);
				if (!definition || !child || child.nodeId !== `${output.nodeId}::step::${encodeURIComponent(stepId)}`) {
					throw new Error("workflow_nested_agent_repair_step_identity_invalid");
				}
				steps[stepId] = { ...receipt, outputRefs: walk({ ...definition.node,
					data: { ...definition.node.data }, id: child.nodeId }, child, owner) };
			}
			return { ...output, evidence: { ...output.evidence, pipelineState: { ...state, steps } } };
		}
		if (output.executorRef !== "agents.logical-task/v2" || node.data.workflowAgentOutputEncoding === "plain_text"
			|| output.evidence.executorCompleted === true) return output;
		const acceptedOutput = bindWorkflowAcceptedAuthorRecovery({ output: bindWorkflowAgentInitialRecovery({ output,
			sourceExecutionId: owner, sourceNodeRunId: input.sourceNodeRunId }), sourceExecutionId: owner,
			sourceNodeRunId: input.sourceNodeRunId });
		const sourceReceipt = workflowAgentRepairSource({ evidence: output.evidence,
			sourceExecutionId: owner, nodeId: output.nodeId });
		const retained = output.evidence.agentRepairSource;
		if (!sourceReceipt) {
			if (retained !== undefined) throw new Error("workflow_nested_agent_repair_retained_source_unverifiable");
			return acceptedOutput;
		}
		if (retained !== undefined && (!record(retained) || retained.sessionKey !== sourceReceipt.sessionKey
			|| retained.turnId !== sourceReceipt.turnId)) {
			throw new Error("workflow_nested_agent_repair_retained_source_identity_invalid");
		}
		return { ...acceptedOutput, evidence: { ...acceptedOutput.evidence,
			agentRepairSource: { ...(record(retained) ? retained : {}), ...sourceReceipt, sourceExecutionId: owner } } };
	};
	return walk(input.node, input.output, input.sourceExecutionId);
}
