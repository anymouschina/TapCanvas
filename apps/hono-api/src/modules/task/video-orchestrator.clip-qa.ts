import type { AppContext } from "../../types";

/**
 * Per-clip 审片诊断：可以用视频理解模型对照该镜的 clipPrompt 设计意图生成 verdict，
 * verdict 只落在
 * 视频节点 data 上（clipQaVerdict/clipQaReason/clipQaAttempts/clipQaFeedback）。
 *
 * 视频节点 data 上（clipQaVerdict/clipQaReason/clipQaAttempts/clipQaFeedback）。
 * 已生成 clip 不得因 verdict 被标回 failed、自动重提供应商任务或延迟拼接；修订只能由
 * 用户或后续显式授权的新版本触发。
 */

export const CLIP_QA_DEFAULT_MODEL = "doubao-seed-2-0-mini-260428";
export const CLIP_QA_MAX_ERRORS = 2;

function readEnv(c: AppContext, name: string): string {
  return String(
    ((c.env as Record<string, unknown>)?.[name] ??
      globalThis.process?.env?.[name] ??
      "") as string,
  ).trim();
}

export function resolveClipQaModel(c: AppContext): string {
  return readEnv(c, "VIDEO_CLIP_SELF_QA_MODEL") || CLIP_QA_DEFAULT_MODEL;
}

export type ClipQaVerdict = {
  pass: boolean;
  problems: string[];
  fixHints: string[];
};

export type ClipQaNodeState = {
  verdict: string;
  attempts: number;
  errors: number;
  eligible: boolean;
};

export function readClipQaNodeState(data: Record<string, unknown> | undefined): ClipQaNodeState {
  const d = data ?? {};
  const verdict = typeof d.clipQaVerdict === "string" ? d.clipQaVerdict.trim() : "";
  const attempts = Number(d.clipQaAttempts);
  const errors = Number(d.clipQaErrorCount);
  return {
    verdict,
    attempts: Number.isFinite(attempts) && attempts > 0 ? Math.trunc(attempts) : 0,
    errors: Number.isFinite(errors) && errors > 0 ? Math.trunc(errors) : 0,
    eligible: d.selfQaEligible === true,
  };
}

export function buildClipQaPrompt(input: {
  clipPrompt: string;
  durationSeconds?: number;
}): string {
  const duration = input.durationSeconds ? `${input.durationSeconds}s` : "未知";
  return [
    "你是严格的导演审片助手。下面是本镜头的设计意图（剧本+运镜要求），随后请逐条核对实际视频：",
    "",
    `【设计意图】（时长 ${duration}）`,
    input.clipPrompt,
    "",
    "【验收标准】",
    "1. 动作执行：设计的身体表演是否真实发生（不是只完成走位）；画面是否有持续动态，还是接近静帧/PPT感；",
    "2. 运镜：设计要求的镜头运动（推/拉/摇/移/跟）是否执行，还是死机位；",
    "3. 表演：人物表情是否有变化与情绪，是否木偶脸；有台词时是否有口型；",
    "4. 画面质量·去AI味：有无面部畸变、肢体错误、文字乱码、画风漂移（如实拍漂成插画/平涂）；写实/真人镜有无明显「AI 塑料味」（塑料/打蜡皮肤、过度磨皮无毛孔、画面太干净无颗粒无空气介质如渲染图、运镜死板如机位扫描，anime/二维镜不适用）。【豁免】若上方设计意图已明确声明本镜为 Q版/SD/变形/chibi 内心戏插入段（脑内会议/肩上天使恶魔/gag脸等心理外化手法的故意切画风），则「画风漂移/去AI味」一项不适用——只核 Q版风格是否前后一致、表演是否到位，不得因「不写实/像插画」判 fail；",
    "5. 空间逻辑：若本镜含进出门/上下楼/上下车/穿过门框等跨边界动作，人物与边界的空间关系必须合理——人不得凭空出现在门框/边界正中间、门板不得穿过人物、行进方向须与进/出语义一致、不得瞬移；",
    "",
    "只输出一个 JSON 对象，不要任何其它文字：",
    '{"pass": true|false, "problems": ["不达标项，每条一句话"], "fixHints": ["给重新生成的提示词修复建议，每条一句话"]}',
    "判定规则：1~5 中任何一条明显不达标即 pass=false；轻微瑕疵但整体可用则 pass=true 并在 problems 里记录。",
  ].join("\n");
}

/** 宽容解析 verdict JSON：截取首个 {...} 块；解析失败返回 null（调用方按 QA 错误计数处理）。 */
export function parseClipQaVerdict(text: string): ClipQaVerdict | null {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.pass !== "boolean") return null;
  const toLines = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  return { pass: rec.pass, problems: toLines(rec.problems), fixHints: toLines(rec.fixHints) };
}

export function formatClipQaFeedback(verdict: ClipQaVerdict): string {
  const lines = [...verdict.problems.map((p) => `问题：${p}`), ...verdict.fixHints.map((h) => `修复：${h}`)];
  return lines.join("；").slice(0, 2000);
}
