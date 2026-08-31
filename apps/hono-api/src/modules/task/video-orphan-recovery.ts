import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { loadChapterCanvasAsFlowRow } from "./agents-tool-bridge.chapter-canvas-write";
import { reconcileVideoNodesForFlow } from "./agents-tool-bridge.generate-video-to-canvas";
import {
  recoverWorkflowVideoTerminalNodes,
  selectWorkflowVideoRecoveryCandidates,
} from "./workflow-video-terminal-recovery";

/**
 * 坏死任务恢复（孤儿回收）能力。
 *
 * 根因：reconcile（把上游已完成的视频结果写回画布节点）只在「活的 video_run」被 driver 推进时发生。
 * 一旦 run 被取消 / 删除 / 从未真正落库（estimate_token / assets 门弹回后 agent 仍裸提交），它在飞的 clip
 * 即便上游 new-api 已 succeeded，也没有任何 driver 去回收 → 画布节点永远卡在 "生成中"（status=running）= 孤儿。
 *
 * 本模块做系统级自愈：定时（复用 finalizer tick）扫出「有卡死视频节点、但本身已静置（无活 run 在写）」的
 * 项目级 flow 与章节画布：有 taskId 的走 provider reconcile；没有 taskId 但带完整工作流身份的节点，
 * 从不可变 workflow item attempt 回执中精确恢复成功、失败或已受理 taskId。两条路径都不会重新提交生成。
 *
 * 关键设计：用章节 `updated_at` 的 staleness 当「无活 run」的代理信号——正在生成的章节每出一镜就写一次画布、
 * updated_at 持续刷新 → 不满足 staleBefore → 自动跳过（不抢活 run）；孤儿章节 run 已死、再无写入 →
 * updated_at 变旧 → 被纳入回收。无需额外表/字段，零侵入。
 *
 * flag VIDEO_ORPHAN_RECOVERY，**默认 ON**（2026-07-02 翻正：孤儿回收是幂等 best-effort 失败兜底，不是起跑硬闸，
 * 属「保留失败循环 + 恢复」而非「预防性硬闸」——关着会让无 taskId/被取消的裸提交 clip 永久卡「生成中」）。
 * reconcileVideoNodesForFlow 幂等、仅对真有 taskId 的 running/queued 节点动手，且靠章节 staleness 避开活 run，
 * 默认开零误伤。仅显式 0/false/off/no 才关。
 */

export function isOrphanRecoveryEnabled(env: unknown): boolean {
  const raw = String(
    (env as Record<string, unknown>)?.VIDEO_ORPHAN_RECOVERY ??
      globalThis.process?.env?.VIDEO_ORPHAN_RECOVERY ??
      "",
  )
    .trim()
    .toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

type FlowNodeLike = { id?: unknown; data?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 纯函数：从画布节点里挑出「卡死、需回收」的视频节点 id。
 * 判据：kind=video（或 composeVideo）+ 非终态；并且有真实 taskId，或带完整、相互匹配的工作流
 * execution/runtime/effect/canvas 身份。已 success/failed 的不动；普通无 taskId 节点不动。
 */
export function selectStuckVideoNodeIds(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  const out: string[] = [];
  for (const raw of nodes as FlowNodeLike[]) {
    const node = isRecord(raw) ? raw : {};
    const data = isRecord(node.data) ? node.data : {};
    const kind = readTrimmed(data.kind).toLowerCase();
    if (kind !== "video" && kind !== "composevideo") continue;
    const status = readTrimmed(data.status).toLowerCase();
    if (status !== "submitting" && status !== "running" && status !== "queued" && status !== "submitted") continue;
    const taskId = readTrimmed(data.taskId) || readTrimmed(data.videoTaskId);
    const id = readTrimmed(node.id);
    if (!id) continue;
    if (taskId || selectWorkflowVideoRecoveryCandidates([raw]).length > 0) out.push(id);
  }
  return out;
}

/** 纯函数：一份画布快照里是否存在需回收的卡死视频节点（候选过滤用）。 */
export function flowGraphHasStuckVideoNode(flowJson: unknown): boolean {
  if (!isRecord(flowJson)) return false;
  return selectStuckVideoNodeIds((flowJson as Record<string, unknown>).nodes).length > 0;
}

export type OrphanRecoveryResult = {
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

function recordRecoveryError(
  result: OrphanRecoveryResult,
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
  console.error("[video-orphan-recovery] canvas recovery failed", {
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    error: message,
  });
}

/**
 * 扫一批「静置且含卡死视频节点」的章节画布，逐个 reconcile 回收上游结果。best-effort：
 * 单个章节失败不影响其余。`staleBeforeIso` 用章节 updated_at 过滤掉正在生成的活跃章节。
 */
export async function recoverOrphanVideoNodes(
  c: AppContext,
  opts: { staleBeforeIso: string; limit?: number },
): Promise<OrphanRecoveryResult> {
  const base: OrphanRecoveryResult = {
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
  if (!isOrphanRecoveryEnabled(c.env)) return { ...base, enabled: false };

  const prisma = getPrismaClient();
  const limit = Math.max(1, Math.trunc(opts.limit ?? 8));

  const projectFlows = await prisma.flows.findMany({
    where: {
      updated_at: { lt: opts.staleBeforeIso },
      OR: [
        { data: { contains: '"status":"submitting"' } },
        { data: { contains: '"status":"running"' } },
        { data: { contains: '"status":"queued"' } },
        { data: { contains: '"status":"submitted"' } },
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
      recordRecoveryError(base, {
        scopeType: "project_flow",
        scopeId: flow.id,
        error: new Error("Project flow is missing owner_id or project_id"),
      });
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(flow.data);
    } catch (error: unknown) {
      recordRecoveryError(base, {
        scopeType: "project_flow",
        scopeId: flow.id,
        error,
      });
      continue;
    }
    if (!flowGraphHasStuckVideoNode(parsed)) continue;
    const workflowCandidateIds = selectWorkflowVideoRecoveryCandidates(
      isRecord(parsed) ? parsed.nodes : null,
    ).map((candidate) => candidate.nodeId);
    base.scannedCanvases += 1;
    base.scannedProjectFlows += 1;
    try {
      const workflowRecon = await recoverWorkflowVideoTerminalNodes({
        c,
        requestUserId: flow.owner_id,
        devBypass: true,
        flowId: flow.id,
        row: flow,
      });
      const recon = await reconcileVideoNodesForFlow({
        c,
        requestUserId: flow.owner_id,
        devBypass: true,
        flowId: flow.id,
        row: flow,
        ...(workflowCandidateIds.length > 0 ? { excludeNodeIds: workflowCandidateIds } : {}),
      });
      const reconciled = workflowRecon.reconciled + recon.reconciled;
      const failed = workflowRecon.failed + recon.failed;
      const stillRunning = workflowRecon.stillRunning + recon.stillRunning;
      base.reconciledNodes += reconciled;
      base.failedNodes += failed;
      base.stillRunning += stillRunning;
      base.details.push({
        scopeType: "project_flow",
        scopeId: flow.id,
        flowId: flow.id,
        projectId: flow.project_id,
        reconciled,
        failed,
        stillRunning,
      });
    } catch (error: unknown) {
      recordRecoveryError(base, {
        scopeType: "project_flow",
        scopeId: flow.id,
        error,
      });
    }
  }

  // 候选：canvas_flow 文本里含 video 节点，且 updated_at 已静置（无活 run 在写）。
  // LIKE 仅作粗筛，selectStuckVideoNodeIds 做精确判定（避免误回收已 success/无 taskId 的）。
  const candidates = (await prisma.chapters.findMany({
    where: {
      updated_at: { lt: opts.staleBeforeIso },
      AND: [
        {
          OR: [
            { canvas_flow: { contains: '"kind":"video"' } },
            { canvas_flow: { contains: '"kind":"composeVideo"' } },
          ],
        },
        {
          OR: [
            { canvas_flow: { contains: '"status":"submitting"' } },
            { canvas_flow: { contains: '"status":"running"' } },
            { canvas_flow: { contains: '"status":"queued"' } },
            { canvas_flow: { contains: '"status":"submitted"' } },
          ],
        },
      ],
    },
    select: { id: true, owner_id: true, project_id: true, canvas_flow: true },
    orderBy: { updated_at: "asc" },
    take: limit,
  })) as Array<{ id: string; owner_id: string; project_id: string | null; canvas_flow: string | null }>;

  for (const ch of candidates) {
    let parsed: unknown = null;
    try {
      parsed = ch.canvas_flow ? JSON.parse(ch.canvas_flow) : null;
    } catch {
      continue;
    }
    if (!flowGraphHasStuckVideoNode(parsed)) continue;
    const workflowCandidateIds = selectWorkflowVideoRecoveryCandidates(
      isRecord(parsed) ? parsed.nodes : null,
    ).map((candidate) => candidate.nodeId);
    base.scannedCanvases += 1;
    base.scannedChapters += 1;
    try {
      const row = await loadChapterCanvasAsFlowRow(
        c as never,
        ch.owner_id,
        ch.id,
        ch.project_id || "",
      );
      const workflowRecon = await recoverWorkflowVideoTerminalNodes({
        c,
        requestUserId: ch.owner_id,
        devBypass: true,
        flowId: ch.id,
        row,
        chapterId: ch.id,
      });
      const recon = await reconcileVideoNodesForFlow({
        c,
        requestUserId: ch.owner_id,
        devBypass: true,
        flowId: ch.id,
        row,
        chapterId: ch.id,
        ...(workflowCandidateIds.length > 0 ? { excludeNodeIds: workflowCandidateIds } : {}),
      });
      const reconciled = workflowRecon.reconciled + recon.reconciled;
      const failed = workflowRecon.failed + recon.failed;
      const stillRunning = workflowRecon.stillRunning + recon.stillRunning;
      base.reconciledNodes += reconciled;
      base.failedNodes += failed;
      base.stillRunning += stillRunning;
      base.details.push({
        scopeType: "chapter",
        scopeId: ch.id,
        chapterId: ch.id,
        projectId: ch.project_id || "",
        reconciled,
        failed,
        stillRunning,
      });
    } catch (error: unknown) {
      recordRecoveryError(base, {
        scopeType: "chapter",
        scopeId: ch.id,
        error,
      });
    }
  }
  return base;
}
