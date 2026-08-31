import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";

const { resolveExecutionImageReferences, freshReadFlowRow, persistFlowPatch, readFlowNodes } = vi.hoisted(
  () => ({
    resolveExecutionImageReferences: vi.fn(),
    freshReadFlowRow: vi.fn(),
    persistFlowPatch: vi.fn(),
    readFlowNodes: vi.fn(),
  }),
);

vi.mock("./agents-tool-bridge.image-reference-ids", () => ({
  resolveExecutionImageReferences,
}));

vi.mock("./video-orchestrator.flow-io", () => ({
  freshReadFlowRow,
  persistFlowPatch,
  readFlowNodes,
}));

import { addAssetToCanvas } from "./agents-tool-bridge.asset-add-to-canvas";

const row: FlowRow = {
  id: "flow-1",
  name: "Flow",
  data: JSON.stringify({ nodes: [], edges: [] }),
  owner_id: "user-1",
  project_id: "project-1",
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  freshReadFlowRow.mockResolvedValue(row);
  readFlowNodes.mockReturnValue([]);
  resolveExecutionImageReferences.mockResolvedValue([
    {
      referenceId: "asset:asset-layout",
      source: "asset",
      nodeId: null,
      assetId: "asset-layout",
      assetRefId: null,
      name: "布局线稿",
      url: "https://assets.example/layout.png",
    },
  ]);
  persistFlowPatch.mockResolvedValue({
    row: { ...row, updated_at: "2026-08-12T00:01:00.000Z" },
  });
});

describe("addAssetToCanvas", () => {
  it("persists a previewable image node with explicit asset role", async () => {
    const result = await addAssetToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        assetId: "asset-layout",
        referenceRole: "layout",
        referenceStrength: 0.8,
        node: {
          id: "layout-node",
          type: "taskNode",
          position: { x: 40, y: 80 },
          data: { kind: "image", label: "布局线稿" },
        },
      },
    });

    expect(resolveExecutionImageReferences).toHaveBeenCalledWith({
      c: expect.any(Object),
      ownerId: "user-1",
      row,
      assetIds: ["asset-layout"],
    });
    expect(persistFlowPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        flowId: "flow-1",
        affectedNodeIds: ["layout-node"],
        patch: {
          createNodes: [
            expect.objectContaining({
              id: "layout-node",
              data: expect.objectContaining({
                imageUrl: "https://assets.example/layout.png",
                sourceAssetId: "asset-layout",
                referenceAssetIds: ["asset-layout"],
                referenceRole: "layout",
                referenceStrength: 0.8,
                status: "success",
              }),
            }),
          ],
        },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        nodeId: "layout-node",
        assetId: "asset-layout",
        referenceRole: "layout",
        ready: true,
        alreadyPresent: false,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it("returns the existing identical binding without another write", async () => {
    readFlowNodes.mockReturnValue([
      {
        id: "layout-node",
        data: { sourceAssetId: "asset-layout", referenceRole: "layout" },
      },
    ]);

    const result = await addAssetToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        assetId: "asset-layout",
        referenceRole: "layout",
        node: {
          id: "layout-node",
          type: "taskNode",
          position: { x: 40, y: 80 },
          data: { kind: "image" },
        },
      },
    });

    expect(result.alreadyPresent).toBe(true);
    expect(persistFlowPatch).not.toHaveBeenCalled();
  });

  it("reuses the current canvas binding even when a continuation proposes a different node id", async () => {
    const latestRow = { ...row, updated_at: "2026-08-12T00:02:00.000Z" };
    freshReadFlowRow.mockResolvedValue(latestRow);
    readFlowNodes.mockReturnValue([
      {
        id: "first-materialized-node",
        data: { sourceAssetId: "asset-layout", referenceRole: "layout" },
      },
    ]);

    const result = await addAssetToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        assetId: "asset-layout",
        referenceRole: "layout",
        node: {
          id: "continuation-proposed-node",
          type: "taskNode",
          position: { x: 600, y: 400 },
          data: { kind: "image", label: "同一资产的新标题" },
        },
      },
    });

    expect(freshReadFlowRow).toHaveBeenCalledWith(expect.objectContaining({
      flowId: "flow-1",
      requestUserId: "user-1",
    }));
    expect(result).toMatchObject({
      nodeId: "first-materialized-node",
      updatedAt: latestRow.updated_at,
      alreadyPresent: true,
    });
    expect(persistFlowPatch).not.toHaveBeenCalled();
  });
});
