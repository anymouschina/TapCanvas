// 【音色参考音频·Seedance 原生台词生成】
// 用户拍板（2026-07-04 v2，取代同日「台词全文 TTS」方案）：喂给视频模型的参考音频**只是音色参考**，
// 不承载台词内容——每个出场说话角色附一条 2~4s 的短音色样本（配音卡音色 + 固定中性文本合成，按
// 配音卡的真实音频资产），台词本身留在 clipPrompt 镜头表里，由本轮冻结的 Seedance 模型用对应
// 音色自行念白 + 对口型。
//
// 为什么废弃台词全文 TTS：短台词组（如「请便。」）合成音频 <1.8s，ARK r2v 硬性下限直接 400
// （"audio duration must be >= 1.8 for doubao-seedance-2-0 in r2v"），单镜参数错导致整 run failed
// （ch3-liar-v1 实测）；且逐镜逐组 TTS 成本高、豆包短句异常（重复/灌静音）风险大。
//
// 时序约束（用户拼接铁律）：对白开始不早于片头 ~0.7s、片尾留 ≥1s 无对白——由随附 prompt 指令
// 交给模型执行。

import { MAX_CLIP_REFERENCE_AUDIOS } from "./video-orchestrator.media-budget";

export class DialogueAudioContractError extends Error {
  readonly status = 422;
  readonly terminal = false;
  readonly details = { upstreamRequestAttempted: false } as const;

  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "DialogueAudioContractError";
  }
}

export function isValidTimbreSampleDuration(input: {
  durationSec: number | null;
  minimumDurationSeconds: number;
  maximumDurationSeconds: number;
}): boolean {
  return (
    typeof input.durationSec === "number" &&
    Number.isFinite(input.durationSec) &&
    input.durationSec >= input.minimumDurationSeconds &&
    input.durationSec <= input.maximumDurationSeconds
  );
}

export type DialogueLine = { speaker: string; text: string };

// @角色（情绪）：「台词」 / [旁白]（悬疑）：「台词」 / 台词：@角色：「台词」——情绪括注可选。
// 角色名 1~8 字（含旁白/OS/画外音等），台词取「」内逐字。
const DIALOGUE_LINE_RE =
  /(?:@|\[)?([一-龥A-Za-z0-9]{1,8})(?:\])?\s*(?:（[^）]*）|\([^)]*\))?\s*[:：]\s*「([^」]+)」/g;

/** 纯标点/省略号等退化"台词"（如「……」表沉默）不算对白，不合成。 */
export function isDegenerateDialogue(text: string): boolean {
  const real = String(text || "").replace(
    /[\s。，、！？…·—\-.,!?：:；;（）()「」『』""''"']/g,
    "",
  );
  return real.length < 2;
}

/** 从 clipPrompt 逐字抽出（说话人, 台词）序列（保序，滤退化句）。 */
export function extractClipDialogueLines(clipPrompt: string): DialogueLine[] {
  const out: DialogueLine[] = [];
  const src = String(clipPrompt || "");
  let m: RegExpExecArray | null;
  DIALOGUE_LINE_RE.lastIndex = 0;
  while ((m = DIALOGUE_LINE_RE.exec(src)) !== null) {
    const speaker = m[1].trim();
    const text = m[2].trim();
    if (!speaker || !text || isDegenerateDialogue(text)) continue;
    out.push({ speaker, text });
  }
  return out;
}

/** 按首次开口顺序取 ≤max 个不同说话人（音色参考按角色去重，与台词条数无关）。 */
export function distinctSpeakersInOrder(
  lines: DialogueLine[],
  max: number = MAX_CLIP_REFERENCE_AUDIOS,
): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (!out.includes(l.speaker)) out.push(l.speaker);
    if (out.length >= max + 8) break; // 防超长 prompt 病态输入
  }
  return out.slice(0, Math.max(0, max));
}

export type ClipDialogueAudioResult = {
  /** 参考音频 URL（≤3，顺序=角色首次开口顺序），空数组=本镜无可用音色参考。 */
  urls: string[];
  /** 注入唯一人声轨预留地址的音色绑定；不含台词正文或额外创作配置。 */
  bindingInstruction: string;
  segments: Array<{ speaker: string; text: string; url: string; durationSec: number | null }>;
  /** 因异常/无音色被跳过的角色（可观测性）。 */
  dropped: Array<{ speaker: string; reason: string }>;
};

export type VoiceReferenceManifestAudio = {
  url: string;
};

function renderVoiceBindingInstruction(
  bindings: ReadonlyArray<{ referenceIndex: number; speakers: readonly string[] }>,
): string {
  return bindings
    .map((binding) => (
      `@音频${binding.referenceIndex}只作为${binding.speakers.join("、")}的人声音色参考`
    ))
    .join("；") +
    "。音色样本中的语句内容全部忽略且禁止朗读；唯一可发声正文仍仅限本节上方成对〈发声正文〉标签内的文字。画内发声按对应角色精确对口型，画外发声与原文VO服从各人声轨行的发声方式。";
}

/**
 * Compiles the timbre binding against the final provider manifest order.
 *
 * The manifest de-duplicates equal URLs, so an instruction assembled before
 * that boundary can point at the wrong @音频N. This verifier groups all
 * structurally declared speakers by the final URL order and fails if either
 * side contains an unmatched entry. It never infers a speaker from prompt
 * prose or an audio label.
 */
export function buildVerifiedVoiceBindingInstructionFromManifest(input: {
  voiceBindings: unknown;
  manifestAudios: readonly VoiceReferenceManifestAudio[];
}): string {
  const rawBindings = Array.isArray(input.voiceBindings) ? input.voiceBindings : [];
  const bindings = rawBindings.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new DialogueAudioContractError(
        "speaker_voice_manifest_binding_invalid",
        `voiceBinding[${index}] 不是对象`,
      );
    }
    const record = raw as Record<string, unknown>;
    const speaker = typeof record.character === "string" ? record.character.trim() : "";
    const url = typeof record.audioUrl === "string" ? record.audioUrl.trim() : "";
    if (!speaker || !/^https?:\/\//i.test(url)) {
      throw new DialogueAudioContractError(
        "speaker_voice_manifest_binding_invalid",
        `voiceBinding[${index}] 缺少 canonical character 或真实 audioUrl`,
      );
    }
    return { speaker, url };
  });
  if (bindings.length === 0 && input.manifestAudios.length === 0) return "";
  if (bindings.length === 0 || input.manifestAudios.length === 0) {
    throw new DialogueAudioContractError(
      "speaker_voice_manifest_mismatch",
      "结构化说话人与最终参考音频 manifest 未同时交付",
    );
  }

  const manifestIndexByUrl = new Map<string, number>();
  input.manifestAudios.forEach((audio, index) => {
    const url = String(audio.url ?? "").trim();
    if (!/^https?:\/\//i.test(url) || manifestIndexByUrl.has(url)) {
      throw new DialogueAudioContractError(
        "speaker_voice_manifest_mismatch",
        `最终参考音频 manifest 第${index + 1}项无效或重复`,
      );
    }
    manifestIndexByUrl.set(url, index + 1);
  });

  const speakersByManifestIndex = new Map<number, string[]>();
  for (const binding of bindings) {
    const referenceIndex = manifestIndexByUrl.get(binding.url);
    if (referenceIndex === undefined) {
      throw new DialogueAudioContractError(
        "speaker_voice_manifest_mismatch",
        `说话人「${binding.speaker}」的音色资产未进入最终参考音频 manifest`,
      );
    }
    const speakers = speakersByManifestIndex.get(referenceIndex) ?? [];
    if (!speakers.includes(binding.speaker)) speakers.push(binding.speaker);
    speakersByManifestIndex.set(referenceIndex, speakers);
  }
  for (const referenceIndex of manifestIndexByUrl.values()) {
    if (!speakersByManifestIndex.has(referenceIndex)) {
      throw new DialogueAudioContractError(
        "speaker_voice_manifest_mismatch",
        `@音频${referenceIndex} 没有结构化说话人归属`,
      );
    }
  }
  return renderVoiceBindingInstruction(
    [...speakersByManifestIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([referenceIndex, speakers]) => ({ referenceIndex, speakers })),
  );
}

/**
 * 绑定配音卡真实音频资产：说话人由上游 speechEvents -> speakerBindings 结构合同传入。
 * 不解析 clipPrompt，不临时重合成替代资产，不回落旁白音色；缺卡 URL/voiceId 或时长非法直接抛错。
 */
export async function resolveClipDialogueAudioReferences(input: {
  speakerNames: string[];
  /** 角色名 → 画布配音卡的真实音色资产。 */
  audioAssetByCharacter: Map<string, { voiceId: string; url: string; durationSec: number | null }>;
  referenceAudioPolicy: {
    minimumDurationSeconds: number;
    maximumDurationSeconds: number;
  };
}): Promise<ClipDialogueAudioResult> {
  const empty: ClipDialogueAudioResult = {
    urls: [],
    bindingInstruction: "",
    segments: [],
    dropped: [],
  };
  const speakers = input.speakerNames
    .map((speaker) => String(speaker ?? "").trim())
    .filter((speaker, index, all) => Boolean(speaker) && all.indexOf(speaker) === index);
  if (!speakers.length) return empty;
  if (
    input.referenceAudioPolicy.minimumDurationSeconds === 0 &&
    input.referenceAudioPolicy.maximumDurationSeconds === 0
  ) {
    throw new DialogueAudioContractError(
      "speaker_reference_audio_unsupported",
      "当前冻结的视频模型运行时合同不支持参考音频输入",
    );
  }
  if (speakers.length > MAX_CLIP_REFERENCE_AUDIOS) {
    throw new DialogueAudioContractError(
      "speaker_reference_audio_limit_exceeded",
      `${speakers.length} > ${MAX_CLIP_REFERENCE_AUDIOS}`,
    );
  }

  const segments: ClipDialogueAudioResult["segments"] = [];
  for (const speaker of speakers) {
    const asset = input.audioAssetByCharacter.get(speaker);
    if (!asset?.voiceId) {
      throw new DialogueAudioContractError(
        "speaker_voice_binding_missing",
        `说话人「${speaker}」缺 doubaoVoiceId`,
      );
    }
    if (!/^https?:\/\//i.test(asset.url)) {
      throw new DialogueAudioContractError(
        "speaker_voice_asset_missing",
        `说话人「${speaker}」的配音卡缺真实 audioUrl`,
      );
    }
    if (!isValidTimbreSampleDuration({
      durationSec: asset.durationSec,
      ...input.referenceAudioPolicy,
    })) {
      throw new DialogueAudioContractError(
        "speaker_voice_asset_duration_invalid",
        `说话人「${speaker}」配音卡时长 ` +
        `${asset.durationSec === null ? "unknown" : asset.durationSec.toFixed(1) + "s"}，` +
        `供应商合格区间 ${input.referenceAudioPolicy.minimumDurationSeconds}~` +
        `${input.referenceAudioPolicy.maximumDurationSeconds}s`,
      );
    }
    segments.push({
      speaker,
      text: "配音卡音色参考",
      url: asset.url,
      durationSec: asset.durationSec,
    });
  }

  const bindingInstruction = renderVoiceBindingInstruction(
    segments.map((segment, index) => ({
      referenceIndex: index + 1,
      speakers: [segment.speaker],
    })),
  );
  return {
    urls: segments.map((segment) => segment.url),
    bindingInstruction,
    segments,
    dropped: [],
  };
}
