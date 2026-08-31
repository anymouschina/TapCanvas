import type { VideoFlowNode } from "./video-orchestrator.flow-io";

/**
 * 编排器「按画布反查 clip 状态」纯函数层。
 *
 * 根因修复：旧状态机只按确定性 slot nodeId（deriveClipNodeId）查视频。一旦画布里的真实节点
 * id 与 slot 不一致（手动接管命名），就会判 absent → 反复重造 clip0。
 * 这里改为以 **(clipRunId, clipIndex) 元数据** 从画布反查，元数据才是单一真相源。
 */

export type ClipVideoRuntime = {
  status: "absent" | "running" | "success" | "failed" | "submit_failed";
  videoUrl?: string;
  nodeId?: string;
  /** 失败归因（来自节点 data.clipSubmitError）：让 run 级 error_message/status 能说清是哪段、为什么挂。 */
  error?: string;
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readClipIndex(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/**
 * 收集 flow 内由编排器创建的视频 clip 节点（带 clipRunId）中、仍「活跃」的去重 runId 列表。
 * 活跃 = 状态为 running/queued/submitted/success（失败/未知不算，允许裸路径降级恢复）。
 *
 * 用于 Workflow IR 的执行归属校验：一旦某 execution family 已经起跑，本片后续各段都必须由
 * 同一持久工作流按 runId:clip:index 幂等推进、续写与拼接。若此时 agent 改走裸
 * video_generate_to_canvas（不带 clipRunId），会绕过幂等、对同一 clip 重复生成
 * （重复扣费并产生不会被拼接的孤儿节点）。handler 检测到「recipe 组 + 裸提交 + 存在活跃 run」
 * 即 409 拒绝，并要求回到原 Workflow execution family。
 */
export function collectActiveOrchestratorRunIds(nodes: VideoFlowNode[]): string[] {
  const runs = new Set<string>();
  for (const n of nodes) {
    const d = n.data ?? {};
    const kind = readTrimmedString(d.kind).toLowerCase();
    if (kind !== "video" && kind !== "composevideo") continue;
    const runId = readTrimmedString(d.clipRunId);
    if (!runId) continue;
    const status = readTrimmedString(d.status).toLowerCase();
    if (
      status === "running" ||
      status === "queued" ||
      status === "submitted" ||
      status === "success"
    ) {
      runs.add(runId);
    }
  }
  return Array.from(runs);
}

function mapVideoNodeStatus(node: VideoFlowNode): ClipVideoRuntime {
  const status = readTrimmedString(node.data.status).toLowerCase();
  if (status === "success") {
    const url = readTrimmedString(node.data.videoUrl);
    return url
      ? { status: "success", videoUrl: url, nodeId: node.id }
      : { status: "success", nodeId: node.id };
  }
  if (status === "failed" || status === "error" || status === "submit_failed") {
    const err =
      readTrimmedString(node.data.clipSubmitError) ||
      readTrimmedString(node.data.errorMessage) ||
      readTrimmedString(node.data.failReason);
    return {
      status: status === "submit_failed" ? "submit_failed" : "failed",
      nodeId: node.id,
      ...(err ? { error: err } : {}),
    };
  }
  if (status === "running" || status === "queued" || status === "submitted") {
    return { status: "running", nodeId: node.id };
  }
  return { status: "absent" };
}

/**
 * 内容审核/版权拒 = 确定性失败：同一 prompt/参考图重提必然同结果，且输出侧拒（如
 * OutputVideoSensitiveContentDetected copyright）是渲染完才拒——每盲重试一发都白烧一次完整渲染费
 * （2026-07-10 怪兽宣传片实测：同 prompt 三连发全被版权拒，直到零进展水位标取消 run）。
 * 命中即「首拒即永久」（对齐提交侧 400 fail-fast 口径），由上层把镜标终态浮出 video_failed，
 * 交 agent 按 IP-safe/脱敏改写该镜后 replaceAtIndex 重灌再出。429/5xx 等瞬时错误不在此列，照常重试。
 */
export function isPermanentModerationFailure(errText: unknown): boolean {
  const t = String(errText ?? "").toLowerCase();
  if (!t) return false;
  return (
    t.includes("sensitivecontentdetected") || // Input*/OutputVideo*/OutputAudio* SensitiveContentDetected.*
    t.includes("policyviolation") ||
    t.includes("copyright") ||
    t.includes("content moderation") ||
    t.includes("内容审核") ||
    t.includes("涉敏")
  );
}

/**
 * 解析本段视频运行态：先认确定性 slot 节点；slot 缺失/未结算时，按 (clipRunId, clipIndex)
 * 元数据反查同段的视频节点（认出手动命名或重命名的成片），消除「认不出已成片 → 重造 clip0」。
 */
export function resolveClipVideoRuntime(
  nodes: VideoFlowNode[],
  slotNodeId: string,
  runId: string,
  clipIndex: number,
): ClipVideoRuntime {
  // 【根因修复·14/15 卡死】success 是终态、必须优先于"stale slot 指到的 running/failed 旧节点"。
  // 旧逻辑：slot 命中即短路返回(哪怕 running)→ 若 slot 指到陈旧节点、而真正的成功视频在另一节点
  // (按 clipRunId+clipIndex 元数据反查才找得到)，该镜被误判非 success → allSucceeded=false → 永不 concat
  // (实测 ch191：15 段全 success 却卡 14/15)。改为：任一来源命中 success 立即返回；非 success 仅记为最优、
  // 继续扫元数据找 success；扫完无 success 才返回最优(running/failed)。
  let best: ClipVideoRuntime = { status: "absent" };
  const slot = slotNodeId ? nodes.find((n) => n.id === slotNodeId) : null;
  if (slot) {
    const runtime = mapVideoNodeStatus(slot);
    if (runtime.status === "success") return runtime;
    if (runtime.status !== "absent") best = runtime;
  }
  const rid = readTrimmedString(runId);
  if (rid) {
    for (const n of nodes) {
      if (n.id === slotNodeId) continue;
      const d = n.data ?? {};
      const kind = readTrimmedString(d.kind).toLowerCase();
      if (kind !== "video" && kind !== "composevideo") continue;
      if (readTrimmedString(d.clipRunId) !== rid) continue;
      if (readClipIndex(d.clipIndex) !== clipIndex) continue;
      const runtime = mapVideoNodeStatus(n);
      if (runtime.status === "success") return runtime;
      if (runtime.status !== "absent" && best.status === "absent") best = runtime;
    }
  }
  return best;
}
