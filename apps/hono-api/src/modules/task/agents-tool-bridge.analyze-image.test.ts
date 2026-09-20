import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildPublicVisionTaskRequest,
  describeExecutionImageReference,
  resolveExecutionImageReferences,
  runPublicTask,
  loadImageUnderstandingEvidence,
  shareImageAnalysis,
} = vi.hoisted(() => ({
  buildPublicVisionTaskRequest: vi.fn((input: unknown, params: unknown) => ({ input, params })),
  describeExecutionImageReference: vi.fn((reference: Record<string, unknown>) => {
    const { url: _url, ...visible } = reference;
    return { ...visible, mediaType: "image", ready: true };
  }),
  resolveExecutionImageReferences: vi.fn(),
  runPublicTask: vi.fn(),
  loadImageUnderstandingEvidence: vi.fn(),
  shareImageAnalysis: vi.fn(),
}));

vi.mock("./image-understanding-content", () => ({
  readImageUnderstandingContent: vi.fn(async () => ({ contentHash: "image-bytes-hash", imageData: "data:image/png;base64,YWJj" })),
}));
vi.mock("./image-understanding-cache", async (importOriginal) => ({
  ...await importOriginal<typeof import("./image-understanding-cache")>(), shareImageAnalysis,
}));
vi.mock("./image-understanding-cache.repo", () => ({ imageAnalysisCacheStore: vi.fn(() => ({})) }));

vi.mock("./image-understanding-evidence", () => ({ loadImageUnderstandingEvidence }));

vi.mock("../apiKey/apiKey.routes", () => ({ buildPublicVisionTaskRequest, runPublicTask }));
vi.mock("./agents-tool-bridge.image-reference-ids", () => ({
  describeExecutionImageReference,
  resolveExecutionImageReferences,
}));

import { AppError } from "../../middleware/error";
import { createHash } from "node:crypto";
import { IMAGE_UNDERSTANDING_MODEL_KEY } from "./media-understanding-model";

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
    loadImageUnderstandingEvidence.mockReset();
    loadImageUnderstandingEvidence.mockResolvedValue([]);
    shareImageAnalysis.mockReset();
    shareImageAnalysis.mockImplementation((input: { execute: () => Promise<unknown> }) => input.execute());
  });

  it("reuses a server-owned style image receipt without paying again", async () => {
    const provenance = { taskId: "style-analysis-existing", modelKey: IMAGE_UNDERSTANDING_MODEL_KEY,
      promptHash: createHash("sha256").update("提取风格").digest("hex") };
    shareImageAnalysis.mockResolvedValue({ text: "水墨画风", provenance });
    const result = await analyzeImageForAgent({
      c: { env: { DB: {} }, get: () => null } as never, requestUserId: "user-1", row: null,
      internalImageUrl: "https://cdn.example/style.png", bodyArgs: { prompt: "提取风格" },
    });
    expect(result.text).toBe("水墨画风");
    expect(result.reference).toBeNull();
    expect(runPublicTask).not.toHaveBeenCalled();
  });

  it("reuses the exact successful question/model receipt without a paid request", async () => {
    const prompt = "read material uncertainty";
    const provenance = { version: 1, mediaType: "image", modelKey: IMAGE_UNDERSTANDING_MODEL_KEY,
      taskId: "existing-task", referenceId: resolvedNodeReference.referenceId,
      promptHash: createHash("sha256").update(prompt).digest("hex"), analysisHash: "analysis-hash",
      analyzedAt: "2026-09-08T10:00:00Z" };
    shareImageAnalysis.mockResolvedValue({ text: "Material unknown", provenance });
    const result = await analyzeImageForAgent({ c: { env: { DB: {} }, get: () => null } as never,
      requestUserId: "user-1", row: null, bodyArgs: { nodeId: "node-image-1", prompt } });
    expect(result.text).toBe("Material unknown");
    expect(result.provenance.taskId).toBe("existing-task");
    expect(runPublicTask).not.toHaveBeenCalled();
  });

  it("does not submit another paid request when receipt lookup fails", async () => {
    shareImageAnalysis.mockRejectedValue(new Error("storage unavailable"));
    await expect(analyzeImageForAgent({ c: { env: { DB: {} }, get: () => null } as never,
      requestUserId: "user-1", row: null, bodyArgs: { nodeId: "node-image-1" } }))
      .rejects.toThrow("storage unavailable");
    expect(runPublicTask).not.toHaveBeenCalled();
  });

  it("resolves nodeId server-side, always uses doubao-seed-2-1-turbo-260628, and returns no URL", async () => {
    runPublicTask.mockResolvedValue({ result: { id: "vision-task-1", status: "succeeded", raw: { text: "vision facts" } } });

    const result = await analyzeImageForAgent({
      c: { env: { DB: {} }, get: () => null } as never,
      requestUserId: "user-1",
      row: null,
      bodyArgs: {
        nodeId: "node-image-1",
        model: "gpt-5.5",
        modelKey: "gemini-3.1-pro-preview",
      },
    });

    expect(resolveExecutionImageReferences).toHaveBeenCalledWith({
      c: { env: { DB: {} }, get: expect.any(Function) },
      ownerId: "user-1",
      row: null,
      nodeIds: ["node-image-1"],
      assetIds: [],
    });
    expect(buildPublicVisionTaskRequest).toHaveBeenCalledWith(
      {},
      {
        imageUrl: resolvedNodeReference.url,
        imageData: "data:image/png;base64,YWJj",
        prompt: expect.any(String),
      },
    );
    expect(runPublicTask).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      text: "vision facts",
      provenance: {
        version: 1,
        mediaType: "image",
        modelKey: IMAGE_UNDERSTANDING_MODEL_KEY,
        taskId: "vision-task-1",
        referenceId: "node:node-image-1",
        promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        analysisHash: createHash("sha256").update("vision facts").digest("hex"),
        analyzedAt: expect.any(String),
      },
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
    runPublicTask.mockResolvedValue({ result: { id: "vision-task-1", status: "succeeded", raw: { text: "asset facts" } } });

    await analyzeImageForAgent({
      c: { env: { DB: {} }, get: () => null } as never,
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
        c: { env: { DB: {} }, get: () => null } as never,
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

  it("fails explicitly when the configured vision model returns no text", async () => {
    runPublicTask.mockResolvedValue({ result: { id: "vision-task-1", status: "succeeded", raw: {} } });

    await expect(
      analyzeImageForAgent({
        c: { env: { DB: {} }, get: () => null } as never,
        requestUserId: "user-1",
        row: null,
        bodyArgs: { nodeId: "node-image-1" },
      }),
    ).rejects.toMatchObject({
      code: "agents_tool_analyze_image_empty",
      details: { modelKey: "doubao-seed-2-1-turbo-260628" },
    });
    expect(runPublicTask).toHaveBeenCalledTimes(1);
  });
  it("preserves model-unavailable evidence without retrying or switching models", async () => {
    const error = new AppError("configured model unavailable", {
      code: "new_api_model_disabled",
      details: { model: IMAGE_UNDERSTANDING_MODEL_KEY, upstreamRequestAttempted: false },
    });
    runPublicTask.mockRejectedValue(error);
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(analyzeImageForAgent({
        c: { env: { DB: {} }, get: () => null } as never, requestUserId: "user-1", row: null,
        bodyArgs: { nodeId: "node-image-1", prompt: "Read the label" },
      })).rejects.toBe(error);
      expect(runPublicTask).toHaveBeenCalledTimes(1);
      expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('"errorCode":"new_api_model_disabled"'));
      expect(diagnostic.mock.calls.flat().join()).not.toContain("https://");
    } finally { diagnostic.mockRestore(); }
  });

  it.each(["pending", "failed"])("does not promote %s task text to successful analysis", async (status) => {
    runPublicTask.mockResolvedValue({ result: { id: "vision-task-1", status, raw: { text: "not a successful observation" } } });
    await expect(analyzeImageForAgent({
      c: { env: { DB: {} }, get: () => null } as never, requestUserId: "user-1", row: null,
      bodyArgs: { nodeId: "node-image-1" },
    })).rejects.toMatchObject({ code: "agents_tool_analyze_image_unsatisfied", terminal: false });
    expect(runPublicTask).toHaveBeenCalledTimes(1);
  });

});
