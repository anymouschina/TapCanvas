// 【结构化镜头表·shots JSON（2026-07-04 用户拍板）】clipPrompt 从自由文本八段改为结构化源：
// clips[].shots[] 字段化 + run 级 filmBible（全片圣经一次写）。核心收益：
// ① 写入时逐字段确定性校验（时长加总/对白容量/剪辑语法禁词/时空标注）——表单不合格提交不进去，
//    estimate「改→再估」修订循环从机制上消失；
// ② 最终提示词由本模块确定性渲染成**纯文本**（模型只认文本；JSON 只是编辑/校验/传输的中间表示）；
// ③ LLM 不再逐段重复吐几百字圣经（影调/硬约束进 filmBible），输出省 ~40-50%。
// 不带 shots 的 clip 由入口硬拒；说话人身份同样只认结构化 speakerBindings，禁止从文案猜。

import {
  readClipSpeakerBindings,
  type ClipSpeakerBinding,
} from "./video-orchestrator.speaker-contract";
import {
  assetObjectContractIdentityKey,
  formatAssetObjectReferenceLocks,
  type AssetReferenceIndicesByContractKey,
  type AssetObjectContract,
} from "./video-orchestrator.asset-object-contract";
import type { ClipDramaticCoverage } from "./video-orchestrator.dramatic-coverage";
import type {
  BeatCharacterStateVersions,
  BeatSceneState,
  BeatTemporalContext,
} from "./video-orchestrator.temporal-state-contract";
import type {
  BeatContinuityLedger,
  VisualStateAnchorRequirement,
} from "./video-orchestrator.visual-state-timeline";
import type { TemporalFrameWindow } from "./video-orchestrator.temporal-frame-track";

/**
 * 由 agent 在高动力镜头中显式选择的相对运动学合同。
 *
 * 这是导演级相对量纲，不是物理仿真或精确计量；它只让模型区分瞬间、快慢、冲击与制动。
 * 后端只检查枚举和对象结构，绝不从 action 文本推断一镜是否属于打斗。
 */
export type ShotMotionDynamics = {
  subject?: string;
  tempo: "instant" | "fast" | "sustained";
  force: "light" | "medium" | "heavy";
  direction: "left" | "right" | "forward" | "backward" | "upward" | "downward" | "diagonal";
  airborne: "none" | "brief" | "extended";
  rotation: "none" | "partial" | "full";
  brakingMode: "ground_friction" | "wall_impact" | "grip" | "counterforce";
  impactSurface?: "ground" | "wall" | "water" | "object";
  environmentalResponse: "none" | "dust" | "debris" | "splash" | "deformation";
};

export type ClipShot = {
  /** 镜号（1 起，clip 内局部）。 */
  shotNo?: number;
  /** 本镜唯一要让观众读到的信息变化；由 writer 做语义导演判断，服务端只透传。 */
  visualTask?: string;
  /**
   * 本镜实际拍出的冻结 storyEvents 下标。writer 对语义映射负责；
   * 服务端只校验整数引用、顺序与覆盖闭包，不从 visualTask/action 猜剧情。
   */
  depictedStoryEventIndices?: number[];
  /** 景别：远/全/中/中近/近/特写…（自由词，非枚举）。 */
  framing?: string;
  /** 焦段/透视的叙事用途；不要求捏造器材或毫米数。 */
  lensIntent?: string;
  /** 构图/机位。 */
  composition?: string;
  /** 运镜（推/拉/摇/移/跟…；必须是生成式运镜，禁剪辑语法）。 */
  cameraMove?: string;
  /** 可见动作；静态或建立镜头允许省略，visualTask 仍是必需的执行画面载体。 */
  action?: string;
  /** 光效。 */
  lighting?: string;
  /** 当前动作与光线下可见的材质、表面和介质响应。 */
  materialResponse?: string;
  /** 与本镜时间窗相交的独立人声事件 ID；镜头切换不切分 spokenText。 */
  speechEventIds?: string[];
  /** 音效/环境音。 */
  sound?: string;
  /** 声场跟随谁、远近层次及收窄/恢复方式；不得承载可朗读文本。 */
  soundPerspective?: string;
  /** 逐镜备注：仅写光影、连续性接力、OS 闭唇或超 3 秒等执行例外，不承载新剧情。 */
  notes?: string;
  /** 本镜秒数。 */
  durationSeconds: number;
  /** 高动力镜头的显式运动学合同；缺省表示 agent 未将本镜声明为这类运动。 */
  motionDynamics?: ShotMotionDynamics;
};

export type ClipSpeechEvent = {
  /** clip 内稳定且唯一的人声事件 ID。 */
  speechEventId: string;
  /** BeatSheet 合并冻结人声脚本中的稳定行 ID。 */
  lineId: string;
  /** 冻结原文 Unicode 半开区间起点；v2 必须为 0。 */
  startOffset: number;
  /** 冻结原文 Unicode 半开区间终点；v2 必须为整行码点长度。 */
  endOffset: number;
  /** 独立于 shot 的发声起点。 */
  startSeconds: number;
  /** 独立于 shot 的发声终点；允许跨越多个镜头。 */
  endSeconds: number;
  /** canonical 说话人名，必须命中 speakerBindings。 */
  speakerName: string;
  delivery: "on_screen" | "off_screen" | "voice_over";
  /** 不可朗读的语速、音量、呼吸、停连、重音与潜台词控制。 */
  performance?: string;
  /** 服务端从冻结脚本物化的逐字正文；writer 禁止提交。 */
  spokenText?: string;
};

export type StructuredClip = {
  /** logline（本段一句话剧情）。 */
  logline?: string;
  /** 时空标注：同一时间线连续 / 跨时空说明（多拍同 clip 必写"时间连续"）。 */
  continuity?: string;
  /** 剪辑节奏说明（镜序递进，仍是生成式语言）。 */
  editRhythm?: string;
  /** 退出态（≤80字）：技术窗口结束时谁在哪/姿态/视线/道具/光线；不自动等于戏剧收束。 */
  exitState?: string;
  /** Beat-owned 时间层与人物状态继承作用域。 */
  temporalContext?: BeatTemporalContext;
  /** Beat-owned 子场景入口/退出事实。 */
  sceneState?: BeatSceneState;
  /** 角色状态卡 stateKey 映射。 */
  characterStates?: Record<string, string>;
  /** 无论是否存在状态卡都必须进入执行提示词的可见人物状态。 */
  characterStateVersions?: BeatCharacterStateVersions;
  /** 当前 clip 使用的章级视觉状态版本外键。 */
  visualStateRefs?: Record<string, string[]>;
  /** Beat-owned clip 边界稳定事实。 */
  continuityLedger?: BeatContinuityLedger;
  /** 当前状态区间需要的状态锚；prompt_only 可保留为未物化清单。 */
  visualStateAnchorRequirements?: VisualStateAnchorRequirement[];
  /** 说话人资产契约：character 需要角色卡+配音卡；voice 是不入画的纯声音通道，只需配音卡。 */
  speakerBindings?: ClipSpeakerBinding[];
  /** 独立于视觉镜头的唯一人声时间线。 */
  speechEvents?: ClipSpeechEvent[];
  /** 完整对象事实供 writer 与执行层使用；最终提示词只渲染紧凑参考锁定，运动事实落入 shots。 */
  assetObjectContracts?: AssetObjectContract[];
  /** 每个不超过 1 秒的起帧→可见过渡→承帧状态轨。 */
  temporalFrameTrack?: TemporalFrameWindow[];
  /** writer 声明的戏剧合同逐镜承载证据；不等同于成片质量证明。 */
  dramaticCoverage?: ClipDramaticCoverage;
  shots: ClipShot[];
};

export type StructuredClipExecutionContractIssue = {
  /** JSON path relative to the clip object. */
  path: string;
  problem: string;
};

/**
 * Typed deterministic-schema failure raised at the single creative-to-execution
 * compiler boundary. Callers can route the exact invalid JSON paths back to the
 * owning writer without inspecting human-readable error prose.
 */
export class StructuredClipExecutionContractError extends Error {
  readonly code = "structured_clip_execution_contract_invalid";

  constructor(readonly issues: readonly StructuredClipExecutionContractIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.problem}`).join("；"));
    this.name = "StructuredClipExecutionContractError";
  }
}

/**
 * Validate only executable structure. This deliberately does not score or
 * interpret creative prose; it checks the JSON shape that the downstream
 * StoryPlan parser is guaranteed to require. `visualTask` is required because
 * it is the structural carrier for the shot's one visible information change;
 * this is not a word-count or semantic-quality score.
 */
export function validateStructuredClipExecutionContract(
  clip: StructuredClip & Record<string, unknown>,
): StructuredClipExecutionContractIssue[] {
  const issues: StructuredClipExecutionContractIssue[] = [];
  const clipDurationSeconds = Number(clip.durationSeconds);
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) {
    issues.push({ path: "durationSeconds", problem: "必须是大于 0 的有限数字" });
  }
  let shotDurationSum = 0;
  clip.shots.forEach((rawShot, shotIndex) => {
    if (!rawShot || typeof rawShot !== "object" || Array.isArray(rawShot)) {
      issues.push({ path: `shots[${shotIndex}]`, problem: "必须是对象" });
      return;
    }
    const shot = rawShot as unknown as Record<string, unknown>;
    const shotNo = Number(shot.shotNo);
    if (!Number.isInteger(shotNo) || shotNo !== shotIndex + 1) {
      issues.push({
        path: `shots[${shotIndex}].shotNo`,
        problem: `必须是从 1 开始且按数组顺序连续的整数，期望 ${shotIndex + 1}，实收 ${String(shot.shotNo)}`,
      });
    }
    if (shot.action !== undefined && typeof shot.action !== "string") {
      issues.push({ path: `shots[${shotIndex}].action`, problem: "提供时必须是字符串" });
    }
    if (typeof shot.visualTask !== "string" || !shot.visualTask.trim()) {
      issues.push({
        path: `shots[${shotIndex}].visualTask`,
        problem: "必须是非空字符串；每镜必须声明一个独立的可见信息变化",
      });
    }
    if (!Array.isArray(shot.depictedStoryEventIndices) || shot.depictedStoryEventIndices.length === 0) {
      issues.push({
        path: `shots[${shotIndex}].depictedStoryEventIndices`,
        problem: "必须是非空整数数组；由 writer 显式声明本镜实际拍出的冻结 storyEvent 下标",
      });
    } else {
      const indices = shot.depictedStoryEventIndices;
      for (const [eventIndex, value] of indices.entries()) {
        if (!Number.isInteger(value) || Number(value) < 0) {
          issues.push({
            path: `shots[${shotIndex}].depictedStoryEventIndices[${eventIndex}]`,
            problem: "必须是大于等于 0 的整数",
          });
        }
        if (eventIndex > 0 && Number(indices[eventIndex - 1]) >= Number(value)) {
          issues.push({
            path: `shots[${shotIndex}].depictedStoryEventIndices`,
            problem: "必须严格递增且不得重复",
          });
          break;
        }
      }
    }
    const durationSeconds = Number(shot.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      issues.push({
        path: `shots[${shotIndex}].durationSeconds`,
        problem: "必须是大于 0 的有限数字",
      });
    } else {
      shotDurationSum += durationSeconds;
    }
    const dynamics = parseShotMotionDynamics(shot.motionDynamics);
    for (const problem of dynamics.errors) {
      const field = problem.split(" ", 1)[0]?.trim();
      issues.push({
        path: `shots[${shotIndex}].motionDynamics${field ? `.${field}` : ""}`,
        problem,
      });
    }
  });
  if (
    Number.isFinite(clipDurationSeconds) &&
    clipDurationSeconds > 0 &&
    normalizeShotDurationSeconds(shotDurationSum) !== normalizeShotDurationSeconds(clipDurationSeconds)
  ) {
    issues.push({
      path: "shots",
      problem: `durationSeconds 加总必须精确等于 clip.durationSeconds=${clipDurationSeconds}，实收 ${shotDurationSum}`,
    });
  }
  return issues;
}

/**
 * The authoring renderer cannot know the final provider audio manifest yet.
 * It reserves one exact address inside the authoritative voice track; the
 * paid submission boundary must replace it with the verified @音频N mapping.
 */
export const VOICE_REFERENCE_BINDING_PLACEHOLDER =
  "__TAPCANVAS_VERIFIED_VOICE_REFERENCE_BINDINGS__";


/** 对持久化/工具输入进行纯结构归一；不读取或解释 action 文案。 */
export function parseShotMotionDynamics(raw: unknown): {
  value: ShotMotionDynamics | null;
  errors: string[];
} {
  if (raw === undefined || raw === null) return { value: null, errors: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: null, errors: ["motionDynamics 必须是对象"] };
  }
  const record = raw as Record<string, unknown>;
  const tempo = record.tempo;
  const force = record.force;
  const direction = record.direction;
  const airborne = record.airborne;
  const rotation = record.rotation;
  const brakingMode = record.brakingMode;
  const environmentalResponse = record.environmentalResponse;
  const errors: string[] = [];
  if (tempo !== "instant" && tempo !== "fast" && tempo !== "sustained") errors.push("tempo 必须是 instant/fast/sustained");
  if (force !== "light" && force !== "medium" && force !== "heavy") errors.push("force 必须是 light/medium/heavy");
  if (direction !== "left" && direction !== "right" && direction !== "forward" && direction !== "backward" && direction !== "upward" && direction !== "downward" && direction !== "diagonal") errors.push("direction 必须是 left/right/forward/backward/upward/downward/diagonal");
  if (airborne !== "none" && airborne !== "brief" && airborne !== "extended") errors.push("airborne 必须是 none/brief/extended");
  if (rotation !== "none" && rotation !== "partial" && rotation !== "full") errors.push("rotation 必须是 none/partial/full");
  if (brakingMode !== "ground_friction" && brakingMode !== "wall_impact" && brakingMode !== "grip" && brakingMode !== "counterforce") {
    errors.push("brakingMode 必须是 ground_friction/wall_impact/grip/counterforce");
  }
  const impactSurface = record.impactSurface;
  if (impactSurface !== undefined && impactSurface !== "ground" && impactSurface !== "wall" && impactSurface !== "water" && impactSurface !== "object") {
    errors.push("impactSurface 必须是 ground/wall/water/object");
  }
  if (environmentalResponse !== "none" && environmentalResponse !== "dust" && environmentalResponse !== "debris" && environmentalResponse !== "splash" && environmentalResponse !== "deformation") errors.push("environmentalResponse 必须是 none/dust/debris/splash/deformation");
  if (errors.length) return { value: null, errors };
  const subject = typeof record.subject === "string" && record.subject.trim() ? record.subject.trim() : undefined;
  return {
    value: {
      tempo,
      force,
      direction,
      airborne,
      rotation,
      brakingMode,
      environmentalResponse,
      ...(subject ? { subject } : {}),
      ...(impactSurface !== undefined ? { impactSurface } : {}),
    },
    errors: [],
  };
}

/** run 级全片圣经：全片不变段一次写，渲染时前置进每条 clip。 */
export type FilmBible = {
  /** 导演人设/核心基调（原八段①）。 */
  directorTone?: string;
  /** 影调·光线·色彩·质感·调色（原八段⑤）。 */
  visualBible?: string;
  /** 整章观众情绪曲线：每拍情绪计划必须服从这一条全局弧线。 */
  emotionalArc?: string;
  /** 逐角色人物弧：供 writer 把选择与后果落实为 shots，不直接复写进最终视频提示词。 */
  characterArcs?: string;
  /** 角色服装、场景拓扑、道具状态与光线方向的全片固定合同。 */
  continuityBible?: string;
  /** 功能性空镜策略；未被 BeatSheet 显式规划的镜不得自行添加装饰性 B-roll。 */
  atmosphereStrategy?: string;
  /** 硬约束（原八段⑦：无BGM/无字幕/语言/守轴线…）。 */
  hardRules?: string;
  /** 视觉母题登记（可选·2026-07-04 设计 3.4）：如「烛火=善意→杀机状态机」，run 级一等公民。 */
  motifs?: string;
};

// ———— adaptationStrategy（来源结构注记）——————————————————————————————————
// 首批 add_clips 可随 filmBible 同机制提交、随 run 持久化；服务端只做存在性+最小字段校验（软性）。
// 一键成片的忠实原文主路径由 BeatSheet sourceTreatment/source markers 负责；critic 不再读取或评分本字段。

export type AdaptationReversal = {
  /** 预埋点全局镜号（0-based）。 */
  plantClipIndex?: number;
  /** 揭晓点全局镜号（0-based）。 */
  revealClipIndex?: number;
  /** 这条反转是什么（预埋了什么、揭晓时翻出什么）。 */
  desc?: string;
};

export type AdaptationCut = {
  /** 删/并了原文的什么。 */
  what?: string;
  /** 为什么删得对（节奏/视觉不可拍/信息冗余…）。 */
  why?: string;
};

export type AdaptationStrategy = {
  /** 反转登记表：每条含预埋点 clipIndex → 揭晓点 clipIndex。 */
  reversals: AdaptationReversal[];
  /** 删减/合并决策表（机检管「漏没漏」，此表管「删得对不对」）。 */
  cuts: AdaptationCut[];
  /** 结尾钩子设计（一句话）。 */
  hook: string;
};

/**
 * 最小字段校验+归一（软性）：接受对象或被 arg-stringify 成 JSON 字符串的对象；
 * 三件（reversals/cuts/hook）全空视同未提交，返回 null。绝不抛。
 */
export function normalizeAdaptationStrategy(raw: unknown): AdaptationStrategy | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s.startsWith("{")) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const reversals: AdaptationReversal[] = Array.isArray(r.reversals)
    ? (r.reversals as unknown[])
        .map((item): AdaptationReversal | null => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const o = item as Record<string, unknown>;
          const plant = Number(o.plantClipIndex);
          const reveal = Number(o.revealClipIndex);
          const desc = String(o.desc ?? "").trim();
          const out: AdaptationReversal = {
            ...(Number.isInteger(plant) && plant >= 0 ? { plantClipIndex: plant } : {}),
            ...(Number.isInteger(reveal) && reveal >= 0 ? { revealClipIndex: reveal } : {}),
            ...(desc ? { desc } : {}),
          };
          return Object.keys(out).length ? out : null;
        })
        .filter((x): x is AdaptationReversal => x !== null)
    : [];
  const cuts: AdaptationCut[] = Array.isArray(r.cuts)
    ? (r.cuts as unknown[])
        .map((item): AdaptationCut | null => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const o = item as Record<string, unknown>;
          const what = String(o.what ?? "").trim();
          const why = String(o.why ?? "").trim();
          const out: AdaptationCut = { ...(what ? { what } : {}), ...(why ? { why } : {}) };
          return Object.keys(out).length ? out : null;
        })
        .filter((x): x is AdaptationCut => x !== null)
    : [];
  const hook = String(r.hook ?? "").trim();
  if (!reversals.length && !cuts.length && !hook) return null;
  return { reversals, cuts, hook };
}

// 剪辑语法禁词硬拒收已整体移除（2026-07-09 用户拍板「闸全移除·纯靠子agent」）：定格/升格等由
// shot_table_critic 按语义判（收尾姿势/表演凝滞合法，task 2040 实证；真剪辑台效果才提示改写）。

/** 对白字数（去标点/空白/括注，与 dialogue-capacity 口径一致的近似）。 */
export function countDialogueChars(dialogue: string): number {
  return String(dialogue || "")
    .replace(/[\s。，、！？…·—\-.,!?：:；;（）()「」『』""''"']/g, "").length;
}

/**
 * Remove IEEE-754 noise from duration arithmetic without snapping to a nearby
 * legal duration option. A writer's duration contract remains authoritative;
 * this only makes `14.000000000000002` compare as the exact 14 seconds it is.
 */
export function normalizeShotDurationSeconds(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export type ShotsValidationIssue = {
  shotNo: number | null;
  problem: string;
  /** true=软问题：不拒收，降级为警告回显（2026-07-06 容错改造·质检轮次上限 1）。 */
  soft?: boolean;
};

// stripEditGrammarTerms 已随禁词检移除删除（2026-07-09）：不再 mutate 用户内容。

/**
 * 写入时确定性校验（表单级·不合格拒收）。
 * @param paceRate 对白语速（字/秒）；有 speechEvents 时必须来自 BeatSheet Agent 的冻结数值，宿主不设默认值。
 * @param maxDurationSec 模型单镜合法档位上限（秒）。给了则做可行性对账：镜长加总超上限=硬伤按段退回
 *   ——最终稿会在此显式失败，不允许后续阶段吸附或钳位。缺省不查上限。
 */
export function validateStructuredClip(
  clip: StructuredClip,
  clipDurationSeconds: number,
  paceRate?: number,
  maxDurationSec?: number,
  options?: { durationOptions?: readonly number[] },
): ShotsValidationIssue[] {
  const issues: ShotsValidationIssue[] = [];
  const shots = Array.isArray(clip?.shots) ? clip.shots : [];
  if (!shots.length) return [{ shotNo: null, problem: "shots 为空——结构化 clip 至少要有 1 镜" }];
  const speakerContract = readClipSpeakerBindings(clip);
  for (const issue of speakerContract.issues) {
    issues.push({
      shotNo: null,
      problem: `${issue.path}：${issue.problem}`,
    });
  }
  const target = normalizeShotDurationSeconds(Number(clipDurationSeconds));
  const eventIds = new Set<string>();
  const eventWindows = new Map<string, Readonly<{ startSeconds: number; endSeconds: number }>>();
  const clipRecord = clip as unknown as Record<string, unknown>;
  const speechEvents = Array.isArray(clipRecord.speechEvents) ? clipRecord.speechEvents : [];
  const hasExecutablePaceRate = Number.isFinite(paceRate) && Number(paceRate) > 0;
  if (speechEvents.length > 0 && !hasExecutablePaceRate) {
    issues.push({
      shotNo: null,
      problem: "存在 speechEvents 时 dialoguePaceRate 必须由 BeatSheet Agent 明确提交；宿主不再以固定 4 字/秒继续编译",
    });
  }
  speechEvents.forEach((rawEvent, eventIndex) => {
    const path = `speechEvents[${eventIndex}]`;
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      issues.push({ shotNo: null, problem: `${path} 必须是对象` });
      return;
    }
    const event = rawEvent as Record<string, unknown>;
    const speechEventId = typeof event.speechEventId === "string" ? event.speechEventId.trim() : "";
    const lineId = typeof event.lineId === "string" ? event.lineId.trim() : "";
    const speakerName = typeof event.speakerName === "string" ? event.speakerName.trim() : "";
    const spokenText = typeof event.spokenText === "string" ? event.spokenText : "";
    const textLength = Array.from(spokenText).length;
    const startOffset = Number(event.startOffset);
    const endOffset = Number(event.endOffset);
    const startSeconds = Number(event.startSeconds);
    const endSeconds = Number(event.endSeconds);
    const durationSeconds = endSeconds - startSeconds;
    if (!speechEventId) {
      issues.push({ shotNo: null, problem: `${path}.speechEventId 缺失` });
    } else if (eventIds.has(speechEventId)) {
      issues.push({ shotNo: null, problem: `${path}.speechEventId 重复：${speechEventId}` });
    } else {
      eventIds.add(speechEventId);
      if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds) {
        eventWindows.set(speechEventId, { startSeconds, endSeconds });
      }
    }
    if (!lineId || !speakerName) {
      issues.push({ shotNo: null, problem: `${path} 缺少 lineId 或 speakerName` });
    }
    if (event.delivery !== "on_screen" && event.delivery !== "off_screen" && event.delivery !== "voice_over") {
      issues.push({ shotNo: null, problem: `${path}.delivery 必须是 on_screen、off_screen 或 voice_over` });
    }
    if (!Number.isInteger(startOffset) || startOffset !== 0
      || !Number.isInteger(endOffset) || endOffset !== textLength) {
      issues.push({
        shotNo: null,
        problem: `${path} 必须完整覆盖物化正文 Unicode [0,${textLength})，实收 [${String(event.startOffset)},${String(event.endOffset)})`,
      });
    }
    if (!spokenText) {
      issues.push({ shotNo: null, problem: `${path}.spokenText 尚未由冻结人声台账物化` });
    }
    if (!Number.isFinite(startSeconds) || startSeconds < 0
      || !Number.isFinite(endSeconds) || endSeconds <= startSeconds
      || (Number.isFinite(target) && target > 0 && endSeconds > target)) {
      issues.push({
        shotNo: null,
        problem: `${path} 的独立发声窗口必须位于 clip [0,${String(target)}] 秒内且 endSeconds > startSeconds`,
      });
    }
    const chars = countDialogueChars(spokenText);
    const capacity = hasExecutablePaceRate
      ? Math.floor((Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0) * Number(paceRate))
      : 0;
    if (chars > 0 && capacity > 0 && chars > capacity) {
      issues.push({
        shotNo: null,
        problem: `人声事件超容：${path} ${chars}字 > ${durationSeconds}s×${String(paceRate)}字/s=${capacity}字——扩大完整事件窗口或由父级调整合法 clip 时长，禁止拆词、改词或提高无依据语速`,
      });
    }
  });
  let sum = 0;
  shots.forEach((s, i) => {
    const no = typeof s.shotNo === "number" ? s.shotNo : i + 1;
    const shotRecord = s as unknown as Record<string, unknown>;
    const legacySpeechFields = [
      "speakerName",
      "dialogue",
      "dialogueText",
      "dialogueLineId",
      "dialogueStartOffset",
      "dialogueEndOffset",
      "dialogueDelivery",
      "dialoguePerformance",
    ].filter((field) => Object.prototype.hasOwnProperty.call(shotRecord, field));
    if (legacySpeechFields.length > 0) {
      issues.push({
        shotNo: no,
        problem: `shot 级人声字段已移除：${legacySpeechFields.join(", ")}；只允许 speechEventIds`,
      });
    }
    const dur = Number(s.durationSeconds);
    if (!Number.isFinite(dur) || dur <= 0) {
      issues.push({ shotNo: no, problem: `durationSeconds 缺失/非法（${s.durationSeconds}）` });
    } else {
      sum += dur;
    }
    const motionDynamics = parseShotMotionDynamics(s.motionDynamics);
    for (const problem of motionDynamics.errors) {
      issues.push({ shotNo: no, problem: `motionDynamics.${problem}` });
    }
    const references = Array.isArray(s.speechEventIds) ? s.speechEventIds : [];
    const normalizedReferences = references
      .filter((eventId): eventId is string => typeof eventId === "string" && Boolean(eventId.trim()))
      .map((eventId) => eventId.trim());
    if (references.some((eventId) => typeof eventId !== "string" || !eventId.trim())) {
      issues.push({ shotNo: no, problem: "speechEventIds 必须是非空字符串 ID 数组" });
    }
    if (new Set(normalizedReferences).size !== normalizedReferences.length) {
      issues.push({ shotNo: no, problem: "speechEventIds 不得重复引用同一人声事件" });
    }
    for (const eventId of normalizedReferences) {
      if (!eventIds.has(eventId)) {
        issues.push({ shotNo: no, problem: `speechEventIds 引用了不存在的人声事件 ${JSON.stringify(eventId)}` });
      }
    }
    if (Number.isFinite(dur) && dur > 0) {
      const shotStartSeconds = sum - dur;
      const shotEndSeconds = sum;
      for (const [eventId, window] of eventWindows) {
        const intersects = window.startSeconds < shotEndSeconds && window.endSeconds > shotStartSeconds;
        const referenced = normalizedReferences.includes(eventId);
        if (intersects !== referenced) {
          issues.push({
            shotNo: no,
            problem: intersects
              ? `speechEventIds 缺少与本镜 ${shotStartSeconds}-${shotEndSeconds}s 相交的人声事件 ${eventId}`
              : `speechEventIds 引用了不与本镜 ${shotStartSeconds}-${shotEndSeconds}s 相交的人声事件 ${eventId}`,
          });
        }
      }
    }
  });
  const durationMismatchTolerance = 0.05;
  const normalizedSum = normalizeShotDurationSeconds(sum);
  if (Number.isFinite(target) && target > 0 && Math.abs(normalizedSum - target) > durationMismatchTolerance) {
    issues.push({
      shotNo: null,
      problem: `各镜时长加总 ${sum}s ≠ clip durationSeconds ${target}s（最终稿必须精确一致，修正后再送审）`,
    });
  }
  const cap = Number(maxDurationSec);
  const durationLimitTolerance = 0;
  if (Number.isFinite(cap) && cap > 0 && normalizedSum > cap + durationLimitTolerance) {
    issues.push({
      shotNo: null,
      problem:
        `clip_capacity_requires_split：各镜时长加总 ${sum}s 超模型单 clip 上限 ${cap}s。` +
        `当前模型真实上限 ${cap}s 是供应商执行边界，不是叙事边界；禁止钳位、吞掉尾拍、压缩对白或在本地擅自改写。` +
        `请回到 loop 的段落规划层，根据完整故事因果、对白和动作边界拆成多个连续 clip，分别使用合法 durationOptions，` +
        `并为每段重新声明 startState/endState、continuityMode 与 sourceStartMarker/sourceEndMarker。`,
    });
  }
  const durationOptions = Array.from(
    new Set(
      (options?.durationOptions ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ).sort((a, b) => a - b);
  if (durationOptions.length > 0) {
    const allowed = durationOptions.join("/");
    if (!Number.isFinite(target) || !durationOptions.includes(target)) {
      issues.push({
        shotNo: null,
        problem: `clip durationSeconds ${String(clipDurationSeconds)}s 不在模型合法档位 [${allowed}]s 中——禁止吸附、钳位或猜测时长`,
      });
    }
    if (!durationOptions.includes(normalizedSum)) {
      issues.push({
        shotNo: null,
        problem: `各镜时长加总 ${sum}s 不在模型合法档位 [${allowed}]s 中——必须在 writer 最终稿内精确重排到合法档位`,
      });
    }
  }
  if (shots.length > 1 && !String(clip.continuity ?? "").trim()) {
    // 软问题（2026-07-06 容错改造）：文本层缺标注不值得整段退回重写，降级为警告回显。
    issues.push({
      shotNo: null,
      problem: "多镜 clip 缺 continuity 时空标注（不写「时间连续」模型会当独立画面=碎镜）",
      soft: true,
    });
  }
  return issues;
}

/** 确定性渲染：shots JSON + filmBible → 最终纯文本提示词（模型只认文本）。 */
export type ClipPromptRenderOptions = {
  /**
   * 最终 referenceMediaManifest 的精确资产身份与 content[] 顺序。
   * renderer 用它统一渲染视觉资产锁和画内说话人，不接受 authoring 阶段预估图序。
   */
  assetReferenceIndicesByContractKey?: AssetReferenceIndicesByContractKey;
  /**
   * Frozen audio delivery authority for this provider request. `manifest`
   * reserves the single VoiceManifest binding address; `provider_native`
   * keeps SpeechEvent timing/text authoritative without claiming that an
   * external timbre asset exists.
   */
  voiceReferenceMode?: "manifest" | "provider_native";
};

type ProviderTemporalStateWindow = Pick<
  TemporalFrameWindow,
  "startSeconds" | "endSeconds" | "startState" | "transition" | "carryState"
>;

/**
 * The durable temporal track keeps every <=1s audit window. The provider text
 * does not need to repeat adjacent windows whose executable state payload is
 * byte-for-byte identical, so collapse only those contiguous runs. This is a
 * presentation projection: it performs no prose interpretation, rewriting, or
 * post-failure repair, and the full track remains on the structured clip.
 */
function compactProviderTemporalStateWindows(
  windows: readonly TemporalFrameWindow[],
): ProviderTemporalStateWindow[] {
  const compacted: ProviderTemporalStateWindow[] = [];
  for (const window of windows) {
    const previous = compacted.at(-1);
    if (
      previous
      && previous.endSeconds === window.startSeconds
      && previous.startState === window.startState
      && previous.transition === window.transition
      && previous.carryState === window.carryState
    ) {
      previous.endSeconds = window.endSeconds;
      continue;
    }
    compacted.push({
      startSeconds: window.startSeconds,
      endSeconds: window.endSeconds,
      startState: window.startState,
      transition: window.transition,
      carryState: window.carryState,
    });
  }
  return compacted;
}

/**
 * Inject verified timbre-reference bindings at the single address reserved by
 * the structured renderer. Appending a second audio instruction block is
 * forbidden because it creates competing speech authorities for native-audio
 * video models.
 */
export function bindVerifiedVoiceReferences(
  prompt: string,
  bindingInstruction: string,
): string {
  const source = String(prompt ?? "");
  const binding = String(bindingInstruction ?? "").trim();
  if (!binding) throw new Error("voice_reference_binding_instruction_required");
  const first = source.indexOf(VOICE_REFERENCE_BINDING_PLACEHOLDER);
  if (first < 0) throw new Error("voice_reference_binding_placeholder_missing");
  if (source.indexOf(VOICE_REFERENCE_BINDING_PLACEHOLDER, first + 1) >= 0) {
    throw new Error("voice_reference_binding_placeholder_duplicated");
  }
  return source.replace(VOICE_REFERENCE_BINDING_PLACEHOLDER, binding);
}

export function renderClipPromptFromShots(
  clip: StructuredClip,
  _bible?: FilmBible | null,
  options?: ClipPromptRenderOptions,
): string {
  const fmtSec = (value: number): string => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  const serialize = (value: unknown): string => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("structured_clip_prompt_value_not_serializable");
    return serialized;
  };
  const cell = (value: unknown): string => serialize(value).trim().replace(/\r?\n/g, " ").replace(/\|/g, "／");
  const speechRows = (clip.speechEvents ?? []).map((event) => {
    const speakerImageReference = options?.assetReferenceIndicesByContractKey?.get(
      assetObjectContractIdentityKey("character", event.speakerName),
    )?.[0];
    const speaker = speakerImageReference
      ? `${speakerImageReference}（${event.speakerName}）`
      : event.speakerName;
    return `${event.speechEventId} | ${fmtSec(event.startSeconds)}-${fmtSec(event.endSeconds)}s | Speaker=${cell(speaker)} | Delivery=${event.delivery}${event.performance ? ` | Performance=${JSON.stringify(event.performance)}` : ""} | SpokenText=${JSON.stringify(event.spokenText ?? "")}`;
  });

  let elapsedSeconds = 0;
  const shotRows = (clip.shots ?? []).map((shot, index) => {
    const durationSeconds = Number(shot.durationSeconds);
    const startSeconds = elapsedSeconds;
    const endSeconds = elapsedSeconds + durationSeconds;
    elapsedSeconds = endSeconds;
    const stateWindows = compactProviderTemporalStateWindows(
      (clip.temporalFrameTrack ?? []).filter((window) => (
        window.startSeconds < endSeconds && window.endSeconds > startSeconds
      )),
    );
    const state = stateWindows.map((window) => (
      `${fmtSec(window.startSeconds)}-${fmtSec(window.endSeconds)}:${window.startState}→${window.transition}→${window.carryState}`
    )).join("；");
    const visual = [
      shot.visualTask,
      shot.action,
      shot.framing,
      shot.lensIntent,
      shot.composition,
      shot.cameraMove,
      shot.lighting,
      shot.materialResponse,
      state ? `状态=${state}` : "",
    ].map(cell).filter(Boolean).join("；");
    const sfx = [shot.soundPerspective, shot.sound].map(cell).filter(Boolean).join("；");
    return `${shot.shotNo ?? index + 1} | ${fmtSec(startSeconds)}-${fmtSec(endSeconds)}s | VISUAL_ONLY=${visual} | Speech=${(shot.speechEventIds ?? []).join(",") || "None"} | SFX_ONLY=${sfx || "None"}`;
  });

  const entryFacts = [
    clip.continuity ? `时空=${cell(clip.continuity)}` : "",
    clip.sceneState ? `场景=${cell(clip.sceneState)}` : "",
    clip.characterStateVersions ? `人物=${cell(clip.characterStateVersions)}` : "",
    clip.continuityLedger ? `边界=${cell(clip.continuityLedger)}` : "",
  ].filter(Boolean).join(" | ");
  const references = clip.assetObjectContracts?.length
    ? formatAssetObjectReferenceLocks(clip.assetObjectContracts, options?.assetReferenceIndicesByContractKey)
    : "None";
  const speechContract = speechRows.length > 0
    ? options?.voiceReferenceMode === "provider_native"
      ? `${speechRows.join("\n")}\nVoiceMode=ProviderNativeAudio`
      : `${speechRows.join("\n")}\nVoiceManifest=${VOICE_REFERENCE_BINDING_PLACEHOLDER}`
    : "SpeechEvent=None";

  return [
    "【AUDIO】只有 SpokenText 的 JSON 字符串值允许发声；VISUAL_ONLY 与 SFX_ONLY 永不朗读。镜头切换不得截断、重启或重复独立 SpeechEvent。",
    speechContract,
    `【ENTRY+REFERENCES】${entryFacts || "按首镜既成状态进入"}\n${references}`,
    `【SHOTS】\n${shotRows.join("\n")}`,
    `【EXIT】${cell(clip.exitState) || "保持末镜可见承帧状态"}`,
  ].join("\n");
}

/** clip 是否带结构化 shots（走新路径的判据；无 shots 的旧 clip 原文本路径零回归）。 */
export function hasStructuredShots(clip: unknown): clip is StructuredClip & Record<string, unknown> {
  return Boolean(
    clip &&
      typeof clip === "object" &&
      Array.isArray((clip as { shots?: unknown }).shots) &&
      ((clip as { shots: unknown[] }).shots.length > 0),
  );
}

/**
 * 唯一的创作合同 → 执行合同编译边界。
 * shots 是权威创作数据，clipPrompt 是提供给视频执行器的确定性投影；禁止接受纯文本平行写路径。
 */
export function compileStructuredClipForExecution(
  clip: unknown,
): Record<string, unknown> {
  if (!hasStructuredShots(clip)) {
    throw new Error("structured_clip_shots_required");
  }
  const contractIssues = validateStructuredClipExecutionContract(clip);
  if (contractIssues.length) {
    throw new StructuredClipExecutionContractError(contractIssues);
  }
  const clipPrompt = renderClipPromptFromShots(clip);
  if (!clipPrompt.trim()) {
    throw new Error("structured_clip_prompt_render_empty");
  }
  return { ...clip, clipPrompt };
}
