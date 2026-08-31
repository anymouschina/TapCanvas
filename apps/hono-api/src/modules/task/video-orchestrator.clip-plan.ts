import { createHash } from "node:crypto";
import {
  readClipContinuityMode,
  type ClipContinuityMode,
} from "./video-orchestrator.continuity-contract";
import { partitionVideoDurationExact } from "./video-duration-partition";

/**
 * 多段视频成片的「确定性 ClipPlan」核心纯函数。
 *
 * 设计目标：把时长拆段、稳定 clipId/slot 派生从 LLM(SKILL 软规则) 下沉到服务端代码，
 * 让"怎么安全、唯一、按序地拍完"由代码 enforce。详见
 * docs/design/video-orchestrator-refactor.md。
 *
 * 本文件只含纯函数，无 IO / 无副作用，便于单测且不触发任何真实生成。
 */

type ClipPlanSlotIdentity = {
  clipIndex: number;
  /** 服务端定的本段生成时长（秒）：前 N-1 段=模型 max，末段=余量 snap 合法档。 */
  durationSeconds: number;
  /** 稳定派生的画布节点 id（slot）。同一 runId+clipIndex 永远映射同一 id。 */
  nodeId: string;
  /** `${runId}:clip:${clipIndex}` */
  clipId: string;
};

/**
 * BeatSheet 产生前的纯时长槽位。它只回答“目标时长需要几个合法 clip”，
 * 不声称已经裁决任何剪辑缝，也绝不能进入 drive/start。
 */
export type ClipTimingPlanItem = ClipPlanSlotIdentity & {
  continuityTopology: "unresolved";
};

/** BeatSheet 冻结后的可执行 ClipPlan；每段都带 agents 显式连续性裁决。 */
export type ClipPlanItem = ClipPlanSlotIdentity & {
  continuityTopology: "resolved";
  continuityMode: ClipContinuityMode;
  /** 仅 continuityMode=reference_video 时为 clipIndex-1；其余为 null。 */
  expectedPrevClipIndex: number | null;
};

/** `${runId}:clip:${index}` —— 服务端唯一真相源，不接受 LLM 随机 nodeId 当 slot。 */
export function buildClipId(runId: string, clipIndex: number): string {
  return `${runId}:clip:${clipIndex}`;
}

/**
 * 由 clipId 确定性派生画布节点 id（slot）。同一 clipId 永远得到同一 nodeId，
 * 这是幂等防重的基石：LLM 不能用随机 nodeId 制造 `-rerun` slot。
 */
export function deriveClipNodeId(clipId: string): string {
  const hash = createHash("sha1").update(clipId).digest("hex").slice(0, 24);
  return `vclip-${hash}`;
}

/**
 * 拆段语态：决定镜间是否续写、每段时长单位。**2026-06-22 用户拍板「一个故事板＝一个视频」后：**
 * - **`cut`（缺省默认）**：一个场景＝一条 ≈maxDur(~15s) 多镜镜头表 clip，走 reference_images
 *   （角色卡/场景卡作 @图N 参考图），模型在一条视频里**内部切多镜**；镜间独立、并行生成、一次拼接，
 *   **不接尾帧、不传 sourceVideoUrl、无 gemini 彩色关键帧**。叙事/小说/漫剧/绝大多数片走这条。
 * - `montage`：切碎优先（单位=最小档，最多最短镜），也重锚、镜间独立；是否适合当前叙事
 *   由 agents 的创作判断负责，Hono 不基于角色绑定做风格拦截。
 * - `continuous`：**逃生口·非默认**——仅一段连续动作物理上 >单镜上限(~15s) 一条装不下时用，
 *   链式续写（clip≥1 首帧=上一镜尾帧·串行），拉满 maxDur。
 *
 * 缺省（undefined）＝ 默认 cut（多镜镜头表）。详见 docs/design/video-orchestrator-refactor.md。
 */
export type EditingStyle = "montage" | "continuous" | "cut";

/**
 * 把目标总时长拆成每段时长。优先级（高→低）：
 *  1. **显式分镜时长 `explicitDurations`**（LLM 导演产出）：尊重它，定段数+每段时长，
 *     每段 snap 到 durationOptions 最近合法档。导演完全掌控镜头数与节奏。
 *  2. **`editingStyle` 自动拆**：montage=单位取最小档（快切毯）；cut/continuous/缺省=单位取最大档
 *     （拉满 maxDur——cut 每场景一条 ≈15s 多镜长镜、模型内部切镜，不再切成 5s 短镜）。
 * 全部数据驱动，durationOptions（取自 modelCatalog.videoOptions.durationOptions）是唯一真相源，
 * 禁止写死 15/10/5。
 */
export function computeClipDurations(input: {
  targetDurationSeconds: number;
  durationOptions: number[];
  /** LLM 显式分镜时长（每段秒数）。给了就必须已经命中合法档位，禁止在生产阶段吸附。 */
  explicitDurations?: number[];
  /** 拆段语态；缺省 cut（多镜镜头表·拉满 maxDur·镜间独立）。仅 montage 取最小档切碎。 */
  editingStyle?: EditingStyle;
}): number[] {
  const options = Array.from(
    new Set(
      input.durationOptions
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b);
  if (options.length === 0) {
    throw new Error("video_generation_duration_options_missing");
  }

  // —— 路径①：显式分镜时长必须与 writer/critic 审核时使用的离散合同完全一致。
  const explicit = (input.explicitDurations ?? [])
    .map((n) => Math.trunc(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (explicit.length > 0) {
    const invalid = explicit.filter((duration) => !options.includes(duration));
    if (invalid.length > 0) {
      throw new Error(
        `video_generation_explicit_duration_invalid:${invalid.join(",")}:allowed=${options.join(",")}`,
      );
    }
    return explicit;
  }

  // —— 路径②：按语态精确拆分。montage 在精确命中总时长的前提下尽量多用短档；
  // cut/continuous/缺省在精确命中总时长的前提下尽量少提交、优先吃满最大档。
  // 禁止把 24s 静默吸附为 25s，也禁止把小于模型最短档的目标向上取整。
  return partitionVideoDurationExact({
    targetDurationSeconds: input.targetDurationSeconds,
    durationOptions: options,
    preference: input.editingStyle === "montage" ? "shortest_first" : "longest_first",
  });
}

/**
 * 本镜是否「重锚自己的锚定卡/故事板」——2026-07-06 用户拍板后：**永远重锚**。
 *
 * 旧行为：显式 `continuous` 的 clip≥1 接上一镜尾帧+喂上一镜成片作 reference_video 串行续写。
 * 用户禁令（2026-07-06）：①视频输入只有「复刻」好用、「续写」不好用——禁止把上一镜视频
 * 作输入续写；②全片段间必须并发独立、允许各镜换视角，禁止任何串行依赖。
 * 段间连续性只靠文字层 exitState 状态接力（buildExitStateRelayNote·带防重演措辞）。
 * 保留函数签名（调用点零改动），editingStyle 参数仅为兼容。
 */
export function shouldReanchorClipFirstFrame(
  _clipIndex: number,
  _editingStyle?: EditingStyle,
): boolean {
  return true;
}

/**
 * 节奏溢出检测（实测发现：导演给每镜 2~3s，但 seedance 单镜最小档=4s，逐段 snap 抬上去后
 * 7 镜×4s=28s 远超 15s 目标）。当实拍总时长比目标多出 ≥ 一个最小档（即至少多了一整镜）时，
 * 返回告警文案给导演——不丢镜、不静默超时，把"模型单镜下限做不出 2-3s 快切"这个约束摊开。
 * 正常的末段补余溢出（如 16s vs 15s 目标，仅多 1s）不触发。
 */
export function detectPacingOvershoot(input: {
  targetDurationSeconds: number;
  realizedDurations: number[];
  durationOptions: number[];
}): string | null {
  const options = Array.from(
    new Set(
      input.durationOptions
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b);
  if (options.length === 0) return null;
  const minDur = options[0]!;
  const realized = input.realizedDurations.reduce((s, d) => s + (Number(d) || 0), 0);
  const target = Math.max(1, Math.trunc(input.targetDurationSeconds));
  if (realized <= target + minDur) return null;
  const suggestedClips = Math.max(1, Math.round(target / minDur));
  return (
    `节奏溢出：本片 ${input.realizedDurations.length} 镜按模型单镜最小档 ${minDur}s 实拍合计 ${realized}s，` +
    `超过目标 ${target}s（该视频模型单镜最短 ${minDur}s，做不出 2~3s 的超短快切）。` +
    `要么把镜数减到约 ${suggestedClips} 镜（每镜 ${minDur}s），要么把目标时长上调到 ~${realized}s。`
  );
}

/**
 * realized 计划「显性化」摘要（estimate 恒附、纯加法、无 flag、不改任何行为）。
 *
 * 治本次故障：小T 选了 `montage` 又没给 `durationSeconds`，片被碎成一堆均匀 4s 镜，**总时长没超标**
 * （`detectPacingOvershoot` 不触发）、montage 又是合法决策（`hasPacingDecision` 放行）——两闸都漏，
 * 没有任何信号告诉小T/用户"你把一段本该少而长的连贯叙事碎成了快切毯"。此函数把"几镜 × 各多长 ×
 * 什么语态"摊开成一句话，让 estimate 阶段就看见后果。纯只读，不拦不改。
 */
export function buildRealizedPlanSummary(input: {
  realizedDurations: number[];
  editingStyle?: EditingStyle;
  /** 是否走了「显式逐镜 durationSeconds」路径（导演完全掌控）。 */
  explicit?: boolean;
}): string {
  const durs = input.realizedDurations.map((d) => Math.trunc(Number(d) || 0));
  const total = durs.reduce((s, d) => s + d, 0);
  const voiceLabel = input.explicit
    ? "显式 durationSeconds（导演逐镜定时）"
    : input.editingStyle === "montage"
      ? "montage（每镜最短·均匀快切）"
      : input.editingStyle === "continuous"
        ? "continuous（拉满连续长镜·>15s 逃生口·串行）"
        : "cut（独立多镜镜头表·并行生成·一次拼接·默认）";
  return `当前 ${durs.length} 镜 × [${durs.join(",")}]s 共 ${total}s（语态=${voiceLabel}）。`;
}

/**
 * montage「碎毯」软告警（新纯函数，由调用方在 flag `VIDEO_PACING_CARPET_WARN` ON 时附加）。
 *
 * 仅当 ① 语态=montage ② 每镜都被切成最小档(minDur) ③ 镜数 ≥ 阈值(默认 4) 才返回告警——即一段
 * 本该「少而长连贯叙事」被 montage 碎成均匀最短快切毯（实测故障：6×4s 拼接）。与 `detectPacingOvershoot`
 * 正交：那个管「碎切到总时长超标」，这个管「碎而不超时的过度碎切」。**只软提醒、不硬拦**（避免误伤
 * 真要快切的时尚大片/MV/广告）。continuous / 显式时长 / 镜数不足阈值一律返回 null（逐字等价旧行为）。
 */
export function detectMontageCarpet(input: {
  editingStyle?: EditingStyle;
  realizedDurations: number[];
  durationOptions: number[];
  /** 触发的最小镜数阈值，缺省 4。 */
  minClips?: number;
}): string | null {
  if (input.editingStyle !== "montage") return null;
  const options = Array.from(
    new Set(
      input.durationOptions
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b);
  if (options.length === 0) return null;
  const minDur = options[0]!;
  const durs = input.realizedDurations.map((d) => Math.trunc(Number(d) || 0));
  const threshold = Math.max(2, Math.trunc(input.minClips ?? 4));
  if (durs.length < threshold) return null;
  if (!durs.every((d) => d === minDur)) return null;
  return (
    `montage 已把本片碎成 ${durs.length} 个最短 ${minDur}s 镜（均匀快切毯）。` +
    `若你要的是"少而长的连贯叙事段"，请改 editingStyle:'cut' 并给每镜显式 ` +
    `durationSeconds=[...]（如 2~4 个 8~12s 中长镜，段间由 exitState 状态接力衔接）。` +
    `确属时尚大片/MV/广告快切蒙太奇则忽略本提示。`
  );
}

/**
 * 【镜长均匀性软告警】「全片均匀一条线=单调/PPT 病根」是知识卡铁律（pacing-shot-length-speech-rate）
 * 但从无机检。≥minClips（默认 6）镜且全部时长落在同一 2s 窗（max−min≤2）→ 告警。
 * montage 由 detectMontageCarpet 专管，此处跳过；返回 null=无告警（逐字等价旧行为）。
 */
export function detectDurationUniformity(input: {
  editingStyle?: EditingStyle;
  realizedDurations: number[];
  minClips?: number;
}): string | null {
  if (input.editingStyle === "montage") return null;
  const durs = input.realizedDurations
    .map((d) => Math.trunc(Number(d) || 0))
    .filter((d) => d > 0);
  const threshold = Math.max(4, Math.trunc(input.minClips ?? 6));
  if (durs.length < threshold) return null;
  const max = Math.max(...durs);
  const min = Math.min(...durs);
  if (max - min > 2) return null;
  return (
    `全片 ${durs.length} 镜时长均匀（${min}~${max}s 同档）——镜长均匀一条线=单调/PPT 病根（知识卡 视听语言演出/pacing-shot-length-speech-rate）。` +
    `按节拍的节奏角色拉开对比：动作/冲击镜短档 4-6s、叙事/对白镜长档 6-12s、抽空/呼吸镜给足时长；` +
    `高潮/冲击镜应显著短于铺垫镜。确属有意的匀速蒙太奇可忽略本提示。`
  );
}

/**
 * 从创意分段提取「全片显式分镜时长」：要么**每段**都给了正 `durationSeconds`（返回逐段秒数数组，
 * 用于驱动 computeClipDurations 的显式路径），要么返回 undefined（回退 editingStyle/拉满）。
 * 全片 all-or-nothing：避免半数有时长半数没有导致段数/位置错位。
 */
export function extractExplicitClipDurations(
  clips: ReadonlyArray<{ durationSeconds?: number }>,
): number[] | undefined {
  if (clips.length === 0) return undefined;
  const ok = clips.every(
    (c) => typeof c.durationSeconds === "number" && c.durationSeconds > 0,
  );
  return ok ? clips.map((c) => c.durationSeconds as number) : undefined;
}

/** snap 到 options 中 ≥ 的最近合法档；若都比它大则取最小档；若都比它小则取最大档。 */
export function snapToNearestOption(value: number, sortedOptions: number[]): number {
  if (sortedOptions.length === 0) return Math.max(1, Math.trunc(value));
  for (const opt of sortedOptions) {
    if (opt >= value) return opt;
  }
  return sortedOptions[sortedOptions.length - 1]!;
}

type ClipTimingPlanInput = {
  runId: string;
  targetDurationSeconds: number;
  durationOptions: number[];
  /** LLM 显式分镜时长（每段秒数）；给了就定段数+每段时长。 */
  explicitDurations?: number[];
  /** 拆段语态；缺省 cut（多镜镜头表·拉满·镜间独立并行）。 */
  editingStyle?: EditingStyle;
};

function buildClipPlanSlotIdentities(input: ClipTimingPlanInput): ClipPlanSlotIdentity[] {
  const durations = computeClipDurations({
    targetDurationSeconds: input.targetDurationSeconds,
    durationOptions: input.durationOptions,
    ...(input.explicitDurations ? { explicitDurations: input.explicitDurations } : {}),
    ...(input.editingStyle ? { editingStyle: input.editingStyle } : {}),
  });
  return durations.map((durationSeconds, clipIndex) => {
    const clipId = buildClipId(input.runId, clipIndex);
    return {
      clipIndex,
      durationSeconds,
      clipId,
      nodeId: deriveClipNodeId(clipId),
    };
  });
}

/**
 * 构建 BeatSheet 前的纯时长槽位。这里只允许计算数量、合法时长与稳定 slot；
 * 不接收 continuityModes，也不为尚未发生的 agents 语义裁决填写默认值。
 */
export function buildClipTimingPlan(input: ClipTimingPlanInput): ClipTimingPlanItem[] {
  return buildClipPlanSlotIdentities(input).map((slot) => ({
    ...slot,
    continuityTopology: "unresolved",
  }));
}

/**
 * 构建 BeatSheet 冻结后的完整执行 ClipPlan。durationOptions 由调用方从 modelCatalog
 * （或 enabledVideoModels 入参）提供，本函数不读 IO。
 */
export function buildClipPlan(input: ClipTimingPlanInput & {
  /** 与每段一一对应的唯一连续性合同；禁止从 editingStyle 或旧 chaining flags 推导。 */
  continuityModes: readonly unknown[];
}): ClipPlanItem[] {
  const slots = buildClipPlanSlotIdentities(input);
  if (input.continuityModes.length !== slots.length) {
    throw new Error(
      `video_continuity_topology_mismatch:clips=${slots.length}:modes=${input.continuityModes.length}`,
    );
  }
  const continuityModes = input.continuityModes.map((value, clipIndex) => {
    const mode = readClipContinuityMode(value);
    if (!mode) {
      throw new Error(`video_continuity_mode_invalid:clip=${clipIndex}`);
    }
    return mode;
  });
  return slots.map((slot, clipIndex) => {
    const continuityMode = continuityModes[clipIndex]!;
    const chained = continuityMode === "reference_video";
    return {
      ...slot,
      continuityTopology: "resolved",
      continuityMode,
      expectedPrevClipIndex: chained && clipIndex > 0 ? clipIndex - 1 : null,
    };
  });
}
