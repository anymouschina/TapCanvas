import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listModelCatalogModels: vi.fn(),
  listNewApiModels: vi.fn(),
}));

vi.mock("../model-catalog/model-catalog.service", () => ({
  listModelCatalogModels: mocks.listModelCatalogModels,
}));

vi.mock("../new-api-models/new-api-models.service", () => ({
  isNonSelectableCatalogModel: (name: string) => name === "volc-enhance-video",
  isSelectableNewApiModel: () => true,
  listNewApiModels: mocks.listNewApiModels,
}));

vi.mock("../new-api-models/new-api-model-identity", () => ({
  matchesNewApiRuntimeModelIdentity: (
    model: { modelName?: string; requestModelKey?: string },
    identity: string,
  ) => model.modelName === identity || model.requestModelKey === identity,
}));

import type { AppContext } from "../../types";
import {
  buildVideoFinishingBillingSpecKey,
  parseVideoFinishingContract,
  parseVideoFinishingRequest,
  resolveVideoFinishingContract,
} from "./video-orchestrator.finishing-contract";

const context = { env: {} } as unknown as AppContext;

const request = {
  kind: "video_enhance" as const,
  modelKey: "volc-enhance-video",
  toolVersion: "professional",
  scene: "short_series",
  resolution: "1080p",
  fps: 30,
};

describe("video finishing contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listModelCatalogModels.mockResolvedValue([
      { modelKey: "volc-enhance-video", modelAlias: "volc-enhance-video" },
    ]);
    mocks.listNewApiModels.mockResolvedValue([
      {
        modelName: "volc-enhance-video",
        requestModelKey: "volc-enhance-video",
        meta: {
          runtimeParameters: [
            {
              key: "tool_version",
              type: "enum",
              options: [
                { value: "standard", label: "Standard" },
                { value: "professional", label: "Professional" },
              ],
            },
            {
              key: "scene",
              type: "enum",
              options: [{ value: "short_series", label: "Short series" }],
            },
            {
              key: "resolution",
              type: "enum",
              options: [{ value: "1080p", label: "1080p" }],
            },
            { key: "fps", type: "number", min: 1, max: 120 },
          ],
        },
      },
    ]);
  });

  it("requires every explicit semantic choice and does not invent defaults", () => {
    expect(parseVideoFinishingRequest(request)).toEqual(request);
    expect(parseVideoFinishingRequest({ ...request, scene: "" })).toBeNull();
    expect(parseVideoFinishingRequest({ ...request, kind: "unknown" })).toBeNull();
  });

  it("derives the billing band from frame rate rather than duration", () => {
    expect(buildVideoFinishingBillingSpecKey(request)).toBe("professional:1080p:lte30");
    expect(buildVideoFinishingBillingSpecKey({ ...request, fps: 60 })).toBe(
      "professional:1080p:gt30",
    );
  });

  it("freezes only values present in the fresh runtime parameter contract", async () => {
    await expect(resolveVideoFinishingContract({ c: context, request })).resolves.toEqual({
      ...request,
      billingSpecKey: "professional:1080p:lte30",
    });
    await expect(
      resolveVideoFinishingContract({
        c: context,
        request: { ...request, resolution: "4k" },
      }),
    ).rejects.toThrow("video_finishing_runtime_option_unsupported:resolution:4k");
  });

  it("rejects malformed frozen contracts", () => {
    expect(parseVideoFinishingContract({ ...request })).toBeNull();
    expect(parseVideoFinishingContract({ ...request, billingSpecKey: "professional:1080p:lte30" }))
      .toEqual({ ...request, billingSpecKey: "professional:1080p:lte30" });
  });
});
