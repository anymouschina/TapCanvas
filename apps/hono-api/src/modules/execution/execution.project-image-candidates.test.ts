import { describe, expect, it } from "vitest";
import { createWorkflowProjectContext } from "./execution.project-context";
import { projectNodeAssetsFromCanvases } from "../material/material.project-node-assets";
import { workflowProjectImageCandidates, workflowProjectImageCandidateInstruction, workflowProjectImageCatalog, readWorkflowProjectImageFacts } from "./execution.project-image-candidates";

describe("workflow image candidate facts", () => {
  it("keeps unclassified uploads discoverable with exact identity and observations, independent of checkbox selection", () => {
    const assets = projectNodeAssetsFromCanvases([{ projectId: "project", ownerType: "project", ownerId: "project",
      flowId: "canvas", canvasRevision: 1, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
      data: { nodes: [{ id: "upload", type: "taskNode", data: { kind: "image", label: "opaque-name",
        imageUrl: "https://owned.example/private-image.png" } }], edges: [] } }]);
    const context = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
      canvasData: { nodes: [], edges: [] }, assets, now: new Date("2026-09-09T01:00:00Z") });
    const [candidate] = workflowProjectImageCandidates(context);
    expect(candidate).toMatchObject({ assetId: assets[0]!.id, nodeId: "upload", flowId: "canvas",
      kind: "text", mediaKind: "image", state: "ready", selected: false, analysisEvidence: [] });
    expect(JSON.stringify(candidate)).not.toContain("https://");
    expect(JSON.stringify(candidate)).not.toContain("contentFingerprint");
    expect(context.selectedAssetIds).toEqual([]);
    expect(workflowProjectImageCandidates({ ...context, canvasId: "chapter:next", selectedAssetIds: [] })).toEqual([candidate]);
    const planning = workflowProjectImageCandidateInstruction(context, ["prop://observed-object"]);
    const facts = JSON.parse(planning.split("\n")[1]!);
    expect(facts.candidates).toEqual(workflowProjectImageCatalog(context));
    expect(facts.candidates[0]).not.toHaveProperty("sourceFacts");
    expect(facts.candidates[0].assetId).toEqual(candidate!.assetId);
    expect(readWorkflowProjectImageFacts(context, [candidate!.assetId])).toEqual([candidate]);
    expect(() => readWorkflowProjectImageFacts(context, [candidate!.assetId, "unknown"])).toThrow("workflow_asset_not_in_frozen_catalog");
    expect(() => readWorkflowProjectImageFacts(context, [])).toThrow("workflow_asset_read_ids_invalid");
    expect(() => readWorkflowProjectImageFacts(context, [candidate!.assetId, candidate!.assetId])).toThrow("workflow_asset_read_ids_invalid");
    expect(() => readWorkflowProjectImageFacts({ ...context, projectAssetIds: [] }, [candidate!.assetId])).toThrow("workflow_asset_not_in_frozen_catalog");
    expect(facts.selectedAssetIds).toEqual([]);
    expect(workflowProjectImageCandidates({ ...context, projectAssetIds: [] })).toEqual([]);
    expect(workflowProjectImageCandidates({ ...context, projectId: "other" })).toEqual([]);
  });
});
