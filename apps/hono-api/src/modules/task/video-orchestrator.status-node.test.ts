import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";

const mocks = vi.hoisted(() => ({
  findFlowNode: vi.fn(),
  freshReadFlowRow: vi.fn(),
  persistFlowPatch: vi.fn(),
}));

vi.mock("./video-orchestrator.flow-io", () => ({
  findFlowNode: mocks.findFlowNode,
  freshReadFlowRow: mocks.freshReadFlowRow,
  persistFlowPatch: mocks.persistFlowPatch,
}));

import { upsertVideoRunStatusNode } from "./video-orchestrator.status-node";

const context = {} as AppContext;
const runCreatedAt = "2026-07-21T00:00:00.000Z";
const flowRow = {
  id: "flow-1",
  name: "Flow",
  owner_id: "user-1",
  project_id: "project-1",
  data: JSON.stringify({ nodes: [], edges: [] }),
  created_at: "2026-07-21T00:00:00.000Z",
  updated_at: "2026-07-21T00:00:00.000Z",
};

describe("upsertVideoRunStatusNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.freshReadFlowRow.mockResolvedValue(flowRow);
    mocks.persistFlowPatch.mockResolvedValue({ row: flowRow });
  });

  it("reports not_applicable when neither flow nor chapter scope exists", async () => {
    await expect(
      upsertVideoRunStatusNode({
        c: context,
        runId: "run-1",
        runCreatedAt,
        ownerId: "user-1",
        authoringState: "authoring_done",
        statusLine: "done",
      }),
    ).resolves.toEqual({ status: "not_applicable", reason: "flow_and_chapter_missing" });
    expect(mocks.freshReadFlowRow).not.toHaveBeenCalled();
  });

  it("creates a terminal status node with the real video URL", async () => {
    mocks.findFlowNode.mockReturnValue(null);
    const result = await upsertVideoRunStatusNode({
      c: context,
      runId: "run-1",
      runCreatedAt,
      ownerId: "user-1",
      flowId: "flow-1",
      authoringState: "authoring_done",
      productionState: "concatenated",
      videoUrl: "https://cdn.test/chapter.mp4",
      statusLine: "整片已完成\nhttps://cdn.test/chapter.mp4",
    });

    expect(result).toEqual({ status: "updated" });
    expect(mocks.persistFlowPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        affectedNodeIds: ["video-run-status"],
        patch: expect.objectContaining({
          createNodes: [
            expect.objectContaining({
              id: "video-run-status",
              data: expect.objectContaining({
                label: "整片生成",
                prompt: "整片已完成\nhttps://cdn.test/chapter.mp4",
                authoringState: "authoring_done",
                productionState: "concatenated",
                videoUrl: "https://cdn.test/chapter.mp4",
              }),
            }),
          ],
        }),
      }),
    );
  });

  it("updates scheduled facts without replacing historical text results or assets", async () => {
    const existingNode = {
      id: "video-run-status",
      type: "taskNode",
      position: { x: -420, y: 0 },
      data: {
        kind: "text",
        managedProjection: "video_run_status",
        runId: "run-1",
        runCreatedAt,
        prompt: "未带预授权，等待起跑",
        authoringState: "estimate_ready",
        pendingUserInput: { requestId: "start-run-1", questions: [] },
        textResults: [{ text: "历史创作记录" }],
        videoUrl: "https://cdn.test/existing-output.mp4",
      },
    };
    mocks.findFlowNode.mockReturnValue(existingNode);

    const result = await upsertVideoRunStatusNode({
      c: context,
      runId: "run-1",
      runCreatedAt,
      ownerId: "user-1",
      chapterId: "chapter-1",
      authoringState: "authoring_done",
      productionState: "scheduled",
      statusLine: "0/8 镜头完成\n等待生成",
    });

    expect(result).toEqual({ status: "updated" });
    const persistInput = mocks.persistFlowPatch.mock.calls[0]?.[0] as {
      patch: Parameters<typeof applyPublicFlowGraphPatch>[0]["patch"];
    };
    const applied = applyPublicFlowGraphPatch({
      current: { nodes: [existingNode], edges: [] },
      patch: persistInput.patch,
    });
    const updatedNode = applied.data.nodes.find((value) => {
      const node = value as { id?: unknown };
      return node.id === existingNode.id;
    }) as { data?: unknown } | undefined;
    const updatedData =
      updatedNode?.data && typeof updatedNode.data === "object" && !Array.isArray(updatedNode.data)
        ? (updatedNode.data as Record<string, unknown>)
        : {};
    expect(updatedData.authoringState).toBe("authoring_done");
    expect(updatedData.productionState).toBe("scheduled");
    expect(updatedData.prompt).toBe("0/8 镜头完成\n等待生成");
    expect(updatedData.textResults).toEqual([{ text: "历史创作记录" }]);
    expect(updatedData.videoUrl).toBeNull();
    expect(updatedData.pendingUserInput).toBeNull();
  });

  it("does not mint a flow revision when the managed projection is unchanged", async () => {
    const assetRepair = {
      version: 3 as const,
      runId: "run-1",
      reasonCode: "authoring_asset_coverage_incomplete",
      requiredAssets: [],
      blockedNodeIds: [],
      retryKey: "repair:run-1",
      nextActions: ["等待真实图片 URL"],
      progress: { revision: 0, totalCount: 0, resolvedBindings: [] },
    };
    mocks.findFlowNode.mockReturnValue({
      id: "video-run-status",
      type: "taskNode",
      position: { x: -420, y: 0 },
      data: {
        kind: "text",
        label: "整片生成",
        prompt: "等待前置资产",
        managedProjection: "video_run_status",
        runId: "run-1",
        runCreatedAt,
        authoringState: "asset_repair_required",
        productionState: "collecting",
        videoUrl: null,
        pendingUserInput: null,
        assetRepairRequired: true,
        assetRepair,
        textResults: [{ text: "历史创作记录" }],
      },
    });

    await expect(
      upsertVideoRunStatusNode({
        c: context,
        runId: "run-1",
        runCreatedAt,
        ownerId: "user-1",
        flowId: "flow-1",
        authoringState: "asset_repair_required",
        productionState: "collecting",
        statusLine: "等待前置资产",
        assetRepair,
      }),
    ).resolves.toEqual({ status: "unchanged" });
    expect(mocks.persistFlowPatch).not.toHaveBeenCalled();
  });

  it("ignores a late projection from an older run instead of regressing the current run", async () => {
    mocks.findFlowNode.mockReturnValue({
      id: "video-run-status",
      data: {
        managedProjection: "video_run_status",
        runId: "run-new",
        runCreatedAt: "2026-07-21T00:01:00.000Z",
        productionState: "scheduled",
      },
    });

    await expect(
      upsertVideoRunStatusNode({
        c: context,
        runId: "run-old",
        runCreatedAt: "2026-07-21T00:00:00.000Z",
        ownerId: "user-1",
        flowId: "flow-1",
        productionState: "failed",
        statusLine: "older run failed late",
      }),
    ).resolves.toEqual({ status: "ignored_stale", currentRunId: "run-new" });
    expect(mocks.persistFlowPatch).not.toHaveBeenCalled();
  });

  it("returns flow_not_found instead of claiming an update", async () => {
    mocks.freshReadFlowRow.mockResolvedValue(null);
    const result = await upsertVideoRunStatusNode({
      c: context,
      runId: "run-missing",
      runCreatedAt,
      ownerId: "user-1",
      chapterId: "chapter-30",
      authoringState: "authoring_done",
      statusLine: "done",
    });

    expect(result.status).toBe("flow_not_found");
    expect(mocks.persistFlowPatch).not.toHaveBeenCalled();
  });

  it("returns a structured failure when persistence fails", async () => {
    mocks.findFlowNode.mockReturnValue({ id: "video-run-status" });
    mocks.persistFlowPatch.mockRejectedValue(new Error("write failed"));
    const result = await upsertVideoRunStatusNode({
      c: context,
      runId: "run-1",
      runCreatedAt,
      ownerId: "user-1",
      flowId: "flow-1",
      authoringState: "authoring_done",
      statusLine: "done",
    });

    expect(result).toEqual({ status: "failed", reason: "write failed" });
  });
});
