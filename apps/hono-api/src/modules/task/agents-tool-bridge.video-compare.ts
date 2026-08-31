import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { readNewApiRelay, relayCriticChat } from "../agents/agents-llm-proxy";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import type { ParentAgentExecution } from "./agent-execution-provenance";
import {
  distillDirectorBreakdownForAgent,
  type DirectorBreakdown,
} from "./agents-tool-bridge.distill-director-breakdown";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveVideoUrlFromFlowNode(row: FlowRow, nodeId: string): string {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  const node = nodes.find((n) => String(n.id ?? "") === nodeId);
  if (!node) return "";
  const d =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};
  const direct = readTrimmedString(d.videoUrl) || readTrimmedString(d.video);
  if (direct) return direct;
  const vr = Array.isArray(d.videoResults) ? d.videoResults : [];
  for (const item of vr) {
    if (item && typeof item === "object") {
      const u = readTrimmedString((item as Record<string, unknown>).url);
      if (u) return u;
    }
  }
  return "";
}

export type CompareDim = { score: number; note: string };

export type CompareScorecard = {
  dims: {
    narrative: CompareDim;
    pacing: CompareDim;
    camera: CompareDim;
    composition: CompareDim;
    consistency: CompareDim;
    overall: CompareDim;
  };
  diffs: string[];
  suggestions: string[];
};

export type VideoCompareResult = {
  ok: true;
  scorecard: CompareScorecard;
  originalBreakdown: DirectorBreakdown;
  replicaBreakdown: DirectorBreakdown;
};

const COMPARE_PROMPT_HEAD =
  "你是资深导演与剪辑监制。下面给出【原片】与【复刻片】各自的结构化导演拆解卡（同一套字段）。" +
  "你的任务是评估复刻片对原片**导演手法**的还原程度——衡量「这条片怎么拍」的可迁移功力学到了几分。" +
  "【关键评分原则·必须遵守】" +
  "①若给了【既定转换】说明（如换画风/换媒介/换主体/换比例），那是**有意的创作选择、不是缺陷**——" +
  "**绝不能因为画风/媒介/比例/主体本身与原片不同而扣分**；要在「该转换为前提」下，judge 镜头语言与叙事是否忠实迁移。" +
  "②复刻所用视频模型有**单镜最低时长**限制，无法复刻原片的亚秒级快切——因此原片多个快镜会被合理地**打包进更少的长 clip（每 clip 内部多拍硬切）**。" +
  "评 pacing/叙事时**按「原片节拍是否被覆盖、顺序对不对、片内硬切节奏感」评，不按裸镜数差扣分**。" +
  "③真正该扣分的是**导演手法层面的疏漏**：原片关键叙事/品牌/促销节拍被漏掉或张冠李戴、signature shot 落错、" +
  "机位/运镜语言（手持/低角度/跟拍律动/推拉）没还原、镜序错乱、关键动作缺失、收尾节奏不对。" +
  "请逐维以严格 JSON 返回，不要输出任何额外文字或 markdown：" +
  '{"dims":{' +
  '"narrative":{"score":0-100整数,"note":"叙事结构/节拍覆盖与顺序的还原度"},' +
  '"pacing":{"score":0-100整数,"note":"节奏还原度(按节拍覆盖+片内硬切感评，不按裸镜数扣)"},' +
  '"camera":{"score":0-100整数,"note":"机位与运镜语言还原度(手持/角度/跟拍/推拉)"},' +
  '"composition":{"score":0-100整数,"note":"景别与构图关系还原度"},' +
  '"consistency":{"score":0-100整数,"note":"复刻片自身跨镜一致性 + 内容(主体/动作/场景语义)对原片的忠实度(在既定转换前提下，不扣画风/媒介本身)"},' +
  '"overall":{"score":0-100整数,"note":"在既定转换前提下，导演手法总体学到位了几分"}},' +
  '"diffs":["复刻在导演手法层面偏离原片的具体点(可点到镜号；不要列画风/媒介本身差异)"],' +
  '"suggestions":["改进建议(可定位到镜号，指导下一轮重生)"]}';

function readDim(value: unknown): CompareDim {
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const scoreRaw = Number(obj.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 0;
  return { score, note: readTrimmedString(obj.note) };
}

function readStrArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => readTrimmedString(v)).filter((s) => s.length > 0);
}

function hasValidDim(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const dim = value as Record<string, unknown>;
  return Number.isFinite(Number(dim.score)) && typeof dim.note === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Parse the response-format JSON contract without prose/fence recovery or missing-field defaults.
 * A malformed expert result is an upstream failure and must remain observable to the caller.
 */
export function parseCompareScorecard(text: string): CompareScorecard | null {
  const trimmed = readTrimmedString(text);
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj.dims || typeof obj.dims !== "object" || Array.isArray(obj.dims)) return null;
  const dimsRaw = obj.dims as Record<string, unknown>;
  const requiredDimensions = [
    "narrative",
    "pacing",
    "camera",
    "composition",
    "consistency",
    "overall",
  ] as const;
  if (requiredDimensions.some((dimension) => !hasValidDim(dimsRaw[dimension]))) return null;
  if (!isStringArray(obj.diffs) || !isStringArray(obj.suggestions)) return null;
  return {
    dims: {
      narrative: readDim(dimsRaw.narrative),
      pacing: readDim(dimsRaw.pacing),
      camera: readDim(dimsRaw.camera),
      composition: readDim(dimsRaw.composition),
      consistency: readDim(dimsRaw.consistency),
      overall: readDim(dimsRaw.overall),
    },
    diffs: readStrArray(obj.diffs),
    suggestions: readStrArray(obj.suggestions),
  };
}

// 文本判分：只调用一次父代理本轮的精确 model + apiStyle；不切模型、不换协议。
async function judgeCompareText(input: {
  relay: { baseUrl: string; token: string };
  execution: ParentAgentExecution;
  prompt: string;
}): Promise<string> {
  const text = await relayCriticChat(input.relay, {
    model: input.execution.model,
    apiStyle: input.execution.apiStyle,
    system: COMPARE_PROMPT_HEAD,
    user: input.prompt,
    temperature: 0,
    maxTokens: 4096,
    timeoutMs: 120_000,
    responseFormat: { type: "json_object" },
  });
  if (text.trim()) return text;
  throw new AppError("对比判分未返回文本", {
    status: 502,
    code: "agents_tool_video_compare_empty",
    details: { inheritedExecution: input.execution },
  });
}

/**
 * 对比QA层（复刻=学习闭环 ④）：把【复刻成片】与【原片】各自的导演拆解卡逐维 diff 打分。
 *
 * 这是"测试&提升"的反馈信号——它衡量复刻片对原片导演意图的还原度(叙事/节奏/机位运镜/构图/一致性)，
 * 列出偏离点 + 可定位到镜号的改进建议，供小T决定是否改某镜 StoryPlan 重生(撞护栏 A 才再花钱)。
 *
 * 实现：复用 ①distill 拆解复刻片(+缺失时拆原片) → 文本模型逐维比对两张拆解卡 → CompareScorecard。
 * 原片拆解卡若调用方已有(复刻全链里①已产出)可直接传入 originalBreakdown，省一次原片理解。
 */
export async function videoCompareForAgent(input: {
  c: AppContext;
  row: FlowRow | null;
  bodyArgs: unknown;
  parentAgentExecution: ParentAgentExecution;
}): Promise<VideoCompareResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  // 复刻片 URL：replicaUrl 直接用，或 replicaNodeId 从 flow 取。
  let replicaUrl = readTrimmedString(args.replicaUrl) || readTrimmedString(args.replicaVideoUrl);
  const replicaNodeId = readTrimmedString(args.replicaNodeId);
  if (!replicaUrl && replicaNodeId) {
    if (!input.row) throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
    replicaUrl = resolveVideoUrlFromFlowNode(input.row, replicaNodeId);
  }
  if (!replicaUrl) {
    throw new AppError("replicaUrl 或 replicaNodeId(含视频) 必须提供一个", {
      status: 400,
      code: "agents_tool_video_compare_missing_replica",
    });
  }

  // 原片：优先用调用方已有的拆解卡；否则需要 originalUrl 现拆。
  const providedOriginal =
    args.originalBreakdown && typeof args.originalBreakdown === "object" && !Array.isArray(args.originalBreakdown)
      ? (args.originalBreakdown as DirectorBreakdown)
      : null;
  const originalUrl = readTrimmedString(args.originalUrl) || readTrimmedString(args.sourceUrl);
  if (!providedOriginal && !originalUrl) {
    throw new AppError("originalBreakdown 或 originalUrl 必须提供一个（作对比基准）", {
      status: 400,
      code: "agents_tool_video_compare_missing_original",
    });
  }

  const relay = readNewApiRelay(input.c);
  if (!relay) {
    throw new AppError("NEW_API 中转未配置", { status: 500, code: "new_api_not_configured" });
  }
  // 拆解复刻片（必拆）+ 原片（缺拆解卡时才拆）。
  const replicaBreakdown = (
    await distillDirectorBreakdownForAgent({ c: input.c, row: input.row, bodyArgs: { sourceUrl: replicaUrl } })
  ).breakdown;
  const originalBreakdown =
    providedOriginal ??
    (await distillDirectorBreakdownForAgent({ c: input.c, row: input.row, bodyArgs: { sourceUrl: originalUrl } }))
      .breakdown;

  // 既定转换说明（如「anime 重绘真人原片，媒介/画风改变是有意的」）——告诉 judge 哪些差异不该扣分。
  const intendedTransform =
    readTrimmedString(args.intendedTransform) || readTrimmedString(args.styleNote);
  const transformBlock = intendedTransform
    ? `\n\n【既定转换·不得据此扣分】\n${intendedTransform}`
    : "";
  const prompt =
    `${transformBlock}\n\n【原片拆解卡】\n${JSON.stringify(originalBreakdown)}\n\n【复刻片拆解卡】\n${JSON.stringify(replicaBreakdown)}`;
  const text = await judgeCompareText({
    relay,
    execution: input.parentAgentExecution,
    prompt,
  });
  const scorecard = parseCompareScorecard(text);
  if (!scorecard) {
    throw new AppError("对比判分未返回可解析的评分卡", {
      status: 502,
      code: "agents_tool_video_compare_unparseable",
    });
  }

  return { ok: true, scorecard, originalBreakdown, replicaBreakdown };
}
