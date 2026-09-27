import { describe, expect, it, vi } from "vitest";
import { createWorkflowProjectContext } from "./execution.project-context";
import { projectNodeAssetsFromCanvases } from "../material/material.project-node-assets";
import { matchWorkflowProjectImage, scopeMatchedProjectImage } from "./execution.project-asset-match";

function context() {
  const assets = projectNodeAssetsFromCanvases([{ projectId: "project", ownerType: "project", ownerId: "project",
    flowId: "canvas", canvasRevision: 1, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
    data: { nodes: [
      { id: "same", type: "taskNode", data: { kind: "image", status: "success", imageUrl: "https://owned.example/same.png",
        label: "张羽", referenceType: "character", physicalIdentityKey: "zhangyu-body", characterAssetRole: "identity_anchor",
        assetReuseKey: "stable-character-base" } },
      { id: "other", type: "taskNode", data: { kind: "image", status: "success", imageUrl: "https://owned.example/other.png",
        label: "钱深", referenceType: "character", physicalIdentityKey: "qianshen-body", characterAssetRole: "identity_anchor",
        assetReuseKey: "different-character-base" } },
    ], edges: [] } }]);
  return createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
    canvasData: { nodes: [], edges: [] }, assets, selectedAssetIds: [] });
}

describe("workflow project asset match", () => {
  it("asks Palace to rank only exact stable identity candidates", async () => {
    const recall = vi.fn(async (input: { scope: string; documents: { id: string }[] }) => ({ scope: input.scope,
      results: input.documents.map(document => ({ id: document.id, score: 0.03 })),
      diagnostics: { embeddingModel: "embedding", documents: input.documents.length,
        channels: { vector: "ready" as const, sparse: "ready" as const }, failures: [] } }));
    const result = await matchWorkflowProjectImage({ projectId: "project",
      assetMetadata: { referenceType: "character", physicalIdentityKey: "zhangyu-body",
        characterAssetRole: "identity_anchor", assetReuseKey: "stable-character-base" },
      prompt: "张羽身份卡", styleFingerprint: null }, context().assetSnapshot, recall);
    expect(result).toMatchObject({ reason: "exact_identity_ranked", candidateCount: 1,
      assetId: "project-node:project:project:same" });
    expect(recall.mock.calls[0]?.[0].documents.map(document => document.id)).toEqual(["project-node:project:project:same"]);
  });

  it("never reuses a semantic near-neighbour without an exact identity", async () => {
    const recall = vi.fn();
    const result = await matchWorkflowProjectImage({ projectId: "project",
      assetMetadata: { referenceType: "character", physicalIdentityKey: "unknown-body", characterAssetRole: "identity_anchor" },
      prompt: "张羽身份卡", styleFingerprint: null }, context().assetSnapshot, recall);
    expect(result).toMatchObject({ assetId: null, reason: "no_exact_identity" });
    expect(recall).not.toHaveBeenCalled();
  });

  it("uses the current asset list and Palace order when several chapters share the same identity", async () => {
    const earlier = context().assetSnapshot.find(asset => asset.sourceFacts.assetReuseKey === "stable-character-base");
    if (!earlier) throw new Error("missing historical fixture");
    const later = { ...earlier, assetId: "project-node:project:chapter-2:same",
      assetVersionId: "chapter-2-version" };
    const recall = vi.fn(async (input: { scope: string; documents: { id: string }[] }) => ({ scope: input.scope,
      results: [...input.documents].reverse().map(document => ({ id: document.id, score: 1 })),
      diagnostics: { embeddingModel: "embedding", documents: input.documents.length,
        channels: { vector: "ready" as const, sparse: "ready" as const }, failures: [] } }));
    const result = await matchWorkflowProjectImage({ projectId: "project",
      assetMetadata: { referenceType: "character", assetReuseKey: "stable-character-base" },
      prompt: "张羽身份卡", styleFingerprint: null }, [earlier, later], recall);
    expect(result).toMatchObject({ candidateCount: 2, assetId: later.assetId });
    expect(recall.mock.calls[0]?.[0].documents).toHaveLength(2);
  });

  it("exposes Palace vector failure instead of silently generating a replacement", async () => {
    await expect(matchWorkflowProjectImage({ projectId: "project",
      assetMetadata: { referenceType: "character", physicalIdentityKey: "zhangyu-body", characterAssetRole: "identity_anchor" },
      prompt: "张羽身份卡", styleFingerprint: null }, context().assetSnapshot, async input => ({ scope: input.scope,
      results: [], diagnostics: { embeddingModel: "embedding", documents: 1,
        channels: { vector: "failed", sparse: "ready" }, failures: [{ channel: "vector", reason: "unavailable", blocking: false }] } })))
      .rejects.toThrow("workflow_project_asset_palace_rank_unavailable:failed");
  });

  it("pins a fresh Palace match to one ready image version in the node resolver", () => {
    const frozen = context();
    const source = frozen.assetSnapshot[0];
    if (!source) throw new Error("missing image fixture");
    const newChapterAsset = { ...source, assetId: "project-node:project:chapter-3:same",
      assetVersionId: "new-version" };
    const scoped = scopeMatchedProjectImage(frozen, newChapterAsset, "new-version");
    expect(scoped.projectAssetIds).toContain(newChapterAsset.assetId);
    expect(scoped.assetSnapshot.at(-1)).toEqual(newChapterAsset);
    expect(frozen.projectAssetIds).not.toContain(newChapterAsset.assetId);
    expect(() => scopeMatchedProjectImage(frozen, newChapterAsset, "outdated-version"))
      .toThrow("changed after memory recall");
  });
});
