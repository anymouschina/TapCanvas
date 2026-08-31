/**
 * task.new-api-enhance.test.ts
 *
 * TDD 测试：video_enhance 任务应通过 /v1/videos 端点路由到 new-api MediaKit。
 * body 仅含 model + metadata（不含 images/size/duration/prompt）。
 *
 * Mock 脚手架与 task.new-api-3d.test.ts 同款。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── 副作用 mock（必须在 import 被测模块之前） ───────────────────────────────

const { mockFetchWithHttpDebugLog, mockListNewApiModels } = vi.hoisted(() => ({
	mockFetchWithHttpDebugLog: vi.fn(),
	mockListNewApiModels: vi.fn(),
}));

vi.mock("../../httpDebugLog", () => ({
  fetchWithHttpDebugLog: (...args: unknown[]) => mockFetchWithHttpDebugLog(...args),
  isHttpDebugLogEnabled: () => false,
  getOrCreateRequestId: () => "req-test",
  getHttpDebugLogBodyLimit: () => 0,
}));

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    model_catalog_vendors: {
      findUnique: async () => ({ enabled: 1 }),
    },
    vendor_api_call_logs: {
      findMany: async () => [],
    },
    generated_assets: {
      findFirst: async () => null,
      upsert: async () => null,
    },
  }),
}));

vi.mock("../model-catalog/model-catalog.repo", () => ({
  ensureModelCatalogSchema: async () => undefined,
}));

vi.mock("../new-api-models/new-api-models.service", () => ({
  isSelectableNewApiModel: () => true,
  listNewApiModels: mockListNewApiModels,
}));

vi.mock("../team/team.service", () => ({
  requireSufficientTeamCredits: async () => null,
  settleTeamCreditsOnSuccess: async () => undefined,
  releaseTeamCreditsOnFailure: async () => undefined,
  bindTeamCreditsReservationToTaskId: async () => undefined,
}));

vi.mock("../billing/billing.service", () => ({
  resolveTeamCreditsCostForTask: async () => 0,
}));

vi.mock("../billing/billing.models", () => ({
  normalizeBillingModelKey: (key: string) => key,
}));

vi.mock("./task.stored-task-utils", async (importOriginal) => {
  const real = await importOriginal<typeof import("./task.stored-task-utils")>();
  return {
    upsertVendorTaskRefWithWarn: async () => undefined,
    upsertStoredTaskRefSafely: async () => undefined,
    bindTeamCreditsReservationToTaskId: async () => undefined,
    persistStoredTaskResult: async () => undefined,
    buildStoredQueuedTaskResult: () => ({
      id: "q1", kind: "video_enhance", status: "queued", assets: [], raw: {},
    }),
    buildStoredRunningTaskResult: () => ({
      id: "r1", kind: "video_enhance", status: "running", assets: [], raw: {},
    }),
    buildStoredFailedTaskResult: () => ({
      id: "f1", kind: "video_enhance", status: "failed", assets: [], raw: {},
    }),
    resolveStoredTaskId: () => "stored-1",
    resolveStoredTaskRefKind: real.resolveStoredTaskRefKind,
    resolveImageVendorApiKeyMissingMessage: () => null,
  };
});

vi.mock("./task.vendor-call-utils", () => ({
  recordVendorCallPayloads: async () => undefined,
  recordVendorCallForTaskResult: async () => undefined,
  upsertVendorCallLogPayloads: () => undefined,
  upsertVendorCallLogFinal: () => undefined,
}));

vi.mock("../../trace", () => ({
  setTraceStage: () => undefined,
}));

vi.mock("./task.progress", () => ({
  emitTaskProgress: () => undefined,
}));

vi.mock("../asset/asset.publicBase", () => ({
  resolvePublicAssetBaseUrl: () => "https://assets.example.com",
}));

vi.mock("../asset/asset.hosting", () => ({
  hostTaskAssetsInWorker: async ({ assets }: { assets: Array<{ type: string; url: string; thumbnailUrl: string | null }> }) =>
    assets.map((a) => ({
      ...a,
      url: `https://assets.example.com/${a.url.replace(/.*\//, "")}`,
    })),
  stageTaskAssetsForAsyncHosting: async () => undefined,
}));

vi.mock("./task.http-utils", () => ({
  extractUpstreamErrorMessage: () => null,
  fetchJsonWithDebug: async () => ({}),
  resolveRequiredVendorHttpContext: async () => ({ baseUrl: "", token: "" }),
}));

vi.mock("./task.billing", () => ({
  attachBillingSpecKeyToRaw: (r: unknown) => r,
  extractBillingSpecKeyFromTaskRequest: () => null,
  attachBillingSpecKeyToTaskResult: (r: unknown) => r,
  buildImageBillingSpecKey: () => null,
  isRichOfficialImageBillingSpecKey: () => false,
}));

vi.mock("./task.polling-core", () => ({
  readRoutingTaskKind: () => null,
  readProxyDisabled: () => false,
  isPublicApiRequest: () => false,
}));

vi.mock("../model/model.repo", () => ({
  getProvidersByVendorKey: async () => [],
  getActiveTokensByVendorKey: async () => [],
}));

vi.mock("./task-result.repo", () => ({
  getTaskResultByTaskId: async () => null,
}));

// 导入被测函数（必须在所有 vi.mock 之后）
import { resolveExecutableNewApiTaskModel, runGenericTaskForVendor } from "./task.service";
import type { AppContext } from "../../types";

// ─── 集成路由测试 ────────────────────────────────────────────────────────────

describe("video_enhance → /v1/videos 路由集成测试", () => {
  const MOCK_VIDEO_URL = "https://cdn.example.com/enhanced.mp4";
  const MOCK_HOSTED_URL = "https://assets.example.com/enhanced.mp4";

  const STANDARD_REQUEST = {
    kind: "video_enhance" as const,
    prompt: "",
    extras: {
      modelKey: "volc-enhance-video",
      video_url: "https://x/src.mp4",
      tool_version: "standard",
      scene: "aigc",
      resolution: "1080p",
    },
  };

  function buildMinimalCtx(): AppContext {
    return {
      env: {
        NEW_API_INTERNAL_BASE_URL: "http://new-api.internal",
        NEW_API_INTERNAL_TOKEN: "test-token",
        DB: {} as any,
      },
      get: (key: string) => {
        if (key === "activeTeamId") return null;
        if (key === "requestId") return "req-1";
        if (key === "httpDebugLogEnabled") return false;
        return undefined;
      },
      set: () => undefined,
      req: {
        raw: {
          signal: null,
        },
      } as any,
    } as unknown as AppContext;
  }

  function mockSuccessResponse() {
    const responseBody = {
      id: "enhance-task-1",
      status: "succeeded",
      data: {
        content: {
          video_url: MOCK_VIDEO_URL,
        },
      },
    };
    mockFetchWithHttpDebugLog.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
	mockListNewApiModels.mockResolvedValue([
		{
			modelName: "volc-enhance-video",
			requestModelKey: "volc-enhance-video",
			routingAliases: [],
			displayLabel: "Video Enhance",
			kind: "video",
		},
		{
			modelName: "doubao-seedance-2-0-260128",
			requestModelKey: "doubao-seedance-2-0-260128",
			routingAliases: [],
			displayLabel: "Seedance 2.0",
			kind: "video",
		},
	]);
    mockSuccessResponse();
  });

	it("rejects an unknown model with exact executable candidates before any upstream request", async () => {
		const c = buildMinimalCtx();
		await expect(resolveExecutableNewApiTaskModel(c, "newapi", {
			kind: "video_enhance",
			prompt: "",
			extras: { modelKey: "invented-model" },
		})).rejects.toMatchObject({
			code: "new_api_model_disabled",
			status: 400,
			details: {
				upstreamRequestAttempted: false,
				executableModels: expect.arrayContaining([
					expect.objectContaining({ modelKey: "volc-enhance-video" }),
				]),
			},
		});
		expect(mockFetchWithHttpDebugLog).not.toHaveBeenCalled();
	});

  it("首个上游请求 URL 以 /v1/videos 结尾", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    const firstCallUrl = mockFetchWithHttpDebugLog.mock.calls[0]![1] as string;
    expect(typeof firstCallUrl).toBe("string");
    expect(firstCallUrl).toMatch(/\/v1\/videos$/);
  });

  it("请求 body.model === 'volc-enhance-video'", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.model).toBe("volc-enhance-video");
  });

  it("请求 body.metadata.video_url === 'https://x/src.mp4'", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.metadata.video_url).toBe("https://x/src.mp4");
  });

  it("请求 body.metadata.tool_version === 'standard'", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.metadata.tool_version).toBe("standard");
  });

  it("请求 body.metadata.scene === 'aigc'", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.metadata.scene).toBe("aigc");
  });

  it("请求 body.metadata.resolution === '1080p'", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.metadata.resolution).toBe("1080p");
  });

  it("请求 body 不含 images 字段（超分不传参考图）", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.images).toBeUndefined();
  });

  it("mock 轮询返回成功后，result.assets[0].url 为预期 video_url", async () => {
    const c = buildMinimalCtx();
    const result = await runGenericTaskForVendor(c, "u1", "volc", STANDARD_REQUEST);

    expect(result.assets.length).toBeGreaterThan(0);
    expect(result.assets[0]!.url).toBe(MOCK_HOSTED_URL);
  });

  it("供应商边界逐字保留 agents 交付的正向与负向视频提示词", async () => {
    const c = buildMinimalCtx();
    const prompt =
      '【AUDIO_AUTHORITY】仅SpokenText发声\nDialogue#1 | SpokenText="这就是 epic、8K、masterpiece 与大片感。"\n' +
      "【VISUAL_ONLY】保持 high-energy 字样作为原文事实；consistent with the reference images。";
    const negativePrompt =
      "保留项目自定的轻微颗粒与高光溢出；不要由 Hono 合并通用反 AI 模板。";

    await runGenericTaskForVendor(c, "u1", "volc", {
      kind: "text_to_video",
      prompt,
      negativePrompt,
      extras: {
        modelKey: "doubao-seedance-2-0-260128",
        durationSeconds: 5,
        persistAssets: false,
      },
    });

    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(String(firstCallInit.body)) as {
      prompt?: unknown;
      metadata?: { negative_prompt?: unknown };
    };
    expect(body.prompt).toBe(prompt);
    expect(body.metadata?.negative_prompt).toBe(negativePrompt);
  });
});
