import { expect, it, vi } from "vitest";
import { createWorkflowProjectContext } from "./execution.project-context";
import { repairMissingWorkflowSourceBinding } from "./execution.source-binding-repair";
import { readWorkflowCanvasProjectContextFromFlowData } from "./execution.canvas-source-runner";

it.each(["chapter:c1", "canvas1"])("binds only an absent canonical source in %s and preserves all other frozen inputs", async (canvasId) => {
	const status = { id: "status", data: { kind: "workflowExecution" } };
	const snapshot = { nodes: [status], edges: [] };
	const context = createWorkflowProjectContext({ projectId: "p1", canvasId, principalId: "u1", sourceNodeId: "source",
		canvasData: snapshot, assets: [], assetWrite: true });
	const source = { id: "source", type: "taskNode", data: { kind: "text", content: "权威正文", sourceHash: "hash" } };
	const loadSource = vi.fn(async () => ({ snapshot: { nodes: [source, { id: "new-unrelated" }], edges: [] }, revision: 4 }));
	const result = await repairMissingWorkflowSourceBinding({ projectContext: context, callerCanvasSnapshot: snapshot, loadSource });
	const { assetSnapshot: _assets, projectAssetIds: _ids, ...remaining } = result.projectContext;
	const { assetSnapshot: _originalAssets, projectAssetIds: _originalIds, ...original } = context;
	void _assets; void _ids; void _originalAssets; void _originalIds;
	expect(remaining).toEqual(original);
	expect(result.callerCanvasSnapshot.nodes).toEqual([status, source]);
	expect(snapshot.nodes).toEqual([status]);
	expect(() => readWorkflowCanvasProjectContextFromFlowData({ flowId: canvasId, rowData: JSON.stringify(result.callerCanvasSnapshot), projectContext: result.projectContext })).not.toThrow();
	loadSource.mockClear();
	const again = await repairMissingWorkflowSourceBinding({ ...result, loadSource });
	expect(again.repaired).toBe(false);
	expect(loadSource).not.toHaveBeenCalled();
});

it("derives a missing descriptor from frozen text without refreshing its narrative", async () => {
	const snapshot = { nodes: [{ id: "source", data: { kind: "text", content: "冻结正文" } }], edges: [] };
	const context = createWorkflowProjectContext({ projectId: "p1", canvasId: "canvas1", principalId: "u1", sourceNodeId: "source", canvasData: snapshot, assets: [], assetWrite: true });
	const loadSource = vi.fn(async () => { throw new Error("must not reload"); });
	const result = await repairMissingWorkflowSourceBinding({ projectContext: context, callerCanvasSnapshot: snapshot, loadSource });
	expect(result.repaired).toBe(true);
	expect(result.callerCanvasSnapshot.nodes).toBe(snapshot.nodes);
	expect(loadSource).not.toHaveBeenCalled();
});

it("reports a still missing authority without inventing text or changing the frozen input", async () => {
	const snapshot = { nodes: [], edges: [] };
	const context = createWorkflowProjectContext({ projectId: "p1", canvasId: "canvas1", principalId: "u1", sourceNodeId: "source", canvasData: snapshot, assets: [], assetWrite: true });
	await expect(repairMissingWorkflowSourceBinding({ projectContext: context, callerCanvasSnapshot: snapshot,
		loadSource: async () => ({ snapshot, revision: 0 }) })).rejects.toThrow("still missing");
	expect(context.assetSnapshot).toEqual([]);
});
