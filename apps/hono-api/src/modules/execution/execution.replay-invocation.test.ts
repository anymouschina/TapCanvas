import { describe, expect, it } from "vitest";
import { projectWorkflowReplayInvocation, refreshWorkflowReplayAssetDirectory } from "./execution.replay-invocation";
import { createWorkflowProjectContext } from "./execution.project-context";
import { RunFlowExecutionRequestSchema } from "./execution.schemas";
import type { MaterialAssetDto } from "../material/material.schemas";

function asset(id: string, version = 1, projectId = "project"): MaterialAssetDto {
	return { id, projectId, teamId: null, folderId: null, scope: "project", kind: "scene", name: id,
		favorite: false, currentVersion: version, createdAt: "2026-09-09", updatedAt: "2026-09-09",
		latestVersion: { id: `${id}:${version}`, assetId: id, projectId, version,
			data: { imageUrl: `https://assets.example/${id}-${version}.png`, referenceType: "scene" }, note: null, createdAt: "2026-09-09" } };
}
const context = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
	sourceNodeId: "source", canvasData: { nodes: [{ id: "source", data: { kind: "text", content: "canonical source" } }] }, assets: [asset("old"), asset("unchanged")] });
const trigger = { id: "trigger", data: { workflowTriggerPayload: { onlyVideoNodes: false, videoModelKey: "frozen-media", source: "canonical user source" } } };
const source = { nodes: [trigger, { id: "author", data: {} }], edges: [{ source: "trigger", target: "author" }],
	workflowExecutionScope: { triggerNodeId: "trigger", stopAfterNodeId: "author" }, workflowProjectContext: context,
	workflowDeliveryScope: { flowId: "canvas", projectId: "project" }, workflowDirectAgentModelSelection: { model: "frozen-model", source: "user_preference" },
	workflowSourceSnapshots: [{ nodeId: "source", text: "canonical source" }] };
const live = { nodes: [{ id: "trigger", data: { workflowTriggerPayload: { source: "changed live source" } } }, { id: "author", data: {} }, { id: "consumer", data: {} }, { id: "media", data: {} }],
	edges: [{ source: "trigger", target: "author" }, { source: "author", target: "consumer" }, { source: "consumer", target: "media" }],
	workflowProjectContext: { invalid: "live context" }, workflowDirectAgentModelSelection: { model: "changed" } };
const request = { liveFlowData: live, sourceSnapshot: source, sourceExecutionId: "accepted-author", sourceFlowVersionId: "frozen-version",
	triggerNodeId: "trigger", startFromNodeId: "consumer", stopAfterNodeId: "consumer", capturedAt: "2026-09-30T00:00:00.000Z" };

describe("explicit source invocation inheritance for a live DAG replay", () => {
	it("inherits invocation facts without replacing the current DAG or authoring source", () => {
		const before = structuredClone({ live, source });
		const result = projectWorkflowReplayInvocation(request);
		expect(result.flowData.nodes).toHaveLength(4);
		expect(result.flowData.edges).toEqual(live.edges);
		expect(result.flowData.workflowDirectAgentModelSelection).toEqual(source.workflowDirectAgentModelSelection);
		expect(result.flowData.workflowDeliveryScope).toEqual(source.workflowDeliveryScope);
		expect(result.frozenInvocationFacts.workflowSourceSnapshots).toEqual(source.workflowSourceSnapshots);
		expect(result.projectContext).toEqual(context);
		expect(result.triggerPayload).toEqual(trigger.data.workflowTriggerPayload);
		expect(result.flowData.workflowReplayInvocation).toMatchObject({ sourceExecutionId: "accepted-author", sourceFlowVersionId: "frozen-version", startFromNodeId: "consumer", stopAfterNodeId: "consumer", refreshAssetIds: [] });
		expect({ live, source }).toEqual(before);
	});
	it("refreshes only named visible asset identities and leaves source, selections and unrelated versions frozen", () => {
		const result = projectWorkflowReplayInvocation({ ...request, refreshAssetIds: ["old", "new", "new"], visibleAssets: [asset("old", 2), asset("unchanged", 2), asset("new"), asset("not-requested")] });
		expect(result.projectContext?.projectAssetIds).toEqual(["old", "unchanged", "new"]);
		expect(result.projectContext?.assetSnapshot.map(item => [item.assetId, item.assetVersion])).toEqual([["unchanged", 1], ["old", 2], ["new", 1]]);
		expect(result.projectContext?.sourceNodeId).toBe(context.sourceNodeId);
		expect(result.projectContext?.selection).toEqual(context.selection);
		expect(result.frozenInvocationFacts.workflowSourceSnapshots).toEqual(source.workflowSourceSnapshots);
		expect(result.projectContext?.selectedAssetIds).toEqual(context.selectedAssetIds);
		expect(context.projectAssetIds).toEqual(["old", "unchanged"]);
	});
	it("reports missing or cross-project explicit asset identities rather than refreshing all", () => {
		for (const visibleAssets of [[], [asset("new", 1, "other-project")]]) {
			expect(() => refreshWorkflowReplayAssetDirectory({ context, assetIds: ["new"], visibleAssets, capturedAt: request.capturedAt })).toThrow("asset_not_visible:new");
		}
	});
	it("rejects trigger mismatch and invalid frozen invocation metadata", () => {
		expect(() => projectWorkflowReplayInvocation({ ...request, triggerNodeId: "other" })).toThrow("trigger_identity_mismatch");
		expect(() => projectWorkflowReplayInvocation({ ...request, sourceSnapshot: { ...source, workflowProjectContext: {} } })).toThrow("project_context_invalid");
	});
	it("does not synthesize an absent model identity or asset context", () => {
		const { workflowProjectContext: _context, workflowDirectAgentModelSelection: _model, ...without } = source;
		const result = projectWorkflowReplayInvocation({ ...request, sourceSnapshot: without });
		expect(result.frozenInvocationFacts).not.toHaveProperty("workflowDirectAgentModelSelection");
		expect(() => projectWorkflowReplayInvocation({ ...request, sourceSnapshot: without, refreshAssetIds: ["new"], visibleAssets: [asset("new")] })).toThrow("asset_context_missing");
	});
	it("requires a named source and stop boundary and forbids overriding its frozen trigger facts", () => {
		const run = { idempotencyKey: "consumer-attempt-1", flowId: "flow", triggerNodeId: "trigger", replayFromExecutionId: "source", startFromNodeId: "consumer", stopAfterNodeId: "consumer", refreshAssetIds: ["new"] };
		expect(RunFlowExecutionRequestSchema.parse(run)).toEqual(run);
		expect(RunFlowExecutionRequestSchema.safeParse({ ...run, triggerPayload: { source: "new" } }).success).toBe(false);
		expect(RunFlowExecutionRequestSchema.safeParse({ ...run, model: "other" }).success).toBe(false);
		expect(RunFlowExecutionRequestSchema.safeParse({ ...run, stopAfterNodeId: undefined }).success).toBe(false);
		expect(RunFlowExecutionRequestSchema.safeParse({ ...run, idempotencyKey: undefined }).success).toBe(false);
		expect(RunFlowExecutionRequestSchema.safeParse({ flowId: "flow", triggerNodeId: "trigger", refreshAssetIds: ["new"] }).success).toBe(false);
	});
});
