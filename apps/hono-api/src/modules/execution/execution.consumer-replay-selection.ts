import { z } from "zod";
import { parseWorkflowPipelineRunSpec, parseWorkflowExecutionSemanticsV2 } from "@tapcanvas/workflow-kernel-protocol";
import { WorkflowAuthorRepairTargetPathSchema, resolveWorkflowAuthorRepairTarget, type WorkflowAuthorRepairSelection } from "./execution.author-repair-target";
import { workflowAuthorDeliveryArtifact, workflowAuthorDeliveryHash } from "./execution.author-repair";
import { parseWorkflowNodeOutputV1, resolveWorkflowNodeExecutorRef, type WorkflowNodeOutputV1, type WorkflowNodeSnapshot } from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";

export const WorkflowConsumerReplaySelectionRequestSchema = z.object({ version: z.literal(1),
	sourceNodeRunId: z.string().min(1), idempotencyKey: z.string().min(1),
	targetPath: WorkflowAuthorRepairTargetPathSchema, deliveryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	startStepId: z.string().min(1), stopStepId: z.string().min(1),
}).strict();
export type WorkflowConsumerReplaySelectionRequest = Readonly<z.infer<typeof WorkflowConsumerReplaySelectionRequestSchema>>;
export function workflowConsumerReplaySelectionAttempt(request: WorkflowConsumerReplaySelectionRequest, sourceExecutionId: string, rootNodeId: string) {
	return { version: 1 as const, idempotencyKey: request.idempotencyKey,
		requestHash: workflowAuthorDeliveryHash(JSON.stringify({ sourceExecutionId, rootNodeId, request: WorkflowConsumerReplaySelectionRequestSchema.parse(request) })) };
}
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Select deterministic consumers of exactly one delivered author; all effects outside this scope remain history. */
export function resolveWorkflowConsumerReplaySelection(input: Readonly<{ node: WorkflowNodeSnapshot; output: WorkflowNodeOutputV1;
	request: WorkflowConsumerReplaySelectionRequest; sourceExecutionId: string; flowData: Record<string, unknown> }>):
	Readonly<{ selection: WorkflowAuthorRepairSelection; checkpoint: WorkflowNodeOutputV1 }> {
	const target = resolveWorkflowAuthorRepairTarget(input.node, input.output, input.request.targetPath);
	if (workflowAuthorDeliveryHash(workflowAuthorDeliveryArtifact(target.output)) !== input.request.deliveryHash) {
		throw new Error("workflow_consumer_replay_delivery_hash_mismatch");
	}
	let stepIndex = -1;
	target.route.forEach((segment, index) => { if (segment.kind === "step") stepIndex = index; });
	const authorStep = target.route[stepIndex];
	if (!authorStep || authorStep.kind !== "step") throw new Error("workflow_consumer_replay_pipeline_scope_missing");
	let currentNode = input.node;
	let current = structuredClone(input.output);
	const checkpoint = current;
	for (const segment of target.route.slice(0, stepIndex)) {
		current.evidence.executorCompleted = false;
		if (segment.kind === "item") {
			const item = current.itemRuns.find(candidate => candidate.itemId === segment.itemId);
			if (!item) throw new Error("workflow_consumer_replay_item_missing");
			Object.assign(item, { status: "waiting_external" });
			current = { ...current, nodeId: item.runtimeNodeId, executionMode: "once", evidence: item.evidence, itemRuns: [], ports: item.ports, artifacts: item.artifacts };
			currentNode = { ...currentNode, id: current.nodeId };
		} else {
			const spec = parseWorkflowPipelineRunSpec(currentNode.data.workflowPipeline);
			const step = spec.steps.find(candidate => candidate.stepId === segment.stepId);
			const state = current.evidence.pipelineState;
			const receipt = record(state) && record(state.steps) ? state.steps[segment.stepId] : null;
			const next = record(receipt) ? parseWorkflowNodeOutputV1(receipt.outputRefs) : null;
			if (!step || !record(receipt) || !next) throw new Error("workflow_consumer_replay_step_missing");
			receipt.status = "waiting_external"; receipt.outputRefs = next;
			current = next; currentNode = { ...step.node, id: current.nodeId };
		}
	}
	const spec = parseWorkflowPipelineRunSpec(currentNode.data.workflowPipeline);
	const descendants = (from: string) => {
		const found = new Set([from]); let changed = true;
		while (changed) { changed = false; for (const binding of spec.bindings) if (binding.from.kind === "step"
			&& found.has(binding.from.stepId) && !found.has(binding.to.stepId)) { found.add(binding.to.stepId); changed = true; } }
		return found;
	};
	const reachable = descendants(input.request.startStepId);
	if (!descendants(authorStep.stepId).has(input.request.startStepId) || input.request.startStepId === authorStep.stepId
		|| !reachable.has(input.request.stopStepId)) throw new Error("workflow_consumer_replay_range_invalid");
	const stepIds = spec.steps.filter(step => reachable.has(step.stepId) && descendants(step.stepId).has(input.request.stopStepId)).map(step => step.stepId);
	if (!stepIds.includes(input.request.startStepId) || !stepIds.includes(input.request.stopStepId)) throw new Error("workflow_consumer_replay_range_invalid");
	const verifyConsumer = (node: WorkflowNodeSnapshot): void => {
		const executorRef = resolveWorkflowNodeExecutorRef(node);
		const metadata = input.flowData.workflowExecutionSemantics;
		const frozen = record(metadata) && record(metadata.nodes) ? metadata.nodes[node.id] : null;
		if (record(frozen) && frozen.executorRef !== executorRef) throw new Error("workflow_consumer_replay_frozen_semantics_mismatch");
		const semantics = record(frozen) ? parseWorkflowExecutionSemanticsV2(frozen.semantics) : executorRef ? resolveCoreWorkflowExecutorSemantics(executorRef) : null;
		if (!semantics || semantics.sideEffect !== "none" || semantics.retrySafety !== "safe" || semantics.recoveryMode !== "replay") {
			throw new Error(`workflow_consumer_replay_step_effect_not_authorized:${node.id}`);
		}
		if (executorRef === "workflow.pipeline.run/v1") {
			for (const child of parseWorkflowPipelineRunSpec(node.data.workflowPipeline).steps) verifyConsumer(child.node);
		}
	};
	for (const stepId of stepIds) verifyConsumer(spec.steps.find(candidate => candidate.stepId === stepId)!.node);
	const state = current.evidence.pipelineState;
	if (!record(state) || !record(state.steps)) throw new Error("workflow_consumer_replay_state_missing");
	for (const stepId of stepIds) delete state.steps[stepId];
	current.evidence.executorCompleted = false;
	const stop = spec.steps.find(step => step.stepId === input.request.stopStepId)!;
	return { checkpoint, selection: { version: 1, mode: "consumer_replay", rootNodeId: input.node.id,
		sourceExecutionId: input.sourceExecutionId, sourceNodeRunId: input.request.sourceNodeRunId,
		targetNodeId: target.node.id, deliveryHash: input.request.deliveryHash, route: target.route, inputLineage: [...target.inputLineage],
		consumer: { pipelineNodeId: current.nodeId, startStepId: input.request.startStepId, stopStepId: input.request.stopStepId, stepIds },
		deliveryExecutorRef: resolveWorkflowNodeExecutorRef(stop.node)!,
	} };
}
