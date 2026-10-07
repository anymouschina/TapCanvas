import { z } from "zod";
import { parseWorkflowPipelineRunSpec, createWorkflowCollection, isWorkflowCollection, type WorkflowItemLineageV1 } from "@tapcanvas/workflow-kernel-protocol";
import { normalizeAuthorRevisionEvidence } from "../../../../../packages/schemas/author-revision-evidence/index.cjs";
import { parseWorkflowNodeOutputV1, resolveWorkflowNodeExecutionMode, resolveWorkflowNodeExecutorRef, type WorkflowNodeItemRunV1,
	type WorkflowNodeOutputV1, type WorkflowNodeSnapshot } from "./execution.node-runtime";

const segmentSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("item"), itemId: z.string().min(1) }).strict(),
	z.object({ kind: z.literal("step"), stepId: z.string().min(1) }).strict(),
]);
export const WorkflowAuthorRepairTargetPathSchema = z.array(segmentSchema).min(1);
export type WorkflowAuthorRepairTargetSegment = Readonly<z.infer<typeof segmentSchema>>;
const routeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("item"), itemId: z.string().min(1), nodeId: z.string().min(1) }).strict(),
	z.object({ kind: z.literal("step"), stepId: z.string().min(1), nodeId: z.string().min(1) }).strict(),
]);
const selectionSchema = z.object({ version: z.literal(1), mode: z.enum(["author_revision", "consumer_replay"]), rootNodeId: z.string().min(1),
	sourceExecutionId: z.string().min(1), sourceNodeRunId: z.string().min(1), targetNodeId: z.string().min(1),
	deliveryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), route: z.array(routeSchema).min(1), deliveryExecutorRef: z.string().min(1),
	inputLineage: z.array(z.object({ nodeId: z.string(), portId: z.string(), itemId: z.string(), index: z.number().int().nonnegative() }).strict()),
	consumer: z.object({ pipelineNodeId: z.string().min(1), startStepId: z.string().min(1), stopStepId: z.string().min(1), stepIds: z.array(z.string().min(1)).min(1) }).strict().optional(),
}).strict().refine(value => (value.mode === "consumer_replay") === Boolean(value.consumer));
export type WorkflowAuthorRepairSelection = Readonly<z.infer<typeof selectionSchema>>;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Traverse exact frozen definitions and receipts; never parse opaque item IDs from a virtual ID. */
export function resolveWorkflowAuthorRepairTarget(node: WorkflowNodeSnapshot, output: WorkflowNodeOutputV1,
	path: readonly WorkflowAuthorRepairTargetSegment[]): Readonly<{
	node: WorkflowNodeSnapshot; output: WorkflowNodeOutputV1; route: WorkflowAuthorRepairSelection["route"];
	inputLineage: readonly WorkflowItemLineageV1[];
	checkpoint: WorkflowNodeOutputV1;
}> {
	const route: WorkflowAuthorRepairSelection["route"] = [];
	let targetNode = node;
	let targetOutput = output;
	let inputLineage: readonly WorkflowItemLineageV1[] = [];
	const walk = (currentNode: WorkflowNodeSnapshot, current: WorkflowNodeOutputV1, index: number): WorkflowNodeOutputV1 | null => {
		if (current.nodeId !== currentNode.id || current.executorRef !== resolveWorkflowNodeExecutorRef(currentNode)) {
			throw new Error("workflow_author_repair_target_receipt_identity_invalid");
		}
		if (index === path.length) {
			if (current.executionMode !== "once" || current.executorRef !== "agents.logical-task/v2"
				|| current.evidence.executorCompleted !== true) throw new Error("workflow_author_repair_target_not_successful_author");
			targetNode = currentNode; targetOutput = current;
			return null;
		}
		const segment = path[index];
		if (segment.kind === "item") {
			if (current.executionMode !== "each" || resolveWorkflowNodeExecutionMode(currentNode) !== "each") {
				throw new Error("workflow_author_repair_target_item_contract_invalid");
			}
			const matches = current.itemRuns.filter(item => item.itemId === segment.itemId);
			if (matches.length !== 1 || (index + 1 === path.length && matches[0].status !== "success")) throw new Error("workflow_author_repair_target_item_not_successful");
			const item = matches[0];
			inputLineage = item.lineage;
			if (item.runtimeNodeId !== `${current.nodeId}::item::${encodeURIComponent(item.itemId)}`) {
				throw new Error("workflow_author_repair_target_item_identity_invalid");
			}
			route.push({ ...segment, nodeId: current.nodeId });
			const child = walk({ ...currentNode, id: item.runtimeNodeId }, { ...current, nodeId: item.runtimeNodeId,
				executionMode: "once", ports: item.ports, artifacts: item.artifacts, evidence: item.evidence, itemRuns: [] }, index + 1);
			return { ...current, ports: {}, evidence: { ...current.evidence, executorCompleted: false },
				itemRuns: current.itemRuns.flatMap(previous => previous !== item ? [previous] : child ? [{ ...item,
					status: "waiting_external" as const, evidence: child.evidence, ports: child.ports, artifacts: child.artifacts }] : []) };
		}
		if (current.executorRef !== "workflow.pipeline.run/v1" || current.executionMode !== "once") {
			throw new Error("workflow_author_repair_target_step_contract_invalid");
		}
		const spec = parseWorkflowPipelineRunSpec(currentNode.data.workflowPipeline);
		const step = spec.steps.find(candidate => candidate.stepId === segment.stepId);
		const state = current.evidence.pipelineState;
		const steps = record(state) && state.protocolVersion === "workflow.pipeline.state/v1" && record(state.steps) ? state.steps : null;
		const receipt = steps?.[segment.stepId];
		const childOutput = record(receipt) ? parseWorkflowNodeOutputV1(receipt.outputRefs) : null;
		if (!step || !record(receipt) || (index + 1 === path.length && receipt.status !== "success") || !childOutput
			|| childOutput.nodeId !== `${current.nodeId}::step::${encodeURIComponent(segment.stepId)}`) {
			throw new Error("workflow_author_repair_target_step_not_successful");
		}
		route.push({ ...segment, nodeId: current.nodeId });
		const child = walk({ ...step.node, id: childOutput.nodeId }, childOutput, index + 1);
		const retainedSteps = { ...steps };
		if (child) retainedSteps[segment.stepId] = { ...receipt, status: "waiting_external", outputRefs: child };
		else delete retainedSteps[segment.stepId];
		return { ...current, evidence: { ...current.evidence, executorCompleted: false,
			pipelineState: { ...state as Record<string, unknown>, steps: retainedSteps } } };
	};
	const checkpoint = walk(node, output, 0);
	if (!checkpoint) throw new Error("workflow_author_repair_target_path_empty");
	return { node: targetNode, output: targetOutput, route, checkpoint, inputLineage };
}

/** Runtime restriction is bound to the same verified eight-field author evidence. */
export function readWorkflowAuthorRepairSelection(flowData: unknown): WorkflowAuthorRepairSelection | null {
	if (!record(flowData) || flowData.workflowAuthorRepairSelection === undefined) return null;
	const selection = selectionSchema.parse(flowData.workflowAuthorRepairSelection);
	const receipt = selection.mode === "author_revision" ? normalizeAuthorRevisionEvidence(flowData.workflowResolvedAuthorRepair) : null;
	if (selection.mode === "author_revision" && (!receipt || receipt.sourceExecutionId !== selection.sourceExecutionId || receipt.sourceNodeRunId !== selection.sourceNodeRunId
		|| receipt.targetNodeId !== selection.targetNodeId || receipt.deliveryHash !== selection.deliveryHash)) {
		throw new Error("workflow_author_repair_selection_receipt_mismatch");
	}
	return selection;
}

export function workflowAuthorRepairRouteAt(flowData: unknown, nodeId: string) {
	return readWorkflowAuthorRepairSelection(flowData)?.route.find(segment => segment.nodeId === nodeId) ?? null;
}

export function workflowConsumerReplayStepsAt(flowData: unknown, nodeId: string): readonly string[] | null {
	const consumer = readWorkflowAuthorRepairSelection(flowData)?.consumer;
	return consumer?.pipelineNodeId === nodeId ? consumer.stepIds : null;
}

export function workflowConsumerReplayStepPorts(flowData: unknown, pipelineNodeId: string, stepId: string, output: WorkflowNodeOutputV1): WorkflowNodeOutputV1["ports"] {
	const selection = readWorkflowAuthorRepairSelection(flowData);
	if (!selection?.consumer || selection.consumer.pipelineNodeId !== pipelineNodeId) return output.ports;
	const index = selection.route.findIndex(segment => segment.nodeId === pipelineNodeId);
	const author = selection.route[index];
	if (!author || author.kind !== "step" || author.stepId !== stepId) return output.ports;
	const itemSegment = selection.route[index + 1];
	if (!itemSegment || itemSegment.kind !== "item") return output.ports;
	const item = output.itemRuns.find(candidate => candidate.itemId === itemSegment.itemId);
	if (!item || item.status !== "success") throw new Error("workflow_consumer_replay_author_item_missing");
	return Object.fromEntries(Object.entries(item.ports).map(([portId, value]) => [portId, createWorkflowCollection({
		collectionId: `${output.nodeId}:${portId}:selected`, producerNodeId: output.nodeId, producerPortId: portId,
		itemIds: [item.itemId], values: [value], parentLineage: [item.lineage],
	})]));
}

export function workflowConsumerReplayInputValue(flowData: unknown, pipelineNodeId: string, value: unknown): unknown {
	const selection = readWorkflowAuthorRepairSelection(flowData);
	if (selection?.consumer?.pipelineNodeId !== pipelineNodeId || !isWorkflowCollection(value)) return value;
	const selected = value.items.filter(item => {
		// createWorkflowCollection appends its own producer origin after all ancestor provenance.
		const origin = item.lineage.at(-1);
		return origin && selection.inputLineage.some(target => origin.nodeId === target.nodeId && origin.portId === target.portId
			&& origin.itemId === target.itemId && origin.index === target.index);
	});
	const hasRecordedProducer = value.items.some(item => {
		const origin = item.lineage.at(-1);
		return origin && selection.inputLineage.some(target => origin.nodeId === target.nodeId && origin.portId === target.portId);
	});
	if (hasRecordedProducer && selected.length === 0) throw new Error("workflow_consumer_replay_input_target_missing");
	// Collections with no recorded producer contribution are shared frozen inputs.
	return selected.length > 0 ? { ...value, items: selected.map((item, index) => ({ ...item, index })) } : value;
}

/** Ancestors carry history, while this attempt delivers only the selected author's new output. */
export function projectWorkflowAuthorRepairOutput(flowData: unknown, output: WorkflowNodeOutputV1): WorkflowNodeOutputV1 {
	const selection = readWorkflowAuthorRepairSelection(flowData);
	const offset = selection?.route.findIndex(segment => segment.nodeId === output.nodeId) ?? -1;
	if (!selection || offset < 0) return output;
	const deliveryRoute = [...selection.route];
	if (selection.consumer) {
		const index = deliveryRoute.findIndex(segment => segment.nodeId === selection.consumer?.pipelineNodeId);
		deliveryRoute.splice(index, deliveryRoute.length - index, { kind: "step", nodeId: selection.consumer.pipelineNodeId, stepId: selection.consumer.stopStepId });
	}
	const deliveryNodeId = selection.consumer ? `${selection.consumer.pipelineNodeId}::step::${encodeURIComponent(selection.consumer.stopStepId)}` : selection.targetNodeId;
	let current: WorkflowNodeOutputV1 | null = output;
	let status: "success" | "failed" | "waiting_external" = "success";
	for (const segment of deliveryRoute.slice(offset)) {
		if (!current || current.nodeId !== segment.nodeId) { current = null; break; }
		if (segment.kind === "item") {
			const item: WorkflowNodeItemRunV1 | undefined = current.itemRuns.find(candidate => candidate.itemId === segment.itemId);
			if (!item) { current = null; break; }
			if (item.status !== "success" && status !== "failed") status = item.status;
			current = { ...current, nodeId: item.runtimeNodeId, executionMode: "once", ports: item.ports,
				artifacts: item.artifacts, evidence: item.evidence, itemRuns: [] };
		} else {
			const state = current.evidence.pipelineState;
			const receipt: unknown = record(state) && record(state.steps) ? state.steps[segment.stepId] : undefined;
			if (record(receipt) && receipt.status !== "success" && status !== "failed") status = receipt.status === "failed" ? "failed" : "waiting_external";
			current = record(receipt) ? parseWorkflowNodeOutputV1(receipt.outputRefs) : null;
		}
	}
	const { providerReceiptRefs: _historicalProviders, canvasNodeId: _historicalCanvas,
		authorRepairDelivery: _previousDelivery, ...evidence } = output.evidence;
	return { ...output, ports: {}, artifacts: [], evidence: { ...evidence,
		authorRepairDelivery: { version: 1, sourceExecutionId: selection.sourceExecutionId,
			sourceNodeRunId: selection.sourceNodeRunId, sourceDeliveryHash: selection.deliveryHash,
			mode: selection.mode, expectedDelivery: { executorRef: selection.deliveryExecutorRef, nodeId: deliveryNodeId },
			...(current && current.nodeId === deliveryNodeId
				? { deliveryEvidence: { status, outputRefs: current } } : {}),
		} } };
}
