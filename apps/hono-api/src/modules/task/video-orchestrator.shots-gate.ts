// 【结构化 shots 唯一路径（2026-07-04 小说→分镜改造 3.1）】
//
// 旧的自由文本 clipPrompt 直写路径下线：add_clips / estimate 首次 / start 内联 / replaceAtIndex 收到的
// 每条 clip 必须带合法 shots 结构（validateStructuredClip 过）。这里只验证可执行协议结构；
// 创作质量与知识召回只产生诊断，不取得终止权。
// 本模块纯函数、无 IO（filmBible 由调用方经 film-bible-store 取好传入），便于单测。

import {
  hasStructuredShots,
  renderClipPromptFromShots,
  validateStructuredClip,
  type FilmBible,
  type StructuredClip,
} from "./video-orchestrator.clip-shots";
import { parseAssetObjectContracts } from "./video-orchestrator.asset-object-contract";
// dialoguePaceRate 是 Agent 提交的数值事实，物理上限 6 封顶；本地不解释情景文字。
import {
  DIALOGUE_PACE_CEILING,
  parseDialoguePaceRate,
} from "./video-orchestrator.dialogue-capacity";

/** 空间调度段缺俯视站位图的提示文案。 */
export const BLOCKING_DIAGRAM_REQUIRED_PROBLEM =
  "空间调度段（对峙/打斗/追逐/走位/进出门等）缺俯视站位图——章节基本在同一场景内完成，" +
  "俯视调度是跨镜空间连贯的唯一确定性锚。两步：①本场景若无「俯视底图」节点，先用场景卡图生图转一张" +
  "俯视平面示意图（label「俯视底图｜<场景名>」，每场景一张全章复用）；②tapcanvas_render_blocking_diagram " +
  "带 backgroundImageUrl=底图URL 出本段站位图（站位 at+朝向 facingTo+走位 moveTo+机位，landmarks 与底图地物对齐），" +
  "把返回节点 id 填进本段 blockingFrameNodeId 后只重发本段。";

/** 不带 shots 的协议错误码（无法安全渲染，不进 estimate 修订循环）。 */
export const SHOTS_REQUIRED_CODE = "shots_required";

/** 修复指引（回给 LLM 的重交格式说明）。 */
export const SHOTS_REQUIRED_GUIDANCE =
  "纯文本 clipPrompt 直写路径已下线（结构化 shots 是唯一路径），本批整批未入库。请把每段改写成 shots JSON 结构重交：" +
  "每条 clip = { durationSeconds, characterRoleNames, videoReferenceNodeIds, continuityMode, assetObjectContracts, logline(一句话剧情), " +
  "continuity(多镜必写「时间连续」或跨时空说明), editRhythm(镜序递进·生成式语言), dialoguePaceRate(有 speechEvents 时必填·字/秒·来自 BeatSheet Agent), " +
  "speakerBindings:[{name,assetKind:'character'|'voice'}](有对白必填), " +
  "speechEvents:[{speechEventId,lineId,startOffset:0,endOffset,startSeconds,endSeconds,speakerName,delivery,performance}](每条冻结 line 恰好一个完整事件；禁止正文), " +
  "shots:[{shotNo, framing(景别), composition(构图/机位), cameraMove(生成式运镜·禁剪辑语法), " +
  "action(可选·确有可见动作时写主体动作+跟随动作+细微反应；静态/建立镜头可省略), lighting, speechEventIds(只引用与本镜时间窗相交的完整事件), " +
  "sound, notes(逐镜光影/连续性/执行例外备注), durationSeconds}] }。shots 禁止携带 speaker/dialogue/文本坐标；Hono 从冻结台账物化 SpeechEvent.spokenText。" +
  "全片不变段（导演基调/影调圣经/硬约束）不要写进每段——首批 add_clips 用 filmBible:{directorTone,visualBible,hardRules} 一次传，" +
  "服务端写入即校验并确定性渲染成最终提示词。";

export type ShotsGateRejection = {
  ok: false;
  code: string;
  message: string;
};

/** 按段裁决结果。最终稿只校验，不在服务端改写 writer 产物。 */
export type ShotsGateDetail = {
  /** 缺 shots 结构的段（全局 1-based 段号）——协议不完整，无法渲染提示词。 */
  missingShots: number[];
  /** 结构协议失败的段：batchIndex=本批内下标；globalNo=全局 1-based 段号。 */
  rejected: Array<{ batchIndex: number; globalNo: number; problems: string[] }>;
  /** 软问题（不拦，回显给 LLM/critic/人工）。 */
  warnings: string[];
};

/**
 * 结构化 shots 协议校验·按段诊断版：
 * ① writer、critic、estimate、start 共用同一份只读最终稿校验；
 * ② validateStructuredClip 的协议错误按**段**退回（不再整批连坐）；
 * ③ 重试次数不能改变结构事实；合格段原地写回 clip.clipPrompt。
 * @param slotNos 每段的全局 0-based 段位（报文对位用）；缺省按批内下标。
 */
export function gateAndRenderStructuredClips(input: {
  clips: readonly unknown[];
  bible: FilmBible | null;
  slotNos?: readonly number[];
  /** 供应商单镜合法档位上限（秒）：超出确定性执行边界时按段退回。 */
  maxDurationSec?: number;
  /** 当前 Run 冻结的全部合法时长档位；最终 clip 与 shots 加总必须精确命中其中一个。 */
  durationOptions?: readonly number[];
}): ShotsGateDetail {
  const { clips, bible } = input;
  const slotOf = (i: number): number => {
    const s = input.slotNos?.[i];
    return Number.isInteger(s) && (s as number) >= 0 ? (s as number) : i;
  };
  const out: ShotsGateDetail = { missingShots: [], rejected: [], warnings: [] };
  clips.forEach((raw, i) => {
    const globalNo = slotOf(i) + 1;
    if (!hasStructuredShots(raw)) {
      out.missingShots.push(globalNo);
      return;
    }
    const clip = raw as Record<string, unknown>;
    const objectContracts = clip.assetObjectContracts === undefined
      ? null
      : parseAssetObjectContracts(
          clip.assetObjectContracts,
          `clips[${String(slotOf(i))}].assetObjectContracts`,
        );
    if (objectContracts?.errors.length) {
      out.rejected.push({
        batchIndex: i,
        globalNo,
        problems: objectContracts.errors,
      });
      return;
    }
    if (objectContracts) clip.assetObjectContracts = objectContracts.contracts;
    const declaredPaceRate = parseDialoguePaceRate(clip.dialoguePaceRate);
    const paceRate = declaredPaceRate === null
      ? undefined
      : Math.min(declaredPaceRate, DIALOGUE_PACE_CEILING);
    const issues = validateStructuredClip(
      raw as StructuredClip,
      Number(clip.durationSeconds),
      paceRate,
      input.maxDurationSec,
      { durationOptions: input.durationOptions },
    );
    const renderedPrompt = renderClipPromptFromShots(raw as StructuredClip, bible);
    const fmt = (x: { shotNo: number | null; problem: string }): string =>
      (x.shotNo ? `镜${x.shotNo}·` : "") + x.problem;
    for (const x of issues.filter((x) => x.soft)) out.warnings.push(`第${globalNo}段：${fmt(x)}`);
    const hard = issues.filter((x) => !x.soft);
    if (hard.length) {
      out.rejected.push({ batchIndex: i, globalNo, problems: hard.map(fmt) });
      return;
    }
    clip.clipPrompt = renderedPrompt;
  });
  return out;
}

/**
 * 旧契约包装（estimate/start 内联 clips 入口沿用）：整批协议——任一段缺 shots 或结构错误即拒。
 * 注意：本包装不会改写任何时长或对白；最终稿不满足合同就显式拒绝。
 * @param baseIndex 全局镜号偏移（replaceAtIndex/按位提交时报「镜N」用；报文按 1-based 展示）。
 */
export function enforceStructuredShotsAndRender(input: {
  clips: readonly unknown[];
  bible: FilmBible | null;
  baseIndex?: number;
  /** 显式段位（0-based 全局镜号，非连续也可）：inline 重发只闸子集时按原段位报「第N段」。优先于 baseIndex。 */
  slotNos?: readonly number[];
  /** 模型单镜合法档位上限（秒），透传写入闸做加总可行性对账。 */
  maxDurationSec?: number;
  durationOptions?: readonly number[];
}): ShotsGateRejection | null {
  const base = Number.isInteger(input.baseIndex) && (input.baseIndex as number) >= 0 ? (input.baseIndex as number) : 0;
  const detail = gateAndRenderStructuredClips({
    clips: input.clips,
    bible: input.bible,
    slotNos: input.slotNos ?? input.clips.map((_, i) => base + i),
    maxDurationSec: input.maxDurationSec,
    durationOptions: input.durationOptions,
  });
  if (detail.missingShots.length) {
    return {
      ok: false,
      code: SHOTS_REQUIRED_CODE,
      message:
        `第${detail.missingShots.join("/")}段缺 shots 结构（只有纯文本 clipPrompt）——` +
        SHOTS_REQUIRED_GUIDANCE,
    };
  }
  if (detail.rejected.length) {
    return {
      ok: false,
      code: "shots_validation_failed",
      message:
        `结构化 shots 协议错误，本批未入库——只改报错处重发；服务端不会替 writer 改写对白或时长：\n` +
        detail.rejected.map((r) => `第${r.globalNo}段：${r.problems.join("；")}`).join("\n"),
    };
  }
  return null;
}
