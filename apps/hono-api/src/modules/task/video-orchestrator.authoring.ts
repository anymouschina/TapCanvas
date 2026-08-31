/**
 * 【编排域状态机·domain 层】commit_beats（段①入口）+ 章级合同 diff。
 * spec：docs/superpowers/specs/2026-07-11-authoring-orchestrator-ddd-design.md
 *
 * commit_beats = BeatSheet 原子产物的唯一写入口：写入即校验（video-orchestrator.beat-sheet.ts），
 * 通过后落库 + 登记产物依赖图（beat_sheet → clip:N），authoring_state=beats_committed。
 * 之后每个 clip 独立派 writer；writer 在同一上下文加载创作与 reviewer 方法，完成
 * 首稿→语义复盘→直接修订后只交付一份最终 artifact。Hono 不评价语义质量；JSON
 * 结构或动态 editable stringBudget 失败只记录首次提交和精确拒因，不回灌、不重派。
 */

import { resolveChapterTextForOrchestrate } from "./video-orchestrator.chapter-source";
import {
  enrichBeatsWithSourceSpans,
  splitBeatClipTasks,
  readBeatSheetExecutionScope,
  validateBeatSheet,
  WRITER_CLIP_CONTRACT_VERSION,
  type AdaptationStrategyDecl,
  type Beat,
  type BeatSheet,
  type BeatSheetValidationPhase,
} from "./video-orchestrator.beat-sheet";
import {
  advanceAuthoringState,
  commitBeatSheetGraphSnapshot,
  getChapterFilmSpec,
  getChapterAdaptationContract,
  setChapterFilmSpec,
  mergeFilmSpecAuthority,
  listAuthoringArtifacts,
  setChapterAdaptationContract,
  stableContentHash,
  type AuthoringGraphCommitArtifact,
} from "./video-orchestrator.authoring.repo";
import { resolveVideoExecutionSpecs } from "./video-orchestrator.execution-specs";
import {
  getVideoRun,
  VIDEO_RUN_COLLECTING_STATE,
  type VideoRunRow,
} from "./video-run.repo";
import { getWorldBibleReminderForChapter } from "../chapter/worldbible-readiness";
import { cacheAdaptationStrategyText, persistRunNarrativeMeta } from "./video-orchestrator.film-bible-store";
import type { VideoGenerationContract } from "./video-orchestrator.generation-contract";
import {
  resolveVideoPreflightSubmissionTopology,
  type VideoProviderSubmissionTopology,
} from "./video-orchestrator.provider-submission-topology";
import type { AppContext } from "../../types";
import { freshReadFlowRow, readFlowNodes } from "./video-orchestrator.flow-io";
import { bindExplicitClipKeyframes } from "./video-orchestrator.keyframe-binding";
import {
  materializeBeatBlockingContexts,
  validateBeatKeyframeReferences,
} from "./video-orchestrator.blocking-context";
import type { ParentAgentExecution } from "./agent-execution-provenance";
import {
  computeEffectiveCharacterStates,
  resolveClipReferenceImageEntries,
  type StoryPlanClip,
} from "./video-orchestrator.orchestrate";
import { validateSd2ClipReferenceBudget } from "./video-reference-budget";
import { loadImageGenerationReferenceUrlsByTaskId } from "./image-generation-reference-evidence";
import {
  BeatSheetDraftError,
  applyBeatSheetPatch,
  patchBeatSheetDraft,
  saveBeatSheetDraft,
  type BeatSheetPatchOperation,
} from "./video-orchestrator.beat-sheet-draft";
import {
  buildBeatSheetPreflightFingerprint,
  readBeatSheetPreflight,
  saveBeatSheetPreflight,
  type BeatSheetPreflight,
} from "./video-orchestrator.beat-sheet-preflight";
import {
  readBeatSheetSourceAuthority,
  type BeatSheetSourceAuthority,
} from "./video-orchestrator.source-authority";
import {
  readReferenceBudgetProposal,
  ReferenceBudgetProposalError,
  saveReferenceBudgetProposal,
} from "./video-orchestrator.reference-budget-proposal";
import { buildCanonicalVideoReferenceNodeIds } from "./video-orchestrator.clip-reference-contract";
import {
  AUTHORING_ASSET_COVERAGE_NODE_KEY,
  AUTHORING_BEAT_SHEET_NODE_KEY,
  AUTHORING_GRAPH_MANIFEST_ARTIFACT_KEY,
  compileVideoAuthoringGraph,
  validateVideoAuthoringGraph,
} from "./video-orchestrator.authoring-graph";
import { getActiveProjectLookBibleForUser } from "../material/material.service";
import { isStoryPreviewAssetData } from "./story-preview-asset";

function readNodeReferenceUrls(node: { data?: Record<string, unknown> } | undefined): string[] {
	if (!node) return [];
	const data = node.data ?? {};
	if (isStoryPreviewAssetData(data)) return [];
  const values: unknown[] = [data.imageUrl, data.url];
  if (Array.isArray(data.roleCardReferenceImages)) values.push(...data.roleCardReferenceImages);
  if (Array.isArray(data.roleReferenceEntries)) values.push(...data.roleReferenceEntries);
  const urls = values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [String((value as Record<string, unknown>).url ?? "")];
    }
    return [];
  }).map((value) => value.trim()).filter((value) => /^https?:\/\//i.test(value));
  return [...new Set(urls)];
}

/** 生产前预算规划：本地只解析 URL 成本，资产语义精选仍由 agents 完成。 */
export async function orchestrateVideoReferenceBudget(input: {
  bodyArgs: unknown;
  requestUserId?: string;
  flowId?: string;
  chapterId?: string;
  projectId?: string | null;
  generationContract?: VideoGenerationContract;
  c?: AppContext;
  devBypass?: boolean;
}): Promise<Record<string, unknown>> {
  const args = input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
    ? input.bodyArgs as Record<string, unknown>
    : {};
  const ownerId = readTrimmed(input.requestUserId);
  const sourceRunId = readTrimmed(args.sourceRunId);
  const scopedFlowId = readTrimmed(input.chapterId) || readTrimmed(input.flowId);
  if (!ownerId || !sourceRunId || !scopedFlowId || !input.c || !input.generationContract) {
    return { ok: false, terminal: true, mode: "reference_budget", code: "reference_budget_scope_required", sourceRunId, message: "reference_budget 需要 sourceRunId、当前授权画布和动态模型合同。" };
  }
  const sourceRun = await getVideoRun(sourceRunId);
  const scopeIssue = validateBeatSheetCommitTarget({ existing: sourceRun, ownerId, projectId: input.projectId, chapterId: input.chapterId, flowId: input.flowId, runId: sourceRunId });
  if (!sourceRun || scopeIssue?.code === "run_scope_mismatch" || !sourceRun.beat_sheet) {
    return { ok: false, terminal: true, mode: "reference_budget", code: scopeIssue?.code ?? (sourceRun ? "reference_budget_source_missing" : "reference_budget_source_not_found"), sourceRunId, message: scopeIssue?.message ?? `源 runId「${sourceRunId}」不存在或没有权威 BeatSheet。` };
  }
  let sheet: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(sourceRun.beat_sheet);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root_not_object");
    sheet = parsed as Record<string, unknown>;
  } catch (error) {
    return { ok: false, terminal: true, mode: "reference_budget", code: "reference_budget_source_invalid", sourceRunId, message: `源 BeatSheet 无法解析：${String((error as Error).message || error)}` };
  }
  const proposedOperations = Array.isArray(args.operations)
    ? args.operations as BeatSheetPatchOperation[]
    : [];
  if (proposedOperations.length > 0) {
    try {
      sheet = applyBeatSheetPatch(sheet, proposedOperations);
    } catch (error) {
      return {
        ok: false,
        terminal: true,
        mode: "reference_budget",
        code: error instanceof BeatSheetDraftError ? error.code : "beat_sheet_patch_invalid",
        sourceRunId,
        message: `预算规划 operations 无法应用：${String((error as Error).message || error)}`,
      };
    }
  }
  const row = await freshReadFlowRow({ c: input.c, flowId: scopedFlowId, requestUserId: ownerId, devBypass: input.devBypass === true, ...(input.chapterId ? { chapterId: input.chapterId } : {}) });
  const nodeById = new Map(readFlowNodes(row).map((node) => [node.id, node] as const));
  const beats = Array.isArray(sheet.beats) ? sheet.beats : [];
  const maximumBusinessImages = input.generationContract.referenceImagePolicy.maximumBusinessImages;
  const clipBudgets = beats.map((rawBeat, index) => {
    const beat = rawBeat && typeof rawBeat === "object" && !Array.isArray(rawBeat) ? rawBeat as Record<string, unknown> : {};
    const storyboardImageNodeId = readTrimmed(beat.storyboardImageNodeId);
    const storyboardUrls = readNodeReferenceUrls(nodeById.get(storyboardImageNodeId));
    const continuityMode = readTrimmed(beat.continuityMode);
    const storyboardCost = continuityMode === "bridge_frames" ? 0 : storyboardUrls.length;
    const contracts = Array.isArray(beat.assetObjectContracts) ? beat.assetObjectContracts : [];
    const candidates = contracts.flatMap((rawContract) => {
      if (!rawContract || typeof rawContract !== "object" || Array.isArray(rawContract)) return [];
      const contract = rawContract as Record<string, unknown>;
      const nodeIds = Array.isArray(contract.referenceImageNodeIds) ? contract.referenceImageNodeIds.map(readTrimmed).filter(Boolean) : [];
      return nodeIds.map((nodeId) => {
        const urls = readNodeReferenceUrls(nodeById.get(nodeId));
        const incrementalUrls = urls.filter((url) => !storyboardUrls.includes(url));
        const issue = urls.length === 0
          ? "real_image_url_missing"
          : incrementalUrls.length === 0
            ? "already_reserved_or_consumed"
            : "";
        return { nodeId, kind: readTrimmed(contract.kind), name: readTrimmed(contract.name), referenceRole: readTrimmed(contract.referenceRole), resolvedUniqueUrlCount: urls.length, incrementalBusinessUrlCost: incrementalUrls.length, eligible: incrementalUrls.length > 0, ...(issue ? { issue } : {}) };
      });
    });
    return { clipIndex: Number.isInteger(Number(beat.clipIndex)) ? Number(beat.clipIndex) : index, continuityMode, storyboard: storyboardImageNodeId ? { nodeId: storyboardImageNodeId, resolvedUniqueUrlCount: storyboardUrls.length, budgetCost: storyboardCost } : null, availableBusinessImagesAfterStoryboard: Math.max(0, maximumBusinessImages - storyboardCost), candidates };
  });
  const budgetRevision = stableContentHash({
    sourceRunId,
    referenceImagePolicy: input.generationContract.referenceImagePolicy,
    clipBudgets,
    proposedOperations,
  }).slice(0, 16);
  if (proposedOperations.length > 0) {
    try {
      await saveReferenceBudgetProposal({
        ownerId,
        projectId: input.projectId ?? null,
        scopeId: scopedFlowId,
        sourceRunId,
        budgetRevision,
        operations: proposedOperations,
      });
    } catch (error) {
      if (error instanceof ReferenceBudgetProposalError) {
        return {
          ok: false,
          terminal: true,
          mode: "reference_budget",
          code: error.code,
          sourceRunId,
          message: error.message,
        };
      }
      return {
        ok: false,
        terminal: true,
        mode: "reference_budget",
        code: "reference_budget_proposal_store_failed",
        sourceRunId,
        message: `reference_budget 权威提案保存失败：${String((error as Error).message || error)}`,
      };
    }
  }
  return {
    ok: true,
    terminal: false,
    mode: "reference_budget",
    sourceRunId,
    budgetRevision,
    proposalStored: proposedOperations.length > 0,
    generationContract: input.generationContract,
    referenceImagePolicy: input.generationContract.referenceImagePolicy,
    clipBudgets,
    nextAction:
      proposedOperations.length > 0
        ? "operations 已由服务端保存为 opaque proposal；prepare_beats 只提交 sourceRunId、runId 与 budgetRevision，禁止再次发送 operations。"
        : "当前仅返回源 BeatSheet 预算事实；派生新版本前必须携带完整拟议 operations 再调用一次 reference_budget。",
  };
}

function readTrimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function readNonNegativeIndex(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 每个对象合同都声明了本镜实际要保持的身份/场景/道具事实；对应的真实单格资产必须
 * 一并进入视频参考清单。此前只消费 agent 单列的 videoReferenceNodeIds，导致合同虽然
 * 校验通过、画布也已有角色卡，真正付费请求仍可能漏掉业务引用，出现“有资产却抽象重铸”。
 * 去重后再交由动态预算合同校验；超预算必须在提交前显式失败并交给 agents 精选/拆片，
 * 绝不静默丢弃任一已声明对象。
 */
type BeatVideoReferenceSource = Pick<
  Beat,
  "videoReferenceNodeIds" | "visualStateAnchorRequirements"
> & {
  assetObjectContracts: ReadonlyArray<
    Pick<Beat["assetObjectContracts"][number], "kind" | "name" | "referenceImageNodeIds">
  >;
};

export function buildBeatVideoReferenceNodeIds(
  beat: BeatVideoReferenceSource,
): string[] {
  return buildCanonicalVideoReferenceNodeIds(beat);
}

/**
 * 把父代理本轮真实生效的模型配置写进 BeatSheet 内部契约。
 *
 * agentModel/agentApiStyle 是执行事实，不是创作字段：模型在 beatSheet.meta 里声明的值
 * 不具权威性，必须由远程工具传输层覆盖。返回值只用于可观测性，不能阻断正确覆盖。
 */
export function applyParentAgentExecution(
  rawSheet: Record<string, unknown>,
  parent: ParentAgentExecution,
): string[] {
  const model = parent.model.trim();
  const meta =
    rawSheet.meta && typeof rawSheet.meta === "object" && !Array.isArray(rawSheet.meta)
      ? { ...(rawSheet.meta as Record<string, unknown>) }
      : {};
  const warnings: string[] = [];
  const declaredModel = readTrimmed(meta.agentModel);
  const declaredApiStyle = readTrimmed(meta.agentApiStyle);
  if (declaredModel && declaredModel !== model) {
    warnings.push(
      `beatSheet.meta.agentModel=${declaredModel} 与父代理实际模型 ${model} 不一致，已按运行时事实覆盖`,
    );
  }
  if (declaredApiStyle && declaredApiStyle !== parent.apiStyle) {
    warnings.push(
      `beatSheet.meta.agentApiStyle=${declaredApiStyle} 与父代理实际协议 ${parent.apiStyle} 不一致，已按运行时事实覆盖`,
    );
  }
  meta.agentModel = model;
  meta.agentApiStyle = parent.apiStyle;
  if (parent.provenance) meta.parentExecutionProvenance = parent.provenance;
  rawSheet.meta = meta;
  return warnings;
}

/**
 * 完整 BeatSheet 是原子版本：next 是本次唯一权威合同。旧合同不参与合并或语义比较。
 */
export function selectAuthoritativeAdaptationContract(input: {
  previous: AdaptationStrategyDecl | null;
  next: AdaptationStrategyDecl;
}): {
  contract: AdaptationStrategyDecl;
  warnings: string[];
  status: "created" | "replaced" | "replaced_with_warnings";
} {
  return {
    contract: input.next,
    warnings: [],
    status: input.previous ? "replaced" : "created",
  };
}

export const BEAT_SHEET_ARTIFACT_KEY = "beat_sheet";
export const clipArtifactKey = (clipIndex: number): string => `clip:${clipIndex}`;

export type ReadyClipArtifactSeed = {
  targetClipIndex: number;
  sourceRunId: string;
  sourceClipIndex: number;
  contentHash: string;
  payload: string;
};

function parseRecordJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * 已渲染 clip 只有在冻结 writer 工件与目标 BeatSheet 的输入指纹、绝对镜号和输出哈希
 * 全部逐字一致时才可跨 run 复用。媒体成功本身不能替代 authoring 工件证据。
 */
export function readyClipArtifactSeedMatches(input: {
  seed: ReadyClipArtifactSeed;
  targetClipIndex: number;
  targetSourceHash: string;
}): boolean {
  if (
    input.seed.targetClipIndex !== input.targetClipIndex ||
    input.seed.sourceClipIndex !== input.targetClipIndex ||
    !input.seed.contentHash ||
    !input.seed.payload
  ) {
    return false;
  }
  const payload = parseRecordJson(input.seed.payload);
  if (!payload) return false;
  const clip = payload.clip;
  const clipRecord = clip && typeof clip === "object" && !Array.isArray(clip)
    ? clip as Record<string, unknown>
    : null;
  return (
    readTrimmed(payload.sourceHash) === input.targetSourceHash &&
    readNonNegativeIndex(payload.clipIndex) === input.targetClipIndex &&
    readNonNegativeIndex(clipRecord?.clipIndex) === input.targetClipIndex &&
    readTrimmed(payload.outputHash) === input.seed.contentHash
  );
}

export type BeatSheetCommitTargetIssue = {
  code: "run_scope_mismatch" | "run_already_completed" | "run_production_state_locked";
  message: string;
  terminal: boolean;
};

/** 纯结构门：commit_beats 只能写同一 owner、同一作用域、尚未进入生产的 collecting run。 */
export function validateBeatSheetCommitTarget(input: {
  existing: Pick<VideoRunRow, "owner_id" | "project_id" | "chapter_id" | "flow_id" | "state"> | null;
  ownerId: string;
  projectId?: string | null;
  chapterId?: string;
  flowId?: string;
  runId: string;
}): BeatSheetCommitTargetIssue | null {
  const existing = input.existing;
  if (!existing) return null;
  const scopeMismatch =
    existing.owner_id !== input.ownerId ||
    (Boolean(input.projectId) && Boolean(existing.project_id) && input.projectId !== existing.project_id) ||
    (Boolean(input.chapterId) && Boolean(existing.chapter_id) && input.chapterId !== existing.chapter_id) ||
    (Boolean(input.flowId) && Boolean(existing.flow_id) && input.flowId !== existing.flow_id);
  if (scopeMismatch) {
    return {
      code: "run_scope_mismatch",
      message: `runId「${input.runId}」不属于当前用户或当前画布作用域，禁止覆盖。`,
      terminal: true,
    };
  }
  if (existing.state === "concatenated") {
    return {
      code: "run_already_completed",
      message: `runId「${input.runId}」已完成拼接，禁止用 commit_beats 覆盖已生成资产。`,
      terminal: true,
    };
  }
  if (existing.state !== VIDEO_RUN_COLLECTING_STATE) {
    return {
      code: "run_production_state_locked",
      message: `runId「${input.runId}」生产态为 ${existing.state}，禁止重写 BeatSheet 或清空现有生产事实。`,
      terminal: true,
    };
  }
  return null;
}

/**
 * 公开 loop 的唯一前置阶段：只验证并冻结完整 BeatSheet，不创建 run、不派 writer、
 * 不生成图片，也不触碰供应商。资产 DAG 只能消费返回的 preflight revision/fingerprint。
 */
export async function orchestrateVideoPreflightBeats(input: {
  bodyArgs: unknown;
  parentAgentExecution?: ParentAgentExecution;
  requestUserId?: string;
  flowId?: string;
  chapterId?: string;
  projectId?: string | null;
  chapterText?: string;
  sourceAuthority: BeatSheetSourceAuthority;
  generationContract?: VideoGenerationContract;
	c?: AppContext;
}): Promise<Record<string, unknown>> {
  const args = input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
    ? input.bodyArgs as Record<string, unknown>
    : {};
  const suppliedSheet = args.beatSheet && typeof args.beatSheet === "object" && !Array.isArray(args.beatSheet)
    ? args.beatSheet as Record<string, unknown>
    : null;
  const runId = readTrimmed(args.runId) || readTrimmed(suppliedSheet?.runId);
  if (!suppliedSheet) {
    return {
      ok: false,
      severity: "warning",
      terminal: false,
      mode: "preflight_beats",
      code: "beat_sheet_required",
      message: "preflight_commit 必须汇编出完整 BeatSheet；不会从历史 run 或其它 draft 猜测。",
      nextAction: "preflight_put_beat",
    };
  }
  if (!runId) {
    return {
      ok: false,
      terminal: false,
      mode: "preflight_beats",
      code: "run_id_required",
      message: "preflight_commit 必须提供稳定 runId。",
    };
  }
  suppliedSheet.runId = runId;
  if (input.chapterId && !readTrimmed(suppliedSheet.chapterId)) suppliedSheet.chapterId = input.chapterId;

  const parentModel = readTrimmed(input.parentAgentExecution?.model);
  const parentApiStyle = input.parentAgentExecution?.apiStyle;
  const parentProvenance = input.parentAgentExecution?.provenance;
  if (
    !parentModel ||
    (parentApiStyle !== "chat" && parentApiStyle !== "responses") ||
    !parentProvenance ||
    parentProvenance.model !== parentModel ||
    parentProvenance.apiStyle !== parentApiStyle
  ) {
    return {
      ok: false,
      terminal: false,
      mode: "preflight_beats",
      code: "parent_agent_provenance_required",
      runId,
      message: "preflight_commit 缺少当前父代理的真实 execution provenance。",
    };
  }
  const modelInheritanceWarnings = applyParentAgentExecution(suppliedSheet, {
    model: parentModel,
    apiStyle: parentApiStyle,
    provenance: parentProvenance,
  });
  if (!input.generationContract) {
    return {
      ok: false,
      terminal: false,
      mode: "preflight_beats",
      code: "video_generation_contract_required",
      runId,
      message: "preflight_commit 缺少当前启用模型目录解析出的 generationContract。",
    };
  }
  const sheetMeta =
    suppliedSheet.meta && typeof suppliedSheet.meta === "object" && !Array.isArray(suppliedSheet.meta)
      ? suppliedSheet.meta as Record<string, unknown>
      : {};
  sheetMeta.videoModel = input.generationContract.videoModel;
  sheetMeta.generationContract = input.generationContract;
  try {
    const executionSpecs = resolveVideoExecutionSpecs(sheetMeta);
    sheetMeta.aspect = executionSpecs.aspect;
    sheetMeta.resolution = executionSpecs.resolution;
  } catch (error) {
    return {
      ok: false,
      terminal: false,
      mode: "preflight_beats",
      code: "video_execution_specs_invalid",
      runId,
      message:
        `当前用户交付合同无法冻结视频比例/分辨率：${String((error as Error).message || error)}。` +
        "必须修正当前 userIntentContract.delivery，禁止使用默认规格继续。",
    };
  }
  delete sheetMeta.styleReferenceImageUrl;
	delete sheetMeta.projectLookBible;
	if (input.c && input.projectId && input.requestUserId) {
		const activeLookBible = await getActiveProjectLookBibleForUser(
			input.c,
			input.requestUserId,
			input.projectId,
		);
		if (activeLookBible) {
				sheetMeta.projectLookBible = {
					assetId: activeLookBible.assetId,
					revision: activeLookBible.revision,
					name: activeLookBible.lookBible.name,
					lookBibleHash: activeLookBible.lookBibleHash,
					availableSectionIds: activeLookBible.lookBible.sections.map((section) => section.id),
				};
		}
	}
  suppliedSheet.meta = sheetMeta;

  const suppliedBeatCount = Array.isArray(suppliedSheet.beats) ? suppliedSheet.beats.length : 0;
  let providerSubmissionTopology: VideoProviderSubmissionTopology | null;
  let expectedBeatCount: number;
  try {
    const preflightSubmissionTopology = resolveVideoPreflightSubmissionTopology({
      deliveryScope: sheetMeta.deliveryScope,
      requestedExpectedBeatCount: suppliedBeatCount,
      userIntentContract: sheetMeta.userIntentContract,
      generationContract: input.generationContract,
    });
    providerSubmissionTopology = preflightSubmissionTopology.providerSubmissionTopology;
    expectedBeatCount = preflightSubmissionTopology.expectedBeatCount;
    if (providerSubmissionTopology) {
      sheetMeta.targetDurationSeconds = providerSubmissionTopology.targetDurationSeconds;
    } else {
      delete sheetMeta.targetDurationSeconds;
    }
  } catch (error) {
    return {
      ok: false,
      terminal: false,
      mode: "preflight_beats",
      code: "video_provider_submission_topology_invalid",
      runId,
      message: String((error as Error).message || error),
    };
  }
  if (providerSubmissionTopology && suppliedBeatCount !== expectedBeatCount) {
    return {
      ok: false,
      severity: "warning",
      terminal: false,
      mode: "preflight_beats",
      code: "video_provider_submission_topology_mismatch",
      runId,
      suppliedBeatCount,
      providerSubmissionTopology,
      nextAction: "preflight_begin",
      message:
        `当前 draft 把 ${suppliedBeatCount} 个创意阶段投影成了供应商 clip，但实时模型合同要求 ` +
        `${expectedBeatCount} 个 clip（最少提交时长 ` +
        `[${providerSubmissionTopology.minimumClipDurations.join(",")}] 秒）。` +
        "请保留当前 run 作为审计证据，在同一逻辑任务内重新 preflight_begin；把多个叙事阶段组织到每个 provider clip 的内部 shotSequence，不得重复提交 Agent API job。",
    };
  }

  const ownerId = readTrimmed(input.requestUserId);
  if (!ownerId) {
    return {
      ok: false,
      terminal: false,
      mode: "preflight_beats",
      code: "owner_required",
      runId,
      message: "preflight_commit 缺少用户上下文。",
    };
  }
  if (
    input.sourceAuthority.ownerId !== ownerId ||
    input.sourceAuthority.runId !== runId
  ) {
    return {
      ok: false,
      terminal: false,
      mode: "preflight_beats",
      code: "beat_sheet_source_authority_mismatch",
      runId,
      message: "preflight_commit 的 source authority 与当前 owner/run 不一致。",
    };
  }
  const chapterText = input.sourceAuthority.text;
  const validation = validateBeatSheet(suppliedSheet, chapterText, {
    generationContract: input.generationContract,
    phase: "planning",
  });
  if (!validation.ok) {
    const maxReportedErrors = 32;
    const reportedErrors = validation.errors.slice(0, maxReportedErrors);
    const omittedErrorCount = Math.max(validation.errors.length - reportedErrors.length, 0);
    const rawBeats = Array.isArray(suppliedSheet.beats) ? suppliedSheet.beats : null;
    const firstBeat = rawBeats?.[0];
    const firstBeatRecord =
      firstBeat && typeof firstBeat === "object" && !Array.isArray(firstBeat)
        ? firstBeat as Record<string, unknown>
        : null;
    return {
      ok: false,
      severity: "warning",
      terminal: false,
      mode: "preflight_beats",
      code: "beat_sheet_preflight_invalid",
      runId,
      errors: reportedErrors,
      ...(validation.warnings.length ? { warnings: validation.warnings } : {}),
      diagnostics: {
        validationErrorCount: validation.errors.length,
        reportedErrorCount: reportedErrors.length,
        ...(omittedErrorCount > 0 ? { omittedErrorCount, errorsTruncated: true } : {}),
        beatSheetRootKeys: Object.keys(suppliedSheet).sort(),
        beatCount: rawBeats?.length ?? 0,
        firstBeatType: firstBeat === null ? "null" : Array.isArray(firstBeat) ? "array" : typeof firstBeat,
        firstBeatKeys: firstBeatRecord ? Object.keys(firstBeatRecord).sort() : [],
      },
      nextAction: "preflight_put_beat",
      message:
        `BeatSheet preflight 发现 ${validation.errors.length} 项待补内容（warning）。` +
        (omittedErrorCount > 0 ? ` 本次先返回前 ${reportedErrors.length} 项，剩余 ${omittedErrorCount} 项将在后续同链预检中继续暴露。` : "") +
        `请在同一 agents 执行链内只重写错误所属 beat，再调用 preflight_commit；不要先生成资产。`,
    };
  }
  const record = await saveBeatSheetPreflight({
    ownerId,
    runId,
    beatSheet: suppliedSheet,
    sourceFingerprint: input.sourceAuthority.fingerprint,
  });
  return {
    ok: true,
    terminal: false,
    mode: "preflight_beats",
    runId,
    preflightRevision: record.revision,
    preflightFingerprint: record.fingerprint,
    beats: validation.normalized.beats.length,
    ...(validation.warnings.length ? { warnings: validation.warnings } : {}),
    ...(modelInheritanceWarnings.length ? { modelInheritanceWarnings } : {}),
    message:
      "BeatSheet preflight_commit 已通过并冻结。现在才允许按同一 runId 建立资产 DAG；" +
      "资产真实 URL/节点回填后，必须携带 preflightRevision 与 preflightFingerprint 调用 mode:'loop'。",
  };
}

/**
 * mode:"commit_beats" 入口。args = { runId, beatSheet }。
 * 成功：落 run 行（collecting+authoring_state=beats_committed）+ 产物登记 + 章级合同写入/diff。
 */
export function resolveCommitBeatSheetValidationPhase(input: {
  verifiedFrozenPreflight: boolean;
}): BeatSheetValidationPhase {
  return input.verifiedFrozenPreflight ? "planning" : "execution";
}

export async function orchestrateVideoCommitBeats(input: {
  bodyArgs: unknown;
  parentAgentExecution?: ParentAgentExecution;
  requestUserId?: string;
  flowId?: string;
  chapterId?: string;
  projectId?: string | null;
  chapterText?: string;
  generationContract?: VideoGenerationContract;
  readyClipArtifactSeeds?: ReadyClipArtifactSeed[];
  requirePreflight?: boolean;
  c?: AppContext;
  devBypass?: boolean;
}): Promise<Record<string, unknown>> {
  const args = (input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
    ? input.bodyArgs
    : {}) as Record<string, unknown>;
  const suppliedSheet = (args.beatSheet && typeof args.beatSheet === "object" ? args.beatSheet : null) as
    | Record<string, unknown>
    | null;
  const requestedRunId = readTrimmed(args.runId) || readTrimmed(suppliedSheet?.runId);
  const rawSheet = suppliedSheet;
  if (!rawSheet) {
    return {
      ok: false,
      mode: "commit_beats",
      code: "beat_sheet_required",
      message:
        'commit_beats 需带 Keyframe BeatSheet v2：根级必须完整提交 storyFactsContext（独立任务使用 task_context 分支），每拍必须完整提交 storyFactLocks（无消费也传 effectiveAt:null、bindings:[]、revealGuards:[]），以及 clipIndex/logline/startKeyframe/endKeyframe/exitState/rhythmRole/durationBudget/sourceStartMarker/sourceEndMarker/characterRoleNames/speakerNames，根级还需 filmBible/adaptationStrategy/castManifest/meta。原文逐字发声写入 dialogueScript；agents 基于当前剧情作出的源事实旁白/内心声裁决独立写入可选 narrativeAudioPlan；speakerNames 由两者合并投影，合并后单 clip 最多 3 人。服务端按 clip 独立派 writer，只做结构校验，不做语义评分；writer 必须在唯一模型提交内完成创作、自检与最终定稿，Hono 不把复盘证据变成生产门禁。结构或确定性字符串预算失败时只记录原始候选、哈希与精确拒因，并立即结束该 clip；禁止把错误回传模型、局部纠正、候选合并、同 run 重派、转成 waiting 或新增预算。',
    };
  }
  const runId = requestedRunId || readTrimmed(rawSheet.runId);
  if (!runId) {
    return { ok: false, mode: "commit_beats", code: "run_id_required", message: "runId 必填" };
  }
  rawSheet.runId = runId;
  if (input.chapterId && !readTrimmed(rawSheet.chapterId)) rawSheet.chapterId = input.chapterId;

  const parentModel = readTrimmed(input.parentAgentExecution?.model);
  const parentApiStyle = input.parentAgentExecution?.apiStyle;
  const parentProvenance = input.parentAgentExecution?.provenance;
  if (
    !parentModel || (parentApiStyle !== "chat" && parentApiStyle !== "responses") ||
    !parentProvenance || parentProvenance.model !== parentModel || parentProvenance.apiStyle !== parentApiStyle
  ) {
    return {
      ok: false,
      mode: "commit_beats",
      code: "parent_agent_provenance_required",
      runId,
      message:
        "commit_beats 缺少与父代理真实 model/apiStyle 一致的 execution provenance，禁止依赖 BeatSheet 自报执行身份或事后猜测知识来源。",
    };
  }
  const modelInheritanceWarnings = applyParentAgentExecution(rawSheet, {
    model: parentModel,
    apiStyle: parentApiStyle,
    provenance: parentProvenance,
  });
  if (!input.generationContract) {
    return {
      ok: false,
      mode: "commit_beats",
      code: "video_generation_contract_required",
      runId,
      message:
        "commit_beats 缺少由当前启用视频模型目录解析出的 generationContract，禁止使用写死时长或环境变量继续。",
    };
  }
  const sheetMeta =
    rawSheet.meta && typeof rawSheet.meta === "object" && !Array.isArray(rawSheet.meta)
      ? (rawSheet.meta as Record<string, unknown>)
      : {};
  sheetMeta.videoModel = input.generationContract.videoModel;
  sheetMeta.generationContract = input.generationContract;
  delete sheetMeta.styleReferenceImageUrl;
  rawSheet.meta = sheetMeta;

  const ownerId = readTrimmed(input.requestUserId);
  if (!ownerId) {
    return { ok: false, mode: "commit_beats", code: "owner_required", message: "缺用户上下文" };
  }
  let preflightRecord: BeatSheetPreflight | null = null;
  let preflightSourceAuthority: BeatSheetSourceAuthority | null = null;
  if (input.requirePreflight === true) {
    const preflightRevision = readTrimmed(args.preflightRevision);
    const preflightFingerprint = readTrimmed(args.preflightFingerprint);
    if (!preflightRevision || !preflightFingerprint) {
      return {
        ok: false,
        terminal: false,
        mode: "commit_beats",
        code: "beat_sheet_preflight_required",
        runId,
        nextAction: "preflight_commit",
        message:
          "完整成片必须先完成 preflight_begin -> preflight_put_beat -> preflight_commit 并携带其 preflightRevision/preflightFingerprint；" +
          "loop 不再接受先生成资产、再由 commit_beats 追认计划。",
      };
    }
    try {
      preflightRecord = await readBeatSheetPreflight(ownerId, runId);
    } catch (error) {
      return {
        ok: false,
        terminal: false,
        mode: "commit_beats",
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "beat_sheet_preflight_read_failed",
        runId,
        nextAction: "preflight_commit",
        message: String((error as Error).message || error),
      };
    }
    if (
      preflightRecord.ownerId !== ownerId ||
      preflightRecord.runId !== runId ||
      preflightRecord.revision !== preflightRevision ||
      preflightRecord.fingerprint !== preflightFingerprint
    ) {
      return {
        ok: false,
        terminal: false,
        mode: "commit_beats",
        code: "beat_sheet_preflight_evidence_mismatch",
        runId,
        nextAction: "preflight_commit",
        expected: {
          revision: preflightRecord.revision,
          fingerprint: preflightRecord.fingerprint,
        },
        message: "BeatSheet preflight 证据不是当前 run 的最新冻结记录；请用当前完整合同重新 preflight。",
      };
    }
    try {
      preflightSourceAuthority = await readBeatSheetSourceAuthority(ownerId, runId);
    } catch (error) {
      return {
        ok: false,
        terminal: false,
        mode: "commit_beats",
        code: "beat_sheet_source_authority_read_failed",
        runId,
        nextAction: "preflight_begin",
        message: String((error as Error).message || error),
      };
    }
    if (preflightSourceAuthority.fingerprint !== preflightRecord.sourceFingerprint) {
      return {
        ok: false,
        terminal: false,
        mode: "commit_beats",
        code: "beat_sheet_source_authority_mismatch",
        runId,
        nextAction: "preflight_begin",
        message: "冻结 BeatSheet 与 source authority 指纹不一致，禁止执行另一份来源。",
      };
    }
    // The stored fingerprint is the immutable receipt identity presented by
    // the caller. Plan equivalence is a separate comparison: canonicalize the
    // frozen sheet and the resumed sheet with the same current projection so
    // physical-run provenance cannot masquerade as a creative plan change.
    const frozenPlanFingerprint = buildBeatSheetPreflightFingerprint(preflightRecord.beatSheet);
    const currentFingerprint = buildBeatSheetPreflightFingerprint(rawSheet);
    if (currentFingerprint !== frozenPlanFingerprint) {
      return {
        ok: false,
        terminal: false,
        mode: "commit_beats",
        code: "beat_sheet_preflight_plan_changed",
        runId,
        nextAction: "preflight_commit",
        expectedFingerprint: frozenPlanFingerprint,
        actualFingerprint: currentFingerprint,
        message:
          "资产阶段之后提交的 BeatSheet 创作合同已变化；必须以新的完整合同重新 preflight，禁止用 loop 迟到修订。",
      };
    }
  }
  const failWithoutPatch = (failure: Record<string, unknown>): Record<string, unknown> => ({
    ...failure,
    terminal: false,
    nextAction: "preflight_commit",
    message:
      `${String(failure.message ?? "BeatSheet 执行前确定性验真失败")}；` +
      "不生成局部 patch，请在同一 agents 执行链内重写错误 beat 并重新 preflight_commit。",
  });
  const existing = await getVideoRun(runId);
  const targetIssue = validateBeatSheetCommitTarget({
    existing,
    ownerId,
    projectId: input.projectId,
    chapterId: input.chapterId,
    flowId: input.flowId,
    runId,
  });
  if (targetIssue) {
    return {
      ok: false,
      mode: "commit_beats",
      code: targetIssue.code,
      terminal: targetIssue.terminal,
      runId,
      message: targetIssue.message,
    };
  }

  // 【chapterText 服务端权威自加载·2026-07-13 ch24 根治】commit_beats 断供原文时，锚点代修/
  // 台词条数机检/原文跨度物化（sourceSpanText 进 writer 任务书）全部静默失效——入口兜底自读。
  const chapterText =
	preflightSourceAuthority?.text ||
	String(input.chapterText ?? "").trim() ||
    (await resolveChapterTextForOrchestrate({
      chapterId: input.chapterId ?? null,
      projectId: input.projectId ?? null,
      ownerId: input.requestUserId ?? null,
    }));
  const validationPhase = resolveCommitBeatSheetValidationPhase({
    verifiedFrozenPreflight: preflightRecord !== null,
  });
  const v = validateBeatSheet(rawSheet, chapterText, {
    generationContract: input.generationContract,
    phase: validationPhase,
  });
  if (!v.ok) {
    return failWithoutPatch({
      ok: false,
      terminal: true,
      mode: "commit_beats",
      code: "beat_sheet_invalid",
      runId,
      errors: v.errors,
      ...(v.warnings.length ? { warnings: v.warnings } : {}),
      message: `BeatSheet commit 验真未过（${v.errors.length} 项确定性问题）：${v.errors.slice(0, 5).join("；")}`,
    });
  }
  const sheet: BeatSheet = v.normalized;
  if (preflightRecord) {
    const meta = (sheet.meta ?? {}) as Record<string, unknown>;
    meta.preflightRevision = preflightRecord.revision;
    meta.preflightFingerprint = preflightRecord.fingerprint;
    sheet.meta = meta as BeatSheet["meta"];
  }
  let needsVisualAssetVerification = sheet.beats.some(
    (beat) =>
      Boolean(beat.blockingFrameNodeId) ||
      Boolean(beat.storyboardImageNodeId),
  );
  const scopedFlowId = readTrimmed(input.chapterId) || readTrimmed(input.flowId);

  const bindBeatKeyframes = (nodes: ReturnType<typeof readFlowNodes>) =>
    bindExplicitClipKeyframes({
      runId,
      clips: sheet.beats,
      nodes,
      clipIndexFor: (beat) => beat.clipIndex,
      existingNodeIdFor: (beat) => readTrimmed(beat.storyboardImageNodeId),
      existingFrameCountFor: (beat) => {
        const count = Number(beat.storyboardFrameCount);
        return Number.isInteger(count) && count >= 1 && count <= 3 ? count : undefined;
      },
      withBinding: (beat, binding) => ({
        ...beat,
        storyboardImageNodeId: binding.nodeId,
        ...(binding.storyboardFrameCount !== undefined && beat.storyboardFrameCount === undefined
          ? { storyboardFrameCount: binding.storyboardFrameCount }
          : {}),
      }),
    });

  // When an image was explicitly authored for this run/clip but the BeatSheet
  // omitted its node id, recover the handoff from exact node metadata before
  // the normal visual-asset verifier runs. No label/prompt/position inference.
  if (!needsVisualAssetVerification && input.c && scopedFlowId) {
    try {
      const row = await freshReadFlowRow({
        c: input.c,
        flowId: scopedFlowId,
        requestUserId: ownerId,
        devBypass: input.devBypass === true,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      });
      const bindingResult = bindBeatKeyframes(readFlowNodes(row));
      if (!bindingResult.ok) {
        return failWithoutPatch(
          {
            ok: false,
            terminal: true,
            mode: "commit_beats",
            code: "beat_keyframe_binding_invalid",
            runId,
            details: bindingResult.details,
            message: `${bindingResult.message} 尚未派发 writer。`,
          },
        );
      }
      if (bindingResult.bindings.length > 0) {
        sheet.beats = bindingResult.clips;
        needsVisualAssetVerification = true;
        console.log(
          `[clip-keyframe-binding] commit_beats runId=${runId} ` +
            bindingResult.bindings
              .map((binding) => `clip=${binding.clipIndex}:node=${binding.nodeId}`)
              .join(","),
        );
      }
    } catch (error) {
      return {
        ok: false,
        mode: "commit_beats",
        code: "beat_keyframe_binding_canvas_read_failed",
        runId,
        message: `无法读取当前授权画布完成关键帧 clip 绑定：${String(
          (error as Error).message || error,
        )}`,
      };
    }
  }
  if (needsVisualAssetVerification) {
    if (!input.c || !scopedFlowId) {
      return {
        ok: false,
        mode: "commit_beats",
        code: "beat_visual_asset_scope_required",
        runId,
        message:
          "BeatSheet 声明了站位/关键帧节点，但提交链缺少当前授权画布上下文，禁止绕过真实资产验真。",
      };
    }
    try {
      const row = await freshReadFlowRow({
        c: input.c,
        flowId: scopedFlowId,
        requestUserId: ownerId,
        devBypass: input.devBypass === true,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      });
      const nodes = readFlowNodes(row);
      const bindingResult = bindBeatKeyframes(nodes);
      if (!bindingResult.ok) {
        return failWithoutPatch(
          {
            ok: false,
            terminal: true,
            mode: "commit_beats",
            code: "beat_keyframe_binding_invalid",
            runId,
            details: bindingResult.details,
            message: `${bindingResult.message} 尚未派发 writer。`,
          },
        );
      }
      sheet.beats = bindingResult.clips;
      const materialized = materializeBeatBlockingContexts({ beats: sheet.beats, nodes });
      const selectedKeyframeNodeIds = new Set(
        sheet.beats.map((beat) => readTrimmed(beat.storyboardImageNodeId)).filter(Boolean),
      );
      const keyframeTaskIds = nodes
        .filter((node) => selectedKeyframeNodeIds.has(readTrimmed(node.id)))
        .map((node) => {
          const data =
            node.data && typeof node.data === "object" && !Array.isArray(node.data)
              ? (node.data as Record<string, unknown>)
              : {};
          return readTrimmed(data.taskId) || readTrimmed(data.imageTaskId);
        })
        .filter(Boolean);
      const generationReferenceUrlsByTaskId =
        await loadImageGenerationReferenceUrlsByTaskId({
          ownerId,
          taskIds: keyframeTaskIds,
        });
      const keyframeIssues = validateBeatKeyframeReferences({
        beats: sheet.beats,
        nodes,
        generationReferenceUrlsByTaskId,
      });
      if (!materialized.ok || keyframeIssues.length) {
        const issues = [
          ...(!materialized.ok ? materialized.issues : []),
          ...keyframeIssues,
        ];
        return failWithoutPatch({
          ok: false,
          terminal: true,
          mode: "commit_beats",
          code: "beat_visual_asset_invalid",
          runId,
          issues,
          message: `站位/关键帧资产验真失败（${issues.length} 项），尚未派发 writer：${issues
            .slice(0, 5)
            .map((issue) => issue.message)
            .join("；")}`,
        });
      }
      sheet.beats = materialized.beats;
      if (/seedance/i.test(input.generationContract.videoModel)) {
        const referenceClips: StoryPlanClip[] = sheet.beats.map((beat) => ({
          clipPrompt: beat.logline,
          characterRoleNames: [...beat.characterRoleNames],
          ...(beat.propNames?.length ? { propNames: [...beat.propNames] } : {}),
          ...(beat.sceneName ? { sceneName: beat.sceneName } : {}),
          ...(beat.characterStates
            ? { characterStates: { ...beat.characterStates } }
            : {}),
          videoReferenceNodeIds: buildBeatVideoReferenceNodeIds(beat),
          continuityMode: beat.continuityMode,
          ...(beat.storyboardImageNodeId
            ? { storyboardImageNodeId: beat.storyboardImageNodeId }
            : {}),
          ...(beat.lastFrameImageNodeId
            ? { lastFrameImageNodeId: beat.lastFrameImageNodeId }
            : {}),
        }));
        for (const [clipIndex, clip] of referenceClips.entries()) {
          const entries = resolveClipReferenceImageEntries(
            row,
            clip,
            "",
            undefined,
            computeEffectiveCharacterStates(referenceClips, clipIndex),
            { authority: "explicit_only" },
          );
          const budget = validateSd2ClipReferenceBudget({
            clipIndex,
            businessReferenceImages: entries.map((entry) => entry.url),
			maximumBusinessReferences: input.generationContract.referenceImagePolicy.maximumBusinessImages,
          });
          if (!budget.ok) {
            return failWithoutPatch({
              ok: false,
              terminal: true,
              mode: "commit_beats",
              code: "clip_reference_budget_exceeded",
              runId,
              clipIndex,
              actualBusinessReferences: budget.actualBusinessReferences,
              maximumBusinessReferences: budget.maximumBusinessReferences,
              message: `${budget.message}；尚未写入 run、派发 writer、估算或提交视频。`,
            });
          }
        }
      }
    } catch (error) {
      return {
        ok: false,
        mode: "commit_beats",
        code: "beat_visual_asset_read_failed",
        runId,
        message: `无法读取当前授权画布完成站位/关键帧验真：${String(
          (error as Error).message || error,
        )}`,
      };
    }
  }
  // 原文跨度物化进节拍：在首次派发前把必要事实完整交给单 clip writer。
  enrichBeatsWithSourceSpans(sheet, chapterText);
  const nowIso = new Date().toISOString();

  // 章级 film_spec 只合并交付范围；模型、画幅和分辨率必须已经由 agents 从本轮生成偏好与实时目录冻结。
  const specWarnings: string[] = [];
  if (input.chapterId) {
    try {
      const spec = await getChapterFilmSpec(input.chapterId);
      if (spec) {
        const meta = (sheet.meta ?? {}) as Record<string, unknown>;
        specWarnings.push(...mergeFilmSpecAuthority(meta, spec));
        sheet.meta = meta as BeatSheet["meta"];
        // 【题材真源持久化·2026-07-17 用户拍板「按原文选 domain」】meta.filmGenre 申报落章级
        // film_spec（回读补缺双向）：spec 有值补 meta 缺失；meta 申报了新值则持久化——bridge 组装
        // 知识检索上下文（knowledgeContext）按此命中题材知识卡，filmGenre 从装饰变真源。
        const metaGenre = String(meta.filmGenre ?? "").trim();
        const specGenre = String(spec.filmGenre ?? "").trim();
        if (!metaGenre && specGenre) {
          meta.filmGenre = specGenre;
        } else if (metaGenre && metaGenre !== specGenre && input.requestUserId) {
          await setChapterFilmSpec({
            chapterId: input.chapterId,
            ownerId: input.requestUserId,
            spec: { ...spec, filmGenre: metaGenre },
            nowIso,
          }).catch(() => false);
        }
      }
    } catch {
      /* best-effort */
    }
  }

  // 章级合同：完整 BeatSheet 原子替换；旧版仅作 diff 告警，不回灌污染当前版本。
  const contractWarnings: string[] = [];
  let contractStatus = "none";
  if (input.chapterId) {
    const existingContract = await getChapterAdaptationContract(input.chapterId);
    if (!existingContract) {
      await setChapterAdaptationContract({
        chapterId: input.chapterId,
        contractJson: JSON.stringify(sheet.adaptationStrategy ?? {}),
        nowIso,
      });
      contractStatus = "created";
    } else {
      let contract: AdaptationStrategyDecl = {};
      try {
        contract = JSON.parse(existingContract) as AdaptationStrategyDecl;
      } catch {
        contract = {};
      }
      const selected = selectAuthoritativeAdaptationContract({
        previous: contract,
        next: sheet.adaptationStrategy ?? {},
      });
      contractWarnings.push(...selected.warnings);
      sheet.adaptationStrategy = selected.contract;
      await setChapterAdaptationContract({
        chapterId: input.chapterId,
        contractJson: JSON.stringify(selected.contract),
        nowIso,
      });
      contractStatus = selected.status;
    }
  }

  // 【同章 supersede·2026-07-14 ch26 双 run 并行写作实证（v1+v2 同时 writing_dispatched 双烧 LLM）】
  // 同章新 commit_beats = 用户最新意图——旧的非终态编排 run 自动归档（authoring_done + 注记），
  // 驱动 tick 不再认领；生产态不动（已 start 的 run 不受影响，start 语义归用户）。
  const supersedeNotes: string[] = [];
  if (input.chapterId) {
    try {
      const prisma = (await import("../../platform/node/prisma")).getPrismaClient();
      const siblings = await prisma.video_runs.findMany({
        where: {
          chapter_id: input.chapterId,
          id: { not: runId },
          state: VIDEO_RUN_COLLECTING_STATE,
          authoring_state: { notIn: ["authoring_done", "authoring_failed"] as string[], not: null },
        },
        select: { id: true, authoring_state: true },
      });
      for (const sib of siblings) {
        const ok = await advanceAuthoringState({
          runId: sib.id,
          from: (sib.authoring_state ?? "beats_committed") as never,
          to: "authoring_done",
          nowIso,
          errorMessage: `superseded by ${runId}（同章新 commit_beats 收编，未起跑不扣费；如需回用对该 runId 重新 commit_beats）`,
        });
        if (ok) supersedeNotes.push(sib.id);
      }
      if (supersedeNotes.length) {
        console.log(`[commit_beats] runId=${runId} 同章旧编排 run 已收编: ${supersedeNotes.join(", ")}`);
      }
    } catch {
      /* best-effort：收编失败不阻断提交 */
    }
  }

  const beatSheetJson = JSON.stringify(sheet);
  const filmBibleJson = JSON.stringify(sheet.filmBible);
  const strategyJson = JSON.stringify(sheet.adaptationStrategy ?? {});
  // 【世界书未定稿软提醒·2026-07-14 用户拍板「不强制只反复提醒」】书级项目未定稿时随响应提醒，
  // 不拦不改状态机；非书级 chapterId / projectId 缺失 → null 短路。
  let worldBibleWarning: string | null = null;
  if (input.chapterId && input.projectId) {
    worldBibleWarning = await getWorldBibleReminderForChapter({
      projectId: input.projectId,
      ownerId,
      chapterId: input.chapterId,
    }).catch(() => null);
  }

  // 产物登记：同一个 authoring_artifacts 存储既保存产物，也保存本 run 的版本化 DAG。
  // 节点种类固定、clip:N 按 BeatSheet 动态展开；worker 不再从聊天历史猜依赖关系。
  const sheetHash = stableContentHash(sheet);
  const graphArtifacts: AuthoringGraphCommitArtifact[] = [{
    runId,
    artifactKey: BEAT_SHEET_ARTIFACT_KEY,
    contentHash: sheetHash,
    status: "ready",
    nowIso,
  }];
  const clipTasks = splitBeatClipTasks(sheet.beats);
  const executionScope = readBeatSheetExecutionScope(sheet) ?? (() => {
    throw new Error("beat_sheet_execution_scope_missing");
  })();
  const authoringGraph = compileVideoAuthoringGraph({
    runId,
    clipIndexes: clipTasks.map((task) => task.clipIndex),
    executionScope,
  });
  const graphValidation = validateVideoAuthoringGraph(authoringGraph);
  if (!graphValidation.ok) {
    throw new Error(`${graphValidation.code}:${graphValidation.message}`);
  }
  graphArtifacts.push({
    runId,
    artifactKey: AUTHORING_GRAPH_MANIFEST_ARTIFACT_KEY,
    contentHash: stableContentHash(authoringGraph),
    derivedFrom: [AUTHORING_BEAT_SHEET_NODE_KEY],
    status: "ready",
    payload: JSON.stringify(authoringGraph),
    error: null,
    nowIso,
  });
  // 输入指纹未变且已 ready 的 clip 不重置；输出指纹独立保存在 content_hash。
  const existingArtifacts = await listAuthoringArtifacts(runId);
  const existingByKey = new Map(existingArtifacts.map((artifact) => [artifact.artifact_key, artifact]));
  const readySeedByClipIndex = new Map(
    (input.readyClipArtifactSeeds ?? []).map((seed) => [seed.targetClipIndex, seed] as const),
  );
  const preservedReadyClipIndexes: number[] = [];
  for (const task of clipTasks) {
    const clipIndex = task.clipIndex;
    const beat = sheet.beats[clipIndex];
    const key = clipArtifactKey(clipIndex);
    const sourceHash = stableContentHash({
      beat,
      filmBible: sheet.filmBible,
      adaptationStrategy: sheet.adaptationStrategy,
      writerClipContractVersion: WRITER_CLIP_CONTRACT_VERSION,
    });
    const existingArtifact = existingByKey.get(key);
    let existingSourceHash = "";
    if (existingArtifact?.payload) {
      try {
        const payload = JSON.parse(existingArtifact.payload) as Record<string, unknown>;
        existingSourceHash = readTrimmed(payload.sourceHash);
      } catch {
        existingSourceHash = "";
      }
    }
    if (
      existingArtifact?.status === "ready" &&
      readTrimmed(existingArtifact.content_hash) &&
      existingSourceHash === sourceHash
    ) {
      preservedReadyClipIndexes.push(clipIndex);
      continue;
    }
    const readySeed = readySeedByClipIndex.get(clipIndex);
    if (
      readySeed &&
      readyClipArtifactSeedMatches({
        seed: readySeed,
        targetClipIndex: clipIndex,
        targetSourceHash: sourceHash,
      })
    ) {
      graphArtifacts.push({
        runId,
        artifactKey: key,
        contentHash: readySeed.contentHash,
        derivedFrom: [executionScope === "prompt_only" ? AUTHORING_BEAT_SHEET_NODE_KEY : AUTHORING_ASSET_COVERAGE_NODE_KEY],
        status: "ready",
        payload: readySeed.payload,
        error: null,
        nowIso,
      });
      preservedReadyClipIndexes.push(clipIndex);
      continue;
    }
    graphArtifacts.push({
      runId,
      artifactKey: key,
      contentHash: sourceHash,
      derivedFrom: [executionScope === "prompt_only" ? AUTHORING_BEAT_SHEET_NODE_KEY : AUTHORING_ASSET_COVERAGE_NODE_KEY],
      status: "pending",
      payload: JSON.stringify({ clipIndex, sourceHash }),
      nowIso,
    });
  }

  const graphCommitStatus = await commitBeatSheetGraphSnapshot({
    run: {
      runId,
      ownerId,
      flowId: input.flowId ?? null,
      projectId: input.projectId ?? null,
      chapterId: input.chapterId ?? null,
      beatSheetJson,
      filmBibleJson,
      adaptationStrategyJson: strategyJson,
      nowIso,
    },
    artifacts: graphArtifacts,
  });
  if (graphCommitStatus === "already_committed") {
    return {
      ok: true,
      mode: "commit_beats",
      runId,
      authoringState: existing?.authoring_state ?? "beats_committed",
      productionState: existing?.state ?? VIDEO_RUN_COLLECTING_STATE,
      beats: sheet.beats.length,
      clips: clipTasks.map((task) => ({ clipIndex: task.clipIndex })),
      idempotent: true,
      message:
        "同一冻结 BeatSheet 已由交付图受理；并发提交已在数据库事务边界合并，未重写 DAG 或 clip artifacts。",
    };
  }
  // 与 estimate/生产链共用的叙事元数据缓存只在数据库图事务成功后更新。
  cacheAdaptationStrategyText(runId, strategyJson);
  await persistRunNarrativeMeta({ runId, ownerId, adaptationStrategyText: strategyJson, filmBibleText: filmBibleJson });

  return {
    ok: true,
    mode: "commit_beats",
    runId,
    authoringState: "beats_committed",
    beats: sheet.beats.length,
    clips: clipTasks.map((task) => ({ clipIndex: task.clipIndex })),
    preservedReadyClips: preservedReadyClipIndexes.length,
    preservedReadyClipIndexes,
    contract: contractStatus,
    ...(v.warnings.length ? { warnings: v.warnings } : {}),
    ...(contractWarnings.length ? { contractWarnings } : {}),
    ...(specWarnings.length ? { filmSpecWarnings: specWarnings } : {}),
    ...(modelInheritanceWarnings.length ? { modelInheritanceWarnings } : {}),
    ...(worldBibleWarning ? { worldBibleWarning } : {}),
    ...(supersedeNotes.length ? { supersededRuns: supersedeNotes } : {}),
    executionScope,
    message:
      `Keyframe BeatSheet v2 已入库（${sheet.beats.length} 个 clip，executionScope=${executionScope}）；后台 authoring worker 将按持久状态依次推进：` +
      (executionScope === "prompt_only"
        ? `单 clip 首稿→同上下文 reviewer 语义复盘→直接修订→确定性结构校验→冻结装配→Prompt Package；不会检查/生成资产，不会 estimate、提交供应商或 concat。`
        : `单 clip 首稿→同上下文 reviewer 语义复盘→直接修订→确定性结构校验→冻结装配→资产二次验真→estimate_ready→scheduled。`) +
      `没有独立 critic、语义评分打回、服务端改写或结构失败重派；writer 的 creativeReview 只作创作追溯。首次结构化提交失败会保留原始证据并立即停止该 clip，ready sibling 保持冻结。` +
      (contractWarnings.length ? `⚠️合同 diff：${contractWarnings.join("；")}` : ""),
  };
}

/**
 * 从同一授权作用域内已有 run 的权威 BeatSheet 初始化新 run 草稿。
 *
 * 该入口只写 Redis 草稿，不创建/修改 video_runs，也不绕过 commit 门禁。它解决超大
 * BeatSheet 无法由模型可靠地从 status 输出重新序列化到下一次工具参数的问题。
 * 该内部派生路径只供 reference_budget/prepare_beats 读取 opaque proposal；不属于公开 AI
 * 对话合同，也不参与完整成片的 preflight -> asset DAG -> loop 主路径。
 */
export async function orchestrateVideoPrepareBeats(input: {
  bodyArgs: unknown;
  parentAgentExecution?: ParentAgentExecution;
  requestUserId?: string;
  flowId?: string;
  chapterId?: string;
  projectId?: string | null;
  chapterText?: string;
  generationContract?: VideoGenerationContract;
  c?: AppContext;
  devBypass?: boolean;
}): Promise<Record<string, unknown>> {
  const args = input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
    ? input.bodyArgs as Record<string, unknown>
    : {};
  const ownerId = readTrimmed(input.requestUserId);
  const runId = readTrimmed(args.runId);
  const sourceRunId = readTrimmed(args.sourceRunId);
  const budgetRevision = readTrimmed(args.budgetRevision);
  const suppliedOperations = Array.isArray(args.operations) ? args.operations : [];
  if (suppliedOperations.length > 0) {
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: "beat_sheet_prepare_operations_forbidden",
      runId,
      sourceRunId,
      message:
        "prepare_beats 已硬切为 opaque proposal：禁止再次发送 operations；只提交 reference_budget 返回的 budgetRevision。",
    };
  }
  if (!ownerId || !runId || !sourceRunId || !budgetRevision || runId === sourceRunId) {
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: "beat_sheet_prepare_input_invalid",
      runId,
      sourceRunId,
      message:
        "prepare_beats 必须提供 reference_budget 返回的 budgetRevision、不同的 sourceRunId 与 runId，并具有当前用户上下文。",
    };
  }

  const [sourceRun, targetRun] = await Promise.all([
    getVideoRun(sourceRunId),
    getVideoRun(runId),
  ]);
  if (!sourceRun) {
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: "beat_sheet_prepare_source_not_found",
      runId,
      sourceRunId,
      message: `源 runId「${sourceRunId}」不存在。`,
    };
  }
  const sourceScopeIssue = validateBeatSheetCommitTarget({
    existing: sourceRun,
    ownerId,
    projectId: input.projectId,
    chapterId: input.chapterId,
    flowId: input.flowId,
    runId: sourceRunId,
  });
  if (sourceScopeIssue?.code === "run_scope_mismatch") {
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: sourceScopeIssue.code,
      runId,
      sourceRunId,
      message: sourceScopeIssue.message,
    };
  }
  const targetIssue = validateBeatSheetCommitTarget({
    existing: targetRun,
    ownerId,
    projectId: input.projectId,
    chapterId: input.chapterId,
    flowId: input.flowId,
    runId,
  });
  if (targetIssue) {
    return {
      ok: false,
      terminal: targetIssue.terminal,
      mode: "prepare_beats",
      code: targetIssue.code,
      runId,
      sourceRunId,
      message: targetIssue.message,
    };
  }
  if (!sourceRun.beat_sheet) {
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: "beat_sheet_prepare_source_missing",
      runId,
      sourceRunId,
      message: `源 runId「${sourceRunId}」没有已持久化 BeatSheet。`,
    };
  }

  const scopedFlowId = readTrimmed(input.chapterId) || readTrimmed(input.flowId);
  let operations: BeatSheetPatchOperation[];
  try {
    const proposal = await readReferenceBudgetProposal({
      ownerId,
      projectId: input.projectId ?? null,
      scopeId: scopedFlowId,
      sourceRunId,
      budgetRevision,
    });
    operations = proposal.operations;
  } catch (error) {
    if (error instanceof ReferenceBudgetProposalError) {
      return {
        ok: false,
        terminal: true,
        mode: "prepare_beats",
        code: error.code,
        runId,
        sourceRunId,
        message: error.message,
      };
    }
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: "reference_budget_proposal_read_failed",
      runId,
      sourceRunId,
      message: `reference_budget 权威提案读取失败：${String((error as Error).message || error)}`,
    };
  }

  const currentBudget = await orchestrateVideoReferenceBudget({
    bodyArgs: { mode: "reference_budget", sourceRunId, operations },
    requestUserId: input.requestUserId,
    flowId: input.flowId,
    chapterId: input.chapterId,
    projectId: input.projectId,
    generationContract: input.generationContract,
    c: input.c,
    devBypass: input.devBypass,
  });
  if (currentBudget.ok !== true || currentBudget.budgetRevision !== budgetRevision) {
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: currentBudget.ok === true ? "reference_budget_revision_conflict" : "reference_budget_required",
      runId,
      sourceRunId,
      ...(currentBudget.ok === true ? { expectedBudgetRevision: currentBudget.budgetRevision } : {}),
      message: currentBudget.ok === true
        ? "模型预算或画布资产 URL 已变化；必须重新读取 reference_budget 后一次性提交新的精选结果。"
        : `无法验真前置 reference_budget：${String(currentBudget.message ?? currentBudget.code ?? "unknown")}`,
    };
  }

  let beatSheet: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(sourceRun.beat_sheet);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root_not_object");
    }
    beatSheet = structuredClone(parsed as Record<string, unknown>);
  } catch (error) {
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: "beat_sheet_prepare_source_invalid",
      runId,
      sourceRunId,
      message: `源 runId「${sourceRunId}」的持久化 BeatSheet 无法解析：${String((error as Error).message || error)}`,
    };
  }
  beatSheet.runId = runId;
  if (input.chapterId) beatSheet.chapterId = input.chapterId;
  try {
    const draft = await saveBeatSheetDraft({ ownerId, runId, beatSheet });
    const patched = await patchBeatSheetDraft({
      ownerId,
      runId,
      revision: draft.revision,
      operations,
    });
    const committed = await orchestrateVideoCommitBeats({
      ...input,
      bodyArgs: { mode: "commit_beats", runId, beatSheet: patched.beatSheet },
    });
    return { ...committed, preparedFromRunId: sourceRunId };
  } catch (error) {
    if (error instanceof BeatSheetDraftError) {
      return {
        ok: false,
        terminal: true,
        mode: "prepare_beats",
        code: error.code,
        runId,
        sourceRunId,
        message: error.message,
      };
    }
    return {
      ok: false,
      terminal: true,
      mode: "prepare_beats",
      code: "beat_sheet_prepare_failed",
      runId,
      sourceRunId,
      message: `BeatSheet 派生准备失败：${String((error as Error).message || error)}`,
    };
  }
}
