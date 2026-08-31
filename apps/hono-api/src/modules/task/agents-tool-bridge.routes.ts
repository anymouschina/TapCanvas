import { createRoute, z } from "@hono/zod-openapi";
import {
  WORKFLOW_CONCURRENCY_MAX,
  WORKFLOW_CONCURRENCY_MIN,
} from "@tapcanvas/workflow-kernel-protocol";
import fs from "node:fs/promises";
import path from "node:path";
import { coerceStringifiedObjectArgs } from "./agents-tool-bridge.coerce-args";
import {
	buildToolOperationIndexParameters,
  projectToolParametersBySelector,
	readToolSchemaOperationIndex,
	readToolOperationExecution,
  type ToolSchemaSelector,
} from "./agents-tool-schema-projection";
import { resolveChapterCanvasId } from "./agents-tool-bridge.canvas-scope";
import { buildProjectChapterReadPayload } from "./agents-tool-bridge.project-chapter-read";
import { HostFlowPatchSchema, HostToolCallSchema } from "./host-canvas-protocol";
import {
  selectFlowNodesForTool,
  searchFlowNodes,
  applyAnchoredTextEdits,
  type FlowNodeFull,
  type FlowNodeFilter,
  type FlowGetSelectOpts,
  type AnchoredTextEdit,
} from "./chapter-canvas-summary";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext, AppEnv } from "../../types";
import { AppError } from "../../middleware/error";
import {
	createPromptLibraryIncrementalCrawl,
	kickPromptLibraryCrawl,
} from "../prompt-library/prompt-library.crawler";
import { PromptSyncProtocolSchema } from "../prompt-library/prompt-library.protocol";
import { ParentAgentExecutionSchema } from "./agent-execution-provenance";
import {
  getExecutionTraceAcceptedSnapshot,
  getExecutionTraceLifecycleSnapshot,
  type ExecutionTraceLifecycleSnapshot,
} from "../memory/execution-trace-events.repo";
import {
  createWorkflowAcceptedTurnSource,
  WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD,
} from "../execution/execution.workflow-source-authority";
import {
  getFlowForOwner,
  getFlowByIdUnsafe,
  mapFlowRowToDto,
  updateFlow,
  updateFlowByIdUnsafe,
  listFlowsByOwner,
  listFlowsByProject,
} from "../flow/flow.repo";
import {
  PublicFlowGetResponseSchema,
  PublicFlowGraphSchema,
  PublicFlowPatchRequestSchema,
  PublicFlowPatchResponseSchema,
  publicFlowPatchRequestsAdminWorkflow,
} from "../flow/flow.public.schemas";
import { isAdminRequest } from "../team/team.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { applyPublicFlowGraphPatch, buildCanvasSyncPatch } from "../flow/flow.public.service";
import { buildAgentFlowPatchResult } from "./agents-tool-bridge.flow-patch-result";
import { syncCanvasBookFromFlow } from "../flow/flow.canvas-book-sync";
import { broadcastPatch } from "../chapter/canvas-sse.manager";
import { applyPatchToFlowYDoc } from "../realtime/yjs-realtime";
import { getProjectById, getProjectForOwner, getProjectForUserAccess } from "../project/project.repo";
import {
  getChapterForUser,
  listProjectChaptersForUser,
  updateChapterNarrativeForUser,
} from "../chapter/chapter.service";
import { normalizeStoryPreviewContract } from "../chapter/story-preview-contract";
import { getChapterCanvasFlow } from "../chapter/chapter.canvas-flow.service";
import { resolveProjectBillingTeamId } from "./agents-tool-bridge.billing-scope";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import {
  BookIndexStoreError,
  readBookIndex,
  updateBookIndex,
  type BookIndexRecord,
} from "../asset/book-index-store";
import {
  BookEvidenceError,
  searchBookEvidence,
} from "../asset/book-evidence-index";
import { resolveProjectBookDirectoryName } from "./agents-tool-bridge.book-lookup";
import {
  AgentPipelineRunSchema,
  ProjectWorkspaceContextSchema,
} from "../agents/agents.schemas";
import {
	getBuiltInCapabilityAvailability,
	listEquippedWorkflowCapabilities,
	recordCapabilityInvocation,
  resolveEquippedWorkflowExecutionTarget,
} from "../agents/capability-bay.service";
import {
  getUserAgentPipelineRunById,
  getNodeContextBundle,
  getUserProjectWorkspaceContext,
  getStoryboardSourceBundle,
  getStoryboardContinuityEvidence,
  getVideoReviewBundle,
  listUserAgentPipelineRuns,
  updateUserProjectWorkspaceContextFile,
} from "../agents/agents.service";
import {
  StoryFactsCommitRequestSchema,
  StoryFactsGetRequestSchema,
} from "../agents/story-facts.schemas";
import { projectStoryFactsForAudience } from "../agents/story-facts.projection";
import {
  commitStoryFacts,
  readStoryFactsLedger,
  selectStoryFacts,
  StoryFactsStoreError,
} from "../agents/story-facts.store";
import { resolveVerifiedStoryFactSource } from "../agents/story-facts.source";
import {
  generateImageToCanvas,
	inspectStoryPreviewRunSnapshot,
  reconcileImageNodesForFlow,
} from "./agents-tool-bridge.generate-image-to-canvas";
import {
	buildStoryPreviewPutBoardParameters,
	buildStoryPreviewRepairFailure,
	buildStoryPreviewRunReceipt,
	buildStoryPreviewStaticOperationParameters,
	readStoryPreviewPutBoardIndex,
	STORY_PREVIEW_ORCHESTRATOR_TOOL,
} from "./story-preview-orchestrator";
import {
  generateVideoToCanvas,
  reconcileVideoNodesForFlow,
} from "./agents-tool-bridge.generate-video-to-canvas";
import {
  applyFlowPatchToChapterCanvas,
  loadChapterCanvasAsFlowRow,
  mutateChapterCanvasGraph,
} from "./agents-tool-bridge.chapter-canvas-write";
import { extractLastFrameToImage } from "./agents-tool-bridge.extract-last-frame";
import { extractFramesAtForAgent } from "./agents-tool-bridge.extract-frames-at";
import { createAssetRow } from "../asset/asset.repo";
import { concatVideosToCanvas } from "./agents-tool-bridge.video-concat";
import { dubVoiceCardToCanvas } from "./agents-tool-bridge.voice-card-dub";
import { renderHyperframesToCanvas } from "./agents-tool-bridge.hyperframes";
import { annotateShotToCanvas } from "./agents-tool-bridge.annotate-shot";
import { renderBlockingDiagramToCanvas } from "./agents-tool-bridge.blocking-diagram";
import { getVideoRun, type VideoRunRow } from "./video-run.repo";
import { analyzeImageForAgent } from "./agents-tool-bridge.analyze-image";
import {
  describeExecutionImageReference,
  resolveExecutionImageReferences,
  resolveImageReferencesForInspection,
} from "./agents-tool-bridge.image-reference-ids";
import { addAssetToCanvas } from "./agents-tool-bridge.asset-add-to-canvas";
import {
  containsHttpImageUrlDeep,
  removeHttpImageUrlsDeep,
} from "./agents-image-url-privacy";
import { analyzeVideoForAgent } from "./agents-tool-bridge.analyze-video";
import { decomposeVideoForAgent } from "./agents-tool-bridge.decompose-video";
import { distillDirectorBreakdownForAgent, renderDirectorBreakdownMarkdown } from "./agents-tool-bridge.distill-director-breakdown";
import { writeFinalNodeToChapterCanvas } from "./agents-tool-bridge.chapter-canvas-write";
import { videoCompareForAgent } from "./agents-tool-bridge.video-compare";
import { fetchVideoFromUrlForAgent } from "./agents-tool-bridge.fetch-video-from-url";
import { critiqueShotTable, critiqueTextStoryboard } from "./shot-table-critic";
import { stableContentHash } from "./video-orchestrator.authoring.repo";
import { VIDEO_ORCHESTRATOR_PROTOCOL_VERSION } from "@tapcanvas/video-orchestrator-protocol";
import {
  loadFilmBibleDurable,
} from "./video-orchestrator.film-bible-store";
import {
  parseVideoGenerationContract,
  resolveStoryPlanGenerationContract,
} from "./video-orchestrator.generation-contract";
import { resolveModelMediaOptions } from "./video-orchestrator.model-duration";
import { loadPublicChatEnabledModelCatalogSummary } from "../model-catalog/model-catalog.public-chat-summary";
import { buildAgentImageExecutionCatalog } from "./agents-tool-bridge.model-execution-catalog";
import { splitMasterStoryboardForAgent } from "./agents-tool-bridge.master-storyboard-split";
import { captureDirectorScene, defineDirectorMotion, setDirectorCharacterMotion } from "./agents-tool-bridge.capture-director-scene";
import { getTaskResultByTaskId, tryClaimTaskResult, upsertTaskResult } from "./task-result.repo";
import { readResultJson, buildResultJson } from "./director-capture.shared";
import {
	WorkflowExecutionFamilySchema,
	WorkflowExecutionEventSchema,
	WorkflowExecutionSchema,
	WorkflowNodeAttemptPageSchema,
	WorkflowNodeRunSchema,
	type WorkflowExecutionDto,
} from "../execution/execution.schemas";
import {
  getExecutionForOwner,
  listExecutionEvents,
  listExecutionsForOwnerFlow,
  listNodeRunsForExecutionOwner,
  mapExecutionEventRow,
  mapExecutionRow,
  mapNodeRunRow,
} from "../execution/execution.repo";
import {
	readImmediateWorkflowExecutionAgentState,
	readWorkflowExecutionAgentOutputs,
	type WorkflowExecutionAgentOutput,
} from "../execution/execution.agent-output";
import {
	getWorkflowExecutionFamilyPageForOwner,
	listWorkflowNodeAttemptsPageForExecutionOwner,
} from "../execution/execution.family-store";
import {
  startWorkflowExecution,
  WorkflowStartError,
} from "../execution/execution.start-service";
import {
	resumeWorkflowExecution,
	WorkflowResumeError,
} from "../execution/execution.resume-service";
import { buildWorkflowProjectContextForRun } from "../execution/execution.project-context-runtime";
import {
  freezeWorkflowVideoDurationPlan,
  WORKFLOW_VIDEO_DURATION_PLAN_TRIGGER_FIELD,
  type FrozenWorkflowVideoDurationPlan,
} from "../execution/execution.video-workflow-contract";
import { requireStoryboardV12ArtifactPayload } from "../storyboard/storyboard-persistence-contract";
import {
  type StoryboardPlanRecord,
  selectStoryboardPlanReadResult,
} from "./agents-tool-bridge.storyboard-plan";
import {
  buildEquippedWorkflowPrimaryCapabilityRoutes,
	equippedWorkflowRequiresImageModel,
	equippedWorkflowRequiresVideoModel,
  filterEquippedWorkflowsByExecutionVariant,
  inspectAgentsBridgeRemoteToolSurface,
} from "./task.agents-bridge";
import {
  deriveBookScopeIdFromChapterId,
  readRemoteToolSurfaceMetadata,
} from "./agents-bridge-remote-tool-surface";
import { buildStoryboardAnchorCandidatesFromAssets } from "./storyboard-anchor-gate";
import { collectBookBibleReadiness } from "../chapter/book-bible-readiness";
import { getWorldBibleReminderForProject } from "../chapter/worldbible-readiness";
import {
  createMaterialVersionForOwner,
  listMaterialAssetsForOwner,
  listProjectNodeAssetsForOwner,
  listMaterialVersionsForOwner,
  deleteMaterialAssetForOwner,
  getProjectStyleImagesForOwner,
  setProjectStyleImagesForOwner,
  getProjectStyleLockForOwner,
  getProjectCinematicCameraForOwner,
} from "../material/material.service";
import {
  readDurableCanvasImageUrl,
  syncCanvasCardToMaterial,
} from "./material-auto-register";
import {
  freshReadFlowRow,
  persistFlowPatch,
} from "./video-orchestrator.flow-io";
import { upsertEquippedWorkflowExecutionProjection } from "./equipped-workflow-execution-projection";
import { decideChapterStyleReferenceWrite } from "./style-reference-write-policy";
import {
  BookStyleBibleNotReadyError,
  confirmBookStyleBible,
} from "../asset/book-style-bible";
import {
  confirmProjectLookBible,
  getActiveProjectLookBible,
  normalizeProjectLookBible,
  PROJECT_LOOK_BIBLE_SCHEMA_VERSION,
} from "../material/project-look-bible";

export const AgentsToolExecuteRequestSchema = z.object({
  toolName: z.enum([
    "tapcanvas_project_flows_list",
    "tapcanvas_project_context_get",
    "tapcanvas_project_creative_brief_update",
    "tapcanvas_project_chapters_list",
    "tapcanvas_project_chapter_get",
    "tapcanvas_project_chapter_update",
    "tapcanvas_story_facts_get",
    "tapcanvas_story_facts_commit",
    "tapcanvas_books_list",
    "tapcanvas_book_index_get",
    "tapcanvas_book_evidence_search",
    "tapcanvas_book_style_confirm",
    "tapcanvas_book_chapter_get",
    "tapcanvas_book_chapter_summary_set",
    "tapcanvas_book_worldbible_confirm",
    "tapcanvas_book_storyboard_plan_get",
    "tapcanvas_book_storyboard_plan_upsert",
    "tapcanvas_storyboard_source_bundle_get",
    "tapcanvas_storyboard_continuity_get",
    "tapcanvas_material_assets_list",
    "tapcanvas_material_assets_sync",
    "tapcanvas_material_asset_versions_get",
    "tapcanvas_material_asset_version_create",
    "tapcanvas_material_asset_delete",
    "tapcanvas_storyboard_anchor_candidates",
    "tapcanvas_get_style_reference",
    "tapcanvas_set_style_reference",
    "tapcanvas_project_look_bible_get",
    "tapcanvas_project_look_bible_confirm",
    "tapcanvas_image_refs_get",
    "tapcanvas_node_context_bundle_get",
    "tapcanvas_video_review_bundle_get",
    "tapcanvas_pipeline_runs_list",
    "tapcanvas_pipeline_run_get",
    "tapcanvas_executions_list",
    "tapcanvas_execution_get",
    "tapcanvas_execution_node_runs_get",
    "tapcanvas_execution_events_list",
    "tapcanvas_workflow_execution_inspect",
    "tapcanvas_workflow_resume",
    "tapcanvas_workflow_run",
    "tapcanvas_prompt_library_sync",
    "tapcanvas_equipped_workflow_run",
    "tapcanvas_flow_get",
    "tapcanvas_flow_search",
    "tapcanvas_node_text_edit",
    "tapcanvas_flow_patch",
    "tapcanvas_asset_add_to_canvas",
    "tapcanvas_image_generate_to_canvas",
    "tapcanvas_video_generate_to_canvas",
    "tapcanvas_video_extract_last_frame",
    "tapcanvas_video_extract_frames",
    "tapcanvas_video_concat",
    "tapcanvas_voice_card_dub",
    "tapcanvas_hyperframes_render",
    "tapcanvas_annotate_shot",
    "tapcanvas_render_blocking_diagram",
    "tapcanvas_video_reconcile",
    "tapcanvas_image_reconcile",
	STORY_PREVIEW_ORCHESTRATOR_TOOL,
    "tapcanvas_analyze_image",
    "tapcanvas_analyze_video",
    "tapcanvas_decompose_video",
    "tapcanvas_distill_director_breakdown",
    "tapcanvas_video_compare",
    "tapcanvas_fetch_video_from_url",
    "tapcanvas_shot_table_critic",
    "tapcanvas_capture_director_scene",
    "tapcanvas_render_director_clip",
    "tapcanvas_director_define_motion",
    "tapcanvas_director_set_character_motion",
    "tapcanvas_master_storyboard_split",
    "tapcanvas_tool_catalog_get",
    "tapcanvas_tool_schema_get",
    "add_node",
    "connect_edge",
    "set_param",
    "link_existing_asset",
    "finalize",
  ]),
  args: z.record(z.string(), z.unknown()).default({}),
  toolCallId: z.string().min(1).optional(),
  canvasProjectId: z.string().min(1).optional(),
  canvasFlowId: z.string().min(1).optional(),
  canvasNodeId: z.string().min(1).optional(),
  bookId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  parentAgentExecution: ParentAgentExecutionSchema.optional(),
  publicTurnId: z.string().min(1).max(200).optional(),
  requestedWorkflowExecutionVariant: z.enum(["full_video", "first_video"]).optional(),
});

const BookEvidenceSearchArgsSchema = z
  .object({
    bookId: z.string().min(1),
    query: z.string().trim().min(1).max(500),
    chapterStart: z.number().int().positive().optional(),
    chapterEnd: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .refine(
    (value) =>
      value.chapterStart === undefined ||
      value.chapterEnd === undefined ||
      value.chapterEnd >= value.chapterStart,
    {
      message: "chapterEnd must be greater than or equal to chapterStart",
      path: ["chapterEnd"],
    },
  );

const WorkflowExecutionInspectArgsSchema = z.object({
	executionId: z.string().trim().min(1),
	view: z.enum(["family", "attempts"]),
	cursor: z.string().trim().min(1).optional(),
	limit: z.number().int().min(1).max(200).optional(),
});

const PromptLibraryIncrementalSyncArgsSchema = z.object({
	protocol: PromptSyncProtocolSchema,
	idempotencyKey: z.string().trim().min(1).max(128),
}).strict();

const AgentsToolExecuteResponseSchema = z.object({
  ok: z.literal(true),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

type ParentAgentExecution = NonNullable<
  z.infer<typeof AgentsToolExecuteRequestSchema>["parentAgentExecution"]
>;

function requireCallerAgentExecution(input: {
  parentAgentExecution?: ParentAgentExecution;
}): ParentAgentExecution {
  const parent = input.parentAgentExecution;
  if (!parent) {
    throw new AppError(
      "调用缺少父代理本轮真实 model/apiStyle；模型绑定型工具禁止依赖 args 自报执行身份",
      { status: 400, code: "parent_agent_execution_required" },
    );
  }
  return parent;
}

export function readAcceptedPublicChatPrompt(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof (value as Record<string, unknown>).prompt === "string"
    ? String((value as Record<string, unknown>).prompt).trim()
    : "";
}

export async function resolvePublicChatTurnPrompt(input: Readonly<{
  c: AppContext;
  userId: string;
  publicTurnId: string;
}>): Promise<string> {
  const snapshot = await getExecutionTraceAcceptedSnapshot(input.c.env.DB, {
    traceId: input.publicTurnId,
    userId: input.userId,
  });
  if (!snapshot || !snapshot.request || typeof snapshot.request !== "object" || Array.isArray(snapshot.request)) {
    throw new Error(`beat_sheet_public_chat_source_missing: publicTurnId=${input.publicTurnId}`);
  }
  const prompt = readAcceptedPublicChatPrompt(snapshot.request);
  if (!prompt) {
    throw new Error(`beat_sheet_public_chat_source_empty: publicTurnId=${input.publicTurnId}`);
  }
  return prompt;
}

export function readAcceptedPublicChatAssetIds(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const assetInputs = (value as Record<string, unknown>).assetInputs;
  if (!Array.isArray(assetInputs)) return [];
  return [...new Set(assetInputs.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const assetId = readTrimmedString((item as Record<string, unknown>).assetId);
    return assetId ? [assetId] : [];
  }))];
}

export function mergeAcceptedPublicChatAssetSelection(input: Readonly<{
  triggerPayload: Record<string, unknown> | undefined;
  acceptedAssetIds: readonly string[];
}>): Record<string, unknown> | undefined {
  if (input.acceptedAssetIds.length === 0) return input.triggerPayload;
  const requestedAssetIds = Array.isArray(input.triggerPayload?.selectedAssetIds)
    ? input.triggerPayload.selectedAssetIds.flatMap((assetId) => {
      const normalized = readTrimmedString(assetId);
      return normalized ? [normalized] : [];
    })
    : [];
  const selectedAssetIds = [...new Set([...input.acceptedAssetIds, ...requestedAssetIds])];
  if (selectedAssetIds.length > 64) {
    throw new AppError("Public workflow asset selection exceeds 64 explicit assets", {
      status: 400,
      code: "workflow_selected_asset_limit_exceeded",
      details: { selectedAssetCount: selectedAssetIds.length, maxSelectedAssetCount: 64 },
    });
  }
  return {
    ...(input.triggerPayload ?? {}),
    selectedAssetIds,
  };
}

async function resolvePublicChatTurnSelectedAssetIds(input: Readonly<{
  c: AppContext;
  userId: string;
  publicTurnId: string;
}>): Promise<readonly string[]> {
  const snapshot = await getExecutionTraceAcceptedSnapshot(input.c.env.DB, {
    traceId: input.publicTurnId,
    userId: input.userId,
  });
  if (!snapshot || !snapshot.request || typeof snapshot.request !== "object" || Array.isArray(snapshot.request)) {
    throw new Error(`workflow_public_chat_request_missing: publicTurnId=${input.publicTurnId}`);
  }
  return readAcceptedPublicChatAssetIds(snapshot.request);
}

/**
 * Only a standalone public-canvas request uses the immutable accepted user
 * turn as the workflow source. A chapter-scoped invocation already has a
 * canonical chapter source in ProjectContext; replacing it with the short
 * chat instruction would make the same workflow silently author from the
 * wrong text.
 */
export function shouldUseAcceptedPublicChatTurnAsWorkflowSource(input: Readonly<{
  publicTurnId: string;
  sourceMode?: string;
  chapterId?: string;
}>): boolean {
  return Boolean(
    input.publicTurnId.trim()
    && input.sourceMode === "project_context"
    && !input.chapterId?.trim(),
  );
}

/**
 * Public workflow recovery is a continuation capability, not an admin start
 * capability. The exact root turn must still be waiting on durable evidence;
 * execution ownership and project/canvas scope are revalidated separately by
 * the workflow route before a recovery family member can be created.
 */
export function isPublicWorkflowRecoveryLifecycleEligible(input: Readonly<{
  publicTurnId: string;
  lifecycle: ExecutionTraceLifecycleSnapshot | null;
}>): boolean {
  const publicTurnId = input.publicTurnId.trim();
  return Boolean(
    publicTurnId &&
    input.lifecycle?.traceId === publicTurnId &&
    input.lifecycle.logicalTaskId === publicTurnId &&
    input.lifecycle.rootTraceId === publicTurnId &&
    input.lifecycle.status === "waiting_async",
  );
}

async function hasPublicWorkflowRecoveryAccess(input: Readonly<{
  c: AppContext;
  userId: string;
  publicTurnId?: string;
}>): Promise<boolean> {
  const publicTurnId = input.publicTurnId?.trim() ?? "";
  if (!publicTurnId) return false;
  const lifecycle = await getExecutionTraceLifecycleSnapshot(input.c.env.DB, {
    traceId: publicTurnId,
    userId: input.userId,
  });
  return isPublicWorkflowRecoveryLifecycleEligible({ publicTurnId, lifecycle });
}

function requireUserId(c: any): string {
  const userId = c.get("userId");
  if (!userId) {
    throw new AppError("Unauthorized", {
      status: 401,
      code: "unauthorized",
    });
  }
  return String(userId);
}

function isDevBypassEnabled(c: any): boolean {
  return Boolean(c.get("devPublicBypass"));
}

function isNodeRuntime(): boolean {
  const processRef = globalThis.process;
  return Boolean(processRef?.versions?.node);
}

function sanitizePathSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function readScopedChapterNumber(value: unknown): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
}

// 章节会话里 body.chapterId 形如 `book-<bookId>-ch236`（带非数字，Number() 会得 NaN）。
// 序号在尾部 `-ch<N>`，从中解析出本章「索引序号」(=index.json/chapters.source_book_chapter)。
// 这样章节会话能从 chapterId 自解析权威序号，不必依赖 agent 从标题「第N章」猜数字（那是书内章名号、与序号差很多，会查错章）。
function parseChapterSequenceFromChapterId(value: unknown): number {
  const s = typeof value === "string" ? value.trim() : "";
  const m = /-ch(\d+)$/i.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function buildProjectBooksRoot(projectId: string, userId: string): string {
  const repoRoot = resolveProjectDataRepoRoot();
  return path.join(
    repoRoot,
    "project-data",
    "users",
    sanitizePathSegment(userId),
    "projects",
    sanitizePathSegment(projectId),
    "books",
  );
}

function buildBookIndexPath(projectId: string, userId: string, bookId: string): string {
  return path.join(buildProjectBooksRoot(projectId, userId), bookId, "index.json");
}

async function readBookIndexSafe(indexPath: string): Promise<Record<string, unknown> | null> {
  try {
    return await readBookIndex(indexPath);
  } catch (error) {
    if (error instanceof BookIndexStoreError && error.code === "book_index_not_found") return null;
    if (error instanceof BookIndexStoreError) {
      throw new AppError(error.message, {
        status: 500,
        code: error.code,
        details: error.details,
      });
    }
    throw error;
  }
}

async function updateBookIndexForTool<T>(
  indexPath: string,
  updater: (current: Readonly<BookIndexRecord>) => { next: BookIndexRecord; result: T },
): Promise<{ index: BookIndexRecord; result: T }> {
  try {
    return await updateBookIndex(indexPath, updater);
  } catch (error) {
    if (!(error instanceof BookIndexStoreError)) throw error;
    throw new AppError(error.message, {
      status: error.code === "book_index_not_found" ? 404 : 500,
      code: error.code,
      details: error.details,
    });
  }
}

function mapStoryFactsStoreError(error: StoryFactsStoreError): AppError {
  const conflictCodes = new Set([
    "story_facts_revision_conflict",
    "story_facts_commit_id_conflict",
    "story_fact_duplicate",
    "story_fact_not_found",
    "story_fact_already_closed",
    "story_fact_interval_invalid",
    "story_fact_status_conflict",
    "story_fact_status_transition_invalid",
    "story_facts_capacity_exceeded",
  ]);
  return new AppError(error.message, {
    status: conflictCodes.has(error.code) ? 409 : 500,
    code: error.code,
    details: error.details,
  });
}

function normalizeStoryboardGroupSize(value: unknown): 1 | 4 | 9 | 25 {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  const normalized = Math.trunc(parsed);
  if (normalized === 1 || normalized === 4 || normalized === 9 || normalized === 25) return normalized;
  return 25;
}

function normalizeStoryboardPlans(value: unknown): StoryboardPlanRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): StoryboardPlanRecord | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new AppError("storyboard plan 持久化记录必须是对象", {
          status: 409,
          code: "storyboard_persistence_record_invalid",
        });
      }
      const record = item as Record<string, unknown>;
      const planId = readTrimmedString(record.planId);
      const taskId = readTrimmedString(record.taskId);
      const chapterRaw = Number(record.chapter);
      const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : null;
      if (!planId || !taskId || !chapter) {
        throw new AppError("storyboard plan 缺少 planId、taskId 或 chapter", {
          status: 409,
          code: "storyboard_persistence_record_invalid",
        });
      }
      const storyboardArtifact =
        record.storyboardArtifact && typeof record.storyboardArtifact === "object" && !Array.isArray(record.storyboardArtifact)
          ? record.storyboardArtifact as Record<string, unknown>
          : null;
      const storyFactsContext =
        storyboardArtifact?.storyFactsContext && typeof storyboardArtifact.storyFactsContext === "object" && !Array.isArray(storyboardArtifact.storyFactsContext)
          ? storyboardArtifact.storyFactsContext as Record<string, unknown>
          : null;
      const bookId = readTrimmedString(storyFactsContext?.bookId);
      if (!storyboardArtifact || !bookId) {
        throw new AppError("storyboard plan 缺少 v1.2 artifact 或 bookId", {
          status: 409,
          code: "storyboard_persistence_record_invalid",
        });
      }
      const persistencePayload = requireStoryboardV12ArtifactPayload({
        storyboardStructured: storyboardArtifact,
        shotPrompts: record.shotPrompts,
        maxShotPrompts: 1_200,
        contextLabel: "stored storyboard plan",
      });
      const mode = readTrimmedString(record.mode).toLowerCase() === "full" ? "full" as const : "single" as const;
      const nextChunkInput =
        record.nextChunkIndexByGroup && typeof record.nextChunkIndexByGroup === "object" && !Array.isArray(record.nextChunkIndexByGroup)
          ? record.nextChunkIndexByGroup as Record<string, unknown>
          : {};
      const nextChunkIndexByGroup = {
        ...(Number.isFinite(Number(nextChunkInput["1"])) && Number(nextChunkInput["1"]) >= 0 ? { "1": Math.trunc(Number(nextChunkInput["1"])) } : null),
        ...(Number.isFinite(Number(nextChunkInput["4"])) && Number(nextChunkInput["4"]) >= 0 ? { "4": Math.trunc(Number(nextChunkInput["4"])) } : null),
        ...(Number.isFinite(Number(nextChunkInput["9"])) && Number(nextChunkInput["9"]) >= 0 ? { "9": Math.trunc(Number(nextChunkInput["9"])) } : null),
        ...(Number.isFinite(Number(nextChunkInput["25"])) && Number(nextChunkInput["25"]) >= 0 ? { "25": Math.trunc(Number(nextChunkInput["25"])) } : null),
      };
      return {
        planId,
        taskId,
        chapter,
        ...(readTrimmedString(record.taskTitle) ? { taskTitle: readTrimmedString(record.taskTitle) } : null),
        mode,
        groupSize: normalizeStoryboardGroupSize(record.groupSize),
        ...(readTrimmedString(record.outputAssetId) ? { outputAssetId: readTrimmedString(record.outputAssetId) } : null),
        ...(readTrimmedString(record.runId) ? { runId: readTrimmedString(record.runId) } : null),
        storyboardContent: JSON.stringify(persistencePayload.artifact, null, 2),
        storyboardArtifact: persistencePayload.artifact,
        artifactSha256: persistencePayload.artifactSha256,
        storyboardStructured: persistencePayload.structured,
        ...(record.semanticReview !== undefined ? { semanticReview: record.semanticReview } : null),
        shotPrompts: persistencePayload.shotPrompts,
        ...(Object.keys(nextChunkIndexByGroup).length ? { nextChunkIndexByGroup } : null),
        createdAt: readTrimmedString(record.createdAt) || new Date(0).toISOString(),
        updatedAt: readTrimmedString(record.updatedAt) || new Date(0).toISOString(),
        createdBy: readTrimmedString(record.createdBy) || "system",
        updatedBy: readTrimmedString(record.updatedBy) || "system",
      };
    })
    .filter((item): item is StoryboardPlanRecord => item !== null);
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 工作流按次触发载荷：小T 调用系统级共享工作流时把本次的源文本/时长/模型
 * 作为 triggerPayload 传入，随执行快照冻结。只做结构校验，不承载语义判断。
 */
function parseWorkflowTriggerPayload(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value.trim()) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 落入下方统一 400。
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new AppError("triggerPayload must be a JSON object", {
    status: 400,
    code: "workflow_trigger_payload_invalid",
  });
}

const EQUIPPED_WORKFLOW_TRIGGER_FIELDS = [
  "source",
  "sourceGroupId",
  "selectedAssetIds",
  "selectedNodeIds",
  "targetDurationSeconds",
  "requestedClipCount",
  "requestedClipDurationsSeconds",
	"videoModelKey",
	"imageModelKey",
	"imageSize",
	"videoResolution",
	"videoAspectRatio",
	"imageAspectRatio",
] as const;

/**
 * Some model/tool adapters flatten the documented triggerPayload object into
 * the tool arguments. These fields are an exact structural projection of the
 * public trigger contract, not a semantic fallback. Normalize that projection
 * before admission so an explicit model/duration cannot silently fall back to
 * the workflow template defaults.
 */
export function normalizeEquippedWorkflowTriggerPayload(
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const nested = parseWorkflowTriggerPayload(args.triggerPayload);
  if (nested && Object.prototype.hasOwnProperty.call(nested, WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD)) {
    throw new AppError(`${WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD} is server-owned`, {
      status: 400,
      code: "workflow_source_authority_reserved",
    });
  }
  const flattenedEntries = EQUIPPED_WORKFLOW_TRIGGER_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(args, field))
    .map((field) => [field, args[field]] as const);
  if (flattenedEntries.length === 0) return nested;
  const flattened = Object.fromEntries(flattenedEntries) as Record<string, unknown>;
  if (!nested) return flattened;
  for (const [field, value] of flattenedEntries) {
    if (!Object.prototype.hasOwnProperty.call(nested, field)) continue;
    if (JSON.stringify(nested[field]) !== JSON.stringify(value)) {
      throw new AppError(`triggerPayload.${field} conflicts with flattened tool argument`, {
        status: 400,
        code: "workflow_trigger_payload_conflict",
      });
    }
  }
  return { ...flattened, ...nested };
}

/**
 * Model catalogs and provider adapters sometimes differ only in the display
 * casing of structural size tokens (for example `2K` versus `2k`). Resolve a
 * unique case-insensitive match back to the catalog's exact provider value;
 * never invent a size or select a different option.
 */
export function resolveCanonicalCatalogImageSize(
	requested: string,
	supported: readonly string[],
): string | null {
	if (supported.length === 0) return requested;
	const exact = supported.find((value) => value === requested);
	if (exact) return exact;
	const normalized = requested.toLocaleLowerCase("en-US");
	const matches = supported.filter((value) => value.toLocaleLowerCase("en-US") === normalized);
	return matches.length === 1 ? matches[0]! : null;
}

/**
 * Public chat owns one immutable turn identity across every physical Agent
 * continuation. Bind workflow admission to that host identity so a model
 * cannot create another paid execution by changing its descriptive key.
 */
export function resolveEquippedWorkflowIdempotencyKey(input: Readonly<{
  requestedKey: string;
  publicTurnId: string;
}>): string {
  const publicTurnId = input.publicTurnId.trim();
  return publicTurnId ? `public-turn:${publicTurnId}` : input.requestedKey.trim();
}

export function assertWorkflowVideoMediaSelectionSupported(input: Readonly<{
  modelKey: string;
  resolution?: string;
  aspectRatio?: string;
  resolutionOptions: readonly string[];
  aspectRatioOptions: readonly string[];
}>): void {
  const resolution = readTrimmedString(input.resolution);
  const aspectRatio = readTrimmedString(input.aspectRatio);
  if (resolution && !input.resolutionOptions.includes(resolution)) {
    throw new AppError(
      `Video model ${input.modelKey} does not support resolution ${resolution}; supported: ${input.resolutionOptions.join("/")}`,
      { status: 400, code: "workflow_video_resolution_not_supported" },
    );
  }
  if (aspectRatio && !input.aspectRatioOptions.includes(aspectRatio)) {
    throw new AppError(
      `Video model ${input.modelKey} does not support aspect ratio ${aspectRatio}; supported: ${input.aspectRatioOptions.join("/")}`,
      { status: 400, code: "workflow_video_aspect_ratio_not_supported" },
    );
  }
}

async function requireEnabledVideoModelKeys(
  c: AppContext,
  userId: string,
): Promise<string[]> {
  const catalogResult = await loadPublicChatEnabledModelCatalogSummary(c, userId);
  if (catalogResult.error || !catalogResult.summary) {
    throw new AppError("无法读取当前可执行视频模型目录", {
      status: 503,
      code: "video_model_catalog_unavailable",
      details: { reason: catalogResult.error || "catalog_summary_missing" },
    });
  }
  const modelKeys = [...new Set(catalogResult.summary.videoModels
    .map((model) => model.modelKey.trim())
    .filter(Boolean))].sort();
  if (modelKeys.length === 0) {
    throw new AppError("当前没有可执行的视频模型", {
      status: 409,
      code: "video_model_catalog_empty",
    });
  }
  return modelKeys;
}

async function requireEnabledImageModelCatalog(
	c: AppContext,
	userId: string,
) {
	const catalogResult = await loadPublicChatEnabledModelCatalogSummary(c, userId);
	if (catalogResult.error || !catalogResult.summary) {
		throw new AppError("无法读取当前可执行图片模型目录", {
			status: 503,
			code: "image_model_catalog_unavailable",
			details: { reason: catalogResult.error || "catalog_summary_missing" },
		});
	}
	if (catalogResult.summary.imageModels.length === 0) {
		throw new AppError("当前没有可执行的图片模型", {
			status: 409,
			code: "image_model_catalog_empty",
		});
	}
	return catalogResult.summary.imageModels;
}

async function freezeWorkflowVideoPlanAtAdmission(input: Readonly<{
  c: AppContext;
  triggerPayload: Record<string, unknown> | undefined;
}>): Promise<Readonly<{
  triggerPayload: Record<string, unknown> | undefined;
  durationPlan: FrozenWorkflowVideoDurationPlan | null;
}>> {
  const targetDurationValue = input.triggerPayload?.targetDurationSeconds;
  const modelKeyValue = input.triggerPayload?.videoModelKey;
  if (targetDurationValue === undefined || modelKeyValue === undefined) {
    return { triggerPayload: input.triggerPayload, durationPlan: null };
  }
  const targetDurationSeconds = Number(targetDurationValue);
  const requestedClipCountValue = input.triggerPayload?.requestedClipCount;
  const requestedClipCount = requestedClipCountValue === undefined
    ? null
    : Number(requestedClipCountValue);
  const requestedClipDurationsValue = input.triggerPayload?.requestedClipDurationsSeconds;
  const requestedClipDurationsSeconds = requestedClipDurationsValue === undefined
    ? null
    : Array.isArray(requestedClipDurationsValue)
      ? requestedClipDurationsValue
      : null;
  const modelKey = readTrimmedString(modelKeyValue);
  if (!Number.isInteger(targetDurationSeconds) || targetDurationSeconds <= 0) {
    throw new AppError("targetDurationSeconds must be a positive integer", {
      status: 400,
      code: "workflow_video_target_duration_invalid",
    });
  }
  if (!modelKey) {
    throw new AppError("videoModelKey is required when targetDurationSeconds is provided", {
      status: 400,
      code: "workflow_video_model_key_required",
    });
  }
  if (requestedClipCount !== null && (!Number.isInteger(requestedClipCount) || requestedClipCount <= 0)) {
    throw new AppError("requestedClipCount must be a positive integer", {
      status: 400,
      code: "workflow_requested_clip_count_invalid",
    });
  }
  if (
    requestedClipDurationsValue !== undefined
    && (
      !requestedClipDurationsSeconds
      || requestedClipDurationsSeconds.length === 0
      || requestedClipDurationsSeconds.length > 64
      || requestedClipDurationsSeconds.some((duration) => (
        typeof duration !== "number" || !Number.isInteger(duration) || duration <= 0
      ))
    )
  ) {
    throw new AppError("requestedClipDurationsSeconds must contain 1..64 positive integers", {
      status: 400,
      code: "workflow_requested_clip_durations_invalid",
    });
  }
  if (
    requestedClipDurationsSeconds
    && requestedClipCount === null
  ) {
    throw new AppError("requestedClipCount is required when requestedClipDurationsSeconds is provided", {
      status: 400,
      code: "workflow_requested_clip_count_required_for_durations",
    });
  }
  if (
    requestedClipDurationsSeconds
    && requestedClipCount !== null
    && requestedClipDurationsSeconds.length !== requestedClipCount
  ) {
    throw new AppError("requestedClipCount must match requestedClipDurationsSeconds.length", {
      status: 400,
      code: "workflow_requested_clip_count_duration_mismatch",
    });
  }
  if (
    requestedClipDurationsSeconds
    && requestedClipDurationsSeconds.reduce((total, duration) => total + Number(duration), 0) !== targetDurationSeconds
  ) {
    throw new AppError("requestedClipDurationsSeconds must sum to targetDurationSeconds", {
      status: 400,
      code: "workflow_requested_clip_duration_total_mismatch",
    });
  }
  const mediaOptions = await resolveModelMediaOptions({ c: input.c, modelKey });
  assertWorkflowVideoMediaSelectionSupported({
    modelKey,
    resolution: readTrimmedString(input.triggerPayload?.videoResolution),
    aspectRatio: readTrimmedString(input.triggerPayload?.videoAspectRatio),
    resolutionOptions: mediaOptions.resolutionOptions,
    aspectRatioOptions: mediaOptions.aspectRatioOptions,
  });
  const durationPlan = freezeWorkflowVideoDurationPlan({
    targetDurationSeconds,
    modelKey,
    durationOptions: mediaOptions.durationOptions,
    ...(requestedClipDurationsSeconds
      ? { explicitDurations: requestedClipDurationsSeconds as number[] }
      : {}),
  });
  return {
    triggerPayload: {
      ...(input.triggerPayload ?? {}),
      targetDurationSeconds,
      ...(requestedClipCount === null ? {} : { requestedClipCount }),
      ...(requestedClipDurationsSeconds ? { requestedClipDurationsSeconds } : {}),
      [WORKFLOW_VIDEO_DURATION_PLAN_TRIGGER_FIELD]: durationPlan,
    },
    durationPlan,
  };
}

/**
 * 系统级共享工作流的媒体交付目标：调用者当前对话所在画布（canvasFlowId/
 * canvasProjectId）。缺省（未传、或与工作流自身 flow 相同）时不注入，媒体
 * 仍写入工作流自身项目，保持个人自建工作流的既有行为。
 */
function resolveWorkflowDeliveryScope(input: Readonly<{
  workflowFlowId: string;
  callerProjectId: string;
  callerFlowId: string;
  callerChapterId?: string | null;
}>): Readonly<{ flowId: string; projectId: string | null; chapterId?: string }> | null {
  const callerFlowId = input.callerFlowId.trim();
  const callerProjectId = input.callerProjectId.trim();
  if (!callerFlowId || callerFlowId === input.workflowFlowId.trim()) return null;
  return {
    flowId: callerFlowId,
    projectId: callerProjectId || null,
    ...(readTrimmedString(input.callerChapterId)
      ? { chapterId: readTrimmedString(input.callerChapterId) }
      : {}),
  };
}

export function buildWorkflowExecutionReceipt(
	execution: WorkflowExecutionDto,
): Readonly<{
	protocolVersion: "tapcanvas.workflow-execution-receipt/v1";
	runId: string;
	executionId: string;
	executionFamilyId: string;
	status: WorkflowExecutionDto["status"];
	acceptedAsync: boolean;
	inspection: Readonly<{
		toolName: "tapcanvas_workflow_execution_inspect";
		familyArgs: Readonly<{ executionId: string; view: "family" }>;
		attemptArgs: Readonly<{ executionId: string; view: "attempts" }>;
	}>;
}> {
	return {
		protocolVersion: "tapcanvas.workflow-execution-receipt/v1",
		runId: execution.id,
		executionId: execution.id,
		executionFamilyId: execution.executionFamilyId,
		status: execution.status,
		acceptedAsync: execution.status === "queued" || execution.status === "running",
		inspection: {
			toolName: "tapcanvas_workflow_execution_inspect",
			familyArgs: { executionId: execution.id, view: "family" },
			attemptArgs: { executionId: execution.id, view: "attempts" },
		},
	};
}

export function buildWorkflowExecutionAgentSummary(
	execution: WorkflowExecutionDto,
	workflowOutputs: readonly WorkflowExecutionAgentOutput[] = [],
): Readonly<Record<string, unknown>> {
	const terminal = execution.status === "success"
		|| execution.status === "failed"
		|| execution.status === "canceled";
	return {
		...buildWorkflowExecutionReceipt(execution),
		terminal,
		flowId: execution.flowId,
		flowVersionId: execution.flowVersionId,
		projectId: execution.projectId ?? null,
		canvasId: execution.canvasId ?? null,
		trigger: execution.trigger ?? null,
		concurrency: execution.concurrency,
		errorCode: execution.errorCode ?? null,
		errorMessage: execution.errorMessage ?? null,
		failureStage: execution.failureStage ?? null,
		retryCount: execution.retryCount ?? 0,
		recoveryOfExecutionId: execution.recoveryOfExecutionId ?? null,
		usesProjectAssets: execution.usesProjectAssets ?? false,
		createdAt: execution.createdAt,
		startedAt: execution.startedAt ?? null,
		finishedAt: execution.finishedAt ?? null,
		durationMs: execution.durationMs ?? null,
		...(execution.status === "success" ? { workflowOutputs: [...workflowOutputs] } : {}),
		...(execution.nodeSummary ? { nodeSummary: execution.nodeSummary } : {}),
		...(execution.focusNode !== undefined ? { focusNode: execution.focusNode } : {}),
	};
}

/**
 * Workflow executions persist chapter delivery canvases with the canonical
 * `chapter:<chapterId>` identity, while the agent-facing chapter flow row uses
 * the raw chapter id. Treat those two structural representations as the same
 * canvas so a receipt can always be inspected from the caller scope that
 * created it. This is identity normalization only; owner and project checks
 * remain mandatory at the call site.
 */
export function workflowExecutionMatchesCanvasScope(input: Readonly<{
	executionFlowId: string;
	executionCanvasId: string | null;
	executionProjectId: string | null;
	scopeFlowId: string;
	scopeProjectId: string;
	isChapterScope: boolean;
}>): boolean {
	if (input.executionFlowId === input.scopeFlowId) return true;
	const canonicalScopeCanvasId = input.isChapterScope
		? `chapter:${input.scopeFlowId}`
		: input.scopeFlowId;
	return (
		(input.executionCanvasId === input.scopeFlowId || input.executionCanvasId === canonicalScopeCanvasId)
		&& input.executionProjectId === input.scopeProjectId
	);
}

type MaterialSyncKind = "character" | "scene" | "prop" | "ensemble" | "pose";

type MaterialSyncBinding = {
  nodeId: string;
  kind: MaterialSyncKind;
  name: string;
  materialIdentity?: Record<string, unknown>;
};

function readMaterialSyncBindings(value: unknown): MaterialSyncBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError("bindings is required and must contain at least one canvas node binding", {
      status: 400,
      code: "material_sync_bindings_required",
    });
  }
  const bindings: MaterialSyncBinding[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AppError(`bindings[${index}] must be an object`, {
        status: 400,
        code: "material_sync_binding_invalid",
      });
    }
    const record = item as Record<string, unknown>;
    const nodeId = readTrimmedString(record.nodeId);
    const name = readTrimmedString(record.name);
    const kindRaw = readTrimmedString(record.kind).toLowerCase();
    if (!nodeId || !name || !["character", "scene", "prop", "ensemble", "pose"].includes(kindRaw)) {
      throw new AppError(`bindings[${index}] requires nodeId, name and a supported kind`, {
        status: 400,
        code: "material_sync_binding_invalid",
        details: { index, acceptedKinds: ["character", "scene", "prop", "ensemble", "pose"] },
      });
    }
    const materialIdentity =
      record.materialIdentity && typeof record.materialIdentity === "object" && !Array.isArray(record.materialIdentity)
        ? (record.materialIdentity as Record<string, unknown>)
        : undefined;
    bindings.push({
      nodeId,
      name,
      kind: kindRaw as MaterialSyncKind,
      ...(materialIdentity ? { materialIdentity } : {}),
    });
  }
  return bindings;
}

async function findVideoRunForRequest(input: {
  runId: string;
  ownerId: string;
  projectId?: string | null;
  flowId?: string | null;
  chapterId?: string | null;
}): Promise<VideoRunRow | null> {
  const run = await getVideoRun(input.runId);
  if (!run) return null;
  const projectId = readTrimmedString(input.projectId);
  const flowId = readTrimmedString(input.flowId);
  const chapterId = readTrimmedString(input.chapterId);
  if (
    run.owner_id !== input.ownerId ||
    (projectId && readTrimmedString(run.project_id) !== projectId) ||
    (flowId && readTrimmedString(run.flow_id) !== flowId) ||
    (chapterId && readTrimmedString(run.chapter_id) !== chapterId)
  ) {
    throw new AppError("Video run not found", {
      status: 404,
      code: "video_run_not_found",
    });
  }
  return run;
}

async function getVideoRunForRequest(input: {
  runId: string;
  ownerId: string;
  projectId?: string | null;
  flowId?: string | null;
  chapterId?: string | null;
}): Promise<VideoRunRow> {
  const run = await findVideoRunForRequest(input);
  if (!run) {
    throw new AppError("Video run not found", {
      status: 404,
      code: "video_run_not_found",
    });
  }
  return run;
}

function normalizeKeywordList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readTrimmedString(item))
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeEntityItems(value: unknown, limit: number): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	const items = value
		.map((item): Record<string, unknown> | null => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return null;
			const record = item as Record<string, unknown>;
			const name = readTrimmedString(record.name);
			if (!name) return null;
			const summary = readTrimmedString(record.summary);
      return {
        name,
				...(summary ? { summary } : {}),
			};
		})
		.filter((item): item is Record<string, unknown> => item !== null);
	return items.slice(0, limit);
}

function resolveFlowVersionUserId(input: { devBypass: boolean; requestUserId: string; flowOwnerId: string | null }): string {
  if (!input.devBypass) return input.requestUserId;
  const ownerId = String(input.flowOwnerId || "").trim();
  if (!ownerId) {
    throw new AppError("Flow owner missing", {
      status: 500,
      code: "flow_owner_missing",
    });
  }
  return ownerId;
}

function resolveProjectOwnerUserId(input: {
  devBypass: boolean;
  requestUserId: string;
  projectOwnerId: string | null;
}): string {
  if (!input.devBypass) return input.requestUserId;
  const ownerId = String(input.projectOwnerId || "").trim();
  if (!ownerId) {
    throw new AppError("Project owner missing", {
      status: 500,
      code: "project_owner_missing",
    });
  }
  return ownerId;
}

const PublicAgentsToolExecuteRoute = createRoute({
  method: "post",
  path: "/agents/tools/execute",
  tags: ["Public API"],
  summary: "Execute project-scoped agents bridge tools",
  request: {
    body: {
      content: {
        "application/json": {
          schema: AgentsToolExecuteRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: AgentsToolExecuteResponseSchema,
        },
      },
      description: "OK",
    },
  },
});

const CANVAS_PATCH_TOOLS = new Set(["add_node", "connect_edge", "set_param", "link_existing_asset", "finalize"]);

const ID_ONLY_IMAGE_REFERENCE_TOOLS = new Set([
  "tapcanvas_book_style_confirm",
  "tapcanvas_material_asset_version_create",
  "tapcanvas_material_assets_sync",
  "tapcanvas_set_style_reference",
  "tapcanvas_flow_patch",
  "tapcanvas_asset_add_to_canvas",
  "tapcanvas_image_generate_to_canvas",
  "tapcanvas_video_generate_to_canvas",
]);

const LEGACY_AGENT_IMAGE_REFERENCE_FIELDS = new Set([
  "assetInputs",
  "firstFrameUrl",
  "imageUrl",
  "lastFrameUrl",
  "referenceImages",
  "sourceImageUrl",
  "styleImages",
  "styleReferenceImages",
  "veoLastFrameUrl",
]);

function findLegacyAgentImageReferenceField(
  value: unknown,
  path = "args",
): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findLegacyAgentImageReferenceField(item, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const fieldPath = `${path}.${key}`;
    if (LEGACY_AGENT_IMAGE_REFERENCE_FIELDS.has(key)) return fieldPath;
    const found = findLegacyAgentImageReferenceField(item, fieldPath);
    if (found) return found;
  }
  return null;
}

function assertAgentToolUsesImageReferenceIds(
  toolName: string,
  args: Record<string, unknown>,
): void {
  if (!ID_ONLY_IMAGE_REFERENCE_TOOLS.has(toolName)) return;
  const legacyField = findLegacyAgentImageReferenceField(args);
  if (legacyField) {
    throw new AppError(
      "图片引用旧字段已停用；只允许提交节点 ID 或资产 ID",
      {
        status: 400,
        code: "agents_tool_legacy_image_reference_field_forbidden",
        details: {
          toolName,
          forbiddenField: legacyField,
          acceptedFields: ["referenceImageNodeIds", "referenceAssetIds"],
        },
      },
    );
  }
  if (!containsHttpImageUrlDeep(args)) return;
  throw new AppError(
    "图片引用只允许提交节点 ID 或资产 ID；主模型不得复制、传递或回显存储 URL",
    {
      status: 400,
      code: "agents_tool_raw_image_url_forbidden",
      details: {
        toolName,
        acceptedFields: ["referenceImageNodeIds", "referenceAssetIds"],
      },
    },
  );
}

function stringifyAgentVisibleToolResult(value: unknown): string {
  return JSON.stringify(removeHttpImageUrlsDeep(value));
}

export function registerPublicAgentsToolBridgeRoutes(publicApiRouter: OpenAPIHono<AppEnv>) {
  publicApiRouter.openapi(PublicAgentsToolExecuteRoute, async (c) => {
    const requestUserId = requireUserId(c);
    const devBypass = isDevBypassEnabled(c);
    const body = AgentsToolExecuteRequestSchema.parse(await c.req.json());
    body.args = coerceStringifiedObjectArgs(body.args);
    const remoteToolSurfaceMetadata = body.toolName.startsWith("tapcanvas_")
      ? readRemoteToolSurfaceMetadata(body.toolName)
      : null;
    const readsToolSurface = body.toolName === "tapcanvas_tool_catalog_get"
      || body.toolName === "tapcanvas_tool_schema_get";
	const adminWorkflowAccess = isAdminRequest(c);
	const workflowRecoveryAccess = adminWorkflowAccess || (
		(readsToolSurface || body.toolName === "tapcanvas_workflow_resume") &&
		await hasPublicWorkflowRecoveryAccess({
			c: c as unknown as AppContext,
			userId: requestUserId,
			publicTurnId: body.publicTurnId,
		})
	);
    const builtInCapabilityAvailability = remoteToolSurfaceMetadata?.capabilityGated || readsToolSurface
      ? await getBuiltInCapabilityAvailability(c, requestUserId)
      : { systemDisabledKeys: [], userDisabledKeys: [], disabledKeys: [] };
    if (remoteToolSurfaceMetadata?.capabilityGated) {
      const capability = remoteToolSurfaceMetadata.capability;
      if (builtInCapabilityAvailability.systemDisabledKeys.includes(capability)) {
        throw new AppError("该小T内置能力已被管理员在系统层停用", {
          status: 409,
          code: "built_in_capability_disabled_by_system",
          details: { capability, toolName: body.toolName },
        });
      }
      if (builtInCapabilityAvailability.userDisabledKeys.includes(capability)) {
        throw new AppError("该小T内置能力已由当前用户在能力舱停用", {
          status: 409,
          code: "built_in_capability_disabled_by_user",
          details: { capability, toolName: body.toolName },
        });
      }
    }

    if (body.toolName === "tapcanvas_tool_catalog_get") {
      const equippedWorkflowAttachments = filterEquippedWorkflowsByExecutionVariant(
		await listEquippedWorkflowCapabilities(c, requestUserId),
		body.requestedWorkflowExecutionVariant ?? null,
	  );
      const equippedWorkflows = equippedWorkflowAttachments.map((attachment) => ({
        attachmentId: attachment.id,
        name: attachment.descriptor.name,
        summary: attachment.descriptor.summary,
        invocation: attachment.descriptor.invocation,
        primaryForCapabilities: attachment.primaryForCapabilities,
      }));
      const surface = inspectAgentsBridgeRemoteToolSurface({
        publicAgentsRequest: true,
        canvasProjectId: body.canvasProjectId ?? null,
        canvasFlowId: body.canvasFlowId ?? null,
        canvasNodeId: body.canvasNodeId ?? null,
        bookId: body.bookId ?? null,
        chapterId: body.chapterId ?? null,
        executionId: body.executionId ?? null,
        adminWorkflowAccess,
		workflowRecoveryAccess,
        disabledBuiltInCapabilities: builtInCapabilityAvailability.disabledKeys,
        equippedWorkflows,
      });
      const directTools = surface.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        availability: "direct" as const,
        ...readRemoteToolSurfaceMetadata(tool.name),
        ...(tool.execution ? { execution: tool.execution } : {}),
      }));
      const deferredTools = surface.catalog.map((tool) => ({
        name: tool.name,
        description: tool.description,
        availability: "deferred" as const,
        requiredScope: tool.requiredScope,
        capability: tool.capability,
        ...(tool.execution ? { execution: tool.execution } : {}),
      }));
      const catalog = {
        scope: surface.satisfiedScopes,
        count: directTools.length + deferredTools.length,
        tools: [...directTools, ...deferredTools].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
        primaryCapabilityRoutes: surface.tools.some((tool) => tool.name === "tapcanvas_equipped_workflow_run")
          ? buildEquippedWorkflowPrimaryCapabilityRoutes(equippedWorkflows)
          : [],
        schemaCommand: "tapcanvas tools schema --name <tool> with the same scope flags",
      };
      return c.json({
        ok: true as const,
        content: JSON.stringify(catalog),
        data: catalog,
      });
    }

    if (body.toolName === "tapcanvas_tool_schema_get") {
      const requestedName = readTrimmedString(body.args.name);
      if (!requestedName) {
        throw new AppError("schema lookup requires a tool name", {
          status: 400,
          code: "agents_tool_schema_name_required",
        });
      }
	  const equippedWorkflowAttachments = filterEquippedWorkflowsByExecutionVariant(
		await listEquippedWorkflowCapabilities(c, requestUserId),
		body.requestedWorkflowExecutionVariant ?? null,
	  );
	  const inspectsEquippedWorkflow = requestedName === "tapcanvas_equipped_workflow_run";
	  const requiresVideoModel = inspectsEquippedWorkflow && equippedWorkflowAttachments
		.some((attachment) => equippedWorkflowRequiresVideoModel(attachment.descriptor));
	  const requiresImageModel = inspectsEquippedWorkflow && equippedWorkflowAttachments
		.some((attachment) => equippedWorkflowRequiresImageModel(attachment.descriptor));
	  const [enabledVideoModelKeys, enabledImageModels] = await Promise.all([
		requiresVideoModel
			? requireEnabledVideoModelKeys(c as unknown as AppContext, requestUserId)
			: Promise.resolve([]),
		requiresImageModel
			? requireEnabledImageModelCatalog(c as unknown as AppContext, requestUserId)
			: Promise.resolve([]),
	  ]);
      const surface = inspectAgentsBridgeRemoteToolSurface({
        publicAgentsRequest: true,
        canvasProjectId: body.canvasProjectId ?? null,
        canvasFlowId: body.canvasFlowId ?? null,
        canvasNodeId: body.canvasNodeId ?? null,
        bookId: body.bookId ?? null,
        chapterId: body.chapterId ?? null,
        executionId: body.executionId ?? null,
        adminWorkflowAccess,
		workflowRecoveryAccess,
        disabledBuiltInCapabilities: builtInCapabilityAvailability.disabledKeys,
		enabledVideoModelKeys,
		enabledImageModelKeys: enabledImageModels.map((model) => model.modelKey),
        equippedWorkflows: equippedWorkflowAttachments.map((attachment) => ({
          attachmentId: attachment.id,
          name: attachment.descriptor.name,
          summary: attachment.descriptor.summary,
          invocation: attachment.descriptor.invocation,
          primaryForCapabilities: attachment.primaryForCapabilities,
        })),
      });
      const declaredTool = [...surface.tools, ...surface.catalog].find(
        (tool) => tool.name === requestedName,
      );
      if (!declaredTool) {
        throw new AppError(`未授权或不存在的远程工具 schema：${requestedName}`, {
          status: 404,
          code: "agents_tool_schema_not_found",
          details: { toolName: requestedName },
        });
      }
      const rawSelector = body.args.selector;
      let selector: ToolSchemaSelector | undefined;
      if (rawSelector !== undefined) {
        if (!rawSelector || typeof rawSelector !== "object" || Array.isArray(rawSelector)) {
          throw new AppError("schema selector must be an object", {
            status: 400,
            code: "agents_tool_schema_selector_invalid",
          });
        }
        const selectorRecord = rawSelector as Record<string, unknown>;
        const field = readTrimmedString(selectorRecord.field);
        const value = readTrimmedString(selectorRecord.value);
        if (!field || !value) {
          throw new AppError("schema selector requires exact field and value", {
            status: 400,
            code: "agents_tool_schema_selector_invalid",
          });
        }
        selector = { field, value };
      }
      const operationIndex = readToolSchemaOperationIndex(declaredTool.parameters);
      const selectorRequired = operationIndex !== null && selector === undefined;
      let modelParameters: Record<string, unknown>;
      try {
		const storyPreviewOperationRequested =
          requestedName === STORY_PREVIEW_ORCHESTRATOR_TOOL &&
          selector?.field === "mode";
        if (storyPreviewOperationRequested && selector) {
          if (selector.value === "begin" || selector.value === "status") {
            modelParameters = buildStoryPreviewStaticOperationParameters(selector.value);
          } else {
            const boardIndex = readStoryPreviewPutBoardIndex(selector.value);
            const scopedChapterId = readTrimmedString(body.chapterId);
            const scopedProjectId = readTrimmedString(body.canvasProjectId);
            if (boardIndex === null || !scopedChapterId || !scopedProjectId) {
              throw new AppError("剧情预览板 Schema 缺少合法章节范围或板号", {
                status: 400,
                code: "story_preview_operation_schema_invalid",
                details: { selector, chapterId: scopedChapterId || null, projectId: scopedProjectId || null },
              });
            }
            const previewRow = await loadChapterCanvasAsFlowRow(
              c,
              requestUserId,
              scopedChapterId,
              scopedProjectId,
            );
            const snapshot = inspectStoryPreviewRunSnapshot({
              row: previewRow,
              chapterId: scopedChapterId,
            });
            if (snapshot.nextBoardIndex !== boardIndex) {
              throw new AppError("请求的剧情预览节点不是当前唯一可执行前沿", {
                status: 409,
                code: "story_preview_operation_not_ready",
                details: {
                  requestedMode: selector.value,
                  nextBoardIndex: snapshot.nextBoardIndex,
                  nextMode: snapshot.nextBoardIndex === null
                    ? "status"
                    : `put_board_${snapshot.nextBoardIndex}`,
                },
              });
            }
            modelParameters = buildStoryPreviewPutBoardParameters({
              mode: selector.value,
              board: snapshot.boards[boardIndex]!,
            });
          }
		} else if (selectorRequired) {
          modelParameters = buildToolOperationIndexParameters({ parameters: declaredTool.parameters, index: operationIndex });
        } else {
          modelParameters = projectToolParametersBySelector({
              parameters: declaredTool.parameters,
              ...(selector ? { selector } : {}),
            });
        }
      } catch (error) {
		if (error instanceof AppError) throw error;
        const selectorRepair = operationIndex
          ? {
              operationIndex,
              nextSchemaRequest: {
                name: requestedName,
                selector: {
                  field: operationIndex.field,
                  value: `<one of: ${operationIndex.values.join(" | ")}>`,
                },
              },
            }
          : null;
        throw new AppError(
          `无法投影远程工具 schema：${error instanceof Error ? error.message : String(error)}` +
            (operationIndex
              ? `；合法 selector 为 ${operationIndex.field}=<${operationIndex.values.join(" | ")}>，也可先省略 selector 读取结构化 operationIndex。`
              : ""),
          {
            status: 400,
            code: "agents_tool_schema_selector_unsupported",
            details: {
              toolName: requestedName,
              ...(selector ? { selector } : {}),
              ...(selectorRepair ?? {}),
            },
          },
        );
      }
      let imageExecutionCatalog: ReturnType<typeof buildAgentImageExecutionCatalog> | null = null;
      if (requestedName === "tapcanvas_image_generate_to_canvas") {
        const catalogResult = await loadPublicChatEnabledModelCatalogSummary(c, requestUserId);
        if (catalogResult.error || !catalogResult.summary) {
          throw new AppError("无法读取当前可执行图片模型目录", {
            status: 503,
            code: "image_model_catalog_unavailable",
            details: {
              reason: catalogResult.error || "catalog_summary_missing",
              upstreamRequestAttempted: false,
            },
          });
        }
        imageExecutionCatalog = buildAgentImageExecutionCatalog(
          catalogResult.summary,
          new Date().toISOString(),
        );
        if (imageExecutionCatalog.models.length === 0) {
          throw new AppError("当前没有可执行的图片模型", {
            status: 409,
            code: "image_model_catalog_empty",
            details: {
              catalogRevision: imageExecutionCatalog.revision,
              upstreamRequestAttempted: false,
            },
          });
        }
      }
      const schema = {
        name: declaredTool.name,
        description: declaredTool.description,
        parameters: modelParameters,
		...(imageExecutionCatalog ? { executionCatalog: imageExecutionCatalog } : {}),
        ...(selector ? { selector } : {}),
        ...(selectorRequired ? {
          selectorRequired: true,
          operationIndex,
          nextSchemaRequest: {
            name: declaredTool.name,
            selector: { field: operationIndex.field, value: `<one of: ${operationIndex.values.join(" | ")}>` },
          },
        } : {}),
		...(selector
			? {
				execution:
					readToolOperationExecution({ parameters: declaredTool.parameters, selector }) ??
					declaredTool.execution,
			}
			: declaredTool.execution
				? { execution: declaredTool.execution }
				: {}),
      };
      const content = JSON.stringify(schema);
      return c.json({
        ok: true as const,
        content,
        data: schema,
        ...(!selectorRequired ? { validationParameters: declaredTool.parameters } : {}),
      });
    }
	if (body.toolName === "tapcanvas_prompt_library_sync") {
		if (!adminWorkflowAccess) {
			throw new AppError("Administrator workflow access required", {
				status: 403,
				code: "admin_required",
			});
		}
		const projectId = readTrimmedString(body.canvasProjectId);
		const flowId = readTrimmedString(body.canvasFlowId);
		const executionId = readTrimmedString(body.executionId);
		if (!projectId || !flowId || !executionId) {
			throw new AppError("Prompt library sync requires project, flow, and workflow execution scope", {
				status: 400,
				code: "prompt_library_sync_scope_required",
				details: {
					projectId: projectId || null,
					flowId: flowId || null,
					executionId: executionId || null,
				},
			});
		}
		const [project, flow] = await Promise.all([
			getProjectForUserAccess(c.env.DB, projectId, requestUserId),
			getFlowForOwner(c.env.DB, flowId, requestUserId),
		]);
		if (!project || !flow || flow.project_id !== projectId) {
			throw new AppError("Prompt library sync scope was not found", {
				status: 404,
				code: "prompt_library_sync_scope_not_found",
			});
		}
		const args = PromptLibraryIncrementalSyncArgsSchema.parse(body.args);
		const receipt = await createPromptLibraryIncrementalCrawl(c.env.DB, {
			actorUserId: requestUserId,
			projectId,
			flowId,
			executionId,
			idempotencyKey: args.idempotencyKey,
			protocol: args.protocol,
		});
		if (receipt.selectedCount > 0) {
			c.executionCtx.waitUntil(kickPromptLibraryCrawl(c.env, receipt.run.id).catch((error: unknown) => {
				console.error(`[prompt-library] incremental workflow crawl failed: ${receipt.run.id}`, error);
			}));
		}
		const response = {
			status: receipt.selectedCount > 0 ? "accepted" as const : "up_to_date" as const,
			runId: receipt.run.id,
			alreadyAccepted: receipt.alreadyAccepted,
			selectedCount: receipt.selectedCount,
			sourceCounts: receipt.sourceCounts,
			maxItems: args.protocol.batch.maxItems,
			immutability: "source_prompt_text_preserved" as const,
			deduplication: ["source_url", "canonical_prompt_hash"] as const,
			mediaPersistence: "tapcanvas_r2_before_import" as const,
			vectorRoots: {
				image: "tapcanvas:prompt-library:market-validated:image",
				video: "tapcanvas:prompt-library:market-validated:video",
			},
		};
		return c.json({ ok: true as const, content: JSON.stringify(response), data: response });
	}
    const envelopeBookId =
      readTrimmedString(body.bookId) || deriveBookScopeIdFromChapterId(body.chapterId) || "";
    for (const [scopeName, envelopeValue, argumentValue] of [
      ["book", envelopeBookId, readTrimmedString(body.args.bookId)],
      ["node", readTrimmedString(body.canvasNodeId), readTrimmedString(body.args.nodeId)],
      ["execution", readTrimmedString(body.executionId), readTrimmedString(body.args.executionId)],
    ] as const) {
      if (envelopeValue && argumentValue && envelopeValue !== argumentValue) {
        throw new AppError(`${scopeName} scope conflicts with tool arguments`, {
          status: 409,
          code: `agents_tool_${scopeName}_scope_conflict`,
          details: { envelopeValue, argumentValue },
        });
      }
    }
    assertAgentToolUsesImageReferenceIds(body.toolName, body.args);

    // Canvas patch tools (add_node / connect_edge / set_param / link_existing_asset / finalize)
    // are captured via the SSE stream on the intent bridge; the tool execute endpoint just
    // acknowledges receipt so agents-cli can continue its loop.
    if (CANVAS_PATCH_TOOLS.has(body.toolName)) {
      const echo: Record<string, unknown> = { status: "queued", tool: body.toolName };
      if (typeof body.args.id === "string" && body.args.id) echo.nodeId = body.args.id;
      if (typeof body.args.source === "string" && body.args.source) echo.source = body.args.source;
      if (typeof body.args.target === "string" && body.args.target) echo.target = body.args.target;
      if (typeof body.args.nodeId === "string" && body.args.nodeId) echo.nodeId = body.args.nodeId;
      const content = JSON.stringify(echo);
      return c.json({ ok: true as const, content, data: echo });
    }

    // critic 是可选评审/诊断工具：text_storyboard 无需 flow/project，
    // video_clips 可按 runId 读取服务端 durable executable plan 的真实 clips。
    if (body.toolName === "tapcanvas_shot_table_critic") {
      const reviewMode = readTrimmedString(body.args.reviewMode);
      if (reviewMode !== "text_storyboard" && reviewMode !== "video_clips") {
        throw new AppError("reviewMode is required（必须显式选择 text_storyboard 或 video_clips）", {
          status: 400,
          code: "shot_critic_review_mode_required",
        });
      }
      if (Object.prototype.hasOwnProperty.call(body.args, "criticModel")) {
        throw new AppError(
          "criticModel 已从模型可控参数中移除；评审执行身份只绑定 parentAgentExecution.model/apiStyle",
          { status: 400, code: "execution_model_argument_forbidden" },
        );
      }
      const criticExecution = requireCallerAgentExecution(body);
      if (reviewMode === "text_storyboard") {
        const forbiddenVideoFields = [
          "runId",
          "clips",
          "filmBible",
          "generationContract",
          "adaptationStrategy",
        ].filter((field) => Object.prototype.hasOwnProperty.call(body.args, field));
        if (forbiddenVideoFields.length > 0) {
          throw new AppError(
            `text_storyboard 禁止携带 video_clips 参数：${forbiddenVideoFields.join(", ")}`,
            { status: 400, code: "shot_critic_review_mode_fields_conflict" },
          );
        }
        const shotTable = readTrimmedString(body.args.shotTable);
        if (!shotTable) {
          const receivedType = Array.isArray(body.args.shotTable)
            ? "array"
            : body.args.shotTable === null
              ? "null"
              : typeof body.args.shotTable;
          throw new AppError("shotTable is required（必须送审准备交付的完整文本分镜表）", {
            status: 400,
            code: "shot_critic_text_storyboard_required",
			terminal: false,
			details: {
				issues: [{
					code: "invalid_type",
					path: ["shotTable"],
					expected: "non-empty string",
					received: receivedType,
				}],
			},
          });
        }
        if (shotTable.length > 240_000) {
          throw new AppError("shotTable 超过 text_storyboard critic 的 240000 字符上限", {
            status: 400,
            code: "shot_critic_text_storyboard_too_large",
          });
        }
        const sourceMaterial = readTrimmedString(body.args.sourceMaterial);
        if (typeof body.args.reviewContract !== "undefined" && !sourceMaterial) {
          throw new AppError(
            "带 reviewContract 的 text_storyboard 审查必须同时传完整 sourceMaterial",
            {
				status: 400,
				code: "shot_critic_text_source_required",
				terminal: false,
				details: {
					issues: [{
						code: "required",
						path: ["sourceMaterial"],
						expected: "non-empty string when reviewContract is present",
					}],
				},
			},
          );
        }
        if (sourceMaterial.length > 240_000) {
          throw new AppError("sourceMaterial 超过 text_storyboard critic 的 240000 字符上限", {
            status: 400,
            code: "shot_critic_text_source_too_large",
          });
        }
        const brief = readTrimmedString(body.args.brief);
        const result = await critiqueTextStoryboard(c as never, {
          shotTable,
          criticModel: criticExecution.model,
          criticApiStyle: criticExecution.apiStyle,
          ...(sourceMaterial ? { sourceMaterial } : {}),
          ...(typeof body.args.reviewContract !== "undefined"
            ? { reviewContract: body.args.reviewContract }
            : {}),
          ...(brief ? { brief } : {}),
        });
        const enriched = {
          ...result,
          reviewMode,
          reviewedSource: "caller_final_text_storyboard",
          note: "文本分镜已完成独立评审；topFixes 仅作为可选修订建议。",
        };
        return c.json(
          AgentsToolExecuteResponseSchema.parse({
            ok: true,
            content: JSON.stringify(enriched),
            data: enriched,
          }),
        );
      }

      const forbiddenTextFields = ["shotTable", "sourceMaterial", "reviewContract"].filter(
        (field) => Object.prototype.hasOwnProperty.call(body.args, field),
      );
      if (forbiddenTextFields.length > 0) {
        throw new AppError(
          `video_clips 禁止携带 text_storyboard 参数：${forbiddenTextFields.join(", ")}`,
          { status: 400, code: "shot_critic_review_mode_fields_conflict" },
        );
      }
      // 【critic 审真相源·根治「喂概括版博弈分数」（2026-07-04 ch3 六会话实测）】
      // 病根：critic 审的是小T 现写的 shotTable 文本——被打低分后重递一份「更好看的摘要」拿高分过审，
      // 审的和生成的不是同一份（60→85、69→83 实测）。修法（正确默认）：带 runId 时服务端直接取
      // durable executable plan 的真实 clips，用它们渲染受审文本。
      // 小T 递的 shotTable/clips 只在无 runId（散跑小片）时才被采信。
      const criticRunId = readTrimmedString(body.args.runId);
      let serverClips: unknown[] | null = null;
      const criticRun = criticRunId
        ? await getVideoRunForRequest({
            runId: criticRunId,
            ownerId: requestUserId,
            projectId: body.canvasProjectId,
            flowId: body.canvasFlowId,
            chapterId: body.chapterId,
          })
        : null;
      if (criticRunId) {
        let durablePlan: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(String(criticRun?.story_plan ?? "")) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            durablePlan = parsed as Record<string, unknown>;
          }
        } catch {
          durablePlan = null;
        }
        if (durablePlan) {
          const { executablePlanHash, ...hashPayload } = durablePlan;
          if (
            durablePlan.protocolVersion !== VIDEO_ORCHESTRATOR_PROTOCOL_VERSION ||
            typeof executablePlanHash !== "string" ||
            executablePlanHash !== stableContentHash(hashPayload)
          ) {
            throw new AppError("critic 读取的 durable executable plan 版本或哈希不一致", {
              status: 409,
              code: "shot_critic_executable_plan_hash_invalid",
            });
          }
        }
        const resolved = durablePlan?.clips;
        if (Array.isArray(resolved) && resolved.length) {
          serverClips = resolved;
        } else {
          throw new AppError(
            `runId「${criticRunId}」没有哈希有效的 durable executable plan clips。`,
            { status: 400, code: "shot_critic_run_clips_missing" },
          );
        }
      }
      const reviewedClips =
        serverClips ??
        (Array.isArray(body.args.clips) ? body.args.clips : null);
      if (!reviewedClips?.length) {
        throw new AppError("clips is required（必须送审最终结构化 clips，禁止只递概括镜头表）", {
          status: 400,
          code: "shot_critic_clips_required",
        });
      }
      const filmBible = criticRunId
        ? await loadFilmBibleDurable(criticRunId, criticRun)
        : body.args.filmBible && typeof body.args.filmBible === "object" && !Array.isArray(body.args.filmBible)
          ? (body.args.filmBible as Record<string, unknown>)
          : null;
      const generationContract = criticRunId
        ? await resolveStoryPlanGenerationContract({
            c: c as never,
            storyPlan: criticRun?.beat_sheet
              ? JSON.parse(criticRun.beat_sheet) as unknown
              : criticRun?.story_plan
                ? JSON.parse(criticRun.story_plan) as unknown
                : null,
            allowCatalogResolution: false,
          })
        : parseVideoGenerationContract(body.args.generationContract);
      if (!generationContract) {
        throw new AppError("generationContract is required（必须来自同一视频模型目录快照）", {
          status: 400,
          code: "critic_generation_contract_invalid",
        });
      }
      const brief = readTrimmedString(body.args.brief);
      const result = await critiqueShotTable(c as never, {
        clips: reviewedClips,
        filmBible,
        generationContract,
        criticModel: criticExecution.model,
        criticApiStyle: criticExecution.apiStyle,
        ...(brief ? { brief } : {}),
      });
      const enriched = result as unknown as Record<string, unknown>;
      if (serverClips) {
        enriched.reviewedSource = "server_durable_executable_plan";
        enriched.reviewedClipCount = serverClips.length;
        enriched.note = "本次评审的是服务端按 runId 读取且验证过哈希的 durable executable plan clips。";
      }
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(enriched),
          data: enriched,
        }),
      );
    }

    if (body.toolName === "tapcanvas_equipped_workflow_run") {
	  const parentAgentExecution = requireCallerAgentExecution(body);
	  const eligibleAttachments = filterEquippedWorkflowsByExecutionVariant(
		await listEquippedWorkflowCapabilities(c, requestUserId),
		body.requestedWorkflowExecutionVariant ?? null,
	  );
	  const requestedAttachmentId = readTrimmedString(body.args.attachmentId);
	  if (eligibleAttachments.length === 0) {
		throw new AppError("No equipped workflow is available for the requested execution variant", {
		  status: 409,
		  code: "capability_attachment_unavailable",
		  details: { requestedWorkflowExecutionVariant: body.requestedWorkflowExecutionVariant ?? null },
		});
	  }
	  if (eligibleAttachments.length === 1 && requestedAttachmentId) {
		throw new AppError("attachmentId is server-bound when exactly one workflow is equipped", {
		  status: 400,
		  code: "capability_attachment_server_bound",
		  details: { requestedWorkflowExecutionVariant: body.requestedWorkflowExecutionVariant ?? null },
		});
	  }
	  const attachmentId = eligibleAttachments.length === 1
		? eligibleAttachments[0]!.id
		: requestedAttachmentId;
      const requestedIdempotencyKey = readTrimmedString(body.args.idempotencyKey);
      if (!attachmentId) throw new AppError("attachmentId is required", { status: 400, code: "capability_attachment_id_required" });
      if (!requestedIdempotencyKey) throw new AppError("idempotencyKey is required", { status: 400, code: "idempotency_key_required" });
      if (body.args.concurrency !== undefined) {
        throw new AppError("Equipped workflow concurrency is authored by the workflow definition", {
          status: 400,
          code: "workflow_concurrency_managed_by_definition",
        });
      }
      let parsedTriggerPayload = normalizeEquippedWorkflowTriggerPayload(body.args);
      const target = await resolveEquippedWorkflowExecutionTarget(c, requestUserId, attachmentId);
      const requestedWorkflowExecutionVariant = body.requestedWorkflowExecutionVariant;
      const actualWorkflowExecutionVariant = target.attachment.descriptor.invocation?.executionVariant;
      if (
		requestedWorkflowExecutionVariant &&
		actualWorkflowExecutionVariant !== requestedWorkflowExecutionVariant
	  ) {
		throw new AppError(
		  `Workflow execution variant mismatch: requested ${requestedWorkflowExecutionVariant}, got ${actualWorkflowExecutionVariant ?? "undeclared"}`,
		  {
			status: 409,
			code: "workflow_execution_variant_mismatch",
			details: {
			  attachmentId,
			  requestedWorkflowExecutionVariant,
			  actualWorkflowExecutionVariant: actualWorkflowExecutionVariant ?? null,
			},
		  },
		);
	  }
      if (equippedWorkflowRequiresVideoModel(target.attachment.descriptor)) {
		const modelKey = readTrimmedString(parsedTriggerPayload?.videoModelKey);
		if (!modelKey) {
        throw new AppError(
          "One-click video workflows require triggerPayload.videoModelKey copied from the current enabled video model catalog",
          { status: 400, code: "workflow_video_model_key_required" },
        );
		}
		const enabledVideoModelKeys = await requireEnabledVideoModelKeys(
			c as unknown as AppContext,
			requestUserId,
		);
		if (!enabledVideoModelKeys.includes(modelKey)) {
			throw new AppError(`Video model is not enabled: ${modelKey}`, {
				status: 409,
				code: "workflow_video_model_not_enabled",
				details: { modelKey, enabledVideoModelKeys },
			});
		}
      }
	  if (equippedWorkflowRequiresImageModel(target.attachment.descriptor)) {
		const modelKey = readTrimmedString(parsedTriggerPayload?.imageModelKey);
		const imageAspectRatio = readTrimmedString(parsedTriggerPayload?.imageAspectRatio);
		const imageSize = readTrimmedString(parsedTriggerPayload?.imageSize);
		if (!modelKey || !imageAspectRatio || !imageSize) {
			throw new AppError(
				"Workflow image generation requires triggerPayload.imageModelKey, imageAspectRatio and imageSize from the current enabled image model catalog",
				{ status: 400, code: "workflow_image_generation_contract_required" },
			);
		}
		const enabledImageModels = await requireEnabledImageModelCatalog(
			c as unknown as AppContext,
			requestUserId,
		);
		const selectedModel = enabledImageModels.find((model) => model.modelKey.trim() === modelKey);
		if (!selectedModel) {
			throw new AppError(`Image model is not enabled: ${modelKey}`, {
				status: 409,
				code: "workflow_image_model_not_enabled",
				details: { modelKey, enabledImageModelKeys: enabledImageModels.map((model) => model.modelKey) },
			});
		}
		const imageOptions = selectedModel.imageOptions;
		if (imageOptions?.aspectRatioOptions.length && !imageOptions.aspectRatioOptions.includes(imageAspectRatio)) {
			throw new AppError(`Image model ${modelKey} does not support aspect ratio ${imageAspectRatio}`, {
				status: 400,
				code: "workflow_image_aspect_ratio_not_supported",
				details: { modelKey, imageAspectRatio, supported: imageOptions.aspectRatioOptions },
			});
		}
		const imageSizeOptions = imageOptions?.imageSizeOptions.map((option) => option.value) ?? [];
		const canonicalImageSize = resolveCanonicalCatalogImageSize(imageSize, imageSizeOptions);
		if (!canonicalImageSize) {
			throw new AppError(`Image model ${modelKey} does not support image size ${imageSize}`, {
				status: 400,
				code: "workflow_image_size_not_supported",
				details: { modelKey, imageSize, supported: imageSizeOptions },
			});
		}
		if (parsedTriggerPayload && canonicalImageSize !== imageSize) {
			parsedTriggerPayload = { ...parsedTriggerPayload, imageSize: canonicalImageSize };
		}
	  }
      const admittedVideoPlan = await freezeWorkflowVideoPlanAtAdmission({
        c: c as unknown as AppContext,
        triggerPayload: parsedTriggerPayload,
      });
      let triggerPayload = admittedVideoPlan.triggerPayload;
      const callerProjectId = readTrimmedString(body.canvasProjectId);
      const callerChapterId = resolveChapterCanvasId({
        chapterId: body.chapterId,
        flowScopedToolRequested: true,
      });
      const callerFlowId = callerChapterId || readTrimmedString(body.canvasFlowId);
      if (!callerProjectId || !callerFlowId) {
        throw new AppError("Equipped workflows require the current project and canvas context", {
          status: 400,
          code: "workflow_project_context_required",
        });
      }
      const delivery = resolveWorkflowDeliveryScope({
        workflowFlowId: target.flow.id,
        callerProjectId,
        callerFlowId,
        callerChapterId,
      });
      const publicTurnId = readTrimmedString(body.publicTurnId);
      const idempotencyKey = resolveEquippedWorkflowIdempotencyKey({
        requestedKey: requestedIdempotencyKey,
        publicTurnId,
      });
	  if (publicTurnId) {
		triggerPayload = mergeAcceptedPublicChatAssetSelection({
			triggerPayload,
			acceptedAssetIds: await resolvePublicChatTurnSelectedAssetIds({
				c: c as unknown as AppContext,
				userId: requestUserId,
				publicTurnId,
			}),
		});
	  }
      const sourceMode = target.attachment.descriptor.invocation?.sourceMode;
      if (shouldUseAcceptedPublicChatTurnAsWorkflowSource({
        publicTurnId,
        sourceMode,
        chapterId: callerChapterId,
      })) {
        const acceptedPrompt = await resolvePublicChatTurnPrompt({
          c: c as AppContext,
          userId: requestUserId,
          publicTurnId,
        });
        triggerPayload = {
          ...(triggerPayload ?? {}),
          [WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD]: createWorkflowAcceptedTurnSource({
            ownerId: requestUserId,
            sourceId: publicTurnId,
            text: acceptedPrompt,
          }),
        };
      }
      const runContext = await buildWorkflowProjectContextForRun({
        c: c as unknown as AppContext,
        ownerId: requestUserId,
        projectId: callerProjectId,
        canvasId: callerFlowId,
        ...(callerChapterId ? { chapterId: callerChapterId } : {}),
        activeNodeId: body.canvasNodeId ?? null,
        triggerPayload,
      });
      try {
        const result = await startWorkflowExecution(c.env, {
          flow: target.flow,
          ownerId: requestUserId,
          triggerNodeId: target.attachment.descriptor.triggerNodeId,
          trigger: "agent",
          ...(triggerPayload === undefined ? {} : { triggerPayload }),
          ...(delivery ? { delivery } : {}),
          projectContext: runContext.projectContext,
          callerCanvasSnapshot: runContext.callerCanvasSnapshot,
          initiatingAgentExecution: {
            model: parentAgentExecution.model,
            apiStyle: parentAgentExecution.apiStyle,
          },
          idempotencyKey: `capability:${target.attachment.id}:${idempotencyKey}`,
          materializeAcceptedExecution: async (execution) => {
            await upsertEquippedWorkflowExecutionProjection({
              c: c as unknown as AppContext,
              ownerId: requestUserId,
              flowId: callerFlowId,
              ...(callerChapterId ? { chapterId: callerChapterId } : {}),
              execution,
            });
          },
        });
        const acceptedExecution = WorkflowExecutionSchema.parse(result.execution);
        const provenance = body.parentAgentExecution?.provenance;
        await recordCapabilityInvocation(c as unknown as AppContext, {
          userId: requestUserId,
          attachment: target.attachment,
		  workflowExecutionId: acceptedExecution.id,
          agentExecutionId: provenance?.executionId ?? null,
          sessionId: provenance?.sessionId ?? null,
          toolCallId: body.toolCallId ?? null,
          invocationInput: {
			concurrency: acceptedExecution.concurrency,
			...(publicTurnId ? { publicTurnId } : {}),
            ...(body.canvasProjectId ? { canvasProjectId: body.canvasProjectId } : {}),
            ...(body.canvasFlowId ? { canvasFlowId: body.canvasFlowId } : {}),
            ...(body.canvasNodeId ? { canvasNodeId: body.canvasNodeId } : {}),
            ...(callerChapterId ? { chapterId: callerChapterId } : {}),
          },
        });
		const immediateState = await readImmediateWorkflowExecutionAgentState(c.env.DB, {
			ownerId: requestUserId,
			fallbackExecution: acceptedExecution,
		});
		const execution = immediateState.execution;
        const response = {
          created: result.created,
          capabilityId: target.attachment.descriptor.capabilityId,
          capabilityName: target.attachment.descriptor.name,
		  ...buildWorkflowExecutionAgentSummary(execution, immediateState.workflowOutputs),
          ...(admittedVideoPlan.durationPlan
            ? {
                deliveryKind: "video" as const,
                providerSubmissionTopology: admittedVideoPlan.durationPlan,
              }
            : {}),
			trackingHint:
				"这是持久 Workflow IR 执行。若回执尚未 terminal，使用 inspection 指定的 tapcanvas_workflow_execution_inspect 跟踪同一执行族；成功终态的 workflowOutputs 是 workflow.output/v1 标准交付边界，必须原样转交其中的用户输出。不要把 executionId 传给 tapcanvas_pipeline_run_get。",
        };
        return c.json({ ok: true, content: JSON.stringify(response), data: response });
      } catch (error: unknown) {
        if (error instanceof WorkflowStartError) {
          throw new AppError(error.message, { status: error.status, code: error.code, details: error.details });
        }
        throw error;
      }
    }

    const projectId = String(body.canvasProjectId || "").trim();
    const flowId = String(body.canvasFlowId || "").trim();
    const requestNodeId = String(body.canvasNodeId || "").trim();
    const scopedBookId =
      readTrimmedString(body.bookId) || deriveBookScopeIdFromChapterId(body.chapterId) || "";
    const scopedChapter =
      readScopedChapterNumber(body.chapterId) || parseChapterSequenceFromChapterId(body.chapterId);
    const rawChapterId = readTrimmedString(body.chapterId);
    const flowToolRequested =
      body.toolName === "tapcanvas_flow_get" ||
      body.toolName === "tapcanvas_flow_search" ||
      body.toolName === "tapcanvas_node_text_edit" ||
      body.toolName === "tapcanvas_flow_patch" ||
      body.toolName === "tapcanvas_asset_add_to_canvas" ||
      body.toolName === "tapcanvas_material_assets_sync";
    const flowScopedToolRequested =
      flowToolRequested ||
      body.toolName === "tapcanvas_image_generate_to_canvas" ||
      body.toolName === "tapcanvas_video_generate_to_canvas" ||
      body.toolName === "tapcanvas_video_extract_last_frame" ||
      body.toolName === "tapcanvas_video_extract_frames" ||
      body.toolName === "tapcanvas_video_concat" ||
      body.toolName === "tapcanvas_voice_card_dub" ||
      body.toolName === "tapcanvas_annotate_shot" ||
      body.toolName === "tapcanvas_render_blocking_diagram" ||
      body.toolName === "tapcanvas_video_reconcile" ||
      body.toolName === "tapcanvas_image_reconcile" ||
	  body.toolName === STORY_PREVIEW_ORCHESTRATOR_TOOL ||
	  body.toolName === "tapcanvas_project_look_bible_confirm" ||
      body.toolName === "tapcanvas_image_refs_get" ||
      body.toolName === "tapcanvas_analyze_image" ||
      body.toolName === "tapcanvas_analyze_video" ||
      body.toolName === "tapcanvas_decompose_video" ||
      body.toolName === "tapcanvas_distill_director_breakdown" ||
      body.toolName === "tapcanvas_video_compare" ||
      body.toolName === "tapcanvas_fetch_video_from_url" ||
      body.toolName === "tapcanvas_storyboard_source_bundle_get" ||
      body.toolName === "tapcanvas_node_context_bundle_get" ||
      body.toolName === "tapcanvas_video_review_bundle_get" ||
      body.toolName === "tapcanvas_executions_list" ||
      body.toolName === "tapcanvas_execution_get" ||
      body.toolName === "tapcanvas_execution_node_runs_get" ||
      body.toolName === "tapcanvas_execution_events_list" ||
      body.toolName === "tapcanvas_workflow_execution_inspect" ||
	  body.toolName === "tapcanvas_workflow_resume" ||
      body.toolName === "tapcanvas_workflow_run" ||
      body.toolName === "tapcanvas_capture_director_scene" ||
      body.toolName === "tapcanvas_render_director_clip" ||
      body.toolName === "tapcanvas_director_define_motion" ||
      body.toolName === "tapcanvas_director_set_character_motion" ||
      body.toolName === "tapcanvas_master_storyboard_split";
    // A flow-scoped tool must read and write one flow truth. In a chapter
    // session that truth is chapters.canvas_flow, including read-only vision
    // tools that resolve media by nodeId.
    const chapterCanvasId = resolveChapterCanvasId({
      chapterId: rawChapterId,
      flowScopedToolRequested,
    });
    if (flowScopedToolRequested && !flowId && !chapterCanvasId) {
      throw new AppError("Flow id required", {
        status: 400,
        code: "flow_id_required",
      });
    }
    if (!flowToolRequested && !projectId) {
      throw new AppError("Project id required", {
        status: 400,
        code: "project_id_required",
      });
    }
    if (
      (body.toolName === "tapcanvas_node_context_bundle_get" ||
        body.toolName === "tapcanvas_video_review_bundle_get") &&
      !requestNodeId &&
      !readTrimmedString(body.args.nodeId)
    ) {
      throw new AppError("Node id required", {
        status: 400,
        code: "node_id_required",
      });
    }

    if (body.toolName === "tapcanvas_project_flows_list") {
      const rows = devBypass
        ? await listFlowsByProject(c.env.DB, projectId)
        : await listFlowsByOwner(c.env.DB, requestUserId, projectId);
      const response = {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          updatedAt: row.updated_at,
        })),
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_project_context_get") {
      const chapter = scopedChapter || readScopedChapterNumber(body.args.chapter) || undefined;
      const targetBookId = readTrimmedString(body.args.bookId) || scopedBookId;
      const context = await getUserProjectWorkspaceContext(c as never, requestUserId, {
        projectId,
        ...(targetBookId ? { bookId: targetBookId } : {}),
        ...(typeof chapter === "number" ? { chapter } : {}),
        ...(body.args.refresh === true ? { refresh: true } : {}),
      });
      const parsed = ProjectWorkspaceContextSchema.parse(context);
      return c.json({ ok: true, content: JSON.stringify(parsed), data: parsed as Record<string, unknown> });
    }

    if (body.toolName === "tapcanvas_project_creative_brief_update") {
      const content = typeof body.args.content === "string" ? body.args.content : "";
      if (!content.trim()) {
        throw new AppError("content is required", {
          status: 400,
          code: "project_creative_brief_content_required",
        });
      }
      const context = await updateUserProjectWorkspaceContextFile(
        c as unknown as AppContext,
        requestUserId,
        {
          projectId,
          fileName: "CREATIVE_BRIEF.md",
          content,
        },
      );
      const file = context.projectFiles.find((item) => item.path.endsWith("/CREATIVE_BRIEF.md"));
      if (!file) {
        throw new AppError("Creative brief was written but could not be read back", {
          status: 500,
          code: "project_creative_brief_readback_missing",
        });
      }
      const response = {
        projectId,
        fileName: "CREATIVE_BRIEF.md" as const,
        content: file.content,
        updatedAt: file.updatedAt,
        updatedBy: file.updatedBy,
        history: file.history,
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_project_chapters_list") {
      const items = await listProjectChaptersForUser(
        c as unknown as AppContext,
        requestUserId,
        projectId,
      );
      const response = {
        projectId,
        items: items.map((chapter) => ({
			id: chapter.id,
			projectId: chapter.projectId,
			index: chapter.index,
			title: chapter.title,
			status: chapter.status,
			sortOrder: chapter.sortOrder,
			legacyChunkIndex: chapter.legacyChunkIndex,
			sourceBookId: chapter.sourceBookId,
			sourceBookChapter: chapter.sourceBookChapter,
			createdAt: chapter.createdAt,
			updatedAt: chapter.updatedAt,
          sourceKind: chapter.sourceBookId ? "uploaded_book" as const : "manual" as const,
        })),
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_project_chapter_get") {
      const chapterId = readTrimmedString(body.args.chapterId);
      if (!chapterId) {
        throw new AppError("chapterId is required", {
          status: 400,
          code: "chapter_id_required",
        });
      }
      const chapter = await getChapterForUser(
        c as unknown as AppContext,
        requestUserId,
        chapterId,
      );
      if (chapter.projectId !== projectId) {
        throw new AppError("Chapter not found in current project", {
          status: 404,
          code: "chapter_not_found",
        });
      }
      const canvas = await getChapterCanvasFlow(
        c as unknown as AppContext,
        requestUserId,
        chapterId,
      );
      const response = buildProjectChapterReadPayload({
        chapter,
        revision: canvas.revision,
        flow: canvas.flow,
        args: body.args,
      });
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_project_chapter_update") {
      const chapterId = readTrimmedString(body.args.chapterId);
      const title = body.args.title === undefined ? undefined : readTrimmedString(body.args.title);
      const summary = body.args.summary === undefined ? undefined : readTrimmedString(body.args.summary);
      const storyPreviewContract = body.args.storyPreviewContract === undefined
        ? undefined
        : normalizeStoryPreviewContract(body.args.storyPreviewContract);
      const expectedCanvasRevision = Number(body.args.expectedCanvasRevision);
      if (!chapterId || !Number.isInteger(expectedCanvasRevision) || expectedCanvasRevision < 0) {
        throw new AppError("chapterId and a non-negative expectedCanvasRevision are required", {
          status: 400,
          code: "chapter_narrative_update_bad_args",
        });
      }
      if (body.args.storyPreviewContract !== undefined && !storyPreviewContract) {
        throw new AppError("storyPreviewContract is invalid", {
          status: 400,
          code: "chapter_story_preview_contract_invalid",
        });
      }
      if (title === undefined && summary === undefined && storyPreviewContract === undefined) {
        throw new AppError("title, summary, or storyPreviewContract is required", {
          status: 400,
          code: "chapter_narrative_update_bad_args",
        });
      }
      const current = await getChapterForUser(c as unknown as AppContext, requestUserId, chapterId);
      if (current.projectId !== projectId) {
        throw new AppError("Chapter not found in current project", {
          status: 404,
          code: "chapter_not_found",
        });
      }
      const result = await updateChapterNarrativeForUser(
        c as unknown as AppContext,
        requestUserId,
        chapterId,
        {
          expectedCanvasRevision,
          ...(title !== undefined ? { title } : {}),
          ...(summary !== undefined ? { summary } : {}),
          ...(storyPreviewContract ? { storyPreviewContract } : {}),
        },
      );
      const response = {
        // Keep the exact action-followup identity ahead of the potentially
        // large chapter narrative so provider projection cannot drop it.
        canvasRevision: result.canvasRevision,
        sourceHash: result.sourceHash,
        sourceNodeId: String(result.seedNode.id),
        storyPreviewContract: result.seedNode.data && typeof result.seedNode.data === "object"
          ? (result.seedNode.data as Record<string, unknown>).storyPreviewContract ?? null
          : null,
        nextRequiredAction:
          "Generate the chapter story_preview series against this exact canvasRevision/sourceHash; each board carries 1-9 panels and is preview-only.",
        chapter: result.chapter,
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    const project = devBypass
      ? await getProjectById(c.env.DB, projectId)
      : await getProjectForOwner(c.env.DB, projectId, requestUserId);
    if (!flowToolRequested) {
      if (!project) {
        throw new AppError("Project not found", {
          status: 404,
          code: "project_not_found",
        });
      }
      if (!isNodeRuntime()) {
        throw new AppError("Node runtime required", {
          status: 400,
          code: "node_runtime_required",
        });
      }
    }
    const projectOwnerUserId = flowToolRequested
      ? requestUserId
      : resolveProjectOwnerUserId({
          devBypass,
          requestUserId,
          projectOwnerId: project?.owner_id ?? null,
        });

    // 计费/可见性同源于项目归属。本回调（agents-cli → /tools/execute）不携带浏览器的
    // X-Team-Id，若不重建则 resolveBillingTeamId 会 fallback 到 owner 的「第一个团队」，
    // 导致个人项目的故事板生成被错扣到某团队积分。按项目归属重建 activeTeamId：项目绑团队
    // 且 owner 是成员 => 该团队；否则（纯个人项目）=> personal。
    if (!flowToolRequested && project) {
      c.set(
        "activeTeamId",
        await resolveProjectBillingTeamId(c.env.DB, {
          projectId,
          userId: projectOwnerUserId,
        }),
      );
    }

    const loadImageReferenceFlowRow = async () => {
      const referenceChapterCanvasId = resolveChapterCanvasId({
        chapterId: rawChapterId,
        flowScopedToolRequested: true,
      });
      if (!flowId && !referenceChapterCanvasId) {
        throw new AppError("Flow id required for image node references", {
          status: 400,
          code: "flow_id_required",
        });
      }
      const referenceRow = referenceChapterCanvasId
        ? await loadChapterCanvasAsFlowRow(
            c as never,
            requestUserId,
            referenceChapterCanvasId,
            projectId,
          )
        : devBypass
          ? await getFlowByIdUnsafe(c.env.DB, flowId)
          : await getFlowForOwner(c.env.DB, flowId, requestUserId);
      if (!referenceRow) {
        throw new AppError("Flow not found", {
          status: 404,
          code: "flow_not_found",
        });
      }
      return referenceRow;
    };

    if (body.toolName === "tapcanvas_books_list") {
      const booksRoot = buildProjectBooksRoot(projectId, projectOwnerUserId);
      const items: Array<Record<string, unknown>> = [];
      try {
        const entries = await fs.readdir(booksRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const indexPath = path.join(booksRoot, entry.name, "index.json");
          const idx = await readBookIndexSafe(indexPath);
          if (!idx) continue;
          items.push({
            bookId: readTrimmedString(idx.bookId) || entry.name,
            title: readTrimmedString(idx.title) || entry.name,
            chapterCount: Number(idx.chapterCount || 0) || 0,
            updatedAt: readTrimmedString(idx.updatedAt),
          });
        }
      } catch {
        // Keep parity with existing public books list route: missing folder returns empty array.
      }
      items.sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      );
      return c.json({ ok: true, content: JSON.stringify(items), data: { items } });
    }

    // A chapter-scoped agent session already carries the authorized book
    // identity. The model may echo a display/node id here, but that value is
    // not authority and must never replace the request's bound book. This is
    // a deterministic scope rule, not content-based routing.
    const requestedBookId = scopedBookId || readTrimmedString(body.args.bookId);
    if (
      (
        body.toolName === "tapcanvas_book_index_get" ||
        body.toolName === "tapcanvas_book_evidence_search" ||
        body.toolName === "tapcanvas_book_style_confirm" ||
        body.toolName === "tapcanvas_book_chapter_get" ||
        body.toolName === "tapcanvas_book_chapter_summary_set" ||
        body.toolName === "tapcanvas_book_worldbible_confirm" ||
        body.toolName === "tapcanvas_book_storyboard_plan_get" ||
        body.toolName === "tapcanvas_book_storyboard_plan_upsert" ||
        body.toolName === "tapcanvas_story_facts_get" ||
        body.toolName === "tapcanvas_story_facts_commit" ||
        body.toolName === "tapcanvas_storyboard_continuity_get"
      ) &&
      !requestedBookId
    ) {
      throw new AppError("bookId is required", {
        status: 400,
        code: "book_id_required",
      });
    }
    const resolvedBookDirName = requestedBookId
      ? await resolveProjectBookDirectoryName({
          projectId,
          userId: projectOwnerUserId,
          requestedBookId,
        })
      : null;
    const effectiveBookDirName = resolvedBookDirName || sanitizePathSegment(requestedBookId);

    if (body.toolName === "tapcanvas_book_index_get") {
      const idx = effectiveBookDirName
        ? await readBookIndexSafe(buildBookIndexPath(projectId, projectOwnerUserId, effectiveBookDirName))
        : null;
      if (!idx) {
        throw new AppError("Book not found", {
          status: 404,
          code: "book_not_found",
        });
      }
      return c.json({ ok: true, content: JSON.stringify(idx), data: idx });
    }

    if (body.toolName === "tapcanvas_book_evidence_search") {
      const parsedArgs = BookEvidenceSearchArgsSchema.safeParse({
        ...body.args,
        bookId: requestedBookId,
      });
      if (!parsedArgs.success) {
        throw new AppError("Invalid book evidence search request", {
          status: 400,
          code: "book_evidence_search_invalid",
          severity: "warning",
          details: { issues: parsedArgs.error.issues },
        });
      }
      if (!effectiveBookDirName) {
        throw new AppError("Book not found", {
          status: 404,
          code: "book_not_found",
        });
      }
      try {
        const response = await searchBookEvidence({
          bookDirectory: path.join(
            buildProjectBooksRoot(projectId, projectOwnerUserId),
            effectiveBookDirName,
          ),
          query: parsedArgs.data.query,
          chapterStart: parsedArgs.data.chapterStart,
          chapterEnd: parsedArgs.data.chapterEnd,
          limit: parsedArgs.data.limit,
        });
        if (response.projectId !== projectId) {
          throw new BookEvidenceError(
            "book_evidence_index_invalid",
            "书籍证据索引 projectId 与当前授权项目不一致",
            {
              expectedProjectId: projectId,
              actualProjectId: response.projectId,
            },
          );
        }
        return c.json({
          ok: true,
          content: JSON.stringify(response),
          data: response,
        });
      } catch (error) {
        if (!(error instanceof BookEvidenceError)) throw error;
        const status =
          error.code === "book_evidence_query_invalid"
            ? 400
            : error.code === "book_evidence_index_not_found" ||
                error.code === "book_evidence_source_not_found"
              ? 404
              : error.code === "book_evidence_source_mismatch"
                ? 409
                : 422;
        throw new AppError(error.message, {
          status,
          code: error.code,
          details: error.details,
        });
      }
    }

    if (body.toolName === "tapcanvas_story_facts_get") {
      const parsedRequest = StoryFactsGetRequestSchema.safeParse({
        ...body.args,
        bookId: requestedBookId,
      });
      if (!parsedRequest.success) {
        throw new AppError("Invalid story facts read request", {
          status: 400,
          code: "story_facts_get_invalid",
          details: { issues: parsedRequest.error.issues },
        });
      }
      const bookDir = effectiveBookDirName
        ? path.join(buildProjectBooksRoot(projectId, projectOwnerUserId), effectiveBookDirName)
        : "";
      const idx = bookDir ? await readBookIndexSafe(path.join(bookDir, "index.json")) : null;
      if (!idx) {
        throw new AppError("Book not found", { status: 404, code: "book_not_found" });
      }
      const actualBookId = readTrimmedString(idx.bookId);
      let ledger: Awaited<ReturnType<typeof readStoryFactsLedger>>;
      try {
        ledger = await readStoryFactsLedger({
          filePath: path.join(bookDir, "story-facts.json"),
          projectId,
          bookId: actualBookId,
        });
      } catch (error) {
        if (error instanceof StoryFactsStoreError) throw mapStoryFactsStoreError(error);
        throw error;
      }
      const statuses = parsedRequest.data.statuses
        ? new Set<string>(parsedRequest.data.statuses)
        : undefined;
      const subjectKeys = parsedRequest.data.subjectKeys
        ? new Set<string>(parsedRequest.data.subjectKeys)
        : undefined;
      const matchedFacts = selectStoryFacts({
        ledger,
        ...(parsedRequest.data.at ? { at: parsedRequest.data.at } : {}),
        ...(statuses ? { statuses } : {}),
        ...(subjectKeys ? { subjectKeys } : {}),
        ...(parsedRequest.data.includeClosed === true ? { includeClosed: true } : {}),
      });
      const limit = parsedRequest.data.limit ?? 200;
      const offset = parsedRequest.data.offset ?? 0;
      const selectedFacts = matchedFacts.slice(offset, offset + limit);
      const audienceAt = parsedRequest.data.projection === "audience_safe"
        ? parsedRequest.data.at
        : undefined;
      if (parsedRequest.data.projection === "audience_safe" && !audienceAt) {
        throw new AppError("Audience-safe story facts require an exact story point", {
          status: 400,
          code: "story_facts_audience_point_required",
        });
      }
      const facts =
        audienceAt
          ? projectStoryFactsForAudience({
              facts: selectedFacts,
              at: audienceAt,
            })
          : selectedFacts;
      const response = {
        projectId,
        bookId: actualBookId,
        revision: ledger.revision,
        projection: parsedRequest.data.projection,
        at: parsedRequest.data.at ?? null,
        offset,
        matchedFactCount: matchedFacts.length,
        returnedFactCount: facts.length,
        hasMore: offset + facts.length < matchedFacts.length,
        nextOffset: offset + facts.length < matchedFacts.length ? offset + facts.length : null,
        facts,
        ...(parsedRequest.data.includeCommits === true
          ? { commits: ledger.commits.slice(-Math.min(limit, 200)) }
          : {}),
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_story_facts_commit") {
      const parsedRequest = StoryFactsCommitRequestSchema.safeParse({
        ...body.args,
        bookId: requestedBookId,
      });
      if (!parsedRequest.success) {
        throw new AppError("Invalid story facts commit request", {
          status: 400,
          code: "story_facts_commit_invalid",
          details: { issues: parsedRequest.error.issues },
        });
      }
      const bookDir = effectiveBookDirName
        ? path.join(buildProjectBooksRoot(projectId, projectOwnerUserId), effectiveBookDirName)
        : "";
      const idx = bookDir ? await readBookIndexSafe(path.join(bookDir, "index.json")) : null;
      if (!idx) {
        throw new AppError("Book not found", { status: 404, code: "book_not_found" });
      }
      const actualBookId = readTrimmedString(idx.bookId);
      const source = await resolveVerifiedStoryFactSource({
        c: c as never,
        requestUserId,
        projectOwnerId: projectOwnerUserId,
        projectId,
        bookId: actualBookId,
        bookDir,
        selector: parsedRequest.data.source,
      });
      let committed: Awaited<ReturnType<typeof commitStoryFacts>>;
      try {
        committed = await commitStoryFacts({
          filePath: path.join(bookDir, "story-facts.json"),
          projectId,
          bookId: actualBookId,
          actorId: requestUserId,
          commitId: parsedRequest.data.commitId,
          expectedRevision: parsedRequest.data.expectedRevision,
          source,
          operations: parsedRequest.data.operations,
          ...(parsedRequest.data.note ? { note: parsedRequest.data.note } : {}),
        });
      } catch (error) {
        if (error instanceof StoryFactsStoreError) throw mapStoryFactsStoreError(error);
        throw error;
      }

      let projection:
        | { status: "updated" }
        | { status: "failed"; reason: string } = { status: "updated" };
      try {
        await getUserProjectWorkspaceContext(c as never, requestUserId, {
          projectId,
          bookId: actualBookId,
          ...(typeof source.chapter === "number" ? { chapter: source.chapter } : {}),
          refresh: true,
        });
      } catch (error) {
        projection = {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
        console.error("[story-facts] STORY_STATE projection refresh failed after ledger commit", {
          projectId,
          bookId: actualBookId,
          commitId: parsedRequest.data.commitId,
          ledgerRevision: committed.result.ledgerRevision,
          reason: projection.reason,
        });
      }
      const response = {
        projectId,
        bookId: actualBookId,
        revision: committed.result.ledgerRevision,
        commitRevision: committed.result.commitRevision,
        idempotent: committed.result.idempotent,
        factCount: committed.ledger.facts.length,
        activeFactCount: committed.ledger.facts.filter((fact) => fact.validUntil === null).length,
        addedFactIds: committed.result.addedFactIds,
        closedFactIds: committed.result.closedFactIds,
        statusChangedFactIds: committed.result.statusChangedFactIds,
        disclosureChangedFactIds: committed.result.disclosureChangedFactIds,
        source,
        projection,
        partialSuccess: projection.status === "failed",
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_book_style_confirm") {
      const referenceNodeIds = Array.isArray(body.args.referenceImageNodeIds)
        ? body.args.referenceImageNodeIds
        : [];
      const referenceAssetIds = Array.isArray(body.args.referenceAssetIds)
        ? body.args.referenceAssetIds
        : [];
      const resolvedStyleReferences =
        referenceNodeIds.length > 0 || referenceAssetIds.length > 0
          ? await resolveExecutionImageReferences({
              c: c as never,
              ownerId: projectOwnerUserId,
              row: await loadImageReferenceFlowRow(),
              nodeIds: referenceNodeIds,
              assetIds: referenceAssetIds,
            })
          : [];
      const styleRequestArgs = { ...body.args };
      delete styleRequestArgs.referenceImageNodeIds;
      delete styleRequestArgs.referenceAssetIds;
      const indexPath = effectiveBookDirName
        ? buildBookIndexPath(projectId, projectOwnerUserId, effectiveBookDirName)
        : "";
      const nowIso = new Date().toISOString();
      let updated: Awaited<ReturnType<typeof updateBookIndexForTool<unknown>>>;
      try {
        updated = await updateBookIndexForTool(indexPath, (current) => {
          const assets =
            current.assets && typeof current.assets === "object" && !Array.isArray(current.assets)
              ? { ...(current.assets as Record<string, unknown>) }
              : {};
          const styleBible = confirmBookStyleBible({
            previous: assets.styleBible,
            request: {
              ...styleRequestArgs,
              ...(resolvedStyleReferences.length > 0
                ? {
                    referenceImages: resolvedStyleReferences.map(
                      (reference) => reference.url,
                    ),
                  }
                : {}),
              confirmed: typeof body.args.confirmed === "boolean" ? body.args.confirmed : true,
            },
            userId: projectOwnerUserId,
            nowIso,
          });
          assets.styleBible = styleBible;
          return {
            next: { ...current, assets, updatedAt: nowIso },
            result: styleBible,
          };
        });
      } catch (error) {
        if (error instanceof BookStyleBibleNotReadyError) {
          throw new AppError(error.message, { status: 409, code: error.code });
        }
        throw new AppError(error instanceof Error ? error.message : String(error), {
          status: 400,
          code: "book_style_bible_invalid",
        });
      }
      const response = {
        ok: true,
        bookId: readTrimmedString(updated.index.bookId) || requestedBookId,
        styleBible: removeHttpImageUrlsDeep(updated.result),
        styleReferenceCount: Array.isArray(
          (updated.result as { referenceImages?: unknown }).referenceImages,
        )
          ? (updated.result as { referenceImages: unknown[] }).referenceImages.length
          : 0,
        references: resolvedStyleReferences.map(describeExecutionImageReference),
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_book_chapter_get") {
      const rawContentMode = body.args.contentMode;
      const requestedContentMode = readTrimmedString(rawContentMode);
      const contentMode = rawContentMode === undefined ? "task_context" : requestedContentMode;
      if (contentMode !== "task_context" && contentMode !== "full") {
        throw new AppError("contentMode must be task_context or full", {
          status: 400,
          code: "chapter_content_mode_invalid",
        });
      }
      // 兼容 chapterId：小T 习惯传 chapterId(全系统通用的章节字符串 id)而非 chapter 序号；
      // 当请求级 scope 与 args.chapter 都缺时，从 args.chapterId 尾部 `-ch<N>` 解析序号（用既有解析器）。
      const chapter =
        scopedChapter ||
        readScopedChapterNumber(body.args.chapter) ||
        parseChapterSequenceFromChapterId(body.args.chapterId);
      if (!chapter) {
        throw new AppError("chapter is required", {
          status: 400,
          code: "chapter_required",
        });
      }
      const indexPath = effectiveBookDirName
        ? buildBookIndexPath(projectId, projectOwnerUserId, effectiveBookDirName)
        : "";
      const idx = await readBookIndexSafe(indexPath);
      if (!idx) {
        throw new AppError("Book not found", {
          status: 404,
          code: "book_not_found",
        });
      }
      const chapters = Array.isArray(idx.chapters) ? idx.chapters : [];
      const target = chapters.find((item) => Number((item as { chapter?: unknown }).chapter) === chapter);
      if (!target || typeof target !== "object" || Array.isArray(target)) {
        throw new AppError("Chapter not found", {
          status: 404,
          code: "chapter_not_found",
        });
      }
      const targetRecord = target as Record<string, unknown>;
      // canvas-driven book: 章节内容在独立 JSON 文件中
      const contentFile = readTrimmedString(targetRecord.contentFile);
      let chapterContent = "";
      if (contentFile) {
        const chapterFilePath = path.join(
          buildProjectBooksRoot(projectId, projectOwnerUserId),
          effectiveBookDirName,
          contentFile,
        );
        try {
          const raw = await fs.readFile(chapterFilePath, "utf8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          chapterContent = readTrimmedString(parsed.content);
        } catch {
          // 文件不存在时返回空内容，不报错
        }
      } else {
        // 上传书籍：从 raw.md 按 offset 切片
        const rawPath = path.join(
          buildProjectBooksRoot(projectId, projectOwnerUserId),
          effectiveBookDirName,
          "raw.md",
        );
        const raw = await fs.readFile(rawPath, "utf8").catch(() => "");
        if (!raw) {
          throw new AppError("Book raw content not found", {
            status: 404,
            code: "book_raw_not_found",
          });
        }
        const startOffset = Math.max(0, Number(targetRecord.startOffset || 0) || 0);
        const endOffset = Math.min(raw.length, Number(targetRecord.endOffset || raw.length) || raw.length);
        chapterContent = raw.slice(startOffset, Math.max(startOffset, endOffset)).trim();
      }
      // 书名 + 前后章定位：章节正文里书内道具/游戏名（如卡牌上的「女娲游戏」）长得像作品名，
      // 不带真书名时模型会拿它当标题印上封面（ch5 实测）。同时带前后章标题/摘要，承接与预告不用瞎猜。
      const findChapterMeta = (seq: number): Record<string, unknown> | null => {
        const found = chapters.find((item) => Number((item as { chapter?: unknown }).chapter) === seq);
        return found && typeof found === "object" && !Array.isArray(found)
          ? (found as Record<string, unknown>)
          : null;
      };
      const prevMeta = findChapterMeta(chapter - 1);
      const nextMeta = findChapterMeta(chapter + 1);
      const response = {
        bookId: readTrimmedString(idx.bookId) || requestedBookId,
        bookTitle: readTrimmedString(idx.title) || null,
        chapterCount: Number(idx.chapterCount || 0) || chapters.length,
        projectId,
        chapter,
        title: readTrimmedString(targetRecord.title) || `第${chapter}章`,
        prevChapter: prevMeta
          ? {
              chapter: chapter - 1,
              title: readTrimmedString(prevMeta.title) || `第${chapter - 1}章`,
              summary: readTrimmedString(prevMeta.summary) || null,
            }
          : null,
        nextChapter: nextMeta
          ? {
              chapter: chapter + 1,
              title: readTrimmedString(nextMeta.title) || `第${chapter + 1}章`,
            }
          : null,
        // task_context limits which chapter is loaded, not how much of that
        // chapter is visible. Once the chapter is selected, preserve the full
        // source text so agents never have to rediscover facts lost to a
        // preview boundary. `full` remains an explicit caller declaration, but
        // both modes are lossless by design.
        content: chapterContent,
        contentMode,
        contentChars: chapterContent.length,
        contentTruncated: false,
        startLine: Number(targetRecord.startLine || 0) || 0,
        endLine: Number(targetRecord.endLine || 0) || 0,
        summary: readTrimmedString(targetRecord.summary) || null,
        keywords: normalizeKeywordList(targetRecord.keywords),
        coreConflict: readTrimmedString(targetRecord.coreConflict) || null,
        characters: normalizeEntityItems(targetRecord.characters, 20),
        props: normalizeEntityItems(targetRecord.props, 20),
        scenes: normalizeEntityItems(targetRecord.scenes, 20),
        locations: normalizeEntityItems(targetRecord.locations, 20),
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    // 【章节摘要沉淀·2026-07-10 用户拍板「提前一次性做好」】成片收尾写一次 ~200 字摘要进 index.json
    // 章条目（book_chapter_get 的 prevChapter.summary 即读此处，此前恒 null → 每章只能重读前章全文），
    // 带 chapterId 时同步 chapters 表 summary 列。
    if (body.toolName === "tapcanvas_book_chapter_summary_set") {
      const chapter =
        scopedChapter ||
        readScopedChapterNumber(body.args.chapter) ||
        parseChapterSequenceFromChapterId(body.args.chapterId);
      if (!chapter) {
        throw new AppError("chapter is required", { status: 400, code: "chapter_required" });
      }
      const summary = readTrimmedString(body.args.summary).slice(0, 800);
      if (!summary) {
        throw new AppError("summary is required", { status: 400, code: "summary_required" });
      }
      const indexPath = effectiveBookDirName
        ? buildBookIndexPath(projectId, projectOwnerUserId, effectiveBookDirName)
        : "";
      await updateBookIndexForTool(indexPath, (current) => {
        const chapters = Array.isArray(current.chapters)
          ? current.chapters.map((item) =>
              item && typeof item === "object" && !Array.isArray(item)
                ? { ...(item as Record<string, unknown>) }
                : item,
            )
          : [];
        const target = chapters.find(
          (item) => Number((item as { chapter?: unknown } | null)?.chapter) === chapter,
        );
        if (!target || typeof target !== "object" || Array.isArray(target)) {
          throw new AppError("Chapter not found", { status: 404, code: "chapter_not_found" });
        }
        (target as Record<string, unknown>).summary = summary;
        return {
          next: { ...current, chapters, updatedAt: new Date().toISOString() },
          result: null,
        };
      });
      // best-effort 同步 chapters 表（前端章节列表/其他读者同源可见）。
      const chapterRowId = readTrimmedString(body.args.chapterId);
      if (chapterRowId) {
        try {
          await c.env.DB.chapters.updateMany({
            where: { id: chapterRowId },
            data: { summary, updated_at: new Date().toISOString() },
          });
        } catch {
          // 表同步失败不阻断（index.json 已是 prevChapter.summary 的真相源）
        }
      }
      const response = { ok: true, chapter, summaryChars: summary.length };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    // 【世界书定稿·2026-07-14 用户拍板】四件套齐备且用户在对话中确认后调用，落 index.json 顶层
    // worldBible:{status:"confirmed"}——各生产触点的软提醒随之消失；后续章节增量更新节点免重复定稿。
    // 缺件拒绝＝防"没做完就自称定稿"（对 agent 的真实性校验，不是对用户的闸）。
    if (body.toolName === "tapcanvas_book_worldbible_confirm") {
      const indexPath = effectiveBookDirName
        ? buildBookIndexPath(projectId, projectOwnerUserId, effectiveBookDirName)
        : "";
      const readiness = await collectBookBibleReadiness(c.env.DB, projectId);
      if (readiness.missing.length) {
        const response = {
          ok: false,
          code: "bible_pieces_missing",
          missing: readiness.missing,
          present: readiness.present,
			message: `世界书四件套不齐，缺：${readiness.missing.join("、")}——先落成非空画布 text 节点，并设置精确 data.bookBibleType（world/roster/redlines/ip_safe），再重新定稿。`,
        };
        return c.json({ ok: true, content: JSON.stringify(response), data: response });
      }
      const confirmedAt = new Date().toISOString();
      const worldBible = { status: "confirmed", confirmedAt };
      await updateBookIndexForTool(indexPath, (current) => ({
        next: { ...current, worldBible, updatedAt: confirmedAt },
        result: null,
      }));
      const response = {
        ok: true,
        worldBible,
        message: "世界书已定稿。后续章节按「沿用+增量」更新四件套节点即可，无需重复定稿。",
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_book_storyboard_plan_get") {
      const indexPath = effectiveBookDirName
        ? buildBookIndexPath(projectId, projectOwnerUserId, effectiveBookDirName)
        : "";
      const idx = await readBookIndexSafe(indexPath);
      if (!idx) {
        throw new AppError("Book not found", {
          status: 404,
          code: "book_not_found",
        });
      }
      const chapter = scopedChapter || readScopedChapterNumber(body.args.chapter) || null;
      if (!chapter) {
        throw new AppError("chapter is required", {
          status: 400,
          code: "chapter_required",
        });
      }
      const assets =
        idx.assets && typeof idx.assets === "object" && !Array.isArray(idx.assets)
          ? { ...(idx.assets as Record<string, unknown>) }
          : {};
      const plans = normalizeStoryboardPlans(assets.storyboardPlans);
      const { matchedPlan, chapterPlans } = selectStoryboardPlanReadResult({
        plans,
        chapter,
        taskId: readTrimmedString(body.args.taskId) || undefined,
        planId: readTrimmedString(body.args.planId) || undefined,
      });
      const chapterPlanSummaries = chapterPlans.map((plan) => ({
        planId: plan.planId,
        taskId: plan.taskId,
        chapter: Number(plan.chapter || chapter),
        taskTitle: plan.taskTitle || null,
        mode: plan.mode,
        groupSize: plan.groupSize,
        shotCount: plan.shotPrompts.length,
        updatedAt: plan.updatedAt,
      }));
      const response = {
        bookId: readTrimmedString(idx.bookId) || requestedBookId || effectiveBookDirName,
        chapter,
        hasPlan: Boolean(matchedPlan),
        chapterPlanCount: chapterPlans.length,
        chapterPlanSummaries,
        matchedPlan,
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_book_storyboard_plan_upsert") {
      const indexPath = effectiveBookDirName
        ? buildBookIndexPath(projectId, projectOwnerUserId, effectiveBookDirName)
        : "";
      const taskId = readTrimmedString(body.args.taskId) || `agents-${Date.now().toString(36)}`;
      const requestedChapter = readScopedChapterNumber(body.args.chapter) || null;
      if (scopedChapter && requestedChapter && scopedChapter !== requestedChapter) {
        throw new AppError("chapter 与当前授权章节作用域不一致", {
          status: 409,
          code: "storyboard_persistence_scope_mismatch",
          details: { scopedChapter, requestedChapter },
        });
      }
      const chapter = scopedChapter || requestedChapter;
      if (!chapter || !requestedBookId) {
        throw new AppError("bookId and chapter are required", {
          status: 400,
          code: "storyboard_persistence_scope_required",
        });
      }
      const requestedBookArg = readTrimmedString(body.args.bookId);
      if (scopedBookId && requestedBookArg && scopedBookId !== requestedBookArg) {
        throw new AppError("bookId 与当前授权书籍作用域不一致", {
          status: 409,
          code: "storyboard_persistence_scope_mismatch",
          details: { scopedBookId, requestedBookId: requestedBookArg },
        });
      }
      const taskTitle = readTrimmedString(body.args.taskTitle);
      const mode = readTrimmedString(body.args.mode).toLowerCase() === "full" ? "full" : "single";
      const groupSize = normalizeStoryboardGroupSize(body.args.groupSize);
      const persistencePayload = requireStoryboardV12ArtifactPayload({
        storyboardStructured: body.args.storyboardStructured,
        shotPrompts: body.args.shotPrompts,
        maxShotPrompts: 1_200,
        contextLabel: "storyboard plan upsert",
      });
      const shotPrompts = persistencePayload.shotPrompts;
      const storyboardContent = JSON.stringify(persistencePayload.artifact, null, 2);
      const outputAssetId = readTrimmedString(body.args.outputAssetId);
      const runId = readTrimmedString(body.args.runId);
      const overwriteMode = readTrimmedString(body.args.overwriteMode).toLowerCase() === "replace" ? "replace" : "merge";
      const resetChapterChunks = body.args.resetChapterChunks === true;
      const nextChunkSource =
        body.args.nextChunkIndexByGroup && typeof body.args.nextChunkIndexByGroup === "object" && !Array.isArray(body.args.nextChunkIndexByGroup)
          ? body.args.nextChunkIndexByGroup as Record<string, unknown>
          : {};
      const nextChunkIndexByGroup = {
        ...(Number.isFinite(Number(nextChunkSource["1"])) && Number(nextChunkSource["1"]) >= 0 ? { "1": Math.trunc(Number(nextChunkSource["1"])) } : null),
        ...(Number.isFinite(Number(nextChunkSource["4"])) && Number(nextChunkSource["4"]) >= 0 ? { "4": Math.trunc(Number(nextChunkSource["4"])) } : null),
        ...(Number.isFinite(Number(nextChunkSource["9"])) && Number(nextChunkSource["9"]) >= 0 ? { "9": Math.trunc(Number(nextChunkSource["9"])) } : null),
        ...(Number.isFinite(Number(nextChunkSource["25"])) && Number(nextChunkSource["25"]) >= 0 ? { "25": Math.trunc(Number(nextChunkSource["25"])) } : null),
      };
      const planIdInput = readTrimmedString(body.args.planId);
      const nowIso = new Date().toISOString();
      const updated = await updateBookIndexForTool(indexPath, (current) => {
        const assets =
          current.assets && typeof current.assets === "object" && !Array.isArray(current.assets)
            ? { ...(current.assets as Record<string, unknown>) }
            : {};
        const plans = normalizeStoryboardPlans(assets.storyboardPlans);
        const newestTaskPlan = plans
          .filter((plan) => plan.taskId === taskId)
          .sort((left, right) => {
            const updatedSort = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
            if (updatedSort !== 0) return updatedSort;
            return String(right.planId || "").localeCompare(String(left.planId || ""));
          })[0];
        const planId = planIdInput || newestTaskPlan?.planId || `plan-${taskId}-${Date.now().toString(36)}`;
        const existingIndex = plans.findIndex((item) => item.planId === planId);
        const existing = existingIndex >= 0 ? plans[existingIndex] : null;
        const latestPersistencePayload = requireStoryboardV12ArtifactPayload({
          storyboardStructured: body.args.storyboardStructured,
          shotPrompts: body.args.shotPrompts,
          maxShotPrompts: 1_200,
          contextLabel: "storyboard plan upsert",
        });
        const nextPlan: StoryboardPlanRecord = overwriteMode === "replace"
          ? {
              planId,
              taskId,
              ...(chapter ? { chapter } : null),
              ...(taskTitle ? { taskTitle } : null),
              mode,
              groupSize,
              ...(outputAssetId ? { outputAssetId } : null),
              ...(runId ? { runId } : null),
              ...(storyboardContent ? { storyboardContent } : null),
              storyboardArtifact: latestPersistencePayload.artifact,
              artifactSha256: latestPersistencePayload.artifactSha256,
              storyboardStructured: latestPersistencePayload.structured,
              shotPrompts: latestPersistencePayload.shotPrompts,
              ...(Object.keys(nextChunkIndexByGroup).length ? { nextChunkIndexByGroup } : null),
              createdAt: existing?.createdAt || nowIso,
              updatedAt: nowIso,
              createdBy: existing?.createdBy || projectOwnerUserId,
              updatedBy: projectOwnerUserId,
            }
          : {
              planId,
              taskId,
              ...(chapter ? { chapter } : existing?.chapter ? { chapter: existing.chapter } : null),
              ...(taskTitle ? { taskTitle } : existing?.taskTitle ? { taskTitle: existing.taskTitle } : null),
              mode,
              groupSize,
              ...(outputAssetId ? { outputAssetId } : existing?.outputAssetId ? { outputAssetId: existing.outputAssetId } : null),
              ...(runId ? { runId } : existing?.runId ? { runId: existing.runId } : null),
              ...(storyboardContent ? { storyboardContent } : existing?.storyboardContent ? { storyboardContent: existing.storyboardContent } : null),
              storyboardArtifact: latestPersistencePayload.artifact,
              artifactSha256: latestPersistencePayload.artifactSha256,
              storyboardStructured: latestPersistencePayload.structured,
              shotPrompts: latestPersistencePayload.shotPrompts,
              ...(Object.keys(nextChunkIndexByGroup).length
                ? { nextChunkIndexByGroup }
                : existing?.nextChunkIndexByGroup
                  ? { nextChunkIndexByGroup: existing.nextChunkIndexByGroup }
                  : null),
              createdAt: existing?.createdAt || nowIso,
              updatedAt: nowIso,
              createdBy: existing?.createdBy || projectOwnerUserId,
              updatedBy: projectOwnerUserId,
            };
        const mergedPlans = overwriteMode === "replace"
          ? plans.filter((item) => item.planId !== planId)
          : [...plans];
        if (overwriteMode === "merge" && existingIndex >= 0) {
          mergedPlans[existingIndex] = nextPlan;
        } else {
          mergedPlans.push(nextPlan);
        }
        const storyboardPlans = mergedPlans
          .sort((left, right) => String(left.taskId || "").localeCompare(String(right.taskId || "")))
          .slice(-200);
        assets.storyboardPlans = storyboardPlans;
        if (overwriteMode === "replace" && resetChapterChunks) {
          const chunks = Array.isArray(assets.storyboardChunks) ? assets.storyboardChunks : [];
          assets.storyboardChunks = chunks.filter((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            return readTrimmedString((item as Record<string, unknown>).taskId) !== taskId;
          });
        }
        return {
          next: { ...current, assets, updatedAt: nowIso },
          result: { planId, storyboardPlans },
        };
      });
      const { planId, storyboardPlans } = updated.result;
      return c.json({
        ok: true,
        content: JSON.stringify({
          planId,
          taskId,
          chapter,
          shotCount: shotPrompts.length,
        }),
        data: {
          planId,
          taskId,
          chapter,
          shotCount: shotPrompts.length,
          storyboardPlans,
        },
      });
    }

    if (body.toolName === "tapcanvas_storyboard_source_bundle_get") {
      const chapter = scopedChapter || readScopedChapterNumber(body.args.chapter) || undefined;
      const bundle = await getStoryboardSourceBundle({
        c: c as never,
        ownerId: projectOwnerUserId,
        projectId,
        flowId,
        bookId: requestedBookId,
        ...(typeof chapter === "number" ? { chapter } : {}),
        ...(body.args.refresh === true ? { refresh: true } : {}),
      });
      return c.json({
        ok: true,
        content: JSON.stringify(bundle),
        data: bundle as unknown as Record<string, unknown>,
      });
    }

    if (body.toolName === "tapcanvas_node_context_bundle_get") {
      const nodeId = readTrimmedString(body.args.nodeId) || requestNodeId;
      if (!nodeId) {
        throw new AppError("Node id required", {
          status: 400,
          code: "node_id_required",
        });
      }
      const scopedFlowRow = chapterCanvasId
        ? await loadChapterCanvasAsFlowRow(c as never, requestUserId, chapterCanvasId, projectId)
        : undefined;
      if (chapterCanvasId && !scopedFlowRow) {
        throw new AppError("Flow not found", {
          status: 404,
          code: "flow_not_found",
        });
      }
      const bundle = await getNodeContextBundle({
        c: c as never,
        ownerId: projectOwnerUserId,
        projectId,
        flowId: chapterCanvasId || flowId,
        nodeId,
        ...(scopedFlowRow ? { flowRow: scopedFlowRow } : {}),
      });
      return c.json({
        ok: true,
        content: JSON.stringify(bundle),
        data: bundle as unknown as Record<string, unknown>,
      });
    }

    if (body.toolName === "tapcanvas_video_review_bundle_get") {
      const nodeId = readTrimmedString(body.args.nodeId) || requestNodeId;
      if (!nodeId) {
        throw new AppError("Node id required", {
          status: 400,
          code: "node_id_required",
        });
      }
      const scopedFlowRow = chapterCanvasId
        ? await loadChapterCanvasAsFlowRow(c as never, requestUserId, chapterCanvasId, projectId)
        : undefined;
      if (chapterCanvasId && !scopedFlowRow) {
        throw new AppError("Flow not found", {
          status: 404,
          code: "flow_not_found",
        });
      }
      const bundle = await getVideoReviewBundle({
        c: c as never,
        ownerId: projectOwnerUserId,
        projectId,
        flowId: chapterCanvasId || flowId,
        nodeId,
        ...(scopedFlowRow ? { flowRow: scopedFlowRow } : {}),
      });
      return c.json({
        ok: true,
        content: JSON.stringify(bundle),
        data: bundle as unknown as Record<string, unknown>,
      });
    }

    if (body.toolName === "tapcanvas_storyboard_continuity_get") {
      const chapter = scopedChapter || readScopedChapterNumber(body.args.chapter);
      const taskId = readTrimmedString(body.args.taskId);
      const previousChunkId = readTrimmedString(body.args.previousChunkId);
      const groupSizeRaw = Number(body.args.groupSize || 0);
      const chunkIndexRaw = Number(body.args.chunkIndex || 0);
      const allowedGroupSizes = new Set([1, 4, 9, 25]);
      const groupSize = allowedGroupSizes.has(groupSizeRaw) ? (groupSizeRaw as 1 | 4 | 9 | 25) : 0;
      const chunkIndex =
        Number.isFinite(chunkIndexRaw) && chunkIndexRaw >= 0 ? Math.trunc(chunkIndexRaw) : -1;
      if (!chapter) {
        throw new AppError("chapter is required", {
          status: 400,
          code: "chapter_required",
        });
      }
      if (!taskId) {
        throw new AppError("taskId is required", {
          status: 400,
          code: "storyboard_task_id_required",
        });
      }
      if (!groupSize) {
        throw new AppError("groupSize must be one of 1, 4, 9, 25", {
          status: 400,
          code: "invalid_group_size",
        });
      }
      if (chunkIndex < 0) {
        throw new AppError("chunkIndex is required", {
          status: 400,
          code: "chunk_index_required",
        });
      }
      if (chunkIndex > 0 && !previousChunkId) {
        throw new AppError("previousChunkId is required when chunkIndex > 0", {
          status: 400,
          code: "storyboard_previous_chunk_id_required",
        });
      }
      const requiredRoleNames = Array.isArray(body.args.requiredRoleNames)
        ? body.args.requiredRoleNames.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const evidence = await getStoryboardContinuityEvidence(
        {
          projectId,
          bookId: requestedBookId,
          taskId,
          chapter,
          groupSize,
          chunkIndex,
          ...(previousChunkId ? { previousChunkId } : {}),
          ...(requiredRoleNames.length ? { requiredRoleNames } : {}),
          ...(readTrimmedString(body.args.scenePropRefId)
            ? { scenePropRefId: readTrimmedString(body.args.scenePropRefId) }
            : {}),
          ...(readTrimmedString(body.args.spellFxRefId)
            ? { spellFxRefId: readTrimmedString(body.args.spellFxRefId) }
            : {}),
        },
        projectOwnerUserId,
      );
      return c.json({ ok: true, content: JSON.stringify(evidence), data: evidence as Record<string, unknown> });
    }

    // 跨项目/项目级素材库列举（角色卡/场景卡）。正向锚定读卡入口：补齐此前
    // 声明缺失的「死工具」，让 anchor-gate 报错文案与 readMaterialAssets 标志不再指向空挡。
    // 纯读，按 kind 过滤、默认锁当前项目（projectId 非空时），不需要 flow。
    if (body.toolName === "tapcanvas_material_assets_list") {
      const kindRaw = readTrimmedString(body.args.kind).toLowerCase();
      const kind =
        kindRaw === "character" ||
        kindRaw === "scene" ||
        kindRaw === "prop" ||
        kindRaw === "style" ||
        kindRaw === "text" ||
        kindRaw === "ensemble" ||
        kindRaw === "pose" ||
        kindRaw === "voice"
          ? (kindRaw as "character" | "scene" | "prop" | "style" | "text" | "ensemble" | "pose" | "voice")
          : undefined;
      // 【项目隔离硬规则·用户定】素材复用只在项目内（跨章可、跨项目禁）。
      // 旧的 scope=owner/all 跨项目逃生门已封：忽略该参数，强制 project 级，
      // 杜绝别的项目的角色卡/场景卡（含不同画风）被本项目按名捞进来导致画风不统一。
      void readTrimmedString(body.args.scope);
      // All filters are exact structural provenance/state fields except the explicitly requested nameContains search.
      const nameExact = readTrimmedString(body.args.name);
      const nameContains = readTrimmedString(body.args.nameContains);
      const nodeId = readTrimmedString(body.args.nodeId);
      const sourceChapterId = readTrimmedString(body.args.sourceChapterId);
      const stateKey = readTrimmedString(body.args.stateKey);
      const includeDrafts = body.args.includeDrafts === true;
      const visualKinds = new Set(["character", "scene", "prop", "style", "ensemble", "pose"]);
      const items = await listProjectNodeAssetsForOwner(c as never, projectOwnerUserId, {
        projectId,
        ...(kind ? { kind } : {}),
      });
      // The service returns updatedAt DESC. Filters preserve that order, so the first exact identity/state match is newest.
      let scoped = items.filter((item) => {
        const data = item.latestVersion?.data;
        const hasImage = Boolean(readTrimmedString(data?.imageUrl));
        // A visual project node without a real image URL is a draft/text
        // description, not a reusable production asset. Keep it available only
        // when callers explicitly ask for metadata inspection.
        if (!includeDrafts && visualKinds.has(item.kind) && !hasImage) return false;
        if (nodeId && item.origin?.nodeId !== nodeId) return false;
        if (sourceChapterId && (item.origin?.ownerType !== "chapter" || item.origin.ownerId !== sourceChapterId)) return false;
        if (stateKey && readTrimmedString(data?.stateKey) !== stateKey) return false;
        return true;
      });
      if (nameExact) {
        scoped = scoped.filter((item) => String(item.name ?? "").trim() === nameExact);
      } else if (nameContains) {
        scoped = scoped.filter((item) => String(item.name ?? "").includes(nameContains));
      }
      const requestedLimit = Number(body.args.limit);
      const requestedOffset = Number(body.args.offset);
      const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(100, requestedLimit)
        : 40;
      const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0
        ? requestedOffset
        : 0;
      const totalCount = scoped.length;
      const page = scoped.slice(offset, offset + limit);
      const slim = page.map((item) => {
        const data =
          item.latestVersion && typeof item.latestVersion.data === "object"
            ? (item.latestVersion.data as Record<string, unknown>)
            : {};
        const hasImage = Boolean(readTrimmedString(data.imageUrl));
        return {
          id: item.id,
          kind: item.kind,
          name: item.name,
          latestVersionId: readTrimmedString(item.latestVersion?.id) || null,
          // Project-node assets are cross-canvas identities. Returning the source nodeId here
          // makes downstream resolvers mistake it for a node on the current chapter canvas.
          // Keep the opaque project-scoped asset id; the paid boundary fresh-reads its origin.
          referenceAssetIds: hasImage ? [item.id] : [],
          nodeId: item.origin?.nodeId ?? null,
          ownerType: item.origin?.ownerType ?? null,
          ownerId: item.origin?.ownerId ?? null,
          ownerLabel: item.origin?.ownerLabel ?? null,
          flowId: item.origin?.flowId ?? null,
          hasImage,
          hasVideo: Boolean(readTrimmedString(data.videoUrl)),
          hasAudio: Boolean(readTrimmedString(data.audioUrl)),
          isTextNode: !readTrimmedString(data.imageUrl) && !readTrimmedString(data.videoUrl) && !readTrimmedString(data.audioUrl),
          hasThreeViewImage: Boolean(readTrimmedString(data.threeViewImageUrl)),
          stateDescription: readTrimmedString(data.stateDescription) || null,
          stateKey: readTrimmedString(data.stateKey) || null,
          currentVersion: item.currentVersion,
          updatedAt: item.updatedAt,
          sourceChapterId: readTrimmedString(data.sourceChapterId) || null,
        };
      });
      const response = {
        items: slim,
        count: slim.length,
        totalCount,
        offset,
        limit,
        hasMore: offset + slim.length < totalCount,
        nextOffset: offset + slim.length < totalCount ? offset + slim.length : null,
        scope: "project" as const,
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    // 版本历史：回基态取锚用（角色伤愈/换回常服时，latest 已是状态卡，
    // 从历史版本取基础版 imageUrl 作身份锚）。按 assetId 直查，或 kind+name 先解析
    // 资产（project 级优先、owner 级回退，与跨章复用判定协议对称）。
    if (body.toolName === "tapcanvas_material_asset_versions_get") {
      const assetIdArg = readTrimmedString(body.args.assetId);
      const kindRaw2 = readTrimmedString(body.args.kind).toLowerCase();
      const kind2 =
        kindRaw2 === "character" ||
        kindRaw2 === "scene" ||
        kindRaw2 === "prop" ||
        kindRaw2 === "style" ||
        kindRaw2 === "text" ||
        kindRaw2 === "ensemble" ||
        kindRaw2 === "pose" ||
        kindRaw2 === "voice"
          ? (kindRaw2 as "character" | "scene" | "prop" | "style" | "text" | "ensemble" | "pose" | "voice")
          : undefined;
      const nameArg = readTrimmedString(body.args.name);
      let assetId = assetIdArg;
      if (!assetId && nameArg) {
        const findByName = (
          assets: Awaited<ReturnType<typeof listMaterialAssetsForOwner>>,
        ) => assets.find((a) => String(a.name ?? "").trim() === nameArg)?.id ?? "";
        const projectAssets = await listMaterialAssetsForOwner(c as never, projectOwnerUserId, {
          projectId,
          ...(kind2 ? { kind: kind2 } : {}),
        });
        assetId = findByName(projectAssets);
        // 【项目隔离硬规则】不再 owner 级跨项目回退——只在本项目内按名解析资产。
      }
      if (!assetId) {
        throw new AppError(
          nameArg
            ? `本项目设定库中没有名为「${nameArg}」的资产（项目隔离：不跨项目检索）`
            : "需要 assetId 或 name（可选 kind 缩小范围）",
          { status: 400, code: "material_asset_not_resolved" },
        );
      }
      const limitRaw = Number(body.args.limit || 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 20;
      const versions = await listMaterialVersionsForOwner(c as never, projectOwnerUserId, {
        assetId,
        limit,
      });
      const slimVersions = versions.map((v) => {
        const data = typeof v.data === "object" && v.data ? (v.data as Record<string, unknown>) : {};
        return {
          versionId: v.id,
          version: v.version,
          referenceAssetIds: [v.id],
          hasImage: Boolean(readTrimmedString(data.imageUrl)),
          hasThreeViewImage: Boolean(readTrimmedString(data.threeViewImageUrl)),
          stateDescription: readTrimmedString(data.stateDescription) || null,
          stateKey: readTrimmedString(data.stateKey) || null,
          sourceChapterId: readTrimmedString(data.sourceChapterId) || null,
          note: v.note ?? null,
          createdAt: v.createdAt,
        };
      });
      const response = { assetId, versions: slimVersions, count: slimVersions.length };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_material_asset_version_create") {
      const assetId = readTrimmedString(body.args.assetId);
      const expectedName = readTrimmedString(body.args.expectedName);
      const stateKey = readTrimmedString(body.args.stateKey);
      const stateDescription = readTrimmedString(body.args.stateDescription);
      const sourceNodeId = readTrimmedString(body.args.sourceNodeId);
      if (!assetId || !expectedName || !sourceNodeId) {
        throw new AppError(
          "追加素材版本需要 assetId、expectedName 与 sourceNodeId",
          {
            status: 400,
            code: "material_asset_version_create_confirmation_required",
          },
        );
      }
      if (Boolean(stateKey) !== Boolean(stateDescription)) {
        throw new AppError("stateKey 与 stateDescription 必须同时提供或同时省略", {
          status: 400,
          code: "material_asset_version_state_incomplete",
        });
      }
      const projectAssets = await listMaterialAssetsForOwner(
        c as never,
        projectOwnerUserId,
        { projectId },
      );
      const target = projectAssets.find((asset) => asset.id === assetId);
      if (!target) {
        throw new AppError("目标素材不属于当前项目", {
          status: 404,
          code: "material_asset_not_found_in_project",
        });
      }
      if (readTrimmedString(target.name) !== expectedName) {
        throw new AppError("expectedName 与目标素材真实名称不一致", {
          status: 409,
          code: "material_asset_version_name_mismatch",
          details: {
            assetId,
            expectedName,
            actualName: readTrimmedString(target.name),
          },
        });
      }
      const [sourceReference] = await resolveExecutionImageReferences({
        c: c as never,
        ownerId: projectOwnerUserId,
        row: await loadImageReferenceFlowRow(),
        nodeIds: [sourceNodeId],
      });
      if (!sourceReference) {
        throw new AppError("sourceNodeId 未解析到真实图片资产", {
          status: 422,
          code: "agents_tool_image_reference_unresolved",
          details: { sourceNodeId },
        });
      }
      const imageUrl = sourceReference.url;
      const materialIdentity = stateKey
        ? {
            mode: "state" as const,
            canonicalName: expectedName,
            canonicalAssetId: assetId,
            stateKey,
            stateDescription,
          }
        : {
            mode: "base" as const,
            canonicalName: expectedName,
          };
      const version = await createMaterialVersionForOwner(
        c as never,
        projectOwnerUserId,
        assetId,
        {
          data: {
            imageUrl,
            materialIdentity,
            ...(stateKey ? { stateKey, stateDescription } : {}),
            ...(sourceNodeId ? { sourceNodeId } : {}),
            ...(rawChapterId ? { sourceChapterId: rawChapterId } : {}),
          },
          note: stateKey
            ? `显式登记道具状态：${stateDescription}`
            : "显式登记当前 canonical 基态",
        },
      );
      const response = {
        created: true as const,
        assetId,
        name: expectedName,
        versionId: version.id,
        version: version.version,
        sourceReference: describeExecutionImageReference(sourceReference),
        materialIdentity,
        projectId,
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_material_asset_delete") {
      const assetId = readTrimmedString(body.args.assetId);
      const expectedName = readTrimmedString(body.args.expectedName);
      if (!assetId || !expectedName) {
        throw new AppError("删除素材需要 assetId 与 expectedName", {
          status: 400,
          code: "material_asset_delete_confirmation_required",
        });
      }
      const projectAssets = await listMaterialAssetsForOwner(
        c as never,
        projectOwnerUserId,
        { projectId },
      );
      const target = projectAssets.find((asset) => asset.id === assetId);
      if (!target) {
        throw new AppError("目标素材不属于当前项目", {
          status: 404,
          code: "material_asset_not_found_in_project",
        });
      }
      if (readTrimmedString(target.name) !== expectedName) {
        throw new AppError("expectedName 与目标素材真实名称不一致", {
          status: 409,
          code: "material_asset_delete_name_mismatch",
          details: {
            assetId,
            expectedName,
            actualName: readTrimmedString(target.name),
          },
        });
      }
      await deleteMaterialAssetForOwner(c as never, projectOwnerUserId, assetId);
      const response = {
        deleted: true as const,
        assetId,
        name: expectedName,
        projectId,
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    // 全局风格图（项目级 styleImages）：读。前端 picker / 出图回退共享同一服务端源。
    // 一并返回 styleLock（锁定风格元信息，含 stylePrompt）与 cinematicCamera（摄像机规格）——
    // 小T查询项目级图片规格的统一入口；摄像机在 agent 出图时也会由服务端自动拼进 prompt。
    if (body.toolName === "tapcanvas_get_style_reference") {
      const [styleImages, styleLock, cinematicCamera] = await Promise.all([
        getProjectStyleImagesForOwner(c as never, projectOwnerUserId, projectId),
        getProjectStyleLockForOwner(c as never, projectOwnerUserId, projectId),
        getProjectCinematicCameraForOwner(c as never, projectOwnerUserId, projectId),
      ]);
      const response = {
        hasStyleReference: styleImages.length > 0,
        count: styleImages.length,
        styleLock,
        cinematicCamera,
        executionPolicy: "server_auto_inject",
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_project_look_bible_get") {
	  const lookProject = await getProjectForUserAccess(c.env.DB, projectId, requestUserId);
	  const lookOwnerId = readTrimmedString(lookProject?.owner_id);
	  if (!lookProject || !lookOwnerId) {
		throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	  }
	  const active = await getActiveProjectLookBible({ ownerId: lookOwnerId, projectId });
	  const response = active
		? {
			exists: true as const,
			assetId: active.assetId,
			revision: active.revision,
			name: active.lookBible.name,
			summary: active.lookBible.summary,
			lookBibleHash: active.lookBibleHash,
			sourceNodeId: active.sourceNodeId,
			sourceFlowId: active.sourceFlowId,
			sourceChapterId: active.sourceChapterId,
			activatedAt: active.activatedAt,
			lookBible: active.lookBible,
		  }
		: { exists: false as const };
	  return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_project_look_bible_confirm") {
	  const sourceNodeId = readTrimmedString(body.args.sourceNodeId);
	  if (!sourceNodeId) {
		throw new AppError("sourceNodeId is required", {
		  status: 400,
		  code: "project_look_bible_source_node_required",
		});
	  }
	  const lookProject = await getProjectForUserAccess(c.env.DB, projectId, requestUserId);
	  const lookOwnerId = readTrimmedString(lookProject?.owner_id);
	  if (!lookProject || !lookOwnerId) {
		throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	  }
	  const sourceRow = await loadImageReferenceFlowRow();
	  const { readFlowNodes } = await import("./video-orchestrator.flow-io");
	  const sourceNode = readFlowNodes(sourceRow).find((node) => node.id === sourceNodeId);
	  if (!sourceNode) {
		throw new AppError("项目视觉圣经来源节点不存在于当前授权画布", {
		  status: 404,
		  code: "project_look_bible_source_node_not_found",
		  details: { sourceNodeId },
		});
	  }
	  const sourceData = sourceNode.data && typeof sourceNode.data === "object" && !Array.isArray(sourceNode.data)
		? sourceNode.data as Record<string, unknown>
		: {};
	  if (
		readTrimmedString(sourceData.kind) !== "text" ||
		readTrimmedString(sourceData.productionLayer) !== "anchors" ||
		readTrimmedString(sourceData.semanticKind) !== "projectLookBible"
	  ) {
		throw new AppError(
		  "项目视觉圣经来源节点必须是 kind=text、productionLayer=anchors、semanticKind=projectLookBible",
		  {
			status: 400,
			code: "project_look_bible_source_node_contract_invalid",
			details: { sourceNodeId },
		  },
		);
	  }
	  const sourceDocument = readTrimmedString(sourceData.content);
	  if (!sourceDocument) {
		throw new AppError("项目视觉圣经来源节点 content 为空", {
		  status: 400,
		  code: "project_look_bible_source_document_empty",
		  details: { sourceNodeId },
		});
	  }
	  const normalizedLookBible = (() => {
		try {
		  return normalizeProjectLookBible(body.args.lookBible);
		} catch (error) {
		  throw new AppError(
			error instanceof Error ? error.message : "项目视觉圣经结构无效",
			{ status: 400, code: "project_look_bible_contract_invalid" },
		  );
		}
	  })();
	  const confirmed = await confirmProjectLookBible({
		ownerId: lookOwnerId,
		projectId,
		sourceNodeId,
		sourceFlowId: chapterCanvasId ? null : sourceRow.id,
		sourceChapterId: chapterCanvasId || null,
		sourceDocument,
		lookBible: normalizedLookBible,
	  });
	  const active = confirmed.active;
	  const latestRow = await freshReadFlowRow({
		c: c as never,
		flowId: sourceRow.id,
		requestUserId,
		devBypass,
		...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
	  });
	  await persistFlowPatch({
		c: c as never,
		row: latestRow,
		flowId: sourceRow.id,
		requestUserId,
		devBypass,
		patch: {
		  patchNodeData: [{
			id: sourceNodeId,
			data: {
			  projectLookBibleStatus: "approved",
			  projectLookBibleSchemaVersion: PROJECT_LOOK_BIBLE_SCHEMA_VERSION,
			  projectLookBibleAssetId: active.assetId,
			  projectLookBibleRevision: active.revision,
			  projectLookBibleHash: active.lookBibleHash,
			  projectLookBibleActivatedAt: active.activatedAt,
			},
		  }],
		  allowOverwrite: true,
		},
		affectedNodeIds: [sourceNodeId],
		...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
	  });
	  const response = {
		created: confirmed.created,
		assetId: active.assetId,
		revision: active.revision,
		name: active.lookBible.name,
		summary: active.lookBible.summary,
		sectionCount: active.lookBible.sections.length,
		lookBibleHash: active.lookBibleHash,
		sourceNodeId,
		activatedAt: active.activatedAt,
	  };
	  return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    // 全局风格图：写（覆盖式）。小T 生成 style master 后调它锁全项目风格，所有图片节点 + 出图都带上。
    if (body.toolName === "tapcanvas_set_style_reference") {
      const nodeIds = Array.isArray(body.args.nodeIds) ? body.args.nodeIds : [];
      const assetIds = Array.isArray(body.args.assetIds) ? body.args.assetIds : [];
      if (nodeIds.length === 0 && assetIds.length === 0) {
        throw new AppError("设置项目全局画风至少需要一个 nodeId 或 assetId", {
          status: 400,
          code: "style_reference_ids_required",
        });
      }
      const resolvedStyleReferences = await resolveExecutionImageReferences({
        c: c as never,
        ownerId: projectOwnerUserId,
        row: await loadImageReferenceFlowRow(),
        nodeIds,
        assetIds,
      });
      const styleImages = resolvedStyleReferences
        .map((reference) => reference.url)
        .slice(0, 8);
      const currentStyleImages = await getProjectStyleImagesForOwner(
        c as never,
        projectOwnerUserId,
        projectId,
      );
      const writeDecision = decideChapterStyleReferenceWrite({
        chapterId: body.chapterId,
        currentStyleImages,
        requestedStyleImages: styleImages,
      });
      if (writeDecision.action === "reject") {
        throw new AppError(
          "章节生产不得替换或清空已经锁定的项目全局画风。请复用现有画风；如需换画风，必须在项目设置中由用户显式修改。",
          {
            status: 409,
            code: writeDecision.code,
            details: {
              chapterId: body.chapterId,
              currentStyleImageCount: currentStyleImages.length,
              requestedStyleImageCount: styleImages.length,
            },
          },
        );
      }
      if (writeDecision.action === "idempotent") {
        const response = {
          references: resolvedStyleReferences.map(describeExecutionImageReference),
          count: currentStyleImages.length,
          writeMode: "idempotent_reuse",
          message: "项目全局画风已锁定，本次章节请求复用相同画风，未执行覆盖写入。",
        };
        return c.json({ ok: true, content: JSON.stringify(response), data: response });
      }
      const saved = await setProjectStyleImagesForOwner(c as never, projectOwnerUserId, projectId, styleImages);
      // 【世界书未定稿软提醒·2026-07-14】画风锁定是全书级决策，未定稿先锁风格＝返工高危
      //（本次事故正是画风先锁）。软提醒不拦。
      const worldBibleWarning = await getWorldBibleReminderForProject({
        projectId,
        ownerId: projectOwnerUserId,
      }).catch(() => null);
      const response = {
        references: resolvedStyleReferences.map(describeExecutionImageReference),
        count: saved.length,
        writeMode: "initial_set",
        message:
          saved.length > 0
            ? `已设为全项目全局风格图（${saved.length} 张）。本项目所有图片节点的风格选择与后续出图都会自动带上。`
            : "已清空项目全局风格图。",
        ...(worldBibleWarning ? { worldBibleWarning } : {}),
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    // 一步到位的锚定候选装配：把项目已有角色卡/场景卡(图URL+描述)装配成可直接传入
    // node.data.referenceImages 的候选（带 @类型：名称 标签），降小T 编排负担。
    // 与负向 storyboard-anchor-gate 共用 listMaterialAssets 数据源，一正一反。
    if (body.toolName === "tapcanvas_storyboard_anchor_candidates") {
      const limitRaw = Number(body.args.limit || 6);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(8, Math.trunc(limitRaw))) : 6;
      // 【项目隔离硬规则·用户定】锚卡候选只在本项目内取——scope=owner/all 跨项目逃生门已封，
      // 忽略该参数强制 project 级，杜绝别项目的角色/场景锚卡（含不同画风）被本项目捞进来当参考图。
      void readTrimmedString(body.args.scope);
      const projectAssets = await listProjectNodeAssetsForOwner(
        c as never,
        projectOwnerUserId,
        { projectId },
      );
      const characters = projectAssets.filter((asset) => asset.kind === "character");
      const scenes = projectAssets.filter((asset) => asset.kind === "scene");
      const props = projectAssets.filter((asset) => asset.kind === "prop");
      const ensembles = projectAssets.filter((asset) => asset.kind === "ensemble");
      const poses = projectAssets.filter((asset) => asset.kind === "pose");
      const policied = { characters, scenes, props };
      const { candidates } = buildStoryboardAnchorCandidatesFromAssets(
        // 群像图排在角色卡之后、场景卡之前：群像镜里它优先级高于单场景卡，又不抢角色身份锚。
        // 姿态图紧随群像图（同为"组合形态"参考，含正确交互形态是命脉）。
        // props 排在 scenes 前（2026-07-10）：道具/法宝通常仅 1-2 件且是跨章造型命脉，
        // 原先排最后会在 cap（默认 6）截断时被角色+场景挤出候选 → 法宝漂移。
        [...policied.characters, ...ensembles, ...poses, ...policied.props, ...policied.scenes],
        limit,
      );
      const response = {
        projectHasAnchorAssets: candidates.length > 0,
        scope: "project" as const,
        candidates: candidates.map((candidate) => ({
          assetId: candidate.assetId,
          kind: candidate.kind,
          name: candidate.name,
          label: candidate.label,
          ...(candidate.description
            ? { description: candidate.description }
            : {}),
          referenceAssetIds: [candidate.assetId],
        })),
        referenceAssetIds: candidates.map((candidate) => candidate.assetId),
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    if (body.toolName === "tapcanvas_pipeline_runs_list") {
      const limitRaw = Number(body.args.limit || 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
      const runs = await listUserAgentPipelineRuns(c as never, requestUserId, { projectId, limit });
      const parsed = runs.map((item) => AgentPipelineRunSchema.parse(item));
      return c.json({ ok: true, content: JSON.stringify(parsed), data: { items: parsed } });
    }

    if (body.toolName === "tapcanvas_pipeline_run_get") {
      const runId = readTrimmedString(body.args.runId);
      if (!runId) {
        throw new AppError("runId is required", {
          status: 400,
          code: "pipeline_run_id_required",
        });
      }
      const run = await getUserAgentPipelineRunById(c as never, requestUserId, runId);
      const parsed = AgentPipelineRunSchema.parse(run);
      return c.json({ ok: true, content: JSON.stringify(parsed), data: parsed as Record<string, unknown> });
    }

    // 包装层渲染只需 projectId 作用域（素材走 URL 预下载，不读 flow 节点），
    // 必须放在 flow row 加载之前——否则无 flowId 的调用会被误判 flow_not_found。
    if (body.toolName === "tapcanvas_hyperframes_render") {
      const rendered = await renderHyperframesToCanvas({
        c: c as never,
        requestUserId: projectOwnerUserId,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(rendered),
          data: rendered as unknown as Record<string, unknown>,
        }),
      );
    }

    const row = chapterCanvasId
      ? await loadChapterCanvasAsFlowRow(c as never, requestUserId, chapterCanvasId, projectId)
      : devBypass
        ? await getFlowByIdUnsafe(c.env.DB, flowId)
        : await getFlowForOwner(c.env.DB, flowId, requestUserId);
    if (!row || row.project_id !== projectId) {
      throw new AppError("Flow not found", {
        status: 404,
        code: "flow_not_found",
      });
    }

    if (body.toolName === "tapcanvas_material_assets_sync") {
      const bindings = readMaterialSyncBindings(body.args.bindings);
      const flowDto = mapFlowRowToDto(row);
      const flowData = sanitizeFlowDataForStorage(flowDto.data ?? {});
      const flowRecord =
        flowData && typeof flowData === "object" && !Array.isArray(flowData)
          ? (flowData as Record<string, unknown>)
          : {};
      const nodes = Array.isArray(flowRecord.nodes) ? flowRecord.nodes : [];
      const nodeById = new Map<string, Record<string, unknown>>();
      for (const item of nodes) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const node = item as Record<string, unknown>;
        const nodeId = readTrimmedString(node.id);
        if (nodeId) nodeById.set(nodeId, node);
      }

      const results: Array<Record<string, unknown>> = [];
      const patchNodeData: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const binding of bindings) {
        const node = nodeById.get(binding.nodeId);
        const nodeData =
          node?.data && typeof node.data === "object" && !Array.isArray(node.data)
            ? (node.data as Record<string, unknown>)
            : null;
        if (!node || !nodeData) {
          results.push({
            nodeId: binding.nodeId,
            kind: binding.kind,
            name: binding.name,
            status: "failed",
            reason: "canvas_node_not_found",
          });
          continue;
        }
        const imageUrl = readDurableCanvasImageUrl(nodeData);
        if (!imageUrl) {
          results.push({
            nodeId: binding.nodeId,
            kind: binding.kind,
            name: binding.name,
            status: "failed",
            reason: "canvas_node_has_no_real_image",
          });
          continue;
        }
        const synced = await syncCanvasCardToMaterial({
          c: c as never,
          userId: projectOwnerUserId,
          projectId,
          imageUrl,
          nodeData,
          nodeId: binding.nodeId,
          binding,
        });
        const status = synced.synced
          ? "synced"
          : synced.reason === "canonical_points_to_other_image" ||
              synced.reason === "image_already_bound_to_other_identity"
            ? "canvas_authoritative"
            : "failed";
        results.push({
          nodeId: binding.nodeId,
          kind: binding.kind,
          name: binding.name,
          status,
          ...(synced.assetId ? { assetId: synced.assetId } : {}),
          ...(synced.reason ? { reason: synced.reason } : {}),
        });
        if (synced.synced && synced.assetId) {
          patchNodeData.push({
            id: binding.nodeId,
            data: {
              materialKind: binding.kind,
              referenceType: binding.kind,
              ...(binding.kind === "character" ? { roleName: binding.name } : {}),
              ...(binding.kind === "scene" ? { sceneName: binding.name } : {}),
              ...(binding.kind === "prop"
                ? {
                    propName: binding.name,
                    materialIdentity:
                      binding.materialIdentity ?? { mode: "base", canonicalName: binding.name },
                  }
                : {}),
              materialAssetId: synced.assetId,
              materialRegisteredImageUrl: imageUrl,
            },
          });
        }
      }

      if (patchNodeData.length > 0) {
        const latestRow = await freshReadFlowRow({
          c: c as never,
          flowId: row.id,
          requestUserId,
          devBypass,
          ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
        });
        await persistFlowPatch({
          c: c as never,
          row: latestRow,
          flowId: row.id,
          requestUserId,
          devBypass,
          patch: { patchNodeData, allowOverwrite: true },
          affectedNodeIds: patchNodeData.map((item) => item.id),
          ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
        });
      }

      const response = {
        ok: true as const,
        projectId,
        flowId: row.id,
        syncedCount: results.filter((item) => item.status === "synced").length,
        canvasAuthoritativeCount: results.filter((item) => item.status === "canvas_authoritative").length,
        failedCount: results.filter((item) => item.status === "failed").length,
        results,
      };
      return c.json({ ok: true, content: JSON.stringify(response), data: response });
    }

    const getExecutionInCurrentFlow = async (executionId: string) => {
      const execution = await getExecutionForOwner(c.env.DB, executionId, requestUserId);
      if (
        !execution ||
		!workflowExecutionMatchesCanvasScope({
			executionFlowId: execution.flow_id,
			executionCanvasId: execution.canvas_id,
			executionProjectId: execution.project_id,
			scopeFlowId: row.id,
			scopeProjectId: projectId,
			isChapterScope: Boolean(chapterCanvasId),
		})
      ) {
        throw new AppError("Execution not found", {
          status: 404,
          code: "execution_not_found",
          severity: "warning",
        });
      }
      return execution;
    };

    if (body.toolName === "tapcanvas_image_refs_get") {
      const references = await resolveImageReferencesForInspection({
        c: c as never,
        ownerId: requestUserId,
        row,
        nodeIds: body.args.nodeIds,
        assetIds: body.args.assetIds,
      });
      const response = {
        references: references.map(describeExecutionImageReference),
        count: references.length,
      };
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(response),
          data: response,
        }),
      );
    }

    if (body.toolName === "tapcanvas_executions_list") {
      const limitRaw = Number(body.args.limit || 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
      const rows = await listExecutionsForOwnerFlow(c.env.DB, {
        ownerId: requestUserId,
        flowId: row.id,
        limit,
      });
      const parsed = rows.map((item) => WorkflowExecutionSchema.parse(mapExecutionRow(item)));
      return c.json({ ok: true, content: JSON.stringify(parsed), data: { items: parsed } });
    }

	if (body.toolName === "tapcanvas_workflow_execution_inspect") {
		const parsedArgs = WorkflowExecutionInspectArgsSchema.safeParse(body.args);
		if (!parsedArgs.success) {
			throw new AppError("Workflow execution inspection arguments are invalid", {
				status: 400,
				code: "workflow_execution_inspect_args_invalid",
				details: { issues: parsedArgs.error.issues },
			});
		}
		const { executionId, view, cursor, limit } = parsedArgs.data;
		const execution = await getExecutionInCurrentFlow(executionId);
		try {
			if (view === "attempts") {
				const page = WorkflowNodeAttemptPageSchema.parse(
					await listWorkflowNodeAttemptsPageForExecutionOwner(c.env.DB, {
						ownerId: requestUserId,
						executionId,
						...(cursor ? { cursor } : {}),
						...(limit === undefined ? {} : { limit }),
					}),
				);
				const response = {
					view,
					executionId,
					executionFamilyId: execution.execution_family_id,
					page,
				};
				return c.json({ ok: true, content: JSON.stringify(response), data: response });
			}
			const family = await getWorkflowExecutionFamilyPageForOwner(c.env.DB, {
				ownerId: requestUserId,
				executionId,
				...(cursor ? { cursor } : {}),
				...(limit === undefined ? {} : { limit }),
			});
			if (!family) {
				throw new AppError("Execution not found", {
					status: 404,
					code: "execution_not_found",
					severity: "warning",
				});
			}
			const parsedFamily = WorkflowExecutionFamilySchema.parse(family);
			const workflowOutputs = parsedFamily.latestExecutionStatus === "success"
				? await readWorkflowExecutionAgentOutputs(c.env.DB, {
					ownerId: requestUserId,
					executionId: parsedFamily.latestExecutionId,
				})
				: [];
			const response = {
				view,
				family: parsedFamily,
				...(parsedFamily.latestExecutionStatus === "success" ? { workflowOutputs } : {}),
			};
			return c.json({ ok: true, content: JSON.stringify(response), data: response });
		} catch (error: unknown) {
			if (
				error instanceof Error &&
				(error.message === "workflow_node_attempt_cursor_invalid" ||
					error.message === "workflow_execution_family_cursor_invalid")
			) {
				throw new AppError("Workflow execution inspection cursor is invalid for this scope", {
					status: 400,
					code: error.message,
				});
			}
			throw error;
		}
	}

	if (body.toolName === "tapcanvas_workflow_resume") {
		if (!workflowRecoveryAccess) {
			throw new AppError("Workflow recovery requires an administrator or an active durable public turn", {
				status: 403,
				code: "workflow_recovery_not_authorized",
			});
		}
		const sourceExecutionId = readTrimmedString(body.args.sourceExecutionId);
		if (!sourceExecutionId) {
			throw new AppError("sourceExecutionId is required", {
				status: 400,
				code: "workflow_resume_source_execution_id_required",
			});
		}
		const cutoverArgs = isRecord(body.args.agentModelCutover)
			? body.args.agentModelCutover
			: null;
		const providerBalanceRestored = body.args.providerBalanceRestored === true;
		const cancellationRevoked = body.args.cancellationRevoked === true;
		const definitionCutoverArgs = isRecord(body.args.definitionCutover)
			? body.args.definitionCutover
			: null;
		const definitionCutover = definitionCutoverArgs?.mode === "current_flow";
		if (body.args.providerBalanceRestored !== undefined && !providerBalanceRestored) {
			throw new AppError("providerBalanceRestored must be exactly true when provided", {
				status: 400,
				code: "workflow_provider_balance_restored_invalid",
			});
		}
		if (body.args.cancellationRevoked !== undefined && !cancellationRevoked) {
			throw new AppError("cancellationRevoked must be exactly true when provided", {
				status: 400,
				code: "workflow_cancellation_revoked_invalid",
			});
		}
		if (body.args.definitionCutover !== undefined && !definitionCutover) {
			throw new AppError("definitionCutover.mode must be current_flow", {
				status: 400,
				code: "workflow_definition_cutover_invalid",
			});
		}
		if ([providerBalanceRestored, cancellationRevoked, Boolean(cutoverArgs), definitionCutover].filter(Boolean).length > 1) {
			throw new AppError("Workflow recovery modes are mutually exclusive", {
				status: 400,
				code: "workflow_resume_recovery_mode_conflict",
			});
		}
		const cutoverTargetModel = cutoverArgs
			? readTrimmedString(cutoverArgs.targetModelKey)
			: null;
		const cutoverApiStyle = cutoverArgs?.apiStyle === "chat"
			|| cutoverArgs?.apiStyle === "responses"
			? cutoverArgs.apiStyle
			: null;
		if (cutoverArgs && (!cutoverTargetModel || !cutoverApiStyle)) {
			throw new AppError("agentModelCutover requires targetModelKey and apiStyle", {
				status: 400,
				code: "workflow_agent_model_cutover_invalid",
			});
		}
		if (cutoverArgs) {
			const parentExecution = isRecord(body.parentAgentExecution)
				? body.parentAgentExecution
				: null;
			const parentModel = parentExecution
				? readTrimmedString(parentExecution.model)
				: null;
			const parentApiStyle = parentExecution?.apiStyle === "chat"
				|| parentExecution?.apiStyle === "responses"
				? parentExecution.apiStyle
				: null;
			if (parentModel !== cutoverTargetModel || parentApiStyle !== cutoverApiStyle) {
				throw new AppError("Agent model cutover must target the initiating Agent's actual model", {
					status: 409,
					code: "workflow_agent_model_cutover_parent_mismatch",
				});
			}
		}
		await getExecutionInCurrentFlow(sourceExecutionId);
		try {
			const execution = WorkflowExecutionSchema.parse(await resumeWorkflowExecution({
				context: c as unknown as AppContext,
				env: c.env,
				ownerId: requestUserId,
				sourceExecutionId,
				trigger: "agent",
				...(providerBalanceRestored ? { providerBalanceRestored: true as const } : {}),
				...(cancellationRevoked ? { cancellationRevoked: true as const } : {}),
				...(definitionCutover ? { definitionCutover: { mode: "current_flow" as const } } : {}),
				...(cutoverTargetModel && cutoverApiStyle ? {
					agentModelCutover: {
						targetModelKey: cutoverTargetModel,
						apiStyle: cutoverApiStyle,
						authorizationSource: "initiating_agent" as const,
					},
				} : {}),
			}));
			const response = buildWorkflowExecutionAgentSummary(execution);
			return c.json({ ok: true, content: JSON.stringify(response), data: response });
		} catch (error: unknown) {
			if (error instanceof WorkflowResumeError) {
				throw new AppError(error.message, {
					status: error.status,
					code: error.code,
					...(error.details ? { details: error.details } : {}),
				});
			}
			throw error;
		}
	}

    if (body.toolName === "tapcanvas_workflow_run") {
      if (!isAdminRequest(c)) {
        throw new AppError("Administrator workflow access required", {
          status: 403,
          code: "admin_required",
        });
      }
      const triggerNodeId = readTrimmedString(body.args.triggerNodeId);
      const idempotencyKey = readTrimmedString(body.args.idempotencyKey);
	  const replayFromExecutionId = readTrimmedString(body.args.replayFromExecutionId);
	  const startFromNodeId = readTrimmedString(body.args.startFromNodeId);
      if (!triggerNodeId) {
        throw new AppError("triggerNodeId is required", {
          status: 400,
          code: "trigger_node_id_required",
        });
      }
      if (!idempotencyKey) {
        throw new AppError("idempotencyKey is required", {
          status: 400,
          code: "idempotency_key_required",
        });
      }
	  if (Boolean(replayFromExecutionId) !== Boolean(startFromNodeId)) {
		throw new AppError("replayFromExecutionId and startFromNodeId must be provided together", {
		  status: 400,
		  code: "workflow_replay_contract_invalid",
		});
	  }
      const concurrencyRaw = body.args.concurrency;
      const concurrency = concurrencyRaw === undefined
        ? undefined
        : Number(concurrencyRaw);
      if (concurrency !== undefined && (
        !Number.isInteger(concurrency)
        || concurrency < WORKFLOW_CONCURRENCY_MIN
        || concurrency > WORKFLOW_CONCURRENCY_MAX
      )) {
        throw new AppError(
          `concurrency must be an integer between ${WORKFLOW_CONCURRENCY_MIN} and ${WORKFLOW_CONCURRENCY_MAX}`,
          {
          status: 400,
          code: "workflow_concurrency_invalid",
          },
        );
      }
      const requestedTrigger = readTrimmedString(body.args.trigger) || "agent";
      if (!["manual", "api", "schedule", "agent"].includes(requestedTrigger)) {
        throw new AppError("trigger is invalid", {
          status: 400,
          code: "workflow_trigger_invalid",
        });
      }
      const triggerPayload = parseWorkflowTriggerPayload(body.args.triggerPayload);
      const delivery = resolveWorkflowDeliveryScope({
        workflowFlowId: row.id,
        callerProjectId: readTrimmedString(body.canvasProjectId),
        callerFlowId: readTrimmedString(body.canvasFlowId),
      });
      const callerProjectId = readTrimmedString(body.canvasProjectId);
      const callerFlowId = readTrimmedString(body.canvasFlowId);
      const runContext = callerProjectId && callerFlowId
        ? await buildWorkflowProjectContextForRun({
            c: c as unknown as AppContext,
            ownerId: requestUserId,
            projectId: callerProjectId,
            canvasId: callerFlowId,
            activeNodeId: body.canvasNodeId ?? null,
            triggerPayload,
          })
        : undefined;
      try {
        const result = await startWorkflowExecution(c.env, {
          flow: row,
          ownerId: requestUserId,
          triggerNodeId,
          trigger: requestedTrigger,
          ...(concurrency === undefined ? {} : { concurrency }),
          ...(triggerPayload === undefined ? {} : { triggerPayload }),
          ...(delivery ? { delivery } : {}),
          ...(runContext ? {
            projectContext: runContext.projectContext,
            callerCanvasSnapshot: runContext.callerCanvasSnapshot,
          } : {}),
		  ...(replayFromExecutionId && startFromNodeId
			? { replay: { sourceExecutionId: replayFromExecutionId, startFromNodeId } }
			: {}),
          idempotencyKey,
        });
        const execution = WorkflowExecutionSchema.parse(result.execution);
		const response = {
			created: result.created,
			...buildWorkflowExecutionAgentSummary(execution),
		};
        return c.json({ ok: true, content: JSON.stringify(response), data: response });
      } catch (error: unknown) {
        if (error instanceof WorkflowStartError) {
          throw new AppError(error.message, {
            status: error.status,
            code: error.code,
            details: error.details,
          });
        }
        throw error;
      }
    }

    if (body.toolName === "tapcanvas_execution_get") {
      const executionId = readTrimmedString(body.args.executionId) || readTrimmedString(body.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      const execution = await getExecutionInCurrentFlow(executionId);
      const parsed = WorkflowExecutionSchema.parse(mapExecutionRow(execution));
	  const summary = buildWorkflowExecutionAgentSummary(parsed);
      return c.json({ ok: true, content: JSON.stringify(summary), data: summary });
    }

    if (body.toolName === "tapcanvas_execution_node_runs_get") {
      const executionId = readTrimmedString(body.args.executionId) || readTrimmedString(body.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      await getExecutionInCurrentFlow(executionId);
      const rows = await listNodeRunsForExecutionOwner(c.env.DB, {
        ownerId: requestUserId,
        executionId,
      });
      const parsed = rows.map((item) => WorkflowNodeRunSchema.parse(mapNodeRunRow(item)));
      return c.json({ ok: true, content: JSON.stringify(parsed), data: { items: parsed } });
    }

    if (body.toolName === "tapcanvas_execution_events_list") {
      const executionId = readTrimmedString(body.args.executionId) || readTrimmedString(body.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      await getExecutionInCurrentFlow(executionId);
      const afterSeqRaw = Number(body.args.afterSeq || 0);
      const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
      const limitRaw = Number(body.args.limit || 50);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;
      const rows = await listExecutionEvents(c.env.DB, {
        executionId,
        afterSeq,
        limit,
      });
      const parsed = rows.map((item) => WorkflowExecutionEventSchema.parse(mapExecutionEventRow(item)));
      return c.json({ ok: true, content: JSON.stringify(parsed), data: { items: parsed } });
    }

    if (body.toolName === "tapcanvas_flow_get") {
      const dto = mapFlowRowToDto(row);
      const data = sanitizeFlowDataForStorage(dto.data ?? {});
      const parsed = PublicFlowGraphSchema.safeParse(data);
      if (!parsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: parsed.error.issues },
        });
      }
      const response = PublicFlowGetResponseSchema.parse({ ...dto, data: parsed.data });

      // 【上下文瘦身·2026-06-20 / 颗粒度扩展·2026-06-30】默认只返节点摘要(id/label/kind/层/hasMedia)+边。
      // 根治：旧版每次 flow_get 把整个画布全部节点的完整字段塞进 LLM 上下文（实测单轮 ~47 万 prompt_tokens、
      // 反复 flow_get×百回合 = 烧钱）。颗粒度三档（对标 codex 先定位后精读）：
      //   ① nodeIds:[...] → 默认只返有界生命周期/资产事实，避免旧状态节点的长 prompt、镜头表、textResults
      //      历史撑爆模型上下文；配 fields:[...] 才显式请求语义字段（如只取 prompt）；
      //   ② 无 nodeIds + filter(kind/productionLayer/status/hasMedia/q) / limit / offset → 过滤+分页的 slim 列表；
      //   ③ 都不传 → 全部节点 slim 摘要（旧默认，逐字等价）。
      const args = (body.args as Record<string, unknown> | undefined) ?? {};
      const selectOpts: FlowGetSelectOpts = {};
      if (Array.isArray(args.nodeIds))
        selectOpts.nodeIds = (args.nodeIds as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean);
      if (Array.isArray(args.fields))
        selectOpts.fields = (args.fields as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean);
      if (typeof args.limit === "number") selectOpts.limit = args.limit;
      if (typeof args.offset === "number") selectOpts.offset = args.offset;
      const flowFilter: FlowNodeFilter = {};
      if (typeof args.q === "string" && args.q.trim()) flowFilter.q = args.q;
      if (typeof args.kind === "string" && args.kind.trim()) flowFilter.kind = args.kind;
      if (typeof args.productionLayer === "string" && args.productionLayer.trim())
        flowFilter.productionLayer = args.productionLayer;
      if (typeof args.status === "string" && args.status.trim()) flowFilter.status = args.status;
      if (typeof args.hasMedia === "boolean") flowFilter.hasMedia = args.hasMedia;
      if (Object.keys(flowFilter).length > 0) selectOpts.filter = flowFilter;
      const allNodes = (Array.isArray(response.data?.nodes) ? response.data.nodes : []) as FlowNodeFull[];
      const edges = Array.isArray(response.data?.edges) ? response.data.edges : [];
      const selected = selectFlowNodesForTool(allNodes, selectOpts);
      const payload =
        selected.mode === "full"
          ? { id: response.id, name: response.name, data: { nodes: selected.nodes, edges } }
          : {
              id: response.id,
              name: response.name,
              slim: true,
              nodeCount: allNodes.length,
              ...(selected.total != null
                ? { matched: selected.total, shown: selected.shown, offset: selected.offset }
                : {}),
              nodes: selected.nodes,
              edges,
              hint:
                (selected.total != null && selected.total > (selected.shown ?? 0) + (selected.offset ?? 0)
                  ? `命中 ${selected.total} 个、已返 ${selected.shown} 个（offset=${selected.offset}）；继续用 offset 翻页。`
                  : "") +
                "节点已精简为 id/label/kind/productionLayer/hasMedia/status/taskId。" +
                "状态检查（出完了吗/要不要 wait/该不该重提交）直接看这里的 status 与 taskId，不要为此拉完整节点；" +
                "需要某节点语义数据（prompt/URL/result）→ tapcanvas_flow_get 传 nodeIds:[\"节点id\"] 并显式 fields:[\"prompt\"]；默认只返有界生命周期/资产事实，避免把历史 textResults 灌入上下文；" +
                "按内容/类型定位→ tapcanvas_flow_search。",
            };
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(payload),
          data: payload as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_flow_search") {
      // 画布 grep（对标 codex file-search）：按内容/类型/状态定位节点 → 拿 id → 再 flow_get(nodeIds) 精读。
      // 不预载全量，先定位后精读。
      const dto = mapFlowRowToDto(row);
      const data = sanitizeFlowDataForStorage(dto.data ?? {});
      const parsed = PublicFlowGraphSchema.safeParse(data);
      if (!parsed.success) {
        throw new AppError("Flow data invalid", {
          status: 500,
          code: "flow_data_invalid",
          details: { issues: parsed.error.issues },
        });
      }
      const response = PublicFlowGetResponseSchema.parse({ ...dto, data: parsed.data });
      const allNodes = (Array.isArray(response.data?.nodes) ? response.data.nodes : []) as FlowNodeFull[];
      const args = (body.args as Record<string, unknown> | undefined) ?? {};
      const filter: FlowNodeFilter = {};
      if (typeof args.q === "string" && args.q.trim()) filter.q = args.q;
      if (typeof args.kind === "string" && args.kind.trim()) filter.kind = args.kind;
      if (typeof args.productionLayer === "string" && args.productionLayer.trim())
        filter.productionLayer = args.productionLayer;
      if (typeof args.status === "string" && args.status.trim()) filter.status = args.status;
      if (typeof args.hasMedia === "boolean") filter.hasMedia = args.hasMedia;
      const page = {
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
        ...(typeof args.offset === "number" ? { offset: args.offset } : {}),
      };
      const result = searchFlowNodes(allNodes, filter, page);
      const overflow = result.total - result.offset - result.shown;
      const payload = {
        nodeCount: allNodes.length,
        matched: result.total,
        shown: result.shown,
        offset: result.offset,
        nodes: result.nodes,
        hint:
          (overflow > 0
            ? `命中 ${result.total} 个、已返 ${result.shown} 个（offset=${result.offset}），还有 ${overflow} 个；用 offset 翻页。 `
            : "") +
          "拿到目标 id 后用 tapcanvas_flow_get 传 nodeIds:[...] 读有界事实；需要完整语义 data 时必须显式传 fields:[...] 只取需要的字段。",
      };
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(payload),
          data: payload as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_node_text_edit") {
      // ⑤ 节点内文本锚定增量编辑（对标 codex apply_patch）：只改某节点某文本字段里锚定命中的片段，
      // 不重写整段（迭代长镜头表/clipPrompt 时省大量输出 token）。当前支持【章节画布】；项目根 flow 用 flow_patch。
      const args = (body.args as Record<string, unknown> | undefined) ?? {};
      const nodeId = String(args.nodeId ?? "").trim();
      const field = String(args.field ?? "prompt").trim() || "prompt";
      const editsRaw = Array.isArray(args.edits) ? (args.edits as unknown[]) : [];
      const edits: AnchoredTextEdit[] = editsRaw.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return { find: String(o.find ?? ""), replace: String(o.replace ?? "") };
      });
      if (!nodeId || edits.length === 0) {
        throw new AppError("nodeId 与非空 edits 必填", { status: 400, code: "node_text_edit_bad_args" });
      }
      if (!chapterCanvasId) {
        throw new AppError(
          "tapcanvas_node_text_edit 目前仅支持章节画布；项目根 flow 的节点请用 tapcanvas_flow_patch 的 patchNodeData。",
          { status: 400, code: "node_text_edit_chapter_only" },
        );
      }
      // 先在已读到的 row 上预演，拿到 applied/failed 给模型（即便后续写入按最新 flow 重算，预演足够反馈）。
      // 节点解析须与 flow_get 同源：mapFlowRowToDto → sanitize → parse，而非直接读 row.data.nodes。
      const dtoForEdit = mapFlowRowToDto(row);
      const dataForEdit = sanitizeFlowDataForStorage(dtoForEdit.data ?? {});
      const parsedForEdit = PublicFlowGraphSchema.safeParse(dataForEdit);
      const allNodes = (parsedForEdit.success && Array.isArray(parsedForEdit.data?.nodes)
        ? parsedForEdit.data.nodes
        : []) as FlowNodeFull[];
      const target = allNodes.find((n) => String(n?.id ?? "") === nodeId);
      if (!target) {
        throw new AppError(`节点不存在: ${nodeId}`, { status: 404, code: "node_text_edit_node_not_found" });
      }
      const targetData = (target.data && typeof target.data === "object" ? (target.data as Record<string, unknown>) : {});
      const before = typeof targetData[field] === "string" ? (targetData[field] as string) : "";
      if (!before) {
        throw new AppError(`节点 ${nodeId} 的字段 ${field} 为空或非文本，无法锚定编辑（请先用 flow_patch 写入）`, {
          status: 400,
          code: "node_text_edit_empty_field",
        });
      }
      const preview = applyAnchoredTextEdits(before, edits);
      if (!preview.changed) {
        const payload = {
          ok: false,
          nodeId,
          field,
          applied: 0,
          failed: preview.failed,
          message:
            "全部 edit 未命中：find 必须在该字段【当前文本】里恰好出现一次。not_found=没找到(检查是否逐字一致)、" +
            "ambiguous=多处命中(给更长更唯一的锚)。先 tapcanvas_flow_get(nodeIds:[id], fields:['" + field + "']) 看现文本再改。",
        };
        return c.json(AgentsToolExecuteResponseSchema.parse({ ok: true, content: JSON.stringify(payload), data: payload }));
      }
      // 真写入：mutateChapterCanvasGraph 内部按最新 flow 重读 + 重算编辑 + 冲突重试，避免 stale 覆盖。
      let writeApplied = 0;
      let writeFailed: typeof preview.failed = [];
      await mutateChapterCanvasGraph({
        c: c as never,
        userId: requestUserId,
        chapterId: chapterCanvasId,
        broadcastNodeIds: [nodeId],
        mutate: (current) => {
          const cur = (current && typeof current === "object" ? (current as Record<string, unknown>) : {}) as {
            nodes?: FlowNodeFull[];
            edges?: unknown[];
          };
          const nodes = Array.isArray(cur.nodes) ? cur.nodes : [];
          const nodesNext = nodes.map((n) => {
            if (String(n?.id ?? "") !== nodeId) return n;
            const d = (n.data && typeof n.data === "object" ? { ...(n.data as Record<string, unknown>) } : {}) as Record<string, unknown>;
            const text = typeof d[field] === "string" ? (d[field] as string) : "";
            const res = applyAnchoredTextEdits(text, edits);
            writeApplied = res.applied;
            writeFailed = res.failed;
            d[field] = res.text;
            return { ...n, data: d };
          });
          return { nodes: nodesNext, edges: Array.isArray(cur.edges) ? cur.edges : [] };
        },
      });
      const payload = {
        ok: true,
        nodeId,
        field,
        applied: writeApplied,
        failed: writeFailed,
        newLength: preview.text.length,
        message:
          `已对节点 ${nodeId}.${field} 应用 ${writeApplied} 处锚定编辑` +
          (writeFailed.length ? `，${writeFailed.length} 处未命中(见 failed)` : "") +
          "。只改了命中片段、未重写整段。",
      };
      return c.json(AgentsToolExecuteResponseSchema.parse({ ok: true, content: JSON.stringify(payload), data: payload }));
    }

    if (body.toolName === "tapcanvas_asset_add_to_canvas") {
      const added = await addAssetToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: body.args,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(added),
          data: added as unknown as Record<string, unknown>,
        }),
      );
    }

	if (body.toolName === STORY_PREVIEW_ORCHESTRATOR_TOOL) {
		if (!chapterCanvasId) {
			throw new AppError("剧情预览持久工作流仅支持章节画布", {
				status: 400,
				code: "story_preview_orchestrator_chapter_required",
			});
		}
		const args = (body.args ?? {}) as Record<string, unknown>;
		const mode = readTrimmedString(args.mode);
		const currentSnapshot = inspectStoryPreviewRunSnapshot({
			row,
			chapterId: chapterCanvasId,
		});
		const respond = (payload: Record<string, unknown>) => c.json(
			AgentsToolExecuteResponseSchema.parse({
				ok: true,
				content: stringifyAgentVisibleToolResult(payload),
				data: payload,
			}),
		);
		if (mode === "begin" || mode === "status") {
			return respond(buildStoryPreviewRunReceipt({
				snapshot: currentSnapshot,
				mode,
				status: currentSnapshot.nextBoardIndex === null ? "complete" : "ready",
			}));
		}
		const boardIndex = readStoryPreviewPutBoardIndex(mode);
		if (boardIndex === null || currentSnapshot.nextBoardIndex !== boardIndex) {
			return respond(buildStoryPreviewRepairFailure({
				snapshot: currentSnapshot,
				mode,
				code: "story_preview_operation_not_ready",
				message:
					`当前唯一可执行板是 ${currentSnapshot.nextBoardIndex ?? "无（全部已提交）"}，` +
					`拒绝越过前沿执行 ${mode || "<missing>"}`,
			}));
		}
		const board = currentSnapshot.boards[boardIndex]!;
		const openingState = readTrimmedString(args.openingState);
		const cells = Array.isArray(args.cells) ? args.cells : [];
		if (!openingState || cells.length !== board.expectedCellCount) {
			return respond(buildStoryPreviewRepairFailure({
				snapshot: currentSnapshot,
				mode,
				code: "invalid_story_preview_board_cell_count",
				message:
					`板 ${boardIndex} 必须提供 openingState 和正好 ${board.expectedCellCount} 格，` +
					`当前收到 ${cells.length} 格；尚未创建任何付费任务`,
				issues: {
					expectedCellCount: board.expectedCellCount,
					actualCellCount: cells.length,
					openingStatePresent: Boolean(openingState),
				},
			}));
		}
		try {
			const generated = await generateImageToCanvas({
				c: c as never,
				requestUserId,
				devBypass,
				flowId,
				row,
				bodyArgs: {
					previewBoard: { boardIndex, openingState, cells },
				},
				chapterId: chapterCanvasId,
				storyPreviewOperation: true,
				...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
			});
			const projectId = readTrimmedString(body.canvasProjectId) || readTrimmedString(row.project_id);
			if (!projectId) {
				throw new AppError("剧情预览提交后无法重读项目范围", {
					status: 500,
					code: "story_preview_project_scope_missing",
				});
			}
			const refreshedRow = await loadChapterCanvasAsFlowRow(
				c,
				requestUserId,
				chapterCanvasId,
				projectId,
			);
			const refreshedSnapshot = inspectStoryPreviewRunSnapshot({
				row: refreshedRow,
				chapterId: chapterCanvasId,
			});
			return respond(buildStoryPreviewRunReceipt({
				snapshot: refreshedSnapshot,
				mode,
				board: refreshedSnapshot.boards[boardIndex] ?? board,
				generated: generated as unknown as Record<string, unknown>,
				status: refreshedSnapshot.nextBoardIndex === null ? "complete" : "submitted",
			}));
		} catch (error) {
			const repairableCodes = new Set([
				"invalid_story_preview_board_cell_count",
				"invalid_story_preview_node_contract",
			]);
			if (error instanceof AppError && repairableCodes.has(error.code)) {
				return respond(buildStoryPreviewRepairFailure({
					snapshot: currentSnapshot,
					mode,
					code: error.code,
					message: `${error.message}；当前板尚未被执行器接受，请只重写本板`,
					issues: error.details,
				}));
			}
			throw error;
		}
	}

    if (body.toolName === "tapcanvas_image_generate_to_canvas") {
      const { operation: _schemaOperation, ...imageGenerateArgs } = body.args as Record<string, unknown>;
      const generated = await generateImageToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: imageGenerateArgs,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
        ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(generated),
          data: generated as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_capture_director_scene") {
      const generated = await captureDirectorScene({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: body.args,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(generated),
          data: generated as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_render_director_clip") {
      // clip 模式复用 captureDirectorScene：合入 mode:'clip'，浏览器离屏渲灰模动画 mp4 样片，
      // 后端据 report 的 videoUrl 建带 sourceVideoUrl 的 video 节点（seedance v2v 入口）。
      const generated = await captureDirectorScene({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: { ...(body.args as Record<string, unknown>), mode: "clip" },
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(generated),
          data: generated as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_director_define_motion") {
      const generated = await defineDirectorMotion({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: body.args,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      return c.json(AgentsToolExecuteResponseSchema.parse({ ok: true, content: stringifyAgentVisibleToolResult(generated), data: generated as unknown as Record<string, unknown> }));
    }

    if (body.toolName === "tapcanvas_director_set_character_motion") {
      const generated = await setDirectorCharacterMotion({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: body.args,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      return c.json(AgentsToolExecuteResponseSchema.parse({ ok: true, content: stringifyAgentVisibleToolResult(generated), data: generated as unknown as Record<string, unknown> }));
    }

    if (body.toolName === "tapcanvas_video_generate_to_canvas") {
	  const publicTurnId = readTrimmedString(body.publicTurnId);
      const generated = await generateVideoToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: body.args,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(generated),
          data: generated as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_video_extract_last_frame") {
      const extracted = await extractLastFrameToImage({
        c: c as never,
        ownerId: requestUserId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(extracted),
          data: extracted,
        }),
      );
    }

    if (body.toolName === "tapcanvas_video_extract_frames") {
      const extracted = await extractFramesAtForAgent({
        c: c as never,
        row,
        bodyArgs: body.args,
      });
      const args =
        body.args && typeof body.args === "object" && !Array.isArray(body.args)
          ? (body.args as Record<string, unknown>)
          : {};
      const roleName = readTrimmedString(args.roleName);
      const sourceNodeId = readTrimmedString(args.nodeId);
      const projectId = row?.project_id ?? null;
      const nowIso = new Date().toISOString();
      const frames = [] as Array<Record<string, unknown>>;
      for (const [index, frame] of extracted.frames.entries()) {
        let frameUrl: URL;
        try {
          frameUrl = new URL(frame.url);
        } catch {
          throw new AppError("抽帧服务未返回有效图片 URL", {
            status: 502,
            code: "agents_tool_extract_frames_public_url_unavailable",
            details: { time: frame.time },
          });
        }
        if (frameUrl.protocol !== "http:" && frameUrl.protocol !== "https:") {
          throw new AppError("抽帧服务未返回 http(s) 图片 URL", {
            status: 502,
            code: "agents_tool_extract_frames_public_url_unavailable",
            details: { time: frame.time },
          });
        }
        const frameName = roleName
          ? `${roleName}｜参考帧 ${index + 1}`
          : `视频参考帧｜${frame.time.toFixed(1)}s`;
        const asset = await createAssetRow(c.env.DB, requestUserId, {
          name: frameName,
          projectId,
          data: {
            kind: "generation",
            type: "image",
            url: frameUrl.toString(),
            taskKind: "extract_video_frame",
            sourceVideoNodeId: sourceNodeId || null,
            sourceTimeSec: frame.time,
            ...(roleName ? { roleName, referenceRole: "identity" } : {}),
          },
        }, nowIso);
        frames.push({
          time: frame.time,
          assetId: asset.id,
          name: frameName,
          referenceId: `asset:${asset.id}`,
          ready: true,
        });
      }
      const result = { ok: true, frames, roleName: roleName || null };
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(result),
          data: result,
        }),
      );
    }

    if (body.toolName === "tapcanvas_video_concat") {
      const concatenated = await concatVideosToCanvas({
        c: c as never,
        requestUserId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(concatenated),
          data: concatenated as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_voice_card_dub") {
      const dubbed = await dubVoiceCardToCanvas({
        c: c as never,
        requestUserId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(dubbed),
          data: dubbed as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_annotate_shot") {
      const annotated = await annotateShotToCanvas({
        c: c as never,
        requestUserId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: stringifyAgentVisibleToolResult(annotated),
          data: annotated as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_render_blocking_diagram") {
      const diagram = await renderBlockingDiagramToCanvas({
        c: c as never,
        requestUserId,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(diagram),
          data: diagram as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_video_reconcile") {
      const args =
        body.args && typeof body.args === "object" && !Array.isArray(body.args)
          ? (body.args as Record<string, unknown>)
          : {};
      const targetNodeId = readTrimmedString(args.nodeId);
      const targetTaskId = readTrimmedString(args.taskId);
      if (!targetNodeId || !targetTaskId) {
        throw new AppError("nodeId and taskId are required for precise video reconciliation", {
          status: 400,
          code: "video_reconcile_target_required",
        });
      }
      // 章节会话必须带 chapterId：reconcileVideoNodesForFlow 缺 chapterId 时会按 flowId 去 flows 表
      // 重新加载「项目根 flow」——另一张画布，章节里的在飞节点在那永远扫不到（details 恒空），
      // agent 据此误判孤儿而重提双花（2026-07-17 ch1 镜1b-v4→v4b 实证；同 ch45 裂脑，当时漏修此分支）。
      const reconciled = await reconcileVideoNodesForFlow({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        target: { nodeId: targetNodeId, taskId: targetTaskId },
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(reconciled),
          data: reconciled as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_image_reconcile") {
      // 【服务端等待窗·2026-07-16 根治 reconcile 空转】此前 agent 只能"调一次→看 stillRunning→
      // 再调"，实测每张图后 8~13 连发（每次一整个 LLM 往返，1K 图 30-60s 生成期烧掉十几轮）。
      // 现默认：首查 stillRunning>0 时服务端内部每 5s 复查、最长等 waitSeconds（默认 45s，上限
      // 120s——远低于 bridge 10min 超时），收齐或超时才返回。waitSeconds:0 = 旧的立即返回。
      const waitSecondsRaw = Number(
        (body.args && typeof body.args === "object" && !Array.isArray(body.args)
          ? (body.args as Record<string, unknown>).waitSeconds
          : undefined) ?? 45,
      );
      const waitSeconds = Number.isFinite(waitSecondsRaw)
        ? Math.max(0, Math.min(120, Math.trunc(waitSecondsRaw)))
        : 45;
      const waitDeadline = Date.now() + waitSeconds * 1000;
      let reconciled = await reconcileImageNodesForFlow({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
      });
      while (
        Number((reconciled as { stillRunning?: unknown }).stillRunning ?? 0) > 0 &&
        Date.now() < waitDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        reconciled = await reconcileImageNodesForFlow({
          c: c as never,
          requestUserId,
          devBypass,
          flowId,
          row,
          ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
        });
      }
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(reconciled),
          data: reconciled as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_master_storyboard_split") {
      const result = await splitMasterStoryboardForAgent({
        c: c as AppContext,
        row,
        flowId,
        ...(chapterCanvasId ? { chapterId: chapterCanvasId } : {}),
        requestUserId,
        devBypass,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(result),
          data: result as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_analyze_image") {
      const analyzed = await analyzeImageForAgent({
        c: c as never,
        requestUserId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(analyzed),
          data: analyzed as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_analyze_video") {
      const analyzed = await analyzeVideoForAgent({
        c: c as never,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify({ text: analyzed.text }),
          data: analyzed as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_decompose_video") {
      const decomposed = await decomposeVideoForAgent({
        c: c as never,
        requestUserId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(decomposed.shotTable),
          data: decomposed as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_distill_director_breakdown") {
      const distilled = await distillDirectorBreakdownForAgent({
        c: c as never,
        row,
        bodyArgs: body.args,
      });
      // 【拆片卡落画布 v1·2026-07-07】writeToCanvas:true + 章节画布 → 拆解产物写成 text 节点
      // 「拆片卡」：prompt=人读 markdown、data.directorBreakdown=结构化真值，成为可连边引用的
      // 一等画布资产（下游 video 节点作剧情参考）。best-effort：写失败不阻断拆解文本返回。
      let breakdownNodeId: string | null = null;
      const distillArgs =
        body.args && typeof body.args === "object" && !Array.isArray(body.args)
          ? (body.args as Record<string, unknown>)
          : {};
      if (distillArgs.writeToCanvas === true && body.chapterId) {
        try {
          const reqUserId = requireUserId(c);
          const nodeId = `agent-breakdown-${Date.now().toString(36)}`;
          const loglineHead = String(distilled.breakdown.logline || "参考片").slice(0, 20);
          const nodeData: Record<string, unknown> = {
            kind: "text",
            label: `拆片卡｜${loglineHead}`,
            prompt: renderDirectorBreakdownMarkdown(distilled.breakdown),
            directorBreakdown: distilled.breakdown as unknown as Record<string, unknown>,
            sourceVideoUrl: distilled.breakdown.sourceVideoUrl,
          };
          await writeFinalNodeToChapterCanvas({
            c: c as never,
            userId: reqUserId,
            chapterId: body.chapterId,
            nodeId,
            finalNode: {
              id: nodeId,
              type: "taskNode",
              position: { x: -420, y: 0 },
              data: nodeData,
            },
            finalNodeData: nodeData,
          });
          breakdownNodeId = nodeId;
        } catch (e) {
          console.warn(
            `[distill-breakdown] 拆片卡落画布失败(不阻断拆解返回): ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      // 项目根画布没有 chapterId，但 agents-cli 的对话上下文会提供
      // canvasFlowId。保持与 flow_patch 相同的事实源，把拆片卡写入当前
      // flow；使用稳定 node id，重复执行时更新同一张卡而不是制造副本。
      if (distillArgs.writeToCanvas === true && !body.chapterId && flowId) {
        try {
          const nodeId = `agent-breakdown-${readTrimmedString(distillArgs.nodeId) || "reference"}`;
          const loglineHead = String(distilled.breakdown.logline || "参考片").slice(0, 20);
          const nodeData: Record<string, unknown> = {
            kind: "text",
            label: `拆片卡｜${loglineHead}`,
            prompt: renderDirectorBreakdownMarkdown(distilled.breakdown),
            directorBreakdown: distilled.breakdown as unknown as Record<string, unknown>,
            sourceVideoUrl: distilled.breakdown.sourceVideoUrl,
          };
          const dto = mapFlowRowToDto(row);
          const current = sanitizeFlowDataForStorage(dto.data ?? {});
          const currentRecord =
            current && typeof current === "object" && !Array.isArray(current)
              ? (current as Record<string, unknown>)
              : {};
          const currentNodes = Array.isArray(currentRecord.nodes)
            ? currentRecord.nodes.filter(
                (node): node is Record<string, unknown> =>
                  Boolean(node) && typeof node === "object" && !Array.isArray(node),
              )
            : [];
          const exists = currentNodes.some((node) => String(node.id ?? "") === nodeId);
          const patch = exists
            ? { patchNodeData: [{ id: nodeId, data: nodeData }], allowOverwrite: true }
            : {
                createNodes: [
                  {
                    id: nodeId,
                    type: "taskNode",
                    position: { x: -420, y: 0 },
                    data: nodeData,
                  },
                ],
              };
          const applied = applyPublicFlowGraphPatch({ current, patch });
          const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
          const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
          if (!nextParsed.success) {
            throw new AppError("Flow patch produced invalid data", {
              status: 500,
              code: "distill_breakdown_flow_invalid",
              details: { issues: nextParsed.error.issues },
            });
          }
          const updated = devBypass
            ? await updateFlowByIdUnsafe(c.env.DB, {
                id: flowId,
                name: row.name,
                data: JSON.stringify(sanitizedNext),
                nowIso: new Date().toISOString(),
              })
            : await updateFlow(c.env.DB, {
                id: flowId,
                name: row.name,
                data: JSON.stringify(sanitizedNext),
                ownerId: requestUserId,
                projectId: row.project_id,
                nowIso: new Date().toISOString(),
                source: "agent",
              });
          if (!updated) {
            throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
          }
          breakdownNodeId = nodeId;
        } catch (e) {
          console.warn(
            `[distill-breakdown] 项目根画布落片失败(不阻断拆解返回): ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(distilled.breakdown),
          data: {
            ...(distilled as unknown as Record<string, unknown>),
            ...(breakdownNodeId ? { canvasNodeId: breakdownNodeId } : {}),
          },
        }),
      );
    }

    if (body.toolName === "tapcanvas_video_compare") {
      const compared = await videoCompareForAgent({
        c: c as never,
        row,
        bodyArgs: body.args,
        parentAgentExecution: requireCallerAgentExecution(body),
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(compared.scorecard),
          data: compared as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_fetch_video_from_url") {
      const fetched = await fetchVideoFromUrlForAgent({
        c: c as never,
        requestUserId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(fetched),
          data: fetched as unknown as Record<string, unknown>,
        }),
      );
    }

    const parsedPatch = PublicFlowPatchRequestSchema.safeParse(body.args);
    if (!parsedPatch.success) {
      throw new AppError("Invalid flow patch request", {
        status: 400,
        code: "invalid_flow_patch_request",
        details: { issues: parsedPatch.error.issues },
      });
    }
    if (publicFlowPatchRequestsAdminWorkflow(parsedPatch.data) && !isAdminRequest(c)) {
      throw new AppError("只有管理员可以创建或修改工作流编排节点", {
        status: 403,
        code: "admin_workflow_forbidden",
      });
    }
    if (chapterCanvasId) {
      // 章节会话：patch 落 chapters.canvas_flow（乐观锁+SSE 广播），与 orchestrate 读侧同源。
      const chapterApplied = await applyFlowPatchToChapterCanvas({
        c: c as never,
        userId: requestUserId,
        chapterId: chapterCanvasId,
        patch: parsedPatch.data,
      });
      const createdNodeIdSet = new Set(chapterApplied.createdNodeIds);
      const createdEdgeIdSet = new Set(chapterApplied.createdEdgeIds);
      const chapterResponse = PublicFlowPatchResponseSchema.parse({
        ok: true,
        flowId: chapterCanvasId,
        updatedAt: chapterApplied.updatedAt,
        stats: chapterApplied.stats,
        createdNodeSnapshots: chapterApplied.data.nodes
          .filter((n) => createdNodeIdSet.has(String(n.id ?? "")))
          .map((n) => ({
            id: String(n.id ?? ""),
            type: typeof n.type === "string" ? n.type : undefined,
            data:
              n.data && typeof n.data === "object" && !Array.isArray(n.data)
                ? (n.data as Record<string, unknown>)
                : undefined,
            position:
              n.position && typeof n.position === "object" && !Array.isArray(n.position)
                ? (n.position as { x: number; y: number })
                : undefined,
          })),
        createdEdgeSnapshots: chapterApplied.data.edges
          .filter((e) => createdEdgeIdSet.has(String(e.id ?? "")))
          .map((e) => ({
            id: String(e.id ?? ""),
            source: String(e.source ?? ""),
            target: String(e.target ?? ""),
            sourceHandle: typeof e.sourceHandle === "string" ? e.sourceHandle : undefined,
            targetHandle: typeof e.targetHandle === "string" ? e.targetHandle : undefined,
          })),
        data: chapterApplied.data,
      });
      const agentResponse = buildAgentFlowPatchResult({
        flowId: chapterResponse.flowId,
        updatedAt: chapterResponse.updatedAt,
        stats: chapterResponse.stats,
        createdNodeSnapshots: chapterResponse.createdNodeSnapshots,
        createdEdgeSnapshots: chapterResponse.createdEdgeSnapshots,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(agentResponse),
          data: agentResponse,
        }),
      );
    }
    const dto = mapFlowRowToDto(row);
    const current = sanitizeFlowDataForStorage(dto.data ?? {});
    const applied = applyPublicFlowGraphPatch({ current, patch: parsedPatch.data });
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
          name: row.name,
          data: nextJson,
          nowIso,
        })
      : await updateFlow(c.env.DB, {
          id: flowId,
          name: row.name,
          data: nextJson,
          ownerId: requestUserId,
          projectId: row.project_id,
          nowIso,
        });
    if (!updated) {
      throw new AppError("Flow not found", {
        status: 404,
        code: "flow_not_found",
      });
    }
    const versionUserId = resolveFlowVersionUserId({
      devBypass,
      requestUserId,
      flowOwnerId: row.owner_id,
    });
    // 画布文本节点 → 书籍章节文件同步（fire-and-forget）
    if (row.project_id) {
      syncCanvasBookFromFlow({
        projectId: row.project_id,
        userId: versionUserId,
        flowData: sanitizedNext,
        nowIso,
      }).catch((err) => console.error("[canvas-book-sync] agents-tool-bridge:", err));

      // 广播节点/边变更到项目 SSE 频道，浏览器实时刷新画布。
      // 必须用 buildCanvasSyncPatch（按 applied.createdNodeIds 反查）：agent 的
      // createNodes 普遍不带 id，按请求 id 反查会恒空、写库成功但画布收不到推送。
      const syncPatch = buildCanvasSyncPatch({
        applied,
        patch: parsedPatch.data,
        data: nextParsed.data,
      });
      if (syncPatch) {
        broadcastPatch(row.project_id, syncPatch, "");
        applyPatchToFlowYDoc(row.id, syncPatch);
      }
    }
    // Build node/edge snapshots from persisted data for AI self-verification.
    const createdNodeIdSet = new Set(applied.createdNodeIds);
    const createdEdgeIdSet = new Set(applied.createdEdgeIds);
    const persistedNodes = (Array.isArray(nextParsed.data.nodes) ? nextParsed.data.nodes : []) as Record<string, unknown>[];
    const persistedEdges = (Array.isArray(nextParsed.data.edges) ? nextParsed.data.edges : []) as Record<string, unknown>[];
    const createdNodeSnapshots = persistedNodes
      .filter((n) => createdNodeIdSet.has(String(n.id ?? "")))
      .map((n) => ({
        id: String(n.id ?? ""),
        type: typeof n.type === "string" ? n.type : undefined,
        data: n.data && typeof n.data === "object" && !Array.isArray(n.data)
          ? (n.data as Record<string, unknown>)
          : undefined,
        position: n.position && typeof n.position === "object" && !Array.isArray(n.position)
          ? (n.position as { x: number; y: number })
          : undefined,
      }));
    const createdEdgeSnapshots = persistedEdges
      .filter((e) => createdEdgeIdSet.has(String(e.id ?? "")))
      .map((e) => ({
        id: String(e.id ?? ""),
        source: String(e.source ?? ""),
        target: String(e.target ?? ""),
        sourceHandle: typeof e.sourceHandle === "string" ? e.sourceHandle : undefined,
        targetHandle: typeof e.targetHandle === "string" ? e.targetHandle : undefined,
      }));
    const response = PublicFlowPatchResponseSchema.parse({
      ok: true,
      flowId: updated.id,
      updatedAt: updated.updated_at,
      stats: applied.stats,
      createdNodeSnapshots,
      createdEdgeSnapshots,
      data: nextParsed.data,
    });
    const agentResponse = buildAgentFlowPatchResult({
      flowId: response.flowId,
      updatedAt: response.updatedAt,
      stats: response.stats,
      createdNodeSnapshots: response.createdNodeSnapshots,
      createdEdgeSnapshots: response.createdEdgeSnapshots,
    });
    return c.json(
      AgentsToolExecuteResponseSchema.parse({
        ok: true,
        content: JSON.stringify(agentResponse),
        data: agentResponse,
      }),
    );
  });

  // 宿主模式工具执行：不落 TapCanvas 库，只做命令协议校验。
  // 真正执行与资产验收由宿主消费聊天流里的 tool_calls 后完成；这里绝不伪报 applied/accepted。
  publicApiRouter.post("/agents/tools/host-execute", async (c) => {
    requireUserId(c);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const rawArgs = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).args
      : null;
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
    const toolName = body && typeof body === "object" && !Array.isArray(body)
      ? readTrimmedString((body as Record<string, unknown>).toolName)
      : "";
    const parsedCommand = toolName === "flow_patch"
      ? HostFlowPatchSchema.safeParse(args)
      : toolName === "host_tool"
        ? HostToolCallSchema.safeParse(args)
        : null;
    if (!parsedCommand?.success) {
      return c.json({
        ok: false,
        code: toolName === "host_tool" ? "invalid_host_tool" : "invalid_host_flow_patch",
        message: parsedCommand?.error.issues[0]?.message || "unsupported host tool command",
      }, 400);
    }
    const response = {
      ok: true,
      emitted: true,
      applied: false,
      acceptedAsync: false,
      deliveryState: "emitted_to_host",
      ...(toolName === "flow_patch"
        ? { op: (parsedCommand.data as { op: string }).op }
        : { name: (parsedCommand.data as { name: string }).name }),
      ...(toolName ? { toolName } : {}),
      note: "command validated for host response; host execution receipt is still required",
    };
    return c.json(
      AgentsToolExecuteResponseSchema.parse({
        ok: true,
        content: JSON.stringify(response),
        data: response,
      }),
    );
  });

  publicApiRouter.post("/director-capture/claim", async (c) => {
    const userId = requireUserId(c);
    const body = (await c.req.json().catch(() => ({}))) as { captureId?: string };
    const captureId = String(body.captureId ?? "").trim();
    if (!captureId) return c.json({ ok: false, code: "bad_request" }, 400);
    const row = await getTaskResultByTaskId(c.env.DB, userId, captureId);
    if (!row || row.vendor !== "browser-director-capture") return c.json({ ok: false, code: "not_found" }, 404);
    if (row.status !== "queued") return c.json({ ok: false, code: "already_claimed" }, 409);
    const prev = readResultJson(row.result);
    const leaseToken = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const won = await tryClaimTaskResult(c.env.DB, {
      userId,
      taskId: captureId,
      nowIso,
      result: JSON.parse(buildResultJson({ ...prev, phase: "claimed", leaseToken, leaseOwner: userId })),
    });
    if (!won) return c.json({ ok: false, code: "already_claimed" }, 409);
    return c.json({ ok: true, leaseToken, scene: prev.scene });
  });

  publicApiRouter.post("/director-capture/report", async (c) => {
    const userId = requireUserId(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      captureId?: string;
      leaseToken?: string;
      status?: string;
      imageUrl?: string;
      videoUrl?: string;
      assetId?: string;
      error?: string;
    };
    const captureId = String(body.captureId ?? "").trim();
    const leaseToken = String(body.leaseToken ?? "").trim();
    if (!captureId || !leaseToken) return c.json({ ok: false, code: "bad_request" }, 400);
    const row = await getTaskResultByTaskId(c.env.DB, userId, captureId);
    if (!row || row.vendor !== "browser-director-capture") return c.json({ ok: false, code: "not_found" }, 404);
    const prev = readResultJson(row.result);
    if (row.status !== "claimed" || prev.leaseToken !== leaseToken || prev.leaseOwner !== userId) {
      return c.json({ ok: false, code: "lease_invalid" }, 409);
    }
    const hasImageUrl = !!String(body.imageUrl ?? "").trim();
    const hasVideoUrl = !!String(body.videoUrl ?? "").trim();
    const hasAssetId = !!String(body.assetId ?? "").trim();
    // image 模式：imageUrl + assetId；clip 模式：videoUrl + assetId（assetId 仍需上报）
    const ok = body.status === "succeeded" && (hasImageUrl || hasVideoUrl) && hasAssetId;
    const nowIso = new Date().toISOString();
    await upsertTaskResult(c.env.DB, {
      userId,
      taskId: captureId,
      vendor: "browser-director-capture",
      kind: "image_edit",
      status: ok ? "succeeded" : "failed",
      completedAt: nowIso,
      chapterId: row.chapter_id,
      nodeId: row.node_id,
      nowIso,
      result: JSON.parse(buildResultJson({
        ...prev,
        phase: ok ? "succeeded" : "failed",
        ...(ok
          ? {
              assets: [{ type: "image" as const, url: hasImageUrl ? String(body.imageUrl) : String(body.videoUrl), assetId: String(body.assetId) }],
              ...(hasVideoUrl ? { videoUrl: String(body.videoUrl) } : {}),
            }
          : { error: String(body.error ?? "render_failed") }),
      })),
    });
    return c.json({ ok: true });
  });
}
