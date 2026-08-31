/**
 * task.new-api-3d.test.ts
 *
 * TDD 测试：image_to_3d 任务应通过 /v1/videos 端点路由到 new-api seed3d。
 *
 * Mock 脚手架与 task.new-api-video.test.ts 同款——纯函数 + 最小依赖 mock 验证路由路径。
 * fetchWithHttpDebugLog 签名：(c, url, init, meta) => Promise<Response>
 *
 * 注：resolveStoredTaskRefKind 的真实实现单元测试见 task.stored-task-utils.test.ts，
 * 此文件集成 mock 中仅保留其他副作用函数的 mock，不再 mock resolveStoredTaskRefKind，
 * 避免掩盖异步入队路径中 image_to_3d 返回 null 的 bug。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── 副作用 mock（必须在 import 被测模块之前） ───────────────────────────────

const mockFetchWithHttpDebugLog = vi.fn();

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
  listNewApiModels: async () => [
    { modelName: "doubao-seed3d-2-0-260328", requestModelKey: "doubao-seed3d-2-0-260328" },
  ],
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

// resolveStoredTaskRefKind 不再 mock，使用真实实现：
// 真实实现已在 task.stored-task-utils.test.ts 单独单测覆盖；
// 此处透传真实函数，避免掩盖 image_to_3d 异步入队路径的 null bug。
vi.mock("./task.stored-task-utils", async (importOriginal) => {
  const real = await importOriginal<typeof import("./task.stored-task-utils")>();
  return {
    upsertVendorTaskRefWithWarn: async () => undefined,
    upsertStoredTaskRefSafely: async () => undefined,
    bindTeamCreditsReservationToTaskId: async () => undefined,
    persistStoredTaskResult: async () => undefined,
    buildStoredQueuedTaskResult: () => ({
      id: "q1", kind: "image_to_3d", status: "queued", assets: [], raw: {},
    }),
    buildStoredRunningTaskResult: () => ({
      id: "r1", kind: "image_to_3d", status: "running", assets: [], raw: {},
    }),
    buildStoredFailedTaskResult: () => ({
      id: "f1", kind: "image_to_3d", status: "failed", assets: [], raw: {},
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

// mock asset hosting：将 assets URL 重写到已托管域名，通过 isHostedTaskAssetUrl 检查
// resolvePublicAssetBaseUrl mock 返回 "https://assets.example.com"
// 所以托管后的 URL 必须以该前缀开头
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

// 导入被测纯函数和集成函数（必须在所有 vi.mock 之后）
import {
  buildNewApiVideoRequestShape,
  collectTaskReferenceImageUrls,
  isDirectNewApiVideoReferenceUrl,
  extractNewApiVideoAssets,
  runGenericTaskForVendor,
} from "./task.service";
import type { AppContext } from "../../types";

// ─── 纯函数层测试 ────────────────────────────────────────────────────────────

describe("image_to_3d 纯函数路径", () => {
  it("buildNewApiVideoRequestShape 对 image_to_3d 返回空 shape（3D 无视频参数）", () => {
    const shape = buildNewApiVideoRequestShape("newapi", {
      kind: "image_to_3d",
      prompt: "生成手办",
      extras: {
        modelKey: "doubao-seed3d-2-0-260328",
        imageUrl: "https://x/a.png",
      },
    });
    // seed3d 不接收任何视频尺寸/分辨率参数，shape 应全部为空
    expect(shape.size).toBeUndefined();
    expect(shape.resolution).toBeUndefined();
    expect(shape.aspectRatio).toBeUndefined();
  });

  it("collectTaskReferenceImageUrls 能从 extras.imageUrl 收集 seed3d 参考图", () => {
    const refs = collectTaskReferenceImageUrls({
      imageUrl: "https://x/a.png",
      modelKey: "doubao-seed3d-2-0-260328",
    });
    expect(refs).toContain("https://x/a.png");
  });

  it("isDirectNewApiVideoReferenceUrl 对 https:// 图片 URL 返回 true（走 images[] 直传分支）", () => {
    expect(isDirectNewApiVideoReferenceUrl("https://x/a.png")).toBe(true);
  });

  it("extractNewApiVideoAssets 能从 seed3d 风格响应提取 model_url", () => {
    // doubao adaptor 把 3D 模型 URL 放到 data.content.video_url（content.url 也支持）
    const assets = extractNewApiVideoAssets({
      data: {
        content: {
          video_url: "https://cdn.example.com/model.glb",
        },
      },
    });
    expect(assets.length).toBeGreaterThan(0);
    expect(assets[0]!.url).toBe("https://cdn.example.com/model.glb");
    // #3：明确记录「3D 当前复用 video 资产类型」这一有意行为：
    // 前端按 model3dUrl 单独取用，不依赖 type，所以保持 video 即可，无需改生产代码。
    expect(assets[0]!.type).toBe("video");
  });
});

// ─── 集成路由测试 ────────────────────────────────────────────────────────────

/**
 * fetchWithHttpDebugLog 签名：(c: AppContext, url: string, init: RequestInit, meta?) => Promise<Response>
 * 所以 mock.calls[0] = [c, url, init, meta]
 *   calls[0][1] = url
 *   calls[0][2] = init（含 body）
 */

describe("image_to_3d → /v1/videos 路由集成测试", () => {
  // 原始 CDN URL；经 hostTaskAssetsInWorker mock 后会变为 https://assets.example.com/model.glb
  const MOCK_VIDEO_URL = "https://cdn.example.com/model.glb";
  const MOCK_HOSTED_URL = "https://assets.example.com/model.glb";

  const STANDARD_REQUEST = {
    kind: "image_to_3d" as const,
    prompt: "生成手办",
    extras: {
      modelKey: "doubao-seed3d-2-0-260328",
      imageUrl: "https://x/a.png",
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
      id: "seed3d-task-1",
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
    mockSuccessResponse();
  });

  it("首个上游请求 URL 以 /v1/videos 结尾", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "doubao", STANDARD_REQUEST);

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    // fetchWithHttpDebugLog(c, url, init, meta) — 第 2 个参数是 url
    const firstCallUrl = mockFetchWithHttpDebugLog.mock.calls[0]![1] as string;
    expect(typeof firstCallUrl).toBe("string");
    expect(firstCallUrl).toMatch(/\/v1\/videos$/);
  });

  it("请求 body.model === 'doubao-seed3d-2-0-260328'", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "doubao", STANDARD_REQUEST);

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.model).toBe("doubao-seed3d-2-0-260328");
  });

  it("请求 body 包含参考图（images 数组含 imageUrl）", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "doubao", STANDARD_REQUEST);

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.images).toBeDefined();
    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images).toContain("https://x/a.png");
  });

  it("请求 body 包含 prompt '生成手办'", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "doubao", STANDARD_REQUEST);

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    expect(body.prompt).toBe("生成手办");
  });

  it("mock 轮询返回成功后，result.assets[0].url 为预期 video_url", async () => {
    const c = buildMinimalCtx();
    const result = await runGenericTaskForVendor(c, "u1", "doubao", STANDARD_REQUEST);

    expect(result.assets.length).toBeGreaterThan(0);
    // URL 经 hostTaskAssetsInWorker mock 转存到 assets.example.com
    expect(result.assets[0]!.url).toBe(MOCK_HOSTED_URL);
  });

  // #4：extras.imageUrl 缺失时的失败路径用例
  // 现状：缺图时静默透传无 images 字段给上游（refs 为空走 else 分支），不报错。
  // 建议后续加 400 校验（当前轮不改生产逻辑，避免越界）。
  it("extras.imageUrl 缺失时，请求 body 不含 images 字段（当前静默透传行为，建议后续加 400 校验）", async () => {
    const c = buildMinimalCtx();
    await runGenericTaskForVendor(c, "u1", "doubao", {
      kind: "image_to_3d",
      prompt: "生成手办",
      extras: {
        modelKey: "doubao-seed3d-2-0-260328",
        // imageUrl 故意缺失
      },
    });

    expect(mockFetchWithHttpDebugLog).toHaveBeenCalled();
    const firstCallInit = mockFetchWithHttpDebugLog.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(firstCallInit.body as string);
    // 当前行为：refs 为空，body.images 不被设置，静默透传无参考图给上游
    expect(body.images).toBeUndefined();
    // model 和 prompt 仍正常透传
    expect(body.model).toBe("doubao-seed3d-2-0-260328");
    expect(body.prompt).toBe("生成手办");
  });
});
