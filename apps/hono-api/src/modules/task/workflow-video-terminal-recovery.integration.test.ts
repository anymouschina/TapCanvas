import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
  findAttempts: vi.fn(),
  persistVideoNodePatch: vi.fn(),
  reconcileVideoNodesForFlow: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    workflow_node_attempts: { findMany: mocks.findAttempts },
  }),
}));

vi.mock("./agents-tool-bridge.generate-video-to-canvas", () => ({
  persistVideoNodePatch: mocks.persistVideoNodePatch,
  reconcileVideoNodesForFlow: mocks.reconcileVideoNodesForFlow,
}));

import { recoverWorkflowVideoTerminalNodes } from "./workflow-video-terminal-recovery";

const runtimeNodeId = "video-submit::item::clip%3A3";
const familyId = "family-1";
const canvasNodeId = `${runtimeNodeId}::family::${familyId}::output::video`;

function graph(): Record<string, unknown> {
  return {
    nodes: [{
      id: canvasNodeId,
      data: {
        kind: "video",
        status: "submitting",
        workflowExecutionId: "execution-1",
        workflowRuntimeNodeId: runtimeNodeId,
        workflowEffectId: `${familyId}:${runtimeNodeId}:video-submit`,
      },
    }],
    edges: [],
  };
}

function attempt(status: "failed" | "waiting_external"): { output_refs: string } {
  return {
    output_refs: JSON.stringify({
      protocolVersion: "1",
      executorRef: "tapcanvas.video.generate/v1",
      nodeId: "video-submit",
      executionMode: "each",
      ports: {},
      artifacts: [],
      evidence: {},
      itemRuns: [{
        itemId: "clip:3",
        index: 3,
        status,
        runtimeNodeId,
        lineage: [],
        ports: {},
        artifacts: [],
        evidence: {
          canvasNodeId,
          taskId: "provider-task-3",
          providerStatus: status === "failed" ? "failed" : "waiting_external",
        },
        ...(status === "failed"
          ? {
              errorCode: "workflow_node_runtime_failed",
              errorMessage: "provider policy violation",
            }
          : {}),
      }],
    }),
  };
}

describe("recoverWorkflowVideoTerminalNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistVideoNodePatch.mockImplementation(async (input: {
      buildPatch: (current: unknown) => unknown;
    }) => input.buildPatch(graph()));
  });

  it("projects an exact persisted item failure when provider lookup cannot settle it", async () => {
    mocks.findAttempts.mockResolvedValue([attempt("failed")]);
    mocks.reconcileVideoNodesForFlow.mockResolvedValue({
      ok: true,
      reconciled: 0,
      failed: 0,
      stillRunning: 1,
      postersBackfilled: 0,
      posterBackfillFailed: 0,
      details: [],
    });

    const result = await recoverWorkflowVideoTerminalNodes({
      c: { env: { DB: {} } } as unknown as AppContext,
      requestUserId: "owner-1",
      devBypass: true,
      flowId: "chapter-1",
      chapterId: "chapter-1",
      row: { data: graph() } as never,
    });

    expect(mocks.reconcileVideoNodesForFlow).toHaveBeenCalledWith(expect.objectContaining({
      target: { nodeId: canvasNodeId, taskId: "provider-task-3" },
    }));
    expect(mocks.persistVideoNodePatch).toHaveBeenCalledTimes(1);
    const persistence = mocks.persistVideoNodePatch.mock.calls[0]?.[0] as {
      buildPatch: (current: unknown) => {
        patchNodeData: Array<{ data: Record<string, unknown> }>;
      };
    };
    expect(persistence.buildPatch(graph()).patchNodeData[0]?.data).toMatchObject({
      status: "failed",
      taskId: "provider-task-3",
      workflowSubmissionState: "rejected_by_provider",
      errorMessage: "provider policy violation",
    });
    expect(result).toMatchObject({ reconciled: 1, failed: 1, stillRunning: 0 });
  });

  it("reconciles an accepted exact task without submitting a replacement", async () => {
    mocks.findAttempts.mockResolvedValue([attempt("waiting_external")]);
    mocks.reconcileVideoNodesForFlow.mockResolvedValue({
      ok: true,
      reconciled: 1,
      failed: 0,
      stillRunning: 0,
      postersBackfilled: 0,
      posterBackfillFailed: 0,
      details: [{ nodeId: canvasNodeId, taskId: "provider-task-3", status: "success" }],
    });

    const result = await recoverWorkflowVideoTerminalNodes({
      c: { env: { DB: {} } } as unknown as AppContext,
      requestUserId: "owner-1",
      devBypass: true,
      flowId: "chapter-1",
      chapterId: "chapter-1",
      row: { data: graph() } as never,
    });

    expect(mocks.reconcileVideoNodesForFlow).toHaveBeenCalledTimes(1);
    expect(mocks.persistVideoNodePatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reconciled: 1, failed: 0, stillRunning: 0 });
  });
});
