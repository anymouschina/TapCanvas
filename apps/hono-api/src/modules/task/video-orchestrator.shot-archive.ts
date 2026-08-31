import type { AppContext } from "../../types";
import { writeFinalNodeToChapterCanvas } from "./agents-tool-bridge.chapter-canvas-write";

/**
 * 【重写/补充留痕·2026-07-07 用户拍板】镜头表段落被替换（replaceAtIndex）或整批重置（reset）时，
 * 旧版内容不再无痕蒸发——快照成画布「存档文本节点」，改了什么有据可查。
 *
 * 原则：权威数据仍在累积区/正式节点，存档节点是纯痕迹（kind:text，无任何会被系统解析的
 * 绑定字段：不带 clipRunId/clipIndex/roleName），绝不会被 runtime 解析、参考图绑定或 concat 误捡。
 * best-effort：存档失败只告警，绝不阻断 add_clips 主流程。
 */

function readStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 单段镜头表 → 可读存档文本（结构未知时兜底 JSON 截断）。 */
export function renderClipArchiveText(clip: unknown, slotIndex: number): string {
  if (!clip || typeof clip !== "object" || Array.isArray(clip)) {
    return `段${slotIndex + 1}：${String(clip ?? "").slice(0, 400)}`;
  }
  const c = clip as Record<string, unknown>;
  const lines: string[] = [];
  const dur = typeof c.durationSeconds === "number" ? `${c.durationSeconds}s` : "";
  lines.push(`## 段${slotIndex + 1}${dur ? `（${dur}）` : ""}`);
  const logline = readStr(c.logline);
  if (logline) lines.push(`logline：${logline}`);
  const roles = Array.isArray(c.characterRoleNames)
    ? (c.characterRoleNames as unknown[]).map((r) => String(r ?? "").trim()).filter(Boolean)
    : [];
  if (roles.length) lines.push(`出场：${roles.join("、")}`);
  const continuity = readStr(c.continuity);
  if (continuity) lines.push(`承接：${continuity}`);
  const shots = Array.isArray(c.shots) ? (c.shots as Record<string, unknown>[]) : [];
  // 累计时间轴 [起-止s]（2026-07-10 补）：存档快照此前只列镜头行不带时长，被误读成「时间轴丢了」；
  // 与正式渲染同口径带上，留痕才完整。
  let cursor = 0;
  for (const s of shots) {
    const no = s.shotNo ?? "?";
    const sec = typeof s.durationSeconds === "number" && s.durationSeconds > 0 ? s.durationSeconds : null;
    const span = sec != null ? `[${cursor}-${cursor + sec}s] ` : "";
    if (sec != null) cursor += sec;
    const lang = [readStr(s.framing), readStr(s.cameraMove)].filter(Boolean).join("/");
    const action = readStr(s.action).slice(0, 80);
    const dialogue = readStr(s.dialogue).slice(0, 60);
    lines.push(
      `${span}镜${no}｜${lang || "?"}｜${action || "?"}${dialogue ? `｜${dialogue}` : ""}`,
    );
  }
  if (!shots.length) {
    // 非结构化/未知形状：JSON 兜底截断，保证痕迹不为空。
    try {
      lines.push(JSON.stringify(clip).slice(0, 1200));
    } catch {
      /* 序列化失败就只留头部 */
    }
  }
  return lines.join("\n");
}

/** 存档节点（完整 node + data）。 */
export function buildShotArchiveNode(input: {
  runId: string;
  reason: "replace" | "reset";
  /** [slotIndex, clip] 对：replace=单段；reset=被清的全部段。 */
  entries: Array<[number, unknown]>;
  nowMs: number;
}): { nodeId: string; node: Record<string, unknown>; nodeData: Record<string, unknown> } {
  const seq = input.nowMs.toString(36);
  const slotTag =
    input.reason === "replace" ? `段${(input.entries[0]?.[0] ?? 0) + 1}` : `${input.entries.length}段`;
  const nodeId = `archive-shots-${input.runId}-${input.reason}-${seq}`;
  const label =
    input.reason === "replace"
      ? `镜头表存档｜${input.runId}·${slotTag}·替换前`
      : `镜头表存档｜${input.runId}·reset前${slotTag}`;
  const body = input.entries
    .map(([slot, clip]) => renderClipArchiveText(clip, slot))
    .join("\n\n");
  const nodeData: Record<string, unknown> = {
    kind: "text",
    label,
    prompt: `# ${label}\n（旧版镜头表快照·仅留痕，不参与生成/绑定）\n\n${body}`.slice(0, 20000),
    archiveReason: input.reason,
    archivedRunId: input.runId,
    archivedAt: new Date(input.nowMs).toISOString(),
  };
  return {
    nodeId,
    nodeData,
    node: {
      id: nodeId,
      type: "taskNode",
      // 存档区固定放画布左侧一列，按时间往下排，不与工作区节点混叠。
      position: { x: -1200, y: (input.nowMs % 12) * 180 },
      data: nodeData,
    },
  };
}

/** best-effort 落章节画布；失败只 console.warn。返回落成的 nodeId（失败 null）。 */
export async function archiveShotClipsToCanvas(input: {
  c: AppContext | undefined;
  userId: string | undefined;
  chapterId: string | undefined;
  runId: string;
  reason: "replace" | "reset";
  entries: Array<[number, unknown]>;
}): Promise<string | null> {
  if (!input.c || !input.userId || !input.chapterId || !input.entries.length) return null;
  try {
    const built = buildShotArchiveNode({
      runId: input.runId,
      reason: input.reason,
      entries: input.entries,
      nowMs: Date.now(),
    });
    await writeFinalNodeToChapterCanvas({
      c: input.c,
      userId: input.userId,
      chapterId: input.chapterId,
      nodeId: built.nodeId,
      finalNode: built.node,
      finalNodeData: built.nodeData,
    });
    return built.nodeId;
  } catch (e) {
    console.warn(
      `[shot-archive] 镜头表存档落画布失败(不阻断)：runId=${input.runId} reason=${input.reason} ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}
