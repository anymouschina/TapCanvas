import { describe, expect, it } from "vitest";
import {
  deprecatedCanvasScope,
  isDeprecatedCanvasAsset,
  isDeprecatedCanvasNodeId,
  isDeprecatedCanvasReference,
} from "./material.canvas-visibility";
import type { MaterialAssetDto } from "./material.schemas";

function canvas(nodes: readonly Record<string, unknown>[]): { data: unknown } {
  return { data: { nodes, edges: [] } };
}

function libraryAsset(data: Record<string, unknown>): MaterialAssetDto {
  return {
    id: "material-1",
    projectId: "p1",
    kind: "character",
    name: "张羽角色卡",
    currentVersion: 1,
    latestVersion: {
      id: "material-1:1",
      assetId: "material-1",
      projectId: "p1",
      version: 1,
      data,
      note: null,
      createdAt: "2026-09-14T00:00:00.000Z",
    },
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  };
}

describe("canvas deletion is deprecation", () => {
  it("collects the media url, canvas node id and provider task id of deleted nodes", () => {
    const scope = deprecatedCanvasScope([canvas([
      { id: "node-old", canvasDetached: true, data: { imageUrl: "https://assets.test/old", taskId: "task-old" } },
      { id: "node-new", data: { imageResults: [{ url: "https://assets.test/new" }], taskId: "task-new" } },
    ])]);
    expect([...scope.resourceUrls]).toEqual(["https://assets.test/old"]);
    expect([...scope.nodeIds]).toEqual(["node-old"]);
    expect([...scope.taskIds]).toEqual(["task-old"]);
  });

  it("keeps an identity that any visible canvas still holds", () => {
    const shared = { data: { imageUrl: "https://assets.test/shared", taskId: "task-shared" } };
    const scope = deprecatedCanvasScope([
      { data: { nodes: [{ id: "shared-node", canvasDetached: true, data: shared.data }], edges: [] } },
      { data: { nodes: [{ id: "shared-node", data: shared.data }], edges: [] } },
    ]);
    expect(scope.resourceUrls.size).toBe(0);
    expect(scope.nodeIds.size).toBe(0);
    expect(scope.taskIds.size).toBe(0);
  });

  it("rejects a deleted canvas asset recalled by media url, origin node id or task id", () => {
    const scope = deprecatedCanvasScope([canvas([
      { id: "node-old", canvasDetached: true, data: { imageUrl: "https://assets.test/old", taskId: "task-old" } },
    ])]);
    expect(isDeprecatedCanvasAsset(libraryAsset({ imageUrl: "https://assets.test/old" }), scope)).toBe(true);
    expect(isDeprecatedCanvasAsset(libraryAsset({ sourceNodeId: "node-old", imageUrl: "https://drifted.test/x" }), scope)).toBe(true);
    expect(isDeprecatedCanvasAsset(libraryAsset({ taskId: "task-old", imageUrl: "https://drifted.test/y" }), scope)).toBe(true);
    expect(isDeprecatedCanvasAsset(libraryAsset({ imageUrl: "https://assets.test/other", taskId: "task-other" }), scope)).toBe(false);
    expect(isDeprecatedCanvasNodeId("node-old", scope)).toBe(true);
    expect(isDeprecatedCanvasReference({ taskIds: ["task-old"] }, scope)).toBe(true);
    expect(isDeprecatedCanvasReference({ urls: ["https://assets.test/other"], nodeIds: ["node-new"], taskIds: ["task-new"] }, scope)).toBe(false);
  });

  it("never treats display names as identity", () => {
    const scope = deprecatedCanvasScope([canvas([
      { id: "node-old", canvasDetached: true, data: { imageUrl: "https://assets.test/old", label: "张羽角色卡" } },
    ])]);
    const sameName = libraryAsset({ imageUrl: "https://assets.test/other", name: "张羽角色卡" });
    expect(isDeprecatedCanvasAsset({ ...sameName, name: "张羽角色卡" }, scope)).toBe(false);
  });
});
