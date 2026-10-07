import { parseWorkflowPipelineRunSpec, type WorkflowPipelineRunSpecV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	parseWorkflowNodeOutputV1,
	resolveWorkflowNodeExecutionMode,
	resolveWorkflowNodeExecutorRef,
	type WorkflowNodeOutputV1,
	type WorkflowNodeSnapshot,
} from "./execution.node-runtime";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

type PipelineState = RecordValue & Readonly<{ steps: RecordValue }>;

function pipelineState(value: unknown): PipelineState | null {
	if (!isRecord(value) || value.protocolVersion !== "workflow.pipeline.state/v1" || !isRecord(value.steps)) return null;
	return { ...value, steps: value.steps };
}

export type WorkflowPipelineMediaTarget = Readonly<{
	ownerNodeId: string;
	ownerRunStatus: string;
	ownerOutput: WorkflowNodeOutputV1;
	pipelineScopeId: string;
	pipelineItemId: string | null;
	spec: WorkflowPipelineRunSpecV1;
	state: PipelineState;
	stepId: string;
	stepReceipt: RecordValue;
	stepOutput: WorkflowNodeOutputV1;
	stepStatus: string | null;
	stepNode: WorkflowNodeSnapshot;
}>;

/** Resolve one exact inline-pipeline step receipt by its persisted runtime node id. */
export function resolveWorkflowPipelineMediaTarget(input: Readonly<{
	nodeId: string;
	outputs: readonly Readonly<{ nodeId: string; status: string; outputRefs: unknown }>[];
	workflowNodes: readonly WorkflowNodeSnapshot[];
}>): WorkflowPipelineMediaTarget | null {
	const matches: WorkflowPipelineMediaTarget[] = [];
	for (const run of input.outputs) {
		const ownerNode = input.workflowNodes.find((candidate) => candidate.id === run.nodeId);
		const ownerOutput = parseWorkflowNodeOutputV1(run.outputRefs);
		if (!ownerNode || !ownerOutput || ownerOutput.executorRef !== "workflow.pipeline.run/v1") continue;
		if (!isRecord(ownerNode.data) || ownerOutput.executionMode !== resolveWorkflowNodeExecutionMode(ownerNode)) continue;
		const scopes = ownerOutput.executionMode === "each"
			? ownerOutput.itemRuns.map((item) => ({
				scopeId: item.runtimeNodeId,
				itemId: item.itemId,
				state: pipelineState(item.evidence.pipelineState),
			}))
			: [{
				scopeId: ownerNode.id,
				itemId: null,
				state: pipelineState(ownerOutput.evidence.pipelineState),
			}];
		for (const scope of scopes) {
			if (!scope.state) continue;
			const prefix = `${scope.scopeId}::step::`;
			if (!input.nodeId.startsWith(prefix)) continue;
			const spec = parseWorkflowPipelineRunSpec(ownerNode.data.workflowPipeline);
			const encodedStepId = input.nodeId.slice(prefix.length);
			const step = spec.steps.find((candidate) => encodeURIComponent(candidate.stepId) === encodedStepId);
			if (!step || !isRecord(scope.state.steps)) continue;
			const receipt = scope.state.steps[step.stepId];
			if (!isRecord(receipt)) continue;
			const stepOutput = parseWorkflowNodeOutputV1(receipt.outputRefs);
			if (!stepOutput || stepOutput.nodeId !== input.nodeId) continue;
			matches.push({
				ownerNodeId: ownerNode.id,
				ownerRunStatus: run.status,
				ownerOutput,
				pipelineScopeId: scope.scopeId,
				pipelineItemId: scope.itemId,
				spec,
				state: scope.state,
				stepId: step.stepId,
				stepReceipt: receipt,
				stepOutput,
				stepStatus: typeof receipt.status === "string" ? receipt.status : null,
				stepNode: step.node,
			});
		}
	}
	if (matches.length > 1) throw new Error(`workflow_pipeline_media_target_ambiguous:${input.nodeId}`);
	return matches[0] ?? null;
}

export function workflowPipelineDownstreamStepIds(
	spec: WorkflowPipelineRunSpecV1,
	stepId: string,
): ReadonlySet<string> {
	const downstream = new Set<string>();
	const pending = [stepId];
	while (pending.length > 0) {
		const current = pending.shift();
		if (!current) continue;
		for (const binding of spec.bindings) {
			if (binding.from.kind !== "step" || binding.from.stepId !== current || downstream.has(binding.to.stepId)) continue;
			downstream.add(binding.to.stepId);
			pending.push(binding.to.stepId);
		}
	}
	return downstream;
}
