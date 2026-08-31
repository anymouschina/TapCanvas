import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  getFlowByIdUnsafe,
  getFlowForOwner,
  mapFlowRowToDto,
  updateFlow,
  updateFlowByIdUnsafe,
  FlowRevisionConflictError,
  type FlowRow,
} from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import {
  PublicFlowGraphSchema,
} from "../flow/flow.public.schemas";

/**
 * 宽松 patch 类型：与 applyPublicFlowGraphPatch 的入参等价，但对 createNodes 元素不做
 * 严格 zod 输出类型约束（运行时仍由 applyPublicFlowGraphPatch 内部 sanitize/校验）。
 * 这样 orchestrator 拼装的占位节点（含动态 data 键）不会撞静态 node 类型。
 */
type LooseFlowPatch = {
  createNodes?: Array<Record<string, unknown>>;
  patchNodeData?: Array<{ id: string; data: Record<string, unknown> }>;
  appendNodeArrays?: Array<{ id: string; key: string; items: unknown[] }>;
  deleteNodeIds?: string[];
  createEdges?: Array<Record<string, unknown>>;
  deleteEdgeIds?: string[];
  allowOverwrite?: boolean;
};
import { broadcastPatch } from "../chapter/canvas-sse.manager";
import { applyPatchToFlowYDoc } from "../realtime/yjs-realtime";
import {
  getChapterCanvasFlow,
  putChapterCanvasFlow,
  CanvasFlowRevisionConflictError,
} from "../chapter/chapter.canvas-flow.service";
import {
  DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS,
  waitForCanvasRevisionRetry,
  withChapterCanvasWriteQueue,
} from "./chapter-canvas-write-queue";

/**
 * 视频编排的画布读写共用层。核心是 **fresh-read 写回**：每次写都重读最新 flow 再 patch，
 * 绝不用旧快照覆盖（防多段并发/异步回写互相踩）。参考既有 persistVideoNodePatch 模式。
 *
 * 章节画布=项目子级：和项目 flow 走同一套 orchestrate，差别只在存储位置（flows 表 vs
 * chapters.canvas_flow，后者带乐观锁 revision）。freshReadFlowRow / persistFlowPatch 收到
 * chapterId 时切到章节读写；**不传 chapterId 时与改动前 100% 等价**。
 */

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** 把章节画布读成 synthetic FlowRow（id=chapterId、data=JSON(flow)），供统一读路径用。 */
async function readChapterCanvasAsFlowRow(
  c: AppContext,
  userId: string,
  chapterId: string,
): Promise<FlowRow> {
  const { flow } = await getChapterCanvasFlow(c, userId, chapterId);
  const nowIso = new Date().toISOString();
  // 章节画布是项目子级：解出归属 project_id 填到 synthetic row。否则 orchestrateVideoStart
  // 读到的 projectId=null，video_runs.project_id 留空 → 前端 run-status SSE/进度 chip 静默
  // （memory: project_video_run_awareness_sse「闸门=video_runs.project_id 须回填」），
  // 且 persistFlowPatch 的 SSE 广播也找不到 project 房间。
  let projectId: string | null = null;
  try {
    const chapterRow = await c.env.DB.chapters.findFirst({
      where: { id: chapterId },
      select: { project_id: true },
    });
    projectId = chapterRow?.project_id ?? null;
  } catch {
    projectId = null;
  }
  return {
    id: chapterId,
    name: "chapter-canvas",
    data: JSON.stringify(flow ?? { nodes: [], edges: [] }),
    owner_id: userId,
    project_id: projectId,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlowItemId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return readTrimmedString((value as Record<string, unknown>).id);
}

export type VideoFlowNode = {
  id: string;
  type?: string;
  parentId?: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * 读取视频节点已经持久化的主视频 URL。
 *
 * 画布媒体合同同时允许顶层 `videoUrl` 与 `videoResults[] + videoPrimaryIndex`：
 * 浏览器合成先写临时 blob URL，上传完成后持久化结果有可能只保留在
 * `videoResults`。编排终态判定必须识别两种合法落点，但只接受真实 http(s)
 * 资产，绝不能把 blob/object URL 当作可交付成片。
 */
export function readDurableNodeVideoUrl(node: VideoFlowNode | null | undefined): string {
  if (!node) return "";
  const data = node.data ?? {};
  const readHttpUrl = (value: unknown): string => {
    const url = readTrimmedString(value);
    return /^https?:\/\//.test(url) ? url : "";
  };

  const directUrl = readHttpUrl(data.videoUrl);
  if (directUrl) return directUrl;

  const results = Array.isArray(data.videoResults) ? data.videoResults : [];
  const primaryIndex =
    typeof data.videoPrimaryIndex === "number" && Number.isInteger(data.videoPrimaryIndex)
      ? data.videoPrimaryIndex
      : -1;
  if (primaryIndex >= 0 && primaryIndex < results.length) {
    const primary = results[primaryIndex];
    if (primary && typeof primary === "object" && !Array.isArray(primary)) {
      const primaryUrl = readHttpUrl((primary as Record<string, unknown>).url);
      if (primaryUrl) return primaryUrl;
    }
  }

  for (const result of results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const url = readHttpUrl((result as Record<string, unknown>).url);
    if (url) return url;
  }
  return "";
}

/** 重读最新 flow 行（devBypass 走 unsafe，否则按 owner 校验）。chapterId 存在则读章节画布。 */
export async function freshReadFlowRow(input: {
  c: AppContext;
  flowId: string;
  requestUserId: string;
  devBypass: boolean;
  chapterId?: string;
}): Promise<FlowRow> {
  const chapterId = readTrimmedString(input.chapterId);
  if (chapterId) {
    return readChapterCanvasAsFlowRow(input.c, input.requestUserId, chapterId);
  }
  const row = input.devBypass
    ? await getFlowByIdUnsafe(input.c.env.DB, input.flowId)
    : await getFlowForOwner(input.c.env.DB, input.flowId, input.requestUserId);
  if (!row) {
    throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
  }
  return row;
}

/** 从 flow 行解出 nodes 数组（已 sanitize）。 */
export function readFlowNodes(row: FlowRow): VideoFlowNode[] {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  return nodes.map((n) => ({
    id: String(n.id ?? ""),
    ...(typeof n.type === "string" ? { type: n.type } : {}),
    ...(readTrimmedString(n.parentId) ? { parentId: readTrimmedString(n.parentId) } : {}),
    data:
      n.data && typeof n.data === "object" && !Array.isArray(n.data)
        ? (n.data as Record<string, unknown>)
        : {},
    ...n,
  })) as VideoFlowNode[];
}

/** 从 flow 行解出 edges 数组（已 sanitize）。供幂等去重读现存边 id 用。 */
export function readFlowEdges(row: FlowRow): Array<Record<string, unknown>> {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const edges = Array.isArray((data as Record<string, unknown>).edges)
    ? ((data as Record<string, unknown>).edges as Array<Record<string, unknown>>)
    : [];
  return edges;
}

export function findFlowNode(row: FlowRow, nodeId: string): VideoFlowNode | null {
  if (!nodeId) return null;
  return readFlowNodes(row).find((n) => n.id === nodeId) ?? null;
}

/**
 * 应用一个 flow patch 并 fresh-read 持久化。返回更新后的 row + 受影响节点快照（供 SSE/Yjs 广播）。
 * 调用方应传入 **基于最新 row** 计算出的 patch。
 */
export async function persistFlowPatch(input: {
  c: AppContext;
  row: FlowRow;
  flowId: string;
  requestUserId: string;
  devBypass: boolean;
  patch: LooseFlowPatch;
  affectedNodeIds: string[];
  chapterId?: string;
}): Promise<{ row: FlowRow }> {
  const chapterId = readTrimmedString(input.chapterId);
  if (chapterId) {
    return persistChapterCanvasPatch({
      c: input.c,
      chapterId,
      requestUserId: input.requestUserId,
      patch: input.patch,
      affectedNodeIds: input.affectedNodeIds,
    });
  }
  const conflictTimeoutMs = DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS;
  const conflictDeadlineMs = Date.now() + conflictTimeoutMs;
  let currentRow = input.row;
  for (let attempt = 0; ; attempt += 1) {
    const dto = mapFlowRowToDto(currentRow);
    const current = sanitizeFlowDataForStorage(dto.data ?? {});
    const applied = applyPublicFlowGraphPatch({
      current,
      patch: input.patch as never,
    });
    const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
    const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
    if (!nextParsed.success) {
      throw new AppError("Flow patch produced invalid data", {
        status: 500,
        code: "flow_patch_invalid",
        details: { issues: nextParsed.error.issues },
      });
    }
    const nowIso = new Date().toISOString();
    const nextJson = JSON.stringify(sanitizedNext ?? {});
    let updated: FlowRow | null;
    try {
      updated = input.devBypass
        ? await updateFlowByIdUnsafe(input.c.env.DB, {
            id: input.flowId,
            name: currentRow.name,
            data: nextJson,
            nowIso,
            expectedRevision: dto.canvasRevision,
            source: "agent",
          })
        : await updateFlow(input.c.env.DB, {
            id: input.flowId,
            name: currentRow.name,
            data: nextJson,
            ownerId: input.requestUserId,
            projectId: currentRow.project_id,
            nowIso,
            expectedRevision: dto.canvasRevision,
            source: "agent",
          });
    } catch (error) {
      if (error instanceof FlowRevisionConflictError) {
        const decision = await waitForCanvasRevisionRetry({
          attempt,
          deadlineMs: conflictDeadlineMs,
        });
        if (!decision.retry) {
          throw new AppError("Flow patch write conflict deadline exhausted", {
            status: 409,
            code: "flow_patch_conflict",
            details: {
              expected: error.expected,
              actual: error.actual,
              attempts: attempt + 1,
              conflictTimeoutMs,
            },
          });
        }
        currentRow = await freshReadFlowRow({
          c: input.c,
          flowId: input.flowId,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
        });
        continue;
      }
      throw error;
    }
    if (!updated) {
      throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
    }
    const versionUserId = input.devBypass
      ? readTrimmedString(currentRow.owner_id) || input.requestUserId
      : input.requestUserId;
    // 广播受影响节点 + 新建边到项目 SSE / Yjs。
    if (currentRow.project_id) {
      const nodeMap = new Map(
        (nextParsed.data.nodes ?? []).map((node) => [readFlowItemId(node), node]),
      );
      const upsertNodes = input.affectedNodeIds
        .map((id) => nodeMap.get(id))
        .filter((node) => node !== undefined);
      // 【治「split 丢边」根因】edge 必须一起广播：否则浏览器只收到节点、本地 store 无边，其
      // autosave 整图 PUT 会把服务端刚建的边清空（ch129 实测 split 后 21 节点 / 0 边）。
      const edgeMap = new Map(
        (nextParsed.data.edges ?? []).map((edge) => [readFlowItemId(edge), edge]),
      );
      const upsertEdges = applied.createdEdgeIds
        .map((id) => edgeMap.get(id))
        .filter((edge) => edge !== undefined);
      const broadcast: Record<string, unknown> = {
        revision: updated.canvas_revision ?? dto.canvasRevision + 1,
      };
      if (upsertNodes.length) broadcast.upsertNodes = upsertNodes;
      if (upsertEdges.length) broadcast.upsertEdges = upsertEdges;
      if (upsertNodes.length || upsertEdges.length) {
        broadcastPatch(currentRow.project_id, broadcast, "");
        applyPatchToFlowYDoc(input.flowId, broadcast);
      }
    }

    return { row: updated };
  }
}

/**
 * 章节画布版 persist：getChapterCanvasFlow(读 revision+flow) → applyPublicFlowGraphPatch →
 * putChapterCanvasFlow(带 expectedRevision 乐观锁) → 冲突重读重试 → 广播章节 SSE 房。
 * 是 writeFinalNodeToChapterCanvas 的「任意 patch」泛化版，供 orchestrate 在章节画布上统一写。
 * 返回更新后的 synthetic chapter FlowRow（供调用方继续用）。
 */
async function persistChapterCanvasPatch(input: {
  c: AppContext;
  chapterId: string;
  requestUserId: string;
  patch: LooseFlowPatch;
  affectedNodeIds: string[];
  conflictTimeoutMs?: number;
}): Promise<{ row: FlowRow }> {
  return withChapterCanvasWriteQueue(input.chapterId, async () => {
    const conflictTimeoutMs = input.conflictTimeoutMs
      ?? DEFAULT_CANVAS_REVISION_CONFLICT_TIMEOUT_MS;
    const conflictDeadlineMs = Date.now() + conflictTimeoutMs;
    for (let attempt = 0; ; attempt += 1) {
    const { revision, flow } = await getChapterCanvasFlow(
      input.c,
      input.requestUserId,
      input.chapterId,
    );
    const current = sanitizeFlowDataForStorage(flow ?? { nodes: [], edges: [] });
    const applied = applyPublicFlowGraphPatch({
      current,
      patch: input.patch as never,
    });
    const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
    const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
    if (!nextParsed.success) {
      throw new AppError("Chapter canvas flow patch produced invalid data", {
        status: 500,
        code: "chapter_canvas_flow_invalid",
        details: { issues: nextParsed.error.issues },
      });
    }
    // chapters.canvas_flow 只存 { nodes, edges }，剥掉 sanitize 可能产生的其它顶层键。
    const nextFlow = {
      nodes: toRecordArray((sanitizedNext as { nodes?: unknown }).nodes),
      edges: toRecordArray((sanitizedNext as { edges?: unknown }).edges),
    };
    let savedRevision: number;
    let savedFlow = nextFlow;
    try {
      const saveResult = await putChapterCanvasFlow(input.c, input.requestUserId, input.chapterId, {
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
    // 广播受影响节点 + 新建边到章节 SSE 房（chapterId 作房间键）。
    const nodeMap = new Map(
      savedFlow.nodes.map((n) => [String((n as { id?: unknown }).id ?? ""), n]),
    );
    const upsertNodes = input.affectedNodeIds
      .map((id) => nodeMap.get(id))
      .filter(Boolean) as Record<string, unknown>[];
    // 【治「split 丢边」根因】edge 必须一起广播：否则浏览器只收到节点、本地 store 无边，其
    // autosave 整图 PUT 会把服务端刚建的边清空（ch129 实测 split 后 21 节点 / 0 边 → 树断 → DAG 跑不了）。
    const edgeMap = new Map(
      savedFlow.edges.map((e) => [String((e as { id?: unknown }).id ?? ""), e]),
    );
    const upsertEdges = applied.createdEdgeIds
      .map((id) => edgeMap.get(id))
      .filter(Boolean) as Record<string, unknown>[];
    const patch: Record<string, unknown> = { revision: savedRevision };
    if (upsertNodes.length) patch.upsertNodes = upsertNodes;
    if (upsertEdges.length) patch.upsertEdges = upsertEdges;
    if (upsertNodes.length || upsertEdges.length) {
      broadcastPatch(input.chapterId, patch, "");
    }
    const nowIso = new Date().toISOString();
    return {
      row: {
        id: input.chapterId,
        name: "chapter-canvas",
        data: JSON.stringify(savedFlow),
        owner_id: input.requestUserId,
        project_id: null,
        created_at: nowIso,
        updated_at: nowIso,
      },
    };
    }
  });
}
