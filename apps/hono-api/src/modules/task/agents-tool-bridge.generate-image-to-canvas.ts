import { z } from "zod";
import { loadImageViewControlsModule } from "../../platform/node/shared-schema-loader";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { resolvePositiveIntEnv, CONCURRENCY_DEFAULTS } from "./concurrency-limits";
import {
  PublicFlowCreateTaskNodeSchema,
  PublicFlowGraphSchema,
} from "../flow/flow.public.schemas";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  mapFlowRowToDto,
  type FlowRow,
} from "../flow/flow.repo";
import { runPublicTask } from "../apiKey/apiKey.routes";
import { fetchTaskResultForPolling } from "./task.polling";
import { isProviderTaskPendingStatus } from "./provider-task-status";
import { freshReadFlowRow, persistFlowPatch } from "./video-orchestrator.flow-io";
import { pollUntilSettled } from "./task.polling-core";
import { broadcastPatch, broadcastToolProgress } from "../chapter/canvas-sse.manager";
import { writeFinalNodeToChapterCanvas } from "./agents-tool-bridge.chapter-canvas-write";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import { resolveWorldInfo } from "../worldinfo/world-info.service";
import {
  selectAnchorReferenceImages,
  type LockedAnchors,
} from "./chapter-anchor-autobind";
import { createProjectWorldInfoLoader } from "../worldinfo/world-info.loader";
import { isGptImageModel } from "./agents-tool-bridge.gpt-image-denoise";
import {
  listMaterialAssets,
  readCanvasIndexStyleImages,
  readCanvasIndexStyleLock,
  readCanvasIndexCinematicCamera,
} from "../material/material.repo";
import { listProjectNodeAssetsForOwner } from "../material/material.project-node-assets.service";
import {
  buildProjectStyleProvenance,
  type ProjectStyleProvenance,
} from "./authoring-style-provenance";
import { appendCinematicCameraPrompt } from "./cinematic-camera-prompt";
import {
  maybeAutoRegisterCanvasCard,
  classifyCanvasCardForRegistry,
  withMaterialRegistrationMarker,
} from "./material-auto-register";
import {
  selectCanonicalPropBaseImageUrl,
} from "./prop-material-identity";
import { parseUserGenerationPrefs, resolveImageGenerateDefaults } from "../auth/generation-prefs";
import { getPrismaClient } from "../../platform/node/prisma";
import {
  resolveKeyframeBlockingReference,
  type KeyframeBlockingReference,
} from "./image-keyframe-blocking";
import {
  buildAsyncAgentContinuationNodeStates,
  claimReadyAsyncAgentContinuations,
} from "./async-agent-continuation";
import { scheduleAsyncAgentContinuations } from "./public-agents-chat";
import { resolveExecutionImageReferences } from "./agents-tool-bridge.image-reference-ids";
import {
  buildProjectLookBibleImagePrompt,
  getActiveProjectLookBible,
} from "../material/project-look-bible";
import {
	isStoryPreviewAssetData,
	normalizeStoryPreviewAssetData,
	STORY_PREVIEW_MAX_SHOTS_PER_BOARD,
} from "./story-preview-asset";
import {
	getStoryPreviewReferenceKeys,
	getStoryPreviewBoardTimeline,
	normalizeStoryPreviewContract,
	normalizeStoryPreviewCells,
	normalizeStoryPreviewNodeContract,
	type StoryPreviewContract,
	type StoryPreviewNodeContract,
	type StoryPreviewReference,
} from "../chapter/story-preview-contract";
import {
  buildStoryboardAnchorCandidatesFromAssets,
} from "./storyboard-anchor-gate";
import {
	STORY_PREVIEW_MAX_BOARDS,
	type StoryPreviewRunSnapshot,
} from "./story-preview-orchestrator";
import {
	readStoryPreviewSourceWindow,
} from "./story-preview-source-window";
import { buildProviderTaskFailureMessage } from "./provider-task-failure";

const { appendImageViewPrompt } = loadImageViewControlsModule();

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = readTrimmedString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

type CanvasAssetInput = {
  assetId?: string;
  assetRefId?: string;
  url?: string;
  role?: string;
  weight?: number;
  note?: string;
  name?: string;
};

type ReferenceAssetBinding = {
  assetId: string;
  role: "layout" | "style" | "identity" | "content";
  strength?: number;
};

function normalizeReferenceAssetBindings(value: unknown): ReferenceAssetBinding[] {
  if (!Array.isArray(value)) return [];
  const out: ReferenceAssetBinding[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const assetId = readTrimmedString(record.assetId);
    const role = readTrimmedString(record.role);
    const strength = record.strength;
    if (!assetId || seen.has(assetId)) continue;
    if (role !== "layout" && role !== "style" && role !== "identity" && role !== "content") {
      continue;
    }
    seen.add(assetId);
    out.push({
      assetId,
      role,
      ...(typeof strength === "number" && Number.isFinite(strength)
        ? { strength }
        : {}),
    });
  }
  return out;
}

function normalizeAssetInputs(value: unknown): CanvasAssetInput[] {
  if (!Array.isArray(value)) return [];
  const out: CanvasAssetInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const assetId = readTrimmedString(record.assetId);
    const assetRefId = readTrimmedString(record.assetRefId);
    const url = readTrimmedString(record.url);
    const role = readTrimmedString(record.role);
    const weight = record.weight;
    const note = readTrimmedString(record.note);
    const name = readTrimmedString(record.name);
    if (!assetId && !url) continue;
    out.push({
      ...(assetId ? { assetId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
      ...(url ? { url } : {}),
      ...(role ? { role } : {}),
      ...(typeof weight === "number" && Number.isFinite(weight) ? { weight } : {}),
      ...(note ? { note } : {}),
      ...(name ? { name } : {}),
    });
  }
  return out;
}

function extractImageUrlFromTaskResult(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const record = result as Record<string, unknown>;
  const direct = readTrimmedString(record.imageUrl);
  if (direct) return direct;
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : [];
  for (const item of imageResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = readTrimmedString((item as Record<string, unknown>).url);
    if (url) return url;
  }
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const item of assets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = readTrimmedString((item as Record<string, unknown>).url);
    if (url) return url;
  }
  return "";
}

function extractImageAssetIdFromTaskResult(result: unknown, imageUrl: string): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const normalizedUrl = readTrimmedString(imageUrl);
  const record = result as Record<string, unknown>;
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const item of assets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const assetRecord = item as Record<string, unknown>;
    const url = readTrimmedString(assetRecord.url);
    if (normalizedUrl && url !== normalizedUrl) continue;
    return readTrimmedString(assetRecord.assetId);
  }
  return "";
}

const ImageCanvasNodeKindSchema = z.enum(["image", "imageEdit", "storyboardImage"]);

const ReferenceAssetBindingSchema = z.object({
  assetId: z.string().trim().min(1),
  role: z.enum(["layout", "style", "identity", "content"]),
  strength: z.number().finite().min(0).max(1).optional(),
});

const SingleImageNodeSchema = PublicFlowCreateTaskNodeSchema.superRefine((node, ctx) => {
  if (!ImageCanvasNodeKindSchema.safeParse(node.data.kind).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "node.data.kind must be image, imageEdit, or storyboardImage",
      path: ["data", "kind"],
    });
  }
  const prompt = readTrimmedString((node.data as Record<string, unknown>).prompt);
  if (!prompt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "node.data.prompt is required",
      path: ["data", "prompt"],
    });
  }
  const nodeData = node.data as Record<string, unknown>;
  if (isStoryPreviewAssetData(nodeData)) {
    const preview = normalizeStoryPreviewAssetData(nodeData);
    if (!preview) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `preview 分镜必须声明完整 previewSeriesId/previewBoardIndex/previewBoardCount，且每板 previewShotCount 为 1~${STORY_PREVIEW_MAX_SHOTS_PER_BOARD}`,
        path: ["data", "previewShotCount"],
      });
    }
    if (nodeData.kind !== "storyboardImage") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "story preview 必须使用 data.kind=storyboardImage",
        path: ["data", "kind"],
      });
    }
    for (const forbiddenField of ["clipRunId", "clipIndex", "storyboardScope", "masterBoardNodeId"]) {
      if (nodeData[forbiddenField] === undefined) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `preview 分镜禁止携带生产绑定字段 ${forbiddenField}`,
        path: ["data", forbiddenField],
      });
    }
  }
  const bindingsValue = nodeData.referenceAssetBindings;
  if (bindingsValue !== undefined) {
    const bindings = z.array(ReferenceAssetBindingSchema).max(16).safeParse(bindingsValue);
    if (!bindings.success) {
      bindings.error.issues.forEach((issue) => {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: ["data", "referenceAssetBindings", ...issue.path],
        });
      });
    } else {
      const seen = new Set<string>();
      bindings.data.forEach((binding, index) => {
        if (!seen.has(binding.assetId)) {
          seen.add(binding.assetId);
          return;
        }
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "referenceAssetBindings assetId must be unique",
          path: ["data", "referenceAssetBindings", index, "assetId"],
        });
      });
    }
  }
  if (
    nodeData.seed !== undefined &&
    (typeof nodeData.seed !== "number" ||
      !Number.isFinite(nodeData.seed) ||
      !Number.isInteger(nodeData.seed))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "node.data.seed must be a finite integer",
      path: ["data", "seed"],
    });
  }
});

const CompactStoryPreviewCellSchema = z.object({
	frame: z.string().trim().min(1).max(600),
	mid: z.string().trim().min(1).max(600),
	end: z.string().trim().min(1).max(600),
	camera: z.string().trim().min(1).max(400),
	feedback: z.string().trim().min(1).max(400),
	environment: z.string().trim().min(1).max(400),
	subjectRefIds: z.array(z.string().trim().min(1)).min(1).max(32),
}).strict();

const CompactStoryPreviewBoardSchema = z.object({
	boardIndex: z.number().int().min(0),
	openingState: z.string().trim().min(1).max(600),
	cells: z.array(CompactStoryPreviewCellSchema).min(1).max(STORY_PREVIEW_MAX_SHOTS_PER_BOARD),
}).strict();

type AuthoredCompactStoryPreviewBoard = {
	seriesId: string;
	boardIndex: number;
	openingState: string;
	cells: Array<z.infer<typeof CompactStoryPreviewCellSchema>>;
};

// node（单图）或 nodes（批量并发出图，独立的角色卡/场景卡/故事板一次性并发出）二选一。
// 批量是单图的超集：N=1 等价单图。并发出图把"逐张串行等 ~2min"压成"一批并发"。
export const PublicAgentsImageGenerateToCanvasArgsSchema = z
	.object({
    node: SingleImageNodeSchema.optional(),
    nodes: z.array(SingleImageNodeSchema).min(1).max(8).optional(),
	})
	.strict()
  .superRefine((v, ctx) => {
		const suppliedModes = Number(Boolean(v.node))
			+ Number(Boolean(v.nodes?.length));
		if (suppliedModes === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
				message: "必须提供 node（单图）或 nodes（多张独立图并发出，最多8张）",
      });
    }
		if (suppliedModes > 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "node 与 nodes 必须且只能提供一种",
			});
		}
    const candidates = [
      ...(v.node ? [{ node: v.node, path: ["node"] as Array<string | number> }] : []),
      ...(v.nodes ?? []).map((node, index) => ({
        node,
        path: ["nodes", index] as Array<string | number>,
      })),
    ];
    candidates.forEach(({ node, path }) => {
      const data = node.data as Record<string, unknown>;
      if (data.waitForResult !== true) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "agent 生图禁止 waitForResult:true；供应商受理后必须异步返回并持久化 running+taskId，再通过 reconcile 收取结果，避免已付费任务在 HTTP 超时后成为孤儿",
        path: [...path, "data", "waitForResult"],
      });
    });
  });

export type PublicAgentsImageGenerateToCanvasArgs = z.infer<
  typeof PublicAgentsImageGenerateToCanvasArgsSchema
>;

export type PublicAgentsImageGenerateToCanvasResult = {
  ok: true;
  flowId: string;
  updatedAt: string;
  stats: {
    createdNodes: number;
    createdEdges: number;
    patchedNodes: number;
    appendedArrays: number;
  };
  nodeId: string;
  imageUrl: string;
  vendor: string;
  taskId: string | null;
  /** "running"=已提交后台、占位节点已写、靠前端轮询/reconcile 回写；"success"=同步已拿到 imageUrl。 */
  status: "running" | "success";
  /**
   * 结构化的父任务结算边界。只有在图片节点与供应商任务标识
   * 均已持久化后才返回 submission；后续资产物化由画布节点自身负责。
   */
  completionBoundary?: "submission";
  /** true 表示命中同一章节预览板的已有任务/结果，未再次创建节点或发起付费生成。 */
  reused?: boolean;
};

async function awaitImageResult(input: {
  c: AppContext;
  userId: string;
  vendor: string;
  initialResult: TaskResultDto;
  prompt: string;
  taskKind: TaskRequestDto["kind"];
}): Promise<{ vendor: string; result: TaskResultDto; taskId: string | null; imageUrl: string }> {
  let currentVendor = input.vendor;
  let currentResult = input.initialResult;
  let imageUrl = extractImageUrlFromTaskResult(currentResult);
  let status = readTrimmedString(currentResult.status).toLowerCase();
  let taskId = readTrimmedString(currentResult.id) || null;
  if (imageUrl && status === "succeeded") {
    return { vendor: currentVendor, result: currentResult, taskId, imageUrl };
  }

  if ((status === "queued" || status === "running") && taskId) {
    const settled = await pollUntilSettled({
      // 2K 图片生成可能逼近或超过 180s，短超时会导致任务已被供应商受理但本地误判失败。
      // 2026-06-10 实测 gpt-image-2 上游延迟已达 5.5~6min：300s 等待每次差 30~60s 超时，
      // 而任务实际成功、费用已扣 → orchestrator 下个 tick 重新提交 = 同一张图每 5 分钟重复付费
      // （ch47 clip10 连烧 7 笔）。默认提到 480s，env IMAGE_SYNC_WAIT_TIMEOUT_MS 可调。
      timeoutMs: (() => {
        const raw = Number(
          (input.c.env as Record<string, unknown>)?.IMAGE_SYNC_WAIT_TIMEOUT_MS ??
            globalThis.process?.env?.IMAGE_SYNC_WAIT_TIMEOUT_MS,
        );
        return Number.isFinite(raw) && raw > 0 ? raw : 480_000;
      })(),
      intervalMs: 1_500,
      pollOnce: async () =>
        fetchTaskResultForPolling(input.c, input.userId, {
          taskId,
          vendor: currentVendor,
          taskKind: input.taskKind,
          prompt: input.prompt,
          mode: "public",
        }),
      evaluate: (outcome) => {
        if (!outcome.ok) return "continue";
        currentVendor = readTrimmedString(outcome.vendor) || currentVendor;
        currentResult = outcome.result;
        imageUrl = extractImageUrlFromTaskResult(currentResult);
        status = readTrimmedString(currentResult.status).toLowerCase();
        if (status === "succeeded" && imageUrl) return "success";
        if (status === "failed") return "failure";
        return "continue";
      },
    });
    if (settled.state === "success" && imageUrl) {
      return { vendor: currentVendor, result: currentResult, taskId, imageUrl };
    }
  }

  if (status === "queued" || status === "running") {
    throw new AppError("图片生成超时：任务仍未完成", {
      status: 504,
      code: "agents_tool_image_generate_timeout",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
      },
    });
  }

  if (status !== "succeeded") {
    throw new AppError("图片生成失败", {
      status: 502,
      code: "agents_tool_image_generate_failed",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
        message: buildProviderTaskFailureMessage(currentResult) || null,
      },
    });
  }

  if (!imageUrl) {
    throw new AppError("图片生成失败：未返回图片 URL", {
      status: 502,
      code: "agents_tool_image_missing_url",
      details: {
        taskId,
        vendor: currentVendor || null,
      },
    });
  }

  return { vendor: currentVendor, result: currentResult, taskId, imageUrl };
}

type ImageGenInput = {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  bodyArgs: unknown;
  // When set, the result node is written into this chapter's canvas
  // (`chapters.canvas_flow`) instead of the flows table. `row` is then a
  // synthetic FlowRow carrying the chapter canvas graph (for group-config reads).
  chapterId?: string;
  /** Only the dedicated durable story-preview route may submit an authored board. */
  storyPreviewOperation?: true;
  // 批量出图时的工具调用 id：用于向画布频道广播"已完成 N/总数"进度，前端对话框按此关联。
  toolCallId?: string;
};

export type PublicAgentsImageGenerateBatchResult = {
  ok: true;
  batch: true;
  flowId: string;
  updatedAt: string;
  count: number;
  succeeded: number;
  completionBoundary?: "submission";
  results: Array<
    | { index: number; ok: true; nodeId?: string; taskId?: string | null; imageUrl?: string; status?: string }
    | { index: number; ok: false; error: string }
  >;
};

/** 批量并发上限：单次 image_generate 最多并发出的图数（gen 是 ~2min 瓶颈，写画布走乐观锁重试）。 */
const IMAGE_BATCH_CONCURRENCY = 3;

/**
 * 全局图片生成并发信号量：所有请求共享，防止同时打出过多出图任务把内存/API 打爆。
 * 通过 IMAGE_GLOBAL_CONCURRENCY 环境变量配置，默认 4。
 */
const imageGlobalSemaphore = (() => {
  // Finite default (4) — previously fell open to 999999 when IMAGE_GLOBAL_CONCURRENCY
  // was unset, so concurrent image gens were effectively unbounded and could blow
  // the heap with 2K/4K image buffers at peak. Override via IMAGE_GLOBAL_CONCURRENCY.
  const max = resolvePositiveIntEnv(
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      ?.process?.env?.IMAGE_GLOBAL_CONCURRENCY,
    CONCURRENCY_DEFAULTS.imageGlobal,
  );
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    get active() { return active; },
    get max() { return max; },
    async acquire(): Promise<void> {
      if (active < max) { active++; return; }
      await new Promise<void>((resolve) => { waiters.push(resolve); });
    },
    release() {
      active = Math.max(0, active - 1);
      const next = waiters.shift();
      if (next) { active++; next(); }
    },
  };
})();

/**
 * 画布坐标只是布局信息，绝不该阻断出图。Agent 构造 node 时常漏 `position`（尤其批量 nodes），
 * 而 PublicFlowCreateTaskNodeSchema 把 position 设为必填 → 整批被 "Invalid image generate to
 * canvas request" 拒掉，且返回的错误信息笼统、agent 难自纠。这里在校验前补默认形状：
 * 缺 position → 按序错开补一个坐标；缺 type → 补 "taskNode"。其它字段不动，prompt/kind 等仍由 schema 严格校验。
 */
export function ensureImageNodeShape(node: unknown, index = 0): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...n };
  if (out.type === undefined) out.type = "taskNode";
  const pos = out.position as Record<string, unknown> | undefined;
  const hasValidPos =
    !!pos &&
    typeof pos === "object" &&
    Number.isFinite(Number((pos as Record<string, unknown>).x)) &&
    Number.isFinite(Number((pos as Record<string, unknown>).y));
  if (!hasValidPos) {
    out.position = { x: index * 360, y: 0 };
  }
  // 生产故事板图默认属于 design_board；剧情预览板由显式 preview 合同隔离，永不进入生产。
  // 该标记只表达资产用途，不能作为所有视频起跑前必须存在设计板的语义门禁。
	const data = out.data as Record<string, unknown> | undefined;
	if (data && typeof data === "object") {
		const kind = String((data as Record<string, unknown>).kind || "").trim();
		const preview = normalizeStoryPreviewAssetData(data as Record<string, unknown>);
		out.data = {
			...(data as Record<string, unknown>),
      ...(preview ?? {}),
      ...(kind === "storyboardImage" && !preview && !readTrimmedString((data as Record<string, unknown>).productionLayer)
        ? { productionLayer: "design_board" }
        : {}),
      // A generated asset is never user-approved merely because generation succeeded.
      // Existing approved assets are reused without calling the generation tool.
      approvalStatus: "needs_confirmation",
    };
  }
  return out;
}

function readCurrentCanvasNodes(row: FlowRow): Array<{ id?: unknown; data?: unknown }> {
  const dto = mapFlowRowToDto(row);
  const flowData = sanitizeFlowDataForStorage(dto.data ?? {});
  const nodes = (flowData as Record<string, unknown>).nodes;
  return Array.isArray(nodes) ? (nodes as Array<{ id?: unknown; data?: unknown }>) : [];
}

function readPersistedStoryPreviewContract(row: FlowRow, chapterId: string): {
	contract: StoryPreviewContract;
	sourceChapterRevision: number;
	sourceHash: string;
	sourceNarrative: string;
} | null {
	const seedId = `chapter-seed-${chapterId}`;
	const seed = readCurrentCanvasNodes(row).find((node) => String(node.id ?? "") === seedId);
	if (!seed?.data || typeof seed.data !== "object" || Array.isArray(seed.data)) return null;
	const data = seed.data as Record<string, unknown>;
	const contract = normalizeStoryPreviewContract(data.storyPreviewContract);
	const sourceChapterRevision = Number(data.sourceChapterRevision);
	const sourceHash = readTrimmedString(data.sourceHash);
	if (!contract || !Number.isInteger(sourceChapterRevision) || sourceChapterRevision < 0 || !sourceHash) return null;
	return {
		contract,
		sourceChapterRevision,
		sourceHash,
		sourceNarrative: readTrimmedString(data.prompt) || readTrimmedString(data.content),
	};
}

type ReusableStoryPreviewBoard = {
	nodeId: string;
	imageUrl: string;
	vendor: string;
	taskId: string | null;
	status: "running" | "success";
};

function buildCanonicalStoryPreviewSeriesId(input: {
	chapterId: string;
	sourceChapterRevision: number;
	sourceHash: string;
	contract: StoryPreviewContract;
}): string {
	const start = formatStoryPreviewSeconds(input.contract.previewWindow.startSeconds);
	const end = formatStoryPreviewSeconds(input.contract.previewWindow.endSeconds);
	return `story-preview:${input.chapterId}:r${input.sourceChapterRevision}:${input.sourceHash.slice(0, 12)}:${start}-${end}`;
}

/**
 * Project the persisted chapter/canvas state into the deterministic preview
 * execution graph. Running boards count as completed authoring units because
 * their paid submission has already been accepted; a later status run will
 * reopen a board only if its persisted node is terminal-failed or missing.
 */
export function inspectStoryPreviewRunSnapshot(input: {
	row: FlowRow;
	chapterId: string;
}): StoryPreviewRunSnapshot {
	const persisted = readPersistedStoryPreviewContract(input.row, input.chapterId);
	if (!persisted) {
		throw new AppError(
			"章节故事预览必须先保存总时长、预览窗口和完整参考资产合同",
			{
				status: 409,
				code: "chapter_story_preview_contract_required",
				details: { chapterId: input.chapterId },
			},
		);
	}
	const first = getStoryPreviewBoardTimeline(persisted.contract, 0);
	if (!first) {
		throw new AppError("章节故事预览时间轴为空", {
			status: 409,
			code: "chapter_story_preview_timeline_empty",
			details: { chapterId: input.chapterId },
		});
	}
	if (first.boardCount > STORY_PREVIEW_MAX_BOARDS) {
		throw new AppError("章节故事预览板数超过单次持久执行图上限", {
			status: 409,
			code: "chapter_story_preview_board_limit_exceeded",
			details: {
				chapterId: input.chapterId,
				boardCount: first.boardCount,
				maxBoardCount: STORY_PREVIEW_MAX_BOARDS,
			},
		});
	}
	const runId = buildCanonicalStoryPreviewSeriesId({
		chapterId: input.chapterId,
		sourceChapterRevision: persisted.sourceChapterRevision,
		sourceHash: persisted.sourceHash,
		contract: persisted.contract,
	});
	const boards = Array.from({ length: first.boardCount }, (_, boardIndex) => {
		const timeline = getStoryPreviewBoardTimeline(persisted.contract, boardIndex)!;
		const boardStartSeconds = timeline.frames[0]!.startSeconds;
		const boardEndSeconds = timeline.frames.at(-1)!.endSeconds;
		const sourceExcerpt = readStoryPreviewSourceWindow({
			sourceNarrative: persisted.sourceNarrative,
			boardStartSeconds,
			boardEndSeconds,
		});
		if (!sourceExcerpt) {
			throw new AppError("章节时间分段没有覆盖当前剧情预览板", {
				status: 409,
				code: "story_preview_source_window_missing",
				details: { chapterId: input.chapterId, boardIndex, boardStartSeconds, boardEndSeconds },
			});
		}
		const reusable = findReusableStoryPreviewBoard({
			row: input.row,
			chapterId: input.chapterId,
			boardIndex,
		});
		return {
			boardIndex,
			startSeconds: boardStartSeconds,
			endSeconds: boardEndSeconds,
			expectedCellCount: timeline.frames.length,
			sourceExcerpt,
			referenceOptions: persisted.contract.requiredReferences.map((reference) => ({
				refId: reference.nodeId ? `node:${reference.nodeId}` : `asset:${reference.assetId ?? ""}`,
				role: reference.role,
				entityKind: reference.entityKind,
				entityName: reference.entityName,
			})),
			status: reusable?.status ?? "missing",
			nodeId: reusable?.nodeId ?? null,
			taskId: reusable?.taskId ?? null,
		} as const;
	});
	return {
		chapterId: input.chapterId,
		runId,
		revision: `r${persisted.sourceChapterRevision}:${persisted.sourceHash}`,
		sourceChapterRevision: persisted.sourceChapterRevision,
		sourceHash: persisted.sourceHash,
		boardCount: first.boardCount,
		boards,
		nextBoardIndex: boards.find((board) => board.status === "missing")?.boardIndex ?? null,
	};
}

/**
 * Paid story-preview generation is idempotent by the server-owned chapter
 * source identity and board index. The model-authored seriesId is deliberately
 * excluded: an async continuation may phrase a new seriesId while still asking
 * for the exact same frozen board, and that must never create another billable
 * task.
 */
export function findReusableStoryPreviewBoard(input: {
	row: FlowRow;
	chapterId: string;
	boardIndex: number;
}): ReusableStoryPreviewBoard | null {
	const persisted = readPersistedStoryPreviewContract(input.row, input.chapterId);
	if (!persisted) return null;
	const candidates: ReusableStoryPreviewBoard[] = [];
	for (const node of readCurrentCanvasNodes(input.row)) {
		const nodeId = readTrimmedString(node.id);
		if (!nodeId || !node.data || typeof node.data !== "object" || Array.isArray(node.data)) continue;
		const data = node.data as Record<string, unknown>;
		if (Number(data.previewBoardIndex) !== input.boardIndex) continue;
		if (Number(data.sourceChapterRevision) !== persisted.sourceChapterRevision) continue;
		if (readTrimmedString(data.sourceHash) !== persisted.sourceHash) continue;
		const rawStatus = readTrimmedString(data.status).toLowerCase();
		const imageUrl = readTrimmedString(data.imageUrl);
		const taskId = readTrimmedString(data.imageTaskId) || readTrimmedString(data.taskId) || null;
		if (rawStatus === "success" && imageUrl) {
			const preview = normalizeStoryPreviewNodeContract(data);
			if (!preview) continue;
			const expectedActive = getStoryPreviewReferenceKeys(
				selectDeclaredStoryPreviewReferences(preview),
			);
			const actualNodeIds = normalizeStringList(data.referenceImageNodeIds).sort();
			const actualAssetIds = normalizeStringList(data.referenceAssetIds).sort();
			if (JSON.stringify(actualNodeIds) !== JSON.stringify([...expectedActive.nodeIds].sort())
				|| JSON.stringify(actualAssetIds) !== JSON.stringify([...expectedActive.assetIds].sort())) {
				continue;
			}
			candidates.push({
				nodeId,
				imageUrl,
				vendor: readTrimmedString(data.vendor),
				taskId,
				status: "success",
			});
			continue;
		}
		if ((rawStatus === "running" || rawStatus === "queued") && taskId) {
			candidates.push({
				nodeId,
				imageUrl: "",
				vendor: readTrimmedString(data.vendor),
				taskId,
				status: "running",
			});
		}
	}
	return candidates.find((candidate) => candidate.status === "success")
		?? candidates.find((candidate) => candidate.status === "running")
		?? null;
}

function reusableStoryPreviewResult(input: {
	row: FlowRow;
	chapterId: string;
	reusable: ReusableStoryPreviewBoard;
}): PublicAgentsImageGenerateToCanvasResult {
	return {
		ok: true,
		flowId: input.chapterId,
		updatedAt: input.row.updated_at,
		stats: {
			createdNodes: 0,
			createdEdges: 0,
			patchedNodes: 0,
			appendedArrays: 0,
		},
		nodeId: input.reusable.nodeId,
		imageUrl: input.reusable.imageUrl,
		vendor: input.reusable.vendor,
		taskId: input.reusable.taskId,
		status: input.reusable.status,
		reused: true,
	};
}

// Same-process race fence complements the persisted-canvas lookup. It closes
// the small window where two simultaneous requests both fresh-read before the
// first running node has been written. Durable retries after restart are caught
// by findReusableStoryPreviewBoard above.
const storyPreviewGenerationInFlight = new Map<
	string,
	Promise<PublicAgentsImageGenerateToCanvasResult>
>();

function formatStoryPreviewSeconds(value: number): string {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/**
 * Expand the small agent-authored previewBoard payload into the persisted canvas
 * node contract. Timeline, reference identity and immutable chapter provenance
 * stay server-owned; the agent only authors what changes visually in each cell.
 */
export function buildStoryPreviewNodeFromCompactBoard(input: {
	row: FlowRow;
	chapterId: string;
	board: AuthoredCompactStoryPreviewBoard;
}): unknown {
	const persisted = readPersistedStoryPreviewContract(input.row, input.chapterId);
	if (!persisted) {
		throw new AppError(
			"章节故事预览必须先保存总时长、预览窗口和完整参考资产合同；请让小T先提交 storyPreviewContract，再生成图片",
			{
				status: 409,
				code: "chapter_story_preview_contract_required",
				details: { chapterId: input.chapterId },
			},
		);
	}
	const timeline = getStoryPreviewBoardTimeline(persisted.contract, input.board.boardIndex);
	if (!timeline) {
		throw new AppError("previewBoard.boardIndex 超出当前章节预览窗口", {
			status: 400,
			code: "invalid_story_preview_board_index",
			details: { boardIndex: input.board.boardIndex },
		});
	}
	if (input.board.cells.length !== timeline.frames.length) {
		throw new AppError("previewBoard.cells 数量必须与服务端时间轴完全一致", {
			status: 400,
			code: "invalid_story_preview_board_cell_count",
			details: {
				boardIndex: input.board.boardIndex,
				expected: timeline.frames.length,
				actual: input.board.cells.length,
			},
		});
	}
	let stateBefore = input.board.openingState;
	const cells = input.board.cells.map((cell, index) => {
		const frame = timeline.frames[index]!;
		const normalized = {
			cellIndex: frame.cellIndex,
			startSeconds: frame.startSeconds,
			endSeconds: frame.endSeconds,
			timeRange: `${formatStoryPreviewSeconds(frame.startSeconds)}-${formatStoryPreviewSeconds(frame.endSeconds)}s`,
			narrativeFunction: "continuity",
			frameDescription: cell.frame,
			visibleAction: cell.mid,
			stateBefore,
			stateAfter: cell.end,
			causeFromPrevious: stateBefore,
			transitionToNext: cell.end,
			blocking: cell.frame,
			cameraState: cell.camera,
			motionTransition: `起始状态：${stateBefore} → 0.5秒承接：${cell.mid} → 结束状态：${cell.end}`,
			physicalFeedback: cell.feedback,
			environmentChange: cell.environment,
			subjectRefIds: [...cell.subjectRefIds],
		};
		stateBefore = cell.end;
		return normalized;
	});
	const first = timeline.frames[0]!;
	const last = timeline.frames.at(-1)!;
	return ensureImageNodeShape({
		type: "taskNode",
		position: { x: input.board.boardIndex * 760, y: 0 },
		data: {
			kind: "storyboardImage",
			label: `故事预览 ${formatStoryPreviewSeconds(first.startSeconds)}-${formatStoryPreviewSeconds(last.endSeconds)}s`,
			prompt: "章节故事预览（最终提示词由服务端唯一真源生成）",
			assetUsage: "preview_only",
			assetPurpose: "story_preview",
			productionEligible: false,
			productionLayer: "preview",
			creationStage: "story_preview",
			previewSeriesId: input.board.seriesId,
			previewBoardIndex: input.board.boardIndex,
			previewBoardCount: timeline.boardCount,
			previewShotCount: timeline.frames.length,
			storyPreviewCells: cells,
		},
	}, input.board.boardIndex);
}

function hasStoryPreviewContractData(data: Record<string, unknown>): boolean {
	return isStoryPreviewAssetData(data)
		|| data.storyPreviewContract !== undefined
		|| data.referenceManifest !== undefined
		|| data.storyPreviewCells !== undefined;
}

function hasStructuredStoryPreviewIntent(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
		? record.data as Record<string, unknown>
		: null;
	return readTrimmedString(record.creationStage) === "story_preview"
		|| readTrimmedString(record.assetPurpose) === "story_preview"
		|| readTrimmedString(data?.creationStage) === "story_preview"
		|| readTrimmedString(data?.assetPurpose) === "story_preview"
		|| hasStoryPreviewContractData(data ?? {});
}

/**
 * Chapter story previews have one paid unit per board, not per timeline cell.
 * The generic node/nodes branch is not a story-preview authoring route. Detect
 * explicit structured preview metadata before any paid image task starts so a
 * generic image request can never masquerade as a complete timeline preview.
 */
export function isChapterStoryPreviewGenericImageRequest(raw: Record<string, unknown>): boolean {
	if (raw.previewBoard !== undefined) return false;
	const candidates = [
		...(raw.node !== undefined ? [raw.node] : []),
		...(Array.isArray(raw.nodes) ? raw.nodes : []),
	];
	if (candidates.length === 0) return false;
	return hasStructuredStoryPreviewIntent(raw)
		|| candidates.some((candidate) => hasStructuredStoryPreviewIntent(candidate));
}

export function selectDeclaredStoryPreviewReferences(
	preview: StoryPreviewNodeContract,
): StoryPreviewReference[] {
	const declaredIds = new Set(preview.cells.flatMap((cell) => cell.subjectRefIds));
	return preview.contract.requiredReferences.filter((reference) => {
		const canonicalId = reference.nodeId
			? `node:${reference.nodeId}`
			: `asset:${reference.assetId ?? ""}`;
		return declaredIds.has(canonicalId);
	});
}

function readRelevantNarrative(input: {
	sourceNarrative: string;
	preview: StoryPreviewNodeContract;
}): string {
	const boardStart = input.preview.cells[0]?.startSeconds ?? input.preview.contract.previewWindow.startSeconds;
	const boardEnd = input.preview.cells.at(-1)?.endSeconds ?? input.preview.contract.previewWindow.endSeconds;
	return readStoryPreviewSourceWindow({
		sourceNarrative: input.sourceNarrative,
		boardStartSeconds: boardStart,
		boardEndSeconds: boardEnd,
	});
}

function buildCanonicalStoryPreviewPrompt(input: {
	sourceNarrative: string;
	preview: StoryPreviewNodeContract;
	activeReferences?: readonly StoryPreviewReference[];
}): string {
	const boardStart = input.preview.cells[0]?.startSeconds ?? input.preview.contract.previewWindow.startSeconds;
	const boardEnd = input.preview.cells.at(-1)?.endSeconds ?? input.preview.contract.previewWindow.endSeconds;
	const activeReferences = input.activeReferences ?? input.preview.referenceManifest;
	const references = activeReferences.map((reference) =>
		`- ${reference.role}/${reference.entityKind}：${reference.entityName}（${reference.nodeId ? `node:${reference.nodeId}` : `asset:${reference.assetId}`}）`,
	).join("\n");
	const cells = input.preview.cells.map((cell) => [
		`[${cell.timeRange}]`,
		`起始：${cell.stateBefore}`,
		`0.5秒承接：${cell.visibleAction}`,
		`结束：${cell.stateAfter}`,
		`画面：${cell.frameDescription}`,
		`镜头：${cell.cameraState}`,
		`物理反馈：${cell.physicalFeedback}`,
		`环境变化：${cell.environmentChange}`,
	].join("；")).join("\n");
	return [
		"【章节故事预览｜服务端唯一真源提示词】",
		`完整故事总长 ${input.preview.contract.storyDurationSeconds}s；本板只覆盖 ${boardStart}-${boardEnd}s。严禁把本板时间窗之外的剧情压缩或提前到本板。`,
		"以下章节原文是内容权威；逐格状态只能展开它，不能改人物、武器、出场时点、动作阶段或空间逻辑：",
		readRelevantNarrative(input),
		"【必须实际使用的项目参考资产】",
		references || "- Agent 没有为本板任何格声明参考资产。",
		"上述清单由逐格 subjectRefIds 的精确并集产生；服务端只验证它们属于冻结合同，不会从提示词猜测、补主角或按关键词路由。",
		"【逐秒状态机｜每格必须同时表现起始、0.5秒承接与结束，下一格继承上一格结束】",
		cells,
		"输出为清晰连续分镜板；每格可见时码；禁止新增时间窗外事件、重做角色、替换武器或忽略上述参考图。",
	].join("\n");
}

function linkStoryPreviewBoardHandoffs(input: {
	row: FlowRow;
	chapterId: string;
	nodes: readonly unknown[];
}): void {
	const persisted = readPersistedStoryPreviewContract(input.row, input.chapterId);
	if (!persisted) return;
	const current = input.nodes.flatMap((node) => {
		if (!node || typeof node !== "object" || Array.isArray(node)) return [];
		const data = (node as Record<string, unknown>).data;
		if (!data || typeof data !== "object" || Array.isArray(data)) return [];
		const preview = normalizeStoryPreviewNodeContract(data);
		return preview ? [{ data: data as Record<string, unknown>, preview }] : [];
	});
	const existing = readCurrentCanvasNodes(input.row).flatMap((node) => {
		if (!node.data || typeof node.data !== "object" || Array.isArray(node.data)) return [];
		const preview = normalizeStoryPreviewNodeContract(node.data);
		return preview ? [{ data: node.data as Record<string, unknown>, preview }] : [];
	});
	const all = [...existing, ...current];
	for (const item of current) {
		if (item.preview.previewBoardIndex < 1) continue;
		const previous = all.find((candidate) =>
			candidate.preview.previewSeriesId === item.preview.previewSeriesId
			&& candidate.preview.previewBoardIndex === item.preview.previewBoardIndex - 1,
		);
		const previousEnd = previous?.preview.cells.at(-1)?.stateAfter;
		const cells = normalizeStoryPreviewCells(item.data.storyPreviewCells);
		if (!previousEnd || !cells?.[0]) continue;
		item.data.storyPreviewCells = cells.map((cell, index) => index === 0
			? { ...cell, stateBefore: previousEnd, causeFromPrevious: previousEnd }
			: cell);
		const linked = normalizeStoryPreviewNodeContract(item.data);
		if (!linked) continue;
		const activeReferences = selectDeclaredStoryPreviewReferences(linked);
		item.data.prompt = buildCanonicalStoryPreviewPrompt({
			sourceNarrative: persisted.sourceNarrative,
			preview: linked,
			activeReferences,
		});
	}
}

export function assertChapterStoryPreviewContract(input: {
	row: FlowRow;
	chapterId: string;
	node: unknown;
}): void {
	if (!input.node || typeof input.node !== "object" || Array.isArray(input.node)) return;
	const nodeData = (input.node as Record<string, unknown>).data;
	if (!nodeData || typeof nodeData !== "object" || Array.isArray(nodeData)) return;
	const data = nodeData as Record<string, unknown>;
	if (!hasStoryPreviewContractData(data)) return;
	const persisted = readPersistedStoryPreviewContract(input.row, input.chapterId);
	if (!persisted) {
		throw new AppError(
			"章节故事预览必须先保存总时长、预览窗口和完整参考资产合同；请让小T先提交 storyPreviewContract，再生成图片",
			{
				status: 409,
				code: "chapter_story_preview_contract_required",
				details: { chapterId: input.chapterId },
			},
		);
	}
	// The chapter seed is the only authority for source identity and reference
	// metadata. Any immutable copies supplied by a model are deliberately ignored:
	// stale chat context must never win over the current chapter or cause a retry loop.
	data.storyPreviewContract = persisted.contract;
	data.referenceManifest = persisted.contract.requiredReferences;
	data.sourceChapterRevision = persisted.sourceChapterRevision;
	data.sourceHash = persisted.sourceHash;

	const preview = normalizeStoryPreviewNodeContract(data);
	if (!preview) {
		throw new AppError(
			"故事预览节点缺少完整的时间窗、参考清单或逐格状态数据",
			{
				status: 400,
				code: "invalid_story_preview_node_contract",
				details: {
					requiredFields: ["previewSeriesId", "previewBoardIndex", "previewBoardCount", "storyPreviewCells"],
				},
			},
		);
	}
	const activeReferences = selectDeclaredStoryPreviewReferences(preview);
	const activeReferenceKeys = getStoryPreviewReferenceKeys(activeReferences);
	data.activeReferenceManifest = activeReferences;
	data.referenceImageNodeIds = activeReferenceKeys.nodeIds;
	data.referenceAssetIds = activeReferenceKeys.assetIds;
	data.prompt = buildCanonicalStoryPreviewPrompt({
		sourceNarrative: persisted.sourceNarrative,
		preview,
		activeReferences,
	});
}

function resolveNodeBlockingReference(input: {
  row: FlowRow;
  node: unknown;
}): KeyframeBlockingReference | null {
  if (!input.node || typeof input.node !== "object" || Array.isArray(input.node)) return null;
  const data = (input.node as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return resolveKeyframeBlockingReference({
    nodeData: data as Record<string, unknown>,
    nodes: readCurrentCanvasNodes(input.row),
  });
}

function readImageNodeData(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const data = (node as Record<string, unknown>).data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function isStoryboardGenerationNode(node: unknown): boolean {
  const data = readImageNodeData(node);
  if (!data) return false;
  return readTrimmedString(data.kind) === "storyboardImage" || Boolean(readTrimmedString(data.sourceRecipeId));
}

function hasProjectReferenceIds(data: Record<string, unknown>): boolean {
  if (normalizeStringList(data.referenceImageNodeIds).length > 0) return true;
  if (normalizeStringList(data.referenceAssetIds).length > 0) return true;
  if (!Array.isArray(data.referenceAssetBindings)) return false;
  return data.referenceAssetBindings.some((binding) => {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) return false;
    return Boolean(readTrimmedString((binding as Record<string, unknown>).assetId));
  });
}

async function recordProjectAnchorReferenceDiagnostic(
  input: ImageGenInput,
  nodes: readonly unknown[],
): Promise<void> {
  const projectId = readTrimmedString(input.row.project_id);
  if (!projectId) return;
  const candidatesNeedingLookup = nodes.filter((node) => {
    const data = readImageNodeData(node);
    return Boolean(data && isStoryboardGenerationNode(node) && !hasProjectReferenceIds(data));
  });
  if (candidatesNeedingLookup.length === 0) return;

  // This is the deterministic preflight the old skill contract described but
  // never enforced: read the current project projection before any paid task
  // can be submitted. Matching which asset belongs to the shot remains an
  // agent decision; the API only proves whether reusable project anchors exist.
  const projectAssets = await listProjectNodeAssetsForOwner(input.c, input.requestUserId, { projectId });
  const { candidates } = buildStoryboardAnchorCandidatesFromAssets(projectAssets);
  if (candidates.length === 0) return;

  for (const node of candidatesNeedingLookup) {
    const data = readImageNodeData(node);
    if (!data) continue;
    data.storyboardAnchorDiagnostic = {
      version: 1,
      code: "storyboard_anchor_candidates_available",
      blocking: false,
      projectId,
      message: "项目存在可复用锚定资产，但本节点未绑定稳定引用 ID；已记录候选并继续当前生成，不得因创作锚缺失阻止用户交付。",
      candidates: candidates.map((candidate) => ({
        assetId: candidate.assetId,
        kind: candidate.kind,
        name: candidate.name,
        label: candidate.label,
        referenceAssetIds: [candidate.assetId],
      })),
    };
  }
}

/**
 * 出图到画布。支持两种入参（批量是单图的超集，权能覆盖）：
 * - `{ node }`：单图（原行为，逐字兼容）。
 * - `{ nodes: [...] }`：多张独立图**并发出**（角色卡/场景卡/故事板等无依赖图），把"逐张串行等 ~2min"
 *   压成"一批并发"。N=1 等价单图。写画布并发竞态由章节画布乐观锁重试兜底。
 */
export async function generateImageToCanvas(
  input: ImageGenInput,
): Promise<PublicAgentsImageGenerateToCanvasResult | PublicAgentsImageGenerateBatchResult> {
  const raw = (input.bodyArgs ?? {}) as Record<string, unknown>;
	if (input.chapterId && isChapterStoryPreviewGenericImageRequest(raw)) {
		const persisted = readPersistedStoryPreviewContract(input.row, input.chapterId);
		const firstBoard = persisted
			? getStoryPreviewBoardTimeline(persisted.contract, 0)
			: null;
		const boardCount = firstBoard?.boardCount ?? null;
		const expectedCellCounts = persisted && boardCount
			? Array.from({ length: boardCount }, (_, boardIndex) =>
				getStoryPreviewBoardTimeline(persisted.contract, boardIndex)?.frames.length ?? 0)
			: [];
		throw new AppError(
			"章节剧情预览禁止使用 node/nodes 生成逐格独立图片；每张图片必须是一块最多9格的 previewBoard 九宫格",
			{
				status: 409,
				code: "chapter_story_preview_requires_compact_board",
				details: {
					chapterId: input.chapterId,
					boardCount,
					expectedCellCounts,
					firstAction: { toolName: "tapcanvas_story_preview_orchestrate", mode: "begin" },
					requiredAction:
						"调用专用剧情预览编排器；只执行其 progressCursor 暴露的 put_board_N。禁止改走 node/nodes 或直接提交 previewBoard。",
				},
			},
		);
	}
	if (raw.previewBoard !== undefined) {
		if (input.storyPreviewOperation !== true) {
			throw new AppError("previewBoard 只允许由专用剧情预览编排器提交", {
				status: 409,
				code: "story_preview_requires_orchestrator",
			});
		}
		const parsedCompact = CompactStoryPreviewBoardSchema.safeParse(raw.previewBoard);
		if (!parsedCompact.success) {
			throw new AppError("Invalid compact story preview board request", {
				status: 400,
				code: "invalid_story_preview_board_request",
				details: { issues: parsedCompact.error.issues },
			});
		}
		if (!input.chapterId) {
			throw new AppError("previewBoard 仅支持章节画布", {
				status: 400,
				code: "story_preview_board_requires_chapter",
			});
		}
		const chapterId = input.chapterId;
		const boardIndex = parsedCompact.data.boardIndex;
		const currentRow = await freshReadFlowRow({
			c: input.c,
			flowId: input.flowId,
			requestUserId: input.requestUserId,
			devBypass: input.devBypass,
			chapterId,
		});
		const persisted = readPersistedStoryPreviewContract(currentRow, chapterId);
		if (!persisted) {
			throw new AppError(
				"章节故事预览必须先保存总时长、预览窗口和完整参考资产合同；请让小T先提交 storyPreviewContract，再生成图片",
				{
					status: 409,
					code: "chapter_story_preview_contract_required",
					details: { chapterId },
				},
			);
		}
		const reuse = findReusableStoryPreviewBoard({ row: currentRow, chapterId, boardIndex });
		if (reuse) {
			return reusableStoryPreviewResult({ row: currentRow, chapterId, reusable: reuse });
		}
		const operationKey = [
			input.requestUserId,
			chapterId,
			persisted.sourceChapterRevision,
			persisted.sourceHash,
			boardIndex,
		].join(":");
		const running = storyPreviewGenerationInFlight.get(operationKey);
		if (running) {
			return { ...(await running), reused: true };
		}
		const operation = (async (): Promise<PublicAgentsImageGenerateToCanvasResult> => {
			// Re-read inside the single-flight owner so a task persisted between the
			// outer lookup and lock acquisition is still reused before paid work.
			const latestRow = await freshReadFlowRow({
				c: input.c,
				flowId: input.flowId,
				requestUserId: input.requestUserId,
				devBypass: input.devBypass,
				chapterId,
			});
			const latestPersisted = readPersistedStoryPreviewContract(latestRow, chapterId);
			if (!latestPersisted
				|| latestPersisted.sourceChapterRevision !== persisted.sourceChapterRevision
				|| latestPersisted.sourceHash !== persisted.sourceHash) {
				throw new AppError("章节故事预览唯一真源已变化，请 fresh-read 后重试", {
					status: 409,
					code: "story_preview_source_changed",
					details: {
						chapterId,
						expectedRevision: persisted.sourceChapterRevision,
						actualRevision: latestPersisted?.sourceChapterRevision ?? null,
					},
				});
			}
			const latestReuse = findReusableStoryPreviewBoard({ row: latestRow, chapterId, boardIndex });
			if (latestReuse) {
				return reusableStoryPreviewResult({ row: latestRow, chapterId, reusable: latestReuse });
			}
			const canonicalBoard = {
				...parsedCompact.data,
				seriesId: buildCanonicalStoryPreviewSeriesId({
					chapterId,
					sourceChapterRevision: latestPersisted.sourceChapterRevision,
					sourceHash: latestPersisted.sourceHash,
					contract: latestPersisted.contract,
				}),
			} as AuthoredCompactStoryPreviewBoard;
			const node = buildStoryPreviewNodeFromCompactBoard({
				row: latestRow,
				chapterId,
				board: canonicalBoard,
			});
			assertChapterStoryPreviewContract({ row: latestRow, chapterId, node });
			linkStoryPreviewBoardHandoffs({ row: latestRow, chapterId, nodes: [node] });
			await recordProjectAnchorReferenceDiagnostic({ ...input, row: latestRow }, [node]);
			return generateSingleImageNode({
				...input,
				row: latestRow,
				bodyArgs: { node },
			});
		})();
		storyPreviewGenerationInFlight.set(operationKey, operation);
		try {
			return await operation;
		} finally {
			if (storyPreviewGenerationInFlight.get(operationKey) === operation) {
				storyPreviewGenerationInFlight.delete(operationKey);
			}
		}
	}
  const batchNodes = Array.isArray(raw.nodes) ? raw.nodes : null;
  if (batchNodes && batchNodes.length > 0) {
    const list = batchNodes.slice(0, 8).map((n, i) => ensureImageNodeShape(n, i));
		const parsedBatch = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({ nodes: list });
    if (!parsedBatch.success) {
      throw new AppError("Invalid image generate to canvas request", {
        status: 400,
        code: "invalid_image_generate_to_canvas_request",
        details: { issues: parsedBatch.error.issues },
			});
		}
		if (input.chapterId) {
			parsedBatch.data.nodes?.forEach((node) => assertChapterStoryPreviewContract({
				row: input.row,
				chapterId: input.chapterId!,
				node,
			}));
			linkStoryPreviewBoardHandoffs({
				row: input.row,
				chapterId: input.chapterId,
				nodes: parsedBatch.data.nodes ?? [],
			});
		}
		await recordProjectAnchorReferenceDiagnostic(input, parsedBatch.data.nodes ?? []);
    parsedBatch.data.nodes?.forEach((node) => {
      // Validate the whole batch before any worker starts. A missing blocking
      // asset must not allow earlier siblings to create paid image tasks.
      resolveNodeBlockingReference({ row: input.row, node });
    });
    // 批量（>1 张）且有 toolCallId 时，每张决议向画布频道广播进度，供聊天对话框展示"3/8 张"。
    // 单图（N=1）不发进度，走原有单步显示。room 与逐张 broadcastPatch 一致用 project_id。
    const projectId = input.row.project_id;
    const onProgress =
      input.toolCallId && list.length > 1 && projectId
        ? (completed: number, total: number, failed: number) =>
            broadcastToolProgress(projectId, {
              toolCallId: input.toolCallId!,
              toolName: "tapcanvas_image_generate_to_canvas",
              completed,
              total,
              failed,
              chapterId: input.chapterId ?? null,
            })
        : undefined;
    const results = await runImageNodesBounded(
      input,
      parsedBatch.data.nodes ?? [],
      IMAGE_BATCH_CONCURRENCY,
      onProgress,
    );
    return {
      ok: true,
      batch: true,
      flowId: input.chapterId || input.flowId,
      updatedAt: new Date().toISOString(),
      count: list.length,
      succeeded: results.filter((result) => result.ok).length,
      ...(results.every((result) => result.ok) && results.some((result) =>
        result.ok &&
        result.status === "running" &&
        Boolean(result.nodeId) &&
        Boolean(result.taskId)
      )
        ? { completionBoundary: "submission" as const }
        : {}),
      results,
    };
  }
  if (raw.node && typeof raw.node === "object") {
    const node = ensureImageNodeShape(raw.node, 0);
    if (input.chapterId) {
      assertChapterStoryPreviewContract({ row: input.row, chapterId: input.chapterId, node });
      linkStoryPreviewBoardHandoffs({
        row: input.row,
        chapterId: input.chapterId,
        nodes: [node],
      });
    }
    await recordProjectAnchorReferenceDiagnostic(input, [node]);
    return generateSingleImageNode({
      ...input,
      bodyArgs: { ...raw, node },
    });
  }
  return generateSingleImageNode(input);
}

/** 批量进度计数器：每张决议调 bump(ok)，递增 completed / 累计 failed，触发 onProgress。
 *  onProgress 抛错被吞（进度上报绝不拖垮出图主流程）。 */
export function makeProgressCounter(
  total: number,
  onProgress?: (completed: number, total: number, failed: number) => void,
): (ok: boolean) => void {
  let completed = 0;
  let failed = 0;
  return (ok: boolean) => {
    completed += 1;
    if (!ok) failed += 1;
    try {
      onProgress?.(completed, total, failed);
    } catch {
      /* 进度上报失败不影响出图 */
    }
  };
}

/** bounded 并发跑多个单图节点（gen 并发、写画布各自走乐观锁重试）。失败项不抛、收进 results。
 *  onProgress: 每张决议（成功/失败）后回调，用于向画布频道广播"已完成 N/总数"。 */
async function runImageNodesBounded(
  input: ImageGenInput,
  nodes: unknown[],
  concurrency: number,
  onProgress?: (completed: number, total: number, failed: number) => void,
): Promise<PublicAgentsImageGenerateBatchResult["results"]> {
  const out: PublicAgentsImageGenerateBatchResult["results"] = new Array(nodes.length);
  const bump = makeProgressCounter(nodes.length, onProgress);
  let cursor = 0;
  const worker = async () => {
    while (cursor < nodes.length) {
      const i = cursor;
      cursor += 1;
      try {
        const r = await generateSingleImageNode({ ...input, bodyArgs: { node: nodes[i] } });
        out[i] = {
          index: i,
          ok: true,
          nodeId: r.nodeId,
          taskId: r.taskId,
          imageUrl: r.imageUrl,
          status: r.status,
        };
        bump(true);
      } catch (e) {
        out[i] = { index: i, ok: false, error: e instanceof Error ? e.message : String(e) };
        bump(false);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, nodes.length) }, () => worker()),
  );
  return out;
}

async function generateSingleImageNode(
  input: ImageGenInput,
): Promise<PublicAgentsImageGenerateToCanvasResult> {
  const parsedArgs = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid image generate to canvas request", {
      status: 400,
      code: "invalid_image_generate_to_canvas_request",
      details: { issues: parsedArgs.error.issues },
    });
  }

  const taskNode = parsedArgs.data.node;
  if (!taskNode) {
    throw new AppError("node is required for single image generation", {
      status: 400,
      code: "invalid_image_generate_to_canvas_request",
    });
  }
  const nodeData = taskNode.data as Record<string, unknown>;
  const blockingReference = resolveNodeBlockingReference({
    row: input.row,
    node: taskNode,
  });
  if (blockingReference) {
    nodeData.blockingReference = blockingReference;
    const productionMetadata =
      nodeData.productionMetadata &&
      typeof nodeData.productionMetadata === "object" &&
      !Array.isArray(nodeData.productionMetadata)
        ? (nodeData.productionMetadata as Record<string, unknown>)
        : {};
    nodeData.productionMetadata = {
      ...productionMetadata,
      compositionContract: blockingReference.compositionContract,
      compositionContractHash: blockingReference.compositionContractHash,
    };
  }
  // Append cinematic camera preset as a prompt suffix when enabled
  const cinematicCam = nodeData.imageCinematicCamera as Record<string, unknown> | null | undefined;
  let basePrompt = appendImageViewPrompt(readTrimmedString(nodeData.prompt), {
    cameraControl: nodeData.imageCameraControl,
    lightingRig: nodeData.imageLightingRig,
  });
  if (blockingReference) {
    basePrompt = `${basePrompt}\n【已验真关键帧构图合同｜必须逐项执行】${blockingReference.compositionFacts}`;
  }
  if (cinematicCam && cinematicCam.enabled) {
    const parts: string[] = [];
    if (cinematicCam.cameraKey) parts.push(String(cinematicCam.cameraKey).replace(/_/g, " "));
    if (cinematicCam.lensKey) parts.push(String(cinematicCam.lensKey).replace(/_/g, " ") + " lens");
    if (cinematicCam.focalKey) parts.push(String(cinematicCam.focalKey) + " focal length");
    if (cinematicCam.apertureKey) parts.push(String(cinematicCam.apertureKey) + " aperture");
    if (parts.length) basePrompt = `${basePrompt}, shot on ${parts.join(", ")}`;
  }
  let prompt = basePrompt;

  // 世界书统一注入（灰度 flag WORLD_INFO_INJECT，默认 OFF）。
  // OFF：整块跳过，worldInfoRefs/Negative 保持空 → 下方合并为 no-op，行为与改动前完全一致。
  // ON：按镜命中素材库(character/scene/style…)的锁定文+参考图注入，锁定文压到 prompt 尾部(recency)。
  // 设计见 docs/design/world-info-injection-engine.md
  let worldInfoRefs: string[] = [];
  let worldInfoNegative = "";
  const worldInfoFlag = String(
    (input.c.env as Record<string, unknown>)?.WORLD_INFO_INJECT ??
      globalThis.process?.env?.WORLD_INFO_INJECT ??
      "",
  )
    .trim()
    .toLowerCase();
  if (
    (worldInfoFlag === "1" || worldInfoFlag === "true" || worldInfoFlag === "on") &&
    input.row.project_id
  ) {
    try {
      const resolved = await resolveWorldInfo({
        shotText: prompt,
        loader: createProjectWorldInfoLoader(input.c.env.DB, {
          ownerId: input.requestUserId,
          projectId: input.row.project_id,
        }),
      });
      prompt = resolved.prompt;
      worldInfoRefs = resolved.referenceImages.map((r) => r.url);
      worldInfoNegative = resolved.negativePrompt;
    } catch {
      // 世界书加载/注入异常 → 降级用原提示词，不阻断生成
    }
  }

  const negativePrompt = [
    readTrimmedString(nodeData.negativePrompt),
    worldInfoNegative,
  ]
    .filter(Boolean)
    .join(", ");
  // 显式节点选择优先，其次为账号最近选择；新账号由 generation-prefs 提供固定初始值。
  // 偏好查询失败不是“新账号”，必须原地失败，禁止掩盖数据库故障后继续付费提交。
  const prefRow = await getPrismaClient().users.findUnique({
    where: { id: input.requestUserId },
    select: { generation_prefs: true },
  });
  if (!prefRow) {
    throw new AppError("用户不存在，无法解析生成偏好", {
      status: 404,
      code: "generation_preferences_user_not_found",
    });
  }
  const userGenPrefs = parseUserGenerationPrefs(prefRow.generation_prefs);
  const modelAlias = resolveImageGenerateDefaults({
    prefs: userGenPrefs,
    explicitModelAlias: readTrimmedString(nodeData.modelAlias),
    explicitImageModel: readTrimmedString(nodeData.imageModel),
    explicitSize: "",
  }).modelAlias;
  const modelKey = readTrimmedString(nodeData.modelKey);
  const isGptImage = isGptImageModel({ modelKey, modelAlias });
  const lookProjectId = readTrimmedString(input.row.project_id);
  const lookOwnerId = readTrimmedString(input.row.owner_id) || input.requestUserId;
  if (lookProjectId) {
    const activeLookBible = await getActiveProjectLookBible({
      ownerId: lookOwnerId,
      projectId: lookProjectId,
    });
    if (activeLookBible) {
      const cardClassification = classifyCanvasCardForRegistry(nodeData);
      const lookPrompt = buildProjectLookBibleImagePrompt({
        active: activeLookBible,
        roleCard: cardClassification?.kind === "character",
        sectionIds: Array.isArray(nodeData.projectLookSectionIds)
          ? nodeData.projectLookSectionIds.filter((value): value is string => typeof value === "string")
          : null,
      });
      prompt = `${prompt}\n【项目视觉圣经｜${activeLookBible.lookBible.name}｜V${activeLookBible.revision}】${lookPrompt}`;
      nodeData.projectLookBibleAssetId = activeLookBible.assetId;
      nodeData.projectLookBibleRevision = activeLookBible.revision;
      nodeData.projectLookBibleHash = activeLookBible.lookBibleHash;
    }
  }
  const aspectRatio = readTrimmedString(nodeData.aspect);
  // 显式节点规格优先；否则使用账号最近选择，新账号初始规格为 1K。
  const imageSize = resolveImageGenerateDefaults({
    prefs: userGenPrefs,
    explicitModelAlias: "",
    explicitImageModel: "",
    explicitSize: readTrimmedString(nodeData.imageSize),
  }).imageSize;
  let referenceImages = worldInfoRefs.length
    ? [...new Set([...normalizeStringList(nodeData.referenceImages), ...worldInfoRefs])]
    : normalizeStringList(nodeData.referenceImages);
  const resolvedIdReferences = await resolveExecutionImageReferences({
    c: input.c,
    ownerId: input.requestUserId,
    row: input.row,
    nodeIds: nodeData.referenceImageNodeIds,
    assetIds: nodeData.referenceAssetIds,
  });
  if (resolvedIdReferences.length > 0) {
    referenceImages = [
      ...new Set([
        ...resolvedIdReferences.map((reference) => reference.url),
        ...referenceImages,
      ]),
    ];
  }
  const referenceAssetBindings = normalizeReferenceAssetBindings(
    nodeData.referenceAssetBindings,
  );
  const resolvedBindingReferences = referenceAssetBindings.length
    ? await resolveExecutionImageReferences({
        c: input.c,
        ownerId: input.requestUserId,
        row: input.row,
        assetIds: referenceAssetBindings.map((binding) => binding.assetId),
      })
    : [];
  if (resolvedBindingReferences.length !== referenceAssetBindings.length) {
    throw new AppError("Reference asset bindings must resolve one unique image per asset ID", {
      status: 422,
      code: "reference_asset_binding_resolution_mismatch",
      details: {
        requested: referenceAssetBindings.length,
        resolved: resolvedBindingReferences.length,
      },
    });
  }
  const boundStyleAssetInputs: CanvasAssetInput[] = [];
  resolvedBindingReferences.forEach((reference, index) => {
    const binding = referenceAssetBindings[index];
    if (!binding) return;
    if (binding.role === "style") {
      boundStyleAssetInputs.push({
        assetId: binding.assetId,
        ...(reference.assetRefId ? { assetRefId: reference.assetRefId } : {}),
        url: reference.url,
        role: "style",
        ...(binding.strength !== undefined ? { weight: binding.strength } : {}),
        name: reference.name,
      });
      return;
    }
    if (!referenceImages.includes(reference.url)) {
      referenceImages.push(reference.url);
    }
  });
  // Merge styleImages into assetInputs with role='style' (deduplicated against existing entries)
  let styleImages = [
    ...new Set([
      ...boundStyleAssetInputs.map((input) => input.url).filter((url): url is string => Boolean(url)),
      ...normalizeStringList(nodeData.styleImages),
    ]),
  ];
  let projectStyleReferenceImages: string[] = [];
  let projectStyleProvenance: ProjectStyleProvenance | null = null;
  const styleProjectId = readTrimmedString(input.row.project_id);
  const styleOwnerId = readTrimmedString(input.row.owner_id) || input.requestUserId;
  if (styleProjectId && styleOwnerId) {
    try {
      projectStyleReferenceImages = await readCanvasIndexStyleImages(styleProjectId, styleOwnerId);
      if (projectStyleReferenceImages.length) {
        const styleLock = await readCanvasIndexStyleLock(styleProjectId, styleOwnerId);
        projectStyleProvenance = buildProjectStyleProvenance({
          styleReferenceImages: projectStyleReferenceImages,
          styleLock,
        });
      }
    } catch {
      projectStyleReferenceImages = [];
      projectStyleProvenance = null;
    }
  }
  // 回退：node 自身没带风格图时，注入项目级「全局风格图」（canvas-index.json，前端 picker / agent set-style
  // 工具写的同一源）。这让 agent 驱动的服务端出图、以及没显式带 styleImages 的提交，都自动锁全局风格。
  if (styleImages.length === 0) {
    styleImages = projectStyleReferenceImages;
  }
  // 项目级摄像机规格（canvas-index.json cinematicCamera，与前端摄像机 chip 同源）：agent 出图
  // 自动拼进 prompt，与前端手动出图（客户端 buildCinematicCameraPrompt 拼接）行为对齐。幂等：
  // prompt 已含「摄影机参数（」标记（上游已拼过）则不重复。
  try {
    const camProjectId = readTrimmedString(input.row.project_id);
    const camOwnerId = readTrimmedString(input.row.owner_id) || input.requestUserId;
    if (camProjectId && camOwnerId) {
      const cinematicCamera = await readCanvasIndexCinematicCamera(camProjectId, camOwnerId);
      prompt = appendCinematicCameraPrompt(prompt, cinematicCamera);
    }
  } catch {
    /* best-effort：拉不到摄像机规格照常出图，不阻断 */
  }
  // 章节非身份锚自动绑定：这里只保留风格锚与道具锚。
  // 角色/场景必须由 agents-cli 通过新版结构化节点 ID / 资产 ID 显式绑定。
  if (input.chapterId) {
    const abFlag = String(
      (input.c.env as Record<string, unknown>)?.CHAPTER_ANCHOR_AUTOBIND ??
        globalThis.process?.env?.CHAPTER_ANCHOR_AUTOBIND ??
        "on",
    )
      .trim()
      .toLowerCase();
    if (abFlag !== "0" && abFlag !== "false" && abFlag !== "off") {
      try {
        const dto = mapFlowRowToDto(input.row);
        const data = sanitizeFlowDataForStorage(dto.data ?? {});
        const nodes = Array.isArray((data as Record<string, unknown>).nodes)
          ? ((data as Record<string, unknown>).nodes as Array<{ data?: unknown }>)
          : [];
        const pm =
          nodeData.productionMetadata && typeof nodeData.productionMetadata === "object"
            ? (nodeData.productionMetadata as Record<string, unknown>)
            : undefined;
        const laRaw =
          (pm?.lockedAnchors as Record<string, unknown> | undefined) ??
          (nodeData.lockedAnchors as Record<string, unknown> | undefined);
        const toArr = (v: unknown) =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
        const lockedAnchors: LockedAnchors = {
          prop: toArr(laRaw?.prop),
        };
        const sel = selectAnchorReferenceImages(nodes, lockedAnchors);
        // 风格锚 → styleImages 最前（优先于旧全局风格），且当前节点自己不是风格锚时才注入。
        const selfIsStyleAnchor = /风格锚|style[\s_-]?anchor/i.test(readTrimmedString(nodeData.label));
        if (sel.styleAnchorUrl && !selfIsStyleAnchor && !styleImages.includes(sel.styleAnchorUrl)) {
          styleImages = [sel.styleAnchorUrl, ...styleImages];
        }
        // 道具卡 → referenceImages（去重）。
        const addProps = (sel.propUrls ?? []).filter((u) => !referenceImages.includes(u));
        if (addProps.length) referenceImages = [...referenceImages, ...addProps];
        if ((sel.styleAnchorUrl && !selfIsStyleAnchor) || addProps.length) {
          console.log(
            `[chapter-anchor-autobind:image] chapter=${input.chapterId} style=${sel.styleAnchorUrl && !selfIsStyleAnchor ? 1 : 0} props=${addProps.length}`,
          );
        }
      } catch {
        // best-effort：自动绑定失败不阻断出图
      }
    }
  }
  const baseAssetInputs = [
    ...boundStyleAssetInputs,
    ...normalizeAssetInputs(nodeData.assetInputs),
  ];
  const existingUrls = new Set(baseAssetInputs.map((a) => a.url).filter(Boolean));
  const styleAssetInputs: CanvasAssetInput[] = styleImages
    .filter((url) => !existingUrls.has(url))
    .map((url) => ({ url, role: "style" }));
  let assetInputs = [...baseAssetInputs, ...styleAssetInputs];

  // Composition truth has highest reference priority. Character/style anchors
  // still bind identity and look, but cannot displace the verified blocking map
  // from the model input or from the persisted generation trace.
  if (blockingReference) {
    referenceImages = [
      blockingReference.imageUrl,
      ...referenceImages.filter((url) => url !== blockingReference.imageUrl),
    ];
  }

  // 【参考图封顶·gpt-image-2 上限 16】referenceImages + assetInputs(含风格图) 合并送上游 images[]，
  // 超 16 上游直接 build 失败「reference_images exceeds max 16」整请求挂掉（实测 ch129 多格设计板：
  // agent 显式传十余张锚定卡 + 服务端 CHAPTER_ANCHOR_AUTOBIND 再自动注入 → 撞上限）。确定性截到 ≤16：
  // 风格图(画风一致性命脉)优先全保留，referenceImages 保留前部（显式引用优先于自动注入的尾部），超出截断并告警。
  if (isGptImage) {
    const GPT_IMAGE_MAX_REFS = 16;
    const total = referenceImages.length + assetInputs.length;
    if (total > GPT_IMAGE_MAX_REFS) {
      // 风格图最多占 4 席，给 referenceImages 留足空间（画风锚通常 1~2 张即够）。
      const styleCap = Math.min(assetInputs.length, 4);
      if (assetInputs.length > styleCap) assetInputs = assetInputs.slice(0, styleCap);
      const keepRefs = Math.max(0, GPT_IMAGE_MAX_REFS - assetInputs.length);
      const droppedRefs = Math.max(0, referenceImages.length - keepRefs);
      const droppedStyle = styleAssetInputs.length - Math.max(0, styleCap - baseAssetInputs.length);
      if (droppedRefs > 0) referenceImages = referenceImages.slice(0, keepRefs);
      console.warn(
        `[image-ref-cap] gpt-image-2 参考图超上限 ${GPT_IMAGE_MAX_REFS}（原 ref=${total - styleAssetInputs.length + baseAssetInputs.length}）→ 截断 refs(drop=${droppedRefs}) style(drop=${droppedStyle > 0 ? droppedStyle : 0}) node=${readTrimmedString(nodeData.label) || "?"} chapter=${input.chapterId ?? "-"}`,
      );
    }
  }

  const taskKind: TaskRequestDto["kind"] =
    referenceImages.length > 0 || assetInputs.length > 0 ? "image_edit" : "text_to_image";
  const generationProjectId = readTrimmedString(input.row.project_id);
  const generationFlowId = input.chapterId ? "" : readTrimmedString(input.row.id);
  const generationNodeId = readTrimmedString(taskNode.id);
  const generationWorkflowExecutionId = readTrimmedString(nodeData.workflowExecutionId);
  const generationContext = generationProjectId
    ? {
        projectId: generationProjectId,
        ...(generationFlowId ? { flowId: generationFlowId } : {}),
        ...(generationNodeId ? { nodeId: generationNodeId } : {}),
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(generationWorkflowExecutionId
          ? { workflowExecutionId: generationWorkflowExecutionId }
          : {}),
      }
    : null;

  const taskRequest: TaskRequestDto = {
    kind: taskKind,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(typeof nodeData.seed === "number" && Number.isFinite(nodeData.seed)
      ? { seed: Math.trunc(nodeData.seed) }
      : {}),
    extras: {
      ...(modelAlias ? { modelAlias } : {}),
      ...(modelKey ? { modelKey } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(imageSize ? { imageSize } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
      ...(assetInputs.length ? { assetInputs } : {}),
      ...(generationContext ? { generationContext } : {}),
      persistAssets: true,
    },
  };

  await imageGlobalSemaphore.acquire();
  let created: Awaited<ReturnType<typeof runPublicTask>>;
  try {
    created = await runPublicTask(input.c, input.requestUserId, {
      request: taskRequest,
    });
  } finally {
    imageGlobalSemaphore.release();
  }

  // Agent 媒体工具采用持久异步硬合同：上游一旦返回 queued/running + taskId，立即把该回执
  // 写入画布并返回。不得把供应商任务的生命周期绑在单次 HTTP 上，否则超时发生在节点持久化
  // 之前时会制造已扣费但无 taskId 可对账的孤儿任务。只有上游 inline 终态才在本次调用内处理。
  const initTaskId = readTrimmedString((created.result as Record<string, unknown>)?.id);
  const initStatus = readTrimmedString(
    (created.result as Record<string, unknown>)?.status,
  ).toLowerCase();
  const initUrl = extractImageUrlFromTaskResult(created.result);
  const inlineSucceeded = Boolean(initUrl) && initStatus === "succeeded";
  const acceptedAsync =
    Boolean(initTaskId) && (initStatus === "queued" || initStatus === "running");
  if (!inlineSucceeded && (initStatus === "queued" || initStatus === "running") && !initTaskId) {
    throw new AppError("图片供应商已受理但未返回可持久化的 taskId", {
      status: 502,
      code: "agents_tool_image_missing_task_receipt",
      details: {
        vendor: readTrimmedString(created.vendor) || null,
        status: initStatus || null,
      },
    });
  }

  const nodeStatus: "running" | "success" = acceptedAsync ? "running" : "success";
  let resolvedTaskId: string | null;
  let resolvedVendor: string;
  let resolvedImageUrl: string;
  let completedResult: TaskResultDto;
  if (acceptedAsync) {
    resolvedTaskId = initTaskId || null;
    resolvedVendor = readTrimmedString(created.vendor) || "newapi";
    resolvedImageUrl = "";
    completedResult = created.result;
  } else {
    // 仅处理上游 inline 终态；accepted task 永远不会进入长轮询。
    const completed = await awaitImageResult({
      c: input.c,
      userId: input.requestUserId,
      vendor: readTrimmedString(created.vendor) || "newapi",
      initialResult: created.result,
      prompt,
      taskKind,
    });
    resolvedTaskId = completed.taskId;
    resolvedVendor = completed.vendor || "newapi";
    resolvedImageUrl = completed.imageUrl;
    completedResult = completed.result;
  }

  const nodeId = readTrimmedString(taskNode.id) || crypto.randomUUID();
  const label = readTrimmedString(nodeData.label) || "Generated Image";
  const generatedAssetId = extractImageAssetIdFromTaskResult(
    completedResult,
    resolvedImageUrl,
  );

  let finalNodeData: Record<string, unknown> = {
    ...nodeData,
    // Persist the exact references submitted to the image model. The effective
    // list includes server-resolved blocking/style/identity inputs and is the
    // generation provenance consumed by downstream asset verification.
    ...(referenceImages.length ? { referenceImages: [...referenceImages] } : {}),
    ...(assetInputs.length ? { assetInputs: assetInputs.map((item) => ({ ...item })) } : {}),
    status: nodeStatus,
    imageUrl: resolvedImageUrl,
    // running 占位无 url：跳过 imageResults（前端/reconcile 回写时再补），避免空 url 结果。
    ...(resolvedImageUrl
      ? {
          imageResults: [
            {
              url: resolvedImageUrl,
              title: label,
              ...(generatedAssetId ? { assetId: generatedAssetId } : {}),
            },
          ],
          imagePrimaryIndex: 0,
        }
      : {}),
    ...(generatedAssetId ? { assetId: generatedAssetId } : {}),
    ...(resolvedTaskId ? { taskId: resolvedTaskId, imageTaskId: resolvedTaskId } : {}),
    imageTaskKind: taskKind,
    ...(resolvedVendor ? { vendor: resolvedVendor } : {}),
    ...(modelAlias && !readTrimmedString(nodeData.imageModel) ? { imageModel: modelAlias } : {}),
    ...(imageSize && !readTrimmedString(nodeData.imageSize) ? { imageSize } : {}),
    ...(projectStyleProvenance
      ? {
          styleLockId: projectStyleProvenance.styleLockId,
          styleFingerprint: projectStyleProvenance.styleFingerprint,
          styleSource: projectStyleProvenance.styleSource,
          styleReferenceImages: projectStyleProvenance.styleReferenceImages,
        }
      : {}),
  };
  // 创作产物自动入库：角色卡（roleName）/场景卡（场景卡|场景锚标签）生成成功即注册进
  // 项目设定库 material_assets，供后续章节的护栏 B 锚定扫描按名复用（治跨章换脸/重画）。
  // best-effort：内部吞错，绝不阻断出图。
  if (nodeStatus === "success" && resolvedImageUrl) {
    const registration = await maybeAutoRegisterCanvasCard({
      c: input.c,
      userId: input.requestUserId,
      imageUrl: resolvedImageUrl,
      nodeData: finalNodeData,
      nodeId,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      ...(input.flowId ? { flowId: input.flowId } : {}),
    });
    // 同步生成后章节写入会经过 sweepRegisterCanvasCards。必须把本次登记标记随最终节点一起
    // 持久化，否则 sweep 会把同一 imageUrl 再追加成第二个素材版本。
    finalNodeData = withMaterialRegistrationMarker({
      nodeData: finalNodeData,
      imageUrl: resolvedImageUrl,
      registration,
    });
  }
  const finalNode = { ...taskNode, id: nodeId, data: finalNodeData } as typeof taskNode;

  // Chapter-canvas mode: this generation was triggered from inside a chapter
  // canvas (chapters.canvas_flow), not a flows-table flow. Persist the result
  // node into that chapter so it shows up there instead of the project root flow.
  if (input.chapterId) {
    const { stats } = await writeFinalNodeToChapterCanvas({
      c: input.c,
      userId: input.requestUserId,
      chapterId: input.chapterId,
      nodeId,
      finalNode: finalNode as unknown as Record<string, unknown>,
      finalNodeData,
    });
    return {
      ok: true,
      // 写入目标是章节画布(chapters.canvas_flow，其 synthetic flow id=chapterId)，不是项目 context flow。
      // 回 chapterId 而非 input.flowId，否则响应误标成项目 flow(b18296fd)，让人误判跨章污染。
      flowId: input.chapterId,
      updatedAt: new Date().toISOString(),
      stats: stats as unknown as PublicAgentsImageGenerateToCanvasResult["stats"],
      nodeId,
      imageUrl: resolvedImageUrl,
      vendor: resolvedVendor,
      taskId: resolvedTaskId,
      status: nodeStatus,
      ...(acceptedAsync ? { completionBoundary: "submission" as const } : {}),
    };
  }

  // Root-flow batch workers share the row captured at request start. A direct
  // last-writer-wins update lets the final worker erase its siblings, which is
  // then misread as missing assets and causes a second paid generation batch.
  // Reuse the CAS/re-read writer used by orchestration so every concurrent
  // image node is merged into the latest graph before it is persisted.
  const nodeAlreadyExists = readCurrentCanvasNodes(input.row).some(
    (node) => readTrimmedString(node.id) === nodeId,
  );
  const persisted = await persistFlowPatch({
    c: input.c,
    row: input.row,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    patch: nodeAlreadyExists
      ? { patchNodeData: [{ id: nodeId, data: finalNodeData }], allowOverwrite: true }
      : { createNodes: [finalNode] },
    affectedNodeIds: [nodeId],
  });

  return {
    ok: true,
    flowId: persisted.row.id,
    updatedAt: persisted.row.updated_at,
    stats: {
      createdNodes: nodeAlreadyExists ? 0 : 1,
      createdEdges: 0,
      patchedNodes: nodeAlreadyExists ? 1 : 0,
      appendedArrays: 0,
    },
    nodeId,
    imageUrl: resolvedImageUrl,
    vendor: resolvedVendor,
    taskId: resolvedTaskId,
    status: nodeStatus,
    ...(acceptedAsync ? { completionBoundary: "submission" as const } : {}),
  };
}

/**
 * S4-B：把 S3 异步化写的 status:"running" 图片占位节点回写成 success/error（对称于
 * reconcileVideoNodesForFlow）。扫 flow 内 image/imageEdit/storyboardImage 且仍属 provider pending 且有
 * imageTaskId 的节点 → 查一次上游任务 → 已完成就 patchNodeData(success+imageUrl)、失败标 error。
 * 给无头/agent 场景(没有前端轮询)的写回入口；前端 studio 另有 effect 轮询(S4-A)。image 计费在
 * runPublicTask 内的后台 job 结算，本函数不动 settle。
 */
export async function reconcileImageNodesForFlow(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  chapterId?: string;
  target?: {
    nodeId: string;
    taskId: string;
  };
  // 孤儿占位兜底（仅静置后台 sweep 传 true）：把 queued/running 但从未挂上任务、也无出图 URL 的
  // 占位节点标 error，停掉永远转圈的 spinner（成因：图任务提交失败 / 被前端 autosave 抹掉 taskId）。
  // 默认 false = 对直调方零行为变化，避免误杀刚建/提交中的节点。
  markOrphanPlaceholders?: boolean;
}): Promise<{
  ok: true;
  reconciled: number;
  failed: number;
  stillRunning: number;
  details: Array<{
    nodeId: string;
    taskId: string;
    status: string;
    errorMessage?: string;
  }>;
}> {
  const chapterId = readTrimmedString(input.chapterId);
  // `input.row` is captured before the tool request starts. Batch image
  // generation writes each node in parallel, so using that captured row can
  // hide siblings that were persisted after the request began (especially on
  // chapter canvases). Always read the current scoped graph before collecting
  // pending tasks; otherwise image_refs_get sees a partial batch and the agent
  // starts a second billable batch for nodes that already exist.
  const snapshot = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    ...(chapterId ? { chapterId } : {}),
  });
  const data = sanitizeFlowDataForStorage(mapFlowRowToDto(snapshot).data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  const IMAGE_KINDS = new Set(["image", "imageEdit", "storyboardImage"]);
  const pending: Array<{ nodeId: string; d: Record<string, unknown>; taskId: string }> = [];
  const orphans: Array<{ nodeId: string; d: Record<string, unknown> }> = [];
  for (const n of nodes) {
    const d =
      n.data && typeof n.data === "object" && !Array.isArray(n.data)
        ? (n.data as Record<string, unknown>)
        : {};
    if (!IMAGE_KINDS.has(readTrimmedString(d.kind))) continue;
    const nodeId = String(n.id ?? "");
    const st = readTrimmedString(d.status).toLowerCase();
    if (!isProviderTaskPendingStatus(st)) continue;
    const persistedTaskId = readTrimmedString(d.imageTaskId) || readTrimmedString(d.taskId);
    const targetTaskId = input.target && nodeId === input.target.nodeId
      ? readTrimmedString(input.target.taskId)
      : "";
    if (input.target && nodeId !== input.target.nodeId) continue;
    if (input.target && persistedTaskId && persistedTaskId !== targetTaskId) continue;
    const taskId = persistedTaskId || targetTaskId;
    if (!taskId) {
      // 孤儿占位：provider pending 但从未挂上任务、也无出图 URL → 无从查上游、永远转圈。
      // 仅在 markOrphanPlaceholders（静置后台 sweep）下回收，避免误杀刚建/提交中的节点。
      if (input.markOrphanPlaceholders && nodeId && !readTrimmedString(d.imageUrl)) {
        orphans.push({ nodeId, d });
      }
      continue;
    }
    pending.push({ nodeId, d, taskId });
  }

  let reconciled = 0;
  let failed = 0;
  let stillRunning = 0;
  const details: Array<{
    nodeId: string;
    taskId: string;
    status: string;
    errorMessage?: string;
  }> = [];
  for (const item of pending.slice(0, 24)) {
    let outcomeStatus = "running";
    let outcomeErrorMessage = "";
    try {
      const taskKind =
        (readTrimmedString(item.d.imageTaskKind) as TaskRequestDto["kind"]) || "text_to_image";
      const outcome = await fetchTaskResultForPolling(input.c, input.requestUserId, {
        taskId: item.taskId,
        vendor: readTrimmedString(item.d.vendor) || "newapi",
        taskKind,
        prompt: readTrimmedString(item.d.prompt),
        mode: "public",
      });
      if (!outcome.ok) {
        stillRunning += 1;
        details.push({ nodeId: item.nodeId, taskId: item.taskId, status: "running" });
        continue;
      }
      const status = readTrimmedString(outcome.result.status).toLowerCase();
      const url = extractImageUrlFromTaskResult(outcome.result);
      // 每节点写回前 fresh-read 当前 flow，避免多节点串行用旧快照互相覆盖。
      const persist = async (nodeData: Record<string, unknown>) => {
        const cur = chapterId
          ? input.row
          : await freshReadFlowRow({
              c: input.c,
              flowId: input.flowId,
              requestUserId: input.requestUserId,
              devBypass: input.devBypass,
            });
        await persistFlowPatch({
          c: input.c,
          row: cur,
          flowId: input.flowId,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          patch: {
            allowOverwrite: true,
            patchNodeData: [{ id: item.nodeId, data: nodeData }],
          },
          affectedNodeIds: [item.nodeId],
          ...(chapterId ? { chapterId } : {}),
        });
      };
      if (status === "succeeded" && url) {
        const assetId = extractImageAssetIdFromTaskResult(outcome.result, url);
        let completedData: Record<string, unknown> = {
          ...item.d,
          status: "success",
          taskId: item.taskId,
          imageTaskId: item.taskId,
          imageUrl: url,
          imageResults: [
            {
              url,
              title: readTrimmedString(item.d.label) || "Generated Image",
              ...(assetId ? { assetId } : {}),
            },
          ],
          imagePrimaryIndex: 0,
          ...(assetId ? { assetId } : {}),
        };
        // 【async 入库补齐·根治「已生成内容进不了历史资产」】异步出图在此 finalizer 收尾（running→success），
        // 而 maybeAutoRegisterCanvasCard 此前只在同步路径(1071)调 → 章节默认异步出图的角色/场景/道具卡
        // 从不入 material_assets、无法跨章复用。与同步路径同口径 best-effort 注册（内部吞错，不阻断收尾）。
        const registration = await maybeAutoRegisterCanvasCard({
          c: input.c,
          userId: input.requestUserId,
          imageUrl: url,
          nodeData: completedData,
          nodeId: item.nodeId,
          ...(chapterId ? { chapterId } : {}),
          ...(input.flowId ? { flowId: input.flowId } : {}),
        });
        completedData = withMaterialRegistrationMarker({
          nodeData: completedData,
          imageUrl: url,
          registration,
        });
        await persist(completedData);
        reconciled += 1;
        outcomeStatus = "success";
      } else if (status === "failed") {
        const providerFailure =
          buildProviderTaskFailureMessage(outcome.result) ||
          "Provider image task failed without a diagnostic message";
        await persist({
          ...item.d,
          status: "error",
          taskId: item.taskId,
          imageTaskId: item.taskId,
          error: providerFailure,
          errorMessage: providerFailure,
          providerStatus: status,
        });
        failed += 1;
        outcomeStatus = "failed";
        outcomeErrorMessage = providerFailure;
      } else {
        stillRunning += 1;
      }
    } catch (err) {
      console.warn("[image-reconcile] node failed", {
        nodeId: item.nodeId,
        taskId: item.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      stillRunning += 1;
    }
    details.push({
      nodeId: item.nodeId,
      taskId: item.taskId,
      status: outcomeStatus,
      ...(outcomeErrorMessage ? { errorMessage: outcomeErrorMessage } : {}),
    });
  }
  // 孤儿占位兜底：标 error，停掉永转 spinner（仅 markOrphanPlaceholders 下，已过静置守卫）。
  for (const orphan of orphans.slice(0, 24)) {
    try {
      const cur = chapterId
        ? input.row
        : await freshReadFlowRow({
            c: input.c,
            flowId: input.flowId,
            requestUserId: input.requestUserId,
            devBypass: input.devBypass,
          });
      await persistFlowPatch({
        c: input.c,
        row: cur,
        flowId: input.flowId,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
        patch: {
          allowOverwrite: true,
          patchNodeData: [
            {
              id: orphan.nodeId,
              data: { ...orphan.d, status: "error", error: "生成未提交成功(孤儿占位)，请重试" },
            },
          ],
        },
        affectedNodeIds: [orphan.nodeId],
        ...(chapterId ? { chapterId } : {}),
      });
      failed += 1;
      details.push({
        nodeId: orphan.nodeId,
        taskId: "",
        status: "orphan_failed",
        errorMessage: "生成未提交成功(孤儿占位)，请重试",
      });
    } catch (err) {
      console.warn("[image-reconcile] orphan mark failed", {
        nodeId: orphan.nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Async image completion is not itself the user-facing delivery.  A prior
  // agents turn may have submitted these images as prerequisites for an
  // unfinished delivery contract.  Re-read the persisted flow, atomically
  // claim every contract whose explicit node dependencies are materialized,
  // then resume its original session.  This is deliberately structural: it
  // does not inspect node labels, prompts, or skill names to decide what to do.
  if (!chapterId && input.row.project_id) {
    try {
      const latest = await freshReadFlowRow({
        c: input.c,
        flowId: input.flowId,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
      });
      const latestData = sanitizeFlowDataForStorage(mapFlowRowToDto(latest).data ?? {});
      const latestNodes = Array.isArray((latestData as Record<string, unknown>).nodes)
        ? ((latestData as Record<string, unknown>).nodes as unknown[])
        : [];
      const nodeStates = buildAsyncAgentContinuationNodeStates(latestNodes);
      const continuations = await claimReadyAsyncAgentContinuations({
        c: input.c,
        flowId: input.flowId,
        projectId: input.row.project_id,
        nodeStates,
		claimReady: false,
      });
      await scheduleAsyncAgentContinuations(input.c, continuations);
    } catch (error) {
      // Reconcile has already durably preserved the image result.  A
      // continuation scheduling error must be observable but must never erase
      // or rewrite that successful asset.
      console.error("[async-agent-continuation] scheduling failed", {
        flowId: input.flowId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ok: true, reconciled, failed, stillRunning, details };
}
