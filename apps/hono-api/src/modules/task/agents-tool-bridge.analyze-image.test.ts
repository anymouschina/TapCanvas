import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildPublicVisionTaskRequest,
  describeExecutionImageReference,
  resolveExecutionImageReferences,
  runPublicTask,
} = vi.hoisted(() => ({
  buildPublicVisionTaskRequest: vi.fn((input: unknown, params: unknown) => ({ input, params })),
  describeExecutionImageReference: vi.fn((reference: Record<string, unknown>) => {
    const { url: _url, ...visible } = reference;
    return { ...visible, mediaType: "image", ready: true };
  }),
  resolveExecutionImageReferences: vi.fn(),
  runPublicTask: vi.fn(),
}));

vi.mock("../apiKey/apiKey.routes", () => ({ buildPublicVisionTaskRequest, runPublicTask }));
vi.mock("./agents-tool-bridge.image-reference-ids", () => ({
  describeExecutionImageReference,
  resolveExecutionImageReferences,
}));

import { analyzeImageForAgent } from "./agents-tool-bridge.analyze-image";

const resolvedNodeReference = {
  referenceId: "node:node-image-1",
  source: "node" as const,
  nodeId: "node-image-1",
  assetId: "asset-image-1",
  assetRefId: null,
  name: "紫霄宫全局画风",
  url: "https://file.beqlee.icu/style.png",
};

describe("analyzeImageForAgent", () => {
  beforeEach(() => {
    buildPublicVisionTaskRequest.mockClear();
    describeExecutionImageReference.mockClear();
    resolveExecutionImageReferences.mockReset();
    resolveExecutionImageReferences.mockResolvedValue([resolvedNodeReference]);
    runPublicTask.mockReset();
  });

  it("resolves nodeId server-side, always uses gpt-5.6-luna, and returns no URL", async () => {
    runPublicTask.mockResolvedValue({ result: { raw: { text: "vision facts" } } });

    const result = await analyzeImageForAgent({
      c: {} as never,
      requestUserId: "user-1",
      row: null,
      bodyArgs: {
        nodeId: "node-image-1",
        model: "gpt-5.5",
        modelKey: "gemini-3.1-pro-preview",
      },
    });

    expect(resolveExecutionImageReferences).toHaveBeenCalledWith({
      c: {},
      ownerId: "user-1",
      row: null,
      nodeIds: ["node-image-1"],
      assetIds: [],
    });
    expect(buildPublicVisionTaskRequest).toHaveBeenCalledWith(
      {},
      {
        imageUrl: resolvedNodeReference.url,
        imageData: null,
        prompt: expect.any(String),
      },
    );
    expect(runPublicTask).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      text: "vision facts",
      reference: {
        referenceId: "node:node-image-1",
        source: "node",
        nodeId: "node-image-1",
        assetId: "asset-image-1",
        assetRefId: null,
        name: "紫霄宫全局画风",
        mediaType: "image",
        ready: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it("accepts an assetId and passes it through the same resolver", async () => {
    runPublicTask.mockResolvedValue({ result: { raw: { text: "asset facts" } } });

    await analyzeImageForAgent({
      c: {} as never,
      requestUserId: "user-1",
      row: null,
      bodyArgs: { assetId: "asset-image-1" },
    });

    expect(resolveExecutionImageReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeIds: [],
        assetIds: ["asset-image-1"],
      }),
    );
  });

  it.each([
    { label: "neither reference", bodyArgs: {} },
    {
      label: "both references",
      bodyArgs: { nodeId: "node-image-1", assetId: "asset-image-1" },
    },
  ])("fails explicitly for $label", async ({ bodyArgs }) => {
    await expect(
      analyzeImageForAgent({
        c: {} as never,
        requestUserId: "user-1",
        row: null,
        bodyArgs,
      }),
    ).rejects.toMatchObject({
      code: "agents_tool_analyze_image_reference_required",
    });
    expect(resolveExecutionImageReferences).not.toHaveBeenCalled();
    expect(runPublicTask).not.toHaveBeenCalled();
  });

  it("fails explicitly when doubao lite returns no text", async () => {
    runPublicTask.mockResolvedValue({ result: { raw: {} } });

    await expect(
      analyzeImageForAgent({
        c: {} as never,
        requestUserId: "user-1",
        row: null,
        bodyArgs: { nodeId: "node-image-1" },
      }),
    ).rejects.toMatchObject({
      code: "agents_tool_analyze_image_empty",
      details: { modelKey: "gpt-5.6-luna" },
    });
    expect(runPublicTask).toHaveBeenCalledTimes(1);
  });
});
