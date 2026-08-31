import type { OpenAPIHono } from "@hono/zod-openapi";

import { AppError } from "../../middleware/error";
import type { AppContext, AppEnv } from "../../types";
import { upsertUserFlow } from "../flow/flow.service";
import { upsertProjectForUser } from "../project/project.service";
import { cloneProjectForUser } from "../project/project.service";
import {
  getChapterByIdForOwner,
  listChaptersByProjectForOwner,
} from "../chapter/chapter.repo";
import { updateChapterNarrativeForUser } from "../chapter/chapter.service";
import {
  getExecutionForOwner,
  listNodeRunsForExecutionOwner,
  mapExecutionRow,
  mapNodeRunRow,
} from "../execution/execution.repo";
import { cancelWorkflowExecutionForOwner } from "../execution/execution.cancel-service";
import {
  resumeWorkflowExecution,
  WorkflowResumeError,
} from "../execution/execution.resume-service";
import { assertExecutionMatchesEvalWorkspace } from "./agents-eval-workspace-scope";
import { readVerifiedBookChapterSource } from "../agents/story-facts.source";
import { resolveProjectBookDirectoryPath } from "./agents-tool-bridge.book-lookup";
import { equipStandaloneEvalWorkflowCapability } from "../agents/capability-bay.service";
import {
  buildWorkflowProjectContextForRun,
  createRuntimeWorkflowAssetResolver,
} from "../execution/execution.project-context-runtime";
import { isStableEvalAssetUrl } from "./agents-eval-workspace-readiness";

type EvalRequiredReadyAssetRole = Readonly<{
  kind: "character" | "scene" | "prop" | "vfx" | "palette" | "composition";
  canonicalName: string;
}>;

const EVAL_READY_ASSET_KINDS = new Set<EvalRequiredReadyAssetRole["kind"]>([
  "character",
  "scene",
  "prop",
  "vfx",
  "palette",
  "composition",
]);

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readBoundedText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw new AppError(`${field} is required and must not exceed ${maxLength} characters`, {
      status: 400,
      code: "agents_eval_workspace_invalid",
      details: { field, maxLength },
    });
  }
  return text;
}

function readOptionalBoundedText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return readBoundedText(value, field, maxLength);
}

function readRequiredReadyAssetRoles(value: unknown): readonly EvalRequiredReadyAssetRole[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new AppError("sourceWorkspace.requiredReadyAssetRoles must be an array with at most 64 entries", {
      status: 400,
      code: "agents_eval_workspace_invalid",
    });
  }
  const roles = value.map((candidate, index): EvalRequiredReadyAssetRole => {
    const record = readRecord(candidate);
    const kind = readBoundedText(record.kind, `sourceWorkspace.requiredReadyAssetRoles[${index}].kind`, 40);
    const canonicalName = readBoundedText(
      record.canonicalName,
      `sourceWorkspace.requiredReadyAssetRoles[${index}].canonicalName`,
      240,
    );
    if (!EVAL_READY_ASSET_KINDS.has(kind as EvalRequiredReadyAssetRole["kind"])) {
      throw new AppError(`Unsupported required ready asset kind: ${kind}`, {
        status: 400,
        code: "agents_eval_workspace_invalid",
        details: { index, kind },
      });
    }
    return { kind: kind as EvalRequiredReadyAssetRole["kind"], canonicalName };
  });
  const identities = roles.map((role) => `${role.kind}://${role.canonicalName}`);
  if (new Set(identities).size !== identities.length) {
    throw new AppError("sourceWorkspace.requiredReadyAssetRoles contains duplicate identities", {
      status: 400,
      code: "agents_eval_workspace_invalid",
    });
  }
  return roles;
}

async function assertEvalReadyAssetRoles(input: Readonly<{
  c: AppContext;
  userId: string;
  projectId: string;
  chapterId: string;
  roles: readonly EvalRequiredReadyAssetRole[];
  phase: "source" | "clone";
}>): Promise<void> {
  if (input.roles.length === 0) return;
  const runContext = await buildWorkflowProjectContextForRun({
    c: input.c,
    ownerId: input.userId,
    projectId: input.projectId,
    canvasId: `chapter:${input.chapterId}`,
    chapterId: input.chapterId,
  });
  const resolver = createRuntimeWorkflowAssetResolver({
    c: input.c,
    ownerId: input.userId,
    context: runContext.projectContext,
  });
  const missing: Array<Readonly<{ identity: string; candidateAssetIds: readonly string[] }>> = [];
  for (const role of input.roles) {
    const identity = `${role.kind}://${role.canonicalName}`;
    const candidates = runContext.projectContext.assetSnapshot.filter((asset) => (
      asset.kind === role.kind
      && asset.canonicalName === role.canonicalName
      && asset.mediaKind === "image"
      && asset.state === "ready"
      && asset.productionEligible
    ));
    let resolved = false;
    for (const candidate of candidates) {
      try {
        const resource = await resolver.resolveAssetResource(candidate.assetId, "image");
        if (resource.mediaKind === "image" && isStableEvalAssetUrl(resource.url)) {
          resolved = true;
          break;
        }
      } catch {
        // Keep checking other exact-identity candidates. The failure is surfaced
        // below with the frozen candidate IDs; it is never treated as readiness.
      }
    }
    if (!resolved) {
      missing.push({ identity, candidateAssetIds: candidates.map((candidate) => candidate.assetId) });
    }
  }
  if (missing.length > 0) {
    throw new AppError(`Eval ${input.phase} workspace does not satisfy the declared ready-image asset contract`, {
      status: 409,
      code: "agents_eval_asset_readiness_precondition_failed",
      details: {
        phase: input.phase,
        projectId: input.projectId,
        chapterId: input.chapterId,
        missing,
      },
    });
  }
}

export function registerPublicAgentsEvalWorkspaceRoutes(publicApiRouter: OpenAPIHono<AppEnv>): void {
  publicApiRouter.post("/agents/evals/workspaces", async (c) => {
    const userId = c.get("userId");
    const scopes = c.get("agentsCliScopes") ?? [];
    if (!userId || !scopes.includes("agents:chat")) {
      throw new AppError("Agent eval workspace requires an authenticated agents-cli SSO grant", {
        status: 403,
        code: "agents_eval_workspace_sso_required",
      });
    }
    const body = readRecord(await c.req.json().catch(() => ({})));
    const logicalTaskId = readBoundedText(body.logicalTaskId, "logicalTaskId", 240);
    const title = readBoundedText(body.title, "title", 120);
    const sourceText = readBoundedText(body.sourceText, "sourceText", 20_000);
    const requestedWorkflowExecutionVariant = body.requestedWorkflowExecutionVariant === "full_video" || body.requestedWorkflowExecutionVariant === "first_video"
      ? body.requestedWorkflowExecutionVariant
      : undefined;
    if (body.requestedWorkflowExecutionVariant !== undefined && !requestedWorkflowExecutionVariant) {
      throw new AppError("requestedWorkflowExecutionVariant must be full_video or first_video", {
        status: 400,
        code: "agents_eval_workflow_variant_invalid",
      });
    }
    const sourceWorkspace = readRecord(body.sourceWorkspace);
    if (Object.keys(sourceWorkspace).length > 0) {
      const sourceProjectId = readBoundedText(sourceWorkspace.projectId, "sourceWorkspace.projectId", 240);
      const sourceBookId = readBoundedText(sourceWorkspace.bookId, "sourceWorkspace.bookId", 240);
      const sourceChapterId = readBoundedText(sourceWorkspace.chapterId, "sourceWorkspace.chapterId", 240);
      const requiredReadyAssetRoles = readRequiredReadyAssetRoles(sourceWorkspace.requiredReadyAssetRoles);
      const sourceChapter = await getChapterByIdForOwner({
        db: c.env.DB,
        chapterId: sourceChapterId,
        ownerId: userId,
      });
      if (
        !sourceChapter ||
        sourceChapter.project_id !== sourceProjectId ||
        sourceChapter.source_book_id !== sourceBookId
      ) {
        throw new AppError("Eval source chapter does not match the authenticated project and uploaded book", {
          status: 409,
          code: "agents_eval_source_chapter_mismatch",
          details: { sourceProjectId, sourceBookId, sourceChapterId },
        });
      }
      const sourceBookDirectory = await resolveProjectBookDirectoryPath({
        projectId: sourceProjectId,
        userId,
        requestedBookId: sourceBookId,
      });
      if (!sourceBookDirectory) {
        throw new AppError("Eval source uploaded book is not available in the authenticated project", {
          status: 404,
          code: "agents_eval_source_book_not_found",
          details: { sourceProjectId, sourceBookId, sourceChapterId },
        });
      }
      const sourceBookChapter = sourceChapter.source_book_chapter ?? sourceChapter.chapter_index;
      await assertEvalReadyAssetRoles({
        c: c as unknown as AppContext,
        userId,
        projectId: sourceProjectId,
        chapterId: sourceChapterId,
        roles: requiredReadyAssetRoles,
        phase: "source",
      });
      const project = await cloneProjectForUser(
        c as unknown as AppContext,
        userId,
        sourceProjectId,
        `Agent 回归 · ${title}`,
      );
      const clonedChapters = await listChaptersByProjectForOwner({
        db: c.env.DB,
        projectId: project.id,
        ownerId: userId,
      });
      const chapter = clonedChapters.find((candidate) =>
        candidate.source_book_id === sourceBookId &&
        candidate.source_book_chapter === sourceChapter.source_book_chapter &&
        candidate.chapter_index === sourceChapter.chapter_index
      );
      if (!chapter) {
        throw new AppError("Cloned eval workspace is missing the selected uploaded-book chapter", {
          status: 500,
          code: "agents_eval_cloned_chapter_missing",
          details: { projectId: project.id, sourceBookId, sourceChapterId },
        });
      }
      await assertEvalReadyAssetRoles({
        c: c as unknown as AppContext,
        userId,
        projectId: project.id,
        chapterId: chapter.id,
        roles: requiredReadyAssetRoles,
        phase: "clone",
      });
      const clonedBookDirectory = await resolveProjectBookDirectoryPath({
        projectId: project.id,
        userId,
        requestedBookId: sourceBookId,
      });
      if (!clonedBookDirectory) {
        throw new AppError("Cloned eval workspace is missing the selected uploaded book", {
          status: 500,
          code: "agents_eval_cloned_book_missing",
          details: { projectId: project.id, sourceProjectId, sourceBookId },
        });
      }
      const verifiedChapterSource = await readVerifiedBookChapterSource({
        bookDir: clonedBookDirectory,
        projectId: project.id,
        bookId: sourceBookId,
        chapter: sourceBookChapter,
      });
      if (!verifiedChapterSource.content.trim()) {
        throw new AppError("Eval source uploaded-book chapter content is empty", {
          status: 409,
          code: "agents_eval_source_chapter_empty",
          details: { sourceProjectId, sourceBookId, sourceChapterId, sourceBookChapter },
        });
      }
      await updateChapterNarrativeForUser(
        c as unknown as AppContext,
        userId,
        chapter.id,
        {
          title: sourceChapter.title,
          summary: verifiedChapterSource.content,
        },
      );
      const flow = await upsertUserFlow(c, userId, {
        name: `${title} · ${logicalTaskId.slice(-48)}`,
        data: {
          nodes: [{
            id: "eval-book-chapter-source",
            type: "taskNode",
            position: { x: 0, y: 0 },
            data: {
              kind: "text",
              label: sourceChapter.title,
              content: verifiedChapterSource.content,
              status: "ready",
              workflowCanonicalSource: true,
              sourceKind: "uploaded_book",
              sourceProjectId,
              sourceBookId,
              sourceBookChapter,
              sourceChapterId,
              sourceFileName: verifiedChapterSource.fileName,
              sourceContentSha256: verifiedChapterSource.contentSha256,
            },
          }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        projectId: project.id,
        ownerType: "project",
        ownerId: project.id,
        source: "agent",
      });
      const equippedWorkflow = requestedWorkflowExecutionVariant
        ? await equipStandaloneEvalWorkflowCapability(c as unknown as AppContext, userId, project.id, requestedWorkflowExecutionVariant)
        : undefined;
      return c.json({
        ok: true as const,
        projectId: project.id,
        flowId: flow.id,
        bookId: sourceBookId,
        chapterId: chapter.id,
        ...(equippedWorkflow ? { equippedWorkflow } : {}),
        logicalTaskId,
        sourceWorkspace: {
          projectId: sourceProjectId,
          bookId: sourceBookId,
          chapterId: sourceChapterId,
        },
        sourceEvidence: {
          kind: "uploaded_book_chapter",
          chapter: sourceBookChapter,
          contentChars: verifiedChapterSource.content.length,
          contentSha256: verifiedChapterSource.contentSha256,
          fileName: verifiedChapterSource.fileName,
        },
      }, 201);
    }
    const project = await upsertProjectForUser(c, userId, {
      name: `Agent 回归 · ${title}`,
    });
    const flow = await upsertUserFlow(c, userId, {
      name: `${title} · ${logicalTaskId.slice(-48)}`,
      data: {
        nodes: [{
          id: "eval-input",
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: {
            kind: "text",
            label: "测试输入",
            content: sourceText,
            status: "ready",
            workflowCanonicalSource: true,
          },
        }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      projectId: project.id,
      ownerType: "project",
      ownerId: project.id,
      source: "agent",
    });
    const equippedWorkflow = requestedWorkflowExecutionVariant
      ? await equipStandaloneEvalWorkflowCapability(c as unknown as AppContext, userId, project.id, requestedWorkflowExecutionVariant)
      : undefined;
    return c.json({
      ok: true as const,
      projectId: project.id,
      flowId: flow.id,
      logicalTaskId,
      ...(equippedWorkflow ? { equippedWorkflow } : {}),
    }, 201);
  });

  publicApiRouter.get("/agents/evals/executions/:executionId", async (c) => {
    const userId = c.get("userId");
    const scopes = c.get("agentsCliScopes") ?? [];
    if (!userId || !scopes.includes("agents:chat")) {
      throw new AppError("Agent eval execution inspection requires an authenticated agents-cli SSO grant", {
        status: 403,
        code: "agents_eval_execution_sso_required",
      });
    }
    const executionId = readBoundedText(c.req.param("executionId"), "executionId", 240);
    const workspace = {
      projectId: readBoundedText(c.req.query("projectId"), "projectId", 240),
      flowId: readBoundedText(c.req.query("flowId"), "flowId", 240),
      chapterId: readOptionalBoundedText(c.req.query("chapterId"), "chapterId", 240),
    };
    const execution = await getExecutionForOwner(c.env.DB, executionId, userId);
    if (!execution) {
      throw new AppError("Agent eval execution not found", {
        status: 404,
        code: "agents_eval_execution_not_found",
      });
    }
    assertExecutionMatchesEvalWorkspace(execution, workspace);
    const nodeRuns = await listNodeRunsForExecutionOwner(c.env.DB, { ownerId: userId, executionId });
    return c.json({
      ok: true as const,
      execution: mapExecutionRow(execution),
      nodeRuns: nodeRuns.map(mapNodeRunRow),
    });
  });

  publicApiRouter.post("/agents/evals/executions/:executionId/cancel", async (c) => {
    const userId = c.get("userId");
    const scopes = c.get("agentsCliScopes") ?? [];
    if (!userId || !scopes.includes("agents:chat")) {
      throw new AppError("Agent eval execution cancellation requires an authenticated agents-cli SSO grant", {
        status: 403,
        code: "agents_eval_execution_sso_required",
      });
    }
    const executionId = readBoundedText(c.req.param("executionId"), "executionId", 240);
    const body = readRecord(await c.req.json().catch(() => ({})));
    const workspace = {
      projectId: readBoundedText(body.projectId, "projectId", 240),
      flowId: readBoundedText(body.flowId, "flowId", 240),
      chapterId: readOptionalBoundedText(body.chapterId, "chapterId", 240),
    };
    const execution = await getExecutionForOwner(c.env.DB, executionId, userId);
    if (!execution) {
      throw new AppError("Agent eval execution not found", {
        status: 404,
        code: "agents_eval_execution_not_found",
      });
    }
    assertExecutionMatchesEvalWorkspace(execution, workspace);
    if (execution.status !== "queued" && execution.status !== "running") {
      throw new AppError(`Agent eval execution is already terminal: ${execution.status}`, {
        status: 409,
        code: "agents_eval_execution_already_terminal",
      });
    }
    const result = await cancelWorkflowExecutionForOwner({
      context: c as unknown as AppContext,
      userId,
      executionId,
      actor: { reasonCode: "user_requested", actorType: "owner_eval", actorId: userId },
    });
    if (!result) {
      throw new AppError("Agent eval execution not found", {
        status: 404,
        code: "agents_eval_execution_not_found",
      });
    }
    return c.json({ ok: true as const, ...result });
  });

  publicApiRouter.post("/agents/evals/executions/:executionId/resume", async (c) => {
    const userId = c.get("userId");
    const scopes = c.get("agentsCliScopes") ?? [];
    if (!userId || !scopes.includes("agents:chat")) {
      throw new AppError("Agent eval execution recovery requires an authenticated agents-cli SSO grant", {
        status: 403,
        code: "agents_eval_execution_sso_required",
      });
    }
    const executionId = readBoundedText(c.req.param("executionId"), "executionId", 240);
    const body = readRecord(await c.req.json().catch(() => ({})));
    const workspace = {
      projectId: readBoundedText(body.projectId, "projectId", 240),
      flowId: readBoundedText(body.flowId, "flowId", 240),
      chapterId: readOptionalBoundedText(body.chapterId, "chapterId", 240),
    };
    const sourceExecution = await getExecutionForOwner(c.env.DB, executionId, userId);
    if (!sourceExecution) {
      throw new AppError("Agent eval execution not found", {
        status: 404,
        code: "agents_eval_execution_not_found",
      });
    }
    assertExecutionMatchesEvalWorkspace(sourceExecution, workspace);
    try {
      const execution = await resumeWorkflowExecution({
        context: c as unknown as AppContext,
        env: c.env,
        ownerId: userId,
        sourceExecutionId: executionId,
        trigger: "agent",
      });
      return c.json({ ok: true as const, execution }, 201);
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
  });
}
