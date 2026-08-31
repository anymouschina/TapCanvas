import { z } from "zod";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  PublicFlowCreateTaskNodeSchema,
  PublicFlowGraphSchema,
} from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  getFlowByIdUnsafe,
  getFlowForOwner,
  mapFlowRowToDto,
  updateFlow,
  updateFlowByIdUnsafe,
  type FlowRow,
} from "../flow/flow.repo";
import { runPublicTask } from "../apiKey/apiKey.routes";
import {
  extractObjectStorageObjectKey,
  resolveObjectStorageConfig,
} from "../asset/rustfs.client";
import { registerGeneratedMediaAsset } from "../asset/asset.hosting";
import { fetchTaskResultForPolling, isPermanentUpstreamTaskError } from "./task.polling";
import { isProviderTaskPendingStatus } from "./provider-task-status";
import { buildProviderTaskFailureMessage } from "./provider-task-failure";
import { pollUntilSettled } from "./task.polling-core";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import { resolveWorldInfo } from "../worldinfo/world-info.service";
import { createProjectWorldInfoLoader } from "../worldinfo/world-info.loader";
import { broadcastPatch } from "../chapter/canvas-sse.manager";
import {
  selectAnchorReferenceImages,
  mergeAnchorReferences,
  type LockedAnchors,
} from "./chapter-anchor-autobind";
import { writeFinalNodeToChapterCanvas } from "./agents-tool-bridge.chapter-canvas-write";
import {
  DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS,
  waitForCanvasRevisionRetry,
  withChapterCanvasWriteQueue,
} from "./chapter-canvas-write-queue";
import {
  buildMediaVersionArchiveNode,
  isMediaVersionReplacement,
} from "./node-version-archive";
import {
  getChapterCanvasFlow,
  putChapterCanvasFlow,
  CanvasFlowRevisionConflictError,
} from "../chapter/chapter.canvas-flow.service";
import { applyPatchToFlowYDoc } from "../realtime/yjs-realtime";
import {
  settleTeamCreditsOnSuccess,
  releaseTeamCreditsOnFailure,
} from "../team/team.service";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import { resolveModelDurationOptions } from "./video-orchestrator.model-duration";
// 视频编排（阶段 A/B/C）：稳定 clipId/slot 派生 + fresh-read 写回工具层。
import { buildClipId, deriveClipNodeId } from "./video-orchestrator.clip-plan";
import {
  claimVideoSubmissionIntent,
  markVideoSubmissionAccepted,
  markVideoSubmissionPreUpstreamRejected,
  markVideoSubmissionUncertain,
  stableContentHash,
} from "./video-orchestrator.authoring.repo";
import {
  assertProductionRunAllowsNewEffects,
  findLatestProductionEffect,
  reserveProductionEffect,
  transitionProductionEffect,
  type ProductionEffectStatus,
} from "./production-effect-ledger";
import { shouldReturnVideoAsync } from "./agents-tool-bridge.video-return-policy";
import {
  findFlowNode,
  freshReadFlowRow,
  persistFlowPatch,
  readFlowNodes,
} from "./video-orchestrator.flow-io";
import { buildClipInputEdges } from "./video-orchestrator.input-edges";
import {
  buildVoiceReferenceEdgeSyncPlan,
  readVoiceReferenceNodeIds,
} from "./video-orchestrator.voice-reference-edges";
import {
  buildVideoReferenceMediaManifest,
  mergeVideoReferenceImageBindings,
  normalizeVideoReferenceImageBindings,
  purposeForAssetKind,
  renderVideoReferenceContinuationNote,
  selectSeedanceReferenceMode,
  withAuthoritativePromptAnnotation,
  type VideoReferenceImageBinding,
  type VideoReferencePurpose,
} from "./video-reference-manifest";
import {
  verifyVideoReferenceDelivery,
} from "./video-reference-delivery";
import {
  isVideoSubmitCapacityBackpressure,
  isVideoSubmitKnownPreUpstreamFailure,
  readVideoSubmitErrorCode,
  readVideoSubmitRejectedUrls,
  matchVideoSubmitRejectedReferenceIds,
} from "./video-orchestrator.submit-error";
import {
  resolveWorkflowVideoEffectReplay,
  workflowVideoSubmissionFailureData,
  workflowVideoSubmittingData,
} from "./workflow-video-effect-claim";
import {
  parseVideoGenerationContract,
  resolveVideoModelAudioOnlyReferenceSupport,
  resolveVideoModelMaximumReferenceImages,
} from "./video-orchestrator.generation-contract";
import { resolveExecutionImageReferences } from "./agents-tool-bridge.image-reference-ids";
import {
  buildFinalAssetReferenceIndices,
  hydrateReferenceBindingsFromAssetContracts,
  readAssetObjectIdentityContracts,
} from "./video-reference-contract-binding";
import {
  bindVerifiedVoiceReferences,
  renderClipPromptFromShots,
  VOICE_REFERENCE_BINDING_PLACEHOLDER,
  type StructuredClip,
} from "./video-orchestrator.clip-shots";
import {
  buildVerifiedVoiceBindingInstructionFromManifest,
} from "./video-orchestrator.dialog-audio";
import { readStructuredSpeechEvents } from "./video-orchestrator.speaker-contract";
import {
  buildVideoPromptDeliveryContract,
  buildVideoPromptDeliveryProjection,
} from "./video-prompt-delivery-contract";
import { classifyCanvasCardForRegistry } from "./material-card-classify";
import {
  applyGeneratedVideoPoster,
  hasPersistedVideoPoster,
  readVideoInputPosterUrl,
  resolveCanvasVideoPoster,
} from "./video-canvas-poster";

// Resolve the authoritative video aspect from the group the node belongs to.
// A group with data.videoAspect pins ALL its shots to one aspect deterministically,
// so the per-shot LLM-set aspectRatio can't drift the batch (vertical stays vertical).
function resolveGroupVideoAspect(row: FlowRow, parentId: string): string {
  if (!parentId) return "";
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    const nodes = Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
      : [];
    const group = nodes.find((n) => String(n.id ?? "") === parentId);
    const gd =
      group?.data && typeof group.data === "object" && !Array.isArray(group.data)
        ? (group.data as Record<string, unknown>)
        : {};
    return readTrimmedString(gd.videoAspect) || readTrimmedString(gd.aspectRatio);
  } catch {
    return "";
  }
}

// Group-pinned video model (deterministic, mirrors resolveGroupVideoAspect). When the
// orchestration writes the chosen model into group.data.videoModel (via flow_patch), it wins
// over the per-node LLM-set value so every shot of one film shares the SAME model. Without
// this, the LLM tends to copy the seedance example string from the tool schema into each
// node.data.videoModel — silently overriding a pinned pixverse-v6 and routing to seedance
// (which then triggers ARK image moderation / DownloadFail). Pinning at the group level closes
// that gap the same way aspect ratio is pinned.
function resolveGroupVideoModel(row: FlowRow, parentId: string): string {
  if (!parentId) return "";
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    const nodes = Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
      : [];
    const group = nodes.find((n) => String(n.id ?? "") === parentId);
    const gd =
      group?.data && typeof group.data === "object" && !Array.isArray(group.data)
        ? (group.data as Record<string, unknown>)
        : {};
    return readTrimmedString(gd.videoModel) || readTrimmedString(gd.modelKey);
  } catch {
    return "";
  }
}

/* REMOVED: recipe/storyboard admission helpers were a semantic hard gate. */
/*
// Group-pinned recipe id (mirrors resolveGroupVideoModel). The orchestration pins it onto the
// group's data at the打组 step (alongside videoAspect/videoModel). Its presence marks this group
// as a recipe-driven film that MUST have a storyboard board image (S4.0) before any shot video
// is generated — see groupHasStoryboardNode + the S4.0 gate in the handler.
function resolveGroupRecipeId(row: FlowRow, parentId: string): string {
  if (!parentId) return "";
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    const nodes = Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
      : [];
    const group = nodes.find((n) => String(n.id ?? "") === parentId);
    const gd =
      group?.data && typeof group.data === "object" && !Array.isArray(group.data)
        ? (group.data as Record<string, unknown>)
        : {};
    return readTrimmedString(gd.sourceRecipeId) || readTrimmedString(gd.recipeId);
  } catch {
    return "";
  }
}

// Whether the group already contains a REAL, USED storyboard node (S4.0 output) — not a
// decorative one. A 故事板 label alone was gamed (LLM made a plain grid image, labelled it, then
// ignored it: shots used product images + a freshly-written prompt, no storyboard→clip link).
// Requiring seedancePrompt outright over-corrected — the chat path also hand-builds a
// storyboardScript node (no seedancePrompt) and wires it to the clips, which IS a real used
// storyboard. So we accept a non-video storyboard node when EITHER:
//   (a) it carries machine-readable plan metadata (seedancePrompt / sourceRecipeId / gridSpec —
//       what the generate_group_storyboard template writes), OR
//   (b) it is a storyboard-kind node (storyboardImage/storyboardScript) AND is wired to ≥1 shot
//       video node in the group (an outgoing edge into a video node) — proving it actually drives
//       the shots rather than sitting decoratively unconnected.
function groupHasStoryboardNode(row: FlowRow, parentId: string): boolean {
  if (!parentId) return false;
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    const nodes = Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
      : [];
    const edges = Array.isArray((data as Record<string, unknown>).edges)
      ? ((data as Record<string, unknown>).edges as Array<Record<string, unknown>>)
      : [];
    const inGroup = (n: Record<string, unknown>) => {
      const pid =
        (n as Record<string, unknown>).parentId ??
        (n as Record<string, unknown>).parentNode ??
        ((n.data as Record<string, unknown> | undefined)?.parentId);
      return String(pid ?? "") === parentId;
    };
    const nodeData = (n: Record<string, unknown>) =>
      n.data && typeof n.data === "object" && !Array.isArray(n.data)
        ? (n.data as Record<string, unknown>)
        : {};
    // Video node ids in this group — targets that prove a storyboard is wired to a shot.
    const videoNodeIds = new Set<string>();
    for (const n of nodes) {
      if (!inGroup(n)) continue;
      if (readTrimmedString(nodeData(n).kind) === "video") {
        videoNodeIds.add(String(n.id ?? ""));
      }
    }
    const hasEdgeToVideo = (nodeId: string) =>
      edges.some(
        (e) =>
          String(e.source ?? "") === nodeId && videoNodeIds.has(String(e.target ?? "")),
      );
    const STORYBOARD_KINDS = new Set(["storyboardimage", "storyboardscript", "storyboard"]);
    for (const n of nodes) {
      if (!inGroup(n)) continue;
      const d = nodeData(n);
      const kind = readTrimmedString(d.kind).toLowerCase();
      if (kind === "video") continue; // shot videos are not storyboards
      const hasPlanMeta =
        !!readTrimmedString(d.seedancePrompt) ||
        !!readTrimmedString(d.sourceRecipeId) ||
        d.gridSpec != null;
      if (hasPlanMeta) return true;
      // A dedicated storyboard-kind node carrying real plan text (in seedancePrompt OR prompt) is a
      // genuine storyboard even if the LLM forgot the sourceRecipeId field — the plan still drives
      // the clips via injection (resolveGroupStoryboard reads prompt as a fallback). Or it's wired
      // to a clip. (A plain `image` node with a storyboard-y prompt does NOT count — must be a
      // storyboard kind, so a decorative generic image can't game the gate.)
      if (STORYBOARD_KINDS.has(kind)) {
        if (!!readTrimmedString(d.prompt) || hasEdgeToVideo(String(n.id ?? ""))) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Resolve the group's storyboard node for hard-binding (content injection + lineage edge).
// Returns the first non-video storyboard node carrying a seedancePrompt (the per-shot plan), so
// every clip's prompt can be prefixed with it and an edge drawn storyboard→clip. This makes the
// storyboard materially drive each shot instead of being a checkbox the LLM satisfies then ignores.
function resolveGroupStoryboard(
  row: FlowRow,
  parentId: string,
): { id: string; kind: string; seedancePrompt: string } | null {
  if (!parentId) return null;
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    const nodes = Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
      : [];
    let fallback: { id: string; kind: string; seedancePrompt: string } | null = null;
    for (const n of nodes) {
      const pid =
        (n as Record<string, unknown>).parentId ??
        (n as Record<string, unknown>).parentNode ??
        ((n.data as Record<string, unknown> | undefined)?.parentId);
      if (String(pid ?? "") !== parentId) continue;
      const d =
        n.data && typeof n.data === "object" && !Array.isArray(n.data)
          ? (n.data as Record<string, unknown>)
          : {};
      const kind = readTrimmedString(d.kind).toLowerCase();
      if (kind === "video") continue;
      const isStoryboardKind =
        kind === "storyboardimage" || kind === "storyboardscript" || kind === "storyboard";
      // Foundation layer to inject = seedancePrompt if set, else the storyboard node's prompt
      // (the LLM often writes the whole plan into prompt and forgets the seedancePrompt field).
      const sp =
        readTrimmedString(d.seedancePrompt) || (isStoryboardKind ? readTrimmedString(d.prompt) : "");
      const isStoryboard = isStoryboardKind || !!sp || !!readTrimmedString(d.sourceRecipeId);
      if (!isStoryboard) continue;
      const entry = { id: String(n.id ?? ""), kind, seedancePrompt: sp };
      if (sp) return entry; // prefer one that actually carries the plan (seedancePrompt or prompt)
      if (!fallback) fallback = entry;
    }
    return fallback;
  } catch {
    return null;
  }
}
*/

/**
 * 章节画布上的全部分镜设计板节点（productionLayer=design_board，有真实 imageUrl）。
 * 这是可追溯性查询数据，供编排/诊断使用；不存在设计板时不阻断一般视频生成。
 */
export function resolveChapterDesignBoardNodes(
  row: FlowRow,
): Array<{ id: string; imageUrl: string; seedancePrompt: string }> {
  const out: Array<{ id: string; imageUrl: string; seedancePrompt: string }> = [];
  for (const n of readFlowNodes(row)) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    if (readTrimmedString(d.productionLayer) !== "design_board") continue;
    const imageUrl = readTrimmedString(d.imageUrl) || readTrimmedString(d.url);
    if (!/^https?:\/\//.test(imageUrl)) continue;
    out.push({
      id: String((n as Record<string, unknown>).id ?? ""),
      imageUrl,
      seedancePrompt: readTrimmedString(d.seedancePrompt) || readTrimmedString(d.prompt),
    });
  }
  return out;
}

function normalizeVideoModelIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/-apimart$/, "");
}

async function resolveSubmissionDurationSeconds(input: {
  c: AppContext;
  modelKey: string;
  requestedDurationSeconds: number | null | undefined;
  generationContract: unknown;
}): Promise<number | undefined> {
  if (input.requestedDurationSeconds == null) return undefined;
  const modelKey = input.modelKey.trim();
  if (!modelKey) {
    throw new AppError("视频时长已指定，但缺少视频模型，无法核对实时合法档位", {
      status: 400,
      code: "video_model_key_required",
    });
  }
  let durationOptions: number[];
  if (input.generationContract !== undefined) {
    const contract = parseVideoGenerationContract(input.generationContract);
    if (!contract) {
      throw new AppError("视频节点携带的 generationContract 不完整或已损坏", {
        status: 400,
        code: "video_generation_contract_invalid",
      });
    }
    if (
      normalizeVideoModelIdentity(contract.videoModel) !==
      normalizeVideoModelIdentity(modelKey)
    ) {
      throw new AppError("视频节点模型与冻结的 generationContract 不一致", {
        status: 409,
        code: "video_generation_contract_model_mismatch",
        details: { modelKey, contractModel: contract.videoModel },
      });
    }
    durationOptions = contract.durationOptions;
  } else {
    try {
      durationOptions = await resolveModelDurationOptions({ c: input.c, modelKey });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(message, {
        status: 422,
        code: "video_generation_duration_contract_unavailable",
        details: { modelKey },
      });
    }
  }
  if (!durationOptions.includes(input.requestedDurationSeconds)) {
    throw new AppError(
      `视频时长 ${input.requestedDurationSeconds}s 不在模型 ${modelKey} 的实时合法档位中`,
      {
        status: 400,
        code: "video_generation_duration_not_supported",
        details: {
          modelKey,
          requestedDurationSeconds: input.requestedDurationSeconds,
          durationOptions,
          maxDurationSeconds: durationOptions[durationOptions.length - 1],
        },
      },
    );
  }
  return input.requestedDurationSeconds;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

// 收集 parentId 群组内所有图片节点的真实 URL（ground truth）。用于净化 LLM 可能幻觉的
// referenceImages/firstFrameUrl（曾凭空编 static.beqlee.com 死域名导致 pixverse 下载失败）。
function resolveGroupImageUrls(row: FlowRow, parentId: string): string[] {
  if (!parentId) return [];
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    const nodes = Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
      : [];
    const out: string[] = [];
    for (const n of nodes) {
      const pid =
        (n as Record<string, unknown>).parentId ??
        (n as Record<string, unknown>).parentNode ??
        ((n.data as Record<string, unknown> | undefined)?.parentId);
      if (String(pid ?? "") !== parentId) continue;
      const d =
        n.data && typeof n.data === "object" && !Array.isArray(n.data)
          ? (n.data as Record<string, unknown>)
          : {};
      const u =
        (typeof d.imageUrl === "string" && d.imageUrl) ||
        (typeof d.url === "string" && d.url) ||
        "";
      if (typeof u === "string" && /^https?:\/\//.test(u)) out.push(u);
    }
    return out;
  } catch {
    return [];
  }
}

// Flow-wide image URL collector (ground-truth fallback). When the shot node carries no resolvable
// parentId (the LLM sometimes omits parentId on the clip node), resolveGroupImageUrls returns []
// and the reference-image sanitizer below would be skipped entirely — letting a hallucinated host
// (e.g. static.tapcanvas.com/...png the LLM invented) reach the upstream and 404. Scanning every
// image-bearing node in the flow gives us a trusted-host set + a real fallback URL regardless of
// parentId, so hallucinated reference URLs are still replaced with a real asset.
function resolveFlowImageUrls(row: FlowRow): string[] {
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    const nodes = Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
      : [];
    const out: string[] = [];
    for (const n of nodes) {
      const d =
        n.data && typeof n.data === "object" && !Array.isArray(n.data)
          ? (n.data as Record<string, unknown>)
          : {};
      const u =
        (typeof d.imageUrl === "string" && d.imageUrl) ||
        (typeof d.url === "string" && d.url) ||
        "";
      if (typeof u === "string" && /^https?:\/\//.test(u)) out.push(u);
    }
    return out;
  } catch {
    return [];
  }
}

// 取 row（章节画布合成 FlowRow）里的全部节点（含 data），供章节锚自动绑定按 label/lockedAnchors 解析。
function resolveFlowNodes(row: FlowRow): Array<{ id?: unknown; data?: unknown }> {
  try {
    const dto = mapFlowRowToDto(row);
    const data = sanitizeFlowDataForStorage(dto.data ?? {});
    return Array.isArray((data as Record<string, unknown>).nodes)
      ? ((data as Record<string, unknown>).nodes as Array<{ id?: unknown; data?: unknown }>)
      : [];
  } catch {
    return [];
  }
}

// 从 clip 节点 data 里读取仍由 Hono 处理的道具锚。角色/场景走结构化 ID 单轨。
function readLockedAnchors(nodeData: Record<string, unknown>): LockedAnchors | undefined {
  const pm =
    nodeData.productionMetadata && typeof nodeData.productionMetadata === "object"
      ? (nodeData.productionMetadata as Record<string, unknown>)
      : undefined;
  const la =
    pm?.lockedAnchors && typeof pm.lockedAnchors === "object"
      ? (pm.lockedAnchors as Record<string, unknown>)
      : nodeData.lockedAnchors && typeof nodeData.lockedAnchors === "object"
        ? (nodeData.lockedAnchors as Record<string, unknown>)
        : undefined;
  if (!la) return undefined;
  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return { prop: toStrArr(la.prop) };
}

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

function referencePurposeFromStructuredRole(value: unknown): VideoReferencePurpose {
  switch (readTrimmedString(value).toLowerCase()) {
    case "character":
      return "character";
    case "scene":
      return "scene";
    case "prop":
      return "prop";
    case "ensemble":
      return "ensemble";
    case "style":
      return "style";
    case "product":
      return "product";
    case "keyframe":
      return "keyframe";
    case "storyboard":
      return "storyboard";
    default:
      return "other";
  }
}

function resolveCanvasReferenceBindings(row: FlowRow): Map<string, VideoReferenceImageBinding> {
  const out = new Map<string, VideoReferenceImageBinding>();
  for (const node of resolveFlowNodes(row)) {
    const data =
      node.data && typeof node.data === "object" && !Array.isArray(node.data)
        ? (node.data as Record<string, unknown>)
        : {};
    const urls = [readTrimmedString(data.imageUrl), readTrimmedString(data.url)];
    const imageResults = Array.isArray(data.imageResults) ? data.imageResults : [];
    for (const result of imageResults) {
      if (!result || typeof result !== "object" || Array.isArray(result)) continue;
      urls.push(readTrimmedString((result as Record<string, unknown>).url));
    }
    const label = readTrimmedString(data.label) || "画布参考图";
    const structuredPurpose = referencePurposeFromStructuredRole(
      data.referenceType ?? data.assetKind ?? data.productionLayer,
    );
    // 手工视频节点没有 orchestrator 的 per-clip contract，但画布卡本身仍有
    // material-card-classify 的确定性身份。把它带入 manifest，避免生成层退回泛化
    // label（如“角色卡”）或按图序猜角色；这只复用既有卡分类，不从 prompt 推断。
    const classification = classifyCanvasCardForRegistry(data);
    const classifiedPurpose = classification
      ? purposeForAssetKind(classification.kind)
      : null;
    const purpose = classifiedPurpose ?? structuredPurpose;
    const assetName = classification?.name;
    const sourceNodeId = readTrimmedString(node.id);
    for (const url of urls.filter(Boolean)) {
      const [merged] = mergeVideoReferenceImageBindings([
        ...(out.get(url) ? [out.get(url)!] : []),
        {
          url,
          label,
          purpose,
          purposes: [purpose],
          sourceNodeIds: sourceNodeId ? [sourceNodeId] : [],
          ...(classifiedPurpose ? { assetKind: classifiedPurpose } : {}),
          ...(classifiedPurpose && assetName ? { assetName } : {}),
        },
      ]);
      if (merged) out.set(url, merged);
    }
  }
  return out;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeVideoResolution(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "").toLowerCase() : "";
}

export function buildVideoBillingSpecKey(
  resolution: string,
  durationSeconds: number | null,
): string {
  const normalizedResolution = normalizeVideoResolution(resolution);
  const normalizedDuration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? Math.trunc(durationSeconds)
      : 0;
  if (!normalizedResolution || normalizedDuration <= 0) return "";
  return `video:${normalizedResolution}:${normalizedDuration}s`;
}

type CanvasAssetInput = {
  assetId?: string;
  assetRefId?: string;
  url?: string;
  role?: string;
  note?: string;
  name?: string;
};

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
    const note = readTrimmedString(record.note);
    const name = readTrimmedString(record.name);
    if (!assetId && !url) continue;
    out.push({
      ...(assetId ? { assetId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
      ...(url ? { url } : {}),
      ...(role ? { role } : {}),
      ...(note ? { note } : {}),
      ...(name ? { name } : {}),
    });
  }
  return out;
}

function extractVideoAssetFromTaskResult(result: unknown): {
	videoUrl: string;
	thumbnailUrl: string | null;
	posterInline: string | null;
	assetId: string | null;
} {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { videoUrl: "", thumbnailUrl: null, posterInline: null, assetId: null };
  }
  const record = result as Record<string, unknown>;
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const item of assets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const assetRecord = item as Record<string, unknown>;
    const url = readTrimmedString(assetRecord.url);
    if (!url) continue;
    const type = readTrimmedString(assetRecord.type).toLowerCase();
    if (!type || type === "video") {
      return {
        videoUrl: url,
        thumbnailUrl: readTrimmedString(assetRecord.thumbnailUrl) || null,
        posterInline: readTrimmedString(assetRecord.posterInline) || null,
        assetId: readTrimmedString(assetRecord.assetId) || null,
      };
    }
  }
  const directVideoUrl = readTrimmedString(record.videoUrl);
  if (directVideoUrl) {
    return {
      videoUrl: directVideoUrl,
      thumbnailUrl: readTrimmedString(record.videoThumbnailUrl) || null,
      posterInline: null,
      assetId: null,
    };
  }
  const videoResults = Array.isArray(record.videoResults) ? record.videoResults : [];
  for (const item of videoResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const assetRecord = item as Record<string, unknown>;
    const url = readTrimmedString(assetRecord.url);
    if (!url) continue;
    return {
      videoUrl: url,
      thumbnailUrl: readTrimmedString(assetRecord.thumbnailUrl) || null,
      posterInline: readTrimmedString(assetRecord.posterInline) || null,
      assetId: readTrimmedString(assetRecord.assetId) || null,
    };
  }
  return { videoUrl: "", thumbnailUrl: null, posterInline: null, assetId: null };
}

const VideoCanvasNodeKindSchema = z.enum(["composeVideo", "video"]);

export const PublicAgentsVideoGenerateToCanvasArgsSchema = z.object({
  node: PublicFlowCreateTaskNodeSchema.superRefine((node, ctx) => {
    if (!VideoCanvasNodeKindSchema.safeParse(node.data.kind).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "node.data.kind must be composeVideo or video",
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
  }),
});

export type PublicAgentsVideoGenerateToCanvasArgs = z.infer<
  typeof PublicAgentsVideoGenerateToCanvasArgsSchema
>;

export type PublicAgentsVideoGenerateToCanvasResult = {
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
  videoUrl: string;
  thumbnailUrl: string | null;
  vendor: string;
  taskId: string | null;
  // 所有带 taskId 的异步提交都会返回 status:"running"；编排幂等命中额外返回 reused:true。
  status?: "success" | "running";
  reused?: boolean;
  clipId?: string;
  clipRunId?: string;
  clipIndex?: number;
  effectId?: string;
  effectLedgerStatus?: ProductionEffectStatus | "persistence_failed";
  effectLedgerError?: string;
};

async function awaitVideoResult(input: {
  c: AppContext;
  userId: string;
  vendor: string;
  initialResult: TaskResultDto;
  prompt: string;
  taskKind: TaskRequestDto["kind"];
}): Promise<{
  vendor: string;
  result: TaskResultDto;
  taskId: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  posterInline: string | null;
  assetId: string | null;
}> {
  let currentVendor = input.vendor;
  let currentResult = input.initialResult;
  let extracted = extractVideoAssetFromTaskResult(currentResult);
  let status = readTrimmedString(currentResult.status).toLowerCase();
  let taskId = readTrimmedString(currentResult.id) || null;
  if (extracted.videoUrl && status === "succeeded") {
    return {
      vendor: currentVendor,
      result: currentResult,
      taskId,
      videoUrl: extracted.videoUrl,
      thumbnailUrl: extracted.thumbnailUrl,
      posterInline: extracted.posterInline,
      assetId: extracted.assetId,
    };
  }

  if ((status === "queued" || status === "running") && taskId) {
    const settled = await pollUntilSettled({
      timeoutMs: 600_000,
      intervalMs: 3_000,
      pollOnce: async () =>
        fetchTaskResultForPolling(input.c, input.userId, {
          taskId,
          vendor: currentVendor,
          taskKind: input.taskKind,
          prompt: input.prompt,
          mode: "public",
          timeoutMs: 20_000,
        }),
      evaluate: (outcome) => {
        if (!outcome.ok) return "continue";
        currentVendor = readTrimmedString(outcome.vendor) || currentVendor;
        currentResult = outcome.result;
        extracted = extractVideoAssetFromTaskResult(currentResult);
        status = readTrimmedString(currentResult.status).toLowerCase();
        if (status === "succeeded" && extracted.videoUrl) return "success";
        if (status === "failed") return "failure";
        return "continue";
      },
    });
    if (settled.state === "success" && extracted.videoUrl) {
      return {
        vendor: currentVendor,
        result: currentResult,
        taskId,
        videoUrl: extracted.videoUrl,
        thumbnailUrl: extracted.thumbnailUrl,
        posterInline: extracted.posterInline,
        assetId: extracted.assetId,
      };
    }
  }

  if (status === "queued" || status === "running") {
    throw new AppError("视频生成超时：任务仍未完成", {
      status: 504,
      code: "agents_tool_video_generate_timeout",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
      },
    });
  }

  if (status !== "succeeded") {
    throw new AppError("视频生成失败", {
      status: 502,
      code: "agents_tool_video_generate_failed",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
        message: buildProviderTaskFailureMessage(currentResult) || null,
      },
    });
  }

  if (!extracted.videoUrl) {
    throw new AppError("视频生成失败：未返回视频 URL", {
      status: 502,
      code: "agents_tool_video_missing_url",
      details: {
        taskId,
        vendor: currentVendor || null,
      },
    });
  }

  return {
    vendor: currentVendor,
    result: currentResult,
    taskId,
    videoUrl: extracted.videoUrl,
    thumbnailUrl: extracted.thumbnailUrl,
    posterInline: extracted.posterInline,
    assetId: extracted.assetId,
  };
}

function nodeExistsInGraph(current: unknown, nodeId: string): boolean {
  const nodes = Array.isArray((current as Record<string, unknown>)?.nodes)
    ? ((current as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  return nodes.some((n) => String(n.id ?? "") === nodeId);
}

// Persist a flow-graph patch for a video node, RE-READING the latest flow row first so a
// long-running generation never clobbers concurrent canvas edits (the handler's start-of-run
// snapshot is up to 10 min stale). Used for both the P0 "running" placeholder write and the final
// success write. buildPatch receives the fresh graph and returns the patch (or null to skip).
export async function persistVideoNodePatch(opts: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  fallbackRow: FlowRow;
  broadcastNodeId: string;
  chapterId?: string;
  buildPatch: (current: unknown) => {
    createNodes?: unknown[];
    patchNodeData?: unknown[];
    createEdges?: unknown[];
    deleteEdgeIds?: string[];
    allowOverwrite?: boolean;
  } | null;
}): Promise<{ stats: unknown; updatedAt: string; data: unknown } | null> {
  const { c, requestUserId, devBypass, flowId, fallbackRow, broadcastNodeId, buildPatch } = opts;
  const chapterId = readTrimmedString(opts.chapterId);
  // 章节画布（项目子级）：走 chapters.canvas_flow 的乐观锁读改写（revision 冲突重试），
  // 与 flows 表写同语义；广播到章节 SSE 房（chapterId 作房间键）。
  if (chapterId) {
    return withChapterCanvasWriteQueue(chapterId, async () => {
      const conflictTimeoutMs = DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS;
      const conflictDeadlineMs = Date.now() + conflictTimeoutMs;
      for (let attempt = 0; ; attempt += 1) {
      const { revision, flow } = await getChapterCanvasFlow(c, requestUserId, chapterId);
      const current = sanitizeFlowDataForStorage(flow ?? { nodes: [], edges: [] });
      const patch = buildPatch(current);
      if (!patch) return null;
      const applied = applyPublicFlowGraphPatch({ current, patch: patch as never });
      const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
      const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
      if (!nextParsed.success) {
        throw new AppError("Chapter canvas flow patch produced invalid data", {
          status: 500,
          code: "chapter_canvas_flow_invalid",
          details: { issues: nextParsed.error.issues },
        });
      }
      const nextNodes = Array.isArray((sanitizedNext as { nodes?: unknown }).nodes)
        ? ((sanitizedNext as { nodes?: unknown[] }).nodes as unknown[])
        : [];
      const nextEdges = Array.isArray((sanitizedNext as { edges?: unknown }).edges)
        ? ((sanitizedNext as { edges?: unknown[] }).edges as unknown[])
        : [];
      let savedRevision: number;
      let savedFlow = {
        nodes: nextParsed.data.nodes ?? [],
        edges: nextParsed.data.edges ?? [],
      };
      try {
        const saveResult = await putChapterCanvasFlow(c, requestUserId, chapterId, {
          expectedRevision: revision,
          flow: { nodes: nextNodes as never, edges: nextEdges as never },
          // agent 回灌：撞版本走 CAS 取并集重试（reconcile 并回最新节点），不硬挡 409。
          source: "agent",
        });
        savedRevision = saveResult.revision;
        savedFlow = saveResult.authoritativeFlow ?? savedFlow;
      } catch (err) {
        if (err instanceof CanvasFlowRevisionConflictError) {
          const decision = await waitForCanvasRevisionRetry({
            attempt,
            deadlineMs: conflictDeadlineMs,
          });
          if (!decision.retry) {
            throw new AppError("Chapter canvas flow write conflict deadline exhausted", {
              status: 409,
              code: "chapter_canvas_flow_conflict",
              details: {
                expected: err.expected,
                actual: err.actual,
                attempts: attempt + 1,
                conflictTimeoutMs,
              },
            });
          }
          continue;
        }
        throw err;
      }
      const upserted = savedFlow.nodes.find(
        (n: unknown) => String((n as { id?: string }).id ?? "") === broadcastNodeId,
      );
      // 【治「split 丢边」同款根因】新建边必须一起广播：否则浏览器只收到节点、本地 store 无边，
      // 其 autosave 整图 PUT 会把服务端刚建的输入连线清空。
      const edgeMap = new Map(
        savedFlow.edges.map((e: unknown) => [
          String((e as { id?: unknown }).id ?? ""),
          e,
        ]),
      );
      const upsertEdges = (applied.createdEdgeIds ?? [])
        .map((id: string) => edgeMap.get(id))
        .filter(Boolean);
      const broadcast: Record<string, unknown> = { revision: savedRevision };
      if (upserted) broadcast.upsertNodes = [upserted];
      if (upsertEdges.length) broadcast.upsertEdges = upsertEdges;
      if (applied.deletedEdgeIds.length) broadcast.removeEdgeIds = applied.deletedEdgeIds;
      if (Object.keys(broadcast).length) broadcastPatch(chapterId, broadcast, "");
        return {
          stats: applied.stats,
          updatedAt: new Date().toISOString(),
          data: savedFlow,
        };
      }
    });
  }
  const freshRow =
    (devBypass
      ? await getFlowByIdUnsafe(c.env.DB, flowId)
      : await getFlowForOwner(c.env.DB, flowId, requestUserId)) || fallbackRow;
  const current = sanitizeFlowDataForStorage(mapFlowRowToDto(freshRow).data ?? {});
  const patch = buildPatch(current);
  if (!patch) return null;
  const applied = applyPublicFlowGraphPatch({ current, patch: patch as never });
  const nowIso = new Date().toISOString();
  const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
  const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
  if (!nextParsed.success) {
    throw new AppError("Flow patch produced invalid data", {
      status: 500,
      code: "flow_patch_invalid",
      details: { issues: nextParsed.error.issues },
    });
  }
  const nextJson = JSON.stringify(sanitizedNext ?? {});
  const updated = devBypass
    ? await updateFlowByIdUnsafe(c.env.DB, {
        id: flowId,
        name: freshRow.name,
        data: nextJson,
        nowIso,
      })
    : await updateFlow(c.env.DB, {
        id: flowId,
        name: freshRow.name,
        data: nextJson,
        ownerId: requestUserId,
        projectId: freshRow.project_id,
        nowIso,
      });
  if (!updated) {
    throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
  }
  if (freshRow.project_id) {
    const nodeMap = new Map(
      (nextParsed.data.nodes ?? []).map((n: unknown) => [(n as { id?: string }).id, n]),
    );
    const upsertedNode = nodeMap.get(broadcastNodeId);
    // 【治「split 丢边」同款根因】新建边一起广播，防浏览器 autosave 整图 PUT 清掉输入连线。
    const edgeMap = new Map(
      (nextParsed.data.edges ?? []).map((e: unknown) => [
        String((e as { id?: unknown }).id ?? ""),
        e,
      ]),
    );
    const upsertEdges = (applied.createdEdgeIds ?? [])
      .map((id: string) => edgeMap.get(id))
      .filter(Boolean);
    const broadcast: Record<string, unknown> = {};
    if (upsertedNode) broadcast.upsertNodes = [upsertedNode];
    if (upsertEdges.length) broadcast.upsertEdges = upsertEdges;
    if (applied.deletedEdgeIds.length) broadcast.removeEdgeIds = applied.deletedEdgeIds;
    if (Object.keys(broadcast).length) {
      broadcastPatch(freshRow.project_id, broadcast, "");
      applyPatchToFlowYDoc(flowId, broadcast);
    }
  }
  return { stats: applied.stats, updatedAt: updated.updated_at, data: nextParsed.data };
}

function readNonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function readBooleanFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "on";
  }
  return false;
}

type OrchestrationContext = {
  runId: string;
  clipIndex: number;
  clipId: string;
  slotNodeId: string;
};

/**
 * 编排意图探测（阶段 B 的稳定 slot 真相源）：
 * 节点带 clipRunId+clipIndex（编排逐段）或 orchestrated/async 标记时启用确定性编排 slot。
 * 服务端按 runId:clip:index 生成 clipId 与确定性 slot nodeId，**不接受 LLM 随机 nodeId 当 slot**。
 * 返回 null 仅表示非编排单镜；视频任务的返回方式仍由 taskId 决定并默认异步。
 */
function resolveOrchestrationContext(
  nodeData: Record<string, unknown>,
  bodyArgs: Record<string, unknown>,
): OrchestrationContext | null {
  const runId =
    readTrimmedString(nodeData.clipRunId) ||
    readTrimmedString(nodeData.runId) ||
    readTrimmedString(bodyArgs.clipRunId) ||
    readTrimmedString(bodyArgs.runId);
  const clipIndex =
    readNonNegativeInteger(nodeData.clipIndex) ??
    readNonNegativeInteger(bodyArgs.clipIndex);
  const orchestrated =
    readBooleanFlag(nodeData.orchestrated) ||
    readBooleanFlag(bodyArgs.orchestrated) ||
    readBooleanFlag(bodyArgs.async);
  if (!runId || clipIndex == null) {
    // 没有稳定 run/index 就不能做幂等 slot。显式 orchestrated 且有 runId 时按单段 clip0 处理，
    // 否则按非编排单镜处理。
    if (orchestrated && runId && clipIndex == null) {
      const idx = 0; // run 有但 index 缺：当作单段 clip0。
      const clipId = buildClipId(runId, idx);
      return { runId, clipIndex: idx, clipId, slotNodeId: deriveClipNodeId(clipId) };
    }
    return null;
  }
  const clipId = buildClipId(runId, clipIndex);
  return { runId, clipIndex, clipId, slotNodeId: deriveClipNodeId(clipId) };
}

// 幂等命中：把现有 slot 节点原样返回，不新建、不重跑、不改 flow。
function buildReusedResult(args: {
  flowId: string;
  row: FlowRow;
  orch: OrchestrationContext;
  node: { id: string; data: Record<string, unknown> };
  status: "success" | "running";
}): PublicAgentsVideoGenerateToCanvasResult {
  const d = args.node.data;
  return {
    ok: true,
    flowId: args.flowId,
    updatedAt: args.row.updated_at,
    stats: { createdNodes: 0, createdEdges: 0, patchedNodes: 0, appendedArrays: 0 },
    nodeId: args.node.id,
    status: args.status,
    videoUrl: args.status === "success" ? readTrimmedString(d.videoUrl) : "",
    thumbnailUrl: readTrimmedString(d.videoThumbnailUrl) || null,
    vendor: readTrimmedString(d.vendor) || readTrimmedString(d.videoModelVendor),
    taskId: readTrimmedString(d.taskId) || readTrimmedString(d.videoTaskId) || null,
    reused: true,
    clipId: args.orch.clipId,
    clipRunId: args.orch.runId,
    clipIndex: args.orch.clipIndex,
  };
}

function buildDirectWorkflowReusedResult(args: {
  flowId: string;
  row: FlowRow;
  node: { id: string; data: Record<string, unknown> };
  status: "success" | "running";
}): PublicAgentsVideoGenerateToCanvasResult {
  const data = args.node.data;
  return {
    ok: true,
    flowId: args.flowId,
    updatedAt: args.row.updated_at,
    stats: { createdNodes: 0, createdEdges: 0, patchedNodes: 0, appendedArrays: 0 },
    nodeId: args.node.id,
    status: args.status,
    videoUrl: args.status === "success" ? readTrimmedString(data.videoUrl) : "",
    thumbnailUrl: readTrimmedString(data.videoThumbnailUrl) || null,
    vendor: readTrimmedString(data.vendor) || readTrimmedString(data.videoModelVendor),
    taskId: readTrimmedString(data.taskId) || readTrimmedString(data.videoTaskId) || null,
    reused: true,
  };
}

/** 字符串化 JSON 复活：LLM 偶发把对象/数组整体序列化成字符串（实测 node/data 被当字符串发来）。
 *  以 {/[ 开头才尝试 parse，失败原样返回——自然语言 prompt 不受影响。 */
function reviveMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!(s.startsWith("{") || s.startsWith("["))) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

/**
 * 视频节点脚手架确定性补全（对齐 generate-image-to-canvas 的 ensureImageNodeShape）：
 * 节点的 `type` / `position` 是纯机械字段、与创意无关，LLM 常只给 `{data:{...}}`（实测漏 type/position
 * 致 schema 硬拒「Invalid video generate to canvas request」、空转重试）。这里在 schema 解析前补默认：
 * 缺 type → taskNode；缺/非法 position → {x:0,y:0}；并复活被字符串化的 node / node.data，
 * 让 agent 只需传创意字段（kind/prompt/referenceImages 等），骨架由服务端兜底。
 */
export function ensureVideoNodeShape(rawNode: unknown): unknown {
  const node = reviveMaybeJson(rawNode);
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...n };
  if (typeof out.data === "string") out.data = reviveMaybeJson(out.data);
  if (out.type === undefined) out.type = "taskNode";
  const pos = out.position as Record<string, unknown> | undefined;
  const hasValidPos =
    !!pos &&
    typeof pos === "object" &&
    Number.isFinite(Number((pos as Record<string, unknown>).x)) &&
    Number.isFinite(Number((pos as Record<string, unknown>).y));
  if (!hasValidPos) out.position = { x: 0, y: 0 };
  return out;
}

// ==================== 散跑（单镜快线）承接契约 ====================
// 2026-07-17 用户拍板：run 路径有 chainFromPrev/exitState 承接，散跑直生此前裸奔——
// 镜1b 裸文字生成不吃镜1a 尾帧，模型把 3 人脑补成 2 人（ch1 实证）。
// 画布上存在「已成片的上游视频镜」连线时，本镜必须带承接锚之一，否则 422 退回给修法。

const CHAINING_PROMPT_MARKER = /【时空】|承接|上一镜|上镜|前情|接上|退出态|exitState/i;

export function findCompletedVideoPredecessor(
	graph: unknown,
	nodeId: string,
): { videoUrl: string; lastFrameUrl: string | null } | null {
	const g = graph && typeof graph === "object" ? (graph as Record<string, unknown>) : {};
	const nodes = Array.isArray(g.nodes) ? (g.nodes as Array<Record<string, unknown>>) : [];
	const edges = Array.isArray(g.edges) ? (g.edges as Array<Record<string, unknown>>) : [];
	for (const edge of edges) {
		if (readTrimmedString(edge.target) !== nodeId) continue;
		const source = nodes.find((n) => readTrimmedString(n.id) === readTrimmedString(edge.source));
		if (!source) continue;
		const d =
			source.data && typeof source.data === "object" && !Array.isArray(source.data)
				? (source.data as Record<string, unknown>)
				: {};
		if (readTrimmedString(d.kind) !== "video") continue;
		const videoUrl = readTrimmedString(d.videoUrl);
		if (!videoUrl) continue;
		return { videoUrl, lastFrameUrl: readTrimmedString(d.lastFrameUrl) || null };
	}
	return null;
}

export function assessFreestyleClipChaining(input: {
	prompt: string;
	referenceImages: string[];
	nodeData: Record<string, unknown>;
	upstream: { videoUrl: string; lastFrameUrl: string | null } | null;
}): { ok: true } | { ok: false; reason: string } {
	if (!input.upstream) return { ok: true };
	if (input.nodeData.standaloneShot === true) return { ok: true };
	if (readTrimmedString(input.nodeData.firstFrameUrl)) return { ok: true };
	if (
		input.upstream.lastFrameUrl &&
		input.referenceImages.some((u) => readTrimmedString(u) === input.upstream!.lastFrameUrl)
	) {
		return { ok: true };
	}
	if (CHAINING_PROMPT_MARKER.test(input.prompt)) return { ok: true };
	return {
		ok: false,
		reason:
			"本镜连线自已成片的上游视频镜，但缺承接锚——裸文字续镜会让模型脑补人数/站位（镜1b 实证）。" +
			"四选一后重交：① tapcanvas_video_extract_last_frame 抽上游尾帧并加入 referenceImages（尾帧钉，最稳）；" +
			"② node.data.firstFrameUrl 设真首帧；③ 提示词写【时空】承接段（进入态=上镜退出态）；" +
			"④ 确为独立时空则 node.data.standaloneShot:true 显式声明。",
	};
}

export async function generateVideoToCanvas(input: {
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
}): Promise<PublicAgentsVideoGenerateToCanvasResult> {
  // 脚手架确定性补全：解析前给 node 补 type/position、复活字符串化 node/data（见 ensureVideoNodeShape）。
  const normalizedBodyArgs =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? {
          ...(input.bodyArgs as Record<string, unknown>),
          node: ensureVideoNodeShape((input.bodyArgs as Record<string, unknown>).node),
        }
      : input.bodyArgs;
  const parsedArgs = PublicAgentsVideoGenerateToCanvasArgsSchema.safeParse(normalizedBodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid video generate to canvas request", {
      status: 400,
      code: "invalid_video_generate_to_canvas_request",
      details: { issues: parsedArgs.error.issues },
    });
  }

  const taskNode = parsedArgs.data.node;
  const nodeData = taskNode.data as Record<string, unknown>;
  let referenceAudioRequired = nodeData.referenceAudioRequired === true;
  const referenceAudioExplicitlyOptional = nodeData.referenceAudioRequired === false;
  const workflowEffectId = readTrimmedString(nodeData.workflowEffectId);
  const referenceAudioDisabled = nodeData.referenceAudioMode === "disabled";
  if (referenceAudioDisabled) {
    delete nodeData.voiceBinding;
    delete nodeData.referenceAudioUrls;
  }
  const rawBodyArgs =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  // 结构化对白的最后一道投影必须在真正提交供应商前闭合。编排器通常会提前把
  // voiceBinding 放进 videoData，但恢复、进程重启或旧 production-plan 回放时，
  // 这个临时字段可能不在重建出的 nodeData 里；不能因此丢掉对白音色，也不能把
  // 同一 clip 降级成默认声线。这里只读取已冻结的 speakerName 与真实 voice_card，
  // 不从 prompt 猜角色，不改写对白正文。
  const structuredSpeech = readStructuredSpeechEvents(nodeData);
  if (structuredSpeech.issues.length > 0) {
    throw new AppError(
      structuredSpeech.issues.map((issue) => `${issue.path}:${issue.problem}`).join("；"),
      {
        status: 422,
        code: "speaker_contract_invalid",
        details: { upstreamRequestAttempted: false, issues: structuredSpeech.issues },
      },
    );
  }
  if (
    structuredSpeech.speechEvents.length > 0 &&
    referenceAudioDisabled &&
    !referenceAudioExplicitlyOptional
  ) {
    throw new AppError("包含冻结 SpeechEvent 的视频节点不得禁用 VoiceManifest", {
      status: 422,
      code: "speaker_voice_manifest_mismatch",
      details: {
        upstreamRequestAttempted: false,
        speakerNames: [...new Set(structuredSpeech.speechEvents.map((event) => event.speakerName))],
      },
    });
  }
  if (
    workflowEffectId &&
    structuredSpeech.speechEvents.length > 0 &&
    !referenceAudioExplicitlyOptional
  ) {
    referenceAudioRequired = true;
    nodeData.referenceAudioRequired = true;
    const frozenBindings = Array.isArray(nodeData.voiceBinding)
      ? nodeData.voiceBinding.filter(
          (binding): binding is Record<string, unknown> => Boolean(binding) && typeof binding === "object" && !Array.isArray(binding),
        )
      : [];
    const frozenBySpeaker = new Map(frozenBindings.map((binding) => [readTrimmedString(binding.character), binding] as const));
    const frozenAudioUrls = [...new Set(structuredSpeech.speechEvents.map((event) => {
      const binding = frozenBySpeaker.get(event.speakerName);
      const voiceId = readTrimmedString(binding?.voiceId);
      const audioUrl = readTrimmedString(binding?.audioUrl);
      if (!binding || !voiceId || !/^https?:\/\//i.test(audioUrl)) {
        throw new AppError(`说话人「${event.speakerName}」缺少 production-handoff 冻结的 VoiceManifest`, {
          status: 422,
          code: "speaker_voice_manifest_mismatch",
          details: { upstreamRequestAttempted: false, speakerName: event.speakerName },
        });
      }
      return audioUrl;
    }))];
    nodeData.referenceAudioUrls = frozenAudioUrls;
  }
  if (
    structuredSpeech.speechEvents.length > 0 &&
    !referenceAudioDisabled &&
    !workflowEffectId &&
    !referenceAudioExplicitlyOptional
  ) {
    referenceAudioRequired = true;
    nodeData.referenceAudioRequired = true;
    const frozenBindings = Array.isArray(nodeData.voiceBinding)
      ? nodeData.voiceBinding.filter(
          (binding): binding is Record<string, unknown> =>
            Boolean(binding) && typeof binding === "object" && !Array.isArray(binding),
        )
      : [];
    const frozenBySpeaker = new Map(
      frozenBindings.map((binding) => [readTrimmedString(binding.character), binding] as const),
    );
    nodeData.referenceAudioUrls = [...new Set(structuredSpeech.speechEvents.map((event) => {
      const binding = frozenBySpeaker.get(event.speakerName);
      const voiceId = readTrimmedString(binding?.voiceId);
      const audioUrl = readTrimmedString(binding?.audioUrl);
      if (!binding || !voiceId || !/^https?:\/\//i.test(audioUrl)) {
        throw new AppError(`说话人「${event.speakerName}」缺少上游冻结的 VoiceManifest`, {
          status: 422,
          code: "speaker_voice_manifest_mismatch",
          details: {
            upstreamRequestAttempted: false,
            speakerName: event.speakerName,
            requiredAction: "complete_voice_plan_and_materialization",
          },
        });
      }
      return audioUrl;
    }))];
  }

  const requestedWorkflowNodeId = readTrimmedString(taskNode.id);
  if (workflowEffectId) {
    if (!requestedWorkflowNodeId) {
      throw new AppError("Workflow video effect requires a stable node id", {
        status: 400,
        code: "workflow_video_node_id_required",
      });
    }
    const freshRow = await freshReadFlowRow({
      c: input.c,
      flowId: input.flowId,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    });
    const existing = findFlowNode(freshRow, requestedWorkflowNodeId);
    if (existing) {
      const persistedEffectId = readTrimmedString(existing.data.workflowEffectId);
      if (persistedEffectId !== workflowEffectId) {
        throw new AppError("Workflow video node identity collides with another effect", {
          status: 409,
          code: "workflow_video_effect_identity_conflict",
          details: { nodeId: requestedWorkflowNodeId, workflowEffectId, persistedEffectId },
        });
      }
      const replay = resolveWorkflowVideoEffectReplay(existing.data);
      if (replay.action === "reuse_success") {
        return buildDirectWorkflowReusedResult({ flowId: input.flowId, row: freshRow, node: existing, status: "success" });
      }
      if (replay.action === "reuse_running") {
        return buildDirectWorkflowReusedResult({ flowId: input.flowId, row: freshRow, node: existing, status: "running" });
      }
      if (replay.action === "reject_uncertain") {
        throw new AppError("工作流视频提交结果未知，已阻止重复供应商请求", {
          status: 409,
          code: "workflow_video_submission_uncertain",
          details: {
            nodeId: requestedWorkflowNodeId,
            workflowEffectId,
            reason: replay.reason,
            upstreamRequestAttempted: false,
          },
        });
      }
      if (replay.action === "reject_terminal") {
        throw new AppError("工作流视频已终态失败；新的供应商提交必须由新的显式执行发起", {
          status: 409,
          code: "workflow_video_effect_terminal",
          details: {
            nodeId: requestedWorkflowNodeId,
            workflowEffectId,
            reason: replay.reason,
            upstreamRequestAttempted: false,
          },
        });
      }
    }
    input.row = freshRow;
  }

  // ============================ 阶段 A/B/C：编排路径前置 ============================
  // 探测编排意图。非编排单镜 (orch == null) 仍使用普通节点 id；编排镜使用确定性 slot，
  // 让 orchestrator 能按 clipRunId/clipIndex 追踪章节或 flow 内的 clip、re-drive 不重复生成。
  const orch = resolveOrchestrationContext(nodeData, rawBodyArgs);
  if (orch) {
    // —— 阶段 B：幂等防重。重读最新 flow，按确定性 slot 查现有节点。
    const freshRow = await freshReadFlowRow({
      c: input.c,
      flowId: input.flowId,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    });
    const existing = findFlowNode(freshRow, orch.slotNodeId);
    if (existing) {
      const status = readTrimmedString(existing.data.status).toLowerCase();
      if (status === "success") {
        // 已成片 → 直接返回现有节点，禁止新建/重跑。
        return buildReusedResult({
          flowId: input.flowId,
          row: freshRow,
          orch,
          node: existing,
          status: "success",
        });
      }
      if (status === "running" || status === "queued" || status === "submitted") {
        // 仍在跑 → 直接返回现有节点，禁止新建 -rerun。fetch failed 后应先 reconcile，
        // reconcile 把它推进到 success/failed 后幂等层再命中；绝不重跑。
        return buildReusedResult({
          flowId: input.flowId,
          row: freshRow,
          orch,
          node: existing,
          status: "running",
        });
      }
      // status === "failed"（或未知）→ 允许重试，复用同一 slot nodeId，attempt+1。
    }

    // 串行续写依赖由 orchestrator 的 expectedPrevClipIndex / chainFromPrev 调度。
    // 进入本 handler 时，显式续写镜已携带 sourceVideoUrl/sourcePrevTaskId；未标续写的
    // clipIndex>0 是合法独立并发镜，禁止在这里擅自等待紧邻上一镜。

    // 用确定性 slot 覆盖 LLM 可能传的随机 id，作为本段唯一 slot；写入幂等元数据。
    (taskNode as Record<string, unknown>).id = orch.slotNodeId;
    nodeData.clipRunId = orch.runId;
    nodeData.clipIndex = orch.clipIndex;
    nodeData.clipId = orch.clipId;
    const prevAttempt = existing
      ? readNonNegativeInteger(existing.data.clipAttempt) ?? 0
      : 0;
    nodeData.clipAttempt = existing ? prevAttempt + 1 : 0;
    // 用最新 row 继续后续构建（fresh-read 防覆盖）。
    input.row = freshRow;
  }
  // ========================== 编排前置结束（orch 为真时） ==========================

  const parentId = readTrimmedString((taskNode as Record<string, unknown>).parentId);

  let prompt = readTrimmedString(nodeData.prompt);
  // 注：clip 提示词「去污染」（剥冗余英文一致性套话 + 空泛 hype 词）在发往 new-api 的唯一上游
  // runTaskViaNewApi 静默执行（与 video-prompt-hygiene 同处，覆盖编排/手动所有路径），此处不重复处理。
  let negativePrompt = readTrimmedString(nodeData.negativePrompt);
  const modelAlias = readTrimmedString(nodeData.modelAlias);
  // Group-pinned model (deterministic) wins over the per-node LLM-set value so every shot in
  // one orchestration shares the same model — same precedence as groupVideoAspect below.
  const groupVideoModel = resolveGroupVideoModel(input.row, parentId);
  const modelKey =
    groupVideoModel ||
    readTrimmedString(nodeData.modelKey) ||
    readTrimmedString(nodeData.videoModel);
  // Group-pinned aspect (deterministic) wins over the per-node LLM-set value so
  // every shot in one orchestration shares the same orientation/ratio.
  const groupVideoAspect = resolveGroupVideoAspect(input.row, parentId);
  const aspectRatio =
    groupVideoAspect ||
    readTrimmedString(nodeData.aspectRatio) ||
    readTrimmedString(nodeData.aspect);
  const size =
    readTrimmedString(nodeData.videoSize) || readTrimmedString(nodeData.size);
  const resolution = normalizeVideoResolution(
    nodeData.videoResolution ?? nodeData.resolution,
  );
  const orientation = readTrimmedString(nodeData.orientation);
  const rawDurationSeconds =
    normalizePositiveInteger(nodeData.durationSeconds) ??
    normalizePositiveInteger(nodeData.videoDurationSeconds);
  // 付费提交边界只接受所选模型实时目录（或编排已冻结合同）声明的精确档位。
  // 禁止把 30s 静默钳成历史固定的 15s，也禁止把非法值改写成另一个付费请求。
  let durationSeconds = await resolveSubmissionDurationSeconds({
    c: input.c,
    modelKey,
    requestedDurationSeconds: rawDurationSeconds,
    generationContract: nodeData.generationContract,
  });
  // pixverse「首尾帧过渡」模式特例：供应商只接受 5 或 8 秒。非法值必须原地失败，
  // 不能静默 snap 成另一笔规格不同的付费请求。
  if (durationSeconds != null && /pixverse/i.test(modelKey)) {
    const hasFramePair =
      !!(readTrimmedString(nodeData.firstFrameUrl) || readTrimmedString(nodeData.veoFirstFrameUrl)) &&
      !!(readTrimmedString(nodeData.lastFrameUrl) || readTrimmedString(nodeData.veoLastFrameUrl));
    if (hasFramePair && durationSeconds !== 5 && durationSeconds !== 8) {
      throw new AppError("PixVerse 首尾帧过渡只支持 5 秒或 8 秒", {
        status: 400,
        code: "pixverse_frame_pair_duration_not_supported",
        details: { modelKey, requestedDurationSeconds: durationSeconds, durationOptions: [5, 8] },
      });
    }
  }
  const specKey =
    readTrimmedString(nodeData.videoSpecKey) ||
    readTrimmedString(nodeData.specKey) ||
    buildVideoBillingSpecKey(resolution, durationSeconds ?? null);
  let firstFrameUrl =
    readTrimmedString(nodeData.firstFrameUrl) ||
    readTrimmedString(nodeData.veoFirstFrameUrl);
  let lastFrameUrl =
    readTrimmedString(nodeData.lastFrameUrl) ||
    readTrimmedString(nodeData.veoLastFrameUrl);
  // 上一镜成片视频 URL：作统一的「视频续写」输入（→ extras.upstreamVideoUrl → task.service 分支3
  // metadata.content[{type:"video_url"}]）。这是 hono→new-api 的统一参数；各渠道续写格式由
  // new-api adaptor 自行闭环（doubao 补 reference_video role 发 ARK；apimart 转各自续写参数），
  // hono 不区分模型、不拼渠道私货。让本镜在上一镜运动惯性上续演 → 镜间连续，消除「从静止重启」顿挫。
  let sourceVideoUrl =
    readTrimmedString(nodeData.sourceVideoUrl) ||
    readTrimmedString(nodeData.upstreamVideoUrl);
  const referenceVideoDurationSeconds = normalizePositiveInteger(
    nodeData.referenceVideoDurationSeconds,
  );
  if (
    sourceVideoUrl &&
    /seedance[-_.]?2(?:[-_.]|$)/i.test(modelKey) &&
    referenceVideoDurationSeconds == null
  ) {
    throw new AppError("参考视频时长缺失，无法计算 SD2 视频积分消耗", {
      status: 400,
      code: "reference_video_duration_required_for_pricing",
      details: { modelKey, sourceVideoUrl },
    });
  }
  // 上一镜的上游任务 id（上一镜视频节点的 data.taskId，本身就是上游 apimart/ARK task_id）。
  // 通用「上一镜引用」参数：某些渠道的续写要 task_id 而非 URL（pixverse 官方 extend_from_task_id）。
  // hono 统一发 → new-api 各渠道挑用：doubao 用 sourceVideoUrl(content video_url)，apimart pixverse 用此 task_id。
  let sourcePrevTaskId =
    readTrimmedString(nodeData.sourcePrevTaskId) ||
    readTrimmedString(nodeData.prevTaskId);
  // kling-v3-omni「参考视频用途」：feature=动作迁移（sourceVideoUrl 只供动作/运镜，
  // 新主体来自参考图）、base=底片重绘。非 omni 模型 task.service 不会注入，这里原样透传。
  const videoReferType = readTrimmedString(nodeData.videoReferType);
  const keepOriginalSound = readTrimmedString(nodeData.keepOriginalSound);
  const legacySystemStyleUrls = new Set(
    (Array.isArray(nodeData.referenceImageBindings) ? nodeData.referenceImageBindings : [])
      .filter((binding) => binding && typeof binding === "object" && !Array.isArray(binding))
      .filter((binding) => (binding as Record<string, unknown>).systemStyle === true)
      .map((binding) => readTrimmedString((binding as Record<string, unknown>).url))
      .filter(Boolean),
  );
  let referenceImages = normalizeStringList(nodeData.referenceImages).filter(
    (url) => !legacySystemStyleUrls.has(url),
  );
  const isOrchestratedClip = Boolean(readTrimmedString(nodeData.clipRunId));
  const usesStructuredClipPrompt = isOrchestratedClip || Boolean(
    readTrimmedString(nodeData.workflowExecutionId) &&
    Array.isArray(nodeData.shots) &&
    nodeData.shots.length > 0,
  );
  const declaredReferenceBindings = normalizeVideoReferenceImageBindings(
    nodeData.referenceImageBindings,
  ).filter((binding) => !legacySystemStyleUrls.has(binding.url));
  const canvasReferenceBindings = resolveCanvasReferenceBindings(input.row);
  const referenceBindingByUrl = new Map<string, VideoReferenceImageBinding>();
  const mergeReferenceBinding = (binding: VideoReferenceImageBinding): void => {
    const [merged] = mergeVideoReferenceImageBindings([
      ...(referenceBindingByUrl.get(binding.url)
        ? [referenceBindingByUrl.get(binding.url)!]
        : []),
      binding,
    ]);
    if (merged) referenceBindingByUrl.set(binding.url, merged);
  };
  for (const binding of declaredReferenceBindings) {
    mergeReferenceBinding(binding);
  }
  // An orchestrated clip carries an immutable, per-clip reference contract from
  // video-orchestrator. Do not merge provenance from every other canvas node
  // that happens to reuse the same URL: that widens sourceNodeIds after the
  // contract was frozen and makes the paid-boundary delivery verifier reject a
  // valid clip as an unexpected-node mismatch. Non-orchestrated/manual video
  // generation keeps the canvas-wide binding behavior.
  if (!usesStructuredClipPrompt) {
    for (const url of referenceImages) {
      const canvas = canvasReferenceBindings.get(url);
      if (canvas) mergeReferenceBinding({ ...canvas, url });
    }
  }
  const resolvedIdReferences = await resolveExecutionImageReferences({
    c: input.c,
    ownerId: input.requestUserId,
    row: input.row,
    nodeIds: readTrimmedString(nodeData.clipRunId)
      ? nodeData.videoReferenceNodeIds
      : nodeData.referenceImageNodeIds,
    assetIds: nodeData.referenceAssetIds,
  });
  if (resolvedIdReferences.length > 0) {
    const resolvedUrls = resolvedIdReferences.map((reference) => reference.url);
    // 编排 clip 的 content[] 顺序是确定性合同：storyboard/frame → business refs。
    // orchestrate 已把 storyboard 放在 referenceImages 首位，业务 node ids 只作为真实 URL
    // 解析证据补入；最终 renderer 会按这份真实 manifest 生成 @图N。手工节点保留旧的
    // “显式 id 优先”顺序，不影响非编排调用。
    referenceImages = usesStructuredClipPrompt
      ? [...new Set([...referenceImages, ...resolvedUrls])]
      : [...new Set([...resolvedUrls, ...referenceImages])];
    for (const reference of resolvedIdReferences) {
      mergeReferenceBinding({
        url: reference.url,
        label: reference.name,
        purpose: "other",
        purposes: ["other"],
        sourceNodeIds: reference.nodeId ? [reference.nodeId] : [],
      });
    }
  }
  // 资产合同不是只供 authoring 阶段阅读的说明文字：它必须随 clip 一直落到最终
  // reference manifest。按 nodeId 绑定当前真实 URL，修复图片任务完成后 URL 变化、
  // 旧 binding 只有泛化 label、以及 direct generate 只传 videoReferenceNodeIds 的情况。
  hydrateReferenceBindingsFromAssetContracts({
    contracts: readAssetObjectIdentityContracts(nodeData.assetObjectContracts),
    resolvedReferences: resolvedIdReferences,
    bindings: referenceBindingByUrl,
    merge: mergeReferenceBinding,
  });
  const rewriteStalePresigned = (u: string): string => {
    try {
      const cfg = resolveObjectStorageConfig(input.c.env);
      if (!cfg?.publicBase) return u;
      const key = extractObjectStorageObjectKey(cfg, u);
      return key ? `${cfg.publicBase.replace(/\/+$/, "")}/${key}` : u;
    } catch {
      return u;
    }
  };
  // 重制/续跑可能复用已过期的 TOS presigned URL。若 URL 确属当前
  // bucket，则换回稳定公开地址；非本桶或解析失败保持原值。
  {
    const rewriteBoundReferenceUrl = (url: string): string => {
      const rewritten = rewriteStalePresigned(url);
      const binding = referenceBindingByUrl.get(url);
      if (binding && rewritten !== url) {
        referenceBindingByUrl.delete(url);
        mergeReferenceBinding({ ...binding, url: rewritten });
      }
      return rewritten;
    };
    referenceImages = referenceImages.map(rewriteBoundReferenceUrl);
    if (firstFrameUrl) firstFrameUrl = rewriteBoundReferenceUrl(firstFrameUrl);
    if (lastFrameUrl) lastFrameUrl = rewriteBoundReferenceUrl(lastFrameUrl);
  }
  // 【原生对白音频】orchestrate 用配音卡(豆包语音1.0)逐镜合成的台词音频，作 seedance 2.0 的
  // audio_url content 输入（≤3 条 MP3）→ 上游音画联合生成+对口型。仅 http(s) 外链有效。
  let referenceAudioUrls = normalizeStringList(nodeData.referenceAudioUrls)
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 3);
  // 参考图净化：LLM 会幻觉编造参考图 URL（曾编 static.beqlee.com 死域名→pixverse 下载失败 no such host；
  // 又见 static.tapcanvas.com/user-assets/*.png → apimart download 404）。用真实图节点的 host 作可信集，
  // 把不可信 host 的 firstFrame/referenceImages 替换成真图。优先用 group 内图；clip 节点没带 parentId
  // 导致 group 查空时，回退扫全 flow 的图片节点（否则净化被整段跳过、幻觉链直达上游 404）。
  const groupImageUrls = resolveGroupImageUrls(input.row, parentId);
  const truthImageUrls = groupImageUrls.length > 0 ? groupImageUrls : resolveFlowImageUrls(input.row);
  if (!usesStructuredClipPrompt && truthImageUrls.length > 0) {
    const trustedHosts = new Set(truthImageUrls.map((u) => safeHost(u)).filter(Boolean));
    // 我们自己生成并上传到对象存储的图（尾帧链抽出的尾帧、gpt-image-2 关键帧/三视图/场景图）host = TOS publicBase，
    // 它通常不同于外部参考图 host。若不把自有存储域名加入可信集，
    // 合法尾帧/关键帧会被当成 LLM 幻觉死链 → 替换成组内首图 fallback → 各镜首帧雷同（画面重复）+ 尾帧链失效（镜间不连贯）。
    const selfStorageHost = (() => {
      try {
        const cfg = resolveObjectStorageConfig(input.c.env);
        return cfg ? safeHost(cfg.publicBase) : "";
      } catch {
        return "";
      }
    })();
    if (selfStorageHost) trustedHosts.add(selfStorageHost);
    const fallback = truthImageUrls[0];
    const isTrusted = (u: string) => {
      const h = safeHost(u);
      return !!h && trustedHosts.has(h);
    };
    // 仅当 firstFrame 完全没有可解析的 host 时才 fallback（防纯幻觉空 URL）。
    // 有合法 host 的 URL 一律保留原值，不做替换——编排器经 presignVideoFrameUrlsForArk
    // 转出的 presigned URL 等合法来源若被替换成 fallback，会改变真实参考合同；最终 renderer
    // 虽能重算 @图N，也不能把被错误替换掉的资产身份补回来。
    if (firstFrameUrl && !safeHost(firstFrameUrl)) firstFrameUrl = fallback;
    // referenceImages：过滤掉无法解析 host 的幻觉 URL，保留其余所有合法 URL（含 presigned）。
    const filteredRefs = referenceImages.filter((u) => !!safeHost(u));
    referenceImages = Array.from(new Set(filteredRefs.length > 0 ? filteredRefs : [fallback]));
  }
  // 章节非身份锚自动绑定：这里只保留道具卡；角色/场景通过结构化 ID 显式绑定。
  if (input.chapterId && !usesStructuredClipPrompt) {
    const abFlag = String(
      (input.c.env as Record<string, unknown>)?.CHAPTER_ANCHOR_AUTOBIND ??
        globalThis.process?.env?.CHAPTER_ANCHOR_AUTOBIND ??
        "on",
    )
      .trim()
      .toLowerCase();
    if (abFlag !== "0" && abFlag !== "false" && abFlag !== "off") {
      const lockedAnchors = readLockedAnchors(nodeData);
      if (lockedAnchors && (lockedAnchors.prop?.length ?? 0) > 0) {
        const selection = selectAnchorReferenceImages(resolveFlowNodes(input.row), lockedAnchors);
        const videoSelection = { ...selection, styleAnchorUrl: null };
        const declaredCount = referenceImages.length +
          (selection.propUrls ?? []).length;
        const { merged, injected } = mergeAnchorReferences(referenceImages, videoSelection, {
          maxRefs: Math.max(2, declaredCount),
        });
        referenceImages = merged;
        const purposeByUrl = new Map<string, VideoReferencePurpose>();
        for (const url of selection.propUrls ?? []) purposeByUrl.set(url, "prop");
        for (const url of injected) {
          const canvas = canvasReferenceBindings.get(url);
          const purpose = purposeByUrl.get(url) || canvas?.purpose || "other";
          mergeReferenceBinding({
            url,
            label: canvas?.label || "章节自动补绑参考图",
            purpose,
            purposes: [purpose],
            sourceNodeIds: canvas?.sourceNodeIds ?? [],
          });
        }
        if (injected.length > 0) {
          console.log(
            `[chapter-anchor-autobind] chapter=${input.chapterId} injected=${injected.length} ` +
              `(props=${(selection.propUrls ?? []).length})`,
          );
        }
      }
    }
  }
  // 世界书统一注入（灰度 flag WORLD_INFO_INJECT，默认 OFF；OFF 时整块跳过，prompt/negativePrompt/
  // referenceImages 与改动前完全一致）。ON：按镜命中素材库锁定文+参考图，锁定文压尾(recency)。
  // 设计见 docs/design/world-info-injection-engine.md
  {
    const wiFlag = String(
      (input.c.env as Record<string, unknown>)?.WORLD_INFO_INJECT ??
        globalThis.process?.env?.WORLD_INFO_INJECT ??
        "",
    )
      .trim()
      .toLowerCase();
    if (
      (wiFlag === "1" || wiFlag === "true" || wiFlag === "on") &&
      input.row.project_id &&
      !usesStructuredClipPrompt
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
        if (resolved.negativePrompt) {
          negativePrompt = [negativePrompt, resolved.negativePrompt].filter(Boolean).join(", ");
        }
        const wiRefs = resolved.referenceImages.map((reference) => reference.url).filter(Boolean);
        if (wiRefs.length) {
          referenceImages = Array.from(new Set([...referenceImages, ...wiRefs]));
          for (const reference of resolved.referenceImages) {
            const purpose = referencePurposeFromStructuredRole(reference.role);
            mergeReferenceBinding({
              url: reference.url,
              label: reference.label,
              purpose,
              purposes: [purpose],
              sourceNodeIds: [],
            });
          }
        }
      } catch {
        // 世界书加载/注入异常 → 降级用原提示词，不阻断生成
      }
    }
  }
  const referenceAudioLabels = Array.isArray(nodeData.voiceBinding)
    ? nodeData.voiceBinding.map((binding) => {
        if (!binding || typeof binding !== "object" || Array.isArray(binding)) return "";
        const character = readTrimmedString((binding as Record<string, unknown>).character);
        return character ? `${character}的音色参考` : "";
      })
    : [];
  const finalReferenceBindings = referenceImages.map((url) => {
    const binding = referenceBindingByUrl.get(url) || canvasReferenceBindings.get(url);
    return binding
      ? { ...binding, url }
      : {
          url,
          label: "参考图",
          purpose: "other" as const,
          purposes: ["other" as const],
          sourceNodeIds: [],
        };
  });
  let candidateReferenceMediaManifest = buildVideoReferenceMediaManifest({
    referenceImages,
    referenceBindings: [
      ...referenceBindingByUrl.values(),
      ...finalReferenceBindings.filter(
        (binding) => !referenceBindingByUrl.has(binding.url),
      ),
    ],
    firstFrameUrl,
    lastFrameUrl,
    referenceAudioUrls,
    referenceAudioLabels,
  });
  if (
    /seedance/i.test(modelKey) &&
    candidateReferenceMediaManifest.audios.length > 0 &&
    candidateReferenceMediaManifest.images.length === 0 &&
    !sourceVideoUrl
  ) {
    let supportsAudioOnlyReference: boolean;
    try {
      supportsAudioOnlyReference = await resolveVideoModelAudioOnlyReferenceSupport({
        c: input.c,
        videoModel: modelKey,
      });
    } catch (error) {
      if (referenceAudioRequired) {
        throw new AppError("无法确认当前视频模型是否支持仅音频参考", {
          status: 409,
          code: "video_model_audio_only_reference_capability_unavailable",
          details: {
            modelKey,
            upstreamRequestAttempted: false,
            cause: error instanceof Error ? error.message : String(error),
          },
        });
      }
      supportsAudioOnlyReference = false;
      nodeData.audioDegradation = {
        code: "audio_only_reference_capability_unavailable",
        message: "当前运行时目录未能证明模型支持仅音频参考；已移除可选音色参考，保留原生音频生成",
        releasedToVisualProduction: true,
      };
    }
    if (!supportsAudioOnlyReference) {
      if (referenceAudioRequired) {
        throw new AppError("当前视频模型不接受仅音频参考，必须同时提供真实图片或视频参考", {
          status: 422,
          code: "speaker_reference_audio_requires_visual_reference",
          details: { modelKey, upstreamRequestAttempted: false },
        });
      }
      referenceAudioUrls = [];
      delete nodeData.voiceBinding;
      delete nodeData.referenceAudioUrls;
      nodeData.referenceAudioMode = "disabled";
      nodeData.audioDegradation ??= {
        code: "audio_only_reference_unsupported",
        message: "当前模型不接受仅音频参考；已移除可选音色参考，保留原生音频生成",
        releasedToVisualProduction: true,
      };
      candidateReferenceMediaManifest = {
        ...candidateReferenceMediaManifest,
        audios: [],
      };
      console.warn(
        `[video-audio-degraded] model=${modelKey} rejects audio-only reference topology; optional voice reference removed before provider submission`,
      );
    }
  }
  const referenceModeSelection = /seedance/i.test(modelKey)
    ? selectSeedanceReferenceMode(candidateReferenceMediaManifest, {
        // Seedance consumes the previous clip only through the real video URL.
        // `prevTaskId` is a channel-specific continuation identity for other
        // providers and must not be counted as a visual reference here.
        hasReferenceVideo: Boolean(sourceVideoUrl),
      })
    : null;
  let referenceMediaManifest = referenceModeSelection?.manifest ?? candidateReferenceMediaManifest;
  // 结构化对白的 speakerName 仍是 canonical 外键，最终供应商正文显示为 manifest
  // 的 @图N；dialogue 正文完全不改。这个转换只读取已验证的 assetName + content[] 顺序，
  // 不做角色名猜测，也不向 prompt 追加映射表。
  if (usesStructuredClipPrompt) {
    if (!Array.isArray(nodeData.shots) || nodeData.shots.length === 0) {
      throw new AppError("编排视频节点缺少冻结的结构化 shots，禁止使用自由文本提示词提交供应商", {
        status: 422,
        code: "structured_video_prompt_source_missing",
        details: { upstreamRequestAttempted: false },
      });
    }
    const assetReferenceIndicesByContractKey = buildFinalAssetReferenceIndices({
      contracts: readAssetObjectIdentityContracts(nodeData.assetObjectContracts),
      images: referenceMediaManifest.images,
    });
    const renderedPrompt = renderClipPromptFromShots(
      nodeData as unknown as StructuredClip,
      undefined,
      {
        assetReferenceIndicesByContractKey,
        voiceReferenceMode: referenceAudioExplicitlyOptional ? "provider_native" : "manifest",
      },
    );
    let voiceBindingInstruction = "";
    if (!referenceAudioExplicitlyOptional) {
      try {
        voiceBindingInstruction = buildVerifiedVoiceBindingInstructionFromManifest({
          voiceBindings: nodeData.voiceBinding,
          manifestAudios: referenceMediaManifest.audios,
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? readTrimmedString((error as { code?: unknown }).code)
          : "speaker_voice_manifest_mismatch";
        throw new AppError(error instanceof Error ? error.message : String(error), {
          status: 422,
          code: code || "speaker_voice_manifest_mismatch",
          details: { upstreamRequestAttempted: false },
        });
      }
    }
    const hasVoicePlaceholder = renderedPrompt.includes(VOICE_REFERENCE_BINDING_PLACEHOLDER);
    if (hasVoicePlaceholder && !voiceBindingInstruction) {
      throw new AppError("结构化人声轨存在对白，但最终参考音频 manifest 缺少音色绑定", {
        status: 422,
        code: "speaker_voice_manifest_mismatch",
        details: { upstreamRequestAttempted: false },
      });
    }
    if (!hasVoicePlaceholder && voiceBindingInstruction) {
      throw new AppError("结构化人声轨为空，但最终请求携带了说话人音色参考", {
        status: 422,
        code: "speaker_voice_manifest_without_dialogue",
        details: { upstreamRequestAttempted: false },
      });
    }
    prompt = hasVoicePlaceholder
      ? bindVerifiedVoiceReferences(renderedPrompt, voiceBindingInstruction)
      : renderedPrompt;
  }
  const frozenGenerationContract = parseVideoGenerationContract(nodeData.generationContract);
  if (nodeData.generationContract !== undefined && !frozenGenerationContract) {
	throw new AppError("视频节点携带的冻结模型合同无效", {
	  status: 422,
	  code: "video_generation_contract_invalid",
	});
  }
  const usesFrozenReferenceBudget = usesStructuredClipPrompt && frozenGenerationContract !== null;
  if (isOrchestratedClip) {
    const referenceDelivery = verifyVideoReferenceDelivery({
      contract: nodeData.referenceDeliveryContract,
      manifest: referenceMediaManifest.images,
    });
    if (!referenceDelivery.ok) {
      console.error(
        "[video-reference-delivery] rejected before upstream submit",
        JSON.stringify({
          clipRunId: readTrimmedString(nodeData.clipRunId) || null,
          clipIndex: readNonNegativeInteger(nodeData.clipIndex),
          code: referenceDelivery.code,
          details: referenceDelivery.details,
        }),
      );
      throw new AppError(referenceDelivery.message, {
        status: 422,
        code: referenceDelivery.code,
        details: {
          ...referenceDelivery.details,
          upstreamRequestAttempted: false,
        },
      });
    }
    nodeData.referenceDeliveryEvidence = referenceDelivery.evidence;

  }
  let seedanceMaximumReferenceImages = referenceModeSelection?.mode === "multimodal_reference" && usesFrozenReferenceBudget
	? frozenGenerationContract.referenceImagePolicy.maximumTotalImages
	: null;
  if (referenceModeSelection?.mode === "multimodal_reference" && !usesFrozenReferenceBudget) {
    try {
      seedanceMaximumReferenceImages = await resolveVideoModelMaximumReferenceImages({
        c: input.c,
        videoModel: modelKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(`当前视频模型缺少引用图片预算合同：${modelKey}`, {
        status: 422,
        code: "video_model_reference_image_policy_missing",
        details: { modelKey, cause: message },
      });
    }
  }
  if (
    seedanceMaximumReferenceImages != null &&
    referenceMediaManifest.images.length > seedanceMaximumReferenceImages
  ) {
    throw new AppError(
      `视频模型多模态参考图数量超过上限：${referenceMediaManifest.images.length} > ${seedanceMaximumReferenceImages}`,
      {
        status: 400,
        code: "video_model_reference_image_limit_exceeded",
        details: {
          modelKey,
          actual: referenceMediaManifest.images.length,
          maximum: seedanceMaximumReferenceImages,
        },
      },
    );
  }
  if (
    referenceModeSelection?.mode === "multimodal_reference" &&
    referenceModeSelection.frameImagesPromotedToReferences > 0
  ) {
    referenceImages = referenceMediaManifest.images.map((image) => image.url);
    referenceAudioUrls = referenceMediaManifest.audios.map((audio) => audio.url);
    firstFrameUrl = "";
    lastFrameUrl = "";
    console.log(
      "[video-reference-mode]",
      JSON.stringify({
        modelKey,
        mode: referenceModeSelection.mode,
        referenceImages: referenceMediaManifest.images.length,
        referenceAudios: referenceMediaManifest.audios.length,
        referenceVideos: Number(Boolean(sourceVideoUrl)),
        frameImagesPromotedToReferences:
          referenceModeSelection.frameImagesPromotedToReferences,
      }),
    );
  }
  if (referenceModeSelection?.mode === "first_last_frame") {
    const omittedReferenceVideos = Number(Boolean(sourceVideoUrl));
    referenceImages = referenceMediaManifest.images
      .filter((image) => image.role === "reference_image")
      .map((image) => image.url);
    referenceAudioUrls = referenceMediaManifest.audios.map((audio) => audio.url);
    sourceVideoUrl = "";
    sourcePrevTaskId = "";
    console.log(
      "[video-reference-mode]",
      JSON.stringify({
        modelKey,
        mode: referenceModeSelection.mode,
        omittedReferenceImages: referenceModeSelection.omittedReferenceImages,
        omittedReferenceAudios: referenceModeSelection.omittedReferenceAudios,
        omittedReferenceVideos,
        frameImagesPromotedToReferences: 0,
      }),
    );
  }
  // 结构化 clip 的图片编号已在上方依据最终 manifest 编译进参考资产锁定；自由文本节点
  // 保持原提示词。提交边界只保留上一镜参考视频的连续性事实，绝不再追加第二套
  // `[参考图绑定] @图N=...` 映射尾块。
  const referenceContinuationNote = renderVideoReferenceContinuationNote(
    readTrimmedString(nodeData.referenceVideoBindingNote),
  );
  prompt = withAuthoritativePromptAnnotation(prompt, referenceContinuationNote);
  const promptDeliveryContract = usesStructuredClipPrompt
    ? buildVideoPromptDeliveryContract({ prompt, negativePrompt })
    : null;
  const promptDeliveryProjection = buildVideoPromptDeliveryProjection({
    prompt,
    negativePrompt,
    contract: promptDeliveryContract,
  });

  const assetInputs = normalizeAssetInputs(nodeData.assetInputs);
  const firstFrameAssetId = readTrimmedString(nodeData.firstFrameAssetId);
  const lastFrameAssetId = readTrimmedString(nodeData.lastFrameAssetId);
  const hasReferenceInputs =
    Boolean(firstFrameUrl) ||
    Boolean(lastFrameUrl) ||
    Boolean(firstFrameAssetId) ||
    Boolean(lastFrameAssetId) ||
    referenceImages.length > 0 ||
    assetInputs.length > 0;
  const taskKind: TaskRequestDto["kind"] = hasReferenceInputs
    ? "image_to_video"
    : "text_to_video";
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
    extras: {
      ...(modelAlias ? { modelAlias } : {}),
      ...(modelKey ? { modelKey } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(size ? { size } : {}),
      ...(resolution ? { resolution } : {}),
      ...(specKey ? { specKey, videoSpecKey: specKey } : {}),
      ...(orientation ? { orientation } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      ...(firstFrameUrl ? { firstFrameUrl } : {}),
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
      ...(sourceVideoUrl ? { upstreamVideoUrl: sourceVideoUrl } : {}),
      ...(referenceVideoDurationSeconds != null
        ? { referenceVideoDurationSeconds }
        : {}),
      ...(sourcePrevTaskId ? { prevTaskId: sourcePrevTaskId } : {}),
      ...(videoReferType ? { videoReferType } : {}),
      ...(keepOriginalSound ? { keepOriginalSound } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
      ...(referenceAudioUrls.length ? { referenceAudioUrls } : {}),
      ...(typeof nodeData.generateAudio === "boolean"
        ? { generateAudio: nodeData.generateAudio }
        : {}),
      ...((referenceMediaManifest.images.length || referenceMediaManifest.audios.length)
        ? { referenceMediaManifest }
        : {}),
      ...(promptDeliveryContract ? { promptDeliveryContract } : {}),
      ...(assetInputs.length ? { assetInputs } : {}),
      ...(firstFrameAssetId ? { firstFrameAssetId } : {}),
      ...(lastFrameAssetId ? { lastFrameAssetId } : {}),
      ...(generationContext ? { generationContext } : {}),
      persistAssets: true,
    },
  };

  // 编排 clip 的计费边界先落 durable intent，再触发供应商请求。进程若在两步之间崩溃，
  // 恢复器会看到 pending intent 并 fail-closed；绝不能把“画布上暂时没有 taskId”解释成未付费。
  const submissionArtifact = orch
    ? {
        runId: orch.runId,
        clipIndex: orch.clipIndex,
      }
    : null;
  const submissionRequestHash = submissionArtifact
    ? stableContentHash({
        runId: submissionArtifact.runId,
        clipIndex: submissionArtifact.clipIndex,
        prompt,
        taskKind,
        modelKey,
      })
    : "";
  let productionEffectId = "";
  let productionEffectStatus: ProductionEffectStatus | "persistence_failed" | null = null;
  let productionEffectError = "";
  if (submissionArtifact) {
    const intentAt = new Date().toISOString();
    try {
      const claim = await claimVideoSubmissionIntent({
        runId: submissionArtifact.runId,
        clipIndex: submissionArtifact.clipIndex,
        requestHash: submissionRequestHash,
        slotNodeId: readTrimmedString(taskNode.id),
        attempt: Math.max(0, Math.trunc(Number(nodeData.clipAttempt ?? 0))),
        nowIso: intentAt,
      });
      if (!claim.claimed) {
        const existingPayload = claim.artifact?.payload ? (() => {
          try {
            const parsed: unknown = JSON.parse(claim.artifact.payload);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : {};
          } catch {
            return {};
          }
        })() : {};
        throw new AppError("该视频 clip 已有持久提交意图，禁止重复提交", {
          status: 409,
          code: claim.reason === "submission_identity_uncertain"
            ? "video_submission_identity_uncertain"
            : "video_submission_already_claimed",
          details: {
            runId: submissionArtifact.runId,
            clipIndex: submissionArtifact.clipIndex,
            existingStatus: claim.artifact?.status,
            existingTaskId: existingPayload.taskId,
            claimReason: claim.reason,
          },
        });
      }
      const reserved = await reserveProductionEffect({
        runId: submissionArtifact.runId,
        workflowNodeId: "media-production",
        effectKey: `video-clip:${submissionArtifact.clipIndex}`,
        operation: "video.generate",
        inputHash: submissionRequestHash,
        createdAt: intentAt,
      });
      productionEffectId = reserved.effect.id;
      if (
        reserved.effect.status === "accepted" ||
        reserved.effect.status === "uncertain" ||
        reserved.effect.status === "materialized"
      ) {
        const reconciledAt = new Date().toISOString();
        const reconciled = reserved.effect.providerTaskId
          ? await markVideoSubmissionAccepted({
              runId: submissionArtifact.runId,
              clipIndex: submissionArtifact.clipIndex,
              requestHash: submissionRequestHash,
              taskId: reserved.effect.providerTaskId,
              vendor: reserved.effect.provider ?? "unknown",
              nowIso: reconciledAt,
            })
          : await markVideoSubmissionUncertain({
              runId: submissionArtifact.runId,
              clipIndex: submissionArtifact.clipIndex,
              requestHash: submissionRequestHash,
              errorMessage: "Effect Ledger already contains an upstream identity whose acceptance must be reconciled.",
              nowIso: reconciledAt,
            });
        if (!reconciled) {
          throw new Error(`existing production effect could not reconcile submission intent: ${reserved.effect.id}`);
        }
        throw new AppError("同一视频副作用已经受理或状态未知，本次未重复请求供应商", {
          status: 409,
          code: "video_effect_identity_already_exists",
          details: {
            runId: submissionArtifact.runId,
            clipIndex: submissionArtifact.clipIndex,
            effectId: reserved.effect.id,
            effectStatus: reserved.effect.status,
            providerTaskId: reserved.effect.providerTaskId,
            upstreamRequestAttempted: false,
          },
        });
      }
      const submitting = await transitionProductionEffect({
        effectId: productionEffectId,
        toStatus: "submitting",
        updatedAt: intentAt,
      });
      productionEffectId = submitting.effect.id;
      productionEffectStatus = submitting.effect.status;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      let submissionIntentClosed = false;
      let submissionIntentCloseError = "";
      try {
        submissionIntentClosed = await markVideoSubmissionPreUpstreamRejected({
          runId: submissionArtifact.runId,
          clipIndex: submissionArtifact.clipIndex,
          requestHash: submissionRequestHash,
          errorMessage: message,
          errorCode: "production_effect_reserve_failed",
          nowIso: new Date().toISOString(),
        });
      } catch (closeError) {
        submissionIntentCloseError = closeError instanceof Error ? closeError.message : String(closeError);
      }
      let productionEffectClosed: boolean | null = null;
      let productionEffectCloseError = "";
      if (productionEffectId) {
        try {
          const closedEffect = await transitionProductionEffect({
            effectId: productionEffectId,
            toStatus: "rejected_pre_upstream",
            updatedAt: new Date().toISOString(),
            errorCode: "production_effect_reserve_failed",
            errorMessage: message,
          });
          productionEffectClosed = closedEffect.effect.status === "rejected_pre_upstream";
        } catch (closeError) {
          productionEffectClosed = false;
          productionEffectCloseError = closeError instanceof Error ? closeError.message : String(closeError);
        }
      }
      throw new AppError("视频提交意图落库失败，已阻止供应商调用", {
        status: 503,
        code: "video_submission_intent_persist_failed",
        details: {
          runId: submissionArtifact.runId,
          clipIndex: submissionArtifact.clipIndex,
          cause: message,
          submissionIntentClosed,
          submissionIntentCloseError,
          productionEffectClosed,
          productionEffectCloseError,
        },
      });
    }
  }

  if (submissionArtifact && productionEffectId) {
    try {
      await assertProductionRunAllowsNewEffects(submissionArtifact.runId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const rejectedAt = new Date().toISOString();
      let effectClosureError = "";
      let intentClosureError = "";
      try {
        await transitionProductionEffect({
          effectId: productionEffectId,
          toStatus: "rejected_pre_upstream",
          updatedAt: rejectedAt,
          errorCode: "video_run_rejected_new_effect",
          errorMessage: message,
        });
      } catch (closureError: unknown) {
        effectClosureError = closureError instanceof Error ? closureError.message : String(closureError);
      }
      try {
        await markVideoSubmissionPreUpstreamRejected({
          runId: submissionArtifact.runId,
          clipIndex: submissionArtifact.clipIndex,
          requestHash: submissionRequestHash,
          errorMessage: message,
          errorCode: "video_run_rejected_new_effect",
          nowIso: rejectedAt,
        });
      } catch (closureError: unknown) {
        intentClosureError = closureError instanceof Error ? closureError.message : String(closureError);
      }
      throw new AppError("生产 run 已不允许创建新供应商任务，本次未发起上游请求", {
        status: 409,
        code: "video_run_rejected_new_effect",
        details: {
          runId: submissionArtifact.runId,
          clipIndex: submissionArtifact.clipIndex,
          cause: message,
          effectId: productionEffectId,
          effectClosureError,
          intentClosureError,
          upstreamRequestAttempted: false,
        },
      });
    }
  }

  // Direct workflow executions do not have a video_run-owned production_effect row. Persist a
  // stable claim into the real canvas before the paid POST. A crash after this write and before a
  // provider receipt is deliberately fail-closed: the same effect must never be submitted twice.
  const directWorkflowNodeId = workflowEffectId ? requestedWorkflowNodeId : "";
  if (directWorkflowNodeId) {
    const claimedAt = new Date().toISOString();
    const submittingData = workflowVideoSubmittingData({
      base: {
        ...nodeData,
        prompt,
        ...(modelKey ? { modelKey, videoModel: modelKey } : {}),
        ...(durationSeconds ? { videoDurationSeconds: durationSeconds } : {}),
        ...(resolution ? { videoResolution: resolution } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
      },
      effectId: workflowEffectId,
      claimedAt,
    });
    const existing = findFlowNode(input.row, directWorkflowNodeId);
    if (existing) {
      const persistedEffectId = readTrimmedString(existing.data.workflowEffectId);
      if (persistedEffectId !== workflowEffectId) {
        throw new AppError("Workflow video node identity collides with another effect", {
          status: 409,
          code: "workflow_video_effect_identity_conflict",
          details: { nodeId: directWorkflowNodeId, workflowEffectId, persistedEffectId },
        });
      }
      const replay = resolveWorkflowVideoEffectReplay(existing.data);
      throw new AppError("工作流视频副作用已被认领，已阻止重复供应商请求", {
        status: 409,
        code: "workflow_video_effect_already_claimed",
        details: {
          nodeId: directWorkflowNodeId,
          workflowEffectId,
          replayAction: replay.action,
          upstreamRequestAttempted: false,
        },
      });
    }
    const claimed = await persistFlowPatch({
      c: input.c,
      row: input.row,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      patch: existing
        ? {
            allowOverwrite: true,
            patchNodeData: [{ id: directWorkflowNodeId, data: submittingData }],
          }
        : {
            createNodes: [{
              ...taskNode,
              id: directWorkflowNodeId,
              data: submittingData,
            } as Record<string, unknown>],
          },
      affectedNodeIds: [directWorkflowNodeId],
    });
    input.row = claimed.row;
  }

  // 【提交边界标记·2026-07-14 ch25 复盘】本函数在此之前抛出的一切错误都发生在上游 POST 之前
  // （校验/门禁/资产解析/presign）——未建任务、未计费，调用方可安全原地重试；从这里起抛出的错误
  // 上游任务可能已创建（钱可能已花），打上 upstreamSubmitUncertain 标记，调用方绝不可原样自动重试
  // （盲重交=双扣费源头）。ch25 实测：镜10 一次 pre-POST 瞬时异常被当确定性拒 → 整 run 停摆等人工复活×3。
  let created: Awaited<ReturnType<typeof runPublicTask>>;
  try {
    created = await runPublicTask(input.c, input.requestUserId, {
      request: taskRequest,
    });
  } catch (err) {
    const knownPreUpstream = isVideoSubmitKnownPreUpstreamFailure(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const transitionAt = new Date().toISOString();
    const providerRejectedUrls = readVideoSubmitRejectedUrls(err);
    const providerRejectedReferenceIds = matchVideoSubmitRejectedReferenceIds(
      err,
      resolvedIdReferences,
    );
    if (err && typeof err === "object" && providerRejectedReferenceIds.length > 0) {
      (err as Record<string, unknown>).providerRejectedReferenceIds = providerRejectedReferenceIds;
    }
    if (submissionArtifact) {
      try {
        const closed = knownPreUpstream
          ? await markVideoSubmissionPreUpstreamRejected({
              runId: submissionArtifact.runId,
              clipIndex: submissionArtifact.clipIndex,
              requestHash: submissionRequestHash,
              errorMessage,
              errorCode: readVideoSubmitErrorCode(err),
              nowIso: transitionAt,
            })
          : await markVideoSubmissionUncertain({
              runId: submissionArtifact.runId,
              clipIndex: submissionArtifact.clipIndex,
              requestHash: submissionRequestHash,
              errorMessage,
              nowIso: transitionAt,
            });
        if (!closed) {
          console.error("[video-submission-intent] provider error did not close the claimed intent", {
            runId: submissionArtifact.runId,
            clipIndex: submissionArtifact.clipIndex,
            knownPreUpstream,
          });
        }
        if (productionEffectId) {
          await transitionProductionEffect({
            effectId: productionEffectId,
            toStatus: knownPreUpstream ? "rejected_pre_upstream" : "uncertain",
            updatedAt: transitionAt,
            errorCode: readVideoSubmitErrorCode(err),
            errorMessage,
          });
        }
      } catch (artifactError) {
        // 原始异常继续向上抛；pending intent 若未能更新会让后续恢复 fail-closed。
        console.error("[video-submission-intent] failed to close provider error", {
          runId: submissionArtifact.runId,
          clipIndex: submissionArtifact.clipIndex,
          error: artifactError instanceof Error ? artifactError.message : String(artifactError),
        });
        if (err && typeof err === "object") {
          (err as Record<string, unknown>).effectLedgerTransitionError =
            artifactError instanceof Error ? artifactError.message : String(artifactError);
        }
      }
    }
    if (directWorkflowNodeId) {
      try {
        const failureRow = await freshReadFlowRow({
          c: input.c,
          flowId: input.flowId,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        });
        const existing = findFlowNode(failureRow, directWorkflowNodeId);
        if (!existing) {
          throw new AppError("Workflow video effect claim disappeared after provider submission", {
            status: 500,
            code: "workflow_video_effect_claim_missing",
          });
        }
        await persistFlowPatch({
          c: input.c,
          row: failureRow,
          flowId: input.flowId,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          ...(input.chapterId ? { chapterId: input.chapterId } : {}),
          patch: {
            allowOverwrite: true,
            patchNodeData: [{
              id: directWorkflowNodeId,
              data: workflowVideoSubmissionFailureData({
                base: existing.data,
                knownPreUpstream,
                errorCode: readVideoSubmitErrorCode(err) || null,
                errorMessage,
                failedAt: transitionAt,
                providerRejectedUrls,
                providerRejectedReferenceIds,
              }),
            }],
          },
          affectedNodeIds: [directWorkflowNodeId],
        });
      } catch (claimError: unknown) {
        console.error("[workflow-video-effect] failed to persist provider submission outcome", {
          nodeId: directWorkflowNodeId,
          workflowEffectId,
          error: claimError instanceof Error ? claimError.message : String(claimError),
        });
      }
    }
    if (
      !isVideoSubmitCapacityBackpressure(err) &&
      !knownPreUpstream &&
      err &&
      typeof err === "object"
    ) {
      (err as Record<string, unknown>).upstreamSubmitUncertain = true;
    }
    throw err;
  }

  // 这条 bridge 路径是「内联轮询到终态」的异步视频任务：runPublicTask 只 reserve 积分，
  // 异步成功的 settle/失败的 release 既不走同步 settleNow、也不被(常未启用的)credit-finalizer 可靠覆盖
  // → 实测 reserve 永久卡住、从不 deduct（积分流水看不到视频扣费）。这里在我们已握有终态的点就地结算：
  // 用本 handler 计算 reserve 时同一个 specKey，amount 与 reserve 完全对齐（避免轮询 result.raw 丢 specKey 而少扣）。
  // settle/release 幂等（按 taskId 找 reserve + ledger ON CONFLICT DO NOTHING），即便 finalizer 也跑不会双扣；
  // 全部 try/catch 兜底，计费异常绝不阻断视频交付。
  const billingTaskId =
    readTrimmedString((created.result as TaskResultDto | undefined)?.id) || "";
  const createdVendor = readTrimmedString(created.vendor) || "newapi";
  const providerAcceptedAt = new Date().toISOString();
  if (submissionArtifact) {
    const submittedAt = providerAcceptedAt;
    try {
      const transitioned = billingTaskId
        ? await markVideoSubmissionAccepted({
            runId: submissionArtifact.runId,
            clipIndex: submissionArtifact.clipIndex,
            requestHash: submissionRequestHash,
            taskId: billingTaskId,
            vendor: createdVendor,
            nowIso: submittedAt,
          })
        : await markVideoSubmissionUncertain({
            runId: submissionArtifact.runId,
            clipIndex: submissionArtifact.clipIndex,
            requestHash: submissionRequestHash,
            errorMessage: "provider response lacked a stable task id",
            nowIso: submittedAt,
          });
      if (!transitioned) {
        console.error("[video-submission-intent] provider acceptance transition lost its pending claim", {
          runId: submissionArtifact.runId,
          clipIndex: submissionArtifact.clipIndex,
          taskId: billingTaskId,
        });
      }
      if (productionEffectId) {
        const acceptedEffect = await transitionProductionEffect({
          effectId: productionEffectId,
          toStatus: billingTaskId ? "accepted" : "uncertain",
          updatedAt: submittedAt,
          ...(billingTaskId ? {
            provider: createdVendor,
            providerTaskId: billingTaskId,
            providerReceipt: {
              taskId: billingTaskId,
              vendor: createdVendor,
              requestHash: submissionRequestHash,
            },
          } : {
            errorCode: "provider_task_identity_missing",
            errorMessage: "Provider response lacked a stable task id; upstream acceptance remains uncertain.",
          }),
        });
        productionEffectStatus = acceptedEffect.effect.status;
      }
    } catch (artifactError) {
      // pending intent remains durable if this write fails; a later recovery must not assume
      // that the provider task was absent merely because the canvas patch is stale.
      console.error("[video-submission-intent] failed to record provider acceptance", {
        runId: submissionArtifact.runId,
        clipIndex: submissionArtifact.clipIndex,
        taskId: billingTaskId,
        error: artifactError instanceof Error ? artifactError.message : String(artifactError),
      });
      productionEffectStatus = "persistence_failed";
      productionEffectError = artifactError instanceof Error ? artifactError.message : String(artifactError);
    }
  }
  // 对齐 reserve 时的模型 key：去掉 apimart 的 `-apimart` 后缀（等价 canonicalizeNewApiModelKey
  // 对 newapi 渠道唯一的变换）+ modelAlias 兜底，使 settle 的 amount 与 reserve 金额一致、
  // 不会因 key 不一致而少扣留下残余冻结。
  const billingModelKey =
    (modelKey || modelAlias || "").replace(/-apimart$/, "") || undefined;

  // P0 异步基座：拿到上游 task_id 后立刻写一个 running 占位节点（带 taskId），让节点即时出现在画布、
  // 并为"客户端断连/服务重启导致同步轮询中断"留下 task_id ↔ node 映射，供后续恢复/独立轮询回写。
  // flows 与章节路径都必须写。persistVideoNodePatch 已章节感知（写 chapters.canvas_flow + 章节 SSE），
  // 后台 orphan recovery 与显式 reconcile 都按 taskId 将同一节点 upsert 为 success。
  // 任务已提交后，占位写入失败必须显式上报，禁止返回一个事实上无法自动回收的 running 结果。
  const nodeId = readTrimmedString(taskNode.id) || crypto.randomUUID();
  const label = readTrimmedString(nodeData.label) || "Generated Video";
  const resolvedVideoModel = readTrimmedString(nodeData.videoModel) || modelKey || modelAlias;
  let placeholderStats: PublicAgentsVideoGenerateToCanvasResult["stats"] | null = null;
  const writePlaceholder = Boolean(billingTaskId);
  // 【上游输入连线·用户规则 2026-07-04】画布对话驱动出片时，视频节点的真实输入（参考图/首尾帧/
  // 分镜板/站位图/续写链上一镜）要在画布上有所体现——建「输入节点 → 视频节点」边。
  // 只连实际提交给模型的输入（referenceImages 是护栏/封顶后的最终列表）；音频不连（画布硬规则：
  // 音频只连视频合成节点混音）。URL 经 ARK presign 改写也能按对象 key 尾部反查回原节点。
  const clipInputEdgeArgs = {
    referenceImageUrls: [
      ...referenceImages,
      firstFrameUrl,
      lastFrameUrl,
      sourceVideoUrl,
    ].filter(Boolean),
    sourceNodeIds: [
      readTrimmedString(nodeData.storyboardImageNodeId),
      readTrimmedString(nodeData.blockingFrameNodeId),
      ...normalizeStringList(
        orch ? nodeData.videoReferenceNodeIds : nodeData.referenceImageNodeIds,
      ),
    ].filter(Boolean),
  };
  const videoInputPosterUrl = readVideoInputPosterUrl({
    firstFrameUrl,
    referenceImages,
  });
  const voiceReferenceNodeIds = readVoiceReferenceNodeIds(nodeData.voiceBinding);
  // 【clip 持久副作用身份·2026-08-10】上游 taskId 已在 Effect Ledger 的 accepted 转换中持久化；
  // 画布占位只是展示投影。节点被 stale 快照冲掉时，驱动器从 PostgreSQL 账本重挂原任务，
  // 不再依赖可静默失败的内存/Redis 映射，也不允许因画布缺节点盲目重复提交。
  if (writePlaceholder) {
    const runningNode = {
      ...taskNode,
      id: nodeId,
      data: {
        ...nodeData,
        ...promptDeliveryProjection,
        kind: "video",
        label,
        status: "running",
        ...(workflowEffectId
          ? {
              workflowSubmissionState: "accepted",
              workflowSubmissionAcceptedAt: providerAcceptedAt,
            }
          : {}),
        prompt,
        taskId: billingTaskId,
        videoTaskId: billingTaskId,
        ...(resolvedVideoModel ? { videoModel: resolvedVideoModel } : {}),
        ...(createdVendor ? { vendor: createdVendor, videoModelVendor: createdVendor } : {}),
        ...(durationSeconds ? { videoDurationSeconds: durationSeconds } : {}),
        ...(referenceImages.length ? { referenceImages } : {}),
        ...(videoInputPosterUrl ? { videoInputPosterUrl } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        // 编排幂等元数据（orch 路径才有）：稳定 clipId/run/index + 重试计数。
        ...(orch ? { clipRunId: orch.runId, clipIndex: orch.clipIndex, clipId: orch.clipId } : {}),
        ...(orch ? { videoTaskKind: taskKind } : {}),
        ...(typeof nodeData.clipAttempt === "number" ? { clipAttempt: nodeData.clipAttempt } : {}),
      },
    };
    try {
      const persistedPlaceholder = await persistVideoNodePatch({
        c: input.c,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
        flowId: input.flowId,
        fallbackRow: input.row,
        broadcastNodeId: nodeId,
        // 章节画布：占位也写进 chapters.canvas_flow（persistVideoNodePatch 章节分支）。
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        // 调用方可以先在画布创建视频节点并补齐 prompt / 参数，再把同一个 nodeId 交给本工具执行。
        // 因此无论是否编排，只要节点已存在，都必须原位升级为 running 并写入真实 taskId；
        // 只有节点尚不存在时才创建。上游提交后把“已存在”解释成跳过会丢失 taskId，导致已付费
        // 任务无法被 reconcile，且调用方极易误判后重复提交。
        // 上游输入连线随占位一起落（幂等：函数内按现存边 id/source+target 去重）。
        buildPatch: (cur) => {
          const exists = nodeExistsInGraph(cur, nodeId);
          const inputEdges = buildClipInputEdges({
            current: cur,
            clipNodeId: nodeId,
            ...clipInputEdgeArgs,
            targetWillBeCreated: !exists,
          });
          const voiceReferenceSync = buildVoiceReferenceEdgeSyncPlan({
            current: cur,
            clipNodeId: nodeId,
            voiceReferenceNodeIds,
            targetWillBeCreated: !exists,
          });
          const createEdges = [...inputEdges, ...voiceReferenceSync.createEdges];
          return {
            ...(exists
              ? {
                  allowOverwrite: true,
                  patchNodeData: [{ id: nodeId, data: runningNode.data }],
                }
              : { createNodes: [runningNode] }),
            ...(createEdges.length ? { createEdges } : {}),
            ...(voiceReferenceSync.deleteEdgeIds.length
              ? { deleteEdgeIds: voiceReferenceSync.deleteEdgeIds }
              : {}),
          };
        },
      });
      if (!persistedPlaceholder) {
        throw new Error(`video node ${nodeId} already exists and was not updated`);
      }
      placeholderStats =
        persistedPlaceholder.stats as PublicAgentsVideoGenerateToCanvasResult["stats"];
    } catch (placeholderErr) {
      const message =
        placeholderErr instanceof Error ? placeholderErr.message : String(placeholderErr);
      console.error("[video-p0] running placeholder write failed after upstream submission", {
        nodeId,
        taskId: billingTaskId,
        error: message,
      });
      throw new AppError("视频任务已提交，但运行节点写入画布失败；禁止重复提交", {
        status: 500,
        code: "agents_tool_video_placeholder_persist_failed",
        details: {
          nodeId,
          taskId: billingTaskId,
          upstreamSubmitUncertain: true,
          cause: message,
        },
      });
    }
  }

  // 视频生成拿到 taskId 后一律【提交即返回】，绝不长同步等成片。章节/flow 都由
  // tapcanvas_video_reconcile 与后台 orphan recovery 回写；调用参数不能重新打开同步长等待。
  const asyncReturn = shouldReturnVideoAsync({
    billingTaskId,
  });
  if (asyncReturn) {
    return {
      ok: true,
      // 章节内嵌画布：占位写进 chapters.canvas_flow(synthetic id=chapterId)，响应回 chapterId 不回项目 flow。
      flowId: input.chapterId || input.flowId,
      updatedAt: new Date().toISOString(),
      stats:
        placeholderStats || {
          createdNodes: 0,
          createdEdges: 0,
          patchedNodes: 0,
          appendedArrays: 0,
        },
      nodeId,
      videoUrl: "",
      thumbnailUrl: null,
      vendor: createdVendor,
      taskId: billingTaskId,
      // 统一标记 running，让小T 知道是「已提交在后台跑」而非失败——收到后应 reconcile 而非重生成。
      status: "running" as const,
      ...(orch
        ? {
            clipId: orch.clipId,
            clipRunId: orch.runId,
            clipIndex: orch.clipIndex,
          }
        : {}),
      ...(productionEffectId ? { effectId: productionEffectId } : {}),
      ...(productionEffectStatus ? { effectLedgerStatus: productionEffectStatus } : {}),
      ...(productionEffectError ? { effectLedgerError: productionEffectError } : {}),
    };
  }

  let completed: Awaited<ReturnType<typeof awaitVideoResult>>;
  try {
    completed = await awaitVideoResult({
      c: input.c,
      userId: input.requestUserId,
      vendor: createdVendor,
      initialResult: created.result,
      prompt,
      taskKind,
    });
    const posterResolution = await resolveCanvasVideoPoster({
      c: input.c,
      userId: input.requestUserId,
      videoUrl: completed.videoUrl,
      thumbnailUrl: completed.thumbnailUrl,
      posterInline: completed.posterInline,
    });
    completed = {
      ...completed,
      thumbnailUrl: posterResolution.thumbnailUrl,
      posterInline: posterResolution.posterInline,
    };
  } catch (videoErr) {
    // 只在「明确终态 failed」时 release。timeout / succeeded-but-no-url / 轮询网络异常都不退：
    // 任务可能后来才成功，若此处 release、收口器之后再 deduct，账本会同时存在 release+deduct
    // （二者各自按 taskId 幂等、并不互斥）→ 经济语义错乱。非确定失败保留 reserve、留给后续收口。
    const errCode =
      videoErr && typeof videoErr === "object" && "code" in videoErr
        ? String((videoErr as { code?: unknown }).code || "")
        : "";
    if (billingTaskId && errCode === "agents_tool_video_generate_failed") {
      try {
        await releaseTeamCreditsOnFailure(input.c, input.requestUserId, {
          taskId: billingTaskId,
          taskKind,
          vendor: createdVendor,
          ...(billingModelKey ? { modelKey: billingModelKey } : {}),
          ...(specKey ? { specKey } : {}),
        });
      } catch (releaseErr) {
        console.warn("[video-billing] release on failure failed", {
          taskId: billingTaskId,
          error:
            releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        });
      }
    }
    throw videoErr;
  }
  let completedAssetRegistrationError: string | null = null;
  if (!completed.assetId) {
    if (!generationContext) {
      completedAssetRegistrationError = "video asset project is missing";
    } else {
      try {
        completed = {
          ...completed,
          assetId: await registerGeneratedMediaAsset({
            c: input.c,
            userId: input.requestUserId,
            meta: {
              type: "video",
              url: completed.videoUrl,
              sourceUrl: completed.videoUrl,
              thumbnailUrl: completed.thumbnailUrl,
              vendor: completed.vendor,
              taskKind,
              prompt,
              modelKey: resolvedVideoModel || null,
              taskId: completed.taskId,
              generationContext,
            },
          }),
        };
      } catch (error) {
        completedAssetRegistrationError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  {
    const settleTaskId = readTrimmedString(completed.taskId) || billingTaskId;
    if (settleTaskId) {
      try {
        const amount = await resolveTeamCreditsCostForTask(input.c, {
          taskKind,
          modelKey: billingModelKey,
          specKey: specKey || undefined,
          ...(referenceVideoDurationSeconds != null
            ? { outputDurationSeconds: durationSeconds, referenceVideoDurationSeconds }
            : {}),
        });
        await settleTeamCreditsOnSuccess(input.c, input.requestUserId, {
          taskId: settleTaskId,
          taskKind,
          amount,
          vendor: readTrimmedString(completed.vendor) || createdVendor,
          ...(billingModelKey ? { modelKey: billingModelKey } : {}),
          ...(specKey ? { specKey } : {}),
        });
      } catch (settleErr) {
        console.warn("[video-billing] settle on success failed", {
          taskId: settleTaskId,
          error: settleErr instanceof Error ? settleErr.message : String(settleErr),
        });
      }
    }
  }

  const finalNode = {
    ...taskNode,
    id: nodeId,
    data: {
      ...nodeData,
      ...promptDeliveryProjection,
      status: "success",
      ...(workflowEffectId
        ? {
            workflowSubmissionState: "materialized",
            workflowSubmissionMaterializedAt: new Date().toISOString(),
          }
        : {}),
      videoUrl: completed.videoUrl,
      ...(completed.thumbnailUrl ? { videoThumbnailUrl: completed.thumbnailUrl } : {}),
      videoResults: [
        {
          url: completed.videoUrl,
          ...(completed.thumbnailUrl ? { thumbnailUrl: completed.thumbnailUrl } : {}),
          ...(completed.posterInline ? { posterInline: completed.posterInline } : {}),
          title: label,
          ...(completed.assetId ? { assetId: completed.assetId } : {}),
          ...(durationSeconds ? { duration: durationSeconds } : {}),
        },
      ],
      videoPrimaryIndex: 0,
      ...(completed.assetId ? { assetId: completed.assetId } : {}),
      assetRegistrationStatus: completed.assetId ? "ready" : "failed",
      ...(completedAssetRegistrationError
        ? { assetRegistrationError: completedAssetRegistrationError }
        : {}),
      ...(durationSeconds ? { videoDurationSeconds: durationSeconds } : {}),
      ...(completed.taskId ? { taskId: completed.taskId, videoTaskId: completed.taskId } : {}),
      ...(completed.vendor
        ? { vendor: completed.vendor, videoModelVendor: completed.vendor }
        : {}),
      ...(resolvedVideoModel ? { videoModel: resolvedVideoModel } : {}),
    },
  };

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
      finalNodeData: (finalNode as { data: Record<string, unknown> }).data,
    });
    if (completedAssetRegistrationError || !completed.assetId) {
      throw new AppError("视频已生成并写入画布，但登记到 Assets 失败", {
        status: 500,
        code: "video_asset_registration_partial_success",
        details: {
          nodeId,
          videoUrl: completed.videoUrl,
          reason: completedAssetRegistrationError || "asset id missing",
        },
      });
    }
    return {
      ok: true,
      // 写入目标是章节画布(chapters.canvas_flow，synthetic flow id=chapterId)，回 chapterId 而非项目 context flow，
      // 否则响应误标成项目 flow(b18296fd)，让人误判跨章视频污染。
      flowId: input.chapterId,
      updatedAt: new Date().toISOString(),
      stats: stats as unknown as PublicAgentsVideoGenerateToCanvasResult["stats"],
      nodeId,
      videoUrl: completed.videoUrl,
      thumbnailUrl: completed.thumbnailUrl,
      vendor: completed.vendor,
      taskId: completed.taskId,
    };
  }

  const finalData = (finalNode as { data: Record<string, unknown> }).data;
  // 最终写回：重读最新 flow（防长生成期间冲掉前端改动）→ P0 的 running 占位若在则 patch 成 success、
  // 否则直接 create；并自动连 storyboard→clip 边（可见血缘，源 handle 按故事板类型选、去重）。
  const persisted = await persistVideoNodePatch({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
    fallbackRow: input.row,
    broadcastNodeId: nodeId,
    buildPatch: (cur) => {
      const exists = nodeExistsInGraph(cur, nodeId);
      const inputEdges = buildClipInputEdges({
        current: cur,
        clipNodeId: nodeId,
        ...clipInputEdgeArgs,
        targetWillBeCreated: !exists,
      });
      const voiceReferenceSync = buildVoiceReferenceEdgeSyncPlan({
        current: cur,
        clipNodeId: nodeId,
        voiceReferenceNodeIds,
        targetWillBeCreated: !exists,
      });
      const allEdges = [...inputEdges, ...voiceReferenceSync.createEdges];
      const base = exists
        ? { allowOverwrite: true, patchNodeData: [{ id: nodeId, data: finalData }] }
        : { createNodes: [finalNode] };
      return {
        ...base,
        ...(allEdges.length ? { createEdges: allEdges } : {}),
        ...(voiceReferenceSync.deleteEdgeIds.length
          ? { deleteEdgeIds: voiceReferenceSync.deleteEdgeIds }
          : {}),
      };
    },
  });
  if (!persisted) {
    throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
  }
  if (completedAssetRegistrationError || !completed.assetId) {
    throw new AppError("视频已生成并写入画布，但登记到 Assets 失败", {
      status: 500,
      code: "video_asset_registration_partial_success",
      details: {
        nodeId,
        videoUrl: completed.videoUrl,
        reason: completedAssetRegistrationError || "asset id missing",
      },
    });
  }

  return {
    ok: true,
    flowId: input.flowId,
    updatedAt: persisted.updatedAt,
    stats: persisted.stats as PublicAgentsVideoGenerateToCanvasResult["stats"],
    nodeId,
    videoUrl: completed.videoUrl,
    thumbnailUrl: completed.thumbnailUrl,
    vendor: completed.vendor,
    taskId: completed.taskId,
  };
}

// ── P1: 独立轮询回写（孤儿 running 视频节点自愈）──────────────────────────────
// 单次(非长等)扫 flow 内仍属 provider pending 且带 taskId 的视频节点：查一次上游任务，
// succeeded→patchNodeData 回写 success+视频URL(已持久化)并结算积分；failed→标记+释放积分；
// 仍在跑→留待下次。复用 fetchTaskResultForPolling(返回 file.beqlee 持久 URL)+persistVideoNodePatch。
// 由前端定时器/小T 在 S6 提交后反复调用，直到 stillRunning=0；天然兜底"客户端断连/服务重启"孤儿。
export async function reconcileVideoNodesForFlow(input: {
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
  excludeNodeIds?: readonly string[];
}): Promise<{
  ok: true;
  reconciled: number;
  failed: number;
  stillRunning: number;
  postersBackfilled: number;
  posterBackfillFailed: number;
  details: Array<{ nodeId: string; taskId: string; status: string }>;
}> {
  const settleTerminalEffect = async (inputValue: {
    data: Record<string, unknown>;
    status: "materialized" | "failed";
    assetUrl?: string;
    errorMessage?: string;
  }): Promise<string | null> => {
    const data = inputValue.data;
    const runId = readTrimmedString(data.clipRunId);
    const clipIndex = Number(data.clipIndex);
    if (!runId || !Number.isInteger(clipIndex) || clipIndex < 0) return null;
    const effect = await findLatestProductionEffect({
      runId,
      effectKey: `video-clip:${clipIndex}`,
    });
    if (!effect) return `production effect missing for ${runId}/video-clip:${clipIndex}`;
    try {
      await transitionProductionEffect({
        effectId: effect.id,
        toStatus: inputValue.status,
        updatedAt: new Date().toISOString(),
        ...(inputValue.assetUrl ? { assetUrl: inputValue.assetUrl } : {}),
        ...(inputValue.errorMessage ? { errorMessage: inputValue.errorMessage } : {}),
      });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const chapterId = readTrimmedString(input.chapterId);
  // 章节画布：直接用传入的章节行（input.row 已是 chapters.canvas_flow 快照）；写回走 persistVideoNodePatch(chapterId)。
  const freshRow = chapterId
    ? input.row
    : (input.devBypass
        ? await getFlowByIdUnsafe(input.c.env.DB, input.flowId)
        : await getFlowForOwner(input.c.env.DB, input.flowId, input.requestUserId)) || input.row;
  const data = sanitizeFlowDataForStorage(mapFlowRowToDto(freshRow).data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  const pending: Array<{ nodeId: string; node: Record<string, unknown>; d: Record<string, unknown>; taskId: string }> = [];
  const posterRepairs: Array<{ nodeId: string; d: Record<string, unknown> }> = [];
  const excludedNodeIds = new Set(input.excludeNodeIds ?? []);
  for (const n of nodes) {
    const d =
      n.data && typeof n.data === "object" && !Array.isArray(n.data)
        ? (n.data as Record<string, unknown>)
        : {};
    if (readTrimmedString(d.kind) !== "video") continue;
    const nodeId = String(n.id ?? "");
    if (excludedNodeIds.has(nodeId)) continue;
    const persistedTaskId = readTrimmedString(d.taskId) || readTrimmedString(d.videoTaskId);
    const targetTaskId = input.target && nodeId === input.target.nodeId
      ? readTrimmedString(input.target.taskId)
      : "";
    if (input.target && nodeId !== input.target.nodeId) continue;
    if (input.target && persistedTaskId && persistedTaskId !== targetTaskId) continue;
    const taskId = persistedTaskId || targetTaskId;
    const st = readTrimmedString(d.status).toLowerCase();
    if (
      st === "success" &&
      readTrimmedString(d.videoUrl) &&
      !hasPersistedVideoPoster(d) &&
      readTrimmedString(d.videoPosterBackfillStatus) !== "failed"
    ) {
      posterRepairs.push({ nodeId, d });
      continue;
    }
    if (!isProviderTaskPendingStatus(st)) continue;
    if (!taskId) continue;
    pending.push({ nodeId, node: n, d, taskId });
  }
  let reconciled = 0;
  let failed = 0;
  let stillRunning = 0;
  let postersBackfilled = 0;
  let posterBackfillFailed = 0;
  const details: Array<{ nodeId: string; taskId: string; status: string }> = [];
  // 单次串行处理(每节点一次状态查询,不长等)；上限保护避免一次扫太多。
  for (const item of pending.slice(0, 24)) {
    const taskId = item.taskId;
    const vendor = readTrimmedString(item.d.vendor) || "newapi";
    const declaredTaskKind = readTrimmedString(item.d.videoTaskKind);
    const taskKind: "text_to_video" | "image_to_video" | "video_enhance" =
      declaredTaskKind === "text_to_video" || declaredTaskKind === "video_enhance"
        ? declaredTaskKind
        : "image_to_video";
    let outcomeStatus = "running";
    try {
      const outcome = await fetchTaskResultForPolling(input.c, input.requestUserId, {
        taskId,
        vendor,
        taskKind,
        prompt: readTrimmedString(item.d.prompt),
        mode: "public",
        // 后台 reconcile：单节点上游查询最多等 20s，超时视为仍在跑，下次 tick 再试。
        timeoutMs: 20_000,
      });
      if (!outcome.ok) {
        stillRunning += 1;
        details.push({ nodeId: item.nodeId, taskId, status: "running" });
        continue;
      }
      const resultVendor = readTrimmedString(outcome.vendor) || vendor;
      const status = readTrimmedString(outcome.result.status).toLowerCase();
      const extracted = extractVideoAssetFromTaskResult(outcome.result);
      const billingModelKey =
        (readTrimmedString(item.d.videoModel) || "").replace(/-apimart$/, "") || undefined;
      const specKey = taskKind === "video_enhance"
        ? readTrimmedString(item.d.billingSpecKey)
        : buildVideoBillingSpecKey(
            normalizeVideoResolution(item.d.videoResolution ?? item.d.resolution),
            normalizePositiveInteger(item.d.videoDurationSeconds ?? item.d.durationSeconds) ?? null,
      );
      if (status === "succeeded" && extracted.videoUrl) {
        let resolvedAssetId = extracted.assetId;
        let assetRegistrationError: string | null = null;
        if (!resolvedAssetId) {
          const projectId = readTrimmedString(freshRow.project_id);
          if (!projectId) {
            assetRegistrationError = "video asset project is missing";
          } else {
            try {
              resolvedAssetId = await registerGeneratedMediaAsset({
                c: input.c,
                userId: input.requestUserId,
                meta: {
                  type: "video",
                  url: extracted.videoUrl,
                  sourceUrl: extracted.videoUrl,
                  thumbnailUrl: extracted.thumbnailUrl,
                  vendor: resultVendor,
                  taskKind,
                  prompt: readTrimmedString(item.d.prompt),
                  modelKey: readTrimmedString(item.d.videoModel) || null,
                  taskId,
                  generationContext: {
                    projectId,
                    ...(chapterId ? { chapterId } : { flowId: input.flowId }),
                    nodeId: item.nodeId,
                  },
                },
              });
            } catch (error) {
              assetRegistrationError = error instanceof Error ? error.message : String(error);
            }
          }
        }
        const posterResolution = await resolveCanvasVideoPoster({
          c: input.c,
          userId: input.requestUserId,
          videoUrl: extracted.videoUrl,
          thumbnailUrl: extracted.thumbnailUrl,
          posterInline: extracted.posterInline,
        });
        const durationSeconds = normalizePositiveInteger(
          item.d.videoDurationSeconds ?? item.d.durationSeconds,
        );
        const completedData: Record<string, unknown> = {
          ...item.d,
          status: "success",
          videoUrl: extracted.videoUrl,
          ...(extracted.thumbnailUrl ? { videoThumbnailUrl: extracted.thumbnailUrl } : {}),
          videoResults: [
            {
              url: extracted.videoUrl,
              ...(extracted.thumbnailUrl ? { thumbnailUrl: extracted.thumbnailUrl } : {}),
              ...(extracted.posterInline ? { posterInline: extracted.posterInline } : {}),
              title: readTrimmedString(item.d.label) || "Generated Video",
              ...(resolvedAssetId ? { assetId: resolvedAssetId } : {}),
              ...(durationSeconds ? { duration: durationSeconds } : {}),
            },
          ],
          videoPrimaryIndex: 0,
          ...(resolvedAssetId ? { assetId: resolvedAssetId } : {}),
          assetRegistrationStatus: resolvedAssetId ? "ready" : "failed",
          ...(assetRegistrationError ? { assetRegistrationError } : {}),
          taskId,
          videoTaskId: taskId,
          vendor: resultVendor,
          videoModelVendor: resultVendor,
        };
        const finalData = posterResolution.thumbnailUrl || posterResolution.posterInline
          ? applyGeneratedVideoPoster(completedData, posterResolution)
          : {
              ...completedData,
              videoPosterBackfillStatus: "failed",
              videoPosterSource: readVideoInputPosterUrl(item.d)
                ? "reference_fallback"
                : "unavailable",
              ...(posterResolution.errorMessage
                ? { videoPosterBackfillError: posterResolution.errorMessage }
                : {}),
            };
        await persistVideoNodePatch({
          c: input.c,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          flowId: input.flowId,
          fallbackRow: freshRow,
          broadcastNodeId: item.nodeId,
          ...(chapterId ? { chapterId } : {}),
          buildPatch: (cur) => {
            if (!nodeExistsInGraph(cur, item.nodeId)) return null;
            // 【重写留痕·2026-07-07 用户拍板】节点已有旧成片、又要写入不同新成片（重生成回写）时，
            // 旧版先快照成存档节点（同一 patch 原子落盘·绑定字段全剥，不会被幂等槽位/concat 误捡）。
            const curNodesRaw = (cur as { nodes?: unknown }).nodes;
            const curNodes = Array.isArray(curNodesRaw)
              ? (curNodesRaw as Record<string, unknown>[])
              : [];
            const oldData =
              ((curNodes.find((n) => String((n as { id?: unknown }).id ?? "") === item.nodeId) as
                | { data?: Record<string, unknown> }
                | undefined)?.data ?? {}) as Record<string, unknown>;
            const archive = isMediaVersionReplacement(oldData, finalData)
              ? buildMediaVersionArchiveNode({
                  origNodeId: item.nodeId,
                  origData: oldData,
                  nowMs: Date.now(),
                })
              : null;
            return {
              allowOverwrite: true,
              patchNodeData: [{ id: item.nodeId, data: finalData }],
              ...(archive ? { createNodes: [archive.node] } : {}),
            };
          },
        });
        try {
          const amount = await resolveTeamCreditsCostForTask(input.c, {
            taskKind,
            modelKey: billingModelKey,
            specKey: specKey || undefined,
            ...(taskKind === "image_to_video" && normalizePositiveInteger(item.d.referenceVideoDurationSeconds) != null
              ? {
                  outputDurationSeconds: normalizePositiveInteger(
                    item.d.videoDurationSeconds ?? item.d.durationSeconds,
                  ),
                  referenceVideoDurationSeconds: normalizePositiveInteger(
                    item.d.referenceVideoDurationSeconds,
                  ),
                }
              : {}),
          });
          await settleTeamCreditsOnSuccess(input.c, input.requestUserId, {
            taskId,
            taskKind,
            amount,
            vendor: resultVendor,
            ...(billingModelKey ? { modelKey: billingModelKey } : {}),
            ...(specKey ? { specKey } : {}),
          });
        } catch (settleErr) {
          console.warn("[video-p1] settle on reconcile failed", {
            taskId,
            error: settleErr instanceof Error ? settleErr.message : String(settleErr),
          });
        }
        reconciled += 1;
        const effectError = await settleTerminalEffect({
          data: item.d,
          status: "materialized",
          assetUrl: extracted.videoUrl,
        });
        outcomeStatus = effectError ? "success_effect_ledger_failed" : "success";
        if (effectError) {
          console.error("[production-effect-ledger] materialized asset projection failed", {
            nodeId: item.nodeId,
            taskId,
            effectError,
          });
        }
      } else if (status === "succeeded" && (outcome as { storedStale?: boolean }).storedStale) {
        // 存储行 succeeded 但资产已丢且超恢复窗（上游任务必已过期，重查恒 400）：
        // 节点终态化止损，退出 stuck 扫描集。计费不动——该任务的结算/释放早由 credit-finalizer 完成。
        // （2026-07-17 复盘根治：07-08 两个此类孤儿节点被 orphan-recovery 每分钟打上游 400 达 9 天。）
        await persistVideoNodePatch({
          c: input.c,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          flowId: input.flowId,
          fallbackRow: freshRow,
          broadcastNodeId: item.nodeId,
          ...(chapterId ? { chapterId } : {}),
          buildPatch: (cur) =>
            nodeExistsInGraph(cur, item.nodeId)
              ? {
                  allowOverwrite: true,
                  patchNodeData: [
                    {
                      id: item.nodeId,
                      data: {
                        ...item.d,
                        status: "failed",
                        errorMessage: "生成结果资产已失效（上游任务已过期），请重新生成",
                      },
                    },
                  ],
                }
              : null,
        });
        failed += 1;
        const effectError = await settleTerminalEffect({
          data: item.d,
          status: "failed",
          errorMessage: "generated asset expired before reconciliation",
        });
        outcomeStatus = effectError ? "failed_effect_ledger_failed" : "failed";
      } else if (status === "failed") {
        const providerFailure = buildProviderTaskFailureMessage(outcome.result);
        await persistVideoNodePatch({
          c: input.c,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          flowId: input.flowId,
          fallbackRow: freshRow,
          broadcastNodeId: item.nodeId,
          ...(chapterId ? { chapterId } : {}),
          buildPatch: (cur) =>
            nodeExistsInGraph(cur, item.nodeId)
              ? {
                  allowOverwrite: true,
                  patchNodeData: [
                    {
                      id: item.nodeId,
                      data: {
                        ...item.d,
                        status: "failed",
                        ...(providerFailure
                          ? {
                              errorMessage: providerFailure,
                              clipSubmitError: providerFailure,
                            }
                          : {}),
                      },
                    },
                  ],
                }
              : null,
        });
        try {
          await releaseTeamCreditsOnFailure(input.c, input.requestUserId, {
            taskId,
            taskKind,
            vendor: resultVendor,
            ...(billingModelKey ? { modelKey: billingModelKey } : {}),
            ...(specKey ? { specKey } : {}),
          });
        } catch (releaseError) {
          console.error("[video-p1] release on provider failure failed", {
            nodeId: item.nodeId,
            taskId,
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
          });
        }
        failed += 1;
        const effectError = await settleTerminalEffect({
          data: item.d,
          status: "failed",
          errorMessage: providerFailure || "provider task failed",
        });
        outcomeStatus = effectError ? "failed_effect_ledger_failed" : "failed";
      } else {
        stillRunning += 1;
      }
    } catch (err) {
      const errStatus = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 0;
      const errMessage = err instanceof Error ? err.message : String(err);
      if (isPermanentUpstreamTaskError(errStatus, errMessage)) {
        // 永久错（任务不存在/已过期/审核硬拒）重试不会变好：节点终态化，禁止记 stillRunning
        // 让 orphan-recovery 每 tick 无限重轮询（与 credit-finalizer 同一判据）。
        try {
          await persistVideoNodePatch({
            c: input.c,
            requestUserId: input.requestUserId,
            devBypass: input.devBypass,
            flowId: input.flowId,
            fallbackRow: freshRow,
            broadcastNodeId: item.nodeId,
            ...(chapterId ? { chapterId } : {}),
            buildPatch: (cur) =>
              nodeExistsInGraph(cur, item.nodeId)
                ? {
                    allowOverwrite: true,
                    patchNodeData: [
                      {
                        id: item.nodeId,
                        data: { ...item.d, status: "failed", errorMessage: `上游任务查询失败（${errStatus || "moderation"}）：${errMessage.slice(0, 200)}` },
                      },
                    ],
                  }
                : null,
          });
          failed += 1;
          const effectError = await settleTerminalEffect({
            data: item.d,
            status: "failed",
            errorMessage: errMessage,
          });
          outcomeStatus = effectError ? "failed_effect_ledger_failed" : "failed";
        } catch (persistError) {
          console.error("[video-p1] failed to persist permanent upstream error", {
            nodeId: item.nodeId,
            taskId,
            error: persistError instanceof Error ? persistError.message : String(persistError),
          });
          stillRunning += 1;
        }
      } else {
        console.warn("[video-p1] reconcile node failed", {
          nodeId: item.nodeId,
          taskId,
          error: errMessage,
        });
        stillRunning += 1;
      }
    }
    details.push({ nodeId: item.nodeId, taskId, status: outcomeStatus });
  }

  for (const item of posterRepairs.slice(0, 24)) {
    const videoUrl = readTrimmedString(item.d.videoUrl);
    const taskId = readTrimmedString(item.d.taskId);
    const posterResolution = await resolveCanvasVideoPoster({
      c: input.c,
      userId: input.requestUserId,
      videoUrl,
    });
    const posterReady = Boolean(
      posterResolution.thumbnailUrl || posterResolution.posterInline,
    );
    await persistVideoNodePatch({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      fallbackRow: freshRow,
      broadcastNodeId: item.nodeId,
      ...(chapterId ? { chapterId } : {}),
      buildPatch: (current) => {
        const currentNodes = Array.isArray((current as { nodes?: unknown }).nodes)
          ? ((current as { nodes: unknown[] }).nodes)
          : [];
        const currentNode = currentNodes.find((candidate) =>
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          String((candidate as { id?: unknown }).id ?? "") === item.nodeId,
        );
        if (!currentNode || typeof currentNode !== "object" || Array.isArray(currentNode)) {
          return null;
        }
        const currentData =
          (currentNode as { data?: unknown }).data &&
          typeof (currentNode as { data?: unknown }).data === "object" &&
          !Array.isArray((currentNode as { data?: unknown }).data)
            ? (currentNode as { data: Record<string, unknown> }).data
            : {};
        const nextData = posterReady
          ? applyGeneratedVideoPoster(currentData, posterResolution)
          : {
              ...currentData,
              videoPosterBackfillStatus: "failed",
              videoPosterSource: readVideoInputPosterUrl(currentData)
                ? "reference_fallback"
                : "unavailable",
              ...(posterResolution.errorMessage
                ? { videoPosterBackfillError: posterResolution.errorMessage }
                : {}),
            };
        return {
          allowOverwrite: true,
          patchNodeData: [{ id: item.nodeId, data: nextData }],
        };
      },
    });
    if (posterReady) {
      postersBackfilled += 1;
      details.push({ nodeId: item.nodeId, taskId, status: "poster_backfilled" });
    } else {
      posterBackfillFailed += 1;
      details.push({ nodeId: item.nodeId, taskId, status: "poster_backfill_failed" });
      console.warn("[video-poster] successful node poster backfill failed", {
        nodeId: item.nodeId,
        taskId: taskId || null,
        error: posterResolution.errorMessage,
      });
    }
  }
  return {
    ok: true,
    reconciled,
    failed,
    stillRunning,
    postersBackfilled,
    posterBackfillFailed,
    details,
  };
}
