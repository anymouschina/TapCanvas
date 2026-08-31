import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { PublicFlowGraphSchema } from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  getChapterCanvasFlow,
  putChapterCanvasFlow,
  CanvasFlowRevisionConflictError,
} from "../chapter/chapter.canvas-flow.service";
import { broadcastPatch } from "../chapter/canvas-sse.manager";
import {
  buildMediaVersionArchiveNode,
  isMediaVersionReplacement,
} from "./node-version-archive";
import type { FlowRow } from "../flow/flow.repo";
import {
  dedupeCharacterCardCreatesAgainstCanvas,
  isCharacterCardNameDedupeEnabled,
  resolveCharacterCardFinalWriteTarget,
} from "./agents-tool-bridge.chapter-canvas-dedupe";
import { consolidateSuccessfulPropStatePatch } from "./prop-state-canvas-consolidation";
import {
  DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS,
  waitForCanvasRevisionRetry,
  withChapterCanvasWriteQueue,
} from "./chapter-canvas-write-queue";

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * Load a chapter's canvas flow (chapters.canvas_flow) as a synthetic FlowRow so
 * the generate-*-to-canvas group-config readers (which expect a FlowRow and call
 * mapFlowRowToDto) can read the chapter graph unchanged. Only `data` carries
 * meaning here; the flows-table write path is bypassed in chapter mode.
 */
export async function loadChapterCanvasAsFlowRow(
  c: AppContext,
  userId: string,
  chapterId: string,
  projectId: string,
): Promise<FlowRow> {
  const { flow } = await getChapterCanvasFlow(c, userId, chapterId);
  const chapter = await c.env.DB.chapters.findFirst({
    where: { id: chapterId },
    select: { project_id: true },
  });
  if (!chapter || chapter.project_id !== projectId) {
    throw new AppError("Chapter canvas is not available in the requested project", {
      status: 404,
      code: "chapter_canvas_project_mismatch",
      details: { chapterId, projectId },
    });
  }
  const nowIso = new Date().toISOString();
  return {
    id: chapterId,
    name: "chapter-canvas",
    data: JSON.stringify(flow ?? { nodes: [], edges: [] }),
    owner_id: userId,
    project_id: projectId || null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/**
 * Write a freshly-built result node into a chapter's canvas flow
 * (`chapters.canvas_flow` JSON column, addressed by chapterId, guarded by an
 * optimistic `canvas_flow_revision`). This is the chapter-mode equivalent of the
 * flows-table write inside generate-*-to-canvas: agents-generated nodes triggered
 * from inside a chapter canvas must land in that chapter, NOT the project root
 * flow. Retries on revision conflict (re-read + re-apply) and broadcasts the new
 * node to the chapter SSE room so the open chapter canvas reflects it live.
 */
export async function writeFinalNodeToChapterCanvas(input: {
  c: AppContext;
  userId: string;
  chapterId: string;
  nodeId: string;
  finalNode: Record<string, unknown>;
  finalNodeData: Record<string, unknown>;
  conflictTimeoutMs?: number;
}): Promise<{ stats: Record<string, number> }> {
  return withChapterCanvasWriteQueue(input.chapterId, async () => {
    const conflictTimeoutMs = input.conflictTimeoutMs
      ?? DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS;
    const conflictDeadlineMs = Date.now() + conflictTimeoutMs;

    for (let attempt = 0; ; attempt += 1) {
    const { revision, flow } = await getChapterCanvasFlow(
      input.c,
      input.userId,
      input.chapterId,
    );
    const current = sanitizeFlowDataForStorage(flow ?? { nodes: [], edges: [] });
    // Upsert: if a node with this id already exists in the chapter canvas
    // (e.g. a pre-created placeholder), patch it in place; otherwise create it.
    // This also avoids the create-on-existing 409 that bit the group workflow.
    const existingNodes = toRecordArray((current as { nodes?: unknown }).nodes);
    let nodeId = input.nodeId;
    let nodeAlreadyExists = existingNodes.some(
      (n) => String((n as { id?: unknown }).id ?? "") === nodeId,
    );
    // 角色卡按名去重：若该 id 在本章不存在、但已有不同 id 的同身份角色卡，把生成结果写到
    // 既有卡上刷新，而不是新建一张同名副本（治重名根因；状态版身份不同，不会误折叠）。
    if (!nodeAlreadyExists) {
      const { redirectToId } = resolveCharacterCardFinalWriteTarget({
        currentNodes: existingNodes,
        finalNodeData: input.finalNodeData,
        finalNodeId: nodeId,
        enabled: isCharacterCardNameDedupeEnabled(),
      });
      if (redirectToId) {
        console.warn(
          `[character-card-dedupe] chapter=${input.chapterId} final-write redirect ${nodeId} → existing=${redirectToId}`,
        );
        nodeId = redirectToId;
        nodeAlreadyExists = true;
      }
    }
    // 【重写留痕·2026-07-07 用户拍板】重写/重画也是新增节点，不许无痕替换：既有节点的
    // 成片/成图要被**不同**新媒体覆盖时，旧版先快照成存档节点（同一 patch 原子落盘）。
    // 存档节点剥掉全部绑定字段（archived* 前缀），绝不会被按名绑定/幂等槽位/concat 误捡。
    let versionArchiveNode: Record<string, unknown> | null = null;
    if (nodeAlreadyExists) {
      const oldNode = existingNodes.find(
        (n) => String((n as { id?: unknown }).id ?? "") === nodeId,
      ) as { data?: Record<string, unknown> } | undefined;
      const oldData = oldNode?.data ?? {};
      if (isMediaVersionReplacement(oldData, input.finalNodeData)) {
        versionArchiveNode =
          buildMediaVersionArchiveNode({ origNodeId: nodeId, origData: oldData, nowMs: Date.now() })
            ?.node ?? null;
      }
    }
    const basePatch = (nodeAlreadyExists
      ? {
          patchNodeData: [{ id: nodeId, data: input.finalNodeData }],
          allowOverwrite: true,
          ...(versionArchiveNode ? { createNodes: [versionArchiveNode] } : {}),
        }
      : { createNodes: [input.finalNode] }) as Parameters<
      typeof applyPublicFlowGraphPatch
    >[0]["patch"];
    const currentEdges = toRecordArray((current as { edges?: unknown }).edges);
    const propStateConsolidation = consolidateSuccessfulPropStatePatch({
      currentNodes: existingNodes,
      currentEdges,
      patch: basePatch as Record<string, unknown>,
    });
    for (const replacement of propStateConsolidation.replacements) {
      console.warn(
        `[prop-state-consolidation] chapter=${input.chapterId} canonical=${replacement.canonicalName} state=${replacement.stateNodeId} removed=${replacement.removedNodeIds.join(",")}`,
      );
    }
    const effectivePatch = propStateConsolidation.patch as Parameters<
      typeof applyPublicFlowGraphPatch
    >[0]["patch"];
    const applied = applyPublicFlowGraphPatch({ current, patch: effectivePatch });
    const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
    const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
    if (!nextParsed.success) {
      throw new AppError("Chapter canvas flow patch produced invalid data", {
        status: 500,
        code: "chapter_canvas_flow_invalid",
        details: { issues: nextParsed.error.issues },
      });
    }
    // chapters.canvas_flow stores strictly { nodes, edges } — strip any extra
    // top-level keys sanitize may have produced.
    const nextFlow = {
      nodes: toRecordArray((sanitizedNext as { nodes?: unknown }).nodes),
      edges: toRecordArray((sanitizedNext as { edges?: unknown }).edges),
    };

    let savedRevision: number;
    let savedFlow = nextFlow;
    try {
      const saveResult = await putChapterCanvasFlow(input.c, input.userId, input.chapterId, {
        expectedRevision: revision,
        flow: nextFlow,
        // agent 回灌：撞版本走 CAS 取并集重试（reconcile 并回最新节点），不硬挡 409。
        source: "agent",
      });
      savedRevision = saveResult.revision;
      savedFlow = saveResult.authoritativeFlow ?? nextFlow;
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
        // Another isolate bumped the durable revision. Re-read the latest
        // graph and rebuild the complete mutation on the next iteration.
        continue;
      }
      throw err;
    }

    const patchRecord = effectivePatch as Record<string, unknown>;
    const nodeMap = new Map(savedFlow.nodes.map((node) => [String(node.id ?? ""), node]));
    const edgeMap = new Map(savedFlow.edges.map((edge) => [String(edge.id ?? ""), edge]));
    const touchedNodeIds = [
      ...toRecordArray(patchRecord.createNodes).map((node) => String(node.id ?? "")),
      ...toRecordArray(patchRecord.patchNodeData).map((item) => String(item.id ?? "")),
    ].filter(Boolean);
    const upsertNodes = touchedNodeIds
      .map((id) => nodeMap.get(id))
      .filter(Boolean) as Record<string, unknown>[];
    const upsertEdges = applied.createdEdgeIds
      .map((id) => edgeMap.get(id))
      .filter(Boolean) as Record<string, unknown>[];
    const syncPatch: Record<string, unknown> = { revision: savedRevision };
    if (upsertNodes.length) syncPatch.upsertNodes = upsertNodes;
    if (upsertEdges.length) syncPatch.upsertEdges = upsertEdges;
    if (Array.isArray(patchRecord.deleteNodeIds) && patchRecord.deleteNodeIds.length) {
      syncPatch.removeNodeIds = patchRecord.deleteNodeIds;
    }
    if (Array.isArray(patchRecord.deleteEdgeIds) && patchRecord.deleteEdgeIds.length) {
      syncPatch.removeEdgeIds = patchRecord.deleteEdgeIds;
    }
    if (Object.keys(syncPatch).length) {
      broadcastPatch(input.chapterId, syncPatch, "");
    }
    return { stats: applied.stats as unknown as Record<string, number> };
    }
  });
}

/**
 * Apply a full PublicFlowPatch (createNodes/patchNodeData/edges/deletes) to a
 * chapter's canvas flow. Chapter-mode equivalent of the flows-table flow_patch
 * executor: without this, a chapter-session flow_patch silently writes the
 * project root flow while orchestrate reads chapters.canvas_flow — the agent
 * patches nodes the gates never see. Optimistic-revision retry + SSE broadcast
 * to the chapter room, mirroring writeFinalNodeToChapterCanvas.
 */
export async function applyFlowPatchToChapterCanvas(input: {
  c: AppContext;
  userId: string;
  chapterId: string;
  patch: Parameters<typeof applyPublicFlowGraphPatch>[0]["patch"];
  conflictTimeoutMs?: number;
}): Promise<{
  stats: Record<string, number>;
  createdNodeIds: string[];
  createdEdgeIds: string[];
  data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  updatedAt: string;
}> {
  return withChapterCanvasWriteQueue(input.chapterId, async () => {
    const conflictTimeoutMs = input.conflictTimeoutMs
      ?? DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS;
    const conflictDeadlineMs = Date.now() + conflictTimeoutMs;

    for (let attempt = 0; ; attempt += 1) {
    const { revision, flow } = await getChapterCanvasFlow(
      input.c,
      input.userId,
      input.chapterId,
    );
    const current = sanitizeFlowDataForStorage(flow ?? { nodes: [], edges: [] });
    // 角色卡按名去重：同名角色卡的重复创建折叠到既有卡上（首卡为准），引用一并改指。
    // 用本轮最新读到的 current.nodes 计算，并发写者已提交的卡也会被看见、被折叠。
    const currentNodes = toRecordArray((current as { nodes?: unknown }).nodes);
    const currentEdges = toRecordArray((current as { edges?: unknown }).edges);
    const propStateConsolidation = consolidateSuccessfulPropStatePatch({
      currentNodes,
      currentEdges,
      patch: input.patch as Record<string, unknown>,
    });
    for (const replacement of propStateConsolidation.replacements) {
      console.warn(
        `[prop-state-consolidation] chapter=${input.chapterId} canonical=${replacement.canonicalName} state=${replacement.stateNodeId} removed=${replacement.removedNodeIds.join(",")}`,
      );
    }
    const dedupe = dedupeCharacterCardCreatesAgainstCanvas({
      currentNodes,
      patch: propStateConsolidation.patch,
    });
    if (dedupe.collapsed.length) {
      for (const c of dedupe.collapsed) {
        console.warn(
          `[character-card-dedupe] chapter=${input.chapterId} collapsed create=${c.fromId || "(no-id)"} → existing=${c.toId} identity=${c.identity}`,
        );
      }
    }
    const effectivePatch = dedupe.patch as Parameters<
      typeof applyPublicFlowGraphPatch
    >[0]["patch"];
    const applied = applyPublicFlowGraphPatch({ current, patch: effectivePatch });
    const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
    const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
    if (!nextParsed.success) {
      throw new AppError("Chapter canvas flow patch produced invalid data", {
        status: 500,
        code: "chapter_canvas_flow_invalid",
        details: { issues: nextParsed.error.issues },
      });
    }
    const nextFlow = {
      nodes: toRecordArray((sanitizedNext as { nodes?: unknown }).nodes),
      edges: toRecordArray((sanitizedNext as { edges?: unknown }).edges),
    };

    let savedRevision: number;
    let savedFlow = nextFlow;
    try {
      const saveResult = await putChapterCanvasFlow(input.c, input.userId, input.chapterId, {
        expectedRevision: revision,
        flow: nextFlow,
        // agent 回灌：撞版本走 CAS 取并集重试（reconcile 并回最新节点），不硬挡 409。
        source: "agent",
      });
      savedRevision = saveResult.revision;
      savedFlow = saveResult.authoritativeFlow ?? nextFlow;
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

    // 用去重后的 patch 计算广播：被折叠的创建已不在其中、改指的 patchNodeData 指向既有卡，
    // 因此广播只会 upsert 既有卡（刷新），绝不广播同名副本。
    const patchRecord = effectivePatch as Record<string, unknown>;
    const nodeMap = new Map(savedFlow.nodes.map((n) => [String(n.id ?? ""), n]));
    const edgeMap = new Map(savedFlow.edges.map((e) => [String(e.id ?? ""), e]));
    const touchedNodeIds = [
      ...toRecordArray(patchRecord.createNodes).map((n) => String(n.id ?? "")),
      ...toRecordArray(patchRecord.patchNodeData).map((p) => String(p.id ?? "")),
      ...toRecordArray(patchRecord.appendNodeArrays).map((p) => String(p.id ?? "")),
    ].filter(Boolean);
    const upsertNodes = touchedNodeIds
      .map((id) => nodeMap.get(id))
      .filter(Boolean) as Record<string, unknown>[];
    const upsertEdges = applied.createdEdgeIds
      .map((id) => edgeMap.get(id))
      .filter(Boolean) as Record<string, unknown>[];
    const syncPatch: Record<string, unknown> = { revision: savedRevision };
    if (upsertNodes.length) syncPatch.upsertNodes = upsertNodes;
    if (upsertEdges.length) syncPatch.upsertEdges = upsertEdges;
    const removeNodeIds = Array.isArray(patchRecord.deleteNodeIds)
      ? (patchRecord.deleteNodeIds as string[])
      : [];
    if (removeNodeIds.length) syncPatch.removeNodeIds = removeNodeIds;
    const removeEdgeIds = Array.isArray(patchRecord.deleteEdgeIds)
      ? (patchRecord.deleteEdgeIds as string[])
      : [];
    if (removeEdgeIds.length) syncPatch.removeEdgeIds = removeEdgeIds;
    if (Object.keys(syncPatch).length) {
      broadcastPatch(input.chapterId, syncPatch, "");
    }

    return {
      stats: applied.stats as unknown as Record<string, number>,
      createdNodeIds: applied.createdNodeIds,
      createdEdgeIds: applied.createdEdgeIds,
      data: savedFlow,
      updatedAt: new Date().toISOString(),
    };
    }
  });
}

/**
 * Apply an arbitrary graph mutation to a chapter's canvas flow with optimistic
 * revision retry + chapter-room SSE broadcast. For node shapes that
 * applyPublicFlowGraphPatch.createNodes refuses (e.g. directorConsole), where
 * the caller must build the next graph by hand. The mutator is re-invoked on
 * the freshly-read graph on every conflict retry, so it must be pure.
 */
export async function mutateChapterCanvasGraph(input: {
  c: AppContext;
  userId: string;
  chapterId: string;
  mutate: (current: unknown) => unknown;
  broadcastNodeIds: string[];
  conflictTimeoutMs?: number;
}): Promise<{ nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }> {
  return withChapterCanvasWriteQueue(input.chapterId, async () => {
    const conflictTimeoutMs = input.conflictTimeoutMs
      ?? DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS;
    const conflictDeadlineMs = Date.now() + conflictTimeoutMs;

    for (let attempt = 0; ; attempt += 1) {
    const { revision, flow } = await getChapterCanvasFlow(
      input.c,
      input.userId,
      input.chapterId,
    );
    const current = sanitizeFlowDataForStorage(flow ?? { nodes: [], edges: [] });
    const sanitizedNext = sanitizeFlowDataForStorage(input.mutate(current));
    const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
    if (!nextParsed.success) {
      throw new AppError("Chapter canvas flow mutation produced invalid data", {
        status: 500,
        code: "chapter_canvas_flow_invalid",
        details: { issues: nextParsed.error.issues },
      });
    }
    const nextFlow = {
      nodes: toRecordArray((sanitizedNext as { nodes?: unknown }).nodes),
      edges: toRecordArray((sanitizedNext as { edges?: unknown }).edges),
    };

    let savedRevision: number;
    let savedFlow = nextFlow;
    try {
      const saveResult = await putChapterCanvasFlow(input.c, input.userId, input.chapterId, {
        expectedRevision: revision,
        flow: nextFlow,
        // agent 回灌：撞版本走 CAS 取并集重试（reconcile 并回最新节点），不硬挡 409。
        source: "agent",
      });
      savedRevision = saveResult.revision;
      savedFlow = saveResult.authoritativeFlow ?? nextFlow;
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

    const nodeMap = new Map(savedFlow.nodes.map((n) => [String(n.id ?? ""), n]));
    const upsertNodes = input.broadcastNodeIds
      .map((id) => nodeMap.get(id))
      .filter(Boolean) as Record<string, unknown>[];
    if (upsertNodes.length) {
      broadcastPatch(input.chapterId, { upsertNodes, revision: savedRevision }, "");
    }
    return savedFlow;
    }
  });
}
