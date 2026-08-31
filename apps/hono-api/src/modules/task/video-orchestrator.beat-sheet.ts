/**
 * 【编排域状态机 P1·BeatSheet 原子产物】spec：docs/superpowers/specs/2026-07-11-authoring-orchestrator-ddd-design.md
 *
 * BeatSheet = 创作半场的 IR（中间表示）：导演一次产出「节拍表+filmBible+改编合同+出场清单」，
 * 写入即校验（本模块），之后的切批/组 payload/并发派 writer 全部由服务端确定性代码执行——
 * 「下一步做什么、并发多少路、契约从哪取」不再是 LLM 的自由度（ch16 串行派批白多 35min 实证）。
 *
 * 设计要点：
 * - 承接契约=上一拍 exitState 的**逐字引用**，由服务端在组 payload 时注入——beat 不设 enterState
 *   必填位（可选补充），从根上消灭「等前一批产出抄 exitState」的串行诱因与措辞歧义。
 * - 每拍起止关键帧与逐字原文锚点都是输入合同；服务端只校验，不代写或修复。
 * - 校验产出分 errors（拒收）与 warnings（软告警·Hermes 序不硬拦创作判断）。
 */

import {
  createMarkerLocator,
  suggestSourceMarkerCandidates,
  DEFAULT_MIN_SOURCE_MARKER_CHARS,
  normalizeWithMap,
} from "./video-orchestrator.source-coverage";

/**
 * 把「定位不到 / 太短」这类锚点拒因变成可执行指令：附上原文里达标且可逐字定位的候选句。
 * 【v19 实证】只报错不给出路时，规划层会陷入「猜→被拒→重读原文→再猜」，turn 预算先见底。
 */
function describeMarkerCandidates(
  chapterText: string,
  span: { fromNorm?: number; toNorm?: number },
  label = "可用锚点",
): string {
  const candidates = suggestSourceMarkerCandidates({
    chapterText,
    ...(typeof span.fromNorm === "number" ? { fromNorm: span.fromNorm } : {}),
    ...(typeof span.toNorm === "number" ? { toNorm: span.toNorm } : {}),
  });
  if (!candidates.length) return "";
  return `。${label}（逐字抄任一条即可过闸）：${candidates.map((t) => `「${t}」`).join("、")}`;
}
import {
  DIALOGUE_PACE_CEILING,
  parseDialoguePaceRate,
} from "./video-orchestrator.dialogue-capacity";
import {
  CLIP_CONTINUITY_MODES,
  validateClipContinuitySequence,
  type ClipContinuityMode,
} from "./video-orchestrator.continuity-contract";
import {
  countDialogueChars,
} from "./video-orchestrator.clip-shots";
import {
  parseVideoGenerationContract,
  type VideoGenerationContract,
} from "./video-orchestrator.generation-contract";
import type {
  VideoFinishingContract,
  VideoFinishingRequest,
} from "./video-orchestrator.finishing-contract";
import type {
  VideoSpeechAuditContract,
  VideoSpeechAuditRequest,
} from "./video-orchestrator.speech-audit-contract";
import {
  parsePropMaterialIdentity,
  type PropMaterialIdentity,
} from "./prop-material-identity";
import {
  formatAssetObjectContracts,
  validateBeatAssetObjectBindings,
  type AssetObjectContract,
} from "./video-orchestrator.asset-object-contract";
import { FLOW_NODE_ID_MAX_LENGTH } from "../flow/flow-node-id.constants";
import { buildCanonicalVideoReferenceNodeIds } from "./video-orchestrator.clip-reference-contract";
import {
  parseBeatCharacterStateVersions,
  parseBeatSceneState,
  parseBeatTemporalContext,
  type BeatCharacterStateVersions,
  type BeatSceneState,
  type BeatTemporalContext,
} from "./video-orchestrator.temporal-state-contract";
import {
  collectVisualStateAnchorRequirements,
  parseBeatContinuityLedger,
  parseBeatVisualStateRefs,
  parseVisualStateTimeline,
  validateVisualContinuityTopology,
  type BeatContinuityLedger,
  type VisualStateAnchorRequirement,
  type VisualStateTimeline,
} from "./video-orchestrator.visual-state-timeline";
import type { KeyframeCompositionContract } from "./keyframe-composition-contract";
import {
  normalizeSpeakerNames,
} from "./video-orchestrator.media-budget";
import {
  collectSpokenSpeakerNames,
  combineSpokenScript,
  parseNarrativeAudioPlan,
  validateNarrativeAudioPlacement,
  type NarrativeAudioPlan,
} from "./video-orchestrator.spoken-script";
import {
  validateSourceCoveragePlan,
  validateSpeechLedgerAgainstBeats,
  type SourceCoveragePlan,
} from "./video-orchestrator.source-coverage-plan";
import {
  parseStoryFactLocks,
  parseStoryFactsContext,
  validateExpectedContext,
  validateTraceInvariants,
  type StoryboardDirectorV12ExpectedContext,
  type StoryboardDirectorV12ValidatedShot,
  type StoryboardDirectorV12ValidationIssue,
  type StoryboardStoryFactLocks,
  type StoryboardStoryFactsContext,
} from "../storyboard/storyboard-structure";
import { projectBeatExecutionSelectors } from "./video-orchestrator.beat-sheet-draft-node";

export const BEAT_RHYTHM_ROLES = ["铺垫", "压迫", "爆发", "抽空"] as const;
export type BeatRhythmRole = (typeof BEAT_RHYTHM_ROLES)[number];
export const STORY_STATE_DIMENSIONS = ["location", "status", "possession", "knowledge", "relationship", "control", "goal", "strategy", "risk", "other"] as const;
export type StoryStateDimension = (typeof STORY_STATE_DIMENSIONS)[number];
export type StoryStateTransition = {
  actionId: string;
  entity: string;
  dimension: StoryStateDimension;
  before: string;
  after: string;
  causeCausalityIndex: number;
  persistence: "beat" | "chapter" | "series";
};

export const BEAT_ARC_ROLES = ["opening", "development", "turn", "resolution", "continuous"] as const;
export type BeatArcRole = (typeof BEAT_ARC_ROLES)[number];
export const BEAT_CLOSURE_MODES = ["open_motion", "local_transition", "sequence_resolution"] as const;
export type BeatClosureMode = (typeof BEAT_CLOSURE_MODES)[number];

export type BeatArcContract = {
  arcRole: BeatArcRole;
  closureMode: BeatClosureMode;
  arcFunction: string;
  sequenceContext: string;
};

export type BeatBlockingLockedAnchors = {
  character: string[];
  scene: string[];
  shot: string[];
  continuity: string[];
};

/** 服务端从已验真的站位节点物化；LLM 只提交 blockingFrameNodeId，不提交本对象。 */
export type BeatBlockingContext = {
  sourceNodeId: string;
  sourceImageUrl: string;
  prompt?: string;
  sceneName?: string;
  lockedAnchors: BeatBlockingLockedAnchors;
  compositionContract: KeyframeCompositionContract;
  compositionContractHash: string;
};

export const CLIP_STORYBOARD_MIN_FRAMES = 1;
export const CLIP_STORYBOARD_MAX_FRAMES = 3;

export type BeatDialogueDelivery = "on_screen" | "off_screen" | "voice_over";

/**
 * 从原文逐条冻结的唯一可发声文本。
 *
 * lineId 让 writer 可以跨多个 shot 拆句，同时仍能在供应商提交前逐条、逐字回拼验证。
 * action、镜头、神态和环境描述不在本合同中，因此不得被改写成旁白。
 */
export type BeatDialogueLine = {
  lineId: string;
  speakerName: string;
  text: string;
  delivery: BeatDialogueDelivery;
};

export type Beat = {
  clipIndex: number;
  /** 一句话戏剧内容（这一拍发生什么、变化终点是什么）。 */
  logline: string;
  /** 当前 clip 的起始画面事实；writer 只在该关键帧之后展开。 */
  startKeyframe?: string;
  /** 当前 clip 的结束画面事实；writer 必须在该关键帧收束。 */
  endKeyframe?: string;
  /** 退出态（≤80字：结束时谁在哪/姿态/视线/道具/伤况/光线）——下一拍承接契约的唯一来源。 */
  exitState?: string;
  /** 当前 beat 对 Story Facts v2 / task context 的可机验消费与秘密揭示门禁。 */
  storyFactLocks: StoryboardStoryFactLocks;
  rhythmRole?: BeatRhythmRole;
  /** 技术生成窗口与用户要求的整体叙事弧线之间的显式边界。 */
  arcContract?: BeatArcContract;
  /** 章级导演在 writer fan-out 前冻结的人物因果；writer 只负责把它拍出来。 */
  dramaticChange?: {
    objective: string;
    obstacle: string;
    stake: string;
    choice: string;
    consequence: string;
    stateDelta: string;
    stateTransitions: StoryStateTransition[];
  };
  /** 观众与角色的信息差和揭示顺序。 */
  audienceExperience?: {
    pov: string;
    knowledgeGap: string;
    revealOrder: string;
    intendedQuestion: string;
  };
  /** 期待债务与可见兑现；蓄力拍也必须声明债务去向。 */
  payoff?: {
    debtId: string;
    lifecycleAction: "plant" | "carry" | "escalate" | "resolve" | "abandon";
    eligibleFromClipIndex: number;
    setupDebt: string;
    payoffType: string;
    payoffMoment: string;
    visibleConsequence: string;
    reactionCarrier: string;
  };
  /** 情绪只有改变行动才进入视频预算。 */
  emotionTurn?: {
    residueIn: string;
    before: string;
    trigger: string;
    suppressionLeak: string;
    after: string;
    actionChange: string;
    residueOut: string;
  };
  /** 原文改编裁决与跨拍接力。 */
  pacingDecision?: {
    sourceTreatment: "retain" | "compress";
    essentialCausality: string[];
    causalProvenance: Array<{
      evidenceType: "source_fact" | "necessary_physical_result";
      sourceMarker: string;
    }>;
    handoffToNext: string;
  };
  /** 预算时长（秒）；必须精确命中冻结的视频生成合同。 */
  durationBudget: number;
  sourceStartMarker?: string;
  sourceEndMarker?: string;
  /** 符号引用：场景名（资产域物化，写作域禁碰 node id）。 */
  sceneName?: string;
  /** 符号引用：出场角色 canonical 名。 */
  characterRoleNames: string[];
  /** 本拍真实开口的 canonical 说话人；无对白时必须为空数组。 */
  speakerNames: string[];
  /**
   * 符号引用：本拍出场道具 canonical 名（2026-07-14 ch25 弑神枪根治·与 characterRoleNames 同构）。
   * LLM 申报、服务端确定性绑卡——文本滑窗匹配只是兜底（行文用代词/意译指称时申报仍能绑上）。
   */
  propNames?: string[];
  /** 主代理显式选择的本 clip 俯视站位资产；服务端不做语义自动匹配。 */
  blockingFrameNodeId?: string;
  /** 单角色镜头也需要精确空间调度时由主代理显式声明。 */
  spatialBlocking?: boolean;
  /** 服务端从 blockingFrameNodeId 对应真实节点物化的有界空间事实。 */
  blockingContext?: BeatBlockingContext;
  /** 可选关键帧图片。单状态可直接使用普通 image；2～3 个必要状态可合成一张故事板图片。 */
  storyboardImageNodeId?: string;
  /** 关键帧图片承载的状态数；仅存在 storyboardImageNodeId 时填写，范围 1～3。 */
  storyboardFrameCount?: number;
  /** agents 按 V3 层级精选的视频图片资产；最终业务槽上限来自实时 generationContract。 */
  videoReferenceNodeIds: string[];
  /** agents 对当前剪辑缝的语义裁决；后端只校验并执行，不从 prompt 猜模式。 */
  continuityMode: ClipContinuityMode;
  /** bridge_frames 的真实目标尾帧；可与下一 beat 的 storyboardImageNodeId 共享为桥接帧。 */
  lastFrameImageNodeId?: string;
  /** 本拍所有被使用资产的同级对象状态合同；角色/场景/道具/VFX 采用同一结构。 */
  assetObjectContracts: AssetObjectContract[];
  /** 现实、回忆、预知与平行剪辑的显式时间层；stateScope 是状态继承边界。 */
  temporalContext?: BeatTemporalContext;
  /** 当前 canonical 场景内的具体子场景、内外景、时段、光线、空间锚与入口/退出状态。 */
  sceneState?: BeatSceneState;
  characterStates?: Record<string, string>;
  /** 不依赖状态卡也必须进入最终提示词的可见人物状态版本。 */
  characterStateVersions?: BeatCharacterStateVersions;
  /** clip 入口/出口的稳定事实快照；只做精确边界对账，不承载语义推断。 */
  continuityLedger?: BeatContinuityLedger;
  /** 当前 clip 实际使用的一个或多个持久视觉状态版本。 */
  visualStateRefs?: Record<string, string[]>;
  /** 从章级状态时间线确定性投影的状态锚需求。 */
  visualStateAnchorRequirements?: VisualStateAnchorRequirement[];
  /** 本拍实际出现的 VFX canonical 名；空数组表示没有 VFX。 */
  vfxNames: string[];
  /** 与上一拍有叙事时间跳跃才填（如「半月后」）。 */
  timeJumpNote?: string;
  /** 当前原文跨度内全部可发声文本；无对白/OS/VO 时必须为 []。 */
  dialogueScript: BeatDialogueLine[];
  /**
   * agents-cli 对叙事可读性的语义裁决。原文对白仍只存在 dialogueScript；
   * 本字段承载经源事实约束、但由 agent 编写的旁白/内心 VO，不参与原文逐字台账回拼。
   */
  narrativeAudioPlan?: NarrativeAudioPlan;
  /**
   * 本拍念白语速（有实际人声时必填·正数 chars/second）——表演语义由 Agent 决定，容量核与 writer 沿用同一数值
   * （parseDialoguePaceRate 单一真相源·物理上限 6 封顶）。无发声时省略；宿主不设默认语速。
   */
  dialoguePaceRate?: number;
  /** 可选补充进入态——缺省时契约即上一拍 exitState 逐字。 */
  enterStateNote?: string;
  /**
   * 本拍原文跨度全文（服务端 commit_beats 时按锚点切出·2026-07-13 信息点守恒配套）。
   * 病根：writer 任务书此前只有 logline 一句话概括——节拍蒸馏时丢掉的插叙/暗线
   * 会让单次 writer 缺少必要事实。服务端直接物化原文跨度，保证首稿输入完整。
   * 服务端写入，⛔不由 LLM 提交（提交值被忽略重切）。
   */
  sourceSpanText?: string;
};

export type AdaptationStrategyDecl = {
  reversals?: Array<{ plantClipIndex?: number; revealClipIndex?: number; desc?: string }>;
  cuts?: Array<{ what?: string; why?: string }>;
  hook?: string;
};

export type CastManifestEntry = {
  kind: "character" | "scene" | "prop";
  name: string;
  /** 角色状态版 stateKey 列表（如 meng-wounded）。 */
  states?: string[];
  /** 该实体首次出场的 clipIndex（资产域排期用）。 */
  firstClipIndex?: number;
  /** 道具的物理身份。prop 必填；状态态必须指向项目内现有 canonical 资产。 */
  materialIdentity?: PropMaterialIdentity;
};

export type BeatSheet = {
  version: 2;
  runId: string;
  chapterId?: string;
  /** preflight 冻结的原文跨度与 agents 语义发声台账；提交后保留用于审计。 */
  sourceCoveragePlan?: SourceCoveragePlan;
  /** book run 必须绑定真实 Story Facts v2；standalone 必须使用 task_context。 */
  storyFactsContext: StoryboardStoryFactsContext;
  /** 角色持久视觉状态的章级生效区间与状态锚策略。 */
  visualStateTimeline?: VisualStateTimeline;
  beats: Beat[];
  filmBible: {
    directorTone: string;
    visualBible: string;
    /** 整章观众情绪曲线、峰值/回落与模式打破；所有并发 writer 逐字共享。 */
    emotionalArc?: string;
    /** 逐角色的起点信念/欲望、压力测试、关键选择与本章落点。 */
    characterArcs?: string;
    /** 角色服装基态与允许变化点、场景拓扑、道具状态、光线方向的章级硬合同。 */
    continuityBible?: string;
    /** 功能性空镜的选用原则与本章候选位置；无明确功能时不插入。 */
    atmosphereStrategy?: string;
    hardRules?: string;
    motifs?: string;
  };
  adaptationStrategy: AdaptationStrategyDecl;
  castManifest: CastManifestEntry[];
  /** 目标画幅/分辨率等 meta（沿用 storyPlan 口径，逐 beat continuityMode 决定串并行）。 */
  meta?: {
    aspect?: string;
    resolution?: string;
    videoModel?: string;
    editingStyle?: string;
    filmGenre?: string;
    targetDurationSeconds?: number;
    deliveryScope?: "full_chapter" | "bounded_duration";
    /** 用户明确选择的章级改编模式；creative 允许在主线锚点内扩写。 */
    adaptationMode?: "faithful" | "creative";
    /** 显式执行边界：只交付提示词，或继续进入真实媒体生产。 */
    executionScope?: "prompt_only" | "media_delivery";
    agentModel?: string;
    agentApiStyle?: "chat" | "responses";
    generationContract?: VideoGenerationContract;
    /** agents 根据用户交付意图与实时能力目录显式选择；服务端不补默认值。 */
    finishing?: VideoFinishingRequest;
    /** 服务端按当前启用增强模型参数冻结的后期执行合同。 */
    finishingContract?: VideoFinishingContract;
    /** agents 根据实时视频理解目录显式选择的成片人声审计请求。 */
    speechAudit?: VideoSpeechAuditRequest;
    /** 服务端冻结的成片人声审计模型与计费合同。 */
    speechAuditContract?: VideoSpeechAuditContract;
    /**
     * Root agents-cli 对本轮用户语义合同的原样回声。Hono 不解析
     * must/forbid/prefer；canonical videoModel 由 meta.videoModel 经实时目录解析后
     * 冻结到 generationContract，writer 子代理必须继承这份合同。
     */
    userIntentContract?: Record<string, unknown>;
	/** 服务端在 preflight_commit 时从项目资产真源冻结；LLM 提交的同名字段会被覆盖。 */
	projectLookBible?: {
		assetId: string;
		revision: number;
		name: string;
		lookBibleHash: string;
		availableSectionIds: string[];
	};
    /** agents-cli 根据本 run 的真实 validated 查询注入；查询事实不可由模型自报。 */
    learningProvenance?: {
      queryToolCallId: string;
      queriedValidatedCandidateIds: string[];
      adoptedCandidateIds: string[];
    };
    /** 服务端写入的物理 run 重规划血缘；不属于 agent 可提交的创作参数。 */
    replanLineage?: {
      version: 1;
      rootRunId: string;
      sourceRunId: string;
      generation: number;
    };
  };
};

export type BeatSheetValidation = {
  ok: boolean;
  /** 拒收级问题（结构性：缺字段/索引断裂/时长非法）。 */
  errors: string[];
  /** 软告警（节奏波形/契约疑点/coverage 预检）——不拦提交，随响应回给导演。 */
  warnings: string[];
  /** 规范化后的 Keyframe BeatSheet v2。 */
  normalized: BeatSheet;
};

function normalizeRequiredTextRecord<K extends string>(input: {
  value: unknown;
  path: string;
  keys: readonly K[];
  errors: string[];
}): Record<K, string> {
  const record = input.value && typeof input.value === "object" && !Array.isArray(input.value)
    ? input.value as Record<string, unknown>
    : {};
  const result = {} as Record<K, string>;
  for (const key of input.keys) {
    const value = trimmedStr(record[key]);
    result[key] = value;
    if (!value) input.errors.push(`${input.path}.${key} 必填`);
  }
  return result;
}

/** 改动 writer 输出结构时递增；纳入 clip artifact hash，确保同 BeatSheet 重提会重写旧协议 clips。 */
export const WRITER_CLIP_CONTRACT_VERSION = 12;
const MAX_EXIT_STATE_CHARS = 120;

function trimmedStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * BeatSheet 是 agent-visible 的创作合同，只保存节点/资产标识与结构事实。
 * 项目画风真实 URL 属于服务端付费执行边界，旧 run 或调用方夹带时都不进入规范化产物。
 */
function sanitizeBeatSheetMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...meta };
  delete sanitized.styleReferenceImageUrl;
  delete sanitized.durationPlanningEvidence;
  return sanitized;
}

function parseDurationContract(input: {
  rawMeta: Record<string, unknown> | null;
  beats: readonly Beat[];
  errors: string[];
}): {
  targetDurationSeconds?: number;
} {
  const totalBeatDuration = input.beats.reduce(
    (total, beat) => total + Number(beat.durationBudget),
    0,
  );
  if (!Number.isFinite(totalBeatDuration) || totalBeatDuration <= 0) return {};

  const deliveryScope = input.rawMeta?.deliveryScope;
  const rawTarget = input.rawMeta?.targetDurationSeconds;
  if (deliveryScope === "full_chapter") {
    if (rawTarget !== undefined) {
      input.errors.push(
        "meta.deliveryScope=full_chapter 时禁止提交 targetDurationSeconds；整章总时长只能由完整 beats[].durationBudget 求和产生",
      );
    }
    // full_chapter 不把派生总时长重新写回 agent-visible meta；否则规范化结果
    // 二次校验时会把派生值误认成调用方指定的时长。执行计划直接对 beats 求和。
    return {};
  }

  if (deliveryScope === "bounded_duration" && rawTarget === undefined) {
    input.errors.push(
      "meta.deliveryScope=bounded_duration 时 targetDurationSeconds 必填，且必须来自用户明确指定的时长",
    );
    return {};
  }

  if (rawTarget === undefined) return { targetDurationSeconds: totalBeatDuration };
  const targetDurationSeconds = Number(rawTarget);
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
    input.errors.push(`meta.targetDurationSeconds 必须是正数（收到 ${String(rawTarget)}）`);
    return {};
  }
  if (targetDurationSeconds !== totalBeatDuration) {
    input.errors.push(
      `meta.targetDurationSeconds=${targetDurationSeconds} 必须等于全部 beats[].durationBudget 总和 ${totalBeatDuration}`,
    );
  }
  return { targetDurationSeconds };
}

/**
 * BeatSheet 的叙事块允许模型用字符串、字符串数组或仅含这些叶子的对象表达；协议边界在此
 * 确定性折叠为单一换行文本，后续校验、持久化与 writer 下发只消费这一种内部表示。
 * 这是纯结构归一化，不解释内容、不补写语义，也不会静默丢弃非法叶子。
 */
function normalizeNarrativeText(v: unknown, path: string, errors: string[]): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    return v
      .map((item, index) => normalizeNarrativeText(item, `${path}[${index}]`, errors))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([key, value]) => {
        const text = normalizeNarrativeText(value, `${path}.${key}`, errors);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  errors.push(`${path} 只能是字符串、字符串数组或仅含字符串叶子的对象（收到 ${typeof v}）`);
  return "";
}

const BEAT_DIALOGUE_DELIVERIES = new Set<BeatDialogueDelivery>([
  "on_screen",
  "off_screen",
  "voice_over",
]);

function parseBeatDialogueScript(
  raw: unknown,
  path: string,
  errors: string[],
): BeatDialogueLine[] {
  if (!Array.isArray(raw)) {
    errors.push(`${path} 必填且必须是数组；当前原文跨度无可发声文本时传 []`);
    return [];
  }
  const seenLineIds = new Set<string>();
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path}[${index}] 必须是对象`);
      return [];
    }
    const record = item as Record<string, unknown>;
    const lineId = trimmedStr(record.lineId);
    const speakerName = trimmedStr(record.speakerName);
    const text = trimmedStr(record.text);
    const delivery = record.delivery;
    if (!lineId) errors.push(`${path}[${index}].lineId 必填`);
    if (seenLineIds.has(lineId)) errors.push(`${path}[${index}].lineId=${lineId} 重复`);
    if (lineId) seenLineIds.add(lineId);
    if (!speakerName) errors.push(`${path}[${index}].speakerName 必填`);
    if (!text) errors.push(`${path}[${index}].text 必填且必须逐字取自原文可发声文本`);
    if (!BEAT_DIALOGUE_DELIVERIES.has(delivery as BeatDialogueDelivery)) {
      errors.push(`${path}[${index}].delivery 必须是 on_screen/off_screen/voice_over`);
    }
    if (!lineId || !speakerName || !text || !BEAT_DIALOGUE_DELIVERIES.has(delivery as BeatDialogueDelivery)) {
      return [];
    }
    return [{
      lineId,
      speakerName,
      text,
      delivery: delivery as BeatDialogueDelivery,
    }];
  });
}

export type BeatSheetValidationPhase = "planning" | "execution";

/** 结构校验 + 节奏波形 lint + coverage 预检。纯函数，不落库、不修复输入。 */
export function validateBeatSheet(
  input: unknown,
  chapterText: string,
  options?: {
    generationContract?: VideoGenerationContract;
    maxDurationSeconds?: number;
    storyFactsAuthority?: StoryboardDirectorV12ExpectedContext;
    phase?: BeatSheetValidationPhase;
  },
): BeatSheetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sheet = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (sheet.version !== 2) {
    errors.push(`version 必须逐字为 2（收到 ${String(sheet.version)}）；旧 BeatSheet 不兼容，必须重新提交 Keyframe BeatSheet v2`);
  }
  const inputMeta = sheet.meta && typeof sheet.meta === "object" && !Array.isArray(sheet.meta)
    ? (sheet.meta as Record<string, unknown>)
    : null;
  if (inputMeta && Object.prototype.hasOwnProperty.call(inputMeta, "clipChaining")) {
    errors.push("meta.clipChaining 禁止由根级覆盖；请逐 beat 提交 continuityMode，由 agents 对每个剪辑缝独立裁决");
  }
  const generationContract = parseVideoGenerationContract(
    options?.generationContract ?? inputMeta?.generationContract,
  );
  const acceptsUnmaterializedAssets = options?.phase === "planning";
  const durationOptions = Array.isArray(generationContract?.durationOptions)
    ? generationContract.durationOptions
    : [];
  if (!generationContract) {
    errors.push("generationContract 缺失或无效——BeatSheet 必须使用当前 Run 冻结的视频模型时长合同");
  }
  const runId = trimmedStr(sheet.runId);
  if (!runId) errors.push("runId 必填");
  const storyFactIssues: StoryboardDirectorV12ValidationIssue[] = [];
  const parsedStoryFactsContext = parseStoryFactsContext(
    sheet.storyFactsContext,
    "$.storyFactsContext",
    storyFactIssues,
  );
  const storyFactsContext: StoryboardStoryFactsContext = parsedStoryFactsContext ?? {
    mode: "task_context",
    sourceLabel: "invalid-story-facts-context",
    bookId: null,
    ledgerRevision: null,
    effectiveAt: null,
    consumedFactIds: [],
    consumedContextKeys: [],
  };
  const rawBeats = Array.isArray(sheet.beats) ? (sheet.beats as unknown[]) : [];
  if (!rawBeats.length) errors.push("beats 为空——BeatSheet 必须携带全章节拍");
  const visualStateTimelineResult = parseVisualStateTimeline(
    sheet.visualStateTimeline,
    "visualStateTimeline",
  );
  errors.push(...visualStateTimelineResult.errors);
  let sourceCoveragePlan: SourceCoveragePlan | undefined;
  if (sheet.sourceCoveragePlan !== undefined) {
    const sourceCoverageValidation = validateSourceCoveragePlan({
      plan: sheet.sourceCoveragePlan,
      expectedBeatCount: rawBeats.length,
      deliveryScope: String(inputMeta?.deliveryScope ?? ""),
      chapterText,
    });
    errors.push(...sourceCoverageValidation.errors);
    if (sourceCoverageValidation.ok) {
      sourceCoveragePlan = {
        spans: sourceCoverageValidation.spans,
        speechLedger: sourceCoverageValidation.speechLedger,
      };
      errors.push(...validateSpeechLedgerAgainstBeats({
        speechLedger: sourceCoverageValidation.speechLedger,
        beats: rawBeats,
        deliveryScope: String(inputMeta?.deliveryScope ?? ""),
      }));
    }
  }

  const beats: Beat[] = [];
  rawBeats.forEach((raw, i) => {
    const b = projectBeatExecutionSelectors(
      (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>,
    );
    const clipIndex = Number(b.clipIndex);
    if (!Number.isInteger(clipIndex) || clipIndex !== i) {
      errors.push(`beats[${i}].clipIndex 必须连续从 0 递增（收到 ${String(b.clipIndex)}）`);
    }
    const logline = trimmedStr(b.logline);
    if (!logline) errors.push(`beats[${i}].logline 必填`);
    // 关键帧、退出态和下方导演元数据都属于 agents-cli 的创作合同，不是
    // Hono 的可执行协议边界。允许字符串、数组或叙事对象，并将缺失记录为
    // 诊断；禁止因为创作字段形状或完整度阻断已经授权的媒体任务。
    const startKeyframe = normalizeNarrativeText(
      b.startKeyframe,
      `beats[${i}].startKeyframe`,
      warnings,
    );
    if (!startKeyframe) warnings.push(`beats[${i}].startKeyframe 未声明`);
    const endKeyframe = normalizeNarrativeText(
      b.endKeyframe,
      `beats[${i}].endKeyframe`,
      warnings,
    );
    if (!endKeyframe) warnings.push(`beats[${i}].endKeyframe 未声明`);
    const exitState = normalizeNarrativeText(
      b.exitState,
      `beats[${i}].exitState`,
      warnings,
    );
    if (!exitState) warnings.push(`beats[${i}].exitState 未声明`);
    else if (exitState.length > MAX_EXIT_STATE_CHARS)
      warnings.push(`beats[${i}].exitState 超 ${MAX_EXIT_STATE_CHARS} 字（${exitState.length}）——契约要精练可逐字注入`);
    const storyFactLocks = b.storyFactLocks === undefined
      ? {
          effectiveAt: null,
          bindings: [],
          revealGuards: [],
        }
      : parseStoryFactLocks(
          b.storyFactLocks,
          storyFactsContext,
          `$.shots[${i}].storyFactLocks`,
          storyFactIssues,
        ) ?? {
          effectiveAt: null,
          bindings: [],
          revealGuards: [],
        };
    // 原文追溯由 runtime 冻结的 sourceCoveragePlan 与每拍 canonical
    // sourceStartMarker/sourceEndMarker 负责。storyFactLocks 只承载代理明确消费的
    // 额外事实或揭示门禁；不能要求模型为每拍再创作一份语义 directive，造成与
    // sourceCoveragePlan 重复且直到 commit 才暴露的晚期阻断。
    const rhythmRole = trimmedStr(b.rhythmRole) as BeatRhythmRole;
    if (!BEAT_RHYTHM_ROLES.includes(rhythmRole)) {
      warnings.push(`beats[${i}].rhythmRole 未声明或不在建议集合 {${BEAT_RHYTHM_ROLES.join("/")}}（收到 ${String(b.rhythmRole)}）`);
    }
    const arcRecord = b.arcContract && typeof b.arcContract === "object" && !Array.isArray(b.arcContract)
      ? b.arcContract as Record<string, unknown>
      : {};
    const arcRole = trimmedStr(arcRecord.arcRole) as BeatArcRole;
    const closureMode = trimmedStr(arcRecord.closureMode) as BeatClosureMode;
    const arcFunction = trimmedStr(arcRecord.arcFunction);
    const sequenceContext = trimmedStr(arcRecord.sequenceContext);
    if (!BEAT_ARC_ROLES.includes(arcRole)) {
      warnings.push(`beats[${i}].arcContract.arcRole 未声明或不在建议集合 {${BEAT_ARC_ROLES.join("/")}}`);
    }
    if (!BEAT_CLOSURE_MODES.includes(closureMode)) {
      warnings.push(`beats[${i}].arcContract.closureMode 未声明或不在建议集合 {${BEAT_CLOSURE_MODES.join("/")}}`);
    }
    if (!arcFunction) warnings.push(`beats[${i}].arcContract.arcFunction 未声明`);
    if (!sequenceContext) warnings.push(`beats[${i}].arcContract.sequenceContext 未声明`);
    if (closureMode === "sequence_resolution" && i !== rawBeats.length - 1) {
      warnings.push(`beats[${i}].arcContract.closureMode=sequence_resolution 出现在非末 beat；交由 agents-cli 同链自检`);
    }
    const dramaticChange = normalizeRequiredTextRecord({
      value: b.dramaticChange,
      path: `beats[${i}].dramaticChange`,
      keys: ["objective", "obstacle", "stake", "choice", "consequence", "stateDelta"] as const,
      errors: warnings,
    });
    const dramaticRecord = b.dramaticChange && typeof b.dramaticChange === "object" && !Array.isArray(b.dramaticChange)
      ? b.dramaticChange as Record<string, unknown>
      : {};
    const stateTransitions = Array.isArray(dramaticRecord.stateTransitions)
      ? (dramaticRecord.stateTransitions as unknown[]).map((entry, transitionIndex) => {
          const path = `beats[${i}].dramaticChange.stateTransitions[${transitionIndex}]`;
          const record = entry && typeof entry === "object" && !Array.isArray(entry)
            ? entry as Record<string, unknown>
            : {};
          const actionId = trimmedStr(record.actionId);
          const entity = trimmedStr(record.entity);
          const dimension = trimmedStr(record.dimension) as StoryStateDimension;
          const before = trimmedStr(record.before);
          const after = trimmedStr(record.after);
          const causeCausalityIndex = Number(record.causeCausalityIndex);
          const persistence = trimmedStr(record.persistence) as StoryStateTransition["persistence"];
          if (!actionId) warnings.push(`${path}.actionId 未声明`);
          if (!entity) warnings.push(`${path}.entity 未声明`);
          if (!STORY_STATE_DIMENSIONS.includes(dimension)) warnings.push(`${path}.dimension 未声明或不在建议集合`);
          if (!before) warnings.push(`${path}.before 未声明`);
          if (!after) warnings.push(`${path}.after 未声明`);
          if (before && after && before === after) warnings.push(`${path}.before/after 未体现状态变化`);
          if (!Number.isInteger(causeCausalityIndex) || causeCausalityIndex < 0) warnings.push(`${path}.causeCausalityIndex 不是 >= 0 的整数`);
          if (!["beat", "chapter", "series"].includes(persistence)) warnings.push(`${path}.persistence 未声明或不在建议集合`);
          return { actionId, entity, dimension, before, after, causeCausalityIndex, persistence };
        })
      : [];
    if (!stateTransitions.length) warnings.push(`beats[${i}].dramaticChange.stateTransitions 未声明`);
    const audienceExperience = normalizeRequiredTextRecord({
      value: b.audienceExperience,
      path: `beats[${i}].audienceExperience`,
      keys: ["pov", "knowledgeGap", "revealOrder", "intendedQuestion"] as const,
      errors: warnings,
    });
    const payoff = normalizeRequiredTextRecord({
      value: b.payoff,
      path: `beats[${i}].payoff`,
      keys: ["debtId", "setupDebt", "payoffType", "payoffMoment", "visibleConsequence", "reactionCarrier"] as const,
      errors: warnings,
    });
    const rawPayoff = b.payoff && typeof b.payoff === "object" && !Array.isArray(b.payoff)
      ? b.payoff as Record<string, unknown>
      : {};
    const lifecycleAction = trimmedStr(rawPayoff.lifecycleAction) as NonNullable<Beat["payoff"]>["lifecycleAction"];
    if (!["plant", "carry", "escalate", "resolve", "abandon"].includes(lifecycleAction)) {
      warnings.push(`beats[${i}].payoff.lifecycleAction 未声明或不在建议集合`);
    }
    const eligibleFromClipIndex = Number(rawPayoff.eligibleFromClipIndex);
    if (!Number.isInteger(eligibleFromClipIndex) || eligibleFromClipIndex < 0) {
      warnings.push(`beats[${i}].payoff.eligibleFromClipIndex 不是 >= 0 的整数`);
    } else if (eligibleFromClipIndex >= rawBeats.length) {
      warnings.push(
        `beats[${i}].payoff.eligibleFromClipIndex=${eligibleFromClipIndex} 超出本章 clipIndex 范围 0..${rawBeats.length - 1}`,
      );
    }
    const emotionTurn = normalizeRequiredTextRecord({
      value: b.emotionTurn,
      path: `beats[${i}].emotionTurn`,
      keys: ["residueIn", "before", "trigger", "suppressionLeak", "after", "actionChange", "residueOut"] as const,
      errors: warnings,
    });
    const pacingRecord = b.pacingDecision && typeof b.pacingDecision === "object" && !Array.isArray(b.pacingDecision)
      ? b.pacingDecision as Record<string, unknown>
      : {};
    const sourceTreatment = trimmedStr(pacingRecord.sourceTreatment) as NonNullable<Beat["pacingDecision"]>["sourceTreatment"];
    if (Object.keys(pacingRecord).length > 0 && !["retain", "compress"].includes(sourceTreatment)) {
      warnings.push(`beats[${i}].pacingDecision.sourceTreatment 未声明或不在建议集合；原文覆盖仍由 runtime sourceCoveragePlan 保证`);
    }
    const essentialCausality = Array.isArray(pacingRecord.essentialCausality)
      ? (pacingRecord.essentialCausality as unknown[]).map(trimmedStr).filter(Boolean)
      : [];
    if (!essentialCausality.length) {
      warnings.push(`beats[${i}].pacingDecision.essentialCausality 未声明`);
    }
    const causalProvenance = Array.isArray(pacingRecord.causalProvenance)
      ? (pacingRecord.causalProvenance as unknown[]).map((entry, provenanceIndex) => {
          const record = entry && typeof entry === "object" && !Array.isArray(entry)
            ? entry as Record<string, unknown>
            : {};
          const evidenceType = trimmedStr(record.evidenceType) as "source_fact" | "necessary_physical_result";
          const sourceMarker = trimmedStr(record.sourceMarker);
          if (!["source_fact", "necessary_physical_result"].includes(evidenceType)) {
            warnings.push(`beats[${i}].pacingDecision.causalProvenance[${provenanceIndex}].evidenceType 未声明或不在建议集合`);
          }
          if (!sourceMarker) {
            warnings.push(`beats[${i}].pacingDecision.causalProvenance[${provenanceIndex}].sourceMarker 未声明`);
          }
          return { evidenceType, sourceMarker };
        })
      : [];
    if (causalProvenance.length !== essentialCausality.length) {
      const missingIndices = essentialCausality
        .map((_, index) => index)
        .filter((index) => index >= causalProvenance.length);
      warnings.push(
        `beats[${i}].pacingDecision.causalProvenance 必须与 essentialCausality 一一对应` +
        `（essentialCausality=${essentialCausality.length}，causalProvenance=${causalProvenance.length}` +
        `${missingIndices.length ? `，缺失索引=${missingIndices.join(",")}` : ""}）`,
      );
    }
    // 【溯源纪律·2026-07-28 v18 根因】禁止把"作者自选手法"盖上 necessary_physical_result
    // 的章升格成硬因果。v18 的"苏晓直接抛出而非递交"就是这么被凭空发明并锁进 causality 覆盖，
    // 分镜层无权拒绝，最终产出贴身抛投的荒谬成片。
    // 因果/物理合理性属于 agents-cli 的创作自检，不是 Hono 的提交闸门。
    // 保留结构化 causalProvenance 事实，但不因语义判断否决 BeatSheet。
    const handoffToNext = trimmedStr(pacingRecord.handoffToNext);
    if (!handoffToNext) warnings.push(`beats[${i}].pacingDecision.handoffToNext 未声明`);
    const dur = Number(b.durationBudget);
    if (!Number.isFinite(dur) || !durationOptions.includes(dur)) {
      errors.push(`beats[${i}].durationBudget 必须精确命中 generationContract.durationOptions=[${durationOptions.join("/")}]s（收到 ${String(b.durationBudget)}），禁止只校验最大值后在生成阶段吸附`);
    }
    const roles = Array.isArray(b.characterRoleNames)
      ? [...new Set((b.characterRoleNames as unknown[]).map(trimmedStr).filter(Boolean))]
      : [];
    const speakerNames = normalizeSpeakerNames(b.speakerNames);
    if (!Array.isArray(b.speakerNames)) {
      errors.push(`beats[${i}].speakerNames 必填且必须是数组；无对白时传 []`);
    }
    const dialogueScript = parseBeatDialogueScript(
      b.dialogueScript,
      `beats[${i}].dialogueScript`,
      errors,
    );
    const narrativeAudioPlan = parseNarrativeAudioPlan(
      b.narrativeAudioPlan,
      `beats[${i}].narrativeAudioPlan`,
      errors,
    );
    validateNarrativeAudioPlacement(
      dialogueScript,
      narrativeAudioPlan,
      `beats[${i}].narrativeAudioPlan`,
      errors,
    );
    const spokenScript = combineSpokenScript(dialogueScript, narrativeAudioPlan);
    const duplicateSpokenLineIds = spokenScript
      .map((line) => line.lineId)
      .filter((lineId, index, lineIds) => lineIds.indexOf(lineId) !== index);
    if (duplicateSpokenLineIds.length > 0) {
      errors.push(
        `beats[${i}] 的 dialogueScript 与 narrativeAudioPlan.lines 必须使用全局唯一 lineId；重复=${JSON.stringify(Array.from(new Set(duplicateSpokenLineIds)))}`,
      );
    }
    const dialogueSpeakerNames = normalizeSpeakerNames(
      collectSpokenSpeakerNames(spokenScript),
    );
    const sameSpeakerSet =
      speakerNames.length === dialogueSpeakerNames.length &&
      speakerNames.every((name) => dialogueSpeakerNames.includes(name));
    if (!sameSpeakerSet) {
      errors.push(
        `beats[${i}].speakerNames 必须逐字等于全部冻结人声（dialogueScript + narrativeAudioPlan.lines）的说话人集合；期望 ${JSON.stringify(dialogueSpeakerNames)}，收到 ${JSON.stringify(speakerNames)}`,
      );
    }
    const props = Array.isArray(b.propNames)
      ? [...new Set((b.propNames as unknown[]).map(trimmedStr).filter(Boolean))]
      : [];
    const vfxNames = Array.isArray(b.vfxNames)
      ? [...new Set((b.vfxNames as unknown[]).map(trimmedStr).filter(Boolean))]
      : [];
    const blockingFrameNodeId = trimmedStr(b.blockingFrameNodeId);
    const spatialBlocking = b.spatialBlocking === true;
    if (b.spatialBlocking !== undefined && typeof b.spatialBlocking !== "boolean") {
      errors.push(`beats[${i}].spatialBlocking 必须是 boolean`);
    }
    if (blockingFrameNodeId.length > FLOW_NODE_ID_MAX_LENGTH) {
      errors.push(`beats[${i}].blockingFrameNodeId 最多 ${FLOW_NODE_ID_MAX_LENGTH} 字（收到 ${blockingFrameNodeId.length}）`);
    }
    if (spatialBlocking && !blockingFrameNodeId && !acceptsUnmaterializedAssets) {
      errors.push(
        `beats[${i}].blockingFrameNodeId 必填；显式 spatialBlocking 镜头必须先绑定真实站位图`,
      );
    }
    if (blockingFrameNodeId && !spatialBlocking) {
      errors.push(
        `beats[${i}].spatialBlocking 必须为 true；只有当前镜头确实依赖精确空间调度时才允许绑定 blockingFrameNodeId`,
      );
    }
    const storyboardImageNodeId = trimmedStr(b.storyboardImageNodeId);
    const storyboardFrameCount = storyboardImageNodeId ? Number(b.storyboardFrameCount ?? 1) : 0;
    const videoReferenceNodeIds = Array.isArray(b.videoReferenceNodeIds)
      ? [...new Set((b.videoReferenceNodeIds as unknown[]).map(trimmedStr).filter(Boolean))]
      : [];
    const continuityMode = trimmedStr(b.continuityMode) as ClipContinuityMode;
    const lastFrameImageNodeId = trimmedStr(b.lastFrameImageNodeId);
    if (!CLIP_CONTINUITY_MODES.includes(continuityMode)) {
      errors.push(`beats[${i}].continuityMode 必须 ∈ {${CLIP_CONTINUITY_MODES.join("/")}}`);
    }
    if (Object.prototype.hasOwnProperty.call(b, "chainFromPrev")) {
      errors.push(`beats[${i}].chainFromPrev 是执行派生字段；请用 continuityMode=reference_video 声明语义决定`);
    }
    if (storyboardImageNodeId && (
      !Number.isInteger(storyboardFrameCount) ||
      storyboardFrameCount < CLIP_STORYBOARD_MIN_FRAMES ||
      storyboardFrameCount > CLIP_STORYBOARD_MAX_FRAMES
    )) {
      errors.push(
        `beats[${i}].storyboardFrameCount 必须是 ${CLIP_STORYBOARD_MIN_FRAMES}～${CLIP_STORYBOARD_MAX_FRAMES} 的整数；仅在选择关键帧图片时填写`,
      );
    }
    if (storyboardImageNodeId.length > FLOW_NODE_ID_MAX_LENGTH) {
      errors.push(`beats[${i}].storyboardImageNodeId 最多 ${FLOW_NODE_ID_MAX_LENGTH} 字（收到 ${storyboardImageNodeId.length}）`);
    }
    if (lastFrameImageNodeId.length > FLOW_NODE_ID_MAX_LENGTH) {
      errors.push(`beats[${i}].lastFrameImageNodeId 最多 ${FLOW_NODE_ID_MAX_LENGTH} 字（收到 ${lastFrameImageNodeId.length}）`);
    }
    if (continuityMode === "bridge_frames" && !storyboardImageNodeId && !acceptsUnmaterializedAssets) {
      errors.push(`beats[${i}].storyboardImageNodeId 必填；bridge_frames 必须绑定与上一拍共用的真实桥接帧`);
    }
    const sceneName = trimmedStr(b.sceneName);
    const temporalContextResult = parseBeatTemporalContext(
      b.temporalContext,
      `beats[${i}].temporalContext`,
    );
    const sceneStateResult = parseBeatSceneState(
      b.sceneState,
      `beats[${i}].sceneState`,
    );
    const characterStateVersionsResult = parseBeatCharacterStateVersions(
      b.characterStateVersions,
      `beats[${i}].characterStateVersions`,
    );
    const continuityLedgerResult = parseBeatContinuityLedger(
      b.continuityLedger,
      `beats[${i}].continuityLedger`,
    );
    const visualStateRefsResult = parseBeatVisualStateRefs(
      b.visualStateRefs,
      `beats[${i}].visualStateRefs`,
    );
    errors.push(
      ...temporalContextResult.errors,
      ...sceneStateResult.errors,
      ...characterStateVersionsResult.errors,
      ...continuityLedgerResult.errors,
      ...visualStateRefsResult.errors,
    );
    const objectContracts = validateBeatAssetObjectBindings({
      assetObjectContracts: b.assetObjectContracts,
      characterRoleNames: roles,
      sceneName,
      propNames: props,
      vfxNames,
      path: `beats[${i}].assetObjectContracts`,
      // planning 只冻结对象合同，真实参考节点由资产 DAG 生成后回填；execution
      // 重新启用严格 nodeId 合同，避免未准备的身份图进入 writer/provider。
      allowMissingReferenceImageNodeIds: acceptsUnmaterializedAssets,
    });
    errors.push(...objectContracts.errors);
    const canonicalVideoReferenceNodeIds = buildCanonicalVideoReferenceNodeIds({
      videoReferenceNodeIds,
      assetObjectContracts: objectContracts.contracts,
      visualStateAnchorRequirements: b.visualStateAnchorRequirements,
    });
    const businessReferenceCount = canonicalVideoReferenceNodeIds.length + (storyboardImageNodeId ? 1 : 0);
    const maximumBusinessImages = generationContract?.referenceImagePolicy.maximumBusinessImages;
    if (
      typeof maximumBusinessImages === "number" &&
      businessReferenceCount > maximumBusinessImages
    ) {
      errors.push(
        `beats[${i}] 的 storyboardImageNodeId、videoReferenceNodeIds 与 assetObjectContracts 合并后需要 ${businessReferenceCount} 个业务图片槽，当前 generationContract 仅允许 ${maximumBusinessImages} 个；禁止静默删引用`,
      );
    }
    if (canonicalVideoReferenceNodeIds.includes(storyboardImageNodeId)) {
      errors.push(`beats[${i}] 的业务参考合同不得重复 storyboardImageNodeId`);
    }
    if (spokenScript.length > 0 && Number.isFinite(dur) && dur > 0) {
      const declaredRate = parseDialoguePaceRate(b.dialoguePaceRate);
      if (declaredRate === null) {
        errors.push(
          `beats[${i}] 含有冻结人声时 dialoguePaceRate 必填，且必须由 BeatSheet Agent 根据当前说话情境提交正数；宿主不再以固定 4 字/秒代替创作裁决`,
        );
      } else {
        const effectiveRate = Math.min(declaredRate, DIALOGUE_PACE_CEILING);
        const minimumDialogueSeconds = spokenScript.reduce((total, line) => {
          const characterCount = countDialogueChars(line.text);
          return total + Math.ceil((characterCount / effectiveRate) * 2) / 2;
        }, 0);
        if (minimumDialogueSeconds > dur) {
          errors.push(
            `beats[${i}].durationBudget=${dur}s 无法容纳全部冻结人声：按 Agent 提交的 ${effectiveRate}字/秒及逐行0.5秒向上取整，最低需要 ${minimumDialogueSeconds}s；这是可执行时长合同矛盾。禁止删词、提速或让 writer 承担不可能预算，请由 agents 在同一创作链内增加本拍合法时长或重规划 clip 边界`,
          );
        }
      }
    }
    beats.push({
      clipIndex: i,
      logline,
      ...(startKeyframe ? { startKeyframe } : {}),
      ...(endKeyframe ? { endKeyframe } : {}),
      ...(exitState ? { exitState } : {}),
      storyFactLocks,
      ...(BEAT_RHYTHM_ROLES.includes(rhythmRole) ? { rhythmRole } : {}),
      ...(BEAT_ARC_ROLES.includes(arcRole) && BEAT_CLOSURE_MODES.includes(closureMode) && arcFunction && sequenceContext
        ? { arcContract: { arcRole, closureMode, arcFunction, sequenceContext } }
        : {}),
      ...(Object.keys(dramaticRecord).length
        ? { dramaticChange: { ...dramaticChange, stateTransitions } }
        : {}),
      ...(b.audienceExperience && typeof b.audienceExperience === "object" && !Array.isArray(b.audienceExperience)
        ? { audienceExperience }
        : {}),
      ...(Object.keys(rawPayoff).length
        ? { payoff: { ...payoff, lifecycleAction, eligibleFromClipIndex } }
        : {}),
      ...(b.emotionTurn && typeof b.emotionTurn === "object" && !Array.isArray(b.emotionTurn)
        ? { emotionTurn }
        : {}),
      ...(Object.keys(pacingRecord).length
        ? { pacingDecision: { sourceTreatment, essentialCausality, causalProvenance, handoffToNext } }
        : {}),
      // 非法值保留为 NaN；上面的 errors 会阻止 normalized BeatSheet 落库，禁止注入第二套时长默认值。
      durationBudget: dur,
      characterRoleNames: roles,
      speakerNames,
      dialogueScript,
      ...(narrativeAudioPlan ? { narrativeAudioPlan } : {}),
      ...(props.length ? { propNames: props } : {}),
      ...(blockingFrameNodeId ? { blockingFrameNodeId } : {}),
      ...(spatialBlocking ? { spatialBlocking: true } : {}),
      ...(storyboardImageNodeId
        ? { storyboardImageNodeId, storyboardFrameCount }
        : {}),
      videoReferenceNodeIds,
      continuityMode,
      ...(lastFrameImageNodeId ? { lastFrameImageNodeId } : {}),
      assetObjectContracts: objectContracts.contracts,
      vfxNames,
      ...(trimmedStr(b.sourceStartMarker) ? { sourceStartMarker: trimmedStr(b.sourceStartMarker) } : {}),
      ...(trimmedStr(b.sourceEndMarker) ? { sourceEndMarker: trimmedStr(b.sourceEndMarker) } : {}),
      ...(sceneName ? { sceneName } : {}),
      ...(temporalContextResult.value ? { temporalContext: temporalContextResult.value } : {}),
      ...(sceneStateResult.value ? { sceneState: sceneStateResult.value } : {}),
      ...(b.characterStates && typeof b.characterStates === "object"
        ? { characterStates: b.characterStates as Record<string, string> }
        : {}),
      ...(characterStateVersionsResult.value
        ? { characterStateVersions: characterStateVersionsResult.value }
        : {}),
      ...(continuityLedgerResult.value
        ? { continuityLedger: continuityLedgerResult.value }
        : {}),
      ...(visualStateRefsResult.value
        ? { visualStateRefs: visualStateRefsResult.value }
        : {}),
      ...(trimmedStr(b.timeJumpNote) ? { timeJumpNote: trimmedStr(b.timeJumpNote) } : {}),
      ...(typeof b.dialoguePaceRate === "number" && Number.isFinite(b.dialoguePaceRate) && b.dialoguePaceRate > 0
        ? { dialoguePaceRate: b.dialoguePaceRate }
        : {}),
      ...(trimmedStr(b.enterStateNote) ? { enterStateNote: trimmedStr(b.enterStateNote) } : {}),
    });
  });

  if (parsedStoryFactsContext) {
    const traceShots: StoryboardDirectorV12ValidatedShot[] = beats.map((beat, index) => ({
      record: {},
      shotId: `clip:${beat.clipIndex}`,
      exitState: beat.exitState ?? "",
      continuityFromPrev: index > 0 ? (beats[index - 1].exitState ?? "") : "chapter-opening",
      storyFactLocks: beat.storyFactLocks,
    }));
    validateTraceInvariants(parsedStoryFactsContext, traceShots, storyFactIssues);
    if (options?.storyFactsAuthority) {
      validateExpectedContext(
        parsedStoryFactsContext,
        traceShots,
        options.storyFactsAuthority,
        storyFactIssues,
      );
    }
  }
  errors.push(
    ...storyFactIssues.map((issue) =>
      `${issue.path.replace(/^\$\.shots/, "beats")}：${issue.message}`,
    ),
  );

  const debtState = new Map<string, { eligibleFromClipIndex: number; closed: boolean }>();
  const appliedStateActionIds = new Set<string>();
  const storyState = new Map<string, string>();
  beats.forEach((beat) => {
    const payoff = beat.payoff;
    if (payoff) {
      const previous = debtState.get(payoff.debtId);
      if (previous && previous.eligibleFromClipIndex !== payoff.eligibleFromClipIndex) {
        warnings.push(`beats[${beat.clipIndex}].payoff.eligibleFromClipIndex 与同一 debtId 的既有创作声明不一致`);
      }
      if (previous?.closed) warnings.push(`beats[${beat.clipIndex}].payoff.debtId 已在更早拍关闭后再次出现`);
      if (payoff.lifecycleAction === "plant" && previous) warnings.push(`beats[${beat.clipIndex}].payoff.debtId 重复 plant`);
      if (payoff.lifecycleAction === "resolve" && beat.clipIndex < payoff.eligibleFromClipIndex) {
        warnings.push(`beats[${beat.clipIndex}].payoff 在 eligibleFromClipIndex=${payoff.eligibleFromClipIndex} 前提前兑现`);
      }
      debtState.set(payoff.debtId, {
        eligibleFromClipIndex: payoff.eligibleFromClipIndex,
        closed: payoff.lifecycleAction === "resolve" || payoff.lifecycleAction === "abandon",
      });
    }
    beat.dramaticChange?.stateTransitions.forEach((transition, transitionIndex) => {
      const path = `beats[${beat.clipIndex}].dramaticChange.stateTransitions[${transitionIndex}]`;
      if (appliedStateActionIds.has(transition.actionId)) warnings.push(`${path}.actionId 重复`);
      appliedStateActionIds.add(transition.actionId);
      const causalityCount = beat.pacingDecision?.essentialCausality.length ?? 0;
      if (transition.causeCausalityIndex >= causalityCount) {
        // 直接给出合法范围与本拍现有条目，省掉规划层"回去数数组长度"这一步（v19 实测它数错过）。
        const legalRange = causalityCount > 0 ? `合法范围 0..${causalityCount - 1}` : "本拍 essentialCausality 为空，不能引用任何索引";
        const existing = (beat.pacingDecision?.essentialCausality ?? [])
          .map((item, i) => `[${i}] ${String(item).slice(0, 40)}`)
          .join("；");
        warnings.push(
          `${path}.causeCausalityIndex=${transition.causeCausalityIndex} 超出本拍 essentialCausality 索引范围（${legalRange}）` +
            (existing ? `。本拍现有条目：${existing}` : ""),
        );
      }
      const stateKey = `${transition.entity}\u0000${transition.dimension}`;
      const previous = storyState.get(stateKey);
      if (previous !== undefined && transition.before !== previous) {
        warnings.push(`${path}.before 未逐字承接同一实体/维度的上一终态「${previous}」`);
      }
      storyState.set(stateKey, transition.after);
    });
    if (beat.clipIndex > 0) {
      const previousResidue = beats[beat.clipIndex - 1]?.emotionTurn?.residueOut;
      if (previousResidue && beat.emotionTurn?.residueIn !== previousResidue) {
        warnings.push(`beats[${beat.clipIndex}].emotionTurn.residueIn 未逐字承接上一拍 residueOut`);
      }
    }
  });

  // Keyframe BeatSheet v2：每个 clip 都必须独立声明逐字原文跨度。
  const withMarkers = beats.filter((b) => b.sourceStartMarker && b.sourceEndMarker).length;
  const locate = chapterText.trim() ? createMarkerLocator(chapterText) : null;
  const chapterNorm = normalizeWithMap(chapterText).norm;
  const locatedSourceRanges: Array<{ clipIndex: number; start: number; end: number }> = [];
  beats.forEach((beat, index) => {
    const startMarker = trimmedStr(beat.sourceStartMarker);
    const endMarker = trimmedStr(beat.sourceEndMarker);
    if (!startMarker || !endMarker) {
      errors.push(`beats[${index}] 必须同时提供 sourceStartMarker/sourceEndMarker；禁止 writer 仅凭蒸馏 logline 脱离原文创作`);
      return;
    }
	const runtimeSpan = sourceCoveragePlan?.spans[index];
	if (runtimeSpan) {
		if (
			runtimeSpan.clipIndex !== beat.clipIndex ||
			runtimeSpan.sourceStartMarker !== startMarker ||
			runtimeSpan.sourceEndMarker !== endMarker
		) {
			errors.push(`beats[${index}] 的原文跨度必须逐字复用 runtime sourceCoveragePlan`);
			return;
		}
		locatedSourceRanges.push({
			clipIndex: beat.clipIndex,
			start: runtimeSpan.sourceStartOffset,
			end: runtimeSpan.sourceEndOffset,
		});
		beat.pacingDecision?.causalProvenance.forEach((provenance, provenanceIndex) => {
			if (provenance.evidenceType !== "source_fact") return;
			const evidenceNorm = normalizeWithMap(provenance.sourceMarker).norm;
			if (
				!evidenceNorm ||
				!chapterNorm
					.slice(runtimeSpan.sourceStartOffset, runtimeSpan.sourceEndOffset)
					.includes(evidenceNorm)
			) {
				warnings.push(
					`beats[${index}].pacingDecision.causalProvenance[${provenanceIndex}].sourceMarker 无法在 runtime 冻结的本拍原文跨度定位`,
				);
			}
		});
		return;
	}
    if (locate) {
      const startMarkerLength = normalizeWithMap(startMarker).norm.length;
      const endMarkerLength = normalizeWithMap(endMarker).norm.length;
      let markerTooShort = false;
      // 太短的锚点：先把它定位到原文，再回传它所在位置附近的达标候选——规划层抄任一条即可过闸。
      if (startMarkerLength < DEFAULT_MIN_SOURCE_MARKER_CHARS) {
        errors.push(
          `beats[${index}].sourceStartMarker 归一化后仅 ${startMarkerLength} 个实义字符，至少需要 ${DEFAULT_MIN_SOURCE_MARKER_CHARS} 个${describeMarkerCandidates(chapterText, {})}`,
        );
        markerTooShort = true;
      }
      if (endMarkerLength < DEFAULT_MIN_SOURCE_MARKER_CHARS) {
        errors.push(
          `beats[${index}].sourceEndMarker 归一化后仅 ${endMarkerLength} 个实义字符，至少需要 ${DEFAULT_MIN_SOURCE_MARKER_CHARS} 个${describeMarkerCandidates(chapterText, {})}`,
        );
        markerTooShort = true;
      }
      if (markerTooShort) return;
      const start = locate(startMarker);
      const end = start ? locate(endMarker, start.end) : null;
      if (!start) {
        errors.push(
          `beats[${index}].sourceStartMarker 无法在章节原文定位：「${startMarker}」${describeMarkerCandidates(chapterText, {})}`,
        );
      }
      if (!end) {
        // 起点已定位时，候选只从起点之后取——避免把规划层引向会导致 end 早于 start 的片段。
        errors.push(
          `beats[${index}].sourceEndMarker 无法在起始锚点之后定位：「${endMarker}」${describeMarkerCandidates(
            chapterText,
            start ? { fromNorm: start.end } : {},
          )}`,
        );
      }
      if (start && end) {
        locatedSourceRanges.push({ clipIndex: beat.clipIndex, start: start.start, end: end.end });
        beat.pacingDecision?.causalProvenance.forEach((provenance, provenanceIndex) => {
          if (provenance.evidenceType !== "source_fact") return;
          const evidence = locate(provenance.sourceMarker, start.start);
          if (!evidence || evidence.start > end.end) {
            // 关键：候选严格限定在本拍跨度内。v19 实测规划层跨拍引用原文导致连续被拒，
            // 它无从得知"本拍跨度"到底覆盖哪些句子——这里直接把跨度内可用的句子列给它。
            warnings.push(
              `beats[${index}].pacingDecision.causalProvenance[${provenanceIndex}].sourceMarker 无法在本拍原文跨度定位：「${provenance.sourceMarker}」${describeMarkerCandidates(
                chapterText,
                { fromNorm: start.start, toNorm: end.end },
                "本拍跨度内可用锚点",
              )}`,
            );
          }
        });
      }
    }
  });
  const deliveryScope = trimmedStr(inputMeta?.deliveryScope);
  if (deliveryScope !== "full_chapter" && deliveryScope !== "bounded_duration") {
    errors.push("meta.deliveryScope 必须是 full_chapter 或 bounded_duration；禁止根据成片时长或 prompt 文案猜测交付范围");
  }
  if (deliveryScope === "full_chapter" && locate) {
    let coveredUntil = 0;
    for (const range of locatedSourceRanges.sort((left, right) => left.clipIndex - right.clipIndex)) {
      if (range.start > coveredUntil) {
        errors.push(
          `meta.deliveryScope=full_chapter 但原文覆盖在 clip ${range.clipIndex} 前存在区间缺口 ${coveredUntil}..${range.start}`,
        );
      }
      coveredUntil = Math.max(coveredUntil, range.end);
    }
    if (coveredUntil < locate.normLength) {
      errors.push(
        `meta.deliveryScope=full_chapter 但原文尾部未覆盖：${coveredUntil}..${locate.normLength}`,
      );
    }
  }
  const executionScope = trimmedStr(inputMeta?.executionScope);
  if (executionScope !== "prompt_only" && executionScope !== "media_delivery") {
    errors.push("meta.executionScope 必须是 prompt_only 或 media_delivery；执行边界必须显式声明，禁止默认进入媒体生产");
  }

  // 【换场缝清点·软告警（2026-07-13 ch24 瞬移实证）】相邻拍场景切换且时间连续（无 timeJumpNote）
  // 的缝，任务书会逐拍强制换场引导首拍；此处提醒小T核对切换是否过密/是否其实该给 timeJumpNote。
  {
    const seams: string[] = [];
    beats.forEach((b, i) => {
      if (i === 0) return;
      if (isTimeContinuousSceneChange(beats[i - 1], b)) {
        seams.push(`beats[${i - 1}→${i}]「${String(beats[i - 1].sceneName ?? "").trim()}」→「${String(b.sceneName ?? "").trim()}」`);
      }
    });
    if (seams.length) {
      warnings.push(
        `换场缝 ${seams.length} 处（时间连续的场景切换）：${seams.join("；")}——写手任务书已强制这些拍的首 shot 给换场引导（establishing/位移/VO 三选一）；若某处其实有时间跳跃，给该拍补 timeJumpNote 走转场口径`,
      );
    }
  }

  // filmBible / 合同 / castManifest 最小校验。
  const fb = (sheet.filmBible && typeof sheet.filmBible === "object" ? sheet.filmBible : {}) as Record<string, unknown>;
  const directorTone = normalizeNarrativeText(fb.directorTone, "filmBible.directorTone", warnings);
  const visualBible = normalizeNarrativeText(fb.visualBible, "filmBible.visualBible", warnings);
  const emotionalArc = normalizeNarrativeText(fb.emotionalArc, "filmBible.emotionalArc", warnings);
  const characterArcs = normalizeNarrativeText(fb.characterArcs, "filmBible.characterArcs", warnings);
  const continuityBible = normalizeNarrativeText(fb.continuityBible, "filmBible.continuityBible", warnings);
  const atmosphereStrategy = normalizeNarrativeText(fb.atmosphereStrategy, "filmBible.atmosphereStrategy", warnings);
  const hardRules = normalizeNarrativeText(fb.hardRules, "filmBible.hardRules", warnings);
  const motifs = normalizeNarrativeText(fb.motifs, "filmBible.motifs", warnings);
  if (!directorTone) warnings.push("filmBible.directorTone 未声明");
  if (!visualBible) warnings.push("filmBible.visualBible 未声明");
  if (!emotionalArc)
    warnings.push("filmBible.emotionalArc 未声明");
  if (!characterArcs)
    warnings.push("filmBible.characterArcs 未声明");
  if (!continuityBible)
    warnings.push("filmBible.continuityBible 未声明");
  if (!atmosphereStrategy)
    warnings.push("filmBible.atmosphereStrategy 未声明");
  const strategy = (sheet.adaptationStrategy && typeof sheet.adaptationStrategy === "object"
    ? sheet.adaptationStrategy
    : {}) as AdaptationStrategyDecl;
  const adaptationMode = trimmedStr(inputMeta?.adaptationMode);
  if (adaptationMode !== "faithful" && adaptationMode !== "creative") {
    warnings.push("meta.adaptationMode 未声明或非法；按 faithful 解释仅用于诊断，入口应显式传入 adaptationMode");
  }
  if (Array.isArray(strategy.cuts) && strategy.cuts.length > 0 && adaptationMode !== "creative") {
    errors.push("adaptationStrategy.cuts 已停用；一键成片固定忠实原文，不能登记删改来绕过原文覆盖");
  }
  const cast: CastManifestEntry[] = Array.isArray(sheet.castManifest)
    ? (sheet.castManifest as unknown[])
        .map((e) => {
          const r = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
          const kind = trimmedStr(r.kind) as CastManifestEntry["kind"];
          const name = trimmedStr(r.name);
          if (!name || !["character", "scene", "prop"].includes(kind)) return null;
          let materialIdentity: PropMaterialIdentity | undefined;
          if (kind === "prop") {
            const parsedIdentity = parsePropMaterialIdentity(r.materialIdentity);
            if (!parsedIdentity.ok) {
              errors.push(`castManifest 道具「${name}」${parsedIdentity.error}`);
              return null;
            }
            materialIdentity = parsedIdentity.value;
            if (materialIdentity.canonicalName !== name) {
              errors.push(
                `castManifest 道具「${name}」必须使用 canonicalName「${materialIdentity.canonicalName}」作为 name；状态效果只能写入 stateDescription，禁止拆成第二个道具名`,
              );
              return null;
            }
          }
          return {
            kind,
            name,
            ...(Array.isArray(r.states) ? { states: (r.states as unknown[]).map(trimmedStr).filter(Boolean) } : {}),
            ...(Number.isInteger(Number(r.firstClipIndex)) ? { firstClipIndex: Number(r.firstClipIndex) } : {}),
            ...(materialIdentity ? { materialIdentity } : {}),
          } as CastManifestEntry;
        })
        .filter((x): x is CastManifestEntry => Boolean(x))
    : [];
  if (!cast.length) warnings.push("castManifest 为空；资产域只能依据逐 beat 的符号引用推导");
  else {
    const castCharacters = new Set(cast.filter((c) => c.kind === "character").map((c) => c.name));
    const referenced = new Set(beats.flatMap((b) => b.characterRoleNames));
    for (const name of referenced) {
      if (!castCharacters.has(name)) warnings.push(`角色「${name}」出现在 beats 但不在 castManifest——资产域会漏建其卡`);
    }
    const castProps = new Set(cast.filter((c) => c.kind === "prop").map((c) => c.name));
    const referencedProps = new Set(beats.flatMap((b) => b.propNames ?? []));
    for (const name of referencedProps) {
      if (!castProps.has(name)) warnings.push(`道具「${name}」出现在 beats.propNames 但不在 castManifest——资产域会漏建其卡`);
    }
  }

  const rawMeta = sheet.meta && typeof sheet.meta === "object" && !Array.isArray(sheet.meta)
    ? sanitizeBeatSheetMeta(sheet.meta as Record<string, unknown>)
    : null;
  const durationPlanning = parseDurationContract({
    rawMeta,
    beats,
    errors,
  });
  const rawLearningProvenance = rawMeta?.learningProvenance;
  let learningProvenance: NonNullable<BeatSheet["meta"]>["learningProvenance"] | undefined;
  if (rawLearningProvenance !== undefined) {
    if (!rawLearningProvenance || typeof rawLearningProvenance !== "object" || Array.isArray(rawLearningProvenance)) {
      errors.push("meta.learningProvenance 必须是对象");
    } else {
      const record = rawLearningProvenance as Record<string, unknown>;
      const queryToolCallId = trimmedStr(record.queryToolCallId);
      const queriedValidatedCandidateIds = Array.isArray(record.queriedValidatedCandidateIds)
        ? record.queriedValidatedCandidateIds.map(trimmedStr).filter(Boolean)
        : [];
      const adoptedCandidateIds = Array.isArray(record.adoptedCandidateIds)
        ? record.adoptedCandidateIds.map(trimmedStr).filter(Boolean)
        : [];
      if (!queryToolCallId) errors.push("meta.learningProvenance.queryToolCallId 必填");
      if (!Array.isArray(record.queriedValidatedCandidateIds)) {
        errors.push("meta.learningProvenance.queriedValidatedCandidateIds 必须是数组");
      }
      if (!Array.isArray(record.adoptedCandidateIds)) {
        errors.push("meta.learningProvenance.adoptedCandidateIds 必须是数组");
      }
      if (new Set(queriedValidatedCandidateIds).size !== queriedValidatedCandidateIds.length) {
        errors.push("meta.learningProvenance.queriedValidatedCandidateIds 不得重复");
      }
      if (new Set(adoptedCandidateIds).size !== adoptedCandidateIds.length) {
        errors.push("meta.learningProvenance.adoptedCandidateIds 不得重复");
      }
      const queriedIds = new Set(queriedValidatedCandidateIds);
      const unverifiableIds = adoptedCandidateIds.filter((id) => !queriedIds.has(id));
      if (unverifiableIds.length > 0) {
        errors.push(
          `meta.learningProvenance.adoptedCandidateIds 必须是 queriedValidatedCandidateIds 子集：${unverifiableIds.join(", ")}`,
        );
      }
      if (queryToolCallId) {
        learningProvenance = {
          queryToolCallId,
          queriedValidatedCandidateIds,
          adoptedCandidateIds,
        };
      }
    }
  }

  const continuityIssues = validateClipContinuitySequence(
    beats.map((beat) => ({
      clipIndex: beat.clipIndex,
      continuityMode: beat.continuityMode,
      storyboardImageNodeId: beat.storyboardImageNodeId,
      lastFrameImageNodeId: beat.lastFrameImageNodeId,
      timeJumpNote: beat.timeJumpNote,
    })),
    { complete: true },
  );
  errors.push(...continuityIssues.map((issue) => issue.message));
  errors.push(...validateVisualContinuityTopology({
    beats: beats.map((beat) => ({
      clipIndex: beat.clipIndex,
      stateScope: beat.temporalContext?.stateScope,
      characterStateVersions: beat.characterStateVersions,
      characterStates: beat.characterStates,
      visualStateRefs: beat.visualStateRefs,
      continuityLedger: beat.continuityLedger,
    })),
    timeline: visualStateTimelineResult.value,
  }));
  const stateAnchorRequirements = collectVisualStateAnchorRequirements(
    visualStateTimelineResult.value,
  );
  for (const beat of beats) {
    const requirements = stateAnchorRequirements.filter((requirement) =>
      requirement.clipIndexes.includes(beat.clipIndex),
    );
    if (requirements.length > 0) beat.visualStateAnchorRequirements = requirements;
  }

  const normalized: BeatSheet = {
    version: 2,
    runId,
    ...(trimmedStr(sheet.chapterId) ? { chapterId: trimmedStr(sheet.chapterId) } : {}),
    ...(sourceCoveragePlan ? { sourceCoveragePlan } : {}),
    storyFactsContext,
    ...(visualStateTimelineResult.value
      ? { visualStateTimeline: visualStateTimelineResult.value }
      : {}),
    beats,
    filmBible: {
      directorTone,
      visualBible,
      emotionalArc,
      characterArcs,
      continuityBible,
      atmosphereStrategy,
      ...(hardRules ? { hardRules } : {}),
      ...(motifs ? { motifs } : {}),
    },
    adaptationStrategy: strategy,
    castManifest: cast,
    ...(rawMeta ? {
      meta: {
        ...rawMeta,
        ...(durationPlanning.targetDurationSeconds !== undefined
          ? { targetDurationSeconds: durationPlanning.targetDurationSeconds }
          : {}),
        ...(learningProvenance ? { learningProvenance } : {}),
      } as BeatSheet["meta"],
    } : {}),
  };

  return { ok: errors.length === 0, errors, warnings, normalized };
}

// ────────────────────────────────────────────────────────────────────────────
// 单 clip 任务切分：任务数与 clip 数严格相等。
// ────────────────────────────────────────────────────────────────────────────

export type WriterClipTask = {
  clipIndex: number;
};

/** BeatSheet v2 的唯一切分方式：每个 writer 任务恰好拥有一个 clip。 */
export function splitBeatClipTasks(beats: readonly Beat[]): WriterClipTask[] {
  return beats.map((_, clipIndex) => ({ clipIndex }));
}

export function readBeatSheetExecutionScope(
  sheet: Pick<BeatSheet, "meta">,
): "prompt_only" | "media_delivery" | null {
  const value = sheet.meta?.executionScope;
  return value === "prompt_only" || value === "media_delivery" ? value : null;
}

/**
 * 【原文跨度物化进节拍·2026-07-13 信息点守恒配套（正确默认层）】commit_beats 时按锚点把每拍
 * 的原文跨度全文切出来存进 beat.sourceSpanText——writer 任务书据此携带原文，避免
 * 「logline 蒸馏丢插叙/暗线 → writer 首稿缺少事实」的问题。
 * 定位失败或缺少章节原文时保留为空，由后续结构校验显式暴露输入缺口。
 */
export function enrichBeatsWithSourceSpans(sheet: BeatSheet, chapterText: string): void {
  const raw = String(chapterText || "");
  if (!raw.trim() || !Array.isArray(sheet.beats)) return;
  const locate = createMarkerLocator(raw);
  if (!locate.normLength) return;
  const { map } = normalizeWithMap(raw);
  for (const beat of sheet.beats) {
	const runtimeSpan = sheet.sourceCoveragePlan?.spans[beat.clipIndex];
	if (runtimeSpan && runtimeSpan.clipIndex === beat.clipIndex) {
		const rawStart = map[runtimeSpan.sourceStartOffset] ?? raw.length;
		const rawEndIndex = map[runtimeSpan.sourceEndOffset - 1];
		const rawEnd = rawEndIndex === undefined ? raw.length : rawEndIndex + 1;
		const runtimeSourceSpan = raw.slice(rawStart, rawEnd).trim();
		if (runtimeSourceSpan) beat.sourceSpanText = runtimeSourceSpan;
		continue;
	}
    const sMarker = String(beat.sourceStartMarker ?? "").trim();
    const eMarker = String(beat.sourceEndMarker ?? "").trim();
    if (!sMarker || !eMarker) continue;
    const sHit = locate(sMarker);
    if (!sHit) continue;
    const eHit = locate(eMarker, sHit.end);
    if (!eHit) continue;
    const origStart = map[Math.min(sHit.start, map.length - 1)] ?? 0;
    const origEnd = (map[Math.min(Math.max(eHit.end - 1, 0), map.length - 1)] ?? raw.length - 1) + 1;
    const span = raw.slice(origStart, origEnd).trim();
    if (!span) continue;
    beat.sourceSpanText = span;
  }
}

/** 换场缝判定（单一真相源·validateBeatSheet 清点与任务书注入共用）：场景切换且时间连续。 */
export function isTimeContinuousSceneChange(prev: Beat | undefined, cur: Beat): boolean {
  if (!prev || cur.timeJumpNote) return false;
  if (
    cur.temporalContext &&
    !["continuous", "continue_memory"].includes(cur.temporalContext.relationToPrevious)
  ) return false;
  const prevScene = String(prev.sceneName ?? "").trim();
  const curScene = String(cur.sceneName ?? "").trim();
  return Boolean(prevScene && curScene && prevScene !== curScene);
}
