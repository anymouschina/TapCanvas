import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";

const {
  getAssetByIdForUser,
  getMaterialVersionForOwner,
  listMaterialAssets,
  listProjectNodeAssetsForOwner,
} = vi.hoisted(() => ({
  getAssetByIdForUser: vi.fn(),
  getMaterialVersionForOwner: vi.fn(),
  listMaterialAssets: vi.fn(),
  listProjectNodeAssetsForOwner: vi.fn(),
}));

vi.mock("../asset/asset.repo", async () => {
  const actual = await vi.importActual<typeof import("../asset/asset.repo")>(
    "../asset/asset.repo",
  );
  return { ...actual, getAssetByIdForUser };
});

vi.mock("../material/material.repo", async () => {
  const actual = await vi.importActual<typeof import("../material/material.repo")>(
    "../material/material.repo",
  );
  return { ...actual, getMaterialVersionForOwner, listMaterialAssets };
});

vi.mock("../material/material.project-node-assets.service", () => ({
  listProjectNodeAssetsForOwner,
}));

import {
  describeExecutionImageReference,
  resolveExecutionImageReferences,
  resolveImageReferencesForInspection,
} from "./agents-tool-bridge.image-reference-ids";

function makeFlowRow(nodes: unknown[]): FlowRow {
  return {
    id: "flow-1",
    name: "Flow",
    data: JSON.stringify({ nodes, edges: [] }),
    owner_id: "user-1",
    project_id: "project-1",
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
  };
}

const appContext = { env: { DB: {} } } as AppContext;

describe("resolveExecutionImageReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssetByIdForUser.mockResolvedValue(null);
    getMaterialVersionForOwner.mockResolvedValue(null);
    listMaterialAssets.mockResolvedValue([]);
    listProjectNodeAssetsForOwner.mockResolvedValue([]);
  });

  it("resolves a real canvas image from nodeId and hides its URL from the agent descriptor", async () => {
    const row = makeFlowRow([
      {
        id: "node-style",
        type: "taskNode",
        data: {
          kind: "image",
          label: "项目全局画风",
          imageUrl: "https://file.beqlee.icu/style.png",
          assetId: "asset-style",
        },
      },
    ]);

    const [resolved] = await resolveExecutionImageReferences({
      c: appContext,
      ownerId: "user-1",
      row,
      nodeIds: ["node-style"],
    });

    expect(resolved).toMatchObject({
      referenceId: "node:node-style",
      nodeId: "node-style",
      assetId: "asset-style",
      name: "项目全局画风",
      url: "https://file.beqlee.icu/style.png",
    });
    expect(describeExecutionImageReference(resolved!)).toEqual({
      referenceId: "node:node-style",
      source: "node",
      nodeId: "node-style",
      assetId: "asset-style",
      assetRefId: null,
      name: "项目全局画风",
      mediaType: "image",
      ready: true,
    });
  });

  it("allows preview inspection but forbids using a story preview as a production reference", async () => {
    const row = makeFlowRow([{
      id: "preview-board-0",
      type: "taskNode",
      data: {
        kind: "storyboardImage",
        imageUrl: "https://file.beqlee.icu/preview-board.png",
        assetUsage: "preview_only",
        assetPurpose: "story_preview",
        productionEligible: false,
        productionLayer: "preview",
      },
    }]);

    await expect(resolveExecutionImageReferences({
      c: appContext,
      ownerId: "user-1",
      row,
      nodeIds: ["preview-board-0"],
    })).rejects.toMatchObject({ code: "agents_tool_preview_asset_forbidden" });

    const inspected = await resolveImageReferencesForInspection({
      c: appContext,
      ownerId: "user-1",
      row,
      nodeIds: ["preview-board-0"],
    });
    expect(inspected).toHaveLength(1);
    expect(inspected[0]?.previewOnly).toBe(true);
  });

  it("resolves an uploaded image asset from its persisted data.url", async () => {
    getAssetByIdForUser.mockResolvedValue({
      id: "upload-1",
      name: "用户上传参考图",
      data: JSON.stringify({
        kind: "upload",
        type: "image",
        url: "https://file.beqlee.icu/upload.png",
      }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-30T00:00:00.000Z",
      updated_at: "2026-07-30T00:00:00.000Z",
    });

    const [resolved] = await resolveExecutionImageReferences({
      c: appContext,
      ownerId: "user-1",
      row: makeFlowRow([]),
      assetIds: ["upload-1"],
    });

    expect(resolved).toMatchObject({
      referenceId: "asset:upload-1",
      source: "asset",
      assetId: "upload-1",
      name: "用户上传参考图",
      url: "https://file.beqlee.icu/upload.png",
    });
  });

  it("resolves a current-project material asset when the generic asset table misses", async () => {
    listMaterialAssets.mockResolvedValue([
      {
        id: "material-1",
        projectId: "project-1",
        kind: "character",
        name: "鸿钧角色卡",
        currentVersion: 1,
        latestVersion: {
          id: "version-1",
          assetId: "material-1",
          projectId: "project-1",
          version: 1,
          data: { imageUrl: "https://file.beqlee.icu/hongjun.png" },
          note: null,
          createdAt: "2026-07-30T00:00:00.000Z",
        },
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ]);

    const [resolved] = await resolveExecutionImageReferences({
      c: appContext,
      ownerId: "user-1",
      row: makeFlowRow([]),
      assetIds: ["material-1"],
    });

    expect(resolved).toMatchObject({
      source: "material_asset",
      assetId: "material-1",
      name: "鸿钧角色卡",
      url: "https://file.beqlee.icu/hongjun.png",
    });
    expect(listMaterialAssets).toHaveBeenCalledTimes(1);
  });

  it("resolves a project-node asset from another chapter through its stable project asset id", async () => {
    listProjectNodeAssetsForOwner.mockResolvedValue([
      {
        id: "project-node:chapter:chapter-1:role-shen",
        projectId: "project-1",
        teamId: null,
        folderId: null,
        scope: "project",
        kind: "character",
        name: "沈知夏",
        favorite: false,
        currentVersion: 20,
        latestVersion: {
          id: "project-node:chapter:chapter-1:role-shen:revision:19",
          assetId: "project-node:chapter:chapter-1:role-shen",
          projectId: "project-1",
          version: 20,
          data: {
            source: "project_node",
            ownerType: "chapter",
            ownerId: "chapter-1",
            nodeId: "role-shen",
            imageUrl: "https://file.beqlee.icu/shen-zhixia.png",
          },
          note: null,
          createdAt: "2026-08-08T14:11:26.432Z",
        },
        createdAt: "2026-08-08T13:00:00.000Z",
        updatedAt: "2026-08-08T14:11:26.432Z",
        origin: {
          type: "project_node",
          ownerType: "chapter",
          ownerId: "chapter-1",
          flowId: "chapter:chapter-1",
          nodeId: "role-shen",
        },
      },
    ]);

    const [resolved] = await resolveExecutionImageReferences({
      c: appContext,
      ownerId: "user-1",
      row: makeFlowRow([]),
      assetIds: ["project-node:chapter:chapter-1:role-shen"],
    });

    expect(resolved).toEqual({
      referenceId: "asset:project-node:chapter:chapter-1:role-shen",
      source: "project_node",
      nodeId: "role-shen",
      assetId: "project-node:chapter:chapter-1:role-shen",
      assetRefId: "project-node:chapter:chapter-1:role-shen:revision:19",
      name: "沈知夏",
      url: "https://file.beqlee.icu/shen-zhixia.png",
      previewOnly: false,
    });
    expect(listProjectNodeAssetsForOwner).toHaveBeenCalledWith(
      appContext,
      "user-1",
      { projectId: "project-1" },
    );
    expect(listMaterialAssets).not.toHaveBeenCalled();
  });

  it("resolves an exact current-project material version id", async () => {
    listMaterialAssets.mockResolvedValue([
      {
        id: "material-1",
        projectId: "project-1",
        kind: "character",
        name: "鸿钧角色卡",
        currentVersion: 2,
        latestVersion: null,
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ]);
    getMaterialVersionForOwner.mockResolvedValue({
      id: "version-base",
      assetId: "material-1",
      projectId: "project-1",
      version: 1,
      data: { imageUrl: "https://file.beqlee.icu/hongjun-base.png" },
      note: null,
      createdAt: "2026-07-30T00:00:00.000Z",
    });

    const [resolved] = await resolveExecutionImageReferences({
      c: appContext,
      ownerId: "user-1",
      row: makeFlowRow([]),
      assetIds: ["version-base"],
    });

    expect(resolved).toMatchObject({
      referenceId: "asset-version:version-base",
      source: "material_version",
      assetId: "material-1",
      assetRefId: "version-base",
      name: "鸿钧角色卡 v1",
      url: "https://file.beqlee.icu/hongjun-base.png",
    });
  });

  it("fails explicitly when any requested ID cannot resolve to a real image", async () => {
    await expect(
      resolveExecutionImageReferences({
        c: appContext,
        ownerId: "user-1",
        row: makeFlowRow([]),
        nodeIds: ["missing-node"],
        assetIds: ["missing-asset"],
      }),
    ).rejects.toMatchObject({
      code: "agents_tool_image_reference_unresolved",
      details: {
        missingNodeIds: ["missing-node"],
        missingAssetIds: ["missing-asset"],
      },
    });
  });

  it("paid execution fails before lookup when the combined reference count exceeds 16", async () => {
    await expect(
      resolveExecutionImageReferences({
        c: appContext,
        ownerId: "user-1",
        row: makeFlowRow([]),
        nodeIds: Array.from({ length: 9 }, (_, index) => `node-${index}`),
        assetIds: Array.from({ length: 8 }, (_, index) => `asset-${index}`),
      }),
    ).rejects.toMatchObject({ code: "agents_tool_image_reference_limit_exceeded" });
    expect(getAssetByIdForUser).not.toHaveBeenCalled();
    expect(listMaterialAssets).not.toHaveBeenCalled();
  });

  it("read-only inspection deterministically resolves an 18-node chapter list in bounded batches", async () => {
    const row = makeFlowRow(
      Array.from({ length: 18 }, (_, index) => ({
        id: `node-${index}`,
        type: "taskNode",
        data: {
          kind: "image",
          label: `章节资产 ${index}`,
          imageUrl: `https://file.beqlee.icu/chapter-asset-${index}.png`,
        },
      })),
    );

    const resolved = await resolveImageReferencesForInspection({
      c: appContext,
      ownerId: "user-1",
      row,
      nodeIds: Array.from({ length: 18 }, (_, index) => `node-${index}`),
    });

    expect(resolved).toHaveLength(18);
    expect(resolved.map((reference) => reference.nodeId)).toEqual(
      Array.from({ length: 18 }, (_, index) => `node-${index}`),
    );
  });
});
