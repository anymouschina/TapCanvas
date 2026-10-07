import { describe, expect, it } from "vitest";
import { createWorkflowProjectContext } from "./execution.project-context";
import { projectNodeAssetsFromCanvases } from "../material/material.project-node-assets";
import { workflowProjectImageCandidates, workflowProjectImageCandidateInstruction, workflowProjectImageCatalog, readWorkflowProjectImageFacts } from "./execution.project-image-candidates";
import { imageMediaIdentityKey } from "./execution.image-media-identity";

describe("workflow image candidate facts", () => {
  it("retains typed purpose and exact same-media lineage without dropping selected handles or distinct images", () => {
    const assetData = [
      { id: "original", data: { imageUrl: "https://owned.example/person.png", referenceType: "character", physicalIdentityKey: "person" } },
      { id: "copy", data: { imageUrl: "https://owned.example/person.png", imageResults: [{ url: "https://owned.example/person.png" }],
        referenceType: "character", sourceAssetId: "project-node:project:project:original", physicalIdentityKey: "person" } },
      { id: "other-view", data: { imageUrl: "https://owned.example/person-side.png", referenceType: "character", physicalIdentityKey: "person" } },
      { id: "multiple-images", data: { imageUrl: "https://owned.example/person.png", imageResults: [{ url: "https://owned.example/person-side.png" }],
        referenceType: "character", physicalIdentityKey: "person" } },
      { id: "blocking", data: { imageUrl: "https://owned.example/room.png", referenceType: "scene", assetPurpose: "blocking_background" } },
    ];
    const assets = projectNodeAssetsFromCanvases([{ projectId: "project", ownerType: "project", ownerId: "project",
      flowId: "canvas", canvasRevision: 1, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
      data: { nodes: assetData.map(node => ({ ...node, type: "taskNode", data: { ...node.data, kind: "image", label: "same label" } })), edges: [] } }]);
    const selectedAssetIds = ["project-node:project:project:original", "project-node:project:project:copy"];
    const context = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
      canvasData: { nodes: [], edges: [] }, assets, selectedAssetIds });
    const before = JSON.stringify(context);
    const catalog = workflowProjectImageCatalog(context);
    expect(catalog).toHaveLength(5);
    const find = (id: string) => catalog.find(asset => asset.assetId === `project-node:project:project:${id}`)!;
    expect(find("original").mediaIdentityKey).toBe(find("copy").mediaIdentityKey);
    expect(find("original").sameMediaAsAssetId).toBe(find("copy").assetId);
    expect(find("copy")).toMatchObject({ selected: true, sameMediaAsAssetId: null,
      sourceIdentity: { sourceAssetId: "project-node:project:project:original" } });
    expect(find("original").selected).toBe(true);
    expect(find("other-view").mediaIdentityKey).not.toBe(find("original").mediaIdentityKey);
    expect(find("multiple-images").mediaIdentityKey).not.toBe(find("original").mediaIdentityKey);
    expect(find("blocking")).toMatchObject({ referenceType: "scene", assetPurpose: "blocking_background" });
    expect(readWorkflowProjectImageFacts(context, selectedAssetIds).map(asset => asset.assetId)).toEqual(selectedAssetIds);
    expect(readWorkflowProjectImageFacts(context, [find("blocking").assetId])[0]?.assetPurpose).toBe("blocking_background");
    expect(JSON.stringify(catalog)).not.toContain("https://");
    expect(JSON.stringify(context)).toBe(before);
    const reversed = workflowProjectImageCatalog({ ...context, assetSnapshot: [...context.assetSnapshot].reverse() });
    expect(reversed.find(asset => asset.assetId === find("original").assetId)?.sameMediaAsAssetId).toBe(find("copy").assetId);
  });

  it("never treats names, source IDs, missing URLs, or signed-URL variants as exact same media", () => {
    expect(imageMediaIdentityKey({ sourceAssetId: "same", name: "same" })).toBeNull();
    expect(imageMediaIdentityKey({ imageUrl: "data:image/png;base64,abc" })).toBeNull();
    expect(imageMediaIdentityKey({ imageUrl: "https://owned.example/image.png?version=1" }))
      .not.toBe(imageMediaIdentityKey({ imageUrl: "https://owned.example/image.png?version=2" }));
    expect(imageMediaIdentityKey({ imageResults: [{ url: "https://owned.example/b.png" }, { url: "https://owned.example/a.png" }] }))
      .not.toBe(imageMediaIdentityKey({ imageResults: [{ url: "https://owned.example/a.png" }, { url: "https://owned.example/b.png" }] }));
  });

  it("keeps different effective primary views separate even when both nodes contain the same complete image set", () => {
    const front = "https://owned.example/front.png";
    const side = "https://owned.example/side.png";
    const imageResults = [{ url: front }, { url: side }];
    const frontKey = imageMediaIdentityKey({ imageUrl: front, imageResults });
    expect(frontKey).not.toBe(imageMediaIdentityKey({ imageUrl: side, imageResults }));
    expect(frontKey).toBe(imageMediaIdentityKey({ imageUrl: front, imageResults: [...imageResults].reverse() }));
    expect(frontKey).toBe(imageMediaIdentityKey({ imageResults }));
    expect(frontKey).not.toBe(imageMediaIdentityKey({ imageResults: [...imageResults].reverse() }));
  });

  it("uses execution resolver precedence across all supported image fields and collection formats", () => {
    const first = "https://owned.example/first.png";
    const second = "https://owned.example/second.png";
    const firstKey = imageMediaIdentityKey({ imageUrl: first, imageResults: [{ url: second }] });
    expect(firstKey).toBe(imageMediaIdentityKey({ threeViewImageUrl: first, firstFrameUrl: second }));
    expect(firstKey).toBe(imageMediaIdentityKey({ firstFrameUrl: first, lastFrameUrl: second }));
    expect(firstKey).toBe(imageMediaIdentityKey({ imageResults: [first], images: [{ sourceUrl: second }] }));
    expect(firstKey).toBe(imageMediaIdentityKey({ roleCardReferenceImages: [{ imageUrl: first }], referenceImages: [second] }));
    expect(firstKey).toBe(imageMediaIdentityKey({ storyboardEditorCells: [{ imageUrl: first }, { imageUrl: second }] }));
    expect(firstKey).not.toBe(imageMediaIdentityKey({ imageUrl: second, threeViewImageUrl: first }));
  });
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
