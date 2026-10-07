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
  it("asks Agent to rank only exact stable identity candidates", async () => {
    const recall = vi.fn(async (input: { scope: string; documents: readonly { id: string }[] }) => ({ scope: input.scope,
      results: input.documents.map(document => ({ id: document.id, score: 0.03 })),
      diagnostics: { model: "chosen-model", documents: input.documents.length } }));
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

  it("uses the current asset list and Agent order when several chapters share the same identity", async () => {
    const earlier = context().assetSnapshot.find(asset => asset.sourceFacts.assetReuseKey === "stable-character-base");
    if (!earlier) throw new Error("missing historical fixture");
    const later = { ...earlier, assetId: "project-node:project:chapter-2:same",
      assetVersionId: "chapter-2-version" };
    const recall = vi.fn(async (input: { scope: string; documents: readonly { id: string }[] }) => ({ scope: input.scope,
      results: [...input.documents].reverse().map(document => ({ id: document.id, score: 1 })),
      diagnostics: { model: "chosen-model", documents: input.documents.length } }));
    const result = await matchWorkflowProjectImage({ projectId: "project",
      assetMetadata: { referenceType: "character", assetReuseKey: "stable-character-base" },
      prompt: "张羽身份卡", styleFingerprint: null }, [earlier, later], recall);
    expect(result).toMatchObject({ candidateCount: 2, assetId: later.assetId });
    expect(recall.mock.calls[0]?.[0].documents).toHaveLength(2);
  });

  it("leaves current-family media effects to their durable effect claim", async () => {
    const prior = context().assetSnapshot[0];
    if (!prior) throw new Error("missing historical fixture");
    const current = { ...prior,
      assetId: "project-node:chapter:chapter-30:workflow-asset:abc::family::family-1::output::image",
      assetVersionId: "current-version" };
    const recall = vi.fn(async (input: { scope: string; documents: readonly { id: string }[] }) => ({
      scope: input.scope,
      results: input.documents.map((document) => ({ id: document.id, score: 1 })),
      diagnostics: { model: "chosen-model", documents: input.documents.length },
    }));
    const result = await matchWorkflowProjectImage({ projectId: "project", executionFamilyId: "family-1",
      assetMetadata: { referenceType: "character", assetReuseKey: "stable-character-base" },
      prompt: "张羽身份卡", styleFingerprint: null }, [prior, current], recall);
    expect(result.assetId).toBe(prior.assetId);
    expect(recall.mock.calls[0]?.[0].documents.map((document) => document.id)).toEqual([prior.assetId]);
  });

  it("exposes an empty Agent ranking instead of silently generating a replacement", async () => {
    await expect(matchWorkflowProjectImage({ projectId: "project",
      assetMetadata: { referenceType: "character", physicalIdentityKey: "zhangyu-body", characterAssetRole: "identity_anchor" },
      prompt: "张羽身份卡", styleFingerprint: null }, context().assetSnapshot, async input => ({ scope: input.scope,
      results: [], diagnostics: { model: "chosen-model", documents: 1 } })))
      .rejects.toThrow("workflow_project_asset_agent_rank_unavailable");
  });

  it("pins a fresh Agent match to one ready image version in the node resolver", () => {
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

  it("returns the matched version's content fingerprint", async () => {
    const recall = vi.fn(async (input: { scope: string; documents: readonly { id: string }[] }) => ({ scope: input.scope,
      results: input.documents.map(document => ({ id: document.id, score: 1 })),
      diagnostics: { model: "chosen-model", documents: input.documents.length } }));
    const snapshot = context().assetSnapshot;
    const result = await matchWorkflowProjectImage({ projectId: "project",
      assetMetadata: { referenceType: "character", assetReuseKey: "stable-character-base" },
      prompt: "张羽身份卡", styleFingerprint: null }, snapshot, recall);
    const matched = snapshot.find(asset => asset.assetId === result.assetId);
    expect(result.assetContentFingerprint).toBe(matched?.contentFingerprint);
  });

  it("keeps a project-node match when only the shared canvas revision advanced", () => {
    // Sibling Clips persisting their nodes bump the chapter canvas revision, which is
    // the version id of every project node on that canvas.
    const canvasAt = (canvasRevision: number, imageUrl: string) => projectNodeAssetsFromCanvases([{ projectId: "project",
      ownerType: "project", ownerId: "project", flowId: "canvas", canvasRevision,
      createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
      data: { nodes: [{ id: "same", type: "taskNode", data: { kind: "image", status: "success", imageUrl,
        label: "张羽", referenceType: "character", physicalIdentityKey: "zhangyu-body",
        characterAssetRole: "identity_anchor", assetReuseKey: "stable-character-base" } }], edges: [] } }]);
    const frozen = context();
    const recalled = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
      canvasData: { nodes: [], edges: [] }, assets: canvasAt(1, "https://owned.example/same.png"), selectedAssetIds: [] }).assetSnapshot[0];
    const advanced = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
      canvasData: { nodes: [], edges: [] }, assets: canvasAt(7, "https://owned.example/same.png"), selectedAssetIds: [] }).assetSnapshot[0];
    const replaced = createWorkflowProjectContext({ projectId: "project", canvasId: "canvas", principalId: "owner",
      canvasData: { nodes: [], edges: [] }, assets: canvasAt(8, "https://owned.example/redrawn.png"), selectedAssetIds: [] }).assetSnapshot[0];
    if (!recalled || !advanced || !replaced) throw new Error("missing project-node fixture");
    expect(advanced.origin).toBe("project_node");
    expect(advanced.assetVersionId).not.toBe(recalled.assetVersionId);

    const scoped = scopeMatchedProjectImage(frozen, advanced, recalled.assetVersionId ?? "", recalled.contentFingerprint);
    expect(scoped.assetSnapshot.at(-1)).toEqual(advanced);
    // The media itself changed: the recalled match no longer describes it.
    expect(() => scopeMatchedProjectImage(frozen, replaced, recalled.assetVersionId ?? "", recalled.contentFingerprint))
      .toThrow("changed after memory recall");
    // Without the recalled fingerprint the version id alone decides.
    expect(() => scopeMatchedProjectImage(frozen, advanced, recalled.assetVersionId ?? ""))
      .toThrow("changed after memory recall");
  });

  it("still pins material-library matches to the exact recalled version", () => {
    const frozen = context();
    const source = frozen.assetSnapshot[0];
    if (!source) throw new Error("missing image fixture");
    const material = { ...source, origin: "material" as const, assetVersionId: "material-v2" };
    expect(() => scopeMatchedProjectImage(frozen, material, "material-v1", source.contentFingerprint))
      .toThrow("changed after memory recall");
  });
});
