import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
  findProjectFlows: vi.fn(),
  findChapters: vi.fn(),
  reconcileVideoNodesForFlow: vi.fn(),
  loadChapterCanvasAsFlowRow: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    flows: { findMany: mocks.findProjectFlows },
    chapters: { findMany: mocks.findChapters },
  }),
}));

vi.mock("./agents-tool-bridge.generate-video-to-canvas", () => ({
  reconcileVideoNodesForFlow: mocks.reconcileVideoNodesForFlow,
}));

vi.mock("./agents-tool-bridge.chapter-canvas-write", () => ({
  loadChapterCanvasAsFlowRow: mocks.loadChapterCanvasAsFlowRow,
}));

import { recoverOrphanVideoNodes } from "./video-orphan-recovery";

describe("recoverOrphanVideoNodes project flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectFlows.mockResolvedValue([]);
    mocks.findChapters.mockResolvedValue([]);
  });

  it("reconciles accepted video tasks on a stale project-owned flow", async () => {
    const flow = {
      id: "flow-1",
      name: "Agent API flow",
      data: JSON.stringify({
        nodes: [
          {
            id: "video-1",
            data: { kind: "video", status: "running", taskId: "task-1" },
          },
        ],
      }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:30.000Z",
      canvas_revision: 3,
    };
    mocks.findProjectFlows.mockResolvedValue([flow]);
    mocks.reconcileVideoNodesForFlow.mockResolvedValue({
      ok: true,
      reconciled: 1,
      failed: 0,
      stillRunning: 0,
      details: [],
    });

    const c = { env: { DB: {} } } as unknown as AppContext;
    const result = await recoverOrphanVideoNodes(c, {
      staleBeforeIso: "2026-08-01T00:02:00.000Z",
      limit: 8,
    });

    expect(mocks.reconcileVideoNodesForFlow).toHaveBeenCalledWith({
      c,
      requestUserId: "user-1",
      devBypass: true,
      flowId: "flow-1",
      row: flow,
    });
    expect(result).toMatchObject({
      enabled: true,
      scannedCanvases: 1,
      scannedProjectFlows: 1,
      scannedChapters: 0,
      reconciledNodes: 1,
      failedNodes: 0,
      stillRunning: 0,
      errors: [],
    });
  });

  it("reports project flow failures without hiding the recovery gap", async () => {
    mocks.findProjectFlows.mockResolvedValue([{
      id: "flow-broken",
      name: "Broken flow",
      data: JSON.stringify({
        nodes: [
          {
            id: "video-broken",
            data: { kind: "video", status: "running", taskId: "task-broken" },
          },
        ],
      }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:30.000Z",
      canvas_revision: 1,
    }]);
    mocks.reconcileVideoNodesForFlow.mockRejectedValue(new Error("provider lookup failed"));

    const result = await recoverOrphanVideoNodes(
      { env: { DB: {} } } as unknown as AppContext,
      { staleBeforeIso: "2026-08-01T00:02:00.000Z" },
    );

    expect(result.errors).toEqual([{
      scopeType: "project_flow",
      scopeId: "flow-broken",
      message: "provider lookup failed",
    }]);
  });
});
