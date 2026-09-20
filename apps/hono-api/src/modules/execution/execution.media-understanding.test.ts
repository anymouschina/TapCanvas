import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { MaterialAssetDto } from "../material/material.schemas";
import { createWorkflowAssetResolver } from "./execution.asset-resolver";
import { createWorkflowProjectContext } from "./execution.project-context";
import { enrichWorkflowMediaUnderstanding } from "./execution.media-understanding";
import type { ImageUnderstandingEvidence } from "../task/image-understanding-evidence";
import { reviseWorkflowAssetSnapshots } from "./execution.planning-revision";

const { loadImageUnderstandingEvidence } = vi.hoisted(() => ({ loadImageUnderstandingEvidence: vi.fn() }));
vi.mock("../task/image-understanding-evidence", () => ({ loadImageUnderstandingEvidence }));
const asset: MaterialAssetDto = {
  id: "asset-1", projectId: "project-1", teamId: null, folderId: null, scope: "project", kind: "text",
  name: "opaque-filename", favorite: false, currentVersion: 1,
  latestVersion: { id: "version-1", assetId: "asset-1", projectId: "project-1", version: 1,
    data: { imageUrl: "https://owned.example/image.png" }, note: null, createdAt: "2026-09-08T10:00:00Z" },
  createdAt: "2026-09-08T10:00:00Z", updatedAt: "2026-09-08T10:00:00Z",
};
const evidence: ImageUnderstandingEvidence = {
  referenceId: "asset-1", text: "Visible weave; composition unknown", question: "Describe image",
  provenance: { version: 1, mediaType: "image", source: "persisted_task_result", taskId: "vision-1",
    modelKey: "vision", referenceId: "asset-1", promptHash: "p", analysisHash: "a", analyzedAt: "2026-09-08T10:01:00Z" },
};
const context = createWorkflowProjectContext({ projectId: "project-1", canvasId: "flow-1", principalId: "owner-1",
  canvasData: { nodes: [], edges: [] }, assets: [asset], selectedAssetIds: [asset.id], now: new Date("2026-09-08T10:02:00Z") });
const c = { env: { DB: {} } } as unknown as AppContext;

describe("workflow media evidence handoff", () => {
  beforeEach(() => { loadImageUnderstandingEvidence.mockReset(); loadImageUnderstandingEvidence.mockResolvedValue([evidence]); });

  it("hydrates an existing frozen run and preserves the receipt across subsequent physical retries", async () => {
    const resolver = createWorkflowAssetResolver({ context, loadVisibleAssets: async () => [asset] });
    const first = await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context, resolver });
    expect(first.mediaUnderstanding).toEqual([evidence]);
    expect(first.selectedAssetIds).toBe(context.selectedAssetIds);
    expect(first.assetSnapshot).toBe(context.assetSnapshot);
    expect(context.mediaUnderstanding).toBeUndefined();
    expect(loadImageUnderstandingEvidence).toHaveBeenCalledWith({ db: {}, ownerId: "owner-1",
      references: [{ referenceId: "asset-1", url: "https://owned.example/image.png" }], before: context.capturedAt });
    expect(await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context: first, resolver })).toBe(first);
    expect(loadImageUnderstandingEvidence).toHaveBeenCalledTimes(1);
  });

  it("loads observations for visible images without inventing an explicit selection", async () => {
    const unselected = { ...context, selectedAssetIds: [], mediaUnderstanding: [] };
    const resolver = createWorkflowAssetResolver({ context: unselected, loadVisibleAssets: async () => [asset] });
    const result = await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context: unselected, resolver });
    expect(result.mediaUnderstanding).toEqual([evidence]);
    expect(result.selectedAssetIds).toEqual([]);
    expect(result.assetSnapshot).toBe(unselected.assetSnapshot);
    expect(loadImageUnderstandingEvidence).toHaveBeenCalledWith(expect.objectContaining({
      references: [{ referenceId: asset.id, url: asset.latestVersion!.data.imageUrl }], before: context.capturedAt,
    }));
  });

  it("rechecks previously missing receipts for every visible identity after an authorized revision", async () => {
    const otherAsset = { ...asset, id: "asset-2", latestVersion: {
      ...asset.latestVersion!, id: "version-2", assetId: "asset-2",
    } };
    const original = createWorkflowProjectContext({ projectId: "project-1", canvasId: "flow-1", principalId: "owner-1",
      canvasData: { nodes: [], edges: [] }, assets: [asset, otherAsset], now: new Date("2026-09-08T10:00:00Z") });
    const previous = { ...original, mediaUnderstanding: [], mediaUnderstandingDiagnostics: [
      { referenceId: otherAsset.id, code: "no_successful_analysis_receipt" },
    ] };
    const revised = { ...reviseWorkflowAssetSnapshots(previous, [asset.id], [asset, otherAsset]),
      capturedAt: "2026-09-08T10:02:00Z" };
    const secondEvidence = { ...evidence, referenceId: otherAsset.id,
      provenance: { ...evidence.provenance, referenceId: otherAsset.id } };
    loadImageUnderstandingEvidence.mockResolvedValue([evidence, secondEvidence]);
    const resolver = createWorkflowAssetResolver({ context: revised, loadVisibleAssets: async () => [asset, otherAsset] });
    const result = await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context: revised, resolver });
    expect(loadImageUnderstandingEvidence).toHaveBeenCalledWith(expect.objectContaining({
      before: revised.capturedAt,
      references: [asset, otherAsset].map((item) => ({ referenceId: item.id, url: item.latestVersion!.data.imageUrl })),
    }));
    expect(result.mediaUnderstanding).toEqual([evidence, secondEvidence]);
    expect(result.mediaUnderstandingDiagnostics).toEqual([]);
    expect(previous.mediaUnderstandingDiagnostics).toHaveLength(1);
    expect(previous.capturedAt).toBe("2026-09-08T10:00:00.000Z");
  });

  it("extends partial observation coverage without rereading successful inputs", async () => {
    const second = { ...context.assetSnapshot[0]!, assetId: "asset-2" };
    const partial = { ...context, projectAssetIds: [asset.id, second.assetId],
      assetSnapshot: [...context.assetSnapshot, second], mediaUnderstanding: [evidence] };
    const resolveAssetResource = vi.fn().mockResolvedValue({ url: "https://owned.example/second.png" });
    loadImageUnderstandingEvidence.mockResolvedValue([]);
    const result = await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context: partial,
      resolver: { resolveAssetResource } as unknown as Parameters<typeof enrichWorkflowMediaUnderstanding>[0]["resolver"] });
    expect(resolveAssetResource).toHaveBeenCalledTimes(1);
    expect(resolveAssetResource).toHaveBeenCalledWith("asset-2", "image");
    expect(result.mediaUnderstanding).toEqual([evidence]);
    expect(result.mediaUnderstandingDiagnostics).toEqual([{ referenceId: "asset-2", code: "no_successful_analysis_receipt" }]);
    expect(await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context: result,
      resolver: { resolveAssetResource } as unknown as Parameters<typeof enrichWorkflowMediaUnderstanding>[0]["resolver"] })).toBe(result);
  });

  it("never reads removed, foreign or non-production candidates even if selected", async () => {
    const excluded = { ...context, projectAssetIds: ["foreign", "preview"], assetSnapshot: [context.assetSnapshot[0]!,
      { ...context.assetSnapshot[0]!, assetId: "foreign", projectId: "other" },
      { ...context.assetSnapshot[0]!, assetId: "preview", productionEligible: false }],
      selectedAssetIds: [asset.id, "foreign", "preview"] };
    const resolver = createWorkflowAssetResolver({ context: excluded, loadVisibleAssets: async () => [asset] });
    loadImageUnderstandingEvidence.mockResolvedValue([]);
    await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context: excluded, resolver });
    expect(loadImageUnderstandingEvidence).toHaveBeenCalledWith(expect.objectContaining({ references: [] }));
  });

  it.each(["changed", "other-owner"])("does not attach observations to a %s asset", async (mode) => {
    loadImageUnderstandingEvidence.mockResolvedValue([]);
    const resolver = createWorkflowAssetResolver({ context, loadVisibleAssets: async () => mode === "other-owner" ? [] : [{
      ...asset, currentVersion: 2, latestVersion: { ...asset.latestVersion!, id: "version-2", version: 2, data: { imageUrl: "https://owned.example/changed.png" } },
    }] });
    const enriched = await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context, resolver });
    expect(enriched.mediaUnderstanding).toEqual([]);
    expect(enriched.mediaUnderstandingDiagnostics).toEqual([expect.objectContaining({ referenceId: asset.id })]);
    expect(loadImageUnderstandingEvidence).toHaveBeenCalledWith(expect.objectContaining({ references: [] }));
  });

  it("reports unavailable evidence without blocking authoring or changing frozen facts", async () => {
    loadImageUnderstandingEvidence.mockRejectedValue(new Error("database offline"));
    const resolver = createWorkflowAssetResolver({ context, loadVisibleAssets: async () => [asset] });
    const enriched = await enrichWorkflowMediaUnderstanding({ c, ownerId: "owner-1", context, resolver });
    expect(enriched.mediaUnderstandingDiagnostics).toContainEqual({ referenceId: null, code: "analysis_receipt_lookup_failed" });
    expect(enriched.mediaUnderstanding).toBeUndefined();
    expect(enriched.assetSnapshot).toBe(context.assetSnapshot);
  });
});
