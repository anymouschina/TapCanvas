import { parseWorkflowInitiatingAgentExecution } from "./execution.agent-model-inheritance";
import type { MaterialAssetDto } from "../material/material.schemas";
import {
	parseWorkflowProjectContext, parseWorkflowCallerCanvasSnapshot, projectAssetSnapshot,
	type WorkflowProjectContext, type WorkflowCallerCanvasSnapshot,
} from "./execution.project-context";

export class WorkflowReplayInvocationError extends Error {
	constructor(message: string, public readonly status: 400 | 404 | 409 = 409) {
		super(message); this.name = "WorkflowReplayInvocationError";
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Invocation facts belong to the named receipt; graph definition and run control belong to this request. */
const FROZEN_INVOCATION_FIELDS = [
	"workflowProjectContext", "workflowDeliveryScope", "workflowDirectAgentModelSelection",
	"workflowInitiatingAgentExecution", "workflowCallerCanvasSnapshot", "workflowSourceSnapshots",
	"workflowExecutionAncestry",
] as const;

export type WorkflowReplayInvocation = Readonly<{
	flowData: Record<string, unknown>;
	frozenInvocationFacts: Record<string, unknown>;
	projectContext?: WorkflowProjectContext;
	callerCanvasSnapshot?: WorkflowCallerCanvasSnapshot;
	triggerPayload?: unknown;
}>;

/** Explicitly named visible IDs may extend the asset directory; canonical source and selections never change. */
export function refreshWorkflowReplayAssetDirectory(input: Readonly<{
	context: WorkflowProjectContext; assetIds: readonly string[];
	visibleAssets: readonly MaterialAssetDto[]; capturedAt: string;
}>): WorkflowProjectContext {
	if (input.assetIds.length === 0) return input.context;
	const ids = new Set(input.assetIds);
	const selected = [...ids].map(id => {
		const matches = input.visibleAssets.filter(asset => asset.id === id && asset.projectId === input.context.projectId);
		if (matches.length !== 1) throw new WorkflowReplayInvocationError(`workflow_replay_asset_not_visible:${id}`);
		return projectAssetSnapshot(matches[0]);
	});
	return { ...input.context,
		projectAssetIds: [...new Set([...input.context.projectAssetIds, ...ids])],
		assetSnapshot: [...input.context.assetSnapshot.filter(asset => !ids.has(asset.assetId)), ...selected],
		mediaUnderstanding: input.context.mediaUnderstanding?.filter(item => !ids.has(item.referenceId)),
		mediaUnderstandingDiagnostics: input.context.mediaUnderstandingDiagnostics?.filter(item => item.referenceId === null || !ids.has(item.referenceId)),
		capturedAt: input.capturedAt,
	};
}

export function projectWorkflowReplayInvocation(input: Readonly<{
	liveFlowData: unknown; sourceSnapshot: unknown;
	sourceExecutionId: string; sourceFlowVersionId: string;
	triggerNodeId: string; startFromNodeId: string; stopAfterNodeId: string;
	refreshAssetIds?: readonly string[]; visibleAssets?: readonly MaterialAssetDto[]; capturedAt: string;
}>): WorkflowReplayInvocation {
	const live: unknown = typeof input.liveFlowData === "string" ? JSON.parse(input.liveFlowData) : input.liveFlowData;
	const source = input.sourceSnapshot;
	if (!record(live) || !Array.isArray(live.nodes) || !Array.isArray(live.edges)
		|| !record(source) || !Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
		throw new WorkflowReplayInvocationError("workflow_replay_graph_invalid", 400);
	}
	if (!record(source.workflowExecutionScope) || source.workflowExecutionScope.triggerNodeId !== input.triggerNodeId) {
		throw new WorkflowReplayInvocationError("workflow_replay_trigger_identity_mismatch");
	}
	const sourceTrigger = source.nodes.find(node => record(node) && node.id === input.triggerNodeId);
	if (!record(sourceTrigger) || !record(sourceTrigger.data)) throw new WorkflowReplayInvocationError("workflow_replay_trigger_missing");
	if (source.workflowDeliveryScope !== undefined) {
		const scope = source.workflowDeliveryScope;
		if (!record(scope) || typeof scope.flowId !== "string" || !scope.flowId.trim()
			|| (scope.projectId !== null && (typeof scope.projectId !== "string" || !scope.projectId.trim()))) {
			throw new WorkflowReplayInvocationError("workflow_replay_delivery_scope_invalid");
		}
	}
	if (source.workflowInitiatingAgentExecution !== undefined && !parseWorkflowInitiatingAgentExecution(source)) {
		throw new WorkflowReplayInvocationError("workflow_replay_model_identity_invalid");
	}
	if (source.workflowDirectAgentModelSelection !== undefined) {
		const model = source.workflowDirectAgentModelSelection;
		if (!record(model) || typeof model.model !== "string" || !model.model.trim()) {
			throw new WorkflowReplayInvocationError("workflow_replay_model_identity_invalid");
		}
	}
	const projectContext = parseWorkflowProjectContext(source.workflowProjectContext);
	if (source.workflowProjectContext !== undefined && !projectContext) throw new WorkflowReplayInvocationError("workflow_replay_project_context_invalid");
	if (projectContext && record(source.workflowDeliveryScope) && source.workflowDeliveryScope.projectId !== projectContext.projectId) throw new WorkflowReplayInvocationError("workflow_replay_delivery_context_mismatch");
	const callerCanvasSnapshot = parseWorkflowCallerCanvasSnapshot(source.workflowCallerCanvasSnapshot);
	if (source.workflowCallerCanvasSnapshot !== undefined && !callerCanvasSnapshot) throw new WorkflowReplayInvocationError("workflow_replay_caller_snapshot_invalid");
	const refreshAssetIds = [...new Set(input.refreshAssetIds ?? [])];
	if (refreshAssetIds.length && !projectContext) throw new WorkflowReplayInvocationError("workflow_replay_asset_context_missing");
	const refreshed = projectContext ? refreshWorkflowReplayAssetDirectory({ context: projectContext, assetIds: refreshAssetIds,
		visibleAssets: input.visibleAssets ?? [], capturedAt: input.capturedAt }) : null;
	const facts: Record<string, unknown> = Object.fromEntries(FROZEN_INVOCATION_FIELDS.flatMap(key =>
		source[key] === undefined ? [] : [[key, structuredClone(source[key])]]));
	if (refreshed) facts.workflowProjectContext = refreshed;
	facts.workflowReplayInvocation = { version: 1, sourceExecutionId: input.sourceExecutionId,
		sourceFlowVersionId: input.sourceFlowVersionId, triggerNodeId: input.triggerNodeId,
		startFromNodeId: input.startFromNodeId, stopAfterNodeId: input.stopAfterNodeId,
		refreshAssetIds, capturedAt: input.capturedAt };
	const triggerPayload = sourceTrigger.data.workflowTriggerPayload;
	const cleanLive = { ...live };
	for (const key of FROZEN_INVOCATION_FIELDS) delete cleanLive[key];
	delete cleanLive.workflowResolvedAuthorRepair;
	delete cleanLive.workflowAuthorRepairAttempt;
	delete cleanLive.workflowReplayInvocation;
	delete cleanLive.workflowReplayAttempt;
	const nodes = live.nodes.map(node => {
		if (!record(node) || node.id !== input.triggerNodeId || !record(node.data)) return node;
		const { workflowTriggerPayload: _livePayload, ...definition } = node.data;
		return { ...node, data: { ...definition, ...(triggerPayload === undefined ? {} : { workflowTriggerPayload: structuredClone(triggerPayload) }) } };
	});
	return { flowData: { ...cleanLive, ...facts, nodes }, frozenInvocationFacts: facts,
		...(refreshed ? { projectContext: refreshed } : {}),
		...(callerCanvasSnapshot ? { callerCanvasSnapshot } : {}),
		...(triggerPayload === undefined ? {} : { triggerPayload: structuredClone(triggerPayload) }) };
}
