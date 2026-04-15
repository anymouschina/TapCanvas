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

import { generateImageToCanvas } from "./agents-tool-bridge.generate-image-to-canvas";

describe("generateImageToCanvas", () => {
  it("generates an image and writes the succeeded node into the flow", async () => {
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
      vendor: "apimart",
      result: {
        id: "task-1",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/generated.jpg" }],
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

    const result = await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "image",
            label: "第一帧",
            prompt: "一栋老屋被新楼盘包围",
            negativePrompt: "blurry",
            modelAlias: "nano-banana-pro",
            aspectRatio: "16:9",
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
          kind: "text_to_image",
          prompt: "一栋老屋被新楼盘包围",
          negativePrompt: "blurry",
          extras: expect.objectContaining({
            modelAlias: "nano-banana-pro",
            aspectRatio: "16:9",
            persistAssets: true,
          }),
        }),
      }),
    );
    expect(mockedFetchTaskResultForPolling).not.toHaveBeenCalled();
    expect(result.imageUrl).toBe("https://example.com/generated.jpg");
    expect(result.vendor).toBe("apimart");
    expect(result.taskId).toBe("task-1");
    expect(mockedUpdateFlow).toHaveBeenCalledTimes(1);
    const updateArgs = mockedUpdateFlow.mock.calls[0]?.[1] as {
      data: string;
    };
    const nextFlow = JSON.parse(updateArgs.data) as {
      nodes: Array<{ data?: Record<string, unknown> }>;
    };
    expect(nextFlow.nodes).toHaveLength(1);
    expect(nextFlow.nodes[0]?.data).toMatchObject({
      kind: "image",
      label: "第一帧",
      status: "success",
      imageUrl: "https://example.com/generated.jpg",
      imagePrimaryIndex: 0,
      taskId: "task-1",
      vendor: "apimart",
      imageModel: "nano-banana-pro",
    });
    expect(mockedCreateFlowVersion).toHaveBeenCalledTimes(1);
  });

  it("defaults image generation modelAlias to gemini-3.1-flash-image-preview when omitted", async () => {
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
      vendor: "yunwu",
      result: {
        id: "task-2",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/defaulted.jpg" }],
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

    await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "image",
            label: "第一帧",
            prompt: "一栋老屋被新楼盘包围",
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
          kind: "text_to_image",
          extras: expect.objectContaining({
            modelAlias: "gemini-3.1-flash-image-preview",
            persistAssets: true,
          }),
        }),
      }),
    );
  });

  it("appends camera and lighting controls into the executable prompt when provided", async () => {
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
      vendor: "yunwu",
      result: {
        id: "task-3",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/camera-light.jpg" }],
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

    await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "imageEdit",
            label: "镜头编辑",
            prompt: "保留人物和场景的连续性",
            referenceImages: ["https://example.com/source.jpg"],
            imageCameraControl: {
              enabled: true,
              azimuthDeg: 90,
              elevationDeg: 18,
              distance: 3.2,
            },
            imageLightingRig: {
              main: {
                enabled: true,
                azimuthDeg: 45,
                elevationDeg: 16,
                intensity: 50,
                colorHex: "#FFFFFF",
              },
            },
          },
        },
      },
    });

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          kind: "image_edit",
          prompt: expect.stringContaining("Camera control: right side view"),
        }),
      }),
    );
    const requestPrompt = mockedRunPublicTask.mock.calls.at(-1)?.[2]?.request?.prompt as string;
    expect(requestPrompt).toContain("Lighting control:");
    expect(requestPrompt).toContain("Main key light:");
  });

  it("auto-connects matched reference nodes when image_edit is written into the flow", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({
        nodes: [
          {
            id: "ref-1",
            type: "taskNode",
            position: { x: 0, y: 0 },
            data: {
              kind: "image",
              label: "参考图",
              imageUrl: "https://example.com/assets/ref-image.jpg?token=abc",
            },
          },
        ],
        edges: [],
      }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "apimart",
      result: {
        id: "task-3",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/generated-edit.jpg" }],
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

    await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          id: "frame-1",
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "image",
            label: "关键帧",
            prompt: "少年方源在夜雨窗前沉思",
            referenceImages: ["https://example.com/assets/ref-image.jpg?token=xyz"],
          },
        },
      },
    });

    const updateArgs = mockedUpdateFlow.mock.calls.at(-1)?.[1] as {
      data: string;
    };
    const nextFlow = JSON.parse(updateArgs.data) as {
      nodes: Array<{ id?: string; data?: Record<string, unknown> }>;
      edges: Array<Record<string, unknown>>;
    };
    const targetNode = nextFlow.nodes.find((node) => node.id === "frame-1");

    expect(nextFlow.edges).toEqual([
      expect.objectContaining({
        source: "ref-1",
        target: "frame-1",
        sourceHandle: "out-image",
        targetHandle: "in-image",
      }),
    ]);
    expect(targetNode?.data?.upstreamReferenceOrder).toEqual(["ref-1"]);
  });
});
