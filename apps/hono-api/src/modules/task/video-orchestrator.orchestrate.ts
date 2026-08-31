import { foldT2S } from "./video-orchestrator.t2s-fold";
import { isStoryPreviewAssetData } from "./story-preview-asset";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import type { FlowRow } from "../flow/flow.repo";
import type { Beat } from "./video-orchestrator.beat-sheet";
import {
  buildClipPlaceholderNodes,
} from "./video-orchestrator.placeholder-nodes";
import { getVideoRun } from "./video-run.repo";
import {
  listAuthoringArtifacts,
  markAuthoringArtifact,
  stableContentHash,
  upsertAuthoringArtifact,
} from "./video-orchestrator.authoring.repo";
import { VIDEO_ORCHESTRATOR_PROTOCOL_VERSION } from "@tapcanvas/video-orchestrator-protocol";
import { listProjectNodeAssetsForOwner } from "../material/material.service";
import { readVoiceCardProfile } from "./voice-card-dub";
import { readCanvasCardStateMarker, classifyCanvasCardForRegistry } from "./material-card-classify";
import {
  summarizeClipAssetBinding,
  summarizeClipAssetContracts,
  diagnoseClipBinding,
  parseReferenceLabel,
  type ClipAssetKind,
} from "./video-orchestrator.clip-asset-binding";
import type {
  VideoReferenceImageBinding,
  VideoReferencePurpose,
} from "./video-reference-manifest";
import { purposeForAssetReferenceRole } from "./video-reference-manifest";
import type { VideoReferenceDeliveryContract } from "./video-reference-delivery";
import { validateSd2ClipReferenceBudget } from "./video-reference-budget";
import { restoreBeatSheetVideoReferenceAuthority } from "./video-orchestrator.reference-authority";
import { buildDeclaredClipSceneData } from "./video-orchestrator.clip-scene";
import {
  buildCanonicalVideoReferenceNodeIds,
  findLegacyClipReferenceFields,
} from "./video-orchestrator.clip-reference-contract";
import {
  readClipContinuityMode,
  validateClipContinuitySequence,
  type ClipContinuityMode,
} from "./video-orchestrator.continuity-contract";
import {
  parseBeatCharacterStateVersions,
  parseBeatSceneState,
  parseBeatTemporalContext,
  readTemporalStateScope,
  type BeatCharacterStateVersions,
  type BeatSceneState,
  type BeatTemporalContext,
} from "./video-orchestrator.temporal-state-contract";
import {
  parseBeatContinuityLedger,
  parseBeatVisualStateRefs,
  type BeatContinuityLedger,
  type VisualStateAnchorRequirement,
} from "./video-orchestrator.visual-state-timeline";
import {
  buildVideoAssetRepairDeclaration,
  isVideoAssetRepairErrorCode,
  persistVideoAssetRepairFrontier,
  type VideoAssetRepairDeclaration,
} from "./video-orchestrator.asset-repair";
import {
  buildCompletedFilmNodeData,
  type VideoConcatPolicy,
} from "./video-orchestrator.completed-film-node";

/** 资产类别 → 参考图标签中文前缀（与 clip-asset-binding 的 parseReferenceLabel 反解口径一致）。 */
const ASSET_KIND_LABEL: Record<string, string> = {
  character: "角色卡",
  scene: "场景卡",
  prop: "道具卡",
  ensemble: "群像图",
};

function referencePurposeForAssetKind(kind: string): VideoReferencePurpose {
  switch (kind) {
    case "character":
    case "scene":
    case "prop":
    case "ensemble":
      return kind;
    default:
      return "other";
  }
}

function referencePurposeForContractKind(kind: string): VideoReferencePurpose {
  switch (kind) {
    case "character":
      return "character";
    case "scene":
      return "scene";
    case "prop":
      return "prop";
    case "ensemble":
      return "ensemble";
    case "vfx":
      return "vfx";
    case "palette":
      return "style";
    case "composition":
      return "composition";
    default:
      return "other";
  }
}

// 灰度 flag：plan-on-canvas + 事件驱动续跑（默认 OFF；OFF 时整条新链路跳过、行为逐字不变）。
// 详见 docs/video/orchestrator-event-driven-refactor.md。
function isPlanOnCanvasEnabled(c: AppContext): boolean {
  const raw = String(
    (((c.env as Record<string, unknown>)?.VIDEO_ORCHESTRATOR_PLAN_ON_CANVAS ??
      globalThis.process?.env?.VIDEO_ORCHESTRATOR_PLAN_ON_CANVAS ??
      "") as string) || "",
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

// drive 是内部执行动作，必须从已持久化的 start run 进入，不能绕过 run 级幂等、
// 归属、计费和恢复合同直接提交供应商任务。该边界只验证 durable run 是否存在，
// 不要求用户二次确认，也不读取 prompt 语义。
function isDriveStartBoundaryEnabled(c: AppContext): boolean {
  const raw = String(
    (((c.env as Record<string, unknown>)?.VIDEO_DRIVE_CONSENT_GATE ??
      globalThis.process?.env?.VIDEO_DRIVE_CONSENT_GATE ??
      "") as string) || "",
  )
    .trim()
    .toLowerCase();
  // 默认开启：仅当显式关闭时才放行。
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

import {
  buildClipPlan,
  buildClipTimingPlan,
  extractExplicitClipDurations,
  shouldReanchorClipFirstFrame,
  type ClipPlanItem,
  type ClipTimingPlanItem,
  type EditingStyle,
} from "./video-orchestrator.clip-plan";
import {
  parseVideoGenerationContract,
  resolveVideoModelNativeAudioSupport,
  resolveStoryPlanGenerationContract,
  type VideoGenerationContract,
} from "./video-orchestrator.generation-contract";
import {
  parseVideoFinishingContract,
  type VideoFinishingContract,
} from "./video-orchestrator.finishing-contract";
import {
  parseVideoSpeechAuditContract,
  type VideoSpeechAuditContract,
} from "./video-orchestrator.speech-audit-contract";
import {
  inspectVideoFinishingOutput,
  inspectVideoFinishingPreSubmission,
  parseVideoFinishingTechnicalVerification,
  videoFinishingVerificationMatchesMedia,
  type VideoFinishingClipInput,
  type VideoFinishingTechnicalVerification,
} from "./video-orchestrator.finishing-verification";
import {
  buildVideoNarrativeDeliveryVerification,
  type VideoNarrativeDeliveryVerification,
} from "./video-orchestrator.narrative-delivery-verification";
import { resolveFinalMediaProbeTimeoutMs } from "./video-orchestrator.production-graph-evidence";
import {
  parseAssetObjectContracts,
  type AssetObjectContract,
} from "./video-orchestrator.asset-object-contract";
// clipNeedsEnsemble：判定本镜是否人群/多人同框（≥3 命名角色 或 clipPrompt 描述众人/围桌等）。
// 与起跑前 detectEnsembleGaps 同一口径（asset-selfheal 只 type-import 本模块，运行时无循环）。
import {
  collectComposeAudioNodeIds,
  buildComposeEdges,
  flowPatchMissingVoiceCardsFromLibrary,
} from "./video-orchestrator.asset-selfheal";
// 原生对白音频：配音卡真实试听资产 → 本轮冻结 Seedance 模型的 audio_url 输入（音画联合+对口型）。
import {
  resolveClipDialogueAudioReferences,
} from "./video-orchestrator.dialog-audio";
import { repairMissingVoiceDurations } from "./video-orchestrator.voice-duration";
import {
  probeMediaViaMediaWorker,
  type ProbeMediaResult,
} from "../../platform/media-worker/client";
import {
  MAX_CLIP_REFERENCE_AUDIOS,
  SPEAKER_REFERENCE_AUDIO_LIMIT_EXCEEDED,
} from "./video-orchestrator.media-budget";
// 情景语速解析（"偏快·痞子快嘴档"→数值）：归一化时转数值持久化，防非数字声明被丢。
import { parseDialoguePaceRate } from "./video-orchestrator.dialogue-capacity";
import {
  findFlowNode,
  freshReadFlowRow,
  persistFlowPatch,
  readDurableNodeVideoUrl,
  readFlowEdges,
  readFlowNodes,
  type VideoFlowNode,
} from "./video-orchestrator.flow-io";
import {
  upsertVideoRunStatusNode,
  type VideoRunStatusProjection,
} from "./video-orchestrator.status-node";
import { resolveClipVideoRuntime } from "./video-orchestrator.clip-resolve";
import {
  isVideoSubmitCapacityBackpressure,
  isVideoSubmitKnownPreUpstreamFailure,
  readVideoSubmitErrorCode,
  readVideoSubmitRejectedUrls,
} from "./video-orchestrator.submit-error";
import {
  getClipInflightTask,
  acquireRunDriveLock,
  releaseRunDriveLock,
} from "./video-orchestrator.clip-inflight";
import {
  generateVideoToCanvas,
  // 复用主树 handler 版 reconcile（带计费 settle/退款）作为唯一对账实现；
  // 不引入模块级 video-orchestrator.reconcile（避免重复定义/二义性）。
  reconcileVideoNodesForFlow,
} from "./agents-tool-bridge.generate-video-to-canvas";
import { concatVideosToCanvas } from "./agents-tool-bridge.video-concat";
import { persistVideoRunConcatenatingPhase } from "./video-orchestrator.production-phase";
import { runPublicTask } from "../apiKey/apiKey.routes";
import { extractLastFrameToImage } from "./agents-tool-bridge.extract-last-frame";
import {
  readClipSpeakerBindings,
  readStructuredSpeechEvents,
  type ClipSpeakerBinding,
} from "./video-orchestrator.speaker-contract";
import {
  bindVerifiedVoiceReferences,
  parseShotMotionDynamics,
  type ClipSpeechEvent,
  type ClipShot,
} from "./video-orchestrator.clip-shots";
import {
  detectBridgeFrameRoles,
  type BridgeFrameRole,
} from "./video-orchestrator.clip-structure";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  resolveObjectStorageConfig,
  createObjectStorageClientFromConfig,
  extractObjectStorageObjectKey,
} from "../asset/rustfs.client";

/**
 * 服务端视频创作数据模型与确定性编译函数。运行入口由 Workflow IR execution 统一拥有。
 *
 * 设计：LLM 只产「结构化创意计划 StoryPlan」（拍什么），orchestrator 确定性地决定「怎么安全、
 * 唯一、按序地拍完」。详见 docs/design/video-orchestrator-refactor.md。
 *
 * 状态机：planned → video_running → video_success/failed → concatenated
 *
 * 当前实现为 **骨架**：ClipPlan 构建、幂等检查、per-clip 契约组装、reconcile 调用、concat 调用
 * 的编排已搭好；真正触发图片/视频生成的两处调用点以 TODO 标注（避免本次提交触发真实生成、烧额度）。
 * 骨架可被端点调用并跑通 dry-run（mode:"plan"）：计算 ClipPlan + 各 slot 现有状态 + 下一步动作。
 */

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 读拆段语态；仅接受合法枚举，其余（含缺省）回退 undefined → 上层走默认 cut（多镜镜头表）。 */
function readEditingStyle(value: unknown): EditingStyle | undefined {
  const v = readTrimmedString(value).toLowerCase();
  return v === "montage" || v === "continuous" || v === "cut"
    ? (v as EditingStyle)
    : undefined;
}

export type StoryPlanClip = {
  /** 结构化镜头的静默剧情概括；只供最终 renderer 生成画面控制字段。 */
  logline?: string;
  /** 本 clip 内时空连续性声明。 */
  continuity?: string;
  /** 本 clip 的剪辑节奏声明。 */
  editRhythm?: string;
  /** 每段故事板提示词（供运动/对白/空间门禁检测使用；已不再用于逐镜生图）。 */
  storyboardPrompt?: string;
  /** 每段视频画面 prompt（本段的执行级运动提示词）。 */
  clipPrompt: string;
  /**
   * 导演显式定的本镜时长（秒）。**给了就以它为准**——服务端按它定段数+每段时长（snap 合法档），
   * 这是把「剪辑节奏/镜头数」还给导演的旋钮：时尚大片/MV/广告写 2~3s 做快切，叙事镜写长。
   * 缺省（不写）则回退 StoryPlan.editingStyle / 拉满自动拆段。全片要么都写、要么都不写。
   */
  durationSeconds?: number;
  /**
   * 本镜出场角色名（如 ["郑吒","张杰"]）。服务端按节点 data.roleName/characterName 精确取该角色卡的
   * 参考图（含 roleCardReferenceImages），**确定性绑定、不靠 label 猜**。小T 只需用故事语言写"这镜有谁"。
   */
  characterRoleNames?: string[];
  /**
   * 结构化说话人资产合同。character=人物身份（需有图角色卡+配音卡）；voice=纯声音通道
   * （不入画，只需配音卡）。服务端禁止从姓名或 dialogue 文本猜测此语义。
   */
  speakerBindings?: ClipSpeakerBinding[];
  /** 独立于镜头切换的完整人声事件时间线。 */
  speechEvents?: ClipSpeechEvent[];
  /** 结构化镜头；只能用 speechEventIds 引用独立人声事件。 */
  shots?: ClipShot[];
  /** writer 对 BeatSheet 戏剧义务的逐镜承载声明，随 frozen artifact 原样追溯。 */
  dramaticCoverage?: import("./video-orchestrator.dramatic-coverage").ClipDramaticCoverage;
  /**
   * 本镜出场道具 canonical 名（2026-07-14·与 characterRoleNames 同构，源自 beats.propNames 的
   * 服务端确定性合并）。绑定层按申报直绑对应道具卡；缺省退回文本提及匹配（滑窗兜底）。
   */
  propNames?: string[];
  /** 本镜实际出现的 canonical VFX 名；只由 BeatSheet 结构化声明。 */
  vfxNames?: string[];
  /**
   * 本镜发生地的场景 canonical 名。整章 commit_beats 由 Beat.sceneName 确定性回灌，
   * 参考图绑定层据此精确匹配本章画布上的同名场景卡；不是供本地语义猜测的自由文本。
   */
  sceneName?: string;
  /** 冻结的时间层与状态继承作用域。 */
  temporalContext?: BeatTemporalContext;
  /** 冻结的具体子场景入口/退出事实。 */
  sceneState?: BeatSceneState;
  /**
   * 本镜各角色的**形态/状态键**：`{ 角色名: stateKey }`。当角色在剧情中发生形态跃迁
   * （变身/开大/振魂/受伤/换装/老化）后，后续镜头在此标注该角色处于哪个状态版。执行时必须
   * 精确绑定 `roleName + stateKey`；存在 visualStateAnchorRequirements 时还必须逐字匹配 stateVersionId。
   * 未标该角色时使用基态；已声明状态但画布无对应状态版时必须进入 repair_assets，禁止回退基态。
   * 例：岳山镜5变身兵马俑神将 → 镜6/8/10 标 `{"岳山":"qin-terracotta"}`；万钧镜7化雷主 → 镜8/10/11 标 `{"万钧":"thunder-lord"}`。
   */
  characterStates?: Record<string, string>;
  /** 不依赖派生状态卡的可见人物状态版本。 */
  characterStateVersions?: BeatCharacterStateVersions;
  /** 当前 clip 使用的章级视觉状态版本外键。 */
  visualStateRefs?: Record<string, string[]>;
  /** clip 入口/出口的结构化连续性边界。 */
  continuityLedger?: BeatContinuityLedger;
  /** 本 clip 对应的角色状态锚需求。 */
  visualStateAnchorRequirements?: VisualStateAnchorRequirement[];
  /**
   * 本镜是空间敏感镜头（进出门/上下楼/上下车等拓扑动作）且已按导演台 blocking 流程处理。
   * 标了它 estimate/start 不再附 spatialBlockingWarning（软告警，见 spatial-blocking.ts）。
   */
  spatialBlocking?: boolean;
  /** 导演台 blocking 预览帧（经设计板重绘后）的节点 id；与 spatialBlocking 等效豁免软告警。 */
  blockingFrameNodeId?: string;
  /** 本镜唯一 V3 故事板节点；内部按时间顺序承载 1～3 个关键帧。 */
  storyboardImageNodeId?: string;
  storyboardFrameCount?: number;
  /** 本 clip 的唯一业务视频参考节点清单；对象合同引用会确定性编译进同一数组。 */
  videoReferenceNodeIds?: string[];
  /**
   * 本镜目标尾帧关键帧节点 id（kind=image、有真实 imageUrl）：存在且能解析到 url 时设 lastFrameUrl
   * （钉死特效终态/朝向落点）。与 storyboardImageNodeId 对称、可选；缺失则不设（旧行为）。
   */
  lastFrameImageNodeId?: string;
  /** agents 冻结的逐镜连续性模式；执行层不得从 prompt 或 editingStyle 猜测。 */
  continuityMode?: ClipContinuityMode;
  /** BeatSheet 冻结的同级资产对象合同；最终视频提示词只渲染运动字段。 */
  assetObjectContracts?: AssetObjectContract[];
  /**
   * 本镜【退出态】（≤80字一句话）：本镜结束时 谁在哪/姿态/视线/手中道具/伤况/光线。
   * cut 并发镜间零信息传递，退出态是相邻镜衔接的结构化锚：服务端渲染下一镜时确定性前置
   * 「承接上镜退出态」注解（见 clip-structure.buildExitStateRelayNote），critic 维13 逐对比对
   * 「N 镜 exitState ↔ N+1 镜 continuity 进入态」。缺失不硬拦（addclips-lint 软提醒）。
   * 写法口径见知识卡 `状态连续性/cut-mode-prompt-state-relay`（退出态=下镜开场的起跳台）。
   */
  exitState?: string;
  /**
   * 本镜的场景卡节点 id（显式声明本镜发生在哪个场景·2026-07-07 ch6 复盘）。承接模板的
   * 「同场景=状态精确连续 / 跨场景=剪切点软承接」判定**优先**读它（两相邻镜都声明才生效），
   * 不再只靠 videoReferenceNodeIds ∩ 场景类节点推导——场景卡绑错会连带带错承接模板。
   * 该 id 也应出现在 videoReferenceNodeIds 里（参考图绑定照旧走唯一执行清单）。
   */
  sceneCardNodeId?: string;
  /**
   * 本镜与上一镜之间的叙事时间跳跃说明（如「半月后」「三日后」；同一时间线连续则省略）。
   * 给了它，承接注解换「时间跳跃」口径：只承接剧情事实与角色长期状态（修为/伤况/关系/持有物），
   * 不对齐上镜姿态/位置/光线/未完成动作残势（ch6 实测「半月后」被误套姿态精确连续模板）。
   */
  timeJumpNote?: string;
  /**
   * 本镜确因 adaptationStrategy.cuts 删减导致原文跨度大（画面只承载留存节拍）。标了它
   * 剧情密度软告警（sourceDensityWarning）对本 clip 豁免。默认不标——多数超密是拆镜不足。
   */
  densityReviewed?: boolean;
  /**
   * 本镜确属导演有意为之的时空蒙太奇（单镜横跨多个叙事时间段）。标了它时空过载诊断
   * （clip_timespan_overload）对本 clip 豁免。默认不标——多数"跨时空"是拆段失误（ch3 实测）。
   */
  timespanReviewed?: boolean;
  /**
   * 本镜确属有意的纯定格镜（clipPrompt 与 storyboardPrompt 雷同、无运镜/动作）。标了它「字段互抄」
   * 软告警（clipFieldEchoWarning·吸收 LumenX model_echo）对本 clip 豁免。默认不标——多数雷同=偷懒没写运动。
   */
  echoReviewed?: boolean;
  /**
   * 本镜对白虽长但确属无需把整段念全（如背景嘟囔/可截断的画外杂音）。标了它对白容量诊断
   * （clip_dialogue_overflow）对本 clip 豁免。默认不标——口播对白原文一字不丢是用户铁律。
   */
  dialogueDurationReviewed?: boolean;
  /**
   * 本镜确属导演有意为之的纯无运动镜头（clipPrompt 无运镜/动作词）。标了它运动门禁
   * 对本 clip 的运动密度诊断豁免。该诊断不得阻止生产或交付。
   */
  motionReviewed?: boolean;
  /**
   * 本镜确属导演有意的超长连续镜头（如超过单镜时长上限的 15s+）。标了它结构门禁
   * 对本 clip 的结构密度诊断豁免。该诊断不得阻止生产或交付。
   */
  structureReviewed?: boolean;
  /**
   * 本镜对应原著文本的起始锚点（约 20 字原文逐字片段），供导演做「首尾相接·零遗漏」机检。
   * **服务端已消费**（2026-07-02）：estimate/start 时按每段 sourceStartMarker/EndMarker 回章节原文拼图，
   * 检出漏段/锚点未命中/分段乱序，注入 sourceCoverageWarning 软告警（见 video-orchestrator.source-coverage.ts，
   * flag VIDEO_SOURCE_COVERAGE_WARN 默认 ON）。对白逐字命中校验见知识卡 `叙事改编/segment-by-source-anchor-markers`。
   */
  sourceStartMarker?: string;
  /**
   * 本镜对应原著文本的结束锚点（约 20 字原文逐字片段），与 sourceStartMarker 配对使用。
   */
  sourceEndMarker?: string;
  /**
   * 本镜对白的念白语速（字当量/秒）。有实际人声时由 BeatSheet Agent 根据本轮真实表演情境明确提交；
   * 服务端不从知识卡、情绪标签或默认值推断，只用同一数值校验该镜时长是否够念，并以物理上限 6 字/秒封顶。
   */
  dialoguePaceRate?: number;
  /**
   * 本镜「动作迁移」（kling-v3-omni only）：把 sourceVideoUrl 示范视频的动作/运镜/风格迁到本镜新主体。
   * `'feature'`=动作迁移（新主体来自 referenceImages/首帧，prompt 写主体+环境别写动作）；`'base'`=把参考
   * 视频当底片续演。**仅显式声明时生效**，缺省不触发——续写链（continuous）仍走自动尾帧逻辑，逐字等价。
   * 配套字段：sourceVideoUrl（示范视频）、keepOriginalSound（保留原音轨'yes'/'no'）。见知识卡
   * `视频复刻替换/kling-omni-firstlast-motiontransfer`。
   */
  videoReferType?: string;
  /** 本镜动作迁移的示范/参考视频 URL（与 videoReferType 配套；显式给则覆盖续写链的上一镜尾帧续写源）。 */
  sourceVideoUrl?: string;
  /** 动作迁移时是否保留示范视频原音轨（'yes'/'no'，默认 'no'）；舞蹈/MV 迁移想留 BGM 时设 'yes'。 */
  keepOriginalSound?: string;
};

export type StoryPlan = {
  runId: string;
  targetDurationSeconds: number;
  /** 语义层冻结的分段拓扑；存在时后续 plan/estimate/start 均不得改段。 */
  clipTopology?: { expectedClipCount: number; durationsSeconds: number[] };
  /** 全片统一视频模型 key。 */
  videoModel: string;
  /** estimate 前冻结并贯穿 start/worker/真实提交的模型与离散时长合同。 */
  generationContract?: VideoGenerationContract;
  /** 可选商业母版后期合同；存在时 concat 只是受保护源片，不是最终交付。 */
  finishingContract?: VideoFinishingContract;
  /** 可选商用成片人声审计合同；存在时逐 clip 核验实际发声与冻结台词。 */
  speechAuditContract?: VideoSpeechAuditContract;
  aspect?: string;
  /**
   * 全片统一分辨率档。必须来自当前 AI 对话生成偏好或 agents 对实时目录的明确选择；禁止静态默认。
   */
  resolution?: string;
  recipeId?: string;
  /**
   * 拆段语态（节奏旋钮）：**缺省 `cut`**＝一个场景一条 ≈15s 多镜镜头表 clip（reference_images·模型内部
   * 切镜·镜间独立并行·不接尾帧·无彩色关键帧），叙事/小说/漫剧/绝大多数片走这条｜`montage`=快切蒙太奇
   * （最短镜，时尚大片/MV/广告）｜`continuous`=连续拉满长镜（**逃生口**，仅 >15s 一条装不下的连续动作·串行续写）。
   */
  editingStyle?: EditingStyle;
  /**
   * 题材标签（节奏/对白门禁的语境）：叙事类（叙事/剧情/漫剧/短剧/故事）强制对白；
   * 电商/广告/时尚/MV/复刻/转场/B-roll 等天然无对白题材自动豁免对白门禁（用户定调 2026-06-14）。
   */
  filmGenre?: string;
  /** 片级"已人工核对无对白"豁免标记（确属空镜/B-roll/MV 时由导演显式置 true）。 */
  dialogueReviewed?: boolean;
  /**
   * 由 agents 的创作决策明确声明的视觉预制作合同。它不是从项目名、提示词或已加载 Skill
   * 推断出来的：声明为 storyboard 后，付费起跑前必须有真实、可见且逐 clip 绑定的故事板资产。
   */
  visualPreproduction?: {
    kind: "storyboard";
    requiredClipIndexes: number[];
    requiredAssetNodeIdsByClip: Array<{
      clipIndex: number;
      assetNodeIds: string[];
    }>;
  };
  /** 创意分段（LLM 产出）。可选 durationSeconds 由导演定节奏；其余 nodeId 由服务端定。 */
  clips: StoryPlanClip[];
  /** 组节点 id（用于补产品/角色参考图、pin aspect）。 */
  parentGroupId?: string;
};

export type OrchestrateMode =
  | "plan" // dry-run：只算 ClipPlan + 现状 + 下一步，不生成
  | "drive"; // 完整驱动（骨架：生成处 TODO）

export type ClipRuntimeState = {
  clipIndex: number;
  nodeId: string;
  clipId: string;
  durationSeconds: number;
  status: "absent" | "running" | "success" | "failed" | "submit_failed";
  videoUrl?: string;
  /** 失败归因（节点 data.clipSubmitError）：run 级失败文案/status 响应据此说清哪段为什么挂。 */
  error?: string;
  /** 服务端判定的本段下一步动作。 */
  nextAction:
    | "submit_video"
    | "await_previous_clip"
    | "reconcile"
    | "done";
};

export type VideoOrchestrateResult = {
  ok: true;
  runId: string;
  state:
    | "planned"
    | "video_running"
    | "video_success"
    | "video_failed"
    | "concatenating"
    | "concatenated"
    | "finishing_running"
    | "finishing_failed"
    | "finished";
  mode: OrchestrateMode;
  targetDurationSeconds: number;
  videoModel: string;
  generationContract: VideoGenerationContract;
  durationOptions: number[];
  clipPlan: Array<ClipPlanItem | ClipTimingPlanItem>;
  clips: ClipRuntimeState[];
  /** 已成片可拼接的 clip 节点 id（按序）；全段 success 才齐。 */
  concatNodeIds: string[];
  allClipsSucceeded: boolean;
  /** drive 模式本轮真正执行的动作（确定性单步推进）。 */
  driveAction?:
    | "reconcile"
    | "submit_video"
    | "concat"
    | "finish"
    | "noop";
  /** concat 完成后的成片 URL（仅 driveAction==="concat" 成功时）。 */
  concatVideoUrl?: string;
  /** 商业后期合同存在时的最终母版 URL；源拼接片仍保留在 concatVideoUrl。 */
  masterVideoUrl?: string;
  /** 源片与母版的 ffprobe 技术真值；不删除产物，只约束“商用母版已满足”的声明。 */
  finishingVerification?: VideoFinishingTechnicalVerification;
  /** 原文覆盖、发声台账、时长和拼接策略的持久结构证据。 */
  deliveryEvidence?: {
    narrativeVerification?: VideoNarrativeDeliveryVerification;
    finalMediaProbe?: ProbeMediaResult;
  };
  /** 给调用方/orchestrator 的下一步建议。 */
  nextStep: string;
  /** 终态写回画布状态节点的事实；投影失败不回滚已经生成的成片。 */
  statusProjection?: VideoRunStatusProjection;
  /** Pre-POST identity failure that agents-cli must repair by generating only the missing cards. */
  assetRepairRequired?: boolean;
  assetRepair?: VideoAssetRepairDeclaration;
};

function parseStoryPlanSpeechEvents(
  value: unknown,
  clipIdentity: string,
): ClipSpeechEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AppError(`storyPlan.clips[${clipIdentity}].speechEvents 必须是数组`, {
      status: 400,
      code: "video_orchestrate_speech_event_structure_invalid",
    });
  }
  const seenIds = new Set<string>();
  return value.map((rawEvent, eventIndex) => {
    const path = `storyPlan.clips[${clipIdentity}].speechEvents[${eventIndex}]`;
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      throw new AppError(`${path} 必须是对象`, {
        status: 400,
        code: "video_orchestrate_speech_event_structure_invalid",
      });
    }
    const event = rawEvent as Record<string, unknown>;
    const speechEventId = readTrimmedString(event.speechEventId);
    const lineId = readTrimmedString(event.lineId);
    const speakerName = readTrimmedString(event.speakerName);
    const delivery = event.delivery;
    const startOffset = Number(event.startOffset);
    const endOffset = Number(event.endOffset);
    const startSeconds = Number(event.startSeconds);
    const endSeconds = Number(event.endSeconds);
    if (
      !speechEventId
      || !lineId
      || !speakerName
      || !Number.isInteger(startOffset)
      || startOffset < 0
      || !Number.isInteger(endOffset)
      || endOffset <= startOffset
      || !Number.isFinite(startSeconds)
      || startSeconds < 0
      || !Number.isFinite(endSeconds)
      || endSeconds <= startSeconds
      || (delivery !== "on_screen" && delivery !== "off_screen" && delivery !== "voice_over")
    ) {
      throw new AppError(`${path} 缺少完整、可执行的人声事件字段`, {
        status: 400,
        code: "video_orchestrate_speech_event_structure_invalid",
      });
    }
    if (seenIds.has(speechEventId)) {
      throw new AppError(`${path}.speechEventId 重复：${speechEventId}`, {
        status: 400,
        code: "video_orchestrate_speech_event_structure_invalid",
      });
    }
    seenIds.add(speechEventId);
    return {
      speechEventId,
      lineId,
      startOffset,
      endOffset,
      startSeconds,
      endSeconds,
      speakerName,
      delivery,
      ...(readTrimmedString(event.performance)
        ? { performance: readTrimmedString(event.performance) }
        : {}),
      ...(readTrimmedString(event.spokenText)
        ? { spokenText: readTrimmedString(event.spokenText) }
        : {}),
    };
  });
}

export function validateStoryPlan(raw: unknown): StoryPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("storyPlan is required", {
      status: 400,
      code: "video_orchestrate_plan_required",
    });
  }
  const record = raw as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "clipChaining")) {
    throw new AppError(
      "storyPlan.clipChaining 已移除；逐 clip 的 continuityMode 是唯一连续性语义合同",
      { status: 400, code: "video_orchestrate_legacy_clip_chaining_forbidden" },
    );
  }
  const runId = readTrimmedString(record.runId);
  if (!runId) {
    throw new AppError("storyPlan.runId is required", {
      status: 400,
      code: "video_orchestrate_run_id_required",
    });
  }
  // Model identity is already a structured catalog field. Preserve it exactly:
  // runtime availability is validated against the live model catalog, never by
  // guessing a family/date alias in local code.
  const videoModel = readTrimmedString(record.videoModel);
  if (!videoModel) {
    throw new AppError("storyPlan.videoModel is required", {
      status: 400,
      code: "video_orchestrate_model_required",
    });
  }
  const target = Number(record.targetDurationSeconds);
  if (!Number.isFinite(target) || target <= 0) {
    throw new AppError("storyPlan.targetDurationSeconds must be > 0", {
      status: 400,
      code: "video_orchestrate_target_duration_required",
    });
  }
  const clipsRaw = Array.isArray(record.clips) ? record.clips : [];
  const clips: StoryPlanClip[] = clipsRaw
    .map((item): StoryPlanClip | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const r = item as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(r, "prompt")) {
        throw new AppError(
          `storyPlan.clips[${String(r.clipIndex ?? "?")}].prompt 已移除；唯一执行提示词字段是 clipPrompt`,
          { status: 400, code: "video_orchestrate_legacy_clip_prompt_field_forbidden" },
        );
      }
      const clipPrompt = readTrimmedString(r.clipPrompt);
      if (!clipPrompt) return null;
      const legacyReferenceFields = findLegacyClipReferenceFields(r);
      if (legacyReferenceFields.length) {
        throw new AppError(
          `storyPlan.clips[${String(r.clipIndex ?? "?")}].referenceImageNodeIds 已移除；请只提交 videoReferenceNodeIds`,
          { status: 400, code: "video_orchestrate_legacy_clip_reference_field_forbidden" },
        );
      }
      if (Object.prototype.hasOwnProperty.call(r, "chainFromPrev")) {
        throw new AppError(
          `storyPlan.clips[${String(r.clipIndex ?? "?")}].chainFromPrev 已移除；调度依赖只由 continuityMode 派生`,
          { status: 400, code: "video_orchestrate_legacy_chain_field_forbidden" },
        );
      }
      const continuityMode = readClipContinuityMode(r.continuityMode);
      const roleNames = Array.isArray(r.characterRoleNames)
        ? (r.characterRoleNames as unknown[])
            .map((x) => readTrimmedString(x))
            .filter(Boolean)
        : [];
      const speakerBindings = readClipSpeakerBindings(r).bindings;
      const speechEvents = parseStoryPlanSpeechEvents(
        r.speechEvents,
        String(r.clipIndex ?? "?"),
      );
      const shots = Array.isArray(r.shots)
        ? r.shots
            .map((rawShot): ClipShot | null => {
              if (!rawShot || typeof rawShot !== "object" || Array.isArray(rawShot)) return null;
              const shot = rawShot as Record<string, unknown>;
              const legacySpeechFields = [
                "speakerName",
                "dialogueLineId",
                "dialogueStartOffset",
                "dialogueEndOffset",
                "dialogueDelivery",
                "dialoguePerformance",
                "dialogue",
                "dialogueText",
              ].filter((field) => Object.prototype.hasOwnProperty.call(shot, field));
              if (legacySpeechFields.length > 0) {
                throw new AppError(
                  `storyPlan.clips[${String(r.clipIndex ?? "?")}].shots[] 的人声字段已移除：${legacySpeechFields.join(", ")}；请只用 speechEventIds 引用 clip.speechEvents`,
                  { status: 400, code: "video_orchestrate_legacy_shot_speech_field_forbidden" },
                );
              }
              const action = readTrimmedString(shot.action);
              const shotDuration = Number(shot.durationSeconds);
              if (!action || !Number.isFinite(shotDuration) || shotDuration <= 0) return null;
              const motionDynamics = parseShotMotionDynamics(shot.motionDynamics);
              if (motionDynamics.errors.length) {
                throw new AppError(
                  `storyPlan.clips[${String(r.clipIndex ?? "?")}].shots[].motionDynamics: ${motionDynamics.errors.join("；")}`,
                  { status: 400, code: "video_orchestrate_motion_dynamics_invalid" },
                );
              }
              const shotNo = Number(shot.shotNo);
              return {
                action,
                durationSeconds: shotDuration,
                ...(Number.isInteger(shotNo) && shotNo > 0 ? { shotNo } : {}),
                ...(readTrimmedString(shot.visualTask)
                  ? { visualTask: readTrimmedString(shot.visualTask) }
                  : {}),
                ...(readTrimmedString(shot.framing)
                  ? { framing: readTrimmedString(shot.framing) }
                  : {}),
                ...(readTrimmedString(shot.lensIntent)
                  ? { lensIntent: readTrimmedString(shot.lensIntent) }
                  : {}),
                ...(readTrimmedString(shot.composition)
                  ? { composition: readTrimmedString(shot.composition) }
                  : {}),
                ...(readTrimmedString(shot.cameraMove)
                  ? { cameraMove: readTrimmedString(shot.cameraMove) }
                  : {}),
                ...(readTrimmedString(shot.lighting)
                  ? { lighting: readTrimmedString(shot.lighting) }
                  : {}),
                ...(readTrimmedString(shot.materialResponse)
                  ? { materialResponse: readTrimmedString(shot.materialResponse) }
                  : {}),
                ...(Array.isArray(shot.speechEventIds)
                  ? {
                      speechEventIds: shot.speechEventIds
                        .map((eventId) => readTrimmedString(eventId))
                        .filter(Boolean),
                    }
                  : {}),
                ...(readTrimmedString(shot.sound)
                  ? { sound: readTrimmedString(shot.sound) }
                  : {}),
                ...(readTrimmedString(shot.soundPerspective)
                  ? { soundPerspective: readTrimmedString(shot.soundPerspective) }
                  : {}),
                ...(readTrimmedString(shot.notes)
                  ? { notes: readTrimmedString(shot.notes) }
                  : {}),
                ...(motionDynamics.value ? { motionDynamics: motionDynamics.value } : {}),
              };
            })
            .filter((shot): shot is ClipShot => shot !== null)
        : [];
      if (Array.isArray(r.shots) && shots.length !== r.shots.length) {
        throw new AppError(
          `storyPlan.clips[${String(r.clipIndex ?? "?")}].shots contains an invalid shot; every shot requires action and durationSeconds > 0`,
          { status: 400, code: "video_orchestrate_shot_structure_invalid" },
        );
      }
      const propNames = Array.isArray(r.propNames)
        ? (r.propNames as unknown[])
            .map((x) => readTrimmedString(x))
            .filter(Boolean)
        : [];
      const vfxNames = Array.isArray(r.vfxNames)
        ? (r.vfxNames as unknown[])
            .map((x) => readTrimmedString(x))
            .filter(Boolean)
        : [];
      // 形态/状态键：{ 角色名: stateKey }。角色变身/受伤/换装后，后续镜头据此绑对应状态版卡。
      const characterStates: Record<string, string> = {};
      if (r.characterStates && typeof r.characterStates === "object" && !Array.isArray(r.characterStates)) {
        for (const [k, v] of Object.entries(r.characterStates as Record<string, unknown>)) {
          const name = readTrimmedString(k);
          const stateKey = readTrimmedString(v);
          if (name && stateKey) characterStates[name] = stateKey;
        }
      }
      const temporalContext = parseBeatTemporalContext(
        r.temporalContext,
        `storyPlan.clips[${String(r.clipIndex ?? "?")}].temporalContext`,
      );
      const sceneState = parseBeatSceneState(
        r.sceneState,
        `storyPlan.clips[${String(r.clipIndex ?? "?")}].sceneState`,
      );
      const characterStateVersions = parseBeatCharacterStateVersions(
        r.characterStateVersions,
        `storyPlan.clips[${String(r.clipIndex ?? "?")}].characterStateVersions`,
      );
      const continuityLedger = parseBeatContinuityLedger(
        r.continuityLedger,
        `storyPlan.clips[${String(r.clipIndex ?? "?")}].continuityLedger`,
      );
      const visualStateRefs = parseBeatVisualStateRefs(
        r.visualStateRefs,
        `storyPlan.clips[${String(r.clipIndex ?? "?")}].visualStateRefs`,
      );
      const temporalStateErrors = [
        ...temporalContext.errors,
        ...sceneState.errors,
        ...characterStateVersions.errors,
        ...continuityLedger.errors,
        ...visualStateRefs.errors,
      ];
      if (temporalStateErrors.length) {
        throw new AppError(temporalStateErrors.join("；"), {
          status: 400,
          code: "video_orchestrate_temporal_state_contract_invalid",
        });
      }
      const durRaw = Math.trunc(Number(r.durationSeconds));
      const durationSeconds =
        Number.isFinite(durRaw) && durRaw > 0 ? durRaw : undefined;
      const objectContracts = parseAssetObjectContracts(
        Array.isArray(r.assetObjectContracts) ? r.assetObjectContracts : [],
        `storyPlan.clips[${String(r.clipIndex ?? "?")}].assetObjectContracts`,
        { allowEmpty: true },
      );
      if (objectContracts.errors.length) {
        throw new AppError(objectContracts.errors.join("；"), {
          status: 400,
          code: "video_orchestrate_asset_object_contract_invalid",
        });
      }
      const videoReferenceNodeIds = buildCanonicalVideoReferenceNodeIds({
        videoReferenceNodeIds: (Array.isArray(r.videoReferenceNodeIds) ? r.videoReferenceNodeIds : [])
          .map(readTrimmedString)
          .filter(Boolean),
        assetObjectContracts: objectContracts.contracts,
        visualStateAnchorRequirements: Array.isArray(r.visualStateAnchorRequirements)
          ? r.visualStateAnchorRequirements as VisualStateAnchorRequirement[]
          : [],
      });
      return {
        clipPrompt,
        ...(durationSeconds ? { durationSeconds } : {}),
        ...(readTrimmedString(r.storyboardPrompt)
          ? { storyboardPrompt: readTrimmedString(r.storyboardPrompt) }
          : {}),
        ...(roleNames.length ? { characterRoleNames: roleNames } : {}),
        ...(speakerBindings.length ? { speakerBindings } : {}),
        ...(speechEvents.length ? { speechEvents } : {}),
        ...(shots.length ? { shots } : {}),
        ...(propNames.length ? { propNames } : {}),
        ...(vfxNames.length ? { vfxNames } : {}),
        ...(readTrimmedString(r.sceneName)
          ? { sceneName: readTrimmedString(r.sceneName) }
          : {}),
        ...(temporalContext.value ? { temporalContext: temporalContext.value } : {}),
        ...(sceneState.value ? { sceneState: sceneState.value } : {}),
        ...(Object.keys(characterStates).length ? { characterStates } : {}),
        ...(characterStateVersions.value
          ? { characterStateVersions: characterStateVersions.value }
          : {}),
        ...(continuityLedger.value
          ? { continuityLedger: continuityLedger.value }
          : {}),
        ...(visualStateRefs.value
          ? { visualStateRefs: visualStateRefs.value }
          : {}),
        ...(Array.isArray(r.visualStateAnchorRequirements)
          ? { visualStateAnchorRequirements: r.visualStateAnchorRequirements as VisualStateAnchorRequirement[] }
          : {}),
        ...(readTrimmedString(r.sceneCardNodeId)
          ? { sceneCardNodeId: readTrimmedString(r.sceneCardNodeId) }
          : {}),
        ...(readTrimmedString(r.timeJumpNote)
          ? { timeJumpNote: readTrimmedString(r.timeJumpNote) }
          : {}),
        ...(r.spatialBlocking === true ? { spatialBlocking: true } : {}),
        ...(readTrimmedString(r.blockingFrameNodeId)
          ? { blockingFrameNodeId: readTrimmedString(r.blockingFrameNodeId) }
          : {}),
        ...(readTrimmedString(r.storyboardImageNodeId)
          ? { storyboardImageNodeId: readTrimmedString(r.storyboardImageNodeId) }
          : {}),
        ...(Number.isInteger(Number(r.storyboardFrameCount))
          ? { storyboardFrameCount: Number(r.storyboardFrameCount) }
          : {}),
        videoReferenceNodeIds,
        ...(readTrimmedString(r.lastFrameImageNodeId)
          ? { lastFrameImageNodeId: readTrimmedString(r.lastFrameImageNodeId) }
          : {}),
        ...(continuityMode ? { continuityMode } : {}),
        assetObjectContracts: objectContracts.contracts,
        ...(readTrimmedString(r.exitState)
          ? { exitState: readTrimmedString(r.exitState) }
          : {}),
        ...(r.densityReviewed === true ? { densityReviewed: true } : {}),
        ...(r.timespanReviewed === true ? { timespanReviewed: true } : {}),
        ...(r.echoReviewed === true ? { echoReviewed: true } : {}),
        ...(r.dialogueDurationReviewed === true ? { dialogueDurationReviewed: true } : {}),
        ...(r.motionReviewed === true ? { motionReviewed: true } : {}),
        ...(r.structureReviewed === true ? { structureReviewed: true } : {}),
        ...(readTrimmedString(r.sourceStartMarker)
          ? { sourceStartMarker: readTrimmedString(r.sourceStartMarker) }
          : {}),
        ...(readTrimmedString(r.sourceEndMarker)
          ? { sourceEndMarker: readTrimmedString(r.sourceEndMarker) }
          : {}),
        // dialoguePaceRate 只持久化 Agent 已提交的数值事实；本地不从表演描述推断语速。
        ...((): Record<string, number> => {
          const pace = parseDialoguePaceRate(r.dialoguePaceRate);
          return pace && pace > 0 ? { dialoguePaceRate: pace } : {};
        })(),
      };
    })
    .filter((c): c is StoryPlanClip => c !== null);

  if (clipsRaw.length > 0 && clips.length !== clipsRaw.length) {
    throw new AppError("storyPlan.clips contains an invalid clip; each clip requires clipPrompt", {
      status: 400,
      code: "video_orchestrate_clip_structure_invalid",
    });
  }
  const continuityIssues = validateClipContinuitySequence(
    clips.map((clip, clipIndex) => ({
      clipIndex,
      continuityMode: clip.continuityMode,
      storyboardImageNodeId: clip.storyboardImageNodeId,
      lastFrameImageNodeId: clip.lastFrameImageNodeId,
      timeJumpNote: clip.timeJumpNote,
    })),
    { complete: true },
  );
  if (continuityIssues.length) {
    throw new AppError(continuityIssues.map((issue) => issue.message).join("；"), {
      status: 400,
      code: "video_orchestrate_continuity_contract_invalid",
      details: { issues: continuityIssues },
    });
  }
  const topologyRaw = record.clipTopology;
  let clipTopology: StoryPlan["clipTopology"];
  if (topologyRaw !== undefined) {
    const topology = topologyRaw && typeof topologyRaw === "object" && !Array.isArray(topologyRaw)
      ? topologyRaw as Record<string, unknown>
      : null;
    const expectedClipCount = Math.trunc(Number(topology?.expectedClipCount));
    const durationsSeconds = Array.isArray(topology?.durationsSeconds)
      ? topology.durationsSeconds.map((value) => Math.trunc(Number(value)))
      : [];
    if (
      !topology || expectedClipCount < 1 || durationsSeconds.length !== expectedClipCount ||
      durationsSeconds.some((value) => !Number.isFinite(value) || value <= 0) ||
      durationsSeconds.reduce((total, value) => total + value, 0) !== Math.trunc(target)
    ) {
      throw new AppError("storyPlan.clipTopology must exactly match targetDurationSeconds", {
        status: 400,
        code: "video_orchestrate_clip_topology_invalid",
      });
    }
    const explicitDurations = extractExplicitClipDurations(clips);
    if (clips.length > 0 && (clips.length !== expectedClipCount || !explicitDurations || !explicitDurations.every((duration, index) => duration === durationsSeconds[index]))) {
      throw new AppError("storyPlan.clips does not match frozen clipTopology", {
        status: 409,
        code: "video_orchestrate_clip_topology_mismatch",
      });
    }
    clipTopology = { expectedClipCount, durationsSeconds };
  }

  const generationContract = parseVideoGenerationContract(record.generationContract);
  const finishingContract = parseVideoFinishingContract(record.finishingContract);
  if (Object.prototype.hasOwnProperty.call(record, "finishingContract") && !finishingContract) {
    throw new AppError("storyPlan.finishingContract is invalid", {
      status: 400,
      code: "video_orchestrate_finishing_contract_invalid",
    });
  }
  const speechAuditContract = parseVideoSpeechAuditContract(record.speechAuditContract);
  if (Object.prototype.hasOwnProperty.call(record, "speechAuditContract") && !speechAuditContract) {
    throw new AppError("storyPlan.speechAuditContract is invalid", {
      status: 400,
      code: "video_orchestrate_speech_audit_contract_invalid",
    });
  }
  const visualPreproductionRaw =
    record.visualPreproduction && typeof record.visualPreproduction === "object" && !Array.isArray(record.visualPreproduction)
      ? record.visualPreproduction as Record<string, unknown>
      : null;
  let visualPreproduction: StoryPlan["visualPreproduction"];
  if (visualPreproductionRaw !== null) {
    if (readTrimmedString(visualPreproductionRaw.kind) !== "storyboard") {
      throw new AppError("storyPlan.visualPreproduction.kind must be storyboard", {
        status: 400,
        code: "video_orchestrate_visual_preproduction_invalid",
      });
    }
    const requiredClipIndexes = Array.isArray(visualPreproductionRaw.requiredClipIndexes)
      ? [...new Set(visualPreproductionRaw.requiredClipIndexes.map((value) => Number(value)))].sort((a, b) => a - b)
      : [];
    if (
      requiredClipIndexes.length === 0 ||
      requiredClipIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= clips.length)
    ) {
      throw new AppError("storyPlan.visualPreproduction.requiredClipIndexes must reference actual clips", {
        status: 400,
        code: "video_orchestrate_visual_preproduction_invalid",
      });
    }
    const rawBindings = Array.isArray(visualPreproductionRaw.requiredAssetNodeIdsByClip)
      ? visualPreproductionRaw.requiredAssetNodeIdsByClip
      : [];
    const requiredAssetNodeIdsByClip = rawBindings.map((rawBinding) => {
      const binding = rawBinding && typeof rawBinding === "object" && !Array.isArray(rawBinding)
        ? rawBinding as Record<string, unknown>
        : null;
      const clipIndex = Number(binding?.clipIndex);
      const assetNodeIds = Array.isArray(binding?.assetNodeIds)
        ? [...new Set(binding.assetNodeIds.map(readTrimmedString).filter(Boolean))]
        : [];
      return { clipIndex, assetNodeIds };
    });
    const boundIndexes = new Set(requiredAssetNodeIdsByClip.map((binding) => binding.clipIndex));
    if (
      requiredAssetNodeIdsByClip.length !== requiredClipIndexes.length ||
      requiredAssetNodeIdsByClip.some((binding) =>
        !Number.isInteger(binding.clipIndex) ||
        !requiredClipIndexes.includes(binding.clipIndex) ||
        binding.assetNodeIds.length === 0,
      ) ||
      requiredClipIndexes.some((clipIndex) => !boundIndexes.has(clipIndex))
    ) {
      throw new AppError("storyPlan.visualPreproduction.requiredAssetNodeIdsByClip must declare every storyboard clip's real asset inputs", {
        status: 400,
        code: "video_orchestrate_visual_preproduction_invalid",
      });
    }
    visualPreproduction = { kind: "storyboard", requiredClipIndexes, requiredAssetNodeIdsByClip };
  }
  return {
    runId,
    videoModel,
    ...(generationContract ? { generationContract } : {}),
    ...(finishingContract ? { finishingContract } : {}),
    ...(speechAuditContract ? { speechAuditContract } : {}),
    targetDurationSeconds: Math.trunc(target),
    ...(clipTopology ? { clipTopology } : {}),
    ...(readTrimmedString(record.aspect) ? { aspect: readTrimmedString(record.aspect) } : {}),
    ...(readTrimmedString(record.resolution) ? { resolution: readTrimmedString(record.resolution) } : {}),
    ...(readTrimmedString(record.recipeId)
      ? { recipeId: readTrimmedString(record.recipeId) }
      : {}),
    ...(readEditingStyle(record.editingStyle)
      ? { editingStyle: readEditingStyle(record.editingStyle)! }
      : {}),
    ...(readTrimmedString(record.filmGenre)
      ? { filmGenre: readTrimmedString(record.filmGenre) }
      : {}),
    ...(record.dialogueReviewed === true ? { dialogueReviewed: true } : {}),
    ...(visualPreproduction ? { visualPreproduction } : {}),
    ...(readTrimmedString(record.parentGroupId)
      ? { parentGroupId: readTrimmedString(record.parentGroupId) }
      : {}),
    clips,
  };
}

export function assertFrozenClipTopology(plan: StoryPlan, clipPlan: ReadonlyArray<{ durationSeconds: number }>): void {
  if (!plan.clipTopology) return;
  const actualDurations = clipPlan.map((clip) => clip.durationSeconds);
  const expected = plan.clipTopology;
  if (
    actualDurations.length !== expected.expectedClipCount ||
    actualDurations.some((duration, index) => duration !== expected.durationsSeconds[index])
  ) {
    throw new AppError("realized clip plan diverges from frozen clipTopology", {
      status: 409,
      code: "video_orchestrate_clip_topology_mismatch",
      details: { expectedClipCount: expected.expectedClipCount, expectedDurations: expected.durationsSeconds, actualDurations },
    });
  }
}

/**
 * 节奏决策是否做出 —— 历史诊断判据。**2026-06-22 起缺省 editingStyle = 默认 cut（多镜镜头表·模型
 * 内部切镜），本身即一种节奏决策**，不再有"静默 continuous 拉满（20s 被拉成 15s+5s）"的旧风险，故此判据
 * 对任何语态（含缺省）恒为 true（门禁实质失效、保留兼容）。时尚/MV 仍应显式 montage 快切（由 skill/persona
 * 把关，不再靠本闸）。
 */
export function hasPacingDecision(
  plan: Pick<StoryPlan, "editingStyle" | "clips">,
): boolean {
  // 缺省 editingStyle ⇒ 默认 cut（已是决策）；显式 montage/continuous/cut 同样是决策；
  // 显式逐镜 durationSeconds 也是决策。故任何情况都算已做节奏决策。
  if (
    plan.editingStyle === undefined ||
    plan.editingStyle === "montage" ||
    plan.editingStyle === "continuous" ||
    plan.editingStyle === "cut"
  ) {
    return true;
  }
  return extractExplicitClipDurations(plan.clips) !== undefined;
}

/**
 * 解析本视频节点绑定的「master 大故事板子板」节点 id（故事板=完整叙事·2026-06-26 用户定盘根治）。
 * master 模式下子板必须真正驱动视频；绑定优先级：
 *  ① clipForFrames.storyboardImageNodeId（确定性拆板工具 buildMasterStoryboardSplitNodes 会设）；
 *  ② 入边回溯——连向本视频节点、且 productionLayer=design_board 且带 masterBoardNodeId 的上游节点
 *     （救「小T 手写 flow_patch 绕过拆板工具、漏设 storyboardImageNodeId」的节点，靠 sb→video 血缘边补绑）。
 * 资格收窄防漂：仅「带 masterBoardNodeId 的 design_board」算 master 子板（单镜干净帧）；母板网格 /
 * 旧 shot-placeholder 网格板不带 masterBoardNodeId，不命中，逐字仍走 §submit_video 的硬剔除。
 * 命中返回子板节点 id，否则 ""。
 */
export function resolveMasterSubBoardNodeId(
  row: FlowRow,
  videoNodeId: string,
  explicitStoryboardNodeId: string,
): string {
  // 判定某节点是否「master 大故事板子板」。两路信号（任一即可），兼容确定性工具与手写两种来源：
  //  a) data.masterBoardNodeId 显式回指母板（确定性拆板工具 buildMasterStoryboardSplitNodes 会设）；
  //  b) 有一条来自 productionLayer=master_board 节点的入边（母板→子板派生边）——救手写漏设字段的节点。
  // 排除旧 shot-placeholder/总览设计板：它们既无 masterBoardNodeId 也无 master_board 父。
  const isMasterSubBoard = (nodeId: string): boolean => {
    if (!nodeId) return false;
    const n = findFlowNode(row, nodeId);
    if (!n) return false;
    const d = (n.data ?? {}) as Record<string, unknown>;
    if (readTrimmedString(d.productionLayer) !== "design_board") return false;
    if (readTrimmedString(d.masterBoardNodeId)) return true;
    // 入边回溯：source 节点 productionLayer=master_board ⇒ 本节点是该母板派生的子板。
    for (const e of readFlowEdges(row)) {
      if (readTrimmedString(e.target) !== nodeId) continue;
      const srcNode = findFlowNode(row, readTrimmedString(e.source));
      const srcLayer = readTrimmedString(
        (srcNode?.data as Record<string, unknown> | undefined)?.productionLayer,
      );
      if (srcLayer === "master_board") return true;
    }
    return false;
  };
  // ① 显式绑定优先（确定性拆板工具路径）。
  if (explicitStoryboardNodeId && isMasterSubBoard(explicitStoryboardNodeId)) {
    return explicitStoryboardNodeId;
  }
  // ② 入边回溯：上游 master 子板 → 本视频节点（手写节点兜底）。
  if (videoNodeId) {
    for (const e of readFlowEdges(row)) {
      if (readTrimmedString(e.target) !== videoNodeId) continue;
      const src = readTrimmedString(e.source);
      if (isMasterSubBoard(src)) return src;
    }
  }
  return "";
}

/** 读某节点的图片 URL（storyboardImage / image 节点）。 */
function readNodeImageUrl(row: FlowRow, nodeId: string): string {
  if (!nodeId) return "";
  const node = findFlowNode(row, nodeId);
  if (!node) return "";
  if (isStoryPreviewAssetData(node.data)) return "";
  return (
    readTrimmedString(node.data.imageUrl) || readTrimmedString(node.data.url)
  );
}

/** 收集一个节点上所有可用参考图 URL：节点图 + 角色卡多图（roleCardReferenceImages / roleReferenceEntries）。 */
function readNodeAllRefImageUrls(node: VideoFlowNode): string[] {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = readTrimmedString(v);
    if (s && /^https?:\/\//.test(s)) out.push(s);
  };
  push(d.imageUrl);
  push(d.url);
  if (Array.isArray(d.roleCardReferenceImages)) {
    for (const x of d.roleCardReferenceImages) {
      push(typeof x === "string" ? x : (x as Record<string, unknown>)?.url);
    }
  }
  if (Array.isArray(d.roleReferenceEntries)) {
    for (const x of d.roleReferenceEntries) push((x as Record<string, unknown>)?.url);
  }
  return out;
}

/** 按角色名精确取该角色卡的参考图：匹配 data.roleName/characterName（确定性）；退而求其次用 character 类节点 label 含名字。 */
function resolveCharacterRoleImageUrls(nodes: VideoFlowNode[], roleName: string): string[] {
  const want = roleName.trim();
  if (!want) return [];
  for (const n of nodes) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const rn = readTrimmedString(d.roleName) || readTrimmedString(d.characterName);
    if (rn && rn === want) return readNodeAllRefImageUrls(n);
  }
  for (const n of nodes) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    // 【label 兜底放宽·2026-07-04 ch4 甜甜实测】旧判据强制 referenceType==='character'——
    // 旁路会话建的卡常没这字段（甜甜卡 referenceType=None + 当时 roleName 也缺）→ 双路落空
    // → 该角色全片无脸锚静默出片、每镜换脸。放宽为：referenceType=character 或 label 带
    // 角色卡/角色锚/身份板前缀（场景卡/群像图前缀不同，不会误伤）。
    const isCharacterCard =
      readTrimmedString(d.referenceType).toLowerCase() === "character" ||
      /^(角色卡|角色锚|身份板)\s*[｜|:：·]/.test(readTrimmedString(d.label));
    if (!isCharacterCard) continue;
    if (readTrimmedString(d.label).includes(want)) return readNodeAllRefImageUrls(n);
  }
  console.warn(
    `[clip-ref-bind] 角色「${want}」在画布找不到任何可用角色卡（roleName/characterName/label 三路均落空）——该角色将无脸锚出片，若非路人请先建卡/补 roleName`,
  );
  return [];
}

/**
 * 角色名归一化匹配键：去首尾/内部空白 + 常见中英标点/引号/间隔号/连字符，统一小写。
 * 用于别名/花名/排版差异的松匹配（「岳山」==岳山，岳 山==岳山，Yue Shan==yueshan），避免 roleName
 * 全等匹配漏绑→模型编脸。CJK 不受 toLowerCase 影响。空串返回空串（调用方需自行跳过）。
 */
export function normalizeRoleKey(name: string): string {
  // 繁简折叠（2026-07-14 ch25 弑神枪残体实证）：卡名多为繁体（从繁体书源建卡），镜头文本
  // 为简体——不折叠则按名绑卡全程静默空转（14 镜提枪只 2 镜带卡→刀剑漂移）。
  return foldT2S(
    String(name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s　]+/g, "")
      .replace(/[「」『』“”"'’‘·・.,、，。!！?？:：;；()（）\[\]【】~～\-—_/\\]/g, ""),
  );
}

/**
 * 参考图优先级（值越小越先保留）。多角色卡 + 场景 + 站位 + 跨章兜底叠加会超 seedance 参考图上限，
 * 旧代码无 cap→截断顺序不可控（场景卡可能被挤掉）。封顶时按此优先级让位：
 * 本镜具名出场角色 > 显式场景/道具 ≈ 站位 > 提及到的补绑角色 ≈ 跨章兜底 > 未提及的安全网补绑 > 组兜底。
 */
const REFERENCE_PRIORITY = {
  ONSCREEN_CHARACTER: 0,
  EXPLICIT_SCENE: 1,
  CROSS_CHAPTER_FALLBACK: 2,
  DECLARED_PROP: 2,
  EXPLICIT_REFERENCE: 3,
} as const;

/**
 * 【形态状态前向填充·persistence】LLM 常只在变身/受伤发生的那一镜标 characterStates，忘了给之后的镜头续标
 * → 后续镜头静默回落基态卡（变身后又用回变身前的脸，变身铁律/ch130 换脸类实测痛点）。变身/受伤/换装通常是
 * **持续**状态，故确定性地把某角色最近一次显式声明的非空 stateKey 前向延续到之后镜头。显式把该角色标成回退键
 * （''/base/基态/原态/恢复/复原/变回…）→ 清除延续（支持剧情中变回来）。纯函数、幂等。
 * 返回给定 clipIndex 的「有效 characterStates」= 该镜显式值 ⊕ 前向延续值（显式值优先）。
 */
const CHARACTER_STATE_REVERT_KEYS = new Set([
  "base",
  "基态",
  "原态",
  "原本",
  "本体",
  "恢复",
  "恢复原样",
  "复原",
  "变回",
  "变回原样",
  "解除变身",
]);
export function computeEffectiveCharacterStates(
  clips: Array<Pick<StoryPlanClip, "characterStates" | "temporalContext">> | undefined,
  clipIndex: number,
): Record<string, string> {
  const active = new Map<string, string>();
  const list = clips ?? [];
  const targetStateScope = readTemporalStateScope(list[clipIndex]?.temporalContext);
  for (let i = 0; i <= clipIndex && i < list.length; i += 1) {
    if (readTemporalStateScope(list[i]?.temporalContext) !== targetStateScope) continue;
    const cs = list[i]?.characterStates ?? {};
    for (const [rawName, rawState] of Object.entries(cs)) {
      const name = String(rawName ?? "").trim();
      if (!name) continue;
      const state = String(rawState ?? "").trim();
      if (!state || CHARACTER_STATE_REVERT_KEYS.has(state.toLowerCase())) {
        active.delete(name); // 回退/清除延续
      } else {
        active.set(name, state);
      }
    }
  }
  return Object.fromEntries(active);
}

/**
 * 按 canonical 角色名与目标状态身份精确取卡。指定状态时只接受相同 stateKey + stateVersionId
 * 或 BeatSheet 明确绑定的 anchorNodeId；缺失即返回空，由同一执行链 repair_assets 补齐，禁止退回基态。
 * 未指定状态时只接受无 stateKey/stateVersionId 的基态卡。返回选中卡的 url 列表 + 状态描述，
 * 供 referenceMediaManifest 做事实归因；图片 @图N 只在付费提交边界按最终 manifest 图序渲染，
 * writer 与本解析器都只保留 canonical 资产身份。
 * 角色身份只认 data.roleName/characterName 的 canonical 等价，不再从 label 或名称子串推断。
 */
function resolveCharacterRoleCard(
  nodes: VideoFlowNode[],
  roleName: string,
  target?: {
    stateKey?: string;
    stateVersionId?: string;
    anchorNodeId?: string;
  },
): { urls: string[]; stateDescription?: string } {
  const want = roleName.trim();
  if (!want) return { urls: [] };
  const wantState = String(target?.stateKey ?? "").trim();
  const wantStateVersion = String(target?.stateVersionId ?? "").trim();
  const anchorNodeId = String(target?.anchorNodeId ?? "").trim();
  const wantKey = normalizeRoleKey(want);
  const matches: Array<{
    node: VideoFlowNode;
    stateKey: string;
    stateVersionId: string;
    stateDescription: string;
  }> = [];
  const pushMatch = (n: VideoFlowNode, d: Record<string, unknown>) => {
    const marker = readCanvasCardStateMarker(d);
    matches.push({
      node: n,
      stateKey: marker?.stateKey ?? "",
      stateVersionId: readTrimmedString(d.stateVersionId),
      stateDescription: marker?.stateDescription ?? "",
    });
  };
  // 只允许 canonical 等价的结构化角色字段。
  for (const n of nodes) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const rn = readTrimmedString(d.roleName) || readTrimmedString(d.characterName);
    if (rn && normalizeRoleKey(rn) === wantKey) pushMatch(n, d);
  }
  if (matches.length) {
    const withImages = matches.filter((m) => readNodeAllRefImageUrls(m.node).length > 0);
    const pick = wantState || wantStateVersion || anchorNodeId
      ? withImages.find((candidate) =>
          (!anchorNodeId || candidate.node.id === anchorNodeId) &&
          (!wantState || candidate.stateKey === wantState) &&
          (!wantStateVersion || candidate.stateVersionId === wantStateVersion),
        )
      : withImages.find((candidate) => !candidate.stateKey && !candidate.stateVersionId);
    if (!pick) return { urls: [] };
    return {
      urls: readNodeAllRefImageUrls(pick.node),
      stateDescription: pick.stateDescription || undefined,
    };
  }
  return { urls: [] };
}

/** 参考图条目：URL + 给模型看的角色标签（服务端确定性渲染进 prompt 的「图N=xxx」绑定）。 */
type ClipReferenceImageEntry = {
  url: string;
  label: string;
  sourceNodeId?: string;
  purpose?: VideoReferencePurpose;
};

/**
 * 收集本 flow（=本章节画布）内所有道具卡（classifyCanvasCardForRegistry → kind==='prop'）的参考图条目。
 * 用途：道具「反复引用」——镜头文本提到某道具（山羊头骨面具/座钟/吊灯…）时按名把对应道具卡绑进本镜参考，
 * 与角色卡同构（确定性、不靠 LLM 每次记得列）。ch2 前无道具卡时此函数返回空 = 零行为变化（安全）。纯函数。
 */
export function resolveChapterPropCardEntries(
  nodes: VideoFlowNode[],
): Array<ClipReferenceImageEntry & { name: string }> {
  const out: Array<ClipReferenceImageEntry & { name: string }> = [];
  for (const n of nodes) {
    const cls = classifyCanvasCardForRegistry((n.data ?? {}) as Record<string, unknown>);
    if (cls?.kind !== "prop" || !cls.name) continue;
    for (const u of readNodeAllRefImageUrls(n)) {
      out.push({ url: u, label: `道具卡·${cls.name}`, name: cls.name });
    }
  }
  return out;
}

type RuntimeReferenceIdentity = {
  kind: "character" | "scene" | "ensemble" | "prop" | "pose";
  name: string;
};

const NON_CARD_RUNTIME_LABEL_RE = /^(关键帧|分镜|故事板|设计板|分镜设计板|站位图|俯视底图)/;
const LEGACY_SCENE_LABEL_RE = /^(?:场景卡|场景锚|场景参考)\s*[｜|:：·]\s*(.+)$/;

/**
 * 视频运行时的只读兼容解码器。
 *
 * 素材注册器故意要求 character-card/v3 / scene-card/v1，防止把普通图片误注册进项目资产；
 * 但历史画布中的锚点早于 profileVersion 合同，仍可能只有精确的 roleName / sceneName /
 * referenceType。执行时若连显式 node-id 都拒绝这些旧卡，会直接丢失人物或场景参考。
 *
 * 这里仅消费机器字段与受限的旧场景卡前缀，不扫描 prompt、不做模糊语义匹配，也不改变注册器口径。
 */
function resolveRuntimeReferenceIdentity(
  nodeData: Record<string, unknown> | null | undefined,
): RuntimeReferenceIdentity | null {
  const data = nodeData ?? {};
  const strict = classifyCanvasCardForRegistry(data);
  if (strict) return strict;

  const kind = readTrimmedString(data.kind).toLowerCase();
  if (kind && kind !== "image" && kind !== "imageedit") return null;
  const label = readTrimmedString(data.label) || readTrimmedString(data.title);
  if (NON_CARD_RUNTIME_LABEL_RE.test(label)) return null;

  const referenceType = readTrimmedString(data.referenceType).toLowerCase();
  const productionLayer = readTrimmedString(data.productionLayer).toLowerCase();
  const roleName = readTrimmedString(data.roleName);
  if (
    roleName &&
    (referenceType === "character" || productionLayer === "anchors")
  ) {
    return { kind: "character", name: roleName };
  }

  const sceneName = readTrimmedString(data.sceneName);
  if (sceneName) return { kind: "scene", name: sceneName };
  if (referenceType === "scene") {
    const legacyLabelMatch = label.match(LEGACY_SCENE_LABEL_RE);
    const legacySceneName = legacyLabelMatch?.[1]?.trim() ?? "";
    if (legacySceneName) return { kind: "scene", name: legacySceneName };
  }
  return null;
}

/**
 * 按 BeatSheet 声明的 canonical sceneName 精确解析本章场景卡。
 * 这是符号引用→真实资产 URL 的确定性物化，不从 prompt 关键词猜场景；匹配不到就不造默认场景。
 */
export function resolveChapterSceneCardEntries(
  nodes: VideoFlowNode[],
  sceneName: string,
): Array<ClipReferenceImageEntry & { name: string }> {
  const wantedKey = normalizeRoleKey(sceneName);
  if (!wantedKey) return [];
  const out: Array<ClipReferenceImageEntry & { name: string }> = [];
  for (const n of nodes) {
    const data = (n.data ?? {}) as Record<string, unknown>;
    const identity = resolveRuntimeReferenceIdentity(data);
    const resolvedSceneName = identity?.kind === "scene" ? identity.name : "";
    if (!resolvedSceneName || normalizeRoleKey(resolvedSceneName) !== wantedKey) continue;
    for (const u of readNodeAllRefImageUrls(n)) {
      out.push({ url: u, label: `场景卡·${resolvedSceneName}`, name: resolvedSceneName });
    }
  }
  return out;
}

/**
 * 确定性推导本镜出场角色。只接受结构化声明与显式角色卡节点，不从提示词正文猜人物。
 * 来源：
 *  ① 显式 clip.characterRoleNames；
 *  ② 从本镜显式绑定的角色卡 node-id 回收 roleName。
 */
export function deriveClipCharacterRoleNames(
  row: FlowRow,
  clip: StoryPlanClip | undefined,
): string[] {
  const out: string[] = [];
  const push = (nameRaw: unknown) => {
    const name = String(nameRaw ?? "").trim();
    if (!name) return;
    const key = normalizeRoleKey(name);
    if (!key) return;
    if (!out.some((r) => normalizeRoleKey(r) === key)) out.push(name);
  };
  // ① 显式声明（最高优先，保留原序）
  for (const n of clip?.characterRoleNames ?? []) push(n);
  // ② 从显式绑定的角色卡节点回收 roleName
  for (const id of clip?.videoReferenceNodeIds ?? []) {
    const node = findFlowNode(row, id);
    if (!node) continue;
    const identity = resolveRuntimeReferenceIdentity(
      (node.data ?? {}) as Record<string, unknown>,
    );
    if (identity?.kind === "character" && identity.name) push(identity.name);
  }
  return out;
}

/**
 * 解析本镜的参考图（带标签）：角色按 characterRoleNames 经 roleName 精确取卡（确定性，不靠 label 猜）+
 * 场景/任意图按唯一的 videoReferenceNodeIds 指定，合并去重。禁止退回全章或组内全部图片。
 * 标签随条目返回——服务端组装参考图时本来就知道每张是谁，必须把绑定渲染进 prompt（多图无标签时
 * 模型只能猜哪张是哪个角色/场景，实测漂移）。
 */
export function resolveClipReferenceImageEntries(
  row: FlowRow,
  clip: StoryPlanClip | undefined,
  parentGroupId: string,
  // 可选：角色名→跨章最新卡（chapter_index≤当前）。本章画布缺某出镜角色卡时按此兜底（身份延续）。
  // 由 async orchestrate 预先从项目节点投影按 updatedAt DESC 算好传入。
  latestCharacterCardsByName?: Map<string, ClipReferenceImageEntry[]>,
  // 可选：本镜「有效 characterStates」（经 computeEffectiveCharacterStates 前向填充，含延续来的变身/受伤态）。
  // 缺省=用 clip.characterStates 原值（旧行为，单测零变）。orchestrate 传入前向填充版根治「漏标续镜回落基态脸」。
  effectiveCharacterStates?: Record<string, string>,
  options?: { authority?: "legacy_autobind" | "explicit_only" },
): ClipReferenceImageEntry[] {
  // 带优先级收集，最终按必需合同、优先级稳定排序 + 封顶。
  // 同一 URL 可能先以普通显式引用进入，随后又被 sceneName 精确识别为必需场景卡；
  // 必须升级已有条目，不能让首次登记顺序锁死其优先级。
  const scored: Array<{
    url: string;
    label: string;
    prio: number;
    order: number;
    required: boolean;
  }> = [];
  const scoredIndexByUrl = new Map<string, number>();
  const add = (
    u: string,
    label: string,
    prio: number = REFERENCE_PRIORITY.EXPLICIT_REFERENCE,
    required = false,
  ) => {
    if (!u || !/^https?:\/\//.test(u)) return;
    const existingIndex = scoredIndexByUrl.get(u);
    if (existingIndex !== undefined) {
      const existing = scored[existingIndex];
      if (!existing) return;
      if (required || prio < existing.prio) {
        scored[existingIndex] = {
          ...existing,
          label: required ? label : existing.label,
          prio: Math.min(existing.prio, prio),
          required: existing.required || required,
        };
      }
      return;
    }
    scoredIndexByUrl.set(u, scored.length);
    scored.push({ url: u, label, prio, order: scored.length, required });
  };
  const finalize = (): ClipReferenceImageEntry[] => {
    const sorted = [...scored].sort(
      (a, b) => Number(b.required) - Number(a.required) || a.prio - b.prio || a.order - b.order,
    );
    return sorted.map(({ url, label }) => ({ url, label }));
  };
  const states = effectiveCharacterStates ?? clip?.characterStates ?? {};
  // 道具只按 BeatSheet 的 canonical propNames 精确绑定；禁止扫描 prompt 猜道具。
  const addChapterPropCards = (nodes: VideoFlowNode[]) => {
    const declaredKeys = new Set(
      (clip?.propNames ?? []).map((n) => normalizeRoleKey(n)).filter(Boolean),
    );
    for (const e of resolveChapterPropCardEntries(nodes)) {
      const nameKey = normalizeRoleKey(e.name);
      if (declaredKeys.has(nameKey)) {
        add(e.url, e.label, REFERENCE_PRIORITY.DECLARED_PROP);
      }
    }
  };
  const addDeclaredSceneCard = (nodes: VideoFlowNode[]) => {
    const explicitSceneNodeId = readTrimmedString(clip?.sceneCardNodeId);
    if (explicitSceneNodeId) {
      const node = findFlowNode(row, explicitSceneNodeId);
      if (node) {
        const data = (node.data ?? {}) as Record<string, unknown>;
        const identity = resolveRuntimeReferenceIdentity(data);
        const resolvedSceneName = identity?.kind === "scene" ? identity.name : "";
        if (resolvedSceneName) {
          for (const u of readNodeAllRefImageUrls(node)) {
            add(u, `场景卡·${resolvedSceneName}`, REFERENCE_PRIORITY.EXPLICIT_SCENE, true);
          }
        }
      }
    }
    const sceneName = readTrimmedString(clip?.sceneName);
    if (!sceneName) return;
    for (const entry of resolveChapterSceneCardEntries(nodes, sceneName)) {
      add(entry.url, entry.label, REFERENCE_PRIORITY.EXPLICIT_SCENE, true);
    }
  };
  // 只用结构化声明和显式节点 ID 解析当前 clip 的资产。
  const explicitOnly = options?.authority === "explicit_only";
  const roleNames = explicitOnly ? [] : deriveClipCharacterRoleNames(row, clip);
  const ids = clip?.videoReferenceNodeIds ?? [];
  if (roleNames.length || ids.length || (!explicitOnly && (clip?.sceneName || clip?.sceneCardNodeId || clip?.propNames?.length))) {
    const nodes = readFlowNodes(row);
    for (const name of roleNames) {
      const anchorRequirement = (clip?.visualStateAnchorRequirements ?? []).find(
        (requirement) => normalizeRoleKey(requirement.characterName) === normalizeRoleKey(name),
      );
      const wantState = anchorRequirement?.stateKey ?? states[name] ?? states[name.trim()] ?? "";
      const card = resolveCharacterRoleCard(nodes, name, {
        ...(wantState ? { stateKey: wantState } : {}),
        ...(anchorRequirement?.stateVersionId
          ? { stateVersionId: anchorRequirement.stateVersionId }
          : {}),
        ...(anchorRequirement?.anchorNodeId
          ? { anchorNodeId: anchorRequirement.anchorNodeId }
          : {}),
      });
      const urls = card.urls;
      const stateSuffix = card.stateDescription ? `（${card.stateDescription}）` : "";
      if (urls.length) {
        urls.forEach((u, i) =>
          add(
            u,
            urls.length > 1
              ? `角色卡·${name}${stateSuffix}·视图${i + 1}`
              : `角色卡·${name}${stateSuffix}`,
            REFERENCE_PRIORITY.ONSCREEN_CHARACTER,
          ),
        );
      } else if (!wantState && !anchorRequirement && latestCharacterCardsByName) {
        // 本章画布无该角色卡 → 按章节复用策略取 chapter_index≤当前的最新一张（跨章身份延续，就近原则）。
        for (const e of latestCharacterCardsByName.get(name.trim()) ?? [])
          add(e.url, e.label, REFERENCE_PRIORITY.CROSS_CHAPTER_FALLBACK);
      }
    }
    for (const id of ids) {
      const node = findFlowNode(row, id);
      if (!node) continue;
      const nodeData = (node?.data ?? {}) as Record<string, unknown>;
      const nodeLabel = readTrimmedString(nodeData.label);
      // 分类显式引用的节点身份（角色卡/场景卡/道具卡/群像图），渲染成确定性语义标签
      // 「场景卡·<名>」——之前一律标「场景/参考图」，模型分不清哪张是场景哪张是道具，
      // 且可观测性摘要无从归类。道具卡从此也能沿此路进 seedance 参考（根治道具飘）。
      const identity = resolveRuntimeReferenceIdentity(nodeData);
      const label = identity
        ? `${ASSET_KIND_LABEL[identity.kind] ?? "参考图"}·${identity.name}`
        : nodeLabel || "场景/参考图";
      for (const url of readNodeAllRefImageUrls(node)) {
        add(url, label, REFERENCE_PRIORITY.EXPLICIT_REFERENCE);
      }
    }
    if (!explicitOnly) {
      addDeclaredSceneCard(nodes);
      addChapterPropCards(nodes);
    }
    if (scored.length) return finalize();
  }
  return finalize();
}

/**
 * 【章节复用策略·orchestrate 兜底】构建「角色名 → 跨章最新卡参考图」映射：
 * 取项目节点投影（updatedAt DESC），每个角色默认使用最近更新的真实图片；
 * 供 resolveClipReferenceImageEntries 在本章画布缺该角色卡时兜底绑定（身份延续）。
 */
export async function buildLatestCharacterCardsByName(input: {
  c: AppContext;
  row: FlowRow;
  chapterId: string;
}): Promise<Map<string, ClipReferenceImageEntry[]>> {
  const empty = new Map<string, ClipReferenceImageEntry[]>();
  const ownerId = readTrimmedString(input.row.owner_id);
  const projectId = readTrimmedString(input.row.project_id);
  if (!ownerId || !projectId) return empty;
  const assets = await listProjectNodeAssetsForOwner(input.c, ownerId, {
    projectId,
    kind: "character",
  }).catch(() => [] as Awaited<ReturnType<typeof listProjectNodeAssetsForOwner>>);
  const map = new Map<string, ClipReferenceImageEntry[]>();
  for (const a of assets) {
    const name = String(a.name || "").trim();
    if (!name || map.has(name)) continue;
    const data = (a.latestVersion?.data ?? null) as Record<string, unknown> | null;
    const url =
      (typeof data?.imageUrl === "string" ? data.imageUrl.trim() : "") ||
      (typeof data?.threeViewImageUrl === "string" ? data.threeViewImageUrl.trim() : "");
    if (!url || !/^https?:\/\//.test(url)) continue;
    map.set(name, [{ url, label: `角色卡·${name}` }]);
  }
  return map;
}

/**
 * 纯函数：给定本镜「故事板首帧 url / 目标尾帧 url」候选 + 旧逻辑算出的 baseFirstFrame（reAnchor=母版卡 /
 * 否则=上一镜尾帧），决定最终 firstFrame/lastFrame 及绑定说明文案。
 * - storyboardFirstFrameUrl 非空 → **覆盖** baseFirstFrame 作首帧（构图/朝向/特效起势已钉）。
 * - storyboardFirstFrameUrl 为空 → 用 baseFirstFrame（逐字等价于无 board 时的旧行为）。
 * - targetLastFrameUrl 非空 → 设 lastFrame（特效终态/朝向已钉）；为空则不设。
 * 把决策抽成纯函数便于单测；DB→url 的解析仍由调用方用 readNodeImageUrl 完成。
 */
export function resolveClipFrameOverride(input: {
  storyboardFirstFrameUrl: string;
  targetLastFrameUrl: string;
  baseFirstFrame: string;
  reAnchor: boolean;
}): {
  firstFrameUrl: string;
  lastFrameUrl: string;
  usedStoryboardFirstFrame: boolean;
  usedTargetLastFrame: boolean;
  firstFrameNote: string;
} {
  const usedStoryboardFirstFrame = Boolean(input.storyboardFirstFrameUrl);
  const usedTargetLastFrame = Boolean(input.targetLastFrameUrl);
  const firstFrameUrl = usedStoryboardFirstFrame
    ? input.storyboardFirstFrameUrl
    : input.baseFirstFrame;
  const baseNote = firstFrameUrl
    ? usedStoryboardFirstFrame
      ? "首帧=本镜故事板关键帧（构图/朝向/特效起势已钉）"
      : input.reAnchor
        ? "首帧=母版参考图（锚定主体/光线/风格）"
        : "首帧=上一镜尾帧（动作从该姿态连贯续接）"
    : "";
  const tailNote = usedTargetLastFrame
    ? "尾帧=本镜目标关键帧（特效终态/朝向已钉）"
    : "";
  const firstFrameNote = [baseNote, tailNote].filter(Boolean).join("；");
  return {
    firstFrameUrl,
    lastFrameUrl: usedTargetLastFrame ? input.targetLastFrameUrl : "",
    usedStoryboardFirstFrame,
    usedTargetLastFrame,
    firstFrameNote,
  };
}

/** 纯函数：只有结构校验闭合后的桥接头/尾，才能升级成视频模型的字面首尾帧。 */
export function selectContinuityFrameUrls(input: {
  bridgeRole: BridgeFrameRole;
  storyboardImageUrl: string;
  lastFrameImageUrl: string;
}): { storyboardFirstFrameUrl: string; targetLastFrameUrl: string } {
  return {
    storyboardFirstFrameUrl: input.bridgeRole.isBridgeHead
      ? input.storyboardImageUrl
      : "",
    targetLastFrameUrl: input.bridgeRole.isBridgeTail
      ? input.lastFrameImageUrl
      : "",
  };
}

/** 逐镜「音频绑定」条目：出场说话角色 → 其配音卡音色（与参考图 @图N 对称）。 */
export type ClipVoiceBinding = {
  character: string;
  voiceId: string;
  voiceLabel: string;
  nodeId: string;
  audioUrl: string;
  audioDurationSec: number | null;
};

export function collectClipDialogueSpeakerNames(
  clip: StoryPlanClip | undefined,
): string[] {
  const speech = readStructuredSpeechEvents(clip);
  if (speech.issues.length) {
    throw new AppError(
      speech.issues.map((issue) => `${issue.path}:${issue.problem}`).join("；"),
      {
        status: 422,
        code: "speaker_contract_invalid",
        terminal: true,
        details: { issues: speech.issues },
      },
    );
  }
  const speakerNames: string[] = [];
  for (const event of speech.speechEvents) {
    if (!speakerNames.includes(event.speakerName)) speakerNames.push(event.speakerName);
  }
  return speakerNames;
}

/**
 * 【音频绑定·按台词说话人（2026-07-17 ch1 复盘根治）】音色参考只服务念白——谁开口给谁绑。
 * 旧按出场 cast（deriveClipCharacterRoleNames）绑：承接段/logline 被提及的无台词角色占走绑定位，
 * 真正开口的画外说话人（如「围观群众」·自愈配音卡存在）反而不在 cast → 音色映射查不到 → 音色参考
 * 全落空回落纯文字绑定还绑错人（ch1 clip1 实证：绑了无台词的阿诺/乙，漏了唯一说话的围观群众）。
 * 现只从完整 speechEvents[].speakerName 读取说话人，并以 speakerBindings.name 作为结构外键；禁止解析
 * clipPrompt/dialogue 正文猜角色。每个 speaker 必须精确命中唯一 voiceId；同名重复登记若 voiceId
 * 相同则是同一音色资产的等价副本，按 nodeId 确定性归并；命中多个不同 voiceId 才算歧义并显式失败。
 * 缺失或真实音色冲突都绝不回落旁白音色或模糊包含匹配。
 */
export function buildClipVoiceBindings(
  row: FlowRow,
  clip: StoryPlanClip | undefined,
): ClipVoiceBinding[] {
  const contract = readClipSpeakerBindings(clip);
  if (contract.issues.length) {
    throw new AppError(
      contract.issues.map((issue) => `${issue.path}:${issue.problem}`).join("；"),
      {
        status: 422,
        code: "speaker_contract_invalid",
        terminal: true,
        details: { issues: contract.issues },
      },
    );
  }
  const speakerNames = collectClipDialogueSpeakerNames(clip);
  if (!speakerNames.length) return [];
  if (speakerNames.length > MAX_CLIP_REFERENCE_AUDIOS) {
    throw new AppError(
      `单 clip 有 ${speakerNames.length} 个说话人，模型最多接受 ${MAX_CLIP_REFERENCE_AUDIOS} 条音色参考；` +
        "必须由 agents 按对白、剧情和动作边界拆成多个顺序 clip",
      {
        status: 422,
        code: SPEAKER_REFERENCE_AUDIO_LIMIT_EXCEEDED,
        terminal: true,
        details: {
          speakerNames,
          speakerCount: speakerNames.length,
          maxSpeakerCount: MAX_CLIP_REFERENCE_AUDIOS,
          requiredAction: "agents_split_clip",
        },
      },
    );
  }
  const nodes = readFlowNodes(row);
  type CardHit = {
    canonicalName: string;
    voiceId: string;
    voiceLabel: string;
    nodeId: string;
    audioUrl: string;
    audioDurationSec: number | null;
  };
  const cards: CardHit[] = [];
  for (const n of nodes) {
    const card = readVoiceCardProfile(n as never);
    if (!card || !card.character) continue;
    const canonicalName = card.character.trim();
    if (!canonicalName) continue;
    cards.push({
      canonicalName,
      voiceId: card.voiceId,
      voiceLabel:
        readTrimmedString((n.data as Record<string, unknown>)?.voiceLabel) ||
        card.voiceId,
      nodeId: card.nodeId,
      audioUrl: card.audioUrl,
      audioDurationSec: card.audioDurationSec,
    });
  }
  const out: ClipVoiceBinding[] = [];
  const seen = new Set<string>();
  for (const name of speakerNames) {
    if (seen.has(name)) continue;
    const hits = cards.filter(
      (card) => card.canonicalName === name && Boolean(card.voiceId),
    );
    const distinctVoiceIds = new Set(hits.map((hit) => hit.voiceId));
    if (distinctVoiceIds.size !== 1) {
      const missing = distinctVoiceIds.size === 0;
      throw new AppError(
        missing
          ? `说话人「${name}」没有精确同名且带 doubaoVoiceId 的配音卡`
          : `说话人「${name}」命中 ${distinctVoiceIds.size} 个不同 voiceId`,
        {
          status: 422,
          code: missing ? "speaker_voice_binding_missing" : "speaker_voice_binding_ambiguous",
          terminal: true,
          details: { speakerName: name, distinctVoiceIds: [...distinctVoiceIds] },
        },
      );
    }
    const hit = hits.slice().sort((left, right) => left.nodeId.localeCompare(right.nodeId))[0]!;
    out.push({
      character: name,
      voiceId: hit.voiceId,
      voiceLabel: hit.voiceLabel,
      nodeId: hit.nodeId,
      audioUrl: hit.audioUrl,
      audioDurationSec: hit.audioDurationSec,
    });
    seen.add(name);
  }
  return out;
}

/**
 * 供应商提交前的配音卡验真边界。声音语义选择与资产物化必须已经由上游 Agent/VoiceManifest
 * 完成；这里仅按当前画布严格绑定并原地报告缺失/歧义，禁止服务端按人名自动选音或补卡。
 */
export async function ensureClipVoiceBindings(input: {
  row: FlowRow;
  clip: StoryPlanClip | undefined;
}): Promise<{ row: FlowRow; bindings: ClipVoiceBinding[] }> {
  return { row: input.row, bindings: buildClipVoiceBindings(input.row, input.clip) };
}

/** 收集组内产品/角色等图片节点 URL（自动补进 referenceImages，产品身份永不丢）。 */
function readGroupReferenceImageUrls(row: FlowRow, parentGroupId: string): string[] {
  if (!parentGroupId) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of readFlowNodes(row)) {
    const pid =
      readTrimmedString((n as Record<string, unknown>).parentId) ||
      readTrimmedString((n.data as Record<string, unknown>).parentId);
    if (pid !== parentGroupId) continue;
    const u =
      readTrimmedString(n.data.imageUrl) || readTrimmedString(n.data.url);
    if (u && /^https?:\/\//.test(u) && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/**
 * 找本片的「分镜设计板」URL（generate-shot-placeholders 产出：productionLayer=design_board kind=image，
 * 一张图含整套 cut）。治"走单帧"结构根：有整套设计板时，逐 clip 关键帧从设计板对应 cut 派生（image_edit
 * 锁画风/构图/主体）→「先有板再有片」，而不是 orchestrator 每镜脑补孤立单帧。
 * 有组 → 只认组内设计板（不抓别组的板）；无组 → 取 flow 内第一个设计板。都没有 → "" 回退逐镜生成。
 */
export function resolveDesignBoardImageUrl(row: FlowRow, parentGroupId: string): string {
  let groupMatch = "";
  let flowWide = "";
  for (const n of readFlowNodes(row)) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    if (readTrimmedString(d.productionLayer) !== "design_board") continue;
    const url = readTrimmedString(d.imageUrl) || readTrimmedString(d.url);
    if (!/^https?:\/\//.test(url)) continue;
    const pid =
      readTrimmedString((n as Record<string, unknown>).parentId) ||
      readTrimmedString(d.parentId);
    if (parentGroupId && pid === parentGroupId) {
      groupMatch = url;
      break;
    }
    if (!flowWide) flowWide = url;
  }
  return groupMatch || (parentGroupId ? "" : flowWide);
}

/**
 * master 大故事板子板「剧情参考」驱动开关（2026-06-26 用户拍板「故事板=完整叙事·线稿剧情参考」根治）。**默认 ON**。
 * 治：叙事 cut 默认下旧闸 allowBoardFrames=continuous 无视子板绑定 + 设计板硬剔除 → 6-26「子板驱动视频」
 * 成死代码、视频退化 text_to_video+角色卡、子板图零参与。开启后：master 子板（带 masterBoardNodeId 或母板派生
 * 入边的 design_board；新管线＝母板线稿按行裁切的该段分镜线稿条）作 referenceImages「剧情参考」喂视频，
 * 角色/场景卡仍锁身份上色。关（0/false/off）即逐字回退 2026-06-22「叙事 cut 不用板帧」旧行为。
 */
export function isMasterSubBoardReferenceEnabled(env: unknown): boolean {
  const raw = String(
    (env as Record<string, unknown>)?.VIDEO_MASTER_SUBBOARD_REF ??
      globalThis.process?.env?.VIDEO_MASTER_SUBBOARD_REF ??
      "1",
  )
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

// 将 TOS 公网 URL 转成短期 presigned S3 URL，让 ARK 的 CreateAsset
// 通过 TOS 数据面下载。签名失败时保留原 URL，并由上游明确返回下载错误。
// 仅在 seedance 模型启用 ARK 审核时有意义，但对其他模型无害。
// 返回 presigned→original 的反查表：ARK 审核用的是 presigned URL，被拒时上游回传的也是
// presigned URL；要标红对应画布图片节点，须先把 presigned 还原回原始（= 节点 imageUrl）URL。
async function presignVideoFrameUrlsForArk(
  videoData: Record<string, unknown>,
  env: unknown,
): Promise<Map<string, string>> {
  const presignedToOriginal = new Map<string, string>();
  const config = resolveObjectStorageConfig(env as never);
  if (!config || !config.publicBase) return presignedToOriginal;
  const base = config.publicBase.replace(/\/+$/, "");
  const client = createObjectStorageClientFromConfig(config);
  const tryPresign = async (url: string): Promise<string> => {
    // 【过期签名重签·2026-07-12 ch18 重制实证】节点数据里可能存着上次提交回显的 presigned URL
    //（重制/续跑复用旧节点即命中）——签名几小时前就过期，ARK CreateAsset 拉取 400 DownloadFail。
    const key = extractObjectStorageObjectKey(config, url) || "";
    if (!key) return url;
    try {
      const signed = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { expiresIn: 3600 },
      );
      if (signed && signed !== url) presignedToOriginal.set(signed, url);
      return signed;
    } catch {
      return url;
    }
  };
  const rewrittenByOriginalUrl = new Map<string, Promise<string>>();
  const rewriteOnce = (url: string): Promise<string> => {
    const existing = rewrittenByOriginalUrl.get(url);
    if (existing) return existing;
    const pending = tryPresign(url);
    rewrittenByOriginalUrl.set(url, pending);
    return pending;
  };
  if (typeof videoData.firstFrameUrl === "string" && videoData.firstFrameUrl) {
    videoData.firstFrameUrl = await rewriteOnce(videoData.firstFrameUrl);
  }
  if (typeof videoData.lastFrameUrl === "string" && videoData.lastFrameUrl) {
    videoData.lastFrameUrl = await rewriteOnce(videoData.lastFrameUrl);
  }
  if (Array.isArray(videoData.referenceImages)) {
    const originalReferenceImages = videoData.referenceImages as string[];
    const signedReferenceImages = await Promise.all(
      originalReferenceImages.map(rewriteOnce),
    );
    videoData.referenceImages = signedReferenceImages;
    if (Array.isArray(videoData.referenceImageBindings)) {
      const signedUrlByOriginal = new Map(
        await Promise.all(
          [...rewrittenByOriginalUrl.keys()].map(async (originalUrl) => [
            originalUrl,
            await rewriteOnce(originalUrl),
          ] as const),
        ),
      );
      videoData.referenceImageBindings = videoData.referenceImageBindings.map((binding) => {
        if (!binding || typeof binding !== "object" || Array.isArray(binding)) return binding;
        const record = binding as Record<string, unknown>;
        const originalUrl = readTrimmedString(record.url);
        const url = signedUrlByOriginal.get(originalUrl);
        return url ? { ...record, url } : binding;
      });
    }
  }
  return presignedToOriginal;
}

// 把被拒的 presigned URL 还原成原始 URL，再扫全部画布节点，定位 imageUrl 命中的图片节点 id。
function collectArkModerationRejectedNodeIds(
  row: FlowRow,
  err: unknown,
  presignMap: Map<string, string>,
): string[] {
  const rejected = readVideoSubmitRejectedUrls(err);
  if (!rejected.length) return [];
  const originals = new Set(rejected.map((u) => presignMap.get(u) ?? u));
  const ids: string[] = [];
  for (const n of readFlowNodes(row)) {
    const id = readTrimmedString((n as Record<string, unknown>).id);
    if (!id) continue;
    const u = readNodeImageUrl(row, id);
    if (u && originals.has(u)) ids.push(id);
  }
  return ids;
}

// 【视频节点语义化命名（2026-06-30 用户：角色/场景卡有语义，视频也要）】给每条 clip 的视频节点起
// 「镜N·<beat>」名，而非千篇一律 "Generated Video"。beat 优先用小T 显式给的 clip.title/label/beat；
// 否则从 clipPrompt 抽 logline/首行剥前缀；都没有就退到「镜N/总数」。纯函数、确定性。
function clampClipLabel(s: string): string {
  const t = readTrimmedString(s).replace(/[\r\n]+/g, " ").trim();
  return t.length > 16 ? `${t.slice(0, 16)}…` : t;
}
function extractClipBeatSnippet(clipPrompt: string): string {
  const text = readTrimmedString(clipPrompt);
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  // ① 优先 logline——兼容自由文本「logline：…」与结构化渲染的「【logline】…」括号形式。
  for (const line of lines) {
    const m = line.match(/^\s*【?\s*logline\s*】?\s*[：:]?\s*(.+)$/i);
    if (m && readTrimmedString(m[1])) return clampClipLabel(m[1]);
  }
  // ② 退一步取首个有效行剥前缀。渲染后 clipPrompt 全是「【导演基调】/【镜头表】…」等圣经段——
  // 这些是 filmBible 全片不变文案（非本镜剧情），绝不能当 beat（否则 label 被「【导演基调】…」污染，
  // 2026-07-08 duel-shuang-guiqi-v1 实测）。故跳过所有【…】段，只认无括号的旧自由文本首行。
  for (const raw of lines) {
    const line = readTrimmedString(raw);
    if (!line || /^【/.test(line)) continue;
    const cleaned = line
      .replace(/^[#*\->\s]+/, "")
      .replace(/^\[[\d.]+-[\d.]+s\]\s*/i, "") // 剥镜头表行首的 [起-止s] 时间轴前缀
      .replace(/^(导演基调|段\s*\d+|镜\s*\d+|clip\s*\d+|logline)[：:、.\s]*/i, "")
      .trim();
    return clampClipLabel(cleaned || line);
  }
  return "";
}
export function buildClipNodeLabel(clip: unknown, clipIndex: number, total: number): string {
  const n = clipIndex + 1;
  const c = (clip ?? {}) as Record<string, unknown>;
  // title/label/beat 都可能被 replaceAtIndex 丢弃（只留结构化 logline 字段）——logline 兜底，
  // 好过落到渲染后 clipPrompt 首行撞上「【导演基调】…」。
  const explicit =
    readTrimmedString(c.title) ||
    readTrimmedString(c.label) ||
    readTrimmedString(c.beat) ||
    readTrimmedString(c.logline);
  const beat = explicit ? clampClipLabel(explicit) : extractClipBeatSnippet(readTrimmedString(c.clipPrompt));
  return beat ? `镜${n}·${beat}` : `镜${n}/${total}`;
}

const VIDEO_FINISHING_SUBMISSION_ARTIFACT_KEY = "finishing:submission";

type VideoFinishingDriveResult =
  | { state: "running"; action: "submit" | "reconcile" | "verify"; sourceVideoUrl: string }
  | {
      state: "success";
      action: "noop";
      sourceVideoUrl: string;
      masterVideoUrl: string;
      verification: VideoFinishingTechnicalVerification;
    }
  | { state: "failed"; action: "noop"; sourceVideoUrl: string; error: string };

function parseArtifactPayload(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function collectVideoFinishingClipInputs(input: {
  plan: StoryPlan;
  nodes: VideoFlowNode[];
}): VideoFinishingClipInput[] {
  const durations = input.plan.clipTopology?.durationsSeconds ??
    input.plan.clips.map((clip) => Number(clip.durationSeconds));
  if (
    durations.length !== input.plan.clips.length ||
    durations.some((duration) => !Number.isFinite(duration) || duration <= 0)
  ) {
    throw new AppError("商业后期缺少逐镜冻结时长", {
      status: 409,
      code: "video_finishing_clip_timing_missing",
    });
  }
  return input.plan.clips.map((clip, clipIndex) => {
    const runtime = resolveClipVideoRuntime(
      input.nodes,
      "",
      input.plan.runId,
      clipIndex,
    );
    if (runtime.status !== "success" || !runtime.videoUrl) {
      throw new AppError(`商业后期缺少 clip ${clipIndex} 的真实视频资产`, {
        status: 409,
        code: "video_finishing_clip_media_missing",
      });
    }
    return {
      clipIndex,
      expectedDurationSeconds: durations[clipIndex]!,
      videoUrl: runtime.videoUrl,
      // Dialogue is an authored intention, not proof that the selected video
      // model can deliver an audio stream.  Native/reference audio is a
      // best-effort enhancement earlier in the pipeline; finishing preserves
      // it when present but must not reject an otherwise valid visual film.
      // A future explicit user-level "audio is mandatory" contract may set
      // this to true, but dialogue text alone is deliberately not that gate.
      requiresAudio: false,
    };
  });
}

async function persistFinishingRunningNode(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  chapterId: string;
  row: FlowRow;
  plan: StoryPlan;
  sourceNodeId: string;
  sourceVideoUrl: string;
  taskId: string;
  vendor: string;
}): Promise<void> {
  const contract = input.plan.finishingContract;
  if (!contract) throw new Error("video_finishing_contract_missing");
  const masterNodeId = `film-master-${input.plan.runId}`;
  const existing = findFlowNode(input.row, masterNodeId);
  const data = {
    kind: "video",
    label: `商业母版 ${contract.resolution}`,
    status: "running",
    clipRunId: input.plan.runId,
    finishingMaster: true,
    sourceFilmNodeId: input.sourceNodeId,
    sourceVideoUrl: input.sourceVideoUrl,
    taskId: input.taskId,
    videoTaskId: input.taskId,
    videoTaskKind: "video_enhance",
    videoModel: contract.modelKey,
    billingSpecKey: contract.billingSpecKey,
    toolVersion: contract.toolVersion,
    finishingScene: contract.scene,
    resolution: contract.resolution,
    ...(typeof contract.fps === "number" ? { fps: contract.fps } : {}),
    vendor: input.vendor,
    videoModelVendor: input.vendor,
  };
  const edgeId = `edge-${input.sourceNodeId}-${masterNodeId}`;
  const edgeExists = readFlowEdges(input.row).some((edge) => readTrimmedString(edge.id) === edgeId);
  await persistFlowPatch({
    c: input.c,
    row: input.row,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    affectedNodeIds: [masterNodeId, input.sourceNodeId],
    patch: {
      ...(existing
        ? { patchNodeData: [{ id: masterNodeId, data }], allowOverwrite: true }
        : {
            createNodes: [{
              id: masterNodeId,
              type: "taskNode",
              position: { x: 0, y: 0 },
              ...(input.plan.parentGroupId ? { parentId: input.plan.parentGroupId } : {}),
              data,
            }],
          }),
      ...(!edgeExists
        ? { createEdges: [{ id: edgeId, source: input.sourceNodeId, target: masterNodeId }] }
        : {}),
    } as never,
  });
}

async function driveVideoFinishing(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  chapterId: string;
  plan: StoryPlan;
}): Promise<VideoFinishingDriveResult> {
  const contract = input.plan.finishingContract;
  if (!contract) throw new Error("video_finishing_contract_missing");
  const row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const nodes = readFlowNodes(row);
  const finishingClips = collectVideoFinishingClipInputs({ plan: input.plan, nodes });
  const sourceResolution = readTrimmedString(input.plan.resolution);
  if (!sourceResolution) {
    throw new AppError("商业后期缺少冻结的源片分辨率", {
      status: 409,
      code: "video_finishing_source_resolution_missing",
    });
  }
  const sourceNode = nodes.find((node) => node.id === `film-${input.plan.runId}`) ??
    nodes.find((node) => {
      const data = node.data ?? {};
      const kind = readTrimmedString(data.kind).toLowerCase();
      return (kind === "composevideo" || kind === "videocompose") &&
        readTrimmedString(data.clipRunId) === input.plan.runId &&
        Boolean(readDurableNodeVideoUrl(node));
    });
  const sourceNodeId = sourceNode?.id ?? "";
  const sourceVideoUrl = sourceNode ? readDurableNodeVideoUrl(sourceNode) : "";
  if (!sourceNode || !sourceVideoUrl) {
    throw new AppError("商业后期缺少已持久化的拼接源片", {
      status: 409,
      code: "video_finishing_source_missing",
    });
  }
  const masterNodeId = `film-master-${input.plan.runId}`;
  const masterNode = nodes.find((node) => node.id === masterNodeId);
  const masterData = masterNode?.data ?? {};
  const masterStatus = readTrimmedString(masterData.status).toLowerCase();
  const masterVideoUrl = masterNode ? readDurableNodeVideoUrl(masterNode) : "";
  if (masterStatus === "success" && masterVideoUrl) {
    const existingVerification = parseVideoFinishingTechnicalVerification(
      masterData.finishingVerification,
    );
    if (existingVerification && videoFinishingVerificationMatchesMedia({
      verification: existingVerification,
      contract,
      expectedSourceDurationSeconds: input.plan.targetDurationSeconds,
      sourceResolution,
      sourceVideoUrl,
      masterVideoUrl,
      clips: finishingClips,
    })) {
      return {
        state: "success",
        action: "noop",
        sourceVideoUrl,
        masterVideoUrl,
        verification: existingVerification,
      };
    }
    const inspected = await inspectVideoFinishingOutput({
      contract,
      expectedSourceDurationSeconds: input.plan.targetDurationSeconds,
      sourceResolution,
      sourceVideoUrl,
      masterVideoUrl,
      clips: finishingClips,
      verifiedAt: new Date().toISOString(),
    });
    if (inspected.state === "pending") {
      console.warn("[video-finishing-verification] media probe unavailable", {
        runId: input.plan.runId,
        reason: inspected.reason,
      });
      return { state: "running", action: "verify", sourceVideoUrl };
    }
    await persistFlowPatch({
      c: input.c,
      row,
      flowId: input.flowId,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      affectedNodeIds: [masterNodeId],
      patch: {
        patchNodeData: [{
          id: masterNodeId,
          data: { finishingVerification: inspected.verification },
        }],
        allowOverwrite: true,
      } as never,
    });
    return {
      state: "success",
      action: "noop",
      sourceVideoUrl,
      masterVideoUrl,
      verification: inspected.verification,
    };
  }
  if (masterStatus === "failed" || masterStatus === "error") {
    return {
      state: "failed",
      action: "noop",
      sourceVideoUrl,
      error: readTrimmedString(masterData.errorMessage) || "video_finishing_provider_failed",
    };
  }
  if ((masterStatus === "running" || masterStatus === "queued") && readTrimmedString(masterData.taskId)) {
    await reconcileVideoNodesForFlow({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      row,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    });
    return { state: "running", action: "reconcile", sourceVideoUrl };
  }

  const artifacts = await listAuthoringArtifacts(input.plan.runId);
  const existingIntent = artifacts.find(
    (artifact) => artifact.artifact_key === VIDEO_FINISHING_SUBMISSION_ARTIFACT_KEY,
  );
  if (existingIntent?.status === "ready") {
    const payload = parseArtifactPayload(existingIntent.payload);
    const taskId = readTrimmedString(payload.taskId);
    if (!taskId) {
      throw new AppError("后期任务已受理但缺少可恢复 taskId", {
        status: 409,
        code: "video_finishing_submission_identity_uncertain",
      });
    }
    await persistFinishingRunningNode({
      ...input,
      row,
      sourceNodeId,
      sourceVideoUrl,
      taskId,
      vendor: readTrimmedString(payload.vendor) || "newapi",
    });
    return { state: "running", action: "reconcile", sourceVideoUrl };
  }
  if (existingIntent && existingIntent.status !== "stale") {
    throw new AppError("后期供应商提交身份不确定，已阻止重复付费提交", {
      status: 409,
      code: "video_finishing_submission_identity_uncertain",
    });
  }

  const previousIntentPayload = existingIntent
    ? parseArtifactPayload(existingIntent.payload)
    : {};
  const previousAttempt = Number(previousIntentPayload.attempt);
  const attempt = Number.isInteger(previousAttempt) && previousAttempt >= 0
    ? previousAttempt + 1
    : 1;
  if (attempt > 3) {
    return {
      state: "failed",
      action: "noop",
      sourceVideoUrl,
      error: "video_finishing_pre_upstream_retry_budget_exhausted",
    };
  }

  // 后期付费提交前先验证源片仍等于冻结 BeatSheet 的完整时间轴。若 concat 曾
  // 自动叠化、裁切或产生异常短片，在这里保留源片并停止消费，不把截短结果送去增强。
  const sourceInspection = await inspectVideoFinishingPreSubmission({
    sourceVideoUrl,
    expectedSourceDurationSeconds: input.plan.targetDurationSeconds,
    sourceResolution,
    clips: finishingClips,
  });
  if (sourceInspection.state === "pending") {
    console.warn("[video-finishing-source-verification] media probe unavailable", {
      runId: input.plan.runId,
      reason: sourceInspection.reason,
    });
    return { state: "running", action: "verify", sourceVideoUrl };
  }
  if (!sourceInspection.satisfied) {
    return {
      state: "failed",
      action: "noop",
      sourceVideoUrl,
      error: sourceInspection.failureReason || "video_finishing_pre_submission_verification_failed",
    };
  }

  const requestHash = stableContentHash({
    runId: input.plan.runId,
    sourceVideoUrl,
    contract,
  });
  const claimedAt = new Date().toISOString();
  await upsertAuthoringArtifact({
    runId: input.plan.runId,
    artifactKey: VIDEO_FINISHING_SUBMISSION_ARTIFACT_KEY,
    contentHash: requestHash,
    derivedFrom: ["concat:auto"],
    status: "pending",
    payload: JSON.stringify({
      schemaVersion: 1,
      kind: "video_finishing_submission",
      phase: "claimed",
      requestHash,
      attempt,
      providerRequestAttempted: false,
      providerAccepted: null,
      claimedAt,
      ...(existingIntent
        ? {
            previousSubmission: {
              status: existingIntent.status,
              contentHash: existingIntent.content_hash,
              payload: previousIntentPayload,
              error: existingIntent.error,
              updatedAt: existingIntent.updated_at,
            },
          }
        : {}),
    }),
    nowIso: claimedAt,
  });

  let created: Awaited<ReturnType<typeof runPublicTask>>;
  try {
    created = await runPublicTask(input.c, input.requestUserId, {
      request: {
        kind: "video_enhance",
        prompt: "",
        extras: {
          modelKey: contract.modelKey,
          video_url: sourceVideoUrl,
          specKey: contract.billingSpecKey,
          tool_version: contract.toolVersion,
          scene: contract.scene,
          resolution: contract.resolution,
          ...(typeof contract.fps === "number" ? { fps: contract.fps } : {}),
          persistAssets: true,
        },
      },
    });
  } catch (error) {
    const knownPreUpstream = isVideoSubmitKnownPreUpstreamFailure(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await markAuthoringArtifact({
      runId: input.plan.runId,
      artifactKey: VIDEO_FINISHING_SUBMISSION_ARTIFACT_KEY,
      expectedStatus: "pending",
      status: knownPreUpstream ? "stale" : "failed",
      payload: JSON.stringify({
        schemaVersion: 1,
        kind: knownPreUpstream
          ? "video_finishing_pre_upstream_rejection"
          : "video_finishing_submission_uncertain",
        requestHash,
        attempt,
        providerRequestAttempted: knownPreUpstream ? false : null,
        providerAccepted: knownPreUpstream ? false : null,
        errorMessage,
      }),
      error: errorMessage,
      nowIso: new Date().toISOString(),
    });
    throw error;
  }
  const result = created.result && typeof created.result === "object"
    ? created.result as Record<string, unknown>
    : {};
  const taskId = readTrimmedString(result.id);
  const vendor = readTrimmedString(created.vendor) || "newapi";
  if (!taskId) {
    await markAuthoringArtifact({
      runId: input.plan.runId,
      artifactKey: VIDEO_FINISHING_SUBMISSION_ARTIFACT_KEY,
      expectedStatus: "pending",
      status: "failed",
      payload: JSON.stringify({
        schemaVersion: 1,
        kind: "video_finishing_submission_uncertain",
        requestHash,
        attempt,
        providerRequestAttempted: true,
        providerAccepted: null,
        errorMessage: "provider response lacked a stable task id",
      }),
      error: "provider response lacked a stable task id",
      nowIso: new Date().toISOString(),
    });
    throw new AppError("后期供应商已调用但未返回稳定 taskId，已阻止重复提交", {
      status: 502,
      code: "video_finishing_submission_identity_uncertain",
    });
  }
  await markAuthoringArtifact({
    runId: input.plan.runId,
    artifactKey: VIDEO_FINISHING_SUBMISSION_ARTIFACT_KEY,
    expectedStatus: "pending",
    status: "ready",
    payload: JSON.stringify({
      schemaVersion: 1,
      kind: "video_finishing_provider_task_accepted",
      requestHash,
      attempt,
      providerRequestAttempted: true,
      providerAccepted: true,
      taskId,
      vendor,
    }),
    nowIso: new Date().toISOString(),
  });
  await persistFinishingRunningNode({
    ...input,
    row,
    sourceNodeId,
    sourceVideoUrl,
    taskId,
    vendor,
  });
  return { state: "running", action: "submit", sourceVideoUrl };
}

/**
 * 【run 级驱动互斥·根治双开（2026-07-10 用户令「不能一个场景补一次，要根治」）】
 * drive 模式必须先拿到 runId 互斥锁才能进入真正的驱动体——第二条并发驱动循环
 * （无论来自 api 另一请求、credit-worker、headless）直接拿到只读「另一驱动持锁中」回执，
 * 连提交路径都进不去。plan 模式（纯算不写）与解析不出 runId 的调用不加锁，逐字走原路。
 * PostgreSQL lease 默认 30 分钟并每分钟续约（持有者崩溃后由数据库时间释放）；续约失败会中止当前驱动，
 * 下游仍以 Effect Ledger pre-pass 重挂与供应商调用前 run/effect 状态复核防止重复提交。
 */
export async function orchestrateVideoRun(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  bodyArgs: unknown;
  /** 章节画布 id（项目子级）。存在则整条 orchestrate 读写切到 chapters.canvas_flow。 */
  chapterId?: string;
}): Promise<VideoOrchestrateResult> {
  const argsForLock =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};
  const modeForLock = readTrimmedString(argsForLock.mode);
  const planForLock =
    argsForLock.storyPlan && typeof argsForLock.storyPlan === "object"
      ? (argsForLock.storyPlan as Record<string, unknown>)
      : argsForLock;
  const runIdForLock =
    readTrimmedString(argsForLock.runId) || readTrimmedString(planForLock.runId);
  if (modeForLock !== "drive" || !runIdForLock) {
    return orchestrateVideoRunUnlocked(input);
  }
  const lockToken = await acquireRunDriveLock(runIdForLock);
  if (!lockToken) {
    console.log(`[run-drive-lock] runId=${runIdForLock} 已被另一驱动持锁，本次调用只读让位（防双开双扣费）`);
    return {
      ok: true,
      runId: runIdForLock,
      state: "video_running",
      mode: "drive",
      targetDurationSeconds: 0,
      videoModel: "",
      generationContract: {
        videoModel: "",
        durationOptions: [],
        maxDurationSeconds: 0,
        referenceImagePolicy: {
          countUnit: "unique_url",
          maximumTotalImages: 0,
          maximumBusinessImages: 0,
        },
        referenceAudioPolicy: {
          minimumDurationSeconds: 0,
          maximumDurationSeconds: 0,
        },
      },
      durationOptions: [],
      clipPlan: [],
      clips: [],
      concatNodeIds: [],
      allClipsSucceeded: false,
      driveAction: "noop",
      nextStep:
        "本 run 正由另一条驱动循环持锁推进（run 级互斥），本次调用未做任何动作也未扣费。用 mode:'status' 轮询进度即可，勿并发再驱动。",
    };
  }
  try {
    return await orchestrateVideoRunUnlocked(input);
  } finally {
    await releaseRunDriveLock(runIdForLock, lockToken);
  }
}

async function orchestrateVideoRunUnlocked(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  bodyArgs: unknown;
  /** 章节画布 id（项目子级）。存在则整条 orchestrate 读写切到 chapters.canvas_flow。 */
  chapterId?: string;
}): Promise<VideoOrchestrateResult> {
  const chapterId = readTrimmedString(input.chapterId);
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};
  const mode: OrchestrateMode = readTrimmedString(args.mode) === "drive" ? "drive" : "plan";
  // StoryPlan 只能来自已建立的执行合同。画布节点是运行状态投影，禁止反向重建并成为平行真源。
  if (args.plan !== undefined) {
    throw new AppError("legacy plan field is forbidden", {
      status: 400,
      code: "video_orchestrate_legacy_plan_field_forbidden",
    });
  }
  let planSource: unknown;
  let durableRunForDrive: Awaited<ReturnType<typeof getVideoRun>> = null;
  if (mode === "drive") {
    if (args.storyPlan !== undefined) {
      throw new AppError("drive must load the durable executable plan by runId", {
        status: 400,
        code: "video_orchestrate_inline_story_plan_forbidden",
      });
    }
    const runId = readTrimmedString(args.runId);
    if (!runId) {
      throw new AppError("drive requires runId", {
        status: 400,
        code: "video_orchestrate_run_id_required",
      });
    }
    const durableRun = await getVideoRun(runId);
    durableRunForDrive = durableRun;
    if (!durableRun?.story_plan) {
      throw new AppError("durable executable plan is missing", {
        status: 409,
        code: "video_orchestrate_executable_plan_missing",
      });
    }
    try {
      planSource = JSON.parse(durableRun.story_plan) as unknown;
    } catch {
      throw new AppError("durable executable plan is not valid JSON", {
        status: 409,
        code: "video_orchestrate_executable_plan_invalid_json",
      });
    }
    if (!planSource || typeof planSource !== "object" || Array.isArray(planSource)) {
      throw new AppError("durable executable plan is invalid", {
        status: 409,
        code: "video_orchestrate_executable_plan_invalid",
      });
    }
    const durablePlan = planSource as Record<string, unknown>;
    const { executablePlanHash, ...hashPayload } = durablePlan;
    if (
      durablePlan.protocolVersion !== VIDEO_ORCHESTRATOR_PROTOCOL_VERSION ||
      typeof executablePlanHash !== "string" ||
      executablePlanHash !== stableContentHash(hashPayload)
    ) {
      throw new AppError("durable executable plan version or hash is invalid", {
        status: 409,
        code: "video_orchestrate_executable_plan_hash_invalid",
      });
    }
  } else {
    if (args.storyPlan === undefined) {
      throw new AppError("plan mode requires storyPlan", {
        status: 400,
        code: "video_orchestrate_story_plan_required",
      });
    }
    planSource = args.storyPlan;
  }
  const plan = validateStoryPlan(planSource);
  if (mode === "drive" && plan.runId !== readTrimmedString(args.runId)) {
    throw new AppError("durable executable plan runId conflicts with request runId", {
      status: 409,
      code: "video_orchestrate_run_id_conflict",
    });
  }

  // 实际提交只消费 estimate 阶段冻结并持久化的合同，禁止在生产中重查目录改变已审计划。
  let generationContract: VideoGenerationContract;
  try {
    generationContract = await resolveStoryPlanGenerationContract({
      c: input.c,
      storyPlan: plan,
      allowCatalogResolution: mode === "plan",
    });
    plan.generationContract = generationContract;
  } catch (error) {
    throw new AppError(`video orchestrate: ${String((error as Error).message || error)}`, {
      status: 409,
      code: "video_generation_contract_missing",
    });
  }
  const durationOptions = generationContract.durationOptions;
  // Native audio is a best-effort enhancement. Runtime catalog outages or an
  // older model without audio must never prevent the visual production path.
  let nativeAudioSupported = false;
  try {
    nativeAudioSupported = await resolveVideoModelNativeAudioSupport({
      c: input.c,
      videoModel: plan.videoModel,
    });
  } catch (error) {
    console.warn(
      `[video-audio-degraded] runId=${plan.runId} native audio capability unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // 显式分镜时长：全片要么都给（导演掌控镜头数+节奏）、要么都不给（回退 editingStyle/拉满）。
  const explicitDurations = extractExplicitClipDurations(plan.clips);
  if (plan.clips.length === 0) {
    if (mode !== "plan") {
      throw new AppError(
        "video execution requires frozen clips with an explicit continuityMode for every clip",
        { status: 409, code: "video_continuity_contract_unresolved" },
      );
    }
    const timingPlan = buildClipTimingPlan({
      runId: plan.runId,
      targetDurationSeconds: plan.targetDurationSeconds,
      durationOptions,
      ...(plan.editingStyle ? { editingStyle: plan.editingStyle } : {}),
    });
    assertFrozenClipTopology(plan, timingPlan);
    return {
      ok: true,
      runId: plan.runId,
      state: "planned",
      mode: "plan",
      targetDurationSeconds: plan.targetDurationSeconds,
      videoModel: plan.videoModel,
      generationContract,
      durationOptions,
      clipPlan: timingPlan,
      clips: [],
      concatNodeIds: [],
      allClipsSucceeded: false,
      nextStep:
        "timing slots computed; agents must now author a complete BeatSheet with one explicit continuityMode per clip before any execution topology can be built",
    };
  }
  const clipPlan = buildClipPlan({
    runId: plan.runId,
    targetDurationSeconds: plan.targetDurationSeconds,
    durationOptions,
    ...(explicitDurations ? { explicitDurations } : {}),
    ...(plan.editingStyle ? { editingStyle: plan.editingStyle } : {}),
    // reference_video 是唯一会产生运行时上一镜依赖的连续性合同；其余模式可并发。
    continuityModes: plan.clips.map((clip) => clip.continuityMode),
  });
  assertFrozenClipTopology(plan, clipPlan);
  if (mode === "drive" && /seedance/i.test(plan.videoModel)) {
    const startedRun = await getVideoRun(plan.runId);
    if (!startedRun && isDriveStartBoundaryEnabled(input.c)) {
      throw new AppError(
        `drive_requires_started_run: runId=${plan.runId} 尚未经 start 持久化并取得同步驱动租约，禁止 drive 直接提交付费视频任务。`,
        { status: 402, code: "drive_requires_started_run" },
      );
    }
    if (startedRun?.beat_sheet) {
      const referenceAuthority = restoreBeatSheetVideoReferenceAuthority({
        plan,
        beatSheetJson: startedRun.beat_sheet,
      });
      if (!referenceAuthority.ok) {
        throw new AppError(referenceAuthority.message, {
          status: 422,
          code: referenceAuthority.code,
          details: { runId: plan.runId },
        });
      }
      if (referenceAuthority.restoredClipIndexes.length > 0) {
        console.log(
          `[video-reference-authority] runId=${plan.runId} 已从 BeatSheet 恢复镜${referenceAuthority.restoredClipIndexes.join("/")}的唯一显式关键帧引用`,
        );
      }
    }
  }
  // —— 读最新 flow，判定每段现状 + 下一步动作（确定性，纯读，无生成）。
  let row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    ...(chapterId ? { chapterId } : {}),
  });

  let flowNodes = readFlowNodes(row);

  // —— Change A（flag VIDEO_ORCHESTRATOR_PLAN_ON_CANVAS，默认 OFF）：plan 时把每段「计划」
  // 一次性落成画布上的 planned 占位节点（StoryPlan 变画布事实，供事件驱动续跑读取）。
  // OFF 时整块跳过、行为逐字不变。幂等：只建 slot 尚不存在的节点（createNodes 对已存在 id 会抛错）；
  // planned → mapVideoNodeStatus 判 absent（待提交），submit 时按同一 slot id（deriveClipNodeId）patch
  // 复用，不重复。详见 docs/video/orchestrator-event-driven-refactor.md。
  if (mode === "drive" && isPlanOnCanvasEnabled(input.c)) {
    const existingIds = new Set(flowNodes.map((n) => n.id));
    const placeholders = buildClipPlaceholderNodes({
      plan: {
        runId: plan.runId,
        videoModel: plan.videoModel,
        generationContract,
        ...(plan.aspect ? { aspect: plan.aspect } : {}),
        ...(plan.recipeId ? { recipeId: plan.recipeId } : {}),
        ...(plan.parentGroupId ? { parentGroupId: plan.parentGroupId } : {}),
        clips: plan.clips,
      },
      clipPlan,
    }).filter((spec) => !existingIds.has(spec.id));
    if (placeholders.length > 0) {
      const persisted = await persistFlowPatch({
        c: input.c,
        row,
        flowId: input.flowId,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
        ...(chapterId ? { chapterId } : {}),
        patch: { createNodes: placeholders } as never,
        affectedNodeIds: placeholders.map((s) => s.id),
      });
      row = persisted.row;
      flowNodes = readFlowNodes(row);
    }
  }

  // 【absent 双开根治·2026-07-10】画布 clip 节点被 stale 快照冲掉会被判 absent → 盲再提交
  // （第一条任务还在上游跑就交第二条＝双倍扣费，ch11 实测 10 段 20 任务）。提交时已登记
  // (runId,clipIndex)→taskId 在飞映射：absent 先查映射，命中＝重建/修补占位节点挂回原 taskId
  // （交回 reconcile 收口），查无在飞才允许真正提交。best-effort：重挂失败不阻断驱动。
  {
    const reattach: Array<{ nodeId: string; item: (typeof clipPlan)[number]; taskId: string }> = [];
    for (const item of clipPlan) {
      const runtime0 = resolveClipVideoRuntime(flowNodes, item.nodeId, plan.runId, item.clipIndex);
      if (runtime0.status !== "absent") continue;
      const inflightTaskId = await getClipInflightTask(plan.runId, item.clipIndex);
      if (inflightTaskId) reattach.push({ nodeId: item.nodeId, item, taskId: inflightTaskId });
    }
    if (reattach.length) {
      try {
        const createNodes: Array<Record<string, unknown>> = [];
        const patchNodeData: Array<{ id: string; data: Record<string, unknown> }> = [];
        for (const r of reattach) {
          const data: Record<string, unknown> = {
            kind: "video",
            label: buildClipNodeLabel(plan.clips[r.item.clipIndex], r.item.clipIndex, clipPlan.length),
            clipRunId: plan.runId,
            clipIndex: r.item.clipIndex,
            durationSeconds: r.item.durationSeconds,
            status: "running",
            taskId: r.taskId,
            videoTaskId: r.taskId,
            reattachedFromInflightMap: true,
          };
          if (findFlowNode(row, r.nodeId)) patchNodeData.push({ id: r.nodeId, data });
          else createNodes.push({ id: r.nodeId, type: "taskNode", position: { x: 0, y: 0 }, data });
        }
        const persisted = await persistFlowPatch({
          c: input.c,
          row,
          flowId: input.flowId,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          ...(chapterId ? { chapterId } : {}),
          affectedNodeIds: reattach.map((r) => r.nodeId),
          patch: {
            ...(createNodes.length ? { createNodes } : {}),
            ...(patchNodeData.length ? { patchNodeData, allowOverwrite: true } : {}),
          } as never,
        });
        row = persisted.row;
        flowNodes = readFlowNodes(row);
        console.log(
          `[clip-inflight] runId=${plan.runId} 重挂被冲掉的在飞 clip×${reattach.length}（镜${reattach
            .map((r) => r.item.clipIndex)
            .join("/")}·防 absent 双开重提交）`,
        );
      } catch (e) {
        console.warn(
          `[clip-inflight] 重挂失败（本轮按原状态机走）: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  const clips: ClipRuntimeState[] = clipPlan.map((item) => {
    // 视频运行态：按 slot 或同段 (clipRunId, clipIndex) 元数据反查 —— 认出手动命名/重命名的成片，
    // 不再因 slot id 对不上而判 absent → 反复重造 clip0。
    const runtime = resolveClipVideoRuntime(
      flowNodes,
      item.nodeId,
      plan.runId,
      item.clipIndex,
    );
    let nextAction: ClipRuntimeState["nextAction"] = "submit_video";
    if (runtime.status === "success") nextAction = "done";
    else if (runtime.status === "submit_failed") nextAction = "done"; // 提交被上游永久拒绝（如内容审核），不再重试
    else if (runtime.status === "running") nextAction = "reconcile";
    else if (runtime.status === "failed") {
      // 【视频任务禁止自动重试·用户令 2026-07-10】失败＝终态，一律不再原样重提。
      // 此前只有确定性审核/版权拒（isPermanentModerationFailure）标终态，其余 failed 与 absent
      // 同路走 submit_video → ch11 实测 10 段提交出 20 条任务（失败/误判 absent 反复重灌，
      // 每发白烧一次渲染费）。现在任何 failed 都以 video_failed 浮出、带错误归因，
      // 由用户/agent 检视后显式 replaceAtIndex 重灌该镜再出——重做是人的决定，不是驱动器的默认。
      nextAction = "done";
    } else if (runtime.status === "absent") {
      // clip≥1 续写依赖上一段就绪。
      if (item.expectedPrevClipIndex != null) {
        const prev = clipPlan[item.expectedPrevClipIndex];
        const prevRuntime = prev
          ? resolveClipVideoRuntime(flowNodes, prev.nodeId, plan.runId, prev.clipIndex)
          : { status: "absent" as const };
        nextAction = prevRuntime.status === "success" ? "submit_video" : "await_previous_clip";
      } else {
        nextAction = "submit_video";
      }
    }
    return {
      clipIndex: item.clipIndex,
      // 成片回写用真实命中的节点 id（含手动命名）；缺失时退回确定性 slot 供新建。
      nodeId: runtime.nodeId || item.nodeId,
      clipId: item.clipId,
      durationSeconds: item.durationSeconds,
      status: runtime.status,
      ...(runtime.videoUrl ? { videoUrl: runtime.videoUrl } : {}),
      ...(runtime.error ? { error: runtime.error } : {}),
      nextAction,
    };
  });

  const anyRunning = clips.some((c) => c.status === "running");
  const allSucceeded = clips.length > 0 && clips.every((c) => c.status === "success");
  const anyFailed = clips.some((c) => c.status === "failed" || c.status === "submit_failed");
  const concatNodeIds = allSucceeded ? clips.map((c) => c.nodeId) : [];

  let state: VideoOrchestrateResult["state"] = "planned";
  if (allSucceeded) state = "video_success";
  else if (anyRunning) state = "video_running";
  else if (anyFailed) state = "video_failed";

  // 【voice-auto-dub 已删除·2026-07-04 用户拍板】语音/音频只作视频生成时的输入（音色参考，
  // 见 video-orchestrator.dialog-audio.ts），出片后不再有任何自动 TTS+mux 流程——旧 auto-dub 曾把
  // 11/23 段 seedance 原生对口型音轨覆盖成 TTS 贴片并大量重复计费。手动 tapcanvas_voice_card_dub 保留。

  // —— drive 模式：确定性单步推进。优先级 reconcile（推进 running）> generate（出图/提交）> concat。
  //    每次只推进一步并把真实结果回写画布；调用方循环调用直到 state==="concatenated"。
  //    所有生成/合成调用都已接通真实 handler；reconcile 是纯回写不触发生成。
  let nextStep = "";
  let driveAction: VideoOrchestrateResult["driveAction"] = "noop";
  let concatVideoUrl = "";
  const projectionDiagnostics: string[] = [];
  let sourceConcatPolicy: VideoConcatPolicy | undefined;
  if (mode === "drive") {
    // 故事板是唯一模式：每个 cut 从自己的故事板帧重锚，镜间无续写依赖，可并发提交。
    // 不限并发（每章节可同时渲染的视频镜数无上限）：只要还有待提交镜，就跳过 reconcile
    // 直接提交下一镜，避免"提交→立即 running→阻塞后续提交"的串行死锁。
    const skipReconcileForCutSubmit =
      anyRunning &&
      clips.some((c) => c.nextAction === "submit_video");
    if (anyRunning && !skipReconcileForCutSubmit) {
      // 安全地推进 running → 终态（reconcile 只读上游 + 回写，不生成）。
      driveAction = "reconcile";
      // 主树 handler 版 reconcile：按 flow 全扫 running 视频节点拉一次上游并 fresh-read 回写，
      // 同时按 taskId 幂等结算/退积分（不依赖 runId 入参；orchestrate 已按 flow 作用域）。
      const recon = await reconcileVideoNodesForFlow({
        c: input.c,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
        flowId: input.flowId,
        row,
        ...(chapterId ? { chapterId } : {}),
      });
      const allSettled = recon.stillRunning === 0;
      if (allSettled) {
        // 上游已全部落地 → 还有后续步骤（出下一镜/拼接），同步 driver 继续推进。
        nextStep = "all running clips settled; re-run orchestrate to advance";
      } else {
        // 仍有 clip 在供应商侧渲染；同步 driver 等待后进入下一轮 reconcile。
        nextStep =
          "clips are still rendering at the provider; the synchronous run driver must wait before the next reconcile cycle";
      }
    } else if (allSucceeded) {
      // 幂等：已有本 run 的成片节点（composeVideo + clipRunId + videoUrl）→ 不重拼。
      // kind 同时接受 composeVideo / videoCompose 两种拼写：后端写 composeVideo，但前端规范化
      // 成 videoCompose（AddNodePanel 约定），只认一种会让 orchestrator 认不出自己的成片节点 →
      // 重复拼接 + 配合「concat 后等审片置 video_success」会陷入非终态死循环（实测 ch11）。
      const existingFilm = flowNodes.find((n) => {
        const d = n.data ?? {};
        const k = readTrimmedString(d.kind).toLowerCase();
        return (
          (k === "composevideo" || k === "videocompose") &&
          readTrimmedString(d.clipRunId) === plan.runId &&
          Boolean(readDurableNodeVideoUrl(n))
        );
      });
      if (!existingFilm) {
        driveAction = "concat";
        // 全段成片 → 拼接（只 stitch 已有 clip，不重生成）。concatVideosToCanvas 只返回 URL、
        // 写节点是调用方责任 → 这里把成片写成 composeVideo 节点，否则画布看不到成片卡。
        //
        // 【单镜 run 直采，不走 concat】concatVideosToCanvas 硬要求 ≥2 段视频；单段 run 走 concat
        // 必抛 "must resolve to at least 2 video URLs" → run 永远卡在 video_success、每 tick 被驱动
        // 却零推进（last_drive_at 始终新鲜 → 僵尸清理器也抓不到）→ 前端幽灵进度永驻。
        // 单段成片就是那一段视频本身：直接采用其 videoUrl 为成片 URL，照样写 composeVideo 节点终态化。
        if (concatNodeIds.length < 2) {
          concatVideoUrl = readTrimmedString(clips[0]?.videoUrl);
          sourceConcatPolicy = {
            joinMode: "hard_cut",
            xfadeSeconds: 0,
            colorMatch: false,
          };
        }
        // 多段成片由独立 media-worker 在后台拼接并直接上传对象存储。API 容器不承载媒体字节，
        // 浏览器是否打开也不再决定用户目标能否完成；worker 失败必须显式失败，不回退本地 ffmpeg。
        if (concatNodeIds.length >= 2) {
          if (!durableRunForDrive) {
            throw new AppError(`concat requires a durable video run: ${plan.runId}`, {
              status: 409,
              code: "video_concat_durable_run_missing",
            });
          }
          // 合成是可能持续数分钟的同步 media-worker 调用。所有 clip 的真实 URL 已齐时，必须在
          // 发起该外部调用前先持久化并广播 composition 边界；否则整个阻塞窗口仍显示上一阶段
          // 的 11/N，阶段耗时也会被错误归入媒体生产。重复驱动已处于 concatenating 时不重写
          // artifact 的 startedAt，只复用现有持久事实继续幂等合成。
          await persistVideoRunConcatenatingPhase({
            run: durableRunForDrive,
            clips,
            nowIso: new Date().toISOString(),
          });
          state = "concatenating";
          const concatenated = await concatVideosToCanvas({
            c: input.c,
            requestUserId: input.requestUserId,
            row,
            bodyArgs: {
              nodeIds: concatNodeIds,
              fileName: `film-${plan.runId}.mp4`,
              ...(plan.aspect ? { aspect: plan.aspect } : {}),
              // BeatSheet 已冻结镜间交棒；源片合成不得再本地猜叠化或平均调色。
              // 显式硬切保持每段完整时间轴，避免跨段混叠对白和吃掉镜尾动作。
              xfadeSeconds: 0,
              colorMatch: false,
            },
          });
          concatVideoUrl = readTrimmedString(concatenated.videoUrl);
          sourceConcatPolicy = concatenated.concatPolicy;
          if (!concatVideoUrl) throw new Error(`video_concat_asset_url_missing:${plan.runId}`);
        }
        if (concatVideoUrl) {
          const filmNodeId = `film-${plan.runId}`;
          // 成片节点 upsert：首次拼接 createNodes 新建；幂等恢复时该 id 可能已存在，
          // createNodes 对已存在 id 会抛错，因此必须走 patchNodeData 合并并保留已有审计字段。
          const existingFilmNode = flowNodes.find((n) => n.id === filmNodeId);
          // 【按序连边 clip→成片节点】（用户：浏览器把片段按序连到合成节点即可触发合成）。此前编排器只建
          // 成片节点、从不连边 → 前端合成节点靠 edge 收不到上游 11 段 → 永不触发自动合成。这里按 concatNodeIds
          // （clipIndex 序）确定性建边，edge id 固定可去重幂等。多段(clientConcat)才连；单段直采无需连边。
          const existingEdgeIds = new Set(
            readFlowEdges(row)
              .map((e) => readTrimmedString(e.id))
              .filter(Boolean),
          );
          // 【音频轨连边·2026-07-16 用户实测「音频节点都没连视频，白生成了」根治】
          // 病根是四层全断、无人负责建边：工具 schema 没有连边参数(additionalProperties:false 连传都传不进)、
          // generate-audio-to-canvas 只发 createNodes、前端 collectUpstreamComposeAudioTracks 只吃 incoming
          // edge 且无兜底、SKILL 只说「可连」不说「必连」→ speech/music 音频节点 100% 孤儿，积分已扣但音轨
          // 没进片。正解按 Hermes 序取「正确默认」：不靠小T自觉、不加硬闸，成片节点建出时服务端确定性连边。
          // voice_card 不在收编口径内（走 seedance audio_url 原生对白，连边会让台词出两遍人声）。
          //
          // ⚠️ 单段直采(!clientConcat)不连音频边：直采只是把 clip 的 videoUrl 直接当成片 url、不经 WebAV
          // 合成，连了边前端也不会混音 —— 连边只会制造「看着连上了、音频却没进片」的假象，比不连更糟。
          // 单段要混音需前端合成器放宽 sources.length>=2 限制（composeVideosCore/dag 三处），未做。
          const composeAudioNodeIds: string[] = [];
          const composeEdges = buildComposeEdges({
            filmNodeId,
            clipNodeIds: concatNodeIds.length >= 2 ? concatNodeIds : [],
            audioNodeIds: composeAudioNodeIds,
            existingEdgeIds,
          });
          if (composeAudioNodeIds.length) {
            console.log(
              `[orchestrate] 成片音频轨连边 runId=${plan.runId} → ${composeAudioNodeIds.length} 条(${composeAudioNodeIds.join("/")})`,
            );
          }
          if (concatNodeIds.length < 2) {
            const orphanAudio = collectComposeAudioNodeIds(flowNodes);
            if (orphanAudio.length) {
              console.warn(
                `[orchestrate] ⚠️ 单段直采 run 有 ${orphanAudio.length} 条音频节点(${orphanAudio.join("/")})混不进成片（直采不经 WebAV 合成）— runId=${plan.runId}`,
              );
            }
          }
          const filmData = buildCompletedFilmNodeData({
            videoUrl: concatVideoUrl,
            runId: plan.runId,
            targetDurationSeconds: plan.targetDurationSeconds,
            ...(plan.aspect ? { aspect: plan.aspect } : {}),
            ...(sourceConcatPolicy ? { concatPolicy: sourceConcatPolicy } : {}),
          });
          try {
            await persistFlowPatch({
              c: input.c,
              row,
              flowId: input.flowId,
              requestUserId: input.requestUserId,
              devBypass: input.devBypass,
              ...(chapterId ? { chapterId } : {}),
              affectedNodeIds: [
                filmNodeId,
                ...(plan.parentGroupId ? [plan.parentGroupId] : []),
              ],
              patch: (existingFilmNode
                ? {
                    patchNodeData: [{ id: filmNodeId, data: filmData }],
                    allowOverwrite: true,
                    ...(composeEdges.length ? { createEdges: composeEdges } : {}),
                  }
                : {
                    createNodes: [
                      {
                        id: filmNodeId,
                        type: "taskNode",
                        position: { x: 0, y: 0 },
                        ...(plan.parentGroupId ? { parentId: plan.parentGroupId } : {}),
                        data: filmData,
                      },
                    ],
                    ...(composeEdges.length ? { createEdges: composeEdges } : {}),
                  }) as never,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            projectionDiagnostics.push(`film_node_projection_failed: ${message}`);
            console.error(
              `[video-canvas-projection] final film projection failed; backend delivery preserved runId=${plan.runId}: ${message}`,
            );
          }
        }
        state = concatVideoUrl ? "concatenated" : "video_success";
        nextStep = concatVideoUrl
            ? "film concatenated"
            : "concat returned no url; retry concat";
      } else {
        concatVideoUrl = readDurableNodeVideoUrl(existingFilm);
        state = "concatenated";
        nextStep = "film already concatenated";
      }
    } else {
      // 取第一段需要推进的 clip（submit_video）。
      const pending = clips.find(
        (c) => c.nextAction === "submit_video",
      );
      // pending 存在时要求该 runId 已由 start 持久化，确保幂等、归属和计费事实有唯一落点。
      if (pending && isDriveStartBoundaryEnabled(input.c)) {
        const startedRun = await getVideoRun(plan.runId);
        if (!startedRun) {
          throw new AppError(
            `drive_requires_started_run: runId=${plan.runId} 尚未经 start 持久化并取得同步驱动租约。drive 出图/出视频会真实扣积分，` +
              `必须先由当前明确生成请求完成内部 estimate 并 mode:"start" 建立 durable run，才能 drive 推进。` +
              `禁止跳过 start 直接提交供应商任务。`,
            { status: 402, code: "drive_requires_started_run" },
          );
        }
      }
      if (!pending) {
        driveAction = "noop";
        nextStep = "awaiting previous clip readiness; reconcile previous then re-run";
      } else {
        // submit_video：组装 per-clip 续写契约后异步提交（generateVideoToCanvas 走编排异步路径）。
        driveAction = "submit_video";
        const clipForFrames = plan.clips[pending.clipIndex];
        const runtimeSpeakerContract = readClipSpeakerBindings(clipForFrames);
        if (!runtimeSpeakerContract.issues.length && runtimeSpeakerContract.bindings.length) {
          const voiceProjection = await flowPatchMissingVoiceCardsFromLibrary({
            c: input.c,
            userId: input.requestUserId,
            flowId: input.flowId,
            ...(chapterId ? { chapterId } : {}),
            projectId: readTrimmedString(row.project_id) || null,
            roleNames: runtimeSpeakerContract.bindings.map((binding) => binding.name),
            devBypass: input.devBypass,
          });
          row = voiceProjection.row;
          flowNodes = readFlowNodes(row);
        }
        // 按需关键帧 + 精选资产：可无关键帧、普通单关键帧或 2～3 状态故事板图片。
        // 禁止全库灌入，也禁止递归展开任一节点的生成血缘。
        const storyboardNodeId = readTrimmedString(clipForFrames?.storyboardImageNodeId);
        const storyboardUrl = readNodeImageUrl(row, storyboardNodeId);
        if (storyboardNodeId && !storyboardUrl) {
          throw new AppError(
            `镜${pending.clipIndex} 的 V3 专属故事板缺少真实图片 URL`,
            { status: 422, code: "clip_storyboard_reference_missing" },
          );
        }
        const contractByNodeId = new Map<string, Beat["assetObjectContracts"][number]>();
        for (const contract of clipForFrames?.assetObjectContracts ?? []) {
          for (const rawNodeId of contract.referenceImageNodeIds) {
            const nodeId = readTrimmedString(rawNodeId);
            if (!nodeId) continue;
            const previous = contractByNodeId.get(nodeId);
            if (
              previous &&
              (previous.kind !== contract.kind || previous.name !== contract.name)
            ) {
              throw new AppError(
                `镜${pending.clipIndex} 的参考节点 ${nodeId} 同时绑定了多个资产身份：` +
                  `${previous.kind}:${previous.name} / ${contract.kind}:${contract.name}`,
                {
                  status: 422,
                  code: "clip_reference_asset_ambiguous",
                  details: {
                    clipIndex: pending.clipIndex,
                    nodeId,
                    identities: [
                      { kind: previous.kind, name: previous.name },
                      { kind: contract.kind, name: contract.name },
                    ],
                  },
                },
              );
            }
            contractByNodeId.set(nodeId, contract);
          }
        }
        const expectedReferenceUrlsByNodeId = new Map<string, Set<string>>();
        const sourceNodeIdsByUrl = new Map<string, Set<string>>();
        const recordReferenceSource = (nodeId: string, url: string): void => {
          const sourceNodeIds = sourceNodeIdsByUrl.get(url) ?? new Set<string>();
          sourceNodeIds.add(nodeId);
          sourceNodeIdsByUrl.set(url, sourceNodeIds);
          const urls = expectedReferenceUrlsByNodeId.get(nodeId) ?? new Set<string>();
          urls.add(url);
          expectedReferenceUrlsByNodeId.set(nodeId, urls);
        };
        if (storyboardNodeId && storyboardUrl) {
          recordReferenceSource(storyboardNodeId, storyboardUrl);
        }
        const clipRefEntries: ClipReferenceImageEntry[] = storyboardUrl
          ? [{
              url: storyboardUrl,
              label: `V3关键帧·镜${pending.clipIndex}·${clipForFrames?.storyboardFrameCount ?? 1}状态`,
              sourceNodeId: storyboardNodeId,
            purpose: "storyboard",
          }]
          : [];
        const referenceIdentityByUrl = new Map<
          string,
          {
            assetKind: VideoReferencePurpose;
            assetName: string;
            referenceRole?: string;
          }
        >();
        const referenceIdentityError: {
          current: { message: string; details: Record<string, unknown> } | null;
        } = { current: null };
        const returnAssetRepairRequired = async (inputError: {
          reasonCode: string;
          details?: unknown;
          message: string;
        }): Promise<VideoOrchestrateResult> => {
          const declaration = buildVideoAssetRepairDeclaration({
            runId: plan.runId,
            clipIndex: pending.clipIndex,
            clip: clipForFrames,
            reasonCode: inputError.reasonCode,
            details: inputError.details,
          });
		  await persistVideoAssetRepairFrontier({
			runId: plan.runId,
			declaration,
			status: "waiting_external",
			nowIso: new Date().toISOString(),
		  });
          const existingNode = findFlowNode(row, pending.nodeId);
          const repairNodeData: Record<string, unknown> = {
            kind: "video",
            label: buildClipNodeLabel(plan.clips[pending.clipIndex], pending.clipIndex, clipPlan.length),
            clipRunId: plan.runId,
            clipIndex: pending.clipIndex,
            durationSeconds: pending.durationSeconds,
            status: "submit_failed",
            clipSubmitError: inputError.message,
            clipSubmitErrorCode: inputError.reasonCode,
            clipSubmitPhase: "pre_upstream",
            upstreamSubmitAttempted: false,
            assetRepairRequired: true,
            assetRepair: declaration,
          };
          try {
            const persisted = await persistFlowPatch({
              c: input.c,
              row,
              flowId: input.flowId,
              requestUserId: input.requestUserId,
              devBypass: input.devBypass,
              ...(chapterId ? { chapterId } : {}),
              affectedNodeIds: [pending.nodeId],
              patch: existingNode
                ? ({ patchNodeData: [{ id: pending.nodeId, data: repairNodeData }], allowOverwrite: true } as never)
                : ({ createNodes: [{ id: pending.nodeId, type: "taskNode", position: { x: 0, y: 0 }, data: repairNodeData }] } as never),
            });
            row = persisted.row;
            flowNodes = readFlowNodes(row);
          } catch (persistError) {
            console.error(
              `[video-asset-repair] runId=${plan.runId} 镜${pending.clipIndex} 补图声明落画布失败: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
            );
          }
          const clipSnapshot = clips.find((item) => item.clipIndex === pending.clipIndex);
          if (clipSnapshot) {
            clipSnapshot.status = "submit_failed";
            clipSnapshot.nextAction = "done";
            clipSnapshot.error = inputError.message;
          }
          return {
            ok: true,
            runId: plan.runId,
            state: "video_failed",
            mode,
            targetDurationSeconds: plan.targetDurationSeconds,
            videoModel: plan.videoModel,
            generationContract,
            durationOptions,
            clipPlan,
            clips,
            concatNodeIds: [],
            allClipsSucceeded: false,
            driveAction: "noop",
            assetRepairRequired: true,
            assetRepair: declaration,
            nextStep: "assetRepairRequired: agents-cli 必须只补齐 declaration.requiredAssets 的独立真实图片，回收 imageUrl 后调用 mode:\"repair_assets\"；本轮未提交供应商视频任务。",
          };
        };
        const recordReferenceIdentity = (
          url: string,
          identity: {
            assetKind: VideoReferencePurpose;
            assetName: string;
            referenceRole?: string;
          },
        ): void => {
          if (!url || !identity.assetName) return;
          const existing = referenceIdentityByUrl.get(url);
          if (existing && existing.assetName !== identity.assetName) {
            referenceIdentityError.current = {
              message: `镜${pending.clipIndex} 的同一参考图片被声明为多个资产：${existing.assetName} / ${identity.assetName}`,
              details: { clipIndex: pending.clipIndex, url, existing, identity },
            };
            return;
          }
          referenceIdentityByUrl.set(url, {
            ...existing,
            ...identity,
          });
        };
        for (const nodeId of clipForFrames?.videoReferenceNodeIds ?? []) {
          const node = findFlowNode(row, nodeId);
          if (!node) {
            throw new AppError(`镜${pending.clipIndex} 的视频精选资产 ${nodeId} 不存在于当前授权画布`, {
              status: 422,
              code: "clip_video_reference_node_missing",
              details: {
                clipIndex: pending.clipIndex,
                nodeId,
                upstreamRequestAttempted: false,
              },
            });
          }
          const contract = contractByNodeId.get(nodeId);
          const nodeData = (node.data ?? {}) as Record<string, unknown>;
          const classification = classifyCanvasCardForRegistry(nodeData);
          if (
            contract &&
            (contract.kind === "character" ||
              contract.kind === "scene" ||
              contract.kind === "prop")
          ) {
            if (!classification) {
              return await returnAssetRepairRequired({
                reasonCode: "clip_reference_asset_identity_unresolved",
                message: `镜${pending.clipIndex} 的参考节点 ${nodeId} 无法解析为 ${contract.kind}:${contract.name}`,
                details: {
                  clipIndex: pending.clipIndex,
                  nodeId,
                  expected: { kind: contract.kind, name: contract.name },
                  nodeLabel: readTrimmedString(nodeData.label),
                },
              });
            }
            if (classification.kind !== contract.kind || classification.name !== contract.name) {
              return await returnAssetRepairRequired({
                reasonCode: "clip_reference_asset_identity_mismatch",
                message: `镜${pending.clipIndex} 的参考节点身份不匹配：合同 ${contract.kind}:${contract.name}，实际 ${classification.kind}:${classification.name}`,
                details: {
                  clipIndex: pending.clipIndex,
                  nodeId,
                  expected: { kind: contract.kind, name: contract.name },
                  actual: classification,
                },
              });
            }
          }
          const label = contract
            ? `${ASSET_KIND_LABEL[contract.kind] ?? "资产"}·${contract.name}｜参考职责=${contract.referenceRole}｜禁止迁移=${contract.forbiddenTransfer}`
              : classification
                ? `${ASSET_KIND_LABEL[classification.kind] ?? "资产"}·${classification.name}`
                : readTrimmedString(nodeData.label) || "精选资产";
          const identity = contract
            ? {
                assetKind: referencePurposeForContractKind(contract.kind),
                assetName: contract.name,
                referenceRole: contract.referenceRole,
              }
            : classification
              ? {
                  assetKind: referencePurposeForAssetKind(classification.kind),
                  assetName: classification.name,
                }
              : null;
          const urls = readNodeAllRefImageUrls(node);
          if (!urls.length) {
            throw new AppError(`镜${pending.clipIndex} 的视频精选资产 ${nodeId} 没有真实图片 URL`, {
              status: 422,
              code: "clip_video_reference_url_missing",
              details: { clipIndex: pending.clipIndex, nodeId },
            });
          }
          const purpose = contract
            ? contract.referenceRole === "none"
              ? "other"
              : purposeForAssetReferenceRole(contract.referenceRole)
            : classification
              ? referencePurposeForAssetKind(classification.kind)
              : "other";
          for (const url of urls) {
            recordReferenceSource(nodeId, url);
            if (identity && identity.assetKind !== "other") {
              recordReferenceIdentity(url, identity);
            }
            clipRefEntries.push({ url, label, sourceNodeId: nodeId, purpose });
          }
        }
        if (referenceIdentityError.current) {
          return await returnAssetRepairRequired({
            reasonCode: "clip_reference_asset_ambiguous",
            message: referenceIdentityError.current.message,
            details: referenceIdentityError.current.details,
          });
        }
        let groupRefs = [...new Set(clipRefEntries.map((entry) => entry.url))];
        const refLabelByUrl = new Map(clipRefEntries.map((e) => [e.url, e.label]));
        const refPurposesByUrl = new Map<string, VideoReferencePurpose[]>();
        for (const entry of clipRefEntries) {
          const purposes = refPurposesByUrl.get(entry.url) ?? [];
          const purpose = entry.purpose ?? "other";
          if (!purposes.includes(purpose)) purposes.push(purpose);
          refPurposesByUrl.set(entry.url, purposes);
        }
        if (/seedance/i.test(plan.videoModel)) {
          const budget = validateSd2ClipReferenceBudget({
            clipIndex: pending.clipIndex,
            businessReferenceImages: groupRefs,
			maximumBusinessReferences: generationContract.referenceImagePolicy.maximumBusinessImages,
          });
          if (!budget.ok) {
            throw new AppError(budget.message, {
              status: 422,
              code:
                "clip_reference_budget_exceeded",
              // This validation runs before generateVideoToCanvas and therefore
              // proves that no provider task was accepted. Keep the durable
              // run from remaining in video_running after a deterministic
              // reference-contract failure.
              terminal: true,
              details: budget,
            });
          }
          groupRefs = budget.businessReferenceImages;
        }
        // 本镜故事板关键帧 / 目标尾帧按相邻 clip 已闭合的连续性合同解释：
        // 本 clip 是 bridge head 才使用真实首帧；下一 clip 是 bridge head 时，本 clip 才使用真实尾帧。
        // V3 clip 故事板是提前生成的一张 1～3 帧有序参考图；整章母板、通用设计板仍拒绝。
        // 故事板为批前
        // 资产、不依赖上一镜视频产物（运行时抽帧续写仍禁）→ 恒并发不破。前镜尾帧===后镜首帧（共享桥接帧）
        // =跨镜硬承接；不挂帧的 clip 走纯文字状态接力，逐镜自由组合。
        const readClipFrameUrl = (nodeId?: string): string => {
          const id = readTrimmedString(nodeId);
          if (!id) return "";
          const node = findFlowNode(row, id);
          if (!node) return "";
          const kind = readTrimmedString(node.data.kind).toLowerCase();
          if (kind === "design_board" || kind === "designboard") return "";
          return (
            readTrimmedString(node.data.imageUrl) || readTrimmedString(node.data.url)
          );
        };
        const lastFrameNodeId = readTrimmedString(clipForFrames?.lastFrameImageNodeId);
        const lastFrameImageUrl = readClipFrameUrl(lastFrameNodeId);
        const bridgeRole = detectBridgeFrameRoles(plan.clips)[pending.clipIndex] ?? {
          isBridgeHead: false,
          isBridgeTail: false,
        };
        const selectedFrameUrls = selectContinuityFrameUrls({
          bridgeRole,
          storyboardImageUrl: storyboardUrl,
          lastFrameImageUrl,
        });
        const { storyboardFirstFrameUrl, targetLastFrameUrl } = selectedFrameUrls;
        if (bridgeRole.isBridgeTail && lastFrameNodeId && !lastFrameImageUrl) {
          throw new AppError(
            `镜${pending.clipIndex} 的桥接尾帧 ${lastFrameNodeId} 缺少可执行的真实图片 URL`,
            {
              status: 422,
              code: "clip_last_frame_reference_missing",
              details: { clipIndex: pending.clipIndex, nodeId: lastFrameNodeId },
            },
          );
        }
        // Only the frame selected by the frozen continuity contract is an actual
        // vendor input. A declared lastFrameImageNodeId on a non-bridge-tail clip
        // must not be added to expectedReferenceUrlsByNodeId: the final manifest
        // intentionally omits that URL, and counting it here makes the delivery
        // verifier reject a valid clip before the provider POST.
        if (targetLastFrameUrl && lastFrameNodeId && lastFrameImageUrl) {
          recordReferenceSource(lastFrameNodeId, targetLastFrameUrl);
          refLabelByUrl.set(targetLastFrameUrl, `桥接尾帧·镜${pending.clipIndex}`);
          const purposes = refPurposesByUrl.get(targetLastFrameUrl) ?? [];
          if (!purposes.includes("keyframe")) purposes.push("keyframe");
          refPurposesByUrl.set(targetLastFrameUrl, purposes);
        }
        // 【2026-06-26 根治·故事板=完整叙事·线稿剧情参考（用户二次定向：母板线稿 canvas 按行裁切）】
        // master 大故事板「子板」（带 masterBoardNodeId 或母板派生入边的 design_board；新管线＝母板线稿按行
        // 裁切产出的该段分镜线稿条）作「剧情参考」喂视频——补完 6-26《master-storyboard-mode》未接线的
        // 「子板驱动视频」（旧 allowBoardFrames=continuous 闸把绑定挡成死代码 → 视频退化 text_to_video+角色卡、
        // 子板零参与）。**不当字面首帧**（4 格线稿条当首帧会渲染成多格画面），而是进 referenceImages 引导
        // 叙事/构图；线稿无色彩污染 → 豁免上面「设计板硬剔除」（硬剔除只为防彩色多格污染）。角色/场景卡仍在
        // groupRefs 锁身份上色。绑定经显式 storyboardImageNodeId 或 sb→video 入边回溯解析（救手写绕过拆板
        // 工具、漏设字段的节点）。flag VIDEO_MASTER_SUBBOARD_FIRSTFRAME 可逆。
        const masterSubBoardNodeId = isMasterSubBoardReferenceEnabled(input.c.env)
          ? resolveMasterSubBoardNodeId(
              row,
              pending.nodeId,
              readTrimmedString(clipForFrames?.storyboardImageNodeId),
            )
          : "";
        // design_board/master_board 只服务上游关键帧生产，禁止进入视频参考数组。
        // 多 clip 编排禁止从板序、普通参考图或 feature flag 自动推导首尾帧。
        // 只有 agents 显式冻结 continuityMode=bridge_frames 时才保留字面帧角色。
        // 根因修复（#4）：clipPrompt 显式声明各参考输入的职责 + 锁定 logo，避免模型把同一 role 的
        // 多张参考图混用、把 logo/产品改样、或从静止重启。续写镜只锁光线/氛围/主体状态，
        // 不锁相机语言与构图——锁构图会把首镜的静态机位链式复制到全片（ch44 实测 11 镜 PPT 感根因之一）。
        // writer 已通过冻结剧情合同与同链自检交付最终 prompt；提交层必须逐字传递，
        // 不得通过关键词/正则把伤况、胜负或动作结果静默改写成另一种剧情。上游内容政策拒绝须原样报错。
        // clipPrompt 是冻结执行合同的一部分。提交层只能逐字传递，不再按本地
        // 角色/产品/蒙太奇/场景关键词二次改写语义；参考资产职责由结构化 manifest 传递。
        const clipPromptText = readTrimmedString(plan.clips[pending.clipIndex]?.clipPrompt);
        const reAnchor = shouldReanchorClipFirstFrame(pending.clipIndex, plan.editingStyle);
        // StoryPlan 是 estimate 前冻结的本轮权威规格。历史组节点不得在提交边界反向覆盖。
        const effectiveResolution = readTrimmedString(plan.resolution);
        if (!effectiveResolution) {
          throw new AppError("冻结 StoryPlan 缺少 resolution，禁止用静态默认规格提交视频", {
            status: 409,
            code: "video_orchestrate_resolution_required",
          });
        }
        const continuityMode = clipForFrames?.continuityMode;
        if (!continuityMode) {
          throw new AppError(`镜${pending.clipIndex} 缺少已冻结的 continuityMode`, {
            status: 422,
            code: "clip_continuity_contract_missing",
          });
        }
        const referenceDeliveryContract: VideoReferenceDeliveryContract = {
          version: 1,
          clipIndex: pending.clipIndex,
          continuityMode,
          expectedNodes: [...expectedReferenceUrlsByNodeId.entries()].map(
            ([nodeId, urls]) => ({ nodeId, expectedImageCount: urls.size }),
          ),
        };
        // 把 BeatSheet 的对象合同和确定性 cast 一起冻结进视频节点。
        // 之前这里只持久化了 videoReferenceNodeIds/referenceImageBindings，导致最终
        // generateVideoToCanvas 看不到 kind/name，只能拿泛化 label 去做身份校验；
        // 画布有图但 manifest 身份不闭合，遂在供应商 POST 前被错误判为错绑。
        const frozenAssetObjectContracts = (clipForFrames?.assetObjectContracts ?? []).map(
          (contract) => ({
            ...contract,
            referenceImageNodeIds: [...contract.referenceImageNodeIds],
          }),
        );
        const frozenStructuredClip = clipForFrames?.shots?.length
          ? {
              shots: clipForFrames.shots.map((shot) => ({ ...shot })),
              ...(clipForFrames.logline ? { logline: clipForFrames.logline } : {}),
              ...(clipForFrames.continuity ? { continuity: clipForFrames.continuity } : {}),
              ...(clipForFrames.editRhythm ? { editRhythm: clipForFrames.editRhythm } : {}),
              ...(clipForFrames.exitState ? { exitState: clipForFrames.exitState } : {}),
              ...(clipForFrames.speakerBindings?.length
                ? { speakerBindings: clipForFrames.speakerBindings.map((binding) => ({ ...binding })) }
                : {}),
            }
          : null;
        if (!frozenStructuredClip) {
          throw new AppError(`镜${pending.clipIndex} 缺少冻结的结构化 shots，禁止退回自由文本出片`, {
            status: 422,
            code: "structured_video_prompt_source_missing",
            details: { clipIndex: pending.clipIndex, upstreamRequestAttempted: false },
          });
        }
        const frozenCharacterRoleNames = deriveClipCharacterRoleNames(row, clipForFrames);
        const structuredSpeakerNames = collectClipDialogueSpeakerNames(clipForFrames);
        if (structuredSpeakerNames.length > 0 && !nativeAudioSupported) {
          throw new AppError("当前模型未声明原生音频能力，不能执行包含冻结 SpeechEvent 的 clip", {
            status: 422,
            code: "native_audio_required_for_speech_events",
            terminal: true,
            details: {
              upstreamRequestAttempted: false,
              speakerNames: structuredSpeakerNames,
            },
          });
        }
        const videoData: Record<string, unknown> = {
          kind: "video",
          // 语义化节点名「镜N·<beat>」替代千篇一律 "Generated Video"。
          label: buildClipNodeLabel(
            plan.clips[pending.clipIndex],
            pending.clipIndex,
            clipPlan.length,
          ),
          prompt: clipPromptText,
          videoModel: plan.videoModel,
          // SpeechEvent 非空时，VoiceManifest 与音色参考就是交付合同的一部分；
          // 缺失或供应商不支持必须在 POST 前失败，禁止剥离音频生成无声替代品。
          referenceAudioRequired: structuredSpeakerNames.length > 0,
          generateAudio: nativeAudioSupported,
          // 生成边界必须消费与 estimate/start 相同的冻结模型合同，尤其是
          // referenceImagePolicy。此前这里只写了 videoModel，导致编排节点进入
          // generateVideoToCanvas 后无法验真引用预算，所有 clip 都被拒绝。
          generationContract,
          ...frozenStructuredClip,
          ...buildDeclaredClipSceneData(clipForFrames),
          ...(frozenAssetObjectContracts.length
            ? { assetObjectContracts: frozenAssetObjectContracts }
            : {}),
          ...(frozenCharacterRoleNames.length
            ? { characterRoleNames: frozenCharacterRoleNames }
            : {}),
          // 编排元数据驱动异步 + 幂等 slot（服务端按 runId:clip:index 派生 nodeId）。
          clipRunId: plan.runId,
          clipIndex: pending.clipIndex,
          videoReferenceNodeIds: [...(clipForFrames.videoReferenceNodeIds ?? [])],
          continuityMode,
          referenceDeliveryContract,
          durationSeconds: pending.durationSeconds,
          ...(plan.aspect ? { aspectRatio: plan.aspect } : {}),
          ...(effectiveResolution ? { resolution: effectiveResolution } : {}),
          // S4.1 章节一致性门禁：把 storyPlan 里的分镜板绑定透传进 nodeData，
          // 否则 generateVideoToCanvas 读 nodeData.storyboardImageNodeId 为空就报"未绑定"。
          // 【2026-06-26 补绑】master 子板经入边回溯解析到（手写节点漏设 storyboardImageNodeId）时，
          // 优先回写解析结果，让持久化节点也带上正确绑定。
          ...(masterSubBoardNodeId || clipForFrames?.storyboardImageNodeId
            ? {
                storyboardImageNodeId:
                  masterSubBoardNodeId || clipForFrames!.storyboardImageNodeId,
              }
            : {}),
        };
        // referenceImages 始终保留其身份/服装/场景/道具/色卡/构图职责；是否存在串行视频依赖
        // 由 ClipPlan 的 expectedPrevClipIndex 决定，不在这里从文本推断。
        if (groupRefs.length) videoData.referenceImages = groupRefs;
        // 普通参考图永远保持 reference image 角色。montage 也不得把 groupRefs[0]
        // 隐式升级为 firstFrameUrl；需要显式帧角色的单节点生成使用独立能力面。
        // 故事板关键帧覆盖首帧 + per-clip 目标尾帧（纯决策抽到 resolveClipFrameOverride 便于单测）：
        // - storyboardFirstFrameUrl 非空 → 覆盖上面 card/尾帧算出的 firstFrame；缺失则旧逻辑原样生效。
        // - targetLastFrameUrl 非空 → 设 lastFrame；缺失则不设。referenceImages 仍保留 groupRefs（身份强化）。
        const frameDecision = resolveClipFrameOverride({
          storyboardFirstFrameUrl,
          targetLastFrameUrl,
          baseFirstFrame: readTrimmedString(videoData.firstFrameUrl),
          reAnchor,
        });
        if (frameDecision.firstFrameUrl) videoData.firstFrameUrl = frameDecision.firstFrameUrl;
        if (frameDecision.usedTargetLastFrame) videoData.lastFrameUrl = frameDecision.lastFrameUrl;
        // 【连续镜头·基于参考视频】只由本 clip 冻结的 continuityMode=reference_video 触发，
        // （auto 智能衔接的逐段标记）：本段 submit 只在上一镜 success 后才会被调度到
        // （expectedPrevClipIndex 串行门·见 nextAction 判定），此处把上一镜成片喂成本镜
        // 参考视频：sourceVideoUrl → generateVideoToCanvas extras.upstreamVideoUrl → task.service
        // 分支3 metadata.content video_url → new-api doubao adaptor 自动补 role:"reference_video"。
        // sourcePrevTaskId 同步带上（pixverse extend_from_task_id 用，doubao 忽略）。
        // 缺省（恒并发·无逐段标记）本块整体不触发，逐字零回归。
        const chainByReferenceVideo =
          pending.clipIndex > 0 &&
          plan.clips[pending.clipIndex]?.continuityMode === "reference_video";
        let chainRefVideoBound = false;
        if (chainByReferenceVideo) {
          const prevRuntimeForChain = clips[pending.clipIndex - 1];
          const prevChainVideoUrl = readTrimmedString(prevRuntimeForChain?.videoUrl);
          if (prevChainVideoUrl) {
            videoData.sourceVideoUrl = prevChainVideoUrl;
            const previousClipDuration = plan.clips[pending.clipIndex - 1]?.durationSeconds;
            if (typeof previousClipDuration === "number" && previousClipDuration > 0) {
              videoData.referenceVideoDurationSeconds = previousClipDuration;
            }
            chainRefVideoBound = true;
            const prevChainNode = prevRuntimeForChain
              ? findFlowNode(row, prevRuntimeForChain.nodeId)
              : undefined;
            const prevChainTaskId = prevChainNode
              ? readTrimmedString(prevChainNode.data.taskId) ||
                readTrimmedString(prevChainNode.data.videoTaskId)
              : "";
            if (prevChainTaskId) videoData.sourcePrevTaskId = prevChainTaskId;
          } else {
            throw new AppError(
              `镜${pending.clipIndex} 声明 continuityMode=reference_video，但上一镜缺少真实成片 URL`,
              {
                status: 422,
                code: "clip_reference_video_source_missing",
                details: { clipIndex: pending.clipIndex, previousClipIndex: pending.clipIndex - 1 },
              },
            );
          }
        }
        // 动作迁移（kling-v3-omni）：本镜显式声明 videoReferType 时打通到 videoData。
        // 续写链默认把 sourceVideoUrl 设成「上一镜成片」（视频续写语义）；动作迁移要的是「外部示范视频」，
        // 二者冲突——故本镜给了显式 sourceVideoUrl 就覆盖续写源，并清掉 pixverse extend 的 sourcePrevTaskId。
        // 零回归：clip 未声明 videoReferType 则整段不触发，续写链逐字不变。
        {
          const clipReferType = readTrimmedString(clipForFrames?.videoReferType);
          if (clipReferType) {
            videoData.videoReferType = clipReferType;
            const motionRefVideo = readTrimmedString(clipForFrames?.sourceVideoUrl);
            if (motionRefVideo) {
              videoData.sourceVideoUrl = motionRefVideo;
              delete videoData.sourcePrevTaskId;
            }
            const keepSound = readTrimmedString(clipForFrames?.keepOriginalSound);
            if (keepSound) videoData.keepOriginalSound = keepSound;
          }
        }
        // 这里只携带结构化参考身份；权威 @图N 绑定延后到 generateVideoToCanvas 的最终媒体边界渲染。
        // 该边界位于 URL 净化、章节锚补绑、世界书注入之后，能保证提示词编号与真实 content[] 同序。
        {
          const boundRefs = Array.isArray(videoData.referenceImages)
            ? (videoData.referenceImages as string[])
            : [];
          const bindingUrls = [...new Set([
            ...boundRefs,
            ...clipRefEntries.map((entry) => entry.url),
            storyboardFirstFrameUrl,
            targetLastFrameUrl,
          ].filter(Boolean))];
          const referenceImageBindings: VideoReferenceImageBinding[] = bindingUrls.map((url) => {
            const label = refLabelByUrl.get(url) || "参考图";
            const purposes = refPurposesByUrl.get(url) ?? [
              referencePurposeForAssetKind(parseReferenceLabel(label).kind),
            ];
            const identity = referenceIdentityByUrl.get(url);
            return {
              url,
              label,
              purpose: purposes[0] ?? "other",
              purposes,
              sourceNodeIds: [...(sourceNodeIdsByUrl.get(url) ?? [])],
              ...(identity?.assetKind && identity.assetKind !== "other"
                ? { assetKind: identity.assetKind }
                : {}),
              ...(identity?.assetName ? { assetName: identity.assetName } : {}),
              ...(identity?.referenceRole ? { referenceRole: identity.referenceRole } : {}),
            };
          });
          videoData.referenceImageBindings = referenceImageBindings;
          if (chainRefVideoBound) {
            videoData.referenceVideoBindingNote =
              "参考视频=上一镜成片：本镜直接承接其结尾位置、姿态、服装状态、光线与场景方位，只取结尾状态与画风连续性，禁止重演已发生的动作或台词";
          } else if (!reAnchor) {
            videoData.referenceVideoBindingNote = "参考视频=上一镜成片";
          }
          // 完整 speechEvents → speakerBindings → 已物化配音卡是唯一音色链。
          // 缺卡、探测失败或供应商不支持必需音色时必须在 POST 前显式失败。
          if (generationContract.referenceAudioPolicy.maximumDurationSeconds > 0) {
            const ensuredVoiceBindings = await ensureClipVoiceBindings({ row, clip: clipForFrames });
            row = ensuredVoiceBindings.row;
            flowNodes = readFlowNodes(row);
            let voiceBindings = ensuredVoiceBindings.bindings;
            if (voiceBindings.length) {
              let durationRepair;
              try {
                durationRepair = await repairMissingVoiceDurations({
                  bindings: voiceBindings,
                  probeDuration: async (audioUrl) => {
                    const metadata = await probeMediaViaMediaWorker({ url: audioUrl });
                    const duration = Number(metadata?.durationSeconds);
                    return Number.isFinite(duration) && duration > 0 ? duration : null;
                  },
                });
              } catch (error) {
                throw new AppError(String((error as Error).message || error), {
                  status: 503,
                  code: "speaker_voice_asset_probe_failed",
                  details: { upstreamRequestAttempted: false },
                });
              }
              voiceBindings = durationRepair.bindings as ClipVoiceBinding[];
              if (durationRepair.patches.length > 0) {
                const persisted = await persistFlowPatch({
                  c: input.c,
                  row,
                  flowId: input.flowId,
                  requestUserId: input.requestUserId,
                  devBypass: input.devBypass,
                  ...(chapterId ? { chapterId } : {}),
                  affectedNodeIds: durationRepair.patches.map((patch) => patch.id),
                  patch: {
                    patchNodeData: durationRepair.patches,
                    allowOverwrite: true,
                  },
                });
                row = persisted.row;
                flowNodes = readFlowNodes(row);
              }
              videoData.voiceBinding = voiceBindings as unknown as Record<string, unknown>[];
              const audioAssetByCharacter = new Map<string, { voiceId: string; url: string; durationSec: number | null }>();
              for (const binding of voiceBindings) {
                audioAssetByCharacter.set(binding.character, {
                  voiceId: binding.voiceId,
                  url: binding.audioUrl,
                  durationSec: binding.audioDurationSec,
                });
              }
              const dialogAudio = await resolveClipDialogueAudioReferences({
                speakerNames: voiceBindings.map((binding) => binding.character),
                audioAssetByCharacter,
                referenceAudioPolicy: generationContract.referenceAudioPolicy,
              });
              videoData.referenceAudioUrls = dialogAudio.urls;
              videoData.prompt = bindVerifiedVoiceReferences(
                readTrimmedString(videoData.prompt) || clipPromptText,
                dialogAudio.bindingInstruction,
              );
              console.log(
                `[clip-dialog-audio] 镜${pending.clipIndex} 附音色参考×${dialogAudio.urls.length}（${dialogAudio.segments.map((segment) => `${segment.speaker}${typeof segment.durationSec === "number" ? segment.durationSec.toFixed(1) + "s" : ""}`).join("/")}）`,
              );
              console.log(
                `[clip-voice-binding] 镜${pending.clipIndex} ${voiceBindings.map((binding) => `音频=${binding.character}·${binding.voiceLabel}`).join("；")}`,
              );
            }
          } else if (structuredSpeakerNames.length > 0) {
            throw new AppError("当前模型不接受本次结构化说话人所需的音色参考", {
              status: 422,
              code: "speaker_reference_audio_unsupported",
              terminal: true,
              details: { upstreamRequestAttempted: false, nativeAudioSupported },
            });
          }
          // 【可观测性链路】把每镜解析出的资产绑定结构化写回节点 + 打日志 + 漂移诊断。
          // 此前绑定只以「裸 URL 列表 + prompt 自由文本」存在，无法从画布/日志看出每镜绑了谁、缺了谁。
          // assetBinding 让前端/查询能结构化看到「镜N=角色[齐夏,山羊头人]+场景[密室]+道具[座钟]」，
          // 诊断告警把「出镜角色无卡 / 无场景」这类漂移根因在提交时就暴露出来。
          try {
            const bindingEntries = boundRefs.map((u) => ({
              url: u,
              label: refLabelByUrl.get(u) || "参考图",
            }));
            const objectContracts = clipForFrames?.assetObjectContracts ?? [];
            const assetBinding = objectContracts.length > 0
              ? summarizeClipAssetContracts(objectContracts)
              : summarizeClipAssetBinding(bindingEntries);
            videoData.assetBinding = assetBinding as unknown as Record<string, unknown>;
            // 用确定性推导出的出场 cast（含从 node-id 回收 / 文本提及）做诊断 + 回写节点：
            // 让画布/QA 结构化看到「本镜出场谁」，不再依赖 LLM 是否手填 characterRoleNames。
            const onScreenRoleNames = deriveClipCharacterRoleNames(row, clipForFrames);
            if (onScreenRoleNames.length) {
              videoData.characterRoleNames = onScreenRoleNames;
            }
            const diags = diagnoseClipBinding({
              clipIndex: pending.clipIndex,
              binding: assetBinding,
              onScreenRoleNames,
              cap: generationContract.referenceImagePolicy.maximumBusinessImages,
              droppedCount: 0,
            });
            if (diags.length) {
              videoData.assetBindingDiagnostics = diags as unknown as Record<string, unknown>[];
            }
            console.log(
              `[clip-asset-binding] 镜${pending.clipIndex} 绑定：角色[${assetBinding.characters.join(",")}] 场景[${assetBinding.scenes.join(",")}] 道具[${assetBinding.props.join(",")}] 群像[${assetBinding.ensembles.join(",")}] 站位${assetBinding.blocking} 其它${assetBinding.other}（共${assetBinding.total}张）` +
                (diags.length ? ` ⚠️ ${diags.map((d) => d.code).join("/")}` : ""),
            );
          } catch (e) {
            console.warn(
              `[clip-asset-binding] summarize failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        // per-clip 提交失败处置【视频任务禁止自动重试·用户令 2026-07-10；分类细化 2026-07-14 ch25 复盘】：
        // · 上游 POST 已发出/可能已发出（upstreamSubmitUncertain）→ 首败即 submit_failed 终态——任务可能
        //   已在上游创建，盲重交=双倍扣费源头；重做由用户/agent 显式决定。
        // · ARK 确定性审核拒 → 首拒即终态（同参数重试必然同结果）。
        // · 上游 POST 之前的异常（校验/资产/presign/瞬时基建，未建任务未花钱）→ 原地重试至多 3 次，
        //   超限才标终态。分类逻辑见下方 catch 块。
        // 【在飞映射·提交前逐镜复查（2026-07-10 ch11重跑/ch12 实测双开第二根因）】驱动开头的
        // pre-pass 只查一次映射，但两条驱动循环各自串行跑数分钟——B 开跑时 A 还没提交后面的镜，
        // 等 B 走到镜 N 时 A 已提交（映射已有），B 却不再复查 → 每镜照样双开（ch11 重跑 10 镜 20 任务、
        // ch12 5 镜 11 任务实证）。此处在真正花钱提交前的最后一刻再查一次：命中＝放弃提交、
        // 把节点挂回已在飞任务交 reconcile 收口。
        const inflightTaskBeforeSubmit = await getClipInflightTask(plan.runId, pending.clipIndex);
        if (inflightTaskBeforeSubmit) {
          const reattachData: Record<string, unknown> = {
            kind: "video",
            label: buildClipNodeLabel(plan.clips[pending.clipIndex], pending.clipIndex, clipPlan.length),
            clipRunId: plan.runId,
            clipIndex: pending.clipIndex,
            durationSeconds: pending.durationSeconds,
            status: "running",
            taskId: inflightTaskBeforeSubmit,
            videoTaskId: inflightTaskBeforeSubmit,
            reattachedFromInflightMap: true,
          };
          try {
            const persistedRe = await persistFlowPatch({
              c: input.c,
              row,
              flowId: input.flowId,
              requestUserId: input.requestUserId,
              devBypass: input.devBypass,
              ...(chapterId ? { chapterId } : {}),
              affectedNodeIds: [pending.nodeId],
              patch: findFlowNode(row, pending.nodeId)
                ? ({ patchNodeData: [{ id: pending.nodeId, data: reattachData }], allowOverwrite: true } as never)
                : ({ createNodes: [{ id: pending.nodeId, type: "taskNode", position: { x: 0, y: 0 }, data: reattachData }] } as never),
            });
            row = persistedRe.row;
          } catch {
            // 重挂写画布失败也绝不提交（防双开优先级高于节点可见性；下轮 reconcile/orphan 恢复兜底）
          }
          console.log(
            `[clip-inflight] runId=${plan.runId} 镜${pending.clipIndex} 提交前发现已在飞任务 ${inflightTaskBeforeSubmit}，放弃重复提交并重挂（防双开双扣费）`,
          );
          state = "video_running";
          nextStep = `clip ${pending.clipIndex} already in flight (${inflightTaskBeforeSubmit}); reattached instead of resubmitting and will be reconciled by the next synchronous cycle.`;
        } else {
        // ARK (seedance) 无法从 TOS public origin 下载图片；转 TOS S3 预签名 URL。
        const arkPresignMap = await presignVideoFrameUrlsForArk(videoData, input.c.env);
        let submitError: unknown = null;
        try {
          await generateVideoToCanvas({
            c: input.c,
            requestUserId: input.requestUserId,
            devBypass: input.devBypass,
            flowId: input.flowId,
            row,
            ...(chapterId ? { chapterId } : {}),
            bodyArgs: {
              node: { type: "taskNode", position: { x: 0, y: 0 }, data: videoData },
            },
          });
        } catch (e) {
          submitError = e;
        }
        if (submitError) {
          const emsg = submitError instanceof Error ? submitError.message : String(submitError);
          const submitErrorCode = readVideoSubmitErrorCode(submitError);
          const submitErrorDetails =
            submitError && typeof submitError === "object" && !Array.isArray(submitError) &&
            (submitError as Record<string, unknown>).details &&
            typeof (submitError as Record<string, unknown>).details === "object" &&
            !Array.isArray((submitError as Record<string, unknown>).details)
              ? (submitError as Record<string, unknown>).details
              : undefined;
          if (submitErrorCode && isVideoAssetRepairErrorCode(submitErrorCode)) {
            return await returnAssetRepairRequired({
              reasonCode: submitErrorCode,
              message: emsg,
              details: submitErrorDetails,
            });
          }
          // 音色参考只允许在明确的 pre-upstream 失败后剥离重提一次；若错误发生在
          // 已提交/不确定边界，保留原回执等待 reconcile，绝不以“降级”为名双开付费任务。
        }
        if (!submitError) {
          state = "video_running";
          nextStep = `clip ${pending.clipIndex} submitted; the synchronous run driver must wait for a provider terminal state before the next cycle`;
        } else {
          // 提交失败：记录尝试次数到 canvas 节点，超限后标永久拒绝避免无限重试。
          const errMsg = submitError instanceof Error ? submitError.message : String(submitError);
          const existingNode = findFlowNode(row, pending.nodeId);
          const prevAttempts = Number(
            (existingNode?.data as Record<string, unknown> | undefined)?.clipSubmitAttempts ?? 0,
          );
          const capacityBackpressure = isVideoSubmitCapacityBackpressure(submitError);
          const newAttempts = capacityBackpressure ? prevAttempts : prevAttempts + 1;
          // 【确定性 400 fail-fast·2026-07-04 ch3 实测】ARK 内容审核拒 = 同参数重试必然同结果
          // （实测同一张被拒图盲重试 4 次、每次白等 ~25s 审核轮询）。审核拒一律首拒即永久，
          // 逼调用方先换掉被拒资产再重跑，而不是烧时间烧审核配额。
          const isDeterministicModerationReject =
			readVideoSubmitRejectedUrls(submitError).length > 0 || errMsg.includes("内容审核未通过");
          // 【pre-POST 瞬时异常可重试·2026-07-14 ch25 复盘】generate-video-to-canvas 在上游 POST 边界
          // 打 upstreamSubmitUncertain 标记：无标记 = 错误发生在 POST 之前（校验/资产/presign/瞬时基建），
          // 未建任务未花钱——「首败即终态」防的是花钱后的盲重交，不适用于这类失败。给 3 次原地重试；
          // 有标记（任务可能已创建）或确定性审核拒仍旧首败即永久。ch25 实测：镜10 pre-POST 瞬时异常
          // 15:08 原样提交即成功，却被判永久拒 → 人工复活×3、全 run 停摆 ~60min。
          const upstreamUncertain = Boolean(
            submitError &&
              typeof submitError === "object" &&
              (submitError as Record<string, unknown>).upstreamSubmitUncertain === true,
          );
          const MAX_PRESUBMIT_RETRIES = 3;
          const retryablePreSubmit =
            capacityBackpressure ||
            (!upstreamUncertain &&
              !isDeterministicModerationReject &&
              newAttempts < MAX_PRESUBMIT_RETRIES);
          const permanent = !retryablePreSubmit;
          // 【失败可归因·2026-07-04 ch3 实测】被拒参考图对应的节点 id 直接写进 clipSubmitError，
          // run 级 error_message / status 响应 / 小T 自愈都能一眼看到"哪张图挂的"（此前只有
          // 「某段视频生成失败」，排障要人肉翻容器日志逐张比图）。
          const rejectedNodeIdsForError = collectArkModerationRejectedNodeIds(
            row,
            submitError,
            arkPresignMap,
          );
          const attributedErrMsg = rejectedNodeIdsForError.length
            ? `${errMsg}（被拒参考图节点: ${rejectedNodeIdsForError.join("、")}——请修改/重生成这些图后再重跑）`
            : errMsg;
          const failNodeData: Record<string, unknown> = {
            kind: "video",
            label: buildClipNodeLabel(
              plan.clips[pending.clipIndex],
              pending.clipIndex,
              clipPlan.length,
            ),
            clipRunId: plan.runId,
            clipIndex: pending.clipIndex,
            durationSeconds: pending.durationSeconds,
            // submit_retrying 不是终态：resolveClipVideoRuntime 映射为 absent → 下 tick 自然重提。
            // failed/submit_failed 都是终态（禁自动重试铁律），只给不可重试的失败。
            status: capacityBackpressure
              ? "submit_waiting_capacity"
              : permanent
                ? "submit_failed"
                : "submit_retrying",
            clipSubmitAttempts: newAttempts,
            clipSubmitError: attributedErrMsg,
            clipSubmitErrorCode: readVideoSubmitErrorCode(submitError),
            clipSubmitPhase: upstreamUncertain
              ? "upstream_uncertain"
              : isDeterministicModerationReject
                ? "deterministic_reject"
                : "pre_upstream",
          };
          try {
            const persisted = await persistFlowPatch({
              c: input.c,
              row,
              flowId: input.flowId,
              requestUserId: input.requestUserId,
              devBypass: input.devBypass,
              ...(chapterId ? { chapterId } : {}),
              affectedNodeIds: [pending.nodeId],
              patch: existingNode
                ? ({ patchNodeData: [{ id: pending.nodeId, data: failNodeData }], allowOverwrite: true } as never)
                : ({ createNodes: [{ id: pending.nodeId, type: "taskNode", position: { x: 0, y: 0 }, data: failNodeData }] } as never),
            });
            row = persisted.row;
          } catch {
            // 回写失败不影响运行流，下轮重试时仍会重建节点。
          }
          // ARK 审核被拒：把被拒的参考图节点逐个标红（moderationRejected 落到节点 data，
          // 前端据此加红框）。逐张审核 → data.rejected_urls 携带全部被拒 URL，见 new-api。
          const rejectedNodeIds = rejectedNodeIdsForError;
          if (rejectedNodeIds.length) {
            const moderationReason = submitError instanceof Error ? submitError.message : "内容审核未通过";
            try {
              const persistedMod = await persistFlowPatch({
                c: input.c,
                row,
                flowId: input.flowId,
                requestUserId: input.requestUserId,
                devBypass: input.devBypass,
                ...(chapterId ? { chapterId } : {}),
                affectedNodeIds: rejectedNodeIds,
                patch: {
                  patchNodeData: rejectedNodeIds.map((rid) => ({
                    id: rid,
                    data: { moderationRejected: true, moderationRejectedReason: moderationReason },
                  })),
                  allowOverwrite: true,
                } as never,
              });
              row = persistedMod.row;
            } catch {
              // 标红回写失败不影响运行流。
            }
          }
          // 把本镜最新结果同步进本次返回的 clips 快照——clips 是提交尝试【之前】构建的（本镜还是
          // absent），不回填的话 run-driver 的失败归因提不到镜号/原因，只能落泛化的「某段视频生成失败」
          // （ch25 实测 14:08 status 只有裸 video_failed，小T 被迫 flow_search 摸排）。
          const clipSnapshot = clips.find((cl) => cl.clipIndex === pending.clipIndex);
          if (clipSnapshot) {
            clipSnapshot.error = attributedErrMsg;
            if (permanent) {
              clipSnapshot.status = "submit_failed";
              clipSnapshot.nextAction = "done";
            }
          }
          if (permanent) {
            // 【单镜失败不连坐·2026-07-14 ch25 复盘】旧行为：这里直接 state=video_failed → run-driver
            // 把整条 run 打进 failed 终态，其余 8 个可推进镜全部陪跪等人工复活（ch25 生成段 104min 里
            // ~60min 是停摆）。改为：只要还有其他可推进的镜（running / 可提交 / 链上游未死的等待镜），
            // 本镜标 submit_failed 后继续推其余镜；全部镜到达终态后由聚合逻辑收口成 video_failed，
            // 那时 clips[] 带着每个失败镜的归因浮出。「禁自动重试」铁律不变：本镜不会被再碰。
            const deadIdx = new Set(
              clips
                .filter((cl) => cl.status === "failed" || cl.status === "submit_failed")
                .map((cl) => cl.clipIndex),
            );
            deadIdx.add(pending.clipIndex);
            const chainBlockedByDead = (clipIndex: number): boolean => {
              // 沿续写链上溯：父链上有终失败镜 = 该镜永远等不到前序，不算「可推进」。
              let cur = clipPlan[clipIndex];
              const guard = new Set<number>();
              while (cur && cur.expectedPrevClipIndex != null && !guard.has(cur.clipIndex)) {
                guard.add(cur.clipIndex);
                if (deadIdx.has(cur.expectedPrevClipIndex)) return true;
                cur = clipPlan[cur.expectedPrevClipIndex];
              }
              return false;
            };
            const othersActionable = clips.some(
              (cl) =>
                cl.clipIndex !== pending.clipIndex &&
                !deadIdx.has(cl.clipIndex) &&
                (cl.status === "running" ||
                  cl.nextAction === "submit_video" ||
                  (cl.nextAction === "await_previous_clip" && !chainBlockedByDead(cl.clipIndex))),
            );
            if (othersActionable) {
              state = "video_running";
              nextStep = `clip ${pending.clipIndex} permanently rejected after ${newAttempts} attempts (${attributedErrMsg.slice(0, 220)}); marked submit_failed. 其余镜继续推进；该镜等用户/agent 检视后 replaceAtIndex 重灌或复活。`;
            } else {
              state = "video_failed";
              nextStep = `clip ${pending.clipIndex} permanently rejected after ${newAttempts} attempts (${attributedErrMsg.slice(0, 220)}); marked submit_failed`;
            }
          } else {
            // 套餐并发容量不足是结构化背压：不消耗提交次数、不标失败，等待容量释放后由同步 driver 下一 cycle 提交。
            // 其他 pre-POST 瞬时异常仍按有限次数重试（未建任务未花钱，不违反禁重试铁律）。
            state = "video_running";
            nextStep = capacityBackpressure
              ? `clip ${pending.clipIndex} waiting for subscription concurrency capacity; no upstream task created and submit attempts unchanged`
              : `clip ${pending.clipIndex} submit failed before upstream POST (attempt ${newAttempts}/${MAX_PRESUBMIT_RETRIES}): ${errMsg.slice(0, 120)}; will retry in the next synchronous drive cycle`;
          }
        }
        } // 提交前在飞复查 else 块结束（命中在飞任务时整段提交逻辑被跳过）
      }
    }
  } else {
    nextStep = "plan computed (dry-run); submit the complete BeatSheet through loop, then let start drive synchronously";
  }

  let masterVideoUrl = "";
  let finishingVerification: VideoFinishingTechnicalVerification | undefined;
  if (
    mode === "drive" &&
    state === "concatenated" &&
    concatVideoUrl &&
    plan.finishingContract
  ) {
    const finishing = await driveVideoFinishing({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      chapterId,
      plan,
    });
    if (finishing.state === "success") {
      state = "finished";
      masterVideoUrl = finishing.masterVideoUrl;
      finishingVerification = finishing.verification;
      driveAction = "noop";
      nextStep = finishing.verification.satisfied
        ? "commercial finishing master completed and technical contract verified"
        : `commercial finishing master generated and preserved; technical verification reported ${finishing.verification.missingCriteria.join(",")}`;
    } else if (finishing.state === "failed") {
      state = "finishing_failed";
      driveAction = "noop";
      nextStep = `commercial finishing failed; source concat preserved: ${finishing.error}`;
    } else {
      state = "finishing_running";
      driveAction = "finish";
      nextStep = finishing.action === "submit"
        ? "commercial finishing task accepted; source concat preserved"
        : finishing.action === "verify"
          ? "commercial finishing asset generated; awaiting non-destructive media probe evidence"
        : "commercial finishing task reconciled; await durable master evidence";
    }
  }

  let statusProjection: VideoRunStatusProjection | undefined;
  let narrativeVerification: VideoNarrativeDeliveryVerification | undefined;
  let finalMediaProbe: Awaited<ReturnType<typeof probeMediaViaMediaWorker>> | undefined;
  const finalDeliveryUrl = masterVideoUrl || concatVideoUrl;
  if (
    mode === "drive" &&
    finalDeliveryUrl &&
    (state === "finished" || (state === "concatenated" && !plan.finishingContract))
  ) {
    try {
      finalMediaProbe = await probeMediaViaMediaWorker({
        url: finalDeliveryUrl,
        timeoutMs: resolveFinalMediaProbeTimeoutMs(plan.targetDurationSeconds),
      }) ?? undefined;
    } catch (error: unknown) {
      console.error(
        `[video-delivery-probe] runId=${plan.runId} final asset probe failed; asset preserved: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const completedRun = await getVideoRun(plan.runId);
    if (completedRun) {
      let persistedEvidenceNodes: Array<Record<string, unknown>> | null = null;
      try {
        const evidenceRow = await freshReadFlowRow({
          c: input.c,
          flowId: input.flowId,
          requestUserId: input.requestUserId,
          devBypass: input.devBypass,
          ...(chapterId ? { chapterId } : {}),
        });
        persistedEvidenceNodes = readFlowNodes(evidenceRow);
      } catch (error: unknown) {
        console.error(
          `[video-narrative-delivery] persisted evidence read failed runId=${plan.runId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      let persistedBeatSheet: unknown = null;
      try {
        persistedBeatSheet = completedRun.beat_sheet
          ? JSON.parse(completedRun.beat_sheet) as unknown
          : null;
      } catch {
        persistedBeatSheet = null;
      }
      narrativeVerification = buildVideoNarrativeDeliveryVerification({
        runId: plan.runId,
        chapterId: completedRun.chapter_id || chapterId,
        nodes: persistedEvidenceNodes,
        concatPolicy: sourceConcatPolicy,
        beatSheet: persistedBeatSheet,
        storyPlan: plan,
        storyPlanDurationSeconds: plan.targetDurationSeconds,
      });
      if (!narrativeVerification.satisfied) {
        nextStep = `final asset generated and preserved; narrative delivery verification is unsatisfied: ${narrativeVerification.missingCriteria.join(",")}`;
      }
      try {
        statusProjection = await upsertVideoRunStatusNode({
          c: input.c,
          runId: plan.runId,
          runCreatedAt: completedRun.created_at,
          ownerId: input.requestUserId,
          flowId: input.flowId,
          chapterId,
          authoringState: "authoring_done",
          productionState: "concatenated",
          videoUrl: finalDeliveryUrl,
          statusLine: state === "finished"
            ? finishingVerification?.satisfied
              ? `✅ 商业母版已完成并通过技术核验；拼接源片保留，最终母版：${finalDeliveryUrl}`
              : `⚠️ 商业母版资产已生成并保留，但技术核验存在偏差：${finishingVerification?.missingCriteria.join("、") || "缺少核验证据"}。母版：${finalDeliveryUrl}`
            : finalMediaProbe
              ? `✅ 整章成片已完成，全部 clip 已按 clipIndex 合成并获得媒体探测证据。成片：${finalDeliveryUrl}`
              : `⚠️ 整章成片已生成并保留，媒体探测证据暂缺。成片：${finalDeliveryUrl}`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        projectionDiagnostics.push(`run_status_projection_failed: ${message}`);
        console.error(
          `[video-canvas-projection] run status projection failed; backend delivery preserved runId=${plan.runId}: ${message}`,
        );
      }
    } else {
      console.error(`[video-run-status] run ${plan.runId} 已成片但持久 run 不存在，无法更新画布投影`);
    }
  }

  return {
    ok: true,
    runId: plan.runId,
    state,
    mode,
    targetDurationSeconds: plan.targetDurationSeconds,
    videoModel: plan.videoModel,
    generationContract,
    durationOptions,
    clipPlan,
    clips,
    concatNodeIds,
    allClipsSucceeded: allSucceeded,
    ...(mode === "drive" ? { driveAction } : {}),
    ...(concatVideoUrl ? { concatVideoUrl } : {}),
    ...(masterVideoUrl ? { masterVideoUrl } : {}),
    ...(finishingVerification ? { finishingVerification } : {}),
    ...((narrativeVerification || finalMediaProbe)
      ? {
          deliveryEvidence: {
            ...(narrativeVerification ? { narrativeVerification } : {}),
            ...(finalMediaProbe ? { finalMediaProbe } : {}),
          },
        }
      : {}),
    ...(statusProjection ? { statusProjection } : {}),
    ...(projectionDiagnostics.length ? { projectionDiagnostics } : {}),
    nextStep,
  };
}
