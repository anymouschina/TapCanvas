import { describe, expect, it } from "vitest";
import { prepareWorkflowPlanningRevision, reviseWorkflowAssetSnapshots, WorkflowPlanningRevisionSchema } from "./execution.planning-revision";
import { createWorkflowProjectContext } from "./execution.project-context";
import type { MaterialAssetDto } from "../material/material.schemas";

function asset(id: string, version: number): MaterialAssetDto {
  return { id, projectId: "project", teamId: null, folderId: null, scope: "project", kind: "scene",
    name: id, favorite: false, currentVersion: version, createdAt: "2026-09-09", updatedAt: "2026-09-09",
    latestVersion: { id: `${id}:${version}`, assetId: id, projectId: "project", version,
      data: { imageUrl: `https://assets.example/${id}-${version}.png`, referenceType: "scene" },
      note: null, createdAt: "2026-09-09" },
  };
}

function node(id: string, executorRef: string) {
  return { id, type: "taskNode", data: { workflowInstruction: "Original task", workflowAtomicSpec: {
    version: 1, category: "control", operation: "test", executorRef,
    executionMode: "once", inputPorts: [], outputPorts: ["result"],
  } } };
}
const root = { nodes: [node("source", "workflow.input/v1"), node("plan", "agents.logical-task/v2"),
  node("image", "tapcanvas.image.generate/v1"), node("other", "tapcanvas.image.generate/v1")],
  edges: [{ source: "source", target: "plan" }, { source: "plan", target: "image" }] };
const revision = { nodeId: "plan", instruction: "Use the updated source assets", refreshAssetIds: ["asset-1"] };

describe("explicit planning revision", () => {
  it("updates only named versions while preserving original source, selection and snapshot", () => {
    const context = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
      sourceNodeId: "source", canvasData: { nodes: [] }, assets: [asset("asset-1", 1), asset("asset-2", 1)] });
    const previous = { ...context, mediaUnderstandingDiagnostics: [{ referenceId: "asset-2", code: "no_successful_analysis_receipt" }] };
    const revised = reviseWorkflowAssetSnapshots(previous, ["asset-1"], [asset("asset-1", 2), asset("asset-2", 2)]);
    expect(revised.mediaUnderstandingDiagnostics).toEqual([]);
    expect(previous.mediaUnderstandingDiagnostics).toHaveLength(1);
    expect(revised.assetSnapshot.map((item) => item.assetVersion)).toEqual([2, 1]);
    expect(context.assetSnapshot.map((item) => item.assetVersion)).toEqual([1, 1]);
    expect(revised.sourceNodeId).toBe(context.sourceNodeId);
    expect(revised.selectedAssetIds).toEqual(context.selectedAssetIds);
    expect(() => reviseWorkflowAssetSnapshots(context, ["outside"], [asset("outside", 1)]))
      .toThrow("planning_revision_asset_not_frozen");
    expect(() => reviseWorkflowAssetSnapshots(context, ["asset-1"], []))
      .toThrow("planning_revision_asset_missing");
  });
  it("revises only the requested Agent and descendants, retaining the old graph", () => {
    const result = prepareWorkflowPlanningRevision({ root, revision, nodeRuns: [
      { node_id: "image", status: "failed", output_refs: JSON.stringify({ itemRuns: [{ taskId: null, status: "failed" }] }) },
      { node_id: "other", status: "success", output_refs: JSON.stringify({ taskId: "keep-existing" }) },
    ] });
    expect(result.invalidatedNodeIds).toEqual(["plan", "image"]);
    expect(root.nodes[1]?.data.workflowInstruction).toBe("Original task");
    expect(JSON.stringify(result.root)).toContain(revision.instruction);
  });
  it.each(["success", "running", "waiting_external"])("preserves accepted %s work", (status) => {
    expect(() => prepareWorkflowPlanningRevision({ root, revision, nodeRuns: [
      { node_id: "image", status, output_refs: null },
    ] })).toThrow("planning_revision_has_external_receipt");
  });
  it("does not discard a task receipt hidden under a failed aggregate", () => {
    expect(() => prepareWorkflowPlanningRevision({ root, revision, nodeRuns: [
      { node_id: "image", status: "failed", output_refs: JSON.stringify({ itemRuns: [{ output: { taskId: "accepted" } }] }) },
    ] })).toThrow("planning_revision_has_external_receipt");
  });
  it("supports plan-only corrections without refreshing frozen evidence", () => {
    const planOnly = WorkflowPlanningRevisionSchema.parse({ ...revision, refreshAssetIds: [] });
    const context = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
      sourceNodeId: "source", canvasData: { nodes: [] }, assets: [asset("asset-1", 1)] });
    const previous = { ...context, mediaUnderstandingDiagnostics: [{ referenceId: "asset-1", code: "no_successful_analysis_receipt" }] };
    expect(reviseWorkflowAssetSnapshots(previous, planOnly.refreshAssetIds, [])).toBe(previous);
    expect(prepareWorkflowPlanningRevision({ root, revision: planOnly, nodeRuns: [] }).invalidatedNodeIds).toEqual(["plan", "image"]);
    expect(() => prepareWorkflowPlanningRevision({ root, revision: planOnly, nodeRuns: [
      { node_id: "image", status: "failed", output_refs: JSON.stringify({ taskId: "accepted" }) },
    ] })).toThrow("planning_revision_has_external_receipt");
  });
  it("requires explicit refresh selection, instruction and an Agent target", () => {
    expect(WorkflowPlanningRevisionSchema.safeParse({ nodeId: "plan", instruction: "repair" }).success).toBe(false);
    expect(() => prepareWorkflowPlanningRevision({ root, revision: { ...revision, nodeId: "image" }, nodeRuns: [] }))
      .toThrow("planning_revision_requires_agent_node");
  });
});
