import { describe, expect, it } from "vitest";

import { PublicFlowPatchRequestSchema } from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import {
  planMasterStoryboardSplit,
  type MasterStoryboardSplitPlan,
} from "./master-storyboard.split-plan";
import type { MasterShotTable } from "./master-storyboard.types";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";

const TABLE: MasterShotTable = {
  title: "章节母板",
  globalStyleAnchor: "冷色电影光",
  characterLocks: [],
  sceneLocks: [],
  segments: [
    {
      segmentIndex: 0,
      beatName: "逼近",
      durationSeconds: 10,
      shots: [
        {
          shotNo: 1,
          景别: "中景",
          构图: "双人对峙",
          运镜: "缓推",
          动作: "主角逼近一步",
          光效: "侧逆光",
          台词: "",
          音效: "脚步声",
        },
      ],
    },
    {
      segmentIndex: 1,
      beatName: "反击",
      durationSeconds: 5,
      shots: [
        {
          shotNo: "2-1",
          景别: "近景",
          构图: "越肩",
          运镜: "固定",
          动作: "对手抬眼",
          光效: "眼神光",
          台词: "现在轮到我。",
          音效: "低频骤停",
        },
      ],
    },
  ],
};

function masterNode(table: unknown = TABLE): VideoFlowNode {
  return {
    id: "master-1",
    type: "taskNode",
    position: { x: 100, y: 80 },
    data: {
      kind: "storyboardImage",
      productionLayer: "master_board",
      aspectRatio: "16:9",
      masterShotTable: table,
      sourceBookId: "book-1",
      materialChapter: "chapter-3",
    },
  };
}

function requirePlan(
  value: ReturnType<typeof planMasterStoryboardSplit>,
): MasterStoryboardSplitPlan {
  expect(value.ok).toBe(true);
  if (!value.ok) throw new Error(value.code);
  return value;
}

function asVideoNodes(value: unknown): VideoFlowNode[] {
  if (!Array.isArray(value)) throw new Error("nodes must be an array");
  return value.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error("node must be an object");
    }
    return node as VideoFlowNode;
  });
}

function asEdges(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("edges must be an array");
  return value.map((edge) => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
      throw new Error("edge must be an object");
    }
    return edge as Record<string, unknown>;
  });
}

describe("planMasterStoryboardSplit", () => {
  it("creates a deterministic skeleton that passes the real flow validator", () => {
    const plan = requirePlan(
      planMasterStoryboardSplit({
        masterBoardNodeId: "master-1",
        runId: "run-1",
        videoModel: "catalog-video-model",
        allowedDurationSeconds: [5, 10],
        nodes: [masterNode()],
        edges: [],
      }),
    );

    expect(plan.createNodes).toHaveLength(6);
    expect(plan.createEdges).toHaveLength(6);
    expect(plan.groupNodeId).toBe("group-run-1");
    const boards = plan.createNodes.filter((node) => node.data.kind === "storyboardImage");
    const videos = plan.createNodes.filter((node) => node.data.kind === "video");
    expect(boards).toHaveLength(2);
    expect(videos).toHaveLength(2);
    expect(boards.every((node) => node.data.promptNeedsFill === true)).toBe(true);
    expect(videos.every((node) => node.data.promptNeedsFill === true)).toBe(true);
    expect(boards.every((node) => !("prompt" in node.data) && !("imageModel" in node.data))).toBe(true);
    expect(videos.every((node) => !("prompt" in node.data))).toBe(true);
    expect(videos.map((node) => node.data.videoModel)).toEqual([
      "catalog-video-model",
      "catalog-video-model",
    ]);

    const applied = applyPublicFlowGraphPatch({
      current: { nodes: [masterNode()], edges: [] },
      patch: PublicFlowPatchRequestSchema.parse({
        createNodes: plan.createNodes,
        createEdges: plan.createEdges,
        patchNodeData: plan.patchNodeData,
      }),
    });
    expect(applied.stats.createdNodes).toBe(6);
    expect(applied.stats.createdEdges).toBe(6);
  });

  it("is idempotent only for matching structured identities", () => {
    const first = requirePlan(
      planMasterStoryboardSplit({
        masterBoardNodeId: "master-1",
        runId: "run-1",
        videoModel: "catalog-video-model",
        allowedDurationSeconds: [5, 10],
        nodes: [masterNode()],
        edges: [],
      }),
    );
    const applied = applyPublicFlowGraphPatch({
      current: { nodes: [masterNode()], edges: [] },
      patch: PublicFlowPatchRequestSchema.parse({
        createNodes: first.createNodes,
        createEdges: first.createEdges,
      }),
    });
    const second = requirePlan(
      planMasterStoryboardSplit({
        masterBoardNodeId: "master-1",
        runId: "run-1",
        videoModel: "catalog-video-model",
        allowedDurationSeconds: [5, 10],
        nodes: asVideoNodes(applied.data.nodes),
        edges: asEdges(applied.data.edges),
      }),
    );
    expect(second.createNodes).toEqual([]);
    expect(second.createEdges).toEqual([]);
    expect(second.reusedNodeIds).toHaveLength(5);
    expect(second.reusedEdgeIds).toHaveLength(6);
  });

  it("returns an explicit conflict instead of reusing a stable id with another identity", () => {
    const occupied: VideoFlowNode = {
      id: "video-run-1-0",
      type: "taskNode",
      parentId: "group-run-1",
      data: { kind: "video", clipRunId: "another-run", clipIndex: 0 },
    };
    const result = planMasterStoryboardSplit({
      masterBoardNodeId: "master-1",
      runId: "run-1",
      videoModel: "catalog-video-model",
      allowedDurationSeconds: [5, 10],
      nodes: [masterNode(), occupied],
      edges: [],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "master_storyboard_split_node_conflict",
      conflictingIds: ["video-run-1-0"],
    });
  });

  it("rejects durations outside the selected model's live catalog contract", () => {
    const result = planMasterStoryboardSplit({
      masterBoardNodeId: "master-1",
      runId: "run-1",
      videoModel: "catalog-video-model",
      allowedDurationSeconds: [5],
      nodes: [masterNode()],
      edges: [],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "master_shot_table_duration_unsupported",
      allowedDurationSeconds: [5],
      conflictingIds: ["0"],
    });
  });

  it("does not overwrite a different table already persisted on the master node", () => {
    const differentTable = {
      ...TABLE,
      title: "另一份表",
    };
    const result = planMasterStoryboardSplit({
      masterBoardNodeId: "master-1",
      runId: "run-1",
      videoModel: "catalog-video-model",
      allowedDurationSeconds: [5, 10],
      masterShotTable: differentTable,
      nodes: [masterNode()],
      edges: [],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "master_shot_table_write_conflict",
      conflictingIds: ["master-1"],
    });
  });
});
