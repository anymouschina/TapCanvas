import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowRow } from "../flow/flow.repo";

const mocks = vi.hoisted(() => {
  class MockFlowRevisionConflictError extends Error {
    constructor(
      public flowId: string,
      public expected: number,
      public actual: number,
    ) {
      super(`Flow revision conflict on ${flowId}: expected ${expected}, actual ${actual}`);
      this.name = "FlowRevisionConflictError";
    }
  }

  return {
    createFlowVersion: vi.fn(),
    getFlowByIdUnsafe: vi.fn(),
    getFlowForOwner: vi.fn(),
    updateFlow: vi.fn(),
    updateFlowByIdUnsafe: vi.fn(),
    broadcastPatch: vi.fn(),
    applyPatchToFlowYDoc: vi.fn(),
    FlowRevisionConflictError: MockFlowRevisionConflictError,
  };
});

vi.mock("../flow/flow.repo", () => ({
  createFlowVersion: mocks.createFlowVersion,
  getFlowByIdUnsafe: mocks.getFlowByIdUnsafe,
  getFlowForOwner: mocks.getFlowForOwner,
  updateFlow: mocks.updateFlow,
  updateFlowByIdUnsafe: mocks.updateFlowByIdUnsafe,
  FlowRevisionConflictError: mocks.FlowRevisionConflictError,
  mapFlowRowToDto: (row: FlowRow) => ({
    id: row.id,
    name: row.name,
    data: JSON.parse(row.data) as unknown,
    canvasRevision: row.canvas_revision ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }),
}));

vi.mock("../flow/flow.service", () => ({
  sanitizeFlowDataForStorage: (value: unknown) => value,
}));

vi.mock("../flow/flow.public.service", () => ({
  applyPublicFlowGraphPatch: (input: {
    current: unknown;
    patch: { patchNodeData?: Array<{ id: string; data: Record<string, unknown> }> };
  }) => {
    const current = input.current as {
      nodes: Array<{ id: string; data?: Record<string, unknown> }>;
      edges: unknown[];
    };
    const patchByNodeId = new Map(
      (input.patch.patchNodeData ?? []).map((entry) => [entry.id, entry.data]),
    );
    return {
      data: {
        ...current,
        nodes: current.nodes.map((node) => ({
          ...node,
          data: {
            ...(node.data ?? {}),
            ...(patchByNodeId.get(node.id) ?? {}),
          },
        })),
      },
      createdEdgeIds: [],
    };
  },
}));

vi.mock("../chapter/canvas-sse.manager", () => ({
  broadcastPatch: mocks.broadcastPatch,
}));

vi.mock("../realtime/yjs-realtime", () => ({
  applyPatchToFlowYDoc: mocks.applyPatchToFlowYDoc,
}));

vi.mock("../chapter/chapter.canvas-flow.service", () => ({
  getChapterCanvasFlow: vi.fn(),
  putChapterCanvasFlow: vi.fn(),
  CanvasFlowRevisionConflictError: class extends Error {},
}));

import {
  persistFlowPatch,
  readDurableNodeVideoUrl,
  type VideoFlowNode,
} from "./video-orchestrator.flow-io";

function makeRow(input: {
  revision: number;
  nodes: Array<{ id: string; data: Record<string, unknown> }>;
}): FlowRow {
  return {
    id: "flow-1",
    name: "Flow",
    owner_id: "user-1",
    project_id: "project-1",
    data: JSON.stringify({ nodes: input.nodes, edges: [] }),
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    canvas_revision: input.revision,
  };
}

describe("persistFlowPatch revision convergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createFlowVersion.mockResolvedValue(undefined);
  });

  it("re-reads and reapplies an agent patch after a concurrent canvas write", async () => {
    const initialRow = makeRow({
      revision: 5,
      nodes: [{ id: "video-run-status", data: { productionState: "scheduled" } }],
    });
    const concurrentRow = makeRow({
      revision: 6,
      nodes: [
        { id: "video-run-status", data: { productionState: "scheduled" } },
        { id: "user-node", data: { text: "keep me" } },
      ],
    });
    mocks.getFlowByIdUnsafe.mockResolvedValue(concurrentRow);
    mocks.updateFlowByIdUnsafe
      .mockRejectedValueOnce(new mocks.FlowRevisionConflictError("flow-1", 5, 6))
      .mockImplementationOnce(async (_db: unknown, input: { data: string }) => ({
        ...concurrentRow,
        data: input.data,
        canvas_revision: 7,
      }));

    const result = await persistFlowPatch({
      c: { env: { DB: {} } } as never,
      row: initialRow,
      flowId: "flow-1",
      requestUserId: "user-1",
      devBypass: true,
      affectedNodeIds: ["video-run-status"],
      patch: {
        patchNodeData: [
          {
            id: "video-run-status",
            data: { productionState: "generating" },
          },
        ],
      },
    });

    expect(mocks.updateFlowByIdUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ expectedRevision: 5, source: "agent" }),
    );
    expect(mocks.updateFlowByIdUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ expectedRevision: 6, source: "agent" }),
    );
    const persisted = JSON.parse(result.row.data) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(persisted.nodes).toEqual([
      { id: "video-run-status", data: { productionState: "generating" } },
      { id: "user-node", data: { text: "keep me" } },
    ]);
    expect(mocks.broadcastPatch).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ revision: 7 }),
      "",
    );
    expect(mocks.createFlowVersion).not.toHaveBeenCalled();
  });
});

function videoNode(data: Record<string, unknown>): VideoFlowNode {
  return { id: "film-run", type: "taskNode", data };
}

describe("readDurableNodeVideoUrl", () => {
  it("prefers a durable top-level videoUrl", () => {
    expect(
      readDurableNodeVideoUrl(
        videoNode({
          videoUrl: "https://cdn.example/final.mp4",
          videoResults: [{ url: "https://cdn.example/older.mp4" }],
        }),
      ),
    ).toBe("https://cdn.example/final.mp4");
  });

  it("recognizes a browser-composed durable result when persistence omitted videoUrl", () => {
    expect(
      readDurableNodeVideoUrl(
        videoNode({
          videoResults: [
            { url: "https://cdn.example/old.mp4" },
            { url: "https://cdn.example/composed.mp4", title: "合成视频" },
          ],
          videoPrimaryIndex: 1,
        }),
      ),
    ).toBe("https://cdn.example/composed.mp4");
  });

  it("rejects temporary blob URLs as delivery evidence", () => {
    expect(
      readDurableNodeVideoUrl(
        videoNode({
          videoUrl: "blob:temporary",
          videoResults: [{ url: "blob:temporary", title: "合成视频" }],
          videoPrimaryIndex: 0,
        }),
      ),
    ).toBe("");
  });
});
