import { describe, expect, it } from "vitest";

import { buildAgentFlowPatchResult } from "./agents-tool-bridge.flow-patch-result";

describe("agent-facing flow patch result", () => {
  it("returns identifiers and media readiness without echoing the persisted graph or storage URLs", () => {
    const result = buildAgentFlowPatchResult({
      flowId: "chapter-34",
      updatedAt: "2026-07-30T00:00:00.000Z",
      stats: { patchedNodes: 1 },
      createdNodeSnapshots: [{
        id: "video-node-1",
        type: "taskNode",
        position: { x: 10, y: 20 },
        data: {
          kind: "video",
          label: "镜1",
          status: "success",
          taskId: "task-1",
          assetId: "asset-video-1",
          clipRunId: "run-v8",
          clipIndex: 0,
          prompt: "不应在 patch 回执中重复的大段提示词",
          referenceImageNodeIds: ["character-node-1"],
          videoUrl: "https://assets.test/video.mp4",
          videoResults: [{ url: "https://assets.test/video.mp4" }],
        },
      }],
      createdEdgeSnapshots: [{
        id: "edge-1",
        source: "character-node-1",
        target: "video-node-1",
      }],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      flowId: "chapter-34",
      stats: { patchedNodes: 1 },
    }));
    expect(result.createdNodeSnapshots).toEqual([
      expect.objectContaining({
        id: "video-node-1",
        data: expect.objectContaining({
          kind: "video",
          label: "镜1",
          taskId: "task-1",
          assetId: "asset-video-1",
          clipRunId: "run-v8",
          clipIndex: 0,
          referenceImageNodeIds: ["character-node-1"],
          hasMedia: true,
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("https://");
    expect(JSON.stringify(result)).not.toContain("大段提示词");
  });
});
