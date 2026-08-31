import { describe, expect, it, vi } from "vitest";

vi.mock("./video-orchestrator.model-duration", () => ({
  resolveModelDurationOptions: vi.fn(async ({ modelKey }: { modelKey: string }) =>
    modelKey === "doubao-seedance-2-0-260128" ? [5, 10, 15] : [],
  ),
}));

vi.mock("../model-catalog/model-catalog.service", () => ({
  listModelCatalogModels: vi.fn(async () => [{
    modelKey: "doubao-seedance-2-0-260128",
    modelAlias: "doubao-seedance-2-0-260128",
    meta: {
      videoOptions: {
        supportsReferenceImages: true,
        maxReferenceImages: 99,
      },
    },
  }]),
}));

vi.mock("../new-api-models/new-api-models.service", () => ({
  isSelectableNewApiModel: vi.fn(() => true),
  matchesNewApiRuntimeModelIdentity: vi.fn((
    model: { modelName: string; requestModelKey: string; routingAliases?: string[] },
    identity: unknown,
  ) => {
    const wanted = typeof identity === "string" ? identity.trim().toLowerCase() : "";
    return [model.modelName, model.requestModelKey, ...(model.routingAliases ?? [])]
      .some((candidate) => candidate.trim().toLowerCase() === wanted);
  }),
  listNewApiModels: vi.fn(async () => [{
    modelName: "doubao-seedance-2.0",
    requestModelKey: "doubao-seedance-2.0",
    routingAliases: ["doubao-seedance-2-0-260128"],
    enabled: true,
    runtimeEndpoints: ["openai-video"],
    pricing: { cost: 1, enabled: true, specCosts: [] },
    meta: {
      videoOptions: {
        maxReferenceImages: 30,
        maxReferenceAudioDurationSeconds: 30.2,
        resolutionOptions: [
          { value: "480p", label: "480p" },
          { value: "720p", label: "720p" },
        ],
        sizeOptions: [
          { value: "16:9", label: "16:9", aspectRatio: "16:9" },
          { value: "9:16", label: "9:16", aspectRatio: "9:16" },
        ],
        supportsNativeAudio: true,
      },
    },
  }]),
}));

import { listNewApiModels } from "../new-api-models/new-api-models.service";

import {
  parseVideoGenerationContract,
  readBeatSheetGenerationContract,
  requireStoryPlanGenerationContract,
  resolveBeatSheetVideoGenerationContract,
  resolveVideoModelAspectOptions,
  resolveVideoModelAudioOnlyReferenceSupport,
  resolveVideoModelMaximumReferenceImages,
  resolveVideoModelNativeAudioSupport,
  resolveVideoModelReferenceAudioPolicy,
  resolveVideoModelReferenceImagePolicy,
  resolveVideoModelResolutionOptions,
  resolveStoryPlanGenerationContract,
  videoGenerationContractsEqual,
} from "./video-orchestrator.generation-contract";

describe("video generation contract", () => {
  const contract = {
    videoModel: "doubao-seedance-2-0-260128",
    durationOptions: [5, 10, 15],
    maxDurationSeconds: 15,
    referenceImagePolicy: {
      countUnit: "unique_url" as const,
      maximumTotalImages: 30,
      maximumBusinessImages: 30,
    },
    referenceAudioPolicy: {
      minimumDurationSeconds: 1.8,
      maximumDurationSeconds: 30.2,
    },
  };

  it("只接受 maxDurationSeconds 等于目录档位最大值的完整快照", () => {
    expect(parseVideoGenerationContract(contract)).toEqual(contract);
    expect(parseVideoGenerationContract({ ...contract, maxDurationSeconds: 10 })).toBeNull();
    expect(parseVideoGenerationContract({ ...contract, durationOptions: [] })).toBeNull();
  });

  it("从 BeatSheet.meta 读取同一 Run 的持久快照", () => {
    expect(
      readBeatSheetGenerationContract({ meta: { generationContract: contract } }),
    ).toEqual(contract);
    expect(readBeatSheetGenerationContract({ meta: {} })).toBeNull();
  });

  it("StoryPlan 快照必须存在且与 videoModel 逐字一致", () => {
    expect(
      requireStoryPlanGenerationContract({ videoModel: contract.videoModel, generationContract: contract }),
    ).toEqual(contract);
    expect(() =>
      requireStoryPlanGenerationContract({
        videoModel: "another-video-model",
        generationContract: contract,
      }),
    ).toThrow("story_plan_generation_contract_model_mismatch");
    expect(() => requireStoryPlanGenerationContract({ videoModel: contract.videoModel })).toThrow(
      "story_plan_generation_contract_missing",
    );
  });

  it("首次 plan 只按显式 videoModel 从动态目录建立合同", async () => {
    await expect(
      resolveStoryPlanGenerationContract({
        c: {} as never,
        storyPlan: { videoModel: contract.videoModel },
        allowCatalogResolution: true,
      }),
    ).resolves.toEqual(contract);
  });

  it("单独读取仅音频参考拓扑能力，不从通用参考音频能力推断", async () => {
    await expect(resolveVideoModelAudioOnlyReferenceSupport({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toBe(false);

    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          maxReferenceAudioDurationSeconds: 30.2,
          supportsAudioOnlyReference: true,
        },
      },
    } as never]);
    await expect(resolveVideoModelAudioOnlyReferenceSupport({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toBe(true);
  });

  it("BeatSheet 首次锁定模型缺失时报告准确嵌套路径", async () => {
    await expect(
      resolveBeatSheetVideoGenerationContract({
        c: {} as never,
        beatSheet: { meta: {}, beats: [] },
      }),
    ).rejects.toThrow("beat_sheet.meta.videoModel_required");
    await expect(
      resolveBeatSheetVideoGenerationContract({
        c: {} as never,
        beatSheet: {
          meta: { videoModel: contract.videoModel, aspect: "16:9", resolution: "720p" },
          beats: [],
        },
      }),
    ).resolves.toEqual(contract);
  });

  it("BeatSheet 分辨率必须有当前运行时目录证据", async () => {
    await expect(resolveVideoModelResolutionOptions({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toEqual(["480p", "720p"]);
    await expect(resolveBeatSheetVideoGenerationContract({
      c: {} as never,
      beatSheet: {
        meta: { videoModel: contract.videoModel, aspect: "16:9", resolution: "1080p" },
        beats: [],
      },
    })).rejects.toThrow("beat_sheet.meta.resolution_not_supported:1080p:480p,720p");
  });

  it("BeatSheet 画幅必须逐字命中同一份运行时 sizeOptions", async () => {
    await expect(resolveVideoModelAspectOptions({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toEqual(["16:9", "9:16"]);
    await expect(resolveBeatSheetVideoGenerationContract({
      c: {} as never,
      beatSheet: {
        meta: { videoModel: contract.videoModel, aspect: "4:3", resolution: "720p" },
        beats: [],
      },
    })).rejects.toThrow("beat_sheet.meta.aspect_not_supported:4:3:16:9,9:16");
  });

  it("缺分辨率目录时显式失败，不以旧默认或计费规格推断", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          maxReferenceImages: 30,
          maxReferenceAudioDurationSeconds: 30.2,
          sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
          supportsNativeAudio: true,
        },
      },
    } as never]);
    await expect(resolveBeatSheetVideoGenerationContract({
      c: {} as never,
      beatSheet: {
        meta: { videoModel: contract.videoModel, aspect: "16:9", resolution: "720p" },
        beats: [],
      },
    })).rejects.toThrow(`video_model_resolution_options_missing:${contract.videoModel}`);
  });

  it("含对白但模型不支持原生音频时降级为无声画面而不阻塞", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          maxReferenceImages: 30,
          maxReferenceAudioDurationSeconds: 30.2,
          resolutionOptions: [{ value: "720p", label: "720p" }],
          sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
          supportsNativeAudio: false,
        },
      },
    } as never]);
    await expect(resolveBeatSheetVideoGenerationContract({
      c: {} as never,
      beatSheet: {
        meta: { videoModel: contract.videoModel, aspect: "16:9", resolution: "720p" },
        beats: [{ dialogueScript: [{ text: "别动。" }] }],
      },
    })).resolves.toEqual(contract);
  });

  it("含 agent 冻结叙事音频但模型不支持时仍保留视觉生产合同", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          maxReferenceImages: 30,
          maxReferenceAudioDurationSeconds: 30.2,
          resolutionOptions: [{ value: "720p", label: "720p" }],
          sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
          supportsNativeAudio: false,
        },
      },
    } as never]);
    await expect(resolveBeatSheetVideoGenerationContract({
      c: {} as never,
      beatSheet: {
        meta: { videoModel: contract.videoModel, aspect: "16:9", resolution: "720p" },
        beats: [{
          dialogueScript: [],
          narrativeAudioPlan: {
            strategy: "source_grounded_voice",
            rationale: "跨时段因果需要最小 VO。",
            lines: [{
              lineId: "narrative-0",
              speakerName: "沈知夏·内心",
              text: "她不能再走向原来的结局。",
              delivery: "voice_over",
              afterSourceLineId: null,
              sourceEvidence: ["source-unit-0009"],
            }],
          },
        }],
      },
    })).resolves.toEqual(contract);
  });

  it("原生音频能力未声明时按可选增强缺失处理", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          maxReferenceImages: 30,
          maxReferenceAudioDurationSeconds: 30.2,
          resolutionOptions: [{ value: "720p", label: "720p" }],
          sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
        },
      },
    } as never]);
    await expect(resolveVideoModelNativeAudioSupport({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toBe(false);
  });

  it("无对白 BeatSheet 不要求原生人声能力", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          maxReferenceImages: 30,
          maxReferenceAudioDurationSeconds: 30.2,
          resolutionOptions: [{ value: "720p", label: "720p" }],
          sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
          supportsNativeAudio: false,
        },
      },
    } as never]);
    await expect(resolveBeatSheetVideoGenerationContract({
      c: {} as never,
      beatSheet: {
        meta: { videoModel: contract.videoModel, aspect: "16:9", resolution: "720p" },
        beats: [{ dialogueScript: [] }],
      },
    })).resolves.toEqual(contract);
  });

  it("纯文生视频把未声明的可选参考输入能力冻结为零容量", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          resolutionOptions: [{ value: "480p", label: "480p" }],
          sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
          supportsNativeAudio: false,
        },
      },
    } as never]);
    await expect(resolveVideoModelReferenceImagePolicy({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toEqual({
      countUnit: "unique_url",
      maximumTotalImages: 0,
      maximumBusinessImages: 0,
    });

    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: {
        videoOptions: {
          resolutionOptions: [{ value: "480p", label: "480p" }],
          sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
          supportsNativeAudio: false,
        },
      },
    } as never]);
    await expect(resolveVideoModelReferenceAudioPolicy({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toEqual({
      minimumDurationSeconds: 0,
      maximumDurationSeconds: 0,
    });
  });

  it("目录声称支持参考音频却缺硬上限时降级静音而不阻塞视频合同", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([{
      modelName: "doubao-seedance-2.0",
      requestModelKey: "doubao-seedance-2.0",
      routingAliases: [contract.videoModel],
      enabled: true,
      runtimeEndpoints: ["openai-video"],
      pricing: { cost: 1, enabled: true, specCosts: [] },
      meta: { videoOptions: { supportsReferenceAudios: true } },
    } as never]);
    await expect(resolveVideoModelReferenceAudioPolicy({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toEqual({
      minimumDurationSeconds: 0,
      maximumDurationSeconds: 0,
    });
  });

  it("底层视频适配器复用同一模型目录总图片预算，不派生固定供应商上限", async () => {
    await expect(resolveVideoModelMaximumReferenceImages({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toBe(30);
    expect(vi.mocked(listNewApiModels).mock.calls.at(-1)?.[1]).toEqual({
      kind: "video",
      enabled: true,
      fresh: true,
    });
  });

  it("以运行时合同的上限为准而不使用产品目录中的静态数字", async () => {
    await expect(resolveVideoModelMaximumReferenceImages({
      c: {} as never,
      videoModel: contract.videoModel,
    })).resolves.toBe(30);
  });

  it("运行时模型合同缺失时不使用产品目录中的静态能力兜底", async () => {
    vi.mocked(listNewApiModels).mockResolvedValueOnce([]);
    await expect(resolveVideoModelMaximumReferenceImages({
      c: {} as never,
      videoModel: contract.videoModel,
    })).rejects.toThrow(`video_model_runtime_contract_missing:${contract.videoModel}`);
  });

  it("生产阶段缺冻结合同或 plan 显式携带畸形合同时原地失败", async () => {
    await expect(
      resolveStoryPlanGenerationContract({
        c: {} as never,
        storyPlan: { videoModel: contract.videoModel },
        allowCatalogResolution: false,
      }),
    ).rejects.toThrow("story_plan_generation_contract_missing");
    await expect(
      resolveStoryPlanGenerationContract({
        c: {} as never,
        storyPlan: { videoModel: contract.videoModel, generationContract: { videoModel: contract.videoModel } },
        allowCatalogResolution: true,
      }),
    ).rejects.toThrow("story_plan_generation_contract_invalid");
  });

  it("比较完整规范化合同，任一档位变化都不相等", () => {
    expect(videoGenerationContractsEqual(contract, { ...contract })).toBe(true);
    expect(
      videoGenerationContractsEqual(contract, { ...contract, durationOptions: [5, 15] }),
    ).toBe(false);
  });
});
