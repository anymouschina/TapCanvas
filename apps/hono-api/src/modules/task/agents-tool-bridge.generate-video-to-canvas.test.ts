import { describe, expect, it, vi } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import type { AppContext } from "../../types";

const {
  mockedRunPublicTask,
  mockedFetchTaskResultForPolling,
  mockedUpdateFlow,
  mockedUpdateFlowByIdUnsafe,
  mockedCreateFlowVersion,
} = vi.hoisted(() => ({
  mockedRunPublicTask: vi.fn(),
  mockedFetchTaskResultForPolling: vi.fn(),
  mockedUpdateFlow: vi.fn(),
  mockedUpdateFlowByIdUnsafe: vi.fn(),
  mockedCreateFlowVersion: vi.fn(),
}));

vi.mock("../apiKey/apiKey.routes", () => ({
  runPublicTask: mockedRunPublicTask,
}));

vi.mock("./task.polling", () => ({
  fetchTaskResultForPolling: mockedFetchTaskResultForPolling,
}));

vi.mock("../flow/flow.repo", async () => {
  const actual = await vi.importActual<typeof import("../flow/flow.repo")>("../flow/flow.repo");
  return {
    ...actual,
    updateFlow: mockedUpdateFlow,
    updateFlowByIdUnsafe: mockedUpdateFlowByIdUnsafe,
    createFlowVersion: mockedCreateFlowVersion,
  };
});

import { generateVideoToCanvas } from "./agents-tool-bridge.generate-video-to-canvas";

describe("generateVideoToCanvas", () => {
  it("generates a video and writes the succeeded node into the flow", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "veo",
      result: {
        id: "task-video-1",
        kind: "image_to_video",
        status: "running",
        assets: [],
        raw: {},
      },
    });
    mockedFetchTaskResultForPolling.mockResolvedValueOnce({
      ok: true,
      vendor: "veo",
      result: {
        id: "task-video-1",
        kind: "image_to_video",
        status: "succeeded",
        assets: [
          {
            type: "video",
            url: "https://example.com/generated.mp4",
            thumbnailUrl: "https://example.com/generated.jpg",
          },
        ],
        raw: {},
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    const result = await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 240, y: 96 },
          data: {
            kind: "composeVideo",
            label: "第一段视频",
            prompt: "旧屋被楼盘包围，镜头缓慢推进",
            negativePrompt: "blurry",
            videoModel: "veo-3.1",
            aspect: "16:9",
            videoDurationSeconds: 8,
            veoFirstFrameUrl: "https://example.com/first-frame.jpg",
          },
        },
      },
    });

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        vendor: "auto",
        request: expect.objectContaining({
          kind: "image_to_video",
          prompt: "旧屋被楼盘包围，镜头缓慢推进",
          negativePrompt: "blurry",
          extras: expect.objectContaining({
            modelKey: "veo-3.1",
            aspectRatio: "16:9",
            durationSeconds: 8,
            firstFrameUrl: "https://example.com/first-frame.jpg",
            persistAssets: true,
          }),
        }),
      }),
    );
    expect(mockedFetchTaskResultForPolling).toHaveBeenCalledTimes(1);
    expect(result.videoUrl).toBe("https://example.com/generated.mp4");
    expect(result.thumbnailUrl).toBe("https://example.com/generated.jpg");
    expect(result.vendor).toBe("veo");
    expect(result.taskId).toBe("task-video-1");
    expect(mockedUpdateFlow).toHaveBeenCalledTimes(1);
    const updateArgs = mockedUpdateFlow.mock.calls[0]?.[1] as {
      data: string;
    };
    const nextFlow = JSON.parse(updateArgs.data) as {
      nodes: Array<{ data?: Record<string, unknown> }>;
    };
    expect(nextFlow.nodes).toHaveLength(1);
    expect(nextFlow.nodes[0]?.data).toMatchObject({
      kind: "composeVideo",
      label: "第一段视频",
      status: "success",
      videoUrl: "https://example.com/generated.mp4",
      videoThumbnailUrl: "https://example.com/generated.jpg",
      videoPrimaryIndex: 0,
      videoDurationSeconds: 8,
      taskId: "task-video-1",
      videoTaskId: "task-video-1",
      vendor: "veo",
      videoModelVendor: "veo",
      videoModel: "veo-3.1",
    });
    expect(nextFlow.nodes[0]?.data?.videoResults).toEqual([
      {
        url: "https://example.com/generated.mp4",
        thumbnailUrl: "https://example.com/generated.jpg",
        title: "第一段视频",
        duration: 8,
      },
    ]);
    expect(mockedCreateFlowVersion).toHaveBeenCalledTimes(1);
  });
});
