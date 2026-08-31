import { describe, expect, it, vi } from "vitest";
import {
  canProjectFinalVideoRun,
  collectFinalVideoDeliveryEvidence,
  projectFinalVideoRunsFromCanvas,
  readDurableVideoUrlFromNodeData,
  syncFinalVideoStatusNodes,
} from "./video-run.delivery-projection";

const finalNode = (input: {
  runId: string;
  videoUrl: string;
  nodeId?: string;
  kind?: string;
  status?: string;
}) => ({
  id: input.nodeId ?? `film-${input.runId}`,
  data: {
    kind: input.kind ?? "videoCompose",
    status: input.status ?? "success",
    clipRunId: input.runId,
    videoUrl: input.videoUrl,
  },
});

describe("collectFinalVideoDeliveryEvidence", () => {
  it("accepts a durable final compose asset and rejects blob or unfinished nodes", () => {
    expect(
      collectFinalVideoDeliveryEvidence({
        nodes: [
          finalNode({ runId: "run-1", videoUrl: "https://cdn/final.mp4" }),
          finalNode({ runId: "run-2", videoUrl: "blob:temporary" }),
          finalNode({ runId: "run-3", videoUrl: "https://cdn/pending.mp4", status: "clips_ready" }),
        ],
      }),
    ).toEqual([
      { runId: "run-1", nodeId: "film-run-1", videoUrl: "https://cdn/final.mp4" },
    ]);
  });

  it("prefers the orchestrator-owned canonical film node over an archived result", () => {
    expect(
      collectFinalVideoDeliveryEvidence({
        nodes: [
          finalNode({ runId: "run-1", nodeId: "archive", videoUrl: "https://cdn/old.mp4" }),
          finalNode({ runId: "run-1", videoUrl: "https://cdn/final.mp4" }),
        ],
      }),
    ).toEqual([
      { runId: "run-1", nodeId: "film-run-1", videoUrl: "https://cdn/final.mp4" },
    ]);
  });

  it("accepts the canonical primary video result when the node has no duplicate top-level URL", () => {
    expect(
      collectFinalVideoDeliveryEvidence({
        nodes: [
          finalNode({ runId: "run-1", nodeId: "archive", videoUrl: "https://cdn/old.mp4" }),
          {
            id: "film-run-1",
            data: {
              kind: "composeVideo",
              status: "success",
              clipRunId: "run-1",
              videoResults: [
                { url: "blob:http://localhost/transient" },
                { url: "https://cdn/final.mp4" },
              ],
              videoPrimaryIndex: 1,
            },
          },
        ],
      }),
    ).toEqual([
      { runId: "run-1", nodeId: "film-run-1", videoUrl: "https://cdn/final.mp4" },
    ]);
  });
});

describe("readDurableVideoUrlFromNodeData", () => {
  it("rejects transient values and deterministically reads the first durable result", () => {
    expect(
      readDurableVideoUrlFromNodeData({
        videoUrl: "blob:http://localhost/direct",
        videoResults: [
          { url: "blob:http://localhost/result" },
          { url: "https://cdn/final.mp4" },
        ],
      }),
    ).toBe("https://cdn/final.mp4");
  });
});

describe("canProjectFinalVideoRun", () => {
  const evidence = { runId: "run-1", nodeId: "film-run-1", videoUrl: "https://cdn/final.mp4" };
  const run = {
    id: "run-1",
    owner_id: "owner-1",
    chapter_id: "chapter-1",
    state: "cancelled",
    total_clips: 8,
    clips_done: 8,
    created_at: "2026-07-22T10:00:00.000Z",
    completed_at: null,
  };

  it("allows recovery when all structural delivery facts agree", () => {
    expect(canProjectFinalVideoRun({ evidence, run, ownerId: "owner-1", chapterId: "chapter-1" })).toBe(true);
  });

  it("rejects incomplete clips, run mismatch, and chapter mismatch", () => {
    expect(canProjectFinalVideoRun({ evidence, run: { ...run, clips_done: 7 }, ownerId: "owner-1", chapterId: "chapter-1" })).toBe(false);
    expect(canProjectFinalVideoRun({ evidence, run: { ...run, id: "other" }, ownerId: "owner-1", chapterId: "chapter-1" })).toBe(false);
    expect(canProjectFinalVideoRun({ evidence, run, ownerId: "owner-1", chapterId: "chapter-2" })).toBe(false);
  });
});

describe("projectFinalVideoRunsFromCanvas", () => {
  it("recovers an erroneously cancelled complete run by CAS", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "run-1",
      owner_id: "owner-1",
      chapter_id: "chapter-1",
      state: "cancelled",
      total_clips: 8,
      clips_done: 8,
      created_at: "2026-07-22T10:00:00.000Z",
      completed_at: null,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const result = await projectFinalVideoRunsFromCanvas({
      db: { video_runs: { findFirst, updateMany } },
      flow: { nodes: [finalNode({ runId: "run-1", videoUrl: "https://cdn/final.mp4" })] },
      ownerId: "owner-1",
      chapterId: "chapter-1",
      nowIso: "2026-07-22T12:00:00.000Z",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "run-1", state: "cancelled", total_clips: 8, clips_done: 8 }),
        data: expect.objectContaining({ state: "concatenated", error_message: null }),
      }),
    );
    expect(result).toEqual([
      {
        runId: "run-1",
        runCreatedAt: "2026-07-22T10:00:00.000Z",
        videoUrl: "https://cdn/final.mp4",
        totalClips: 8,
        clipsDone: 8,
        completedAt: "2026-07-22T12:00:00.000Z",
        stateChanged: true,
      },
    ]);
  });

  it("does not update when the run is incomplete", async () => {
    const updateMany = vi.fn();
    const result = await projectFinalVideoRunsFromCanvas({
      db: {
        video_runs: {
          findFirst: vi.fn().mockResolvedValue({
            id: "run-1",
            owner_id: "owner-1",
            chapter_id: "chapter-1",
            state: "video_success",
            total_clips: 8,
            clips_done: 7,
            created_at: "2026-07-22T10:00:00.000Z",
            completed_at: null,
          }),
          updateMany,
        },
      },
      flow: { nodes: [finalNode({ runId: "run-1", videoUrl: "https://cdn/final.mp4" })] },
      ownerId: "owner-1",
      chapterId: "chapter-1",
      nowIso: "2026-07-22T12:00:00.000Z",
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("is idempotent once the run is already concatenated", async () => {
    const updateMany = vi.fn();
    const result = await projectFinalVideoRunsFromCanvas({
      db: {
        video_runs: {
          findFirst: vi.fn().mockResolvedValue({
            id: "run-1",
            owner_id: "owner-1",
            chapter_id: "chapter-1",
            state: "concatenated",
            total_clips: 8,
            clips_done: 8,
            created_at: "2026-07-22T10:00:00.000Z",
            completed_at: "2026-07-22T11:59:00.000Z",
          }),
          updateMany,
        },
      },
      flow: { nodes: [finalNode({ runId: "run-1", videoUrl: "https://cdn/final.mp4" })] },
      ownerId: "owner-1",
      chapterId: "chapter-1",
      nowIso: "2026-07-22T12:00:00.000Z",
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        runId: "run-1",
        runCreatedAt: "2026-07-22T10:00:00.000Z",
        videoUrl: "https://cdn/final.mp4",
        totalClips: 8,
        clipsDone: 8,
        completedAt: "2026-07-22T11:59:00.000Z",
        stateChanged: false,
      },
    ]);
  });
});

describe("syncFinalVideoStatusNodes", () => {
  const run = {
    runId: "run-1",
    runCreatedAt: "2026-07-22T10:00:00.000Z",
    videoUrl: "https://cdn/final.mp4",
    totalClips: 8,
    clipsDone: 8,
    completedAt: "2026-07-22T12:00:00.000Z",
    stateChanged: false,
  };

  it("replaces stale progress facts while preserving unrelated node data", () => {
    const result = syncFinalVideoStatusNodes({
      flow: {
        nodes: [
          {
            id: "video-run-status",
            type: "taskNode",
            position: { x: 20, y: 30 },
            data: {
              kind: "text",
              managedProjection: "video_run_status",
              runId: "run-1",
              runCreatedAt: "2026-07-22T10:00:00.000Z",
              prompt: "5/8 镜头完成\n正在生成",
              productionState: "scheduled",
              textResults: [{ text: "keep" }],
            },
          },
        ],
        edges: [],
      },
      runs: [run],
    });

    expect(result.upsertNodes).toHaveLength(1);
    expect(result.flow.nodes[0]).toMatchObject({
      position: { x: 20, y: 30 },
      data: {
        authoringState: "authoring_done",
        productionState: "concatenated",
        videoUrl: "https://cdn/final.mp4",
        textResults: [{ text: "keep" }],
      },
    });
  });

  it("is idempotent when the status node already carries the final facts", () => {
    const flow = {
      nodes: [
        {
          id: "video-run-status",
          data: {
            kind: "text",
            label: "整片生成",
            prompt: "整片已完成\nhttps://cdn/final.mp4",
            managedProjection: "video_run_status",
            runId: "run-1",
            runCreatedAt: "2026-07-22T10:00:00.000Z",
            authoringState: "authoring_done",
            productionState: "concatenated",
            videoUrl: "https://cdn/final.mp4",
            pendingUserInput: null,
          },
        },
      ],
      edges: [],
    };
    const result = syncFinalVideoStatusNodes({
      flow,
      runs: [run],
    });

    expect(result.flow).toBe(flow);
    expect(result.upsertNodes).toEqual([]);
  });
});
