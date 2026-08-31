import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { loadChapterCanvasAsFlowRow } from "./agents-tool-bridge.chapter-canvas-write";
import { reconcileImageNodesForFlow } from "./agents-tool-bridge.generate-image-to-canvas";
import { isImageReconcileSweepEnabled } from "./agents-tool-bridge.image-return-policy";

export { isImageReconcileSweepEnabled };

/**
 * 图片节点 reconcile 后台 sweep（镜像 video-orphan-recovery.ts 给视频做的事）。
 *
 * 根因：image 节点的「上游已 succeeded → 写回画布」(reconcileImageNodesForFlow) 此前只在
 *   - 前端节点可见时轮询，或
 *   - orchestrator drive tick 顺带，或
 *   - agent 显式调 tapcanvas_image_reconcile
 * 时发生。章节内嵌画布(chapter canvas)没有任何自动 reconcile 循环兜底 → 这正是
 * image-return-policy.ts:29「章节强制同步」的理由：一旦异步，章节里的 running 图片节点没人回收、永远转圈。
 *
 * 后果：章节场景下设计板/关键帧出图被迫同步等(awaitImageResult 最长 480s/张)，一轮对话连出 3~4 张就
 * 跑 20+ 分钟，把前端 SSE 拖断（切章节/卸载即 abort），后台虽跑完确认卡也送不到前端（实证：第10章起跑）。
 *
 * 本模块提供统一的服务端兜底：定时（复用 finalizer tick）扫描项目根 flow 与章节内嵌画布中
 * 「有 running 图片节点、且已静置」的画布，逐个 reconcileImageNodesForFlow。上游已完成写回
 * success、已失败标 error、仍在跑保持不动；浏览器关闭也不会中断结果归集与 continuation 推进。
 *
 * IMAGE_NODE_RECONCILE_SWEEP 默认 ON；只有显式 0/false/off 才停用整个服务端 sweep。
 */

type FlowNodeLike = { id?: unknown; data?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const IMAGE_NODE_KINDS = new Set(["image", "imageedit", "storyboardimage"]);

/**
 * 纯函数：从画布节点里挑出「卡死、需回收」的图片节点 id。
 * 判据：kind ∈ {image,imageEdit,storyboardImage} + status ∈ {running,queued} + 有真实 imageTaskId/taskId。
 * 已 success/error 的不动；没 taskId 的（还没真提交/inline 成功）不动（无从查上游）。
 * 与 reconcileImageNodesForFlow 的精确判定保持一致。
 */
export function selectStuckImageNodeIds(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  const out: string[] = [];
  for (const raw of nodes as FlowNodeLike[]) {
    const node = isRecord(raw) ? raw : {};
    const data = isRecord(node.data) ? node.data : {};
    const kind = readTrimmed(data.kind).toLowerCase();
    if (!IMAGE_NODE_KINDS.has(kind)) continue;
    const status = readTrimmed(data.status).toLowerCase();
    if (status !== "running" && status !== "queued") continue;
    const taskId = readTrimmed(data.imageTaskId) || readTrimmed(data.taskId);
    if (!taskId) continue;
    const id = readTrimmed(node.id);
    if (id) out.push(id);
  }
  return out;
}

/**
 * 纯函数：挑出「孤儿占位」图片节点 id——status ∈ {running,queued} + **无 taskId** + **无 imageUrl**。
 * 这类节点从未挂上任务、也没出图，selectStuckImageNodeIds 故意跳过它们（无从查上游），
 * 结果永远转圈（ch38 board-02/03 实测）。本函数单独识别，交由 sweep 标 error 兜底。
 */
export function selectOrphanPlaceholderImageNodeIds(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  const out: string[] = [];
  for (const raw of nodes as FlowNodeLike[]) {
    const node = isRecord(raw) ? raw : {};
    const data = isRecord(node.data) ? node.data : {};
    if (!IMAGE_NODE_KINDS.has(readTrimmed(data.kind).toLowerCase())) continue;
    const status = readTrimmed(data.status).toLowerCase();
    if (status !== "running" && status !== "queued") continue;
    if (readTrimmed(data.imageTaskId) || readTrimmed(data.taskId)) continue; // 有任务 → 走正常回收
    if (readTrimmed(data.imageUrl)) continue; // 已有图 → 不是孤儿
    const id = readTrimmed(node.id);
    if (id) out.push(id);
  }
  return out;
}

/** 纯函数：一份画布快照里是否存在需回收的卡死/孤儿图片节点（候选过滤用）。 */
export function flowGraphHasStuckImageNode(flowJson: unknown): boolean {
  if (!isRecord(flowJson)) return false;
  const nodes = (flowJson as Record<string, unknown>).nodes;
  return (
    selectStuckImageNodeIds(nodes).length > 0 ||
    selectOrphanPlaceholderImageNodeIds(nodes).length > 0
  );
}

export type ImageReconcileSweepResult = {
  enabled: boolean;
  scannedCanvases: number;
  scannedProjectFlows: number;
  scannedChapters: number;
  reconciledNodes: number;
  failedNodes: number;
  stillRunning: number;
  details: Array<(
    | { scopeType: "project_flow"; scopeId: string; flowId: string; projectId: string }
    | { scopeType: "chapter"; scopeId: string; chapterId: string; projectId: string }
  ) & { reconciled: number; failed: number; stillRunning: number }>;
  errors: Array<{
    scopeType: "project_flow" | "chapter";
    scopeId: string;
    message: string;
  }>;
};

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordSweepError(
  result: ImageReconcileSweepResult,
  input: {
    scopeType: "project_flow" | "chapter";
    scopeId: string;
    error: unknown;
  },
): void {
  const message = readErrorMessage(input.error);
  result.errors.push({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    message,
  });
  console.error("[image-reconcile-sweep] canvas recovery failed", {
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    error: message,
  });
}

/**
 * 扫一批「静置且含 running 图片节点」的项目/章节画布，逐个 reconcile 回收上游结果。best-effort：
 * 单个画布失败不影响其余。`staleBeforeIso` 过滤正在生成的活跃画布（不抢活 run）。
 */
export async function sweepRunningImageNodes(
  c: AppContext,
  opts: { staleBeforeIso: string; limit?: number },
): Promise<ImageReconcileSweepResult> {
  const base: ImageReconcileSweepResult = {
    enabled: true,
    scannedCanvases: 0,
    scannedProjectFlows: 0,
    scannedChapters: 0,
    reconciledNodes: 0,
    failedNodes: 0,
    stillRunning: 0,
    details: [],
    errors: [],
  };
  if (!isImageReconcileSweepEnabled(c.env)) return { ...base, enabled: false };

  const prisma = getPrismaClient();
  const limit = Math.max(1, Math.trunc(opts.limit ?? 8));

  const projectFlows = await prisma.flows.findMany({
    where: {
      updated_at: { lt: opts.staleBeforeIso },
      OR: [
        { data: { contains: '"status":"running"' } },
        { data: { contains: '"status":"queued"' } },
      ],
    },
    select: {
      id: true,
      name: true,
      data: true,
      owner_id: true,
      project_id: true,
      created_at: true,
      updated_at: true,
      canvas_revision: true,
    },
    orderBy: { updated_at: "asc" },
    take: limit,
  });

  for (const flow of projectFlows) {
    if (!flow.owner_id || !flow.project_id) {
      recordSweepError(base, {
        scopeType: "project_flow",
        scopeId: flow.id,
        error: new Error("Project flow is missing owner_id or project_id"),
      });
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(flow.data);
    } catch (error) {
      recordSweepError(base, {
        scopeType: "project_flow",
        scopeId: flow.id,
        error,
      });
      continue;
    }
    if (!flowGraphHasStuckImageNode(parsed)) continue;
    base.scannedCanvases += 1;
    base.scannedProjectFlows += 1;
    try {
      const recon = await reconcileImageNodesForFlow({
        c,
        requestUserId: flow.owner_id,
        devBypass: true,
        flowId: flow.id,
        row: flow,
        markOrphanPlaceholders: true,
      });
      base.reconciledNodes += recon.reconciled;
      base.failedNodes += recon.failed;
      base.stillRunning += recon.stillRunning;
      base.details.push({
        scopeType: "project_flow",
        scopeId: flow.id,
        flowId: flow.id,
        projectId: flow.project_id,
        reconciled: recon.reconciled,
        failed: recon.failed,
        stillRunning: recon.stillRunning,
      });
    } catch (error) {
      recordSweepError(base, {
        scopeType: "project_flow",
        scopeId: flow.id,
        error,
      });
    }
  }

  // 候选：canvas_flow 文本里含 running 状态图片节点，且 updated_at 已静置（无活 run/前端在写）。
  // LIKE 仅作粗筛，selectStuckImageNodeIds 做精确判定（避免误回收已 success / 无 taskId 的）。
  const candidates = (await prisma.chapters.findMany({
    where: {
      updated_at: { lt: opts.staleBeforeIso },
      OR: [
        { canvas_flow: { contains: '"status":"running"' } },
        { canvas_flow: { contains: '"status":"queued"' } },
      ],
    },
    select: { id: true, owner_id: true, project_id: true, canvas_flow: true },
    orderBy: { updated_at: "asc" },
    take: limit,
  })) as Array<{ id: string; owner_id: string; project_id: string | null; canvas_flow: string | null }>;

  for (const ch of candidates) {
    if (!ch.project_id) {
      recordSweepError(base, {
        scopeType: "chapter",
        scopeId: ch.id,
        error: new Error("Chapter is missing project_id"),
      });
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = ch.canvas_flow ? JSON.parse(ch.canvas_flow) : null;
    } catch (error) {
      recordSweepError(base, {
        scopeType: "chapter",
        scopeId: ch.id,
        error,
      });
      continue;
    }
    if (!flowGraphHasStuckImageNode(parsed)) continue;
    base.scannedCanvases += 1;
    base.scannedChapters += 1;
    try {
      const row = await loadChapterCanvasAsFlowRow(
        c as never,
        ch.owner_id,
        ch.id,
        ch.project_id,
      );
      const recon = await reconcileImageNodesForFlow({
        c,
        requestUserId: ch.owner_id,
        devBypass: true,
        flowId: ch.id,
        row,
        chapterId: ch.id,
        // 静置 sweep：把无 task/无 url 的孤儿占位标 error，停掉永转 spinner。
        markOrphanPlaceholders: true,
      });
      base.reconciledNodes += recon.reconciled;
      base.failedNodes += recon.failed;
      base.stillRunning += recon.stillRunning;
      base.details.push({
        scopeType: "chapter",
        scopeId: ch.id,
        chapterId: ch.id,
        projectId: ch.project_id,
        reconciled: recon.reconciled,
        failed: recon.failed,
        stillRunning: recon.stillRunning,
      });
    } catch (error) {
      recordSweepError(base, {
        scopeType: "chapter",
        scopeId: ch.id,
        error,
      });
    }
  }
  return base;
}
