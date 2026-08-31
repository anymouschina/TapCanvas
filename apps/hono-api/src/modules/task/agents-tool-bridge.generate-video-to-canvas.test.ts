import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import type { AppContext } from "../../types";

const {
  mockedRunPublicTask,
  mockedFetchTaskResultForPolling,
  mockedUpdateFlow,
  mockedUpdateFlowByIdUnsafe,
  mockedCreateFlowVersion,
  mockedGetFlowForOwner,
  mockedGetChapterCanvasFlow,
  mockedPutChapterCanvasFlow,
  mockedResolveTeamCreditsCostForTask,
  mockedSettleTeamCreditsOnSuccess,
  mockedReleaseTeamCreditsOnFailure,
  mockedListModelCatalogModels,
  mockedListNewApiModels,
  mockedClaimVideoSubmissionIntent,
  mockedMarkVideoSubmissionAccepted,
  mockedMarkVideoSubmissionPreUpstreamRejected,
  mockedMarkVideoSubmissionUncertain,
  mockedAssertProductionRunAllowsNewEffects,
  mockedFindLatestProductionEffect,
  mockedReserveProductionEffect,
  mockedTransitionProductionEffect,
  mockedRegisterGeneratedMediaAsset,
  mockedSynthesizeDoubaoSpeechToStorage,
} = vi.hoisted(() => ({
  mockedRunPublicTask: vi.fn(),
  mockedFetchTaskResultForPolling: vi.fn(),
  mockedUpdateFlow: vi.fn(),
  mockedUpdateFlowByIdUnsafe: vi.fn(),
  mockedCreateFlowVersion: vi.fn(),
  mockedGetFlowForOwner: vi.fn(),
  mockedGetChapterCanvasFlow: vi.fn(),
  mockedPutChapterCanvasFlow: vi.fn(),
  mockedResolveTeamCreditsCostForTask: vi.fn(),
  mockedSettleTeamCreditsOnSuccess: vi.fn(),
  mockedReleaseTeamCreditsOnFailure: vi.fn(),
  mockedListModelCatalogModels: vi.fn(),
  mockedListNewApiModels: vi.fn(),
  mockedClaimVideoSubmissionIntent: vi.fn(),
  mockedMarkVideoSubmissionAccepted: vi.fn(),
  mockedMarkVideoSubmissionPreUpstreamRejected: vi.fn(),
  mockedMarkVideoSubmissionUncertain: vi.fn(),
  mockedAssertProductionRunAllowsNewEffects: vi.fn(),
  mockedFindLatestProductionEffect: vi.fn(),
  mockedReserveProductionEffect: vi.fn(),
  mockedTransitionProductionEffect: vi.fn(),
  mockedRegisterGeneratedMediaAsset: vi.fn(),
  mockedSynthesizeDoubaoSpeechToStorage: vi.fn(),
}));

vi.mock("../apiKey/audio-speech", () => ({
  synthesizeDoubaoSpeechToStorage: mockedSynthesizeDoubaoSpeechToStorage,
}));

vi.mock("../asset/asset.hosting", () => ({
  registerGeneratedMediaAsset: mockedRegisterGeneratedMediaAsset,
}));

vi.mock("../model-catalog/model-catalog.service", () => ({
  listModelCatalogModels: mockedListModelCatalogModels,
}));

vi.mock("../new-api-models/new-api-models.service", () => ({
  isSelectableNewApiModel: vi.fn().mockReturnValue(true),
  matchesNewApiRuntimeModelIdentity: vi.fn((
    model: { modelName: string; requestModelKey: string; routingAliases?: string[] },
    identity: unknown,
  ) => {
    const wanted = typeof identity === "string" ? identity.trim().toLowerCase() : "";
    return [model.modelName, model.requestModelKey, ...(model.routingAliases ?? [])]
      .some((candidate) => candidate.trim().toLowerCase() === wanted);
  }),
  listNewApiModels: mockedListNewApiModels,
}));

vi.mock("../apiKey/apiKey.routes", () => ({
  runPublicTask: mockedRunPublicTask,
}));

vi.mock("./task.polling", () => ({
  fetchTaskResultForPolling: mockedFetchTaskResultForPolling,
}));

vi.mock("./video-orchestrator.authoring.repo", async () => {
  const actual = await vi.importActual<typeof import("./video-orchestrator.authoring.repo")>("./video-orchestrator.authoring.repo");
  return {
    ...actual,
    claimVideoSubmissionIntent: mockedClaimVideoSubmissionIntent,
    markVideoSubmissionAccepted: mockedMarkVideoSubmissionAccepted,
    markVideoSubmissionPreUpstreamRejected: mockedMarkVideoSubmissionPreUpstreamRejected,
    markVideoSubmissionUncertain: mockedMarkVideoSubmissionUncertain,
  };
});

vi.mock("./production-effect-ledger", async () => {
  const actual = await vi.importActual<typeof import("./production-effect-ledger")>("./production-effect-ledger");
  return {
    ...actual,
    assertProductionRunAllowsNewEffects: mockedAssertProductionRunAllowsNewEffects,
    findLatestProductionEffect: mockedFindLatestProductionEffect,
    reserveProductionEffect: mockedReserveProductionEffect,
    transitionProductionEffect: mockedTransitionProductionEffect,
  };
});

vi.mock("../flow/flow.repo", async () => {
  const actual = await vi.importActual<typeof import("../flow/flow.repo")>("../flow/flow.repo");
  return {
    ...actual,
    updateFlow: mockedUpdateFlow,
    updateFlowByIdUnsafe: mockedUpdateFlowByIdUnsafe,
    createFlowVersion: mockedCreateFlowVersion,
    getFlowForOwner: mockedGetFlowForOwner,
  };
});

vi.mock("../chapter/chapter.canvas-flow.service", async () => {
  const actual = await vi.importActual<
    typeof import("../chapter/chapter.canvas-flow.service")
  >("../chapter/chapter.canvas-flow.service");
  return {
    ...actual,
    getChapterCanvasFlow: mockedGetChapterCanvasFlow,
    putChapterCanvasFlow: mockedPutChapterCanvasFlow,
  };
});

vi.mock("../chapter/canvas-sse.manager", () => ({
  broadcastPatch: vi.fn(),
}));

vi.mock("../billing/billing.service", async () => {
  const actual = await vi.importActual<typeof import("../billing/billing.service")>(
    "../billing/billing.service",
  );
  return {
    ...actual,
    resolveTeamCreditsCostForTask: mockedResolveTeamCreditsCostForTask,
  };
});

vi.mock("../team/team.service", async () => {
  const actual = await vi.importActual<typeof import("../team/team.service")>(
    "../team/team.service",
  );
  return {
    ...actual,
    settleTeamCreditsOnSuccess: mockedSettleTeamCreditsOnSuccess,
    releaseTeamCreditsOnFailure: mockedReleaseTeamCreditsOnFailure,
  };
});

import {
  generateVideoToCanvas,
  reconcileVideoNodesForFlow,
  ensureVideoNodeShape,
  resolveChapterDesignBoardNodes,
} from "./agents-tool-bridge.generate-video-to-canvas";

function runtimeVideoModel(input: {
  modelName: string;
  routingAliases?: string[];
  maxReferenceImages?: number;
  maxReferenceAudioDurationSeconds?: number;
  supportsAudioOnlyReference?: boolean;
}) {
  return {
    modelName: input.modelName,
    requestModelKey: input.modelName,
    routingAliases: input.routingAliases ?? [],
    enabled: true,
    runtimeEndpoints: ["openai-video"],
    pricing: { cost: 1, enabled: true, specCosts: [] },
    meta: {
      videoOptions: {
        ...(typeof input.maxReferenceImages === "number"
          ? { maxReferenceImages: input.maxReferenceImages }
          : {}),
        maxReferenceAudioDurationSeconds:
          input.maxReferenceAudioDurationSeconds ?? 30.2,
        supportsAudioOnlyReference: input.supportsAudioOnlyReference === true,
      },
    },
  };
}

beforeEach(() => {
  mockedRunPublicTask.mockReset();
  mockedFetchTaskResultForPolling.mockReset();
  mockedUpdateFlow.mockReset();
  mockedUpdateFlowByIdUnsafe.mockReset();
  mockedCreateFlowVersion.mockReset();
  mockedGetFlowForOwner.mockReset();
  mockedGetChapterCanvasFlow.mockReset();
  mockedPutChapterCanvasFlow.mockReset();
  mockedResolveTeamCreditsCostForTask.mockReset();
  mockedSettleTeamCreditsOnSuccess.mockReset();
  mockedReleaseTeamCreditsOnFailure.mockReset();
  mockedListModelCatalogModels.mockReset();
  mockedListNewApiModels.mockReset();
  mockedClaimVideoSubmissionIntent.mockReset();
  mockedMarkVideoSubmissionAccepted.mockReset();
  mockedMarkVideoSubmissionPreUpstreamRejected.mockReset();
  mockedMarkVideoSubmissionUncertain.mockReset();
  mockedAssertProductionRunAllowsNewEffects.mockReset();
  mockedFindLatestProductionEffect.mockReset();
  mockedReserveProductionEffect.mockReset();
  mockedTransitionProductionEffect.mockReset();
  mockedRegisterGeneratedMediaAsset.mockReset();
  mockedSynthesizeDoubaoSpeechToStorage.mockReset();
  mockedResolveTeamCreditsCostForTask.mockResolvedValue(10);
  mockedSettleTeamCreditsOnSuccess.mockResolvedValue(undefined);
  mockedReleaseTeamCreditsOnFailure.mockResolvedValue(undefined);
  mockedRegisterGeneratedMediaAsset.mockResolvedValue("asset-video-1");
  mockedSynthesizeDoubaoSpeechToStorage.mockImplementation(async (_c: unknown, _userId: string, input: { voiceId?: string | null }) => ({
    url: `https://assets.example/${input.voiceId || "voice"}-neutral.mp3`,
    key: `${input.voiceId || "voice"}-neutral.mp3`,
    bytes: 1024,
    durationSec: 3.2,
    model: "doubao-seed-audio-1-0",
    voiceId: input.voiceId || "",
  }));
  mockedGetFlowForOwner.mockResolvedValue(null);
  mockedClaimVideoSubmissionIntent.mockResolvedValue({ claimed: true, reason: "claimed", artifact: null });
  mockedMarkVideoSubmissionAccepted.mockResolvedValue(true);
  mockedMarkVideoSubmissionPreUpstreamRejected.mockResolvedValue(true);
  mockedMarkVideoSubmissionUncertain.mockResolvedValue(true);
  mockedAssertProductionRunAllowsNewEffects.mockResolvedValue(undefined);
  mockedFindLatestProductionEffect.mockResolvedValue(null);
  mockedReserveProductionEffect.mockImplementation(async (input: { runId: string; effectKey: string; operation: string; inputHash: string; createdAt: string }) => ({
    created: true,
    effect: {
      id: `effect:${input.runId}:${input.effectKey}`,
      runId: input.runId,
      workflowNodeId: "media-production",
      effectKey: input.effectKey,
      operation: input.operation,
      inputHash: input.inputHash,
      status: "reserved",
      provider: null,
      providerTaskId: null,
      artifactKey: null,
      errorCode: null,
      errorMessage: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  }));
  mockedTransitionProductionEffect.mockImplementation(async (input: { effectId: string; toStatus: string; updatedAt: string; provider?: string; providerTaskId?: string }) => ({
    changed: true,
    effect: {
      id: input.effectId,
      runId: "run-test",
      workflowNodeId: "media-production",
      effectKey: "video-clip:0",
      operation: "video.generate",
      inputHash: "hash-test",
      status: input.toStatus,
      provider: input.provider ?? null,
      providerTaskId: input.providerTaskId ?? null,
      artifactKey: null,
      errorCode: null,
      errorMessage: null,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    },
  }));
  mockedListModelCatalogModels.mockResolvedValue([{
    modelKey: "doubao-seedance-2-0-260128",
    modelAlias: "doubao-seedance-2-0-260128",
    meta: { videoOptions: { maxReferenceImages: 9, durationOptions: [5, 10, 15] } },
  }, {
    modelKey: "doubao-seedance-2-0-pro-260528",
    modelAlias: "doubao-seedance-2-0-pro-260528",
    meta: { videoOptions: { maxReferenceImages: 9, durationOptions: [5, 10, 15] } },
  }, {
    modelKey: "doubao-seedance-2.5",
    modelAlias: "doubao-seedance-2-5-260628",
    meta: {
      videoOptions: {
        maxReferenceImages: 9,
        durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
      },
    },
  }, {
    modelKey: "veo-3.1",
    modelAlias: "veo-3.1",
    meta: { videoOptions: { maxReferenceImages: 9, durationOptions: [5, 8] } },
  }]);
  mockedListNewApiModels.mockResolvedValue([
    runtimeVideoModel({
      modelName: "doubao-seedance-2.0",
      routingAliases: ["doubao-seedance-2-0-260128"],
      maxReferenceImages: 9,
    }),
    runtimeVideoModel({
      modelName: "doubao-seedance-2-0-pro-260528",
      maxReferenceImages: 9,
    }),
    runtimeVideoModel({
      modelName: "doubao-seedance-2.5",
      routingAliases: ["doubao-seedance-2-5-260628"],
      maxReferenceImages: 9,
    }),
    runtimeVideoModel({
      modelName: "veo-3.1",
      maxReferenceImages: 9,
    }),
  ]);
});

describe("ensureVideoNodeShape — 视频节点脚手架确定性补全", () => {
  it("缺 type → 补 taskNode", () => {
    const out = ensureVideoNodeShape({ data: { kind: "video", prompt: "p" } }) as Record<
      string,
      unknown
    >;
    expect(out.type).toBe("taskNode");
  });
  it("缺/非法 position → 补 {x:0,y:0}", () => {
    const out = ensureVideoNodeShape({ data: { kind: "video", prompt: "p" } }) as Record<
      string,
      unknown
    >;
    expect(out.position).toEqual({ x: 0, y: 0 });
    const out2 = ensureVideoNodeShape({
      type: "taskNode",
      position: { x: "nope" },
      data: { kind: "video", prompt: "p" },
    }) as Record<string, unknown>;
    expect(out2.position).toEqual({ x: 0, y: 0 });
  });
  it("已有合法 type/position → 原样保留", () => {
    const out = ensureVideoNodeShape({
      type: "taskNode",
      position: { x: 120, y: 80 },
      data: { kind: "video", prompt: "p" },
    }) as Record<string, unknown>;
    expect(out.type).toBe("taskNode");
    expect(out.position).toEqual({ x: 120, y: 80 });
  });
  it("复活被字符串化的 node 整体", () => {
    const out = ensureVideoNodeShape(
      JSON.stringify({ data: { kind: "video", prompt: "p" } }),
    ) as Record<string, unknown>;
    expect(out.type).toBe("taskNode");
    expect((out.data as Record<string, unknown>).kind).toBe("video");
  });
  it("复活被字符串化的 node.data", () => {
    const out = ensureVideoNodeShape({
      type: "taskNode",
      position: { x: 0, y: 0 },
      data: JSON.stringify({ kind: "video", prompt: "p" }),
    }) as Record<string, unknown>;
    expect((out.data as Record<string, unknown>).prompt).toBe("p");
  });
  it("自然语言 prompt 字符串不被误解析", () => {
    const out = ensureVideoNodeShape({
      data: { kind: "video", prompt: "镜头缓推，他低声说：『来了。』" },
    }) as Record<string, unknown>;
    expect((out.data as Record<string, unknown>).prompt).toBe("镜头缓推，他低声说：『来了。』");
  });
  it("非对象 node 原样返回（不炸）", () => {
    expect(ensureVideoNodeShape(undefined)).toBe(undefined);
    expect(ensureVideoNodeShape(42)).toBe(42);
  });
});

describe("generateVideoToCanvas", () => {
  it("keeps a Seedance keyframe together with reference video continuation", async () => {
    const row: FlowRow = {
      id: "flow-seedance-frame",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-seedance-frame",
        kind: "image_to_video",
        status: "running",
        assets: [],
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

    await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "continue toward the palace",
            videoModel: "doubao-seedance-2-0-260128",
            firstFrameUrl: "https://assets.example/frame.png",
            sourceVideoUrl: "https://assets.example/previous.mp4",
            referenceVideoDurationSeconds: 5,
            sourcePrevTaskId: "task-previous",
          },
        },
      },
    });

    const taskRequest = mockedRunPublicTask.mock.calls[0]?.[2] as {
      request: { extras: Record<string, unknown> };
    };
    expect(taskRequest.request.extras).toMatchObject({
      upstreamVideoUrl: "https://assets.example/previous.mp4",
      prevTaskId: "task-previous",
      referenceImages: ["https://assets.example/frame.png"],
      referenceMediaManifest: {
        images: [{
          url: "https://assets.example/frame.png",
          label: "本镜首帧",
          purpose: "keyframe",
          purposes: ["keyframe"],
          sourceNodeIds: [],
          role: "reference_image",
        }],
        audios: [],
      },
    });
    expect(taskRequest.request.extras).not.toHaveProperty("firstFrameUrl");
    expect(taskRequest.request.extras).not.toHaveProperty("lastFrameUrl");
    expect(taskRequest.request.extras).not.toHaveProperty("referenceAudioUrls");
  });

  it("keeps Seedance character and scene references together with a storyboard keyframe", async () => {
    const row: FlowRow = {
      id: "flow-seedance-multimodal",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-seedance-multimodal",
        kind: "image_to_video",
        status: "running",
        assets: [],
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

    await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "孟川与后土隔着人群无声致意",
            videoModel: "doubao-seedance-2-0-260128",
            referenceImages: [
              "https://assets.example/meng-chuan.png",
              "https://assets.example/palace.png",
            ],
            referenceImageBindings: [
              {
                url: "https://assets.example/meng-chuan.png",
                label: "角色卡：孟川",
                purpose: "character",
              },
              {
                url: "https://assets.example/palace.png",
                label: "场景卡：紫霄宫门外候道场",
                purpose: "scene",
              },
            ],
            firstFrameUrl: "https://assets.example/storyboard-keyframe.png",
          },
        },
      },
    });

    const taskRequest = mockedRunPublicTask.mock.calls[0]?.[2] as {
      request: { extras: Record<string, unknown> };
    };
    expect(taskRequest.request.extras).toMatchObject({
      referenceImages: [
        "https://assets.example/meng-chuan.png",
        "https://assets.example/palace.png",
        "https://assets.example/storyboard-keyframe.png",
      ],
      referenceMediaManifest: {
        images: [
          {
            url: "https://assets.example/meng-chuan.png",
            label: "角色卡：孟川",
            purpose: "character",
            role: "reference_image",
          },
          {
            url: "https://assets.example/palace.png",
            label: "场景卡：紫霄宫门外候道场",
            purpose: "scene",
            role: "reference_image",
          },
          {
            url: "https://assets.example/storyboard-keyframe.png",
            label: "本镜首帧",
            purpose: "keyframe",
            role: "reference_image",
          },
        ],
        audios: [],
      },
    });
    expect(taskRequest.request.extras).not.toHaveProperty("firstFrameUrl");
    expect(taskRequest.request.extras).not.toHaveProperty("lastFrameUrl");
  });

  it("keeps orchestrated reference provenance frozen when another canvas node reuses the same URL", async () => {
    const sharedUrl = "https://assets.example/meng-chuan.png";
    const runId = `run-orchestrated-frozen-provenance-${Date.now()}`;
    const frozenReferenceNode = {
      id: "frozen-character",
      type: "taskNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "image",
        label: "本轮冻结角色卡：孟川",
        imageUrl: sharedUrl,
      },
    };
    const reusedCanvasNode = {
      id: "reused-character-anchor",
      type: "taskNode",
      position: { x: 200, y: 0 },
      data: {
        kind: "image",
        label: "其它画布角色锚：孟川",
        imageUrl: sharedUrl,
      },
    };
    const row: FlowRow = {
      id: "flow-orchestrated-frozen-provenance",
      name: "Flow",
      data: JSON.stringify({ nodes: [frozenReferenceNode, reusedCanvasNode], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-orchestrated-frozen-provenance",
        kind: "image_to_video",
        status: "running",
        assets: [],
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
    mockedGetChapterCanvasFlow.mockResolvedValue({
      revision: 1,
      flow: { nodes: [frozenReferenceNode, reusedCanvasNode], edges: [] },
    });
    mockedPutChapterCanvasFlow.mockResolvedValue({ revision: 2 });

    await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      chapterId: "chapter-orchestrated-frozen-provenance",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "孟川站在紫霄宫中保持身份一致",
            logline: "孟川在宫门声响中转身",
            continuity: "孟川位于紫霄宫中轴画左，宫门在后景，冷顶光保持方向不变",
            editRhythm: "宫门闷响先入，触发孟川转身",
            exitState: "孟川转向后景宫门，衣摆残势向画右",
            shots: [{
              shotNo: 1,
              action: "孟川站在紫霄宫中保持身份一致",
              soundPerspective: "跟随孟川听觉，宫门声从后景传来",
              sound: "宫门闷响；衣摆摩擦",
              durationSeconds: 5,
            }],
            videoModel: "doubao-seedance-2-0-260128",
            clipRunId: runId,
            clipIndex: 0,
            assetObjectContracts: [{
              kind: "character",
              name: "孟川",
              referenceImageNodeIds: ["frozen-character"],
              referenceRole: "identity",
              forbiddenTransfer: "不继承角色卡背景、站姿与构图",
              identityInvariant: "五官、发型与服装轮廓保持一致",
              startState: "孟川位于紫霄宫中轴画左",
              spatialRelation: "孟川距后景宫门两步",
              scale: "中景主体可读",
              driver: "宫门闷响触发转身",
              stateChange: "孟川转向后景宫门",
              endState: "孟川面向宫门，衣摆仍向画右",
            }],
            videoReferenceNodeIds: ["frozen-character"],
            referenceImages: [sharedUrl],
            referenceImageBindings: [
              {
                url: sharedUrl,
                label: "本轮冻结角色卡：孟川",
                purpose: "character",
                purposes: ["character"],
                sourceNodeIds: ["frozen-character"],
              },
            ],
            referenceDeliveryContract: {
              version: 1,
              clipIndex: 0,
              continuityMode: "editorial_cut",
              expectedNodes: [{ nodeId: "frozen-character", expectedImageCount: 1 }],
            },
            generationContract: {
              videoModel: "doubao-seedance-2-0-260128",
              durationOptions: [5, 10, 15],
              maxDurationSeconds: 15,
              referenceImagePolicy: {
                countUnit: "unique_url",
                maximumTotalImages: 9,
                maximumBusinessImages: 9,
              },
              referenceAudioPolicy: {
                minimumDurationSeconds: 1.8,
                maximumDurationSeconds: 30.2,
              },
            },
            durationSeconds: 5,
          },
        },
      },
    });

    const taskRequest = mockedRunPublicTask.mock.calls[0]?.[2] as {
      request: { prompt: string; extras: Record<string, unknown> };
    };
    expect(taskRequest.request.extras.referenceMediaManifest).toMatchObject({
      images: [
        expect.objectContaining({
          url: sharedUrl,
          sourceNodeIds: ["frozen-character"],
          assetKind: "character",
          assetName: "孟川",
          referenceRole: "identity",
        }),
      ],
      audios: [],
    });
    expect(taskRequest.request.prompt).toContain("【AUDIO】");
    expect(taskRequest.request.prompt).toContain("【ENTRY+REFERENCES】");
    expect(taskRequest.request.prompt).toContain("【SHOTS】");
    expect(taskRequest.request.prompt).toContain("【EXIT】");
    expect(taskRequest.request.prompt).toContain("@图1（character:孟川）=identity");
    expect(taskRequest.request.prompt).toContain("孟川站在紫霄宫中保持身份一致");
    expect(taskRequest.request.prompt).toContain("SFX_ONLY=跟随孟川听觉，宫门声从后景传来");
    const promptTableIndex = taskRequest.request.prompt.indexOf("【SHOTS】");
    expect(taskRequest.request.prompt.indexOf("【ENTRY+REFERENCES】")).toBeLessThan(promptTableIndex);
    expect(taskRequest.request.prompt.indexOf("【EXIT】")).toBeGreaterThan(promptTableIndex);
    expect(taskRequest.request.extras.promptDeliveryContract).toMatchObject({
      version: 1,
      authority: "structured_shots",
    });
  });

  it("re-renders an equipped-workflow Clip from structured shots instead of submitting its raw authoring envelope", async () => {
    const row: FlowRow = {
      id: "flow-equipped-workflow-structured-clip",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-17T00:00:00.000Z",
      updated_at: "2026-08-17T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-equipped-workflow-structured-clip",
        kind: "video_generation",
        status: "running",
        assets: [],
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

    await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          id: "workflow-video-output",
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: '{"clips":[{"prompt":"RAW_ENVELOPE"}],"selfQaNote":"should-not-reach-provider","creativeReview":{"pass":true}}',
            workflowExecutionId: "workflow-execution-1",
            workflowRuntimeNodeId: "video-submit::item::clip-a",
            videoModel: "doubao-seedance-2.5",
            generationContract: {
              videoModel: "doubao-seedance-2.5",
              durationOptions: [5, 10, 15],
              maxDurationSeconds: 15,
              referenceImagePolicy: {
                countUnit: "unique_url",
                maximumTotalImages: 9,
                maximumBusinessImages: 9,
              },
              referenceAudioPolicy: {
                minimumDurationSeconds: 0,
                maximumDurationSeconds: 0,
              },
            },
            referenceImages: ["https://assets.example/workflow-character.png"],
            videoDurationSeconds: 5,
            durationSeconds: 5,
            logline: "剑修由戒备转为主动突进",
            continuity: "同一竹林空间连续；右手始终握剑，左脚从后支撑转为前落点",
            exitState: "剑修在画面右侧完成前落步，剑尖停在对手兵器外侧",
            assetObjectContracts: [],
            shots: [{
              shotNo: 1,
              visualTask: "看清支撑脚变化与突进终点",
              action: "剑修左脚蹬地，重心前移，右手持剑沿肩线向前突进；剑尖与对手兵器接触后双方手臂同时反震，左脚落在画面右侧稳住",
              durationSeconds: 5,
            }],
          },
        },
      },
    });

    const taskRequest = mockedRunPublicTask.mock.calls[0]?.[2] as {
      request: { prompt: string; extras: Record<string, unknown> };
    };
    expect(taskRequest.request.prompt).toContain("看清支撑脚变化与突进终点");
    expect(taskRequest.request.prompt).toContain("双方手臂同时反震");
    expect(taskRequest.request.prompt).not.toContain("RAW_ENVELOPE");
    expect(taskRequest.request.prompt).not.toContain("selfQaNote");
    expect(taskRequest.request.prompt).not.toContain("creativeReview");
    expect(taskRequest.request.extras.generationContext).toEqual({
      projectId: "project-1",
      flowId: row.id,
      nodeId: "workflow-video-output",
      workflowExecutionId: "workflow-execution-1",
    });
    expect(taskRequest.request.extras.promptDeliveryContract).toMatchObject({
      version: 1,
      authority: "structured_shots",
    });
    expect(taskRequest.request.extras.referenceMediaManifest).toMatchObject({
      images: [{ url: "https://assets.example/workflow-character.png" }],
    });
  });

  it("submits structured workflow speech with provider-native audio when the frozen contract makes VoiceManifest optional", async () => {
    const row: FlowRow = {
      id: "flow-optional-audio-fail-open",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-optional-audio-fail-open",
        kind: "text_to_video",
        status: "running",
        assets: [],
        raw: {},
      },
    });
    let currentRow = row;
    mockedUpdateFlow.mockImplementation(async (_db, input) => {
      currentRow = {
        id: input.id,
        name: input.name,
        data: input.data,
        owner_id: "user-1",
        project_id: "project-1",
        created_at: row.created_at,
        updated_at: input.nowIso,
      };
      return currentRow;
    });
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);
    mockedGetFlowForOwner.mockImplementation(async () => currentRow);

    const result = await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          id: "workflow-video-dialogue",
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "raw envelope must not be submitted",
            workflowExecutionId: "workflow-execution-dialogue",
            workflowRuntimeNodeId: "video-submit::item::dialogue",
            workflowEffectId: "family-1:video-submit:dialogue",
            videoModel: "doubao-seedance-2.5",
            durationSeconds: 5,
            referenceAudioRequired: false,
            referenceAudioMode: "disabled",
            logline: "阿乔确认弹药后继续前进",
            continuity: "同一位置与持枪状态连续",
            exitState: "阿乔抬枪对准前方入口",
            assetObjectContracts: [],
            speakerBindings: [{ name: "阿乔", assetKind: "character" }],
            speechEvents: [{
              speechEventId: "speech-line-1",
              lineId: "line-1",
              startOffset: 0,
              endOffset: 8,
              startSeconds: 0.5,
              endSeconds: 4.5,
              speakerName: "阿乔",
              delivery: "on_screen",
              performance: "平稳确认，末尾短停",
              spokenText: "弹药够了，继续。",
            }],
            shots: [{
              shotNo: 1,
              visualTask: "看清阿乔从检查弹匣转为抬枪瞄准",
              action: "阿乔压回弹匣，右肩承住枪托并抬枪瞄准入口",
              speechEventIds: ["speech-line-1"],
              durationSeconds: 5,
            }],
          },
        },
      },
    });

    expect(result).toMatchObject({ taskId: "task-optional-audio-fail-open" });
    expect(mockedRunPublicTask).toHaveBeenCalledTimes(1);
    const taskRequest = mockedRunPublicTask.mock.calls[0]?.[2] as {
      request: { extras: Record<string, unknown> };
    };
    expect(taskRequest.request.extras.referenceAudioUrls).toBeUndefined();
    expect(taskRequest.request.extras.promptDeliveryContract).toMatchObject({
      version: 1,
      authority: "structured_shots",
    });
  });

  it("removes an optional audio-only reference when the selected model requires a visual reference", async () => {
    const row: FlowRow = {
      id: "flow-audio-only-reference",
      name: "Flow",
      data: JSON.stringify({
        nodes: [{
          id: "voice-card-1",
          type: "taskNode",
          position: { x: -100, y: 0 },
          data: {
            kind: "audio",
            audioType: "voice_card",
            audioUrl: "https://assets.example/voice.mp3",
          },
        }],
        edges: [],
      }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-audio-only-reference",
        kind: "text_to_video",
        status: "running",
        assets: [],
        raw: {},
      },
    });
    let currentRow = row;
    mockedUpdateFlow.mockImplementation(async (_db, input) => {
      currentRow = {
        id: input.id,
        name: input.name,
        data: input.data,
        owner_id: "user-1",
        project_id: "project-1",
        created_at: row.created_at,
        updated_at: input.nowIso,
      };
      return currentRow;
    });
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);
    mockedGetFlowForOwner.mockImplementation(async () => currentRow);

    const result = await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
            id: "workflow-video-audio-only",
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "raw envelope must not be submitted",
            workflowExecutionId: "workflow-execution-audio-only",
            workflowRuntimeNodeId: "video-submit::item::audio-only",
            workflowEffectId: "family-1:video-submit:audio-only",
            videoModel: "doubao-seedance-2-0-260128",
            durationSeconds: 5,
            referenceAudioRequired: false,
            voiceBinding: [{
              character: "女宇航员",
              voiceId: "voice-1",
              voiceLabel: "voice-card",
              nodeId: "voice-card-1",
              audioUrl: "https://assets.example/voice.mp3",
              audioDurationSec: 3,
            }],
            logline: "女宇航员确认幼苗存活",
            continuity: "同一温室空间连续",
            exitState: "女宇航员看向幼苗",
            assetObjectContracts: [],
            speakerBindings: [{ name: "女宇航员", assetKind: "character" }],
            speechEvents: [{
              speechEventId: "speech-line-1",
              lineId: "line-1",
              startOffset: 0,
              endOffset: 7,
              startSeconds: 0.5,
              endSeconds: 4.5,
              speakerName: "女宇航员",
              delivery: "on_screen",
              performance: "低声确认，呼吸平稳",
              spokenText: "它们会活下来。",
            }],
            shots: [{
              shotNo: 1,
              visualTask: "看清女宇航员确认幼苗状态",
              action: "女宇航员看向幼苗并自然说出台词",
              speechEventIds: ["speech-line-1"],
              durationSeconds: 5,
            }],
          },
        },
      },
    });

    expect(result).toMatchObject({ taskId: "task-audio-only-reference" });
    expect(mockedRunPublicTask).toHaveBeenCalledTimes(1);
    const taskRequest = mockedRunPublicTask.mock.calls[0]?.[2] as {
      request: { extras: Record<string, unknown> };
    };
    expect(taskRequest.request.extras.referenceAudioUrls).toBeUndefined();
  });

  it("按当前模型目录的动态图片预算拒绝超额引用，再提交上游前原地失败", async () => {
    mockedListNewApiModels.mockResolvedValueOnce([
      runtimeVideoModel({
        modelName: "doubao-seedance-2.0",
        routingAliases: ["doubao-seedance-2-0-260128"],
        maxReferenceImages: 3,
      }),
    ]);
    const row: FlowRow = {
      id: "flow-seedance-too-many-images",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    };

    await expect(
      generateVideoToCanvas({
        c: { env: { DB: {} } } as AppContext,
        requestUserId: "user-1",
        devBypass: false,
        flowId: row.id,
        row,
        bodyArgs: {
          node: {
            type: "taskNode",
            position: { x: 0, y: 0 },
            data: {
              kind: "video",
              prompt: "保持全部角色与场景资产",
              videoModel: "doubao-seedance-2-0-260128",
              referenceImages: Array.from(
                { length: 4 },
                (_, index) => `https://assets.example/reference-${index + 1}.png`,
              ),
            },
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "video_model_reference_image_limit_exceeded",
      status: 400,
      details: {
        modelKey: "doubao-seedance-2-0-260128",
        actual: 4,
        maximum: 3,
      },
    });
    expect(mockedRunPublicTask).not.toHaveBeenCalled();
  });

  it("模型目录未声明参考图能力时冻结为零容量，并在真实引用时显式失败", async () => {
    mockedListNewApiModels.mockResolvedValueOnce([
      runtimeVideoModel({
        modelName: "doubao-seedance-2.0",
        routingAliases: ["doubao-seedance-2-0-260128"],
      }),
    ]);
    const row: FlowRow = {
      id: "flow-seedance-missing-reference-policy",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    };

    await expect(generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "使用当前引用资产生成视频",
            videoModel: "doubao-seedance-2-0-260128",
            referenceImages: ["https://assets.example/reference.png"],
          },
        },
      },
    })).rejects.toMatchObject({
      code: "video_model_reference_image_limit_exceeded",
      status: 400,
      details: {
        modelKey: "doubao-seedance-2-0-260128",
        actual: 1,
        maximum: 0,
      },
    });
    expect(mockedRunPublicTask).not.toHaveBeenCalled();
  });

  it("persists a running flow node and returns immediately even when legacy sync flags are passed", async () => {
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
        // Removed legacy flags may still arrive from a stale caller, but cannot reopen long polling.
        submitOnly: false,
        waitForResult: true,
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
        request: expect.objectContaining({
          kind: "image_to_video",
          prompt: expect.stringContaining("旧屋被楼盘包围，镜头缓慢推进"),
          negativePrompt: "blurry",
          extras: expect.objectContaining({
            modelKey: "veo-3.1",
            aspectRatio: "16:9",
            durationSeconds: 8,
            firstFrameUrl: "https://example.com/first-frame.jpg",
            referenceMediaManifest: {
              images: [
                {
                  url: "https://example.com/first-frame.jpg",
                  label: "本镜首帧",
                  purpose: "keyframe",
                  purposes: ["keyframe"],
                  sourceNodeIds: [],
                  role: "first_frame",
                },
              ],
              audios: [],
            },
            persistAssets: true,
          }),
        }),
      }),
    );
    const submittedPrompt = mockedRunPublicTask.mock.calls[0]?.[2]?.request?.prompt;
    expect(String(submittedPrompt)).not.toContain("[参考图绑定]");
    expect(mockedFetchTaskResultForPolling).not.toHaveBeenCalled();
    expect(result.status).toBe("running");
    expect(result.videoUrl).toBe("");
    expect(result.thumbnailUrl).toBeNull();
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
      kind: "video",
      label: "第一段视频",
      status: "running",
      videoDurationSeconds: 8,
      taskId: "task-video-1",
      videoTaskId: "task-video-1",
      vendor: "veo",
      videoModelVendor: "veo",
      videoModel: "veo-3.1",
    });
    expect(nextFlow.nodes[0]?.data?.videoResults).toBeUndefined();
    expect(mockedCreateFlowVersion).not.toHaveBeenCalled();
  });

  it("submits Seedance 2.5 at its real 30s catalog limit without clamping to 15s", async () => {
    const row: FlowRow = {
      id: "flow-seedance-25-30s",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "doubao",
      result: {
        id: "task-seedance-25-30s",
        kind: "image_to_video",
        status: "running",
        assets: [],
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

    await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "完整连续表演",
            videoModel: "doubao-seedance-2.5",
            durationSeconds: 30,
          },
        },
      },
    });

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          extras: expect.objectContaining({
            modelKey: "doubao-seedance-2.5",
            durationSeconds: 30,
          }),
        }),
      }),
    );
  });

  it("rejects a duration absent from the selected model catalog instead of rewriting it", async () => {
    const row: FlowRow = {
      id: "flow-seedance-25-invalid-duration",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:00:00.000Z",
    };
    await expect(generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "非法时长不得改写",
            videoModel: "doubao-seedance-2.5",
            durationSeconds: 31,
          },
        },
      },
    })).rejects.toMatchObject({
      code: "video_generation_duration_not_supported",
      status: 400,
      details: {
        modelKey: "doubao-seedance-2.5",
        requestedDurationSeconds: 31,
        maxDurationSeconds: 30,
      },
    });
    expect(mockedRunPublicTask).not.toHaveBeenCalled();
  });

  it("reuses a pre-created direct video node and persists the submitted task id in place", async () => {
    const existingNode = {
      id: "video-node-existing",
      type: "taskNode",
      position: { x: 240, y: 96 },
      data: {
        kind: "video",
        label: "已编写提示词的视频节点",
        prompt: "暴雨古寺中双方高速交锋",
        videoModel: "doubao-seedance-2-0-260128",
        aspectRatio: "16:9",
        videoDurationSeconds: 15,
        status: "idle",
      },
    };
    const row: FlowRow = {
      id: "flow-existing-node",
      name: "Flow",
      data: JSON.stringify({ nodes: [existingNode], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-existing-node",
        kind: "text_to_video",
        status: "running",
        assets: [],
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
      flowId: row.id,
      row,
      bodyArgs: { node: existingNode },
    });

    expect(result).toMatchObject({
      nodeId: existingNode.id,
      taskId: "task-existing-node",
      status: "running",
    });
    expect(mockedUpdateFlow).toHaveBeenCalledTimes(1);
    const updateArgs = mockedUpdateFlow.mock.calls[0]?.[1] as { data: string };
    const nextFlow = JSON.parse(updateArgs.data) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(nextFlow.nodes).toHaveLength(1);
    expect(nextFlow.nodes[0]).toMatchObject({
      id: existingNode.id,
      data: {
        prompt: existingNode.data.prompt,
        status: "running",
        taskId: "task-existing-node",
        videoTaskId: "task-existing-node",
        vendor: "newapi",
      },
    });
  });

  it("persists a chapter placeholder before returning and reconcile writes success to the same node", async () => {
    const row: FlowRow = {
      id: "chapter-1",
      name: "Chapter canvas",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "newapi",
      result: {
        id: "task-chapter-video-1",
        kind: "text_to_video",
        status: "running",
        assets: [],
        raw: {},
      },
    });
    mockedGetChapterCanvasFlow.mockResolvedValueOnce({
      revision: 7,
      flow: { nodes: [], edges: [] },
    });
    mockedPutChapterCanvasFlow.mockResolvedValue({ revision: 8 });

    const submitted = await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "chapter-1",
      chapterId: "chapter-1",
      row,
      bodyArgs: {
        submitOnly: false,
        waitForResult: true,
        node: {
          id: "chapter-video-node-1",
          type: "taskNode",
          position: { x: 320, y: 120 },
          data: {
            kind: "video",
            label: "镜4·妖皇压境",
            prompt: "妖皇自云层下降，镜头后撤保持压迫感",
            videoModel: "doubao-seedance-2-0-pro-260528",
          },
        },
      },
    });

    expect(submitted).toMatchObject({
      flowId: "chapter-1",
      nodeId: "chapter-video-node-1",
      taskId: "task-chapter-video-1",
      status: "running",
      videoUrl: "",
    });
    expect(mockedFetchTaskResultForPolling).not.toHaveBeenCalled();
    expect(mockedPutChapterCanvasFlow).toHaveBeenCalledTimes(1);
    const firstPut = mockedPutChapterCanvasFlow.mock.calls[0]?.[3] as {
      flow: { nodes: Array<{ id: string; data: Record<string, unknown> }> };
    };
    expect(firstPut.flow.nodes).toHaveLength(1);
    expect(firstPut.flow.nodes[0]).toMatchObject({
      id: "chapter-video-node-1",
      data: {
        status: "running",
        taskId: "task-chapter-video-1",
        videoTaskId: "task-chapter-video-1",
      },
    });

    const runningFlow = firstPut.flow;
    mockedFetchTaskResultForPolling.mockResolvedValueOnce({
      ok: true,
      vendor: "newapi",
      result: {
        id: "task-chapter-video-1",
        kind: "text_to_video",
        status: "succeeded",
        assets: [{ type: "video", url: "https://example.com/chapter-video.mp4" }],
        raw: {},
      },
    });
    mockedGetChapterCanvasFlow.mockResolvedValueOnce({ revision: 8, flow: runningFlow });

    const reconciled = await reconcileVideoNodesForFlow({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "chapter-1",
      chapterId: "chapter-1",
      row: { ...row, data: JSON.stringify(runningFlow) },
    });

    expect(reconciled).toMatchObject({ reconciled: 1, failed: 0, stillRunning: 0 });
    expect(mockedPutChapterCanvasFlow).toHaveBeenCalledTimes(2);
    const finalPut = mockedPutChapterCanvasFlow.mock.calls[1]?.[3] as {
      flow: { nodes: Array<{ id: string; data: Record<string, unknown> }> };
    };
    expect(finalPut.flow.nodes[0]).toMatchObject({
      id: "chapter-video-node-1",
      data: {
        status: "success",
        taskId: "task-chapter-video-1",
        videoUrl: "https://example.com/chapter-video.mp4",
        assetId: "asset-video-1",
        assetRegistrationStatus: "ready",
        videoResults: [
          expect.objectContaining({ assetId: "asset-video-1" }),
        ],
      },
    });
  });

  it("persists the provider failure code and message when reconcile receives a nested upstream error", async () => {
    const row: FlowRow = {
      id: "chapter-failed-video",
      name: "Chapter canvas",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    const runningFlow = {
      nodes: [
        {
          id: "chapter-video-failed-1",
          type: "taskNode",
          position: { x: 320, y: 120 },
          data: {
            kind: "video",
            label: "镜1",
            status: "running",
            taskId: "task-failed-video-1",
            clipRunId: "run-failed-video",
            clipIndex: 0,
            prompt: "原创动作镜头",
          },
        },
      ],
      edges: [],
    };
    mockedFetchTaskResultForPolling.mockResolvedValueOnce({
      ok: true,
      vendor: "newapi",
      result: {
        id: "task-failed-video-1",
        kind: "image_to_video",
        status: "failed",
        assets: [],
        raw: {
          response: {
            error: {
              code: "OutputVideoSensitiveContentDetected.PolicyViolation",
              message: "The output video may be related to copyright restrictions",
            },
          },
        },
      },
    });
    mockedGetChapterCanvasFlow.mockResolvedValueOnce({
      revision: 8,
      flow: runningFlow,
    });
    mockedPutChapterCanvasFlow.mockResolvedValue({ revision: 9 });

    const reconciled = await reconcileVideoNodesForFlow({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      chapterId: row.id,
      row: { ...row, data: JSON.stringify(runningFlow) },
    });

    expect(reconciled).toMatchObject({ reconciled: 0, failed: 1, stillRunning: 0 });
    const failedPut = mockedPutChapterCanvasFlow.mock.calls[0]?.[3] as {
      flow: { nodes: Array<{ data: Record<string, unknown> }> };
    };
    expect(failedPut.flow.nodes[0]?.data).toMatchObject({
      status: "failed",
      errorMessage:
        "The output video may be related to copyright restrictions (OutputVideoSensitiveContentDetected.PolicyViolation)",
      clipSubmitError:
        "The output video may be related to copyright restrictions (OutputVideoSensitiveContentDetected.PolicyViolation)",
    });
  });

  it("reconciles only the exact node and task pair when a target is provided", async () => {
    const runningFlow = {
      nodes: [
        {
          id: "video-node-target",
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            status: "submitting",
            prompt: "target prompt",
          },
        },
        {
          id: "video-node-unrelated",
          type: "taskNode",
          position: { x: 200, y: 0 },
          data: {
            kind: "video",
            status: "running",
            taskId: "task-unrelated",
            prompt: "unrelated prompt",
          },
        },
      ],
      edges: [],
    };
    const row: FlowRow = {
      id: "chapter-targeted-reconcile",
      name: "Targeted reconcile",
      data: JSON.stringify(runningFlow),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-15T00:00:00.000Z",
      updated_at: "2026-08-15T00:00:00.000Z",
    };
    mockedGetChapterCanvasFlow.mockResolvedValueOnce({ revision: 1, flow: runningFlow });
    mockedFetchTaskResultForPolling.mockResolvedValueOnce({ ok: false });

    const reconciled = await reconcileVideoNodesForFlow({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      chapterId: row.id,
      row,
      target: { nodeId: "video-node-target", taskId: "task-target" },
    });

    expect(reconciled).toMatchObject({ reconciled: 0, failed: 0, stillRunning: 1 });
    expect(mockedFetchTaskResultForPolling).toHaveBeenCalledTimes(1);
    expect(mockedFetchTaskResultForPolling).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ taskId: "task-target" }),
    );
  });

  it("reconciles and settles a finishing master with the frozen enhancement billing contract", async () => {
    const runningFlow = {
      nodes: [{
        id: "film-master-run-commercial",
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: {
          kind: "video",
          label: "商业母版 1080p",
          status: "running",
          taskId: "task-enhance-1",
          clipRunId: "run-commercial",
          finishingMaster: true,
          videoTaskKind: "video_enhance",
          videoModel: "volc-enhance-video",
          billingSpecKey: "professional:1080p:lte30",
        },
      }],
      edges: [],
    };
    const row: FlowRow = {
      id: "chapter-commercial",
      name: "Commercial chapter",
      data: JSON.stringify(runningFlow),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-09T00:00:00.000Z",
      updated_at: "2026-08-09T00:00:00.000Z",
    };
    mockedFetchTaskResultForPolling.mockResolvedValueOnce({
      ok: true,
      vendor: "newapi",
      result: {
        id: "task-enhance-1",
        kind: "video_enhance",
        status: "succeeded",
        assets: [{ type: "video", url: "https://example.com/master.mp4" }],
        raw: {},
      },
    });
    mockedGetChapterCanvasFlow.mockResolvedValueOnce({ revision: 4, flow: runningFlow });
    mockedPutChapterCanvasFlow.mockResolvedValue({ revision: 5 });

    const reconciled = await reconcileVideoNodesForFlow({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      chapterId: row.id,
      row,
    });

    expect(reconciled).toMatchObject({ reconciled: 1, failed: 0, stillRunning: 0 });
    expect(mockedFetchTaskResultForPolling).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ taskKind: "video_enhance", taskId: "task-enhance-1" }),
    );
    expect(mockedResolveTeamCreditsCostForTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskKind: "video_enhance",
        modelKey: "volc-enhance-video",
        specKey: "professional:1080p:lte30",
      }),
    );
    expect(mockedSettleTeamCreditsOnSuccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        taskKind: "video_enhance",
        taskId: "task-enhance-1",
        specKey: "professional:1080p:lte30",
      }),
    );
  });
});

function makeRow(nodes: object[]): FlowRow {
  return {
    id: "flow-1",
    name: "test",
    data: JSON.stringify({ nodes, edges: [] }),
    owner_id: "u1",
    project_id: "p1",
    created_at: new Date(),
    updated_at: new Date(),
    kind: null,
    chapter_id: null,
    yjs_state: null,
    yjs_updated_at: null,
  } as unknown as FlowRow;
}

describe("resolveChapterDesignBoardNodes", () => {
  it("returns empty when no design_board nodes exist", () => {
    const row = makeRow([
      { id: "n1", data: { kind: "video", productionLayer: "execution", imageUrl: "https://example.com/img.png" } },
    ]);
    expect(resolveChapterDesignBoardNodes(row)).toEqual([]);
  });

  it("returns nodes whose productionLayer=design_board and have imageUrl", () => {
    const row = makeRow([
      { id: "db-01", data: { productionLayer: "design_board", imageUrl: "https://cdn.example.com/board1.png", seedancePrompt: "冷银月色" } },
      { id: "db-02", data: { productionLayer: "design_board", imageUrl: "https://cdn.example.com/board2.png" } },
      { id: "anchor-char", data: { productionLayer: "anchors", imageUrl: "https://cdn.example.com/char.png" } },
    ]);
    const result = resolveChapterDesignBoardNodes(row);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "db-01", imageUrl: "https://cdn.example.com/board1.png", seedancePrompt: "冷银月色" });
    expect(result[1]).toMatchObject({ id: "db-02", imageUrl: "https://cdn.example.com/board2.png", seedancePrompt: "" });
  });

  it("skips design_board nodes without a valid http imageUrl", () => {
    const row = makeRow([
      { id: "db-01", data: { productionLayer: "design_board", imageUrl: "" } },
      { id: "db-02", data: { productionLayer: "design_board" } },
      { id: "db-03", data: { productionLayer: "design_board", imageUrl: "https://cdn.example.com/ok.png" } },
    ]);
    const result = resolveChapterDesignBoardNodes(row);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("db-03");
  });
});

describe("direct workflow video effect claim", () => {
  function workflowRow(nodes: readonly Record<string, unknown>[]): FlowRow {
    return {
      id: "flow-workflow-effect",
      name: "Workflow effect",
      data: JSON.stringify({ nodes, edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-11T10:00:00.000Z",
      updated_at: "2026-08-11T10:00:00.000Z",
    };
  }

  it("rejects a persisted submitting claim without calling the provider again", async () => {
    const row = workflowRow([{
      id: "runtime-video::output::video",
      type: "taskNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "video",
        status: "submitting",
        workflowEffectId: "execution-1:runtime-video:video-submit",
        workflowSubmissionState: "submitting",
      },
    }]);
    mockedGetFlowForOwner.mockResolvedValue(row);

    await expect(generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          id: "runtime-video::output::video",
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "镜头提示词",
            videoModel: "doubao-seedance-2-0-260128",
            videoDurationSeconds: 5,
            videoResolution: "1080p",
            aspectRatio: "16:9",
            workflowEffectId: "execution-1:runtime-video:video-submit",
          },
        },
      },
    })).rejects.toMatchObject({ code: "workflow_video_submission_uncertain" });
    expect(mockedRunPublicTask).not.toHaveBeenCalled();
  });

  it("persists submitting before the provider call and accepted after its receipt", async () => {
    let currentRow = workflowRow([]);
    mockedGetFlowForOwner.mockImplementation(async () => currentRow);
    mockedUpdateFlow.mockImplementation(async (_db, value: unknown) => {
      const input = value as {
        id: string;
        name: string;
        data: string;
        ownerId: string;
        projectId: string | null;
        nowIso: string;
      };
      currentRow = {
        ...currentRow,
        id: input.id,
        name: input.name,
        data: input.data,
        owner_id: input.ownerId,
        project_id: input.projectId,
        updated_at: input.nowIso,
      };
      return currentRow;
    });
    mockedCreateFlowVersion.mockResolvedValue(undefined);
    mockedRunPublicTask.mockImplementation(async () => {
      const graph = JSON.parse(currentRow.data) as {
        nodes: Array<{ data: Record<string, unknown> }>;
      };
      expect(graph.nodes[0]?.data).toMatchObject({
        status: "submitting",
        workflowSubmissionState: "submitting",
      });
      return {
        vendor: "newapi",
        result: {
          id: "provider-task-workflow-1",
          kind: "text_to_video",
          status: "running",
          assets: [],
          raw: {},
        },
      };
    });

    const result = await generateVideoToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: currentRow.id,
      row: currentRow,
      bodyArgs: {
        node: {
          id: "runtime-video::output::video",
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "video",
            prompt: "镜头提示词",
            videoModel: "doubao-seedance-2-0-260128",
            videoDurationSeconds: 5,
            videoResolution: "1080p",
            aspectRatio: "16:9",
            workflowEffectId: "execution-1:runtime-video:video-submit",
          },
        },
      },
    });

    expect(result).toMatchObject({
      status: "running",
      taskId: "provider-task-workflow-1",
      nodeId: "runtime-video::output::video",
    });
    expect(mockedUpdateFlow).toHaveBeenCalledTimes(2);
    const graph = JSON.parse(currentRow.data) as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    expect(graph.nodes[0]?.data).toMatchObject({
      status: "running",
      taskId: "provider-task-workflow-1",
      workflowSubmissionState: "accepted",
    });
  });
});
