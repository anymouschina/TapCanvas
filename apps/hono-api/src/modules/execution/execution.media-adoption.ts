import { z } from "zod";
import {
	parseWorkflowNodes,
	parseWorkflowNodeOutputV1,
	type WorkflowNodeOutputV1,
	type WorkflowNodeSnapshot,
} from "./execution.node-runtime";
import { findWorkflowNode, resolveWorkflowNodeExecutorRef } from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import {
	resolveWorkflowPipelineMediaTarget,
	workflowPipelineDownstreamStepIds,
	type WorkflowPipelineMediaTarget,
} from "./execution.pipeline-media-target";

/** An explicit reference amendment. The original output remains in its source run. */
export const WorkflowMediaAdoptionSchema = z.object({
	nodeId: z.string().trim().min(1),
	itemId: z.string().trim().min(1),
	assetId: z.string().trim().min(1),
}).strict();
export const WorkflowMediaAdoptionsSchema = z.array(WorkflowMediaAdoptionSchema).min(1)
	.superRefine((items, ctx) => {
		const targets = new Set<string>();
		items.forEach((item, index) => {
			const key = JSON.stringify([item.nodeId, item.itemId]);
			if (targets.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom,
				path: [index], message: "Each output item can adopt only one asset" });
			targets.add(key);
		});
	});
export type WorkflowMediaAdoption = z.infer<typeof WorkflowMediaAdoptionSchema>;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readWorkflowMediaAdoptions(root: unknown): readonly WorkflowMediaAdoption[] {
	if (!record(root) || root.workflowMediaAdoptions === undefined) return [];
	return WorkflowMediaAdoptionsSchema.parse(root.workflowMediaAdoptions);
}

export function workflowMediaAdoptionAssetId(root: unknown, runtimeNodeId: string): string | null {
	return readWorkflowMediaAdoptions(root).find((item) =>
		`${item.nodeId}::item::${encodeURIComponent(item.itemId)}` === runtimeNodeId)?.assetId ?? null;
}

type AdoptionTarget = Readonly<{
	ownerNodeId: string;
	output: WorkflowNodeOutputV1 | null;
	nested: WorkflowPipelineMediaTarget | null;
}>;

function resolveAdoptionTarget(input: Readonly<{
	nodeId: string;
	workflowNodes: readonly WorkflowNodeSnapshot[];
	outputs: readonly Readonly<{ nodeId: string; status?: string; outputRefs: unknown }>[];
}>): AdoptionTarget | null {
	const directNode = input.workflowNodes.find((node) => node.id === input.nodeId);
	if (directNode) {
		const directRun = input.outputs.find((run) => run.nodeId === input.nodeId);
		return { ownerNodeId: directNode.id, output: parseWorkflowNodeOutputV1(directRun?.outputRefs), nested: null };
	}
	const nested = resolveWorkflowPipelineMediaTarget({
		nodeId: input.nodeId,
		outputs: input.outputs.map((run) => ({ ...run, status: run.status ?? "unknown" })),
		workflowNodes: input.workflowNodes,
	});
	return nested ? { ownerNodeId: nested.ownerNodeId, output: nested.stepOutput, nested } : null;
}

function workflowOutputHasEffectReceipt(status: string, output: WorkflowNodeOutputV1 | null): boolean {
	if (["running", "waiting_external", "success"].includes(status)) return true;
	if (!output) return false;
	return output.artifacts.length > 0
		|| typeof output.evidence.taskId === "string"
		|| output.itemRuns.some((item) => item.artifacts.length > 0 || typeof item.evidence.taskId === "string");
}

function validateNestedWorkflowMediaAdoptionDescendants(target: WorkflowPipelineMediaTarget): void {
	for (const stepId of workflowPipelineDownstreamStepIds(target.spec, target.stepId)) {
		const step = target.spec.steps.find((candidate) => candidate.stepId === stepId);
		const receipt = target.state.steps[stepId];
		if (!step || !record(receipt) || receipt.status === "not_selected") continue;
		const executorRef = resolveWorkflowNodeExecutorRef(step.node);
		const semantics = executorRef ? resolveCoreWorkflowExecutorSemantics(executorRef) : null;
		if (!semantics) throw new Error(`media_adoption_executor_unknown:${stepId}`);
		if (semantics.sideEffect === "none") continue;
		const output = parseWorkflowNodeOutputV1(receipt.outputRefs);
		if (workflowOutputHasEffectReceipt(typeof receipt.status === "string" ? receipt.status : "unknown", output)) {
			throw new Error(`media_adoption_nested_downstream_receipt_exists:${stepId}`);
		}
	}
}

export function validateWorkflowMediaAdoptionDescendants(input: {
	root: Record<string, unknown>;
	adoptions: readonly Pick<WorkflowMediaAdoption, "nodeId">[];
	runs: readonly Readonly<{ nodeId: string; status: string; outputRefs: unknown }>[];
}): void {
	if (!Array.isArray(input.root.edges)) throw new Error("media_adoption_graph_missing");
	const workflowNodes = parseWorkflowNodes(input.root);
	const ownerIds = input.adoptions.map((adoption) => {
		const directNode = workflowNodes.find((node) => node.id === adoption.nodeId);
		if (directNode) return directNode.id;
		const target = resolveAdoptionTarget({ nodeId: adoption.nodeId, workflowNodes, outputs: input.runs });
		if (!target) throw new Error(`media_adoption_image_collection_required:${adoption.nodeId}`);
		if (target.nested) validateNestedWorkflowMediaAdoptionDescendants(target.nested);
		return target.ownerNodeId;
	});
	const roots = new Set(ownerIds);
	const affected = new Set(roots);
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of input.root.edges) {
			if (!record(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") throw new Error("media_adoption_edge_invalid");
			if (affected.has(edge.source) && !affected.has(edge.target)) { affected.add(edge.target); changed = true; }
		}
	}
	for (const run of input.runs) {
		if (!affected.has(run.nodeId) || roots.has(run.nodeId)) continue;
		const ref = resolveWorkflowNodeExecutorRef(findWorkflowNode(input.root, run.nodeId));
		const semantics = ref ? resolveCoreWorkflowExecutorSemantics(ref) : null;
		if (!semantics) throw new Error(`media_adoption_executor_unknown:${run.nodeId}`);
		if (semantics.sideEffect === "none" || ref === "agents.logical-task/v2") continue;
		const output = parseWorkflowNodeOutputV1(run.outputRefs);
		if (workflowOutputHasEffectReceipt(run.status, output)) {
			throw new Error(`media_adoption_downstream_receipt_exists:${run.nodeId}`);
		}
	}
}

export function validateWorkflowMediaAdoptionTargets(input: {
	adoptions: readonly WorkflowMediaAdoption[];
	outputs: readonly Readonly<{ nodeId: string; status?: string; outputRefs: unknown }>[];
	workflowDefinition: unknown;
}): string[] {
	const workflowNodes = parseWorkflowNodes(input.workflowDefinition);
	const ownerIds = new Set<string>();
	for (const adoption of input.adoptions) {
		const target = resolveAdoptionTarget({ nodeId: adoption.nodeId, workflowNodes, outputs: input.outputs });
		const output = target?.output;
		if (!output || output.executorRef !== "tapcanvas.image.generate/v1" || output.executionMode !== "each") {
			throw new Error(`media_adoption_image_collection_required:${adoption.nodeId}`);
		}
		const item = output.itemRuns.find((candidate) => candidate.itemId === adoption.itemId);
		if (!item) throw new Error(`media_adoption_item_missing:${adoption.itemId}`);
		if (item.status !== "success" && item.status !== "failed") {
			throw new Error(`media_adoption_item_unsettled:${adoption.itemId}`);
		}
		if (target.nested) validateNestedWorkflowMediaAdoptionDescendants(target.nested);
		if (target) ownerIds.add(target.ownerNodeId);
	}
	return [...ownerIds];
}

/** Remove only amended items from the *new* replay cursor, not stored history.
 * Every untouched receipt remains eligible for ordinary reconciliation.
 */
export function workflowMediaAdoptionCheckpoint(
	output: WorkflowNodeOutputV1,
	adoptions: readonly Pick<WorkflowMediaAdoption, "nodeId" | "itemId">[],
): WorkflowNodeOutputV1 {
	const ids = new Set(adoptions.filter((item) => item.nodeId === output.nodeId).map((item) => item.itemId));
	if (ids.size === 0) return output;
	const itemRuns = output.itemRuns.filter((item) => !ids.has(item.itemId));
	return { ...output, ports: {}, artifacts: itemRuns.flatMap((item) => item.artifacts), itemRuns,
		evidence: { executorCompleted: false, adoptedItemIds: [...ids],
			retainedItemCount: itemRuns.length, sourceEvidence: output.evidence } };
}

/** Invalidate one nested media item and only its side-effect-free pipeline consumers. */
export function workflowMediaAdoptionPipelineCheckpoint(input: Readonly<{
	node: WorkflowNodeSnapshot;
	output: WorkflowNodeOutputV1;
	adoptions: readonly Pick<WorkflowMediaAdoption, "nodeId" | "itemId">[];
}>): WorkflowNodeOutputV1 {
	const targets = input.adoptions.flatMap((adoption) => {
		const target = resolveWorkflowPipelineMediaTarget({
			nodeId: adoption.nodeId,
			outputs: [{ nodeId: input.output.nodeId, status: "failed", outputRefs: input.output }],
			workflowNodes: [input.node],
		});
		return target?.ownerNodeId === input.node.id ? [{ ...target, itemId: adoption.itemId }] : [];
	});
	if (targets.length === 0) return input.output;

	const groups = new Map<string, Map<string, { target: WorkflowPipelineMediaTarget; itemIds: Set<string> }>>();
	for (const target of targets) {
		const scope = groups.get(target.pipelineScopeId) ?? new Map<string, { target: WorkflowPipelineMediaTarget; itemIds: Set<string> }>();
		const step = scope.get(target.stepId) ?? { target, itemIds: new Set<string>() };
		step.itemIds.add(target.itemId);
		scope.set(target.stepId, step);
		groups.set(target.pipelineScopeId, scope);
	}

	const updateState = (rawState: unknown, scopeId: string): Record<string, unknown> => {
		if (!record(rawState) || rawState.protocolVersion !== "workflow.pipeline.state/v1" || !record(rawState.steps)) {
			throw new Error(`media_adoption_pipeline_state_missing:${scopeId}`);
		}
		const nextSteps: Record<string, unknown> = { ...rawState.steps };
		const scopeTargets = groups.get(scopeId);
		if (!scopeTargets) return rawState;
		for (const [stepId, group] of scopeTargets) {
			const receipt = nextSteps[stepId];
			if (!record(receipt)) throw new Error(`media_adoption_pipeline_step_missing:${stepId}`);
			const stageOutput = parseWorkflowNodeOutputV1(receipt.outputRefs);
			if (!stageOutput || stageOutput.nodeId !== group.target.stepOutput.nodeId) {
				throw new Error(`media_adoption_pipeline_output_missing:${stepId}`);
			}
			const removed = stageOutput.itemRuns.filter((item) => group.itemIds.has(item.itemId));
			if (removed.length !== group.itemIds.size) throw new Error(`media_adoption_item_missing:${[...group.itemIds].join(",")}`);
			const retained = stageOutput.itemRuns.filter((item) => !group.itemIds.has(item.itemId));
			const checkpointOutput: WorkflowNodeOutputV1 = {
				...stageOutput,
				ports: {},
				artifacts: retained.flatMap((item) => item.artifacts),
				itemRuns: retained,
				evidence: {
					...stageOutput.evidence,
					executorCompleted: false,
					mediaAdoptionCheckpoint: {
						protocolVersion: "workflow.media-adoption-checkpoint/v1",
						adoptedItemIds: [...group.itemIds],
					},
				},
			};
			nextSteps[stepId] = {
				status: "failed",
				outputRefs: checkpointOutput,
				errorCode: "workflow_media_adoption_checkpoint",
			};
			for (const downstreamId of workflowPipelineDownstreamStepIds(group.target.spec, stepId)) {
				if (scopeTargets.has(downstreamId)) continue;
				const priorDownstream = nextSteps[downstreamId];
				if (record(priorDownstream) && priorDownstream.status === "not_selected") {
					delete nextSteps[downstreamId];
					continue;
				}
				const downstream = group.target.spec.steps.find((candidate) => candidate.stepId === downstreamId);
				const ref = downstream ? resolveWorkflowNodeExecutorRef(downstream.node) : null;
				const semantics = ref ? resolveCoreWorkflowExecutorSemantics(ref) : null;
				if (semantics?.sideEffect === "none") delete nextSteps[downstreamId];
			}
		}
		const firstStepId = [...scopeTargets.keys()][0];
		return { ...rawState, cursorStepId: firstStepId ?? rawState.cursorStepId, steps: nextSteps };
	};

	if (input.output.executionMode === "each") {
		let changed = false;
		const itemRuns = input.output.itemRuns.map((item) => {
			if (!groups.has(item.runtimeNodeId)) return item;
			changed = true;
			return { ...item, evidence: { ...item.evidence, pipelineState: updateState(item.evidence.pipelineState, item.runtimeNodeId) } };
		});
		if (!changed) throw new Error(`media_adoption_pipeline_item_missing:${[...groups.keys()].join(",")}`);
		return { ...input.output, itemRuns };
	}
	return { ...input.output, evidence: { ...input.output.evidence,
		pipelineState: updateState(input.output.evidence.pipelineState, input.node.id) } };
}
