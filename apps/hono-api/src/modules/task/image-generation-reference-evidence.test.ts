import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  task_results: {
    findMany: vi.fn(),
  },
  vendor_api_call_logs: {
    findMany: vi.fn(),
  },
};

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => prisma,
}));

import {
  loadImageGenerationReferenceUrlsByTaskId,
  readImageGenerationReferenceUrls,
  readImageGenerationUpstreamTaskId,
} from "./image-generation-reference-evidence";

describe("image generation reference evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.task_results.findMany.mockResolvedValue([]);
    prisma.vendor_api_call_logs.findMany.mockResolvedValue([]);
  });

  it("reads the exact image references submitted in the vendor request", () => {
    expect(
      readImageGenerationReferenceUrls(
        JSON.stringify({
          vendor: "newapi",
          request: {
            kind: "image_edit",
            extras: {
              referenceImages: [
                "https://cdn.test/blocking.png",
                "https://cdn.test/character.png",
                "https://cdn.test/blocking.png",
              ],
              assetInputs: [
                { url: "https://cdn.test/style.png", role: "style" },
                { url: "data:image/png;base64,invalid", role: "reference" },
              ],
            },
          },
        }),
      ),
    ).toEqual([
      "https://cdn.test/blocking.png",
      "https://cdn.test/character.png",
      "https://cdn.test/style.png",
    ]);
  });

  it("does not infer evidence from malformed logs or unrelated fields", () => {
    expect(readImageGenerationReferenceUrls("not-json")).toEqual([]);
    expect(
      readImageGenerationReferenceUrls(
        JSON.stringify({ referenceImages: ["https://cdn.test/not-the-request.png"] }),
      ),
    ).toEqual([]);
  });

  it("reads only the exact structural upstream task id", () => {
    expect(
      readImageGenerationUpstreamTaskId(
        JSON.stringify({ raw: { upstreamTaskId: " upstream-image-1 " } }),
      ),
    ).toBe("upstream-image-1");
    expect(readImageGenerationUpstreamTaskId("not-json")).toBeNull();
    expect(
      readImageGenerationUpstreamTaskId(JSON.stringify({ upstreamTaskId: "wrong-level" })),
    ).toBeNull();
    expect(readImageGenerationUpstreamTaskId(JSON.stringify({ raw: {} }))).toBeNull();
  });

  it("maps vendor request evidence from an upstream task id back to the local task id", async () => {
    prisma.task_results.findMany.mockResolvedValue([
      {
        task_id: "local-task-1",
        result: JSON.stringify({ raw: { upstreamTaskId: "upstream-task-1" } }),
      },
    ]);
    prisma.vendor_api_call_logs.findMany.mockResolvedValue([
      {
        task_id: "upstream-task-1",
        request_json: JSON.stringify({
          request: {
            extras: {
              referenceImages: ["https://cdn.test/blocking.png"],
            },
          },
        }),
      },
    ]);

    const result = await loadImageGenerationReferenceUrlsByTaskId({
      ownerId: " owner-1 ",
      taskIds: [" local-task-1 "],
    });

    expect(result.get("local-task-1")).toEqual(["https://cdn.test/blocking.png"]);
    expect(prisma.task_results.findMany).toHaveBeenCalledWith({
      where: { user_id: "owner-1", task_id: { in: ["local-task-1"] } },
      select: { task_id: true, result: true },
    });
    expect(prisma.vendor_api_call_logs.findMany).toHaveBeenCalledWith({
      where: {
        user_id: "owner-1",
        task_id: { in: ["local-task-1", "upstream-task-1"] },
      },
      select: { task_id: true, request_json: true },
    });
  });

  it("ignores malformed or absent upstream ids and keeps lookup owner-scoped", async () => {
    prisma.task_results.findMany.mockResolvedValue([
      { task_id: "local-task-1", result: "not-json" },
      { task_id: "local-task-2", result: JSON.stringify({ raw: {} }) },
    ]);

    const result = await loadImageGenerationReferenceUrlsByTaskId({
      ownerId: "owner-2",
      taskIds: ["local-task-1", "local-task-2"],
    });

    expect(result).toEqual(new Map());
    expect(prisma.vendor_api_call_logs.findMany).toHaveBeenCalledWith({
      where: {
        user_id: "owner-2",
        task_id: { in: ["local-task-1", "local-task-2"] },
      },
      select: { task_id: true, request_json: true },
    });
  });

  it("aggregates direct and upstream vendor rows without duplicate URLs", async () => {
    prisma.task_results.findMany.mockResolvedValue([
      {
        task_id: "local-task-1",
        result: JSON.stringify({ raw: { upstreamTaskId: "upstream-task-1" } }),
      },
    ]);
    prisma.vendor_api_call_logs.findMany.mockResolvedValue([
      {
        task_id: "local-task-1",
        request_json: JSON.stringify({
          request: {
            extras: {
              referenceImages: ["https://cdn.test/direct.png", "https://cdn.test/shared.png"],
            },
          },
        }),
      },
      {
        task_id: "upstream-task-1",
        request_json: JSON.stringify({
          request: {
            extras: {
              referenceImages: ["https://cdn.test/shared.png"],
              assetInputs: [{ url: "https://cdn.test/upstream.png" }],
            },
          },
        }),
      },
    ]);

    const result = await loadImageGenerationReferenceUrlsByTaskId({
      ownerId: "owner-1",
      taskIds: ["local-task-1"],
    });

    expect(result.get("local-task-1")).toEqual([
      "https://cdn.test/direct.png",
      "https://cdn.test/shared.png",
      "https://cdn.test/upstream.png",
    ]);
  });
});
