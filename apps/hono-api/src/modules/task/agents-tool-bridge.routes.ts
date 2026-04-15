import { createRoute, z } from "@hono/zod-openapi";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { AppError } from "../../middleware/error";
import {
  getFlowForOwner,
  getFlowByIdUnsafe,
  mapFlowRowToDto,
  updateFlow,
  updateFlowByIdUnsafe,
  createFlowVersion,
  listFlowsByOwner,
  listFlowsByProject,
} from "../flow/flow.repo";
import {
  PublicFlowGetResponseSchema,
  PublicFlowGraphSchema,
  PublicFlowPatchRequestSchema,
  PublicFlowPatchResponseSchema,
} from "../flow/flow.public.schemas";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { getProjectById, getProjectForOwner } from "../project/project.repo";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { resolveProjectBookDirectoryName } from "./agents-tool-bridge.book-lookup";
import {
  AgentPipelineRunSchema,
  ProjectWorkspaceContextSchema,
} from "../agents/agents.schemas";
import {
  getUserAgentPipelineRunById,
  getNodeContextBundle,
  getUserProjectWorkspaceContext,
  getStoryboardSourceBundle,
  getStoryboardContinuityEvidence,
  getVideoReviewBundle,
  listUserAgentPipelineRuns,
} from "../agents/agents.service";
import { generateImageToCanvas } from "./agents-tool-bridge.generate-image-to-canvas";
import { generateVideoToCanvas } from "./agents-tool-bridge.generate-video-to-canvas";
import {
  WorkflowExecutionEventSchema,
  WorkflowExecutionSchema,
  WorkflowNodeRunSchema,
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
  deriveShotPromptsFromStructuredData,
  normalizeStoryboardStructuredData,
} from "../storyboard/storyboard-structure";
import {
  type StoryboardPlanRecord,
  selectStoryboardPlanReadResult,
} from "./agents-tool-bridge.storyboard-plan";

const AgentsToolExecuteRequestSchema = z.object({
  toolName: z.enum([
    "tapcanvas_project_flows_list",
    "tapcanvas_project_context_get",
    "tapcanvas_books_list",
    "tapcanvas_book_index_get",
    "tapcanvas_book_chapter_get",
    "tapcanvas_book_storyboard_plan_get",
    "tapcanvas_book_storyboard_plan_upsert",
    "tapcanvas_storyboard_source_bundle_get",
    "tapcanvas_storyboard_continuity_get",
    "tapcanvas_node_context_bundle_get",
    "tapcanvas_video_review_bundle_get",
    "tapcanvas_pipeline_runs_list",
    "tapcanvas_pipeline_run_get",
    "tapcanvas_executions_list",
    "tapcanvas_execution_get",
    "tapcanvas_execution_node_runs_get",
    "tapcanvas_execution_events_list",
    "tapcanvas_flow_get",
    "tapcanvas_flow_patch",
    "tapcanvas_image_generate_to_canvas",
    "tapcanvas_video_generate_to_canvas",
  ]),
  args: z.record(z.string(), z.unknown()).default({}),
  canvasProjectId: z.string().min(1).optional(),
  canvasFlowId: z.string().min(1).optional(),
  canvasNodeId: z.string().min(1).optional(),
});

const AgentsToolExecuteResponseSchema = z.object({
  ok: z.literal(true),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

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
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeBookIndexSafe(indexPath: string, next: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.tmp-${Date.now().toString(36)}`;
  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, indexPath);
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
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const planId = readTrimmedString(record.planId);
      const taskId = readTrimmedString(record.taskId);
      if (!planId || !taskId) return null;
      const shotPrompts = Array.isArray(record.shotPrompts)
        ? record.shotPrompts.map((entry) => readTrimmedString(entry)).filter(Boolean).slice(0, 1200)
        : [];
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
      const chapterRaw = Number(record.chapter);
      return {
        planId,
        taskId,
        ...(Number.isFinite(chapterRaw) && chapterRaw > 0 ? { chapter: Math.trunc(chapterRaw) } : null),
        ...(readTrimmedString(record.taskTitle) ? { taskTitle: readTrimmedString(record.taskTitle) } : null),
        mode,
        groupSize: normalizeStoryboardGroupSize(record.groupSize),
        ...(readTrimmedString(record.outputAssetId) ? { outputAssetId: readTrimmedString(record.outputAssetId) } : null),
        ...(readTrimmedString(record.runId) ? { runId: readTrimmedString(record.runId) } : null),
        ...(readTrimmedString(record.storyboardContent) ? { storyboardContent: readTrimmedString(record.storyboardContent) } : null),
        ...(record.storyboardStructured ? { storyboardStructured: record.storyboardStructured } : null),
        shotPrompts,
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

export function registerPublicAgentsToolBridgeRoutes(publicApiRouter: OpenAPIHono<AppEnv>) {
  publicApiRouter.openapi(PublicAgentsToolExecuteRoute, async (c) => {
    const requestUserId = requireUserId(c);
    const devBypass = isDevBypassEnabled(c);
    const body = AgentsToolExecuteRequestSchema.parse(await c.req.json());
    const projectId = String(body.canvasProjectId || "").trim();
    const flowId = String(body.canvasFlowId || "").trim();
    const requestNodeId = String(body.canvasNodeId || "").trim();
    const flowToolRequested =
      body.toolName === "tapcanvas_flow_get" || body.toolName === "tapcanvas_flow_patch";
    const flowScopedToolRequested =
      flowToolRequested ||
      body.toolName === "tapcanvas_image_generate_to_canvas" ||
      body.toolName === "tapcanvas_video_generate_to_canvas" ||
      body.toolName === "tapcanvas_storyboard_source_bundle_get" ||
      body.toolName === "tapcanvas_node_context_bundle_get" ||
      body.toolName === "tapcanvas_video_review_bundle_get";
    if (flowScopedToolRequested && !flowId) {
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
      const chapterRaw = Number(body.args.chapter || 0);
      const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : undefined;
      const context = await getUserProjectWorkspaceContext(c as never, requestUserId, {
        projectId,
        ...(readTrimmedString(body.args.bookId) ? { bookId: readTrimmedString(body.args.bookId) } : {}),
        ...(typeof chapter === "number" ? { chapter } : {}),
        ...(body.args.refresh === true ? { refresh: true } : {}),
      });
      const parsed = ProjectWorkspaceContextSchema.parse(context);
      return c.json({ ok: true, content: JSON.stringify(parsed), data: parsed as Record<string, unknown> });
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

    const requestedBookId = readTrimmedString(body.args.bookId);
    if (
      (
        body.toolName === "tapcanvas_book_index_get" ||
        body.toolName === "tapcanvas_book_chapter_get" ||
        body.toolName === "tapcanvas_book_storyboard_plan_get" ||
        body.toolName === "tapcanvas_book_storyboard_plan_upsert" ||
        body.toolName === "tapcanvas_storyboard_source_bundle_get" ||
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

    if (body.toolName === "tapcanvas_book_chapter_get") {
      const chapterRaw = Number(body.args.chapter || 0);
      const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : 0;
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
      const targetRecord = target as Record<string, unknown>;
      const startOffset = Math.max(0, Number(targetRecord.startOffset || 0) || 0);
      const endOffset = Math.min(raw.length, Number(targetRecord.endOffset || raw.length) || raw.length);
      const response = {
        bookId: readTrimmedString(idx.bookId) || requestedBookId,
        projectId,
        chapter,
        title: readTrimmedString(targetRecord.title) || `第${chapter}章`,
        content: raw.slice(startOffset, Math.max(startOffset, endOffset)).trim(),
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
      const chapterRaw = Number(body.args.chapter || 0);
      const chapter =
        Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : null;
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
      const idx = await readBookIndexSafe(indexPath);
      if (!idx) {
        throw new AppError("Book not found", {
          status: 404,
          code: "book_not_found",
        });
      }
      const taskId = readTrimmedString(body.args.taskId) || `agents-${Date.now().toString(36)}`;
      const chapterRaw = Number(body.args.chapter || 0);
      const chapter =
        Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : null;
      const taskTitle = readTrimmedString(body.args.taskTitle);
      const mode = readTrimmedString(body.args.mode).toLowerCase() === "full" ? "full" : "single";
      const groupSize = normalizeStoryboardGroupSize(body.args.groupSize);
      const storyboardStructured = normalizeStoryboardStructuredData(body.args.storyboardStructured);
      const shotPromptsDirect = Array.isArray(body.args.shotPrompts)
        ? body.args.shotPrompts.map((item) => readTrimmedString(item)).filter(Boolean).slice(0, 1200)
        : [];
      const shotPrompts = (
        shotPromptsDirect.length ? shotPromptsDirect : deriveShotPromptsFromStructuredData(storyboardStructured)
      ).slice(0, 1200);
      if (!shotPrompts.length) {
        throw new AppError("shotPrompts is required", {
          status: 400,
          code: "storyboard_plan_shot_prompts_required",
        });
      }
      const storyboardContent = readTrimmedString(body.args.storyboardContent);
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
      const assets =
        idx.assets && typeof idx.assets === "object" && !Array.isArray(idx.assets)
          ? { ...(idx.assets as Record<string, unknown>) }
          : {};
      const plans = normalizeStoryboardPlans(assets.storyboardPlans);
      const planIdInput = readTrimmedString(body.args.planId);
      const existingIndex = plans.findIndex((item) => item.planId === planIdInput || item.taskId === taskId);
      const existing = existingIndex >= 0 ? plans[existingIndex] : null;
      const planId = planIdInput || existing?.planId || `plan-${taskId}-${Date.now().toString(36)}`;
      const nowIso = new Date().toISOString();
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
            ...(storyboardStructured ? { storyboardStructured } : null),
            shotPrompts,
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
            ...(storyboardStructured ? { storyboardStructured } : existing?.storyboardStructured ? { storyboardStructured: existing.storyboardStructured } : null),
            shotPrompts: shotPrompts.length ? shotPrompts : existing?.shotPrompts || [],
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
        ? plans.filter((item) => item.taskId !== taskId && item.planId !== planId)
        : [...plans];
      if (overwriteMode === "merge" && existingIndex >= 0) {
        mergedPlans[existingIndex] = nextPlan;
      } else {
        mergedPlans.push(nextPlan);
      }
      assets.storyboardPlans = mergedPlans
        .sort((left, right) => String(left.taskId || "").localeCompare(String(right.taskId || "")))
        .slice(-200);
      if (overwriteMode === "replace" && resetChapterChunks) {
        const chunks = Array.isArray(assets.storyboardChunks) ? assets.storyboardChunks : [];
        assets.storyboardChunks = chunks.filter((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          return readTrimmedString((item as Record<string, unknown>).taskId) !== taskId;
        });
      }
      const next = {
        ...idx,
        assets,
        updatedAt: nowIso,
      };
      await writeBookIndexSafe(indexPath, next);
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
          storyboardPlans: assets.storyboardPlans,
        },
      });
    }

    if (body.toolName === "tapcanvas_storyboard_source_bundle_get") {
      const chapterRaw = Number(body.args.chapter || 0);
      const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : undefined;
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
      const bundle = await getNodeContextBundle({
        c: c as never,
        ownerId: projectOwnerUserId,
        projectId,
        flowId,
        nodeId,
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
      const bundle = await getVideoReviewBundle({
        c: c as never,
        ownerId: projectOwnerUserId,
        projectId,
        flowId,
        nodeId,
      });
      return c.json({
        ok: true,
        content: JSON.stringify(bundle),
        data: bundle as unknown as Record<string, unknown>,
      });
    }

    if (body.toolName === "tapcanvas_storyboard_continuity_get") {
      const chapterRaw = Number(body.args.chapter || 0);
      const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : 0;
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
      const shotPrompts = Array.isArray(body.args.shotPrompts)
        ? body.args.shotPrompts.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const evidence = await getStoryboardContinuityEvidence(
        {
          projectId,
          bookId: requestedBookId,
          chapter,
          groupSize,
          chunkIndex,
          ...(shotPrompts.length ? { shotPrompts } : {}),
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

    const row = devBypass
      ? await getFlowByIdUnsafe(c.env.DB, flowId)
      : await getFlowForOwner(c.env.DB, flowId, requestUserId);
    if (!row) {
      throw new AppError("Flow not found", {
        status: 404,
        code: "flow_not_found",
      });
    }

    if (body.toolName === "tapcanvas_executions_list") {
      const limitRaw = Number(body.args.limit || 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
      const rows = await listExecutionsForOwnerFlow(c.env.DB, {
        ownerId: requestUserId,
        flowId,
        limit,
      });
      const parsed = rows.map((item) => WorkflowExecutionSchema.parse(mapExecutionRow(item)));
      return c.json({ ok: true, content: JSON.stringify(parsed), data: { items: parsed } });
    }

    if (body.toolName === "tapcanvas_execution_get") {
      const executionId = readTrimmedString(body.args.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      const execution = await getExecutionForOwner(c.env.DB, executionId, requestUserId);
      if (!execution) {
        throw new AppError("Execution not found", {
          status: 404,
          code: "execution_not_found",
        });
      }
      const parsed = WorkflowExecutionSchema.parse(mapExecutionRow(execution));
      return c.json({ ok: true, content: JSON.stringify(parsed), data: parsed as Record<string, unknown> });
    }

    if (body.toolName === "tapcanvas_execution_node_runs_get") {
      const executionId = readTrimmedString(body.args.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
      const rows = await listNodeRunsForExecutionOwner(c.env.DB, {
        ownerId: requestUserId,
        executionId,
      });
      const parsed = rows.map((item) => WorkflowNodeRunSchema.parse(mapNodeRunRow(item)));
      return c.json({ ok: true, content: JSON.stringify(parsed), data: { items: parsed } });
    }

    if (body.toolName === "tapcanvas_execution_events_list") {
      const executionId = readTrimmedString(body.args.executionId);
      if (!executionId) {
        throw new AppError("executionId is required", {
          status: 400,
          code: "execution_id_required",
        });
      }
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
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(response),
          data: response as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_image_generate_to_canvas") {
      const generated = await generateImageToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(generated),
          data: generated as unknown as Record<string, unknown>,
        }),
      );
    }

    if (body.toolName === "tapcanvas_video_generate_to_canvas") {
      const generated = await generateVideoToCanvas({
        c: c as never,
        requestUserId,
        devBypass,
        flowId,
        row,
        bodyArgs: body.args,
      });
      return c.json(
        AgentsToolExecuteResponseSchema.parse({
          ok: true,
          content: JSON.stringify(generated),
          data: generated as unknown as Record<string, unknown>,
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
    await createFlowVersion(c.env.DB, {
      id: crypto.randomUUID(),
      flowId: updated.id,
      name: updated.name,
      data: updated.data,
      userId: versionUserId,
      nowIso,
    });
    const response = PublicFlowPatchResponseSchema.parse({
      ok: true,
      flowId: updated.id,
      updatedAt: updated.updated_at,
      stats: applied.stats,
      data: nextParsed.data,
    });
    return c.json(
      AgentsToolExecuteResponseSchema.parse({
        ok: true,
        content: JSON.stringify({
          ok: true,
          flowId: response.flowId,
          updatedAt: response.updatedAt,
          stats: response.stats,
        }),
        data: response as unknown as Record<string, unknown>,
      }),
    );
  });
}
