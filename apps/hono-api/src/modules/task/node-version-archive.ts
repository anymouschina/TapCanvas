/**
 * 【重写留痕·2026-07-07 用户拍板】媒体节点版本快照——纯函数、零依赖（防 import 环）。
 * 被 chapter-canvas-write（video inline 成片/角色卡按名刷新）与 video reconcile 回写共用。
 */

function readStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 【媒体节点版本留痕】节点上已有成片/成图（videoUrl/imageUrl 非空）又要被**不同**新媒体覆盖时，
 * 先把旧版快照成独立存档节点。剥掉一切会被系统解析的绑定/身份字段（幂等槽位、按名绑定、
 * 计费/回写任务号、群像 referenceType、锚层 productionLayer），确保存档节点：
 * 不被 resolveClipVideoRuntime 匹配、不被参考图按名绑定、不被 reconcile/计费扫描、不进 concat。
 */
export function buildMediaVersionArchiveNode(input: {
  origNodeId: string;
  origData: Record<string, unknown>;
  nowMs: number;
}): { nodeId: string; node: Record<string, unknown>; nodeData: Record<string, unknown> } | null {
  const d = input.origData ?? {};
  const oldVideoUrl = readStr(d.videoUrl);
  const oldImageUrl = readStr(d.imageUrl);
  if (!oldVideoUrl && !oldImageUrl) return null;
  const seq = input.nowMs.toString(36);
  const nodeId = `archive-media-${input.origNodeId}-${seq}`;
  const origLabel = readStr(d.label) || input.origNodeId;
  // 白名单复制展示字段 + 身份字段改名封存（archived* 前缀不被任何解析器识别）。
  const nodeData: Record<string, unknown> = {
    kind: oldVideoUrl ? "video" : "image",
    label: `旧版｜${origLabel}`.slice(0, 80),
    status: "success",
    ...(oldVideoUrl
      ? {
          videoUrl: oldVideoUrl,
          ...(readStr(d.videoThumbnailUrl) ? { videoThumbnailUrl: readStr(d.videoThumbnailUrl) } : {}),
          videoResults: [{ url: oldVideoUrl, title: `旧版｜${origLabel}`.slice(0, 80) }],
          videoPrimaryIndex: 0,
        }
      : { imageUrl: oldImageUrl }),
    ...(readStr(d.prompt) ? { prompt: readStr(d.prompt) } : {}),
    archivedFromNodeId: input.origNodeId,
    archivedAt: new Date(input.nowMs).toISOString(),
    archiveReason: "replaced",
    ...(readStr(d.clipRunId) ? { archivedClipRunId: readStr(d.clipRunId) } : {}),
    ...(typeof d.clipIndex === "number" ? { archivedClipIndex: d.clipIndex } : {}),
    ...(readStr(d.roleName) ? { archivedRoleName: readStr(d.roleName) } : {}),
    ...(readStr(d.taskId) ? { archivedTaskId: readStr(d.taskId) } : {}),
  };
  return {
    nodeId,
    nodeData,
    node: {
      id: nodeId,
      type: "taskNode",
      position: { x: -1200, y: 200 + (input.nowMs % 12) * 200 },
      data: nodeData,
    },
  };
}

/**
 * 覆盖是否构成「换版本」：旧媒体非空、新媒体非空、且 URL 不同。
 * （同 URL 重写=幂等回写不留痕；新媒体为空=状态清理不留痕。）
 */
export function isMediaVersionReplacement(
  oldData: Record<string, unknown> | undefined,
  newData: Record<string, unknown> | undefined,
): boolean {
  const o = oldData ?? {};
  const n = newData ?? {};
  const oldUrl = readStr(o.videoUrl) || readStr(o.imageUrl);
  const newUrl = readStr(n.videoUrl) || readStr(n.imageUrl);
  return Boolean(oldUrl && newUrl && oldUrl !== newUrl);
}

