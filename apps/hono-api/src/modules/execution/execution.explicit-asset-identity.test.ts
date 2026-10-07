import { describe, expect, it, vi } from "vitest";
import type { AssetRow } from "../asset/asset.repo";
import type { MaterialAssetDto } from "../material/material.schemas";
import { EMPTY_CANVAS_DEPRECATION_SCOPE, type CanvasDeprecationScope } from "../material/material.canvas-visibility";
import { resolveExplicitWorkflowAssets, selectedGeneratedAssetAsMaterialAsset } from "./execution.explicit-asset-identity";
import { createWorkflowProjectContext } from "./execution.project-context";
import { projectWorkflowReplayInvocation } from "./execution.replay-invocation";
import { workflowReplayAttempt } from "./execution.replay-attempt";

const now = new Date("2026-10-01T00:00:00.000Z");
function row(id = "generated-id", data: Record<string, unknown> = {}): AssetRow {
	return { id, name: "Registered image", owner_id: "owner", project_id: "project", created_at: now.toISOString(),
		updated_at: now.toISOString(), data: JSON.stringify({ type: "image", url: "https://assets.example/image.png",
			nodeId: "recorded-node", taskId: "recorded-task", workflowExecutionId: "original-execution", ...data }) };
}
function asset(id = "material-handle"): MaterialAssetDto {
	const result = selectedGeneratedAssetAsMaterialAsset(row(id), "project");
	if (!result) throw new Error("Fixture requires a registered image");
	return result;
}
function resolve(overrides: Partial<Parameters<typeof resolveExplicitWorkflowAssets>[0]> = {}) {
	return resolveExplicitWorkflowAssets({ ownerId: "owner", projectId: "project", assetIds: ["generated-id"], candidates: [],
		deprecation: EMPTY_CANVAS_DEPRECATION_SCOPE, loadGeneratedAsset: async () => row(), now, ...overrides });
}

describe("explicit replay asset identity admission", () => {
	it("loads only requested exact identities with the requesting principal, preserving both identity sources", async () => {
		const lookup = vi.fn(async (id: string, _owner: string) => id === "generated-id" ? row() : null);
		const handle = asset();
		const result = await resolve({ assetIds: [handle.id, "generated-id", "generated-id"], candidates: [handle, asset("unrequested")], loadGeneratedAsset: lookup });
		expect(lookup.mock.calls).toEqual([[handle.id, "owner"], ["generated-id", "owner"]]);
		expect(result.map(item => item.id)).toEqual([handle.id, "generated-id"]);
		expect(result[1].latestVersion?.data).toMatchObject({ nodeId: "recorded-node", taskId: "recorded-task", workflowExecutionId: "original-execution", imageUrl: "https://assets.example/image.png" });
	});
	it.each([ { owner_id: "other" }, { project_id: "other" }, { id: "substituted" } ])("rejects an unauthorized or substituted exact generation row: %j", async (change) => {
		await expect(resolve({ loadGeneratedAsset: async () => ({ ...row(), ...change }) })).rejects.toThrow("asset_forbidden:generated-id");
	});
	it("rejects a cross-project visible handle and unknown IDs without name matching", async () => {
		await expect(resolve({ candidates: [{ ...asset("generated-id"), projectId: "other" }], loadGeneratedAsset: async () => null })).rejects.toThrow("asset_forbidden");
		await expect(resolve({ candidates: [{ ...asset("different-id"), name: "generated-id" }], loadGeneratedAsset: async () => null })).rejects.toThrow("asset_not_visible:generated-id");
	});
	it("rejects collisions across canvas/material and generation identity sources", async () => {
		await expect(resolve({ candidates: [asset("generated-id")] })).rejects.toThrow("identity_conflict:generated-id");
		await expect(resolve({ candidates: [asset("generated-id"), asset("generated-id")], loadGeneratedAsset: async () => null })).rejects.toThrow("identity_conflict:generated-id");
	});
	it.each([ { type: "video" }, { type: "image", url: "" }, { url: "not-a-url" }, { url: "file:///private/image.png" }, { urlExpiresAt: "invalid" }, { status: "processing" }, { deleted: true } ])("rejects structurally unavailable registered resources: %j", async (data) => {
		await expect(resolve({ loadGeneratedAsset: async () => row("generated-id", data) })).rejects.toThrow(/asset_(invalid|resource_unavailable)/u);
	});
	it.each([ { urlExpiresAt: "2026-09-30T00:00:00.000Z" }, { url: "https://assets.example/image.png?Expires=1" }, { url: "https://assets.example/image.png?X-Amz-Date=20260930T000000Z&X-Amz-Expires=60" } ])("rejects expired exact resources: %j", async (data) => {
		await expect(resolve({ loadGeneratedAsset: async () => row("generated-id", data) })).rejects.toThrow("asset_resource_unavailable:generated-id");
	});
	it.each([ "resourceUrls", "nodeIds", "taskIds" ] as const)("applies the existing deletion ledger by %s", async (key) => {
		const scope: CanvasDeprecationScope = { resourceUrls: new Set(), nodeIds: new Set(), taskIds: new Set(),
			[key]: new Set([key === "resourceUrls" ? "https://assets.example/image.png" : key === "nodeIds" ? "recorded-node" : "recorded-task"]) };
		await expect(resolve({ deprecation: scope })).rejects.toThrow("asset_deprecated:generated-id");
		await expect(resolve({ deprecation: scope, candidates: [asset("generated-id")], loadGeneratedAsset: async () => null })).rejects.toThrow("asset_deprecated:generated-id");
	});
	it("freezes original generation IDs in a new replay without replacing source, selection, model or unrelated assets", async () => {
		const context = createWorkflowProjectContext({ projectId: "project", canvasId: "chapter", principalId: "owner", sourceNodeId: "source", canvasData: { nodes: [], edges: [] }, assets: [asset("unrelated")] });
		const source = { workflowProjectContext: context, workflowDirectAgentModelSelection: { model: "frozen-model" }, workflowSourceSnapshots: [{ nodeId: "source", text: "immutable source" }], workflowDeliveryScope: { flowId: "chapter", projectId: "project" }, workflowExecutionScope: { triggerNodeId: "trigger" }, nodes: [{ id: "trigger", data: { workflowTriggerPayload: { onlyVideoNodes: false } } }], edges: [] };
		const before = structuredClone(source);
		const request = { liveFlowData: { nodes: [{ id: "trigger", data: {} }, { id: "consumer", data: {} }], edges: [] }, sourceSnapshot: source, sourceExecutionId: "accepted", sourceFlowVersionId: "version", triggerNodeId: "trigger", startFromNodeId: "consumer", stopAfterNodeId: "consumer", trigger: "manual", refreshAssetIds: ["generated-id"], capturedAt: now.toISOString() };
		const result = projectWorkflowReplayInvocation({ ...request, visibleAssets: await resolve() });
		expect(result.projectContext?.projectAssetIds).toEqual(["unrelated", "generated-id"]);
		expect(result.projectContext?.assetSnapshot[1]).toMatchObject({ assetId: "generated-id", assetVersionId: "generated-id:generation", sourceFacts: { sourceNodeId: "recorded-node", taskId: "recorded-task" } });
		expect(result.projectContext?.assetSnapshot[0]).toEqual(context.assetSnapshot[0]);
		expect(result.projectContext?.selectedAssetIds).toEqual(context.selectedAssetIds);
		expect(result.flowData.workflowSourceSnapshots).toEqual(source.workflowSourceSnapshots);
		expect(result.flowData.workflowDirectAgentModelSelection).toEqual(source.workflowDirectAgentModelSelection);
		expect(result.triggerPayload).toEqual({ onlyVideoNodes: false });
		expect(source).toEqual(before);
		const attempt = workflowReplayAttempt({ ...request, ownerId: "owner", flowId: "flow", idempotencyKey: "attempt" });
		expect(workflowReplayAttempt({ ...request, ownerId: "owner", flowId: "flow", idempotencyKey: "attempt", refreshAssetIds: ["generated-id", "generated-id"] })).toEqual(attempt);
		expect(workflowReplayAttempt({ ...request, ownerId: "owner", flowId: "flow", idempotencyKey: "attempt", refreshAssetIds: ["other-identity"] }).requestHash).not.toBe(attempt.requestHash);
	});
});
