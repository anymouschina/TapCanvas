/**
 * 说话人资产契约。
 *
 * 说话人“是否需要画面身份锚”是创作语义，必须由 video-prompt-writer 以结构化字段给出；
 * 服务端只做类型、空值、冲突与资产覆盖校验，禁止再从姓名或对白文案用关键词/正则猜测。
 */

import { createHash } from "node:crypto";
import {
  normalizeSpeakerNames,
} from "./video-orchestrator.media-budget";

export const SPEAKER_ASSET_KINDS = ["character", "voice"] as const;
export type SpeakerAssetKind = (typeof SPEAKER_ASSET_KINDS)[number];

export type ClipSpeakerBinding = {
  /** 与配音卡 voiceCharacter / 角色卡 roleName 对齐的 canonical 名。 */
  name: string;
  /** character=需要有图角色卡+配音卡；voice=纯声音通道，只需要配音卡。 */
  assetKind: SpeakerAssetKind;
};

export type SpeakerContractIssue = {
  path: string;
  problem: string;
};

export type SpeakerAssetRequirements = {
  characterSpeakers: string[];
  voiceOnlySpeakers: string[];
};

export type StructuredSpeechEvent = {
  speakerName: string;
  spokenText: string;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function clipHasDialogue(clip: unknown): boolean {
  const record = recordOf(clip);
  const speechEvents = Array.isArray(record?.speechEvents) ? record.speechEvents : [];
  return speechEvents.some((event) => Boolean(trimmed(recordOf(event)?.spokenText)));
}

/**
 * 从独立时间线读取结构化人声归属。speakerName 是外键，不从正文或 prompt 推断。
 */
export function readStructuredSpeechEvents(clip: unknown): {
  speechEvents: StructuredSpeechEvent[];
  issues: SpeakerContractIssue[];
} {
  const record = recordOf(clip);
  const rawEvents = Array.isArray(record?.speechEvents) ? record.speechEvents : [];
  const speechEvents: StructuredSpeechEvent[] = [];
  const issues: SpeakerContractIssue[] = [];
  rawEvents.forEach((rawEvent, index) => {
    const event = recordOf(rawEvent);
    const spokenText = trimmed(event?.spokenText);
    const speakerName = trimmed(event?.speakerName);
    if (!spokenText) {
      if (speakerName) {
        issues.push({ path: `speechEvents[${index}].spokenText`, problem: "物化后必须包含冻结逐字正文" });
      }
      return;
    }
    if (!speakerName) {
      issues.push({
        path: `speechEvents[${index}].speakerName`,
        problem: "spokenText 非空时 speakerName 必填；禁止从台词正文猜说话人",
      });
      return;
    }
    speechEvents.push({ speakerName, spokenText });
  });
  return { speechEvents, issues };
}

/**
 * speaker coverage 与实际执行计划的稳定指纹。只使用 validateStoryPlan 会保留的执行字段，
 * 因而 authoring 累积 clips、estimate 缓存和 start 计划可得到同一结果。
 */
export function buildSpeakerCoveragePlanFingerprint(clips: readonly unknown[]): string {
  const canonical = clips.map((clip) => {
    const record = recordOf(clip);
    const duration = Math.trunc(Number(record?.durationSeconds));
    const shots = (Array.isArray(record?.shots) ? record.shots : [])
      .map((rawShot) => {
        const shot = recordOf(rawShot);
        const action = trimmed(shot?.action);
        const durationSeconds = Number(shot?.durationSeconds);
        if (!action || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
        const shotNo = Number(shot?.shotNo);
        return {
          action,
          durationSeconds,
          shotNo: Number.isInteger(shotNo) && shotNo > 0 ? shotNo : null,
          framing: trimmed(shot?.framing) || null,
          composition: trimmed(shot?.composition) || null,
          cameraMove: trimmed(shot?.cameraMove) || null,
          lighting: trimmed(shot?.lighting) || null,
          speechEventIds: Array.isArray(shot?.speechEventIds) ? shot.speechEventIds.map(trimmed).filter(Boolean) : [],
          sound: trimmed(shot?.sound) || null,
          notes: trimmed(shot?.notes) || null,
        };
      })
      .filter((shot) => shot !== null);
    return {
      clipPrompt: trimmed(record?.clipPrompt) || trimmed(record?.prompt),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      characterRoleNames: (Array.isArray(record?.characterRoleNames)
        ? record.characterRoleNames
        : [])
        .map(trimmed)
        .filter(Boolean),
      speakerBindings: readClipSpeakerBindings(clip).bindings,
      speechEvents: (Array.isArray(record?.speechEvents) ? record.speechEvents : []).map((rawEvent) => {
        const event = recordOf(rawEvent);
        return {
          speechEventId: trimmed(event?.speechEventId),
          lineId: trimmed(event?.lineId),
          startSeconds: event?.startSeconds,
          endSeconds: event?.endSeconds,
          speakerName: trimmed(event?.speakerName),
          delivery: trimmed(event?.delivery),
          spokenText: trimmed(event?.spokenText),
        };
      }),
      shots,
    };
  });
  const text = JSON.stringify(canonical);
  return `speaker-plan-v1-${createHash("sha256").update(text).digest("hex").slice(0, 32)}`;
}

export function readClipSpeakerBindings(clip: unknown): {
  bindings: ClipSpeakerBinding[];
  issues: SpeakerContractIssue[];
} {
  const record = recordOf(clip);
  const rawBindings = Array.isArray(record?.speakerBindings) ? record.speakerBindings : [];
  const bindings: ClipSpeakerBinding[] = [];
  const issues: SpeakerContractIssue[] = [];
  const kindByName = new Map<string, SpeakerAssetKind>();

  rawBindings.forEach((raw, index) => {
    const binding = recordOf(raw);
    const name = trimmed(binding?.name);
    const assetKind = trimmed(binding?.assetKind);
    const path = `speakerBindings[${index}]`;
    if (!name) {
      issues.push({ path, problem: "name 必填" });
      return;
    }
    if (!SPEAKER_ASSET_KINDS.includes(assetKind as SpeakerAssetKind)) {
      issues.push({ path, problem: `assetKind 必须是 character|voice（收到 ${assetKind || "空"}）` });
      return;
    }
    const normalizedKind = assetKind as SpeakerAssetKind;
    const previous = kindByName.get(name);
    if (previous && previous !== normalizedKind) {
      issues.push({
        path,
        problem: `说话人「${name}」同时声明为 ${previous} 与 ${normalizedKind}，资产契约冲突`,
      });
      return;
    }
    if (previous) return;
    kindByName.set(name, normalizedKind);
    bindings.push({ name, assetKind: normalizedKind });
  });

  const structuredSpeech = readStructuredSpeechEvents(clip);
  issues.push(...structuredSpeech.issues);
  if (structuredSpeech.speechEvents.length > 0 && bindings.length === 0) {
    issues.push({
      path: "speakerBindings",
      problem: "speechEvents 非空时必须声明说话人资产类型；禁止由服务端从正文猜测",
    });
  }

  const bindingNames = new Set(bindings.map((binding) => binding.name));
  for (const { speakerName } of structuredSpeech.speechEvents) {
    if (bindingNames.has(speakerName)) continue;
    issues.push({
      path: "speakerBindings",
      problem: `speechEvents 的说话人「${speakerName}」未在 speakerBindings 中声明资产类型`,
    });
  }

  const visibleRoles = new Set(
    (Array.isArray(record?.characterRoleNames) ? record.characterRoleNames : [])
      .map(trimmed)
      .filter(Boolean),
  );
  for (const binding of bindings) {
    if (binding.assetKind === "voice" && visibleRoles.has(binding.name)) {
      issues.push({
        path: "speakerBindings",
        problem: `纯声音通道「${binding.name}」同时出现在 characterRoleNames；若该主体入画必须声明 assetKind=character`,
      });
    }
  }

  return { bindings, issues };
}

export function validateClipSpeakerNamesAuthority(
  clip: unknown,
  expectedSpeakerNames: readonly string[],
): SpeakerContractIssue[] {
  const expected = normalizeSpeakerNames(expectedSpeakerNames);
  const contract = readClipSpeakerBindings(clip);
  const speech = readStructuredSpeechEvents(clip);
  const bindingNames = normalizeSpeakerNames(contract.bindings.map((binding) => binding.name));
  const speechNames = normalizeSpeakerNames(speech.speechEvents.map((event) => event.speakerName));
  const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((name) => right.includes(name));
  const issues: SpeakerContractIssue[] = [...contract.issues];

  if (!sameSet(bindingNames, expected)) {
    issues.push({
      path: "speakerBindings",
      problem:
        `说话人集合必须逐字等于 BeatSheet.speakerNames=${JSON.stringify(expected)}，` +
        `实收 ${JSON.stringify(bindingNames)}`,
    });
  }
  if (!sameSet(speechNames, expected)) {
    issues.push({
      path: "speechEvents[].speakerName",
      problem:
        `实际有对白的说话人集合必须逐字等于 BeatSheet.speakerNames=${JSON.stringify(expected)}，` +
        `实收 ${JSON.stringify(speechNames)}`,
    });
  }
  return issues;
}

export function collectSpeakerAssetRequirements(clips: readonly unknown[]): {
  requirements: SpeakerAssetRequirements;
  issues: Array<{ clipIndex: number; issues: SpeakerContractIssue[] }>;
} {
  const characterSpeakers: string[] = [];
  const voiceOnlySpeakers: string[] = [];
  const characterSet = new Set<string>();
  const voiceSet = new Set<string>();
  const issues: Array<{ clipIndex: number; issues: SpeakerContractIssue[] }> = [];

  clips.forEach((clip, fallbackIndex) => {
    const parsed = readClipSpeakerBindings(clip);
    const record = recordOf(clip);
    const rawIndex = Number(record?.clipIndex);
    const clipIndex = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : fallbackIndex;
    if (parsed.issues.length) issues.push({ clipIndex, issues: parsed.issues });
    for (const binding of parsed.bindings) {
      if (binding.assetKind === "character") {
        if (!characterSet.has(binding.name)) {
          characterSet.add(binding.name);
          characterSpeakers.push(binding.name);
        }
      } else if (!voiceSet.has(binding.name)) {
        voiceSet.add(binding.name);
        voiceOnlySpeakers.push(binding.name);
      }
    }
  });

  for (const name of characterSpeakers) {
    if (!voiceSet.has(name)) continue;
    issues.push({
      clipIndex: -1,
      issues: [{
        path: "speakerBindings",
        problem: `说话人「${name}」跨 clip 同时声明为 character 与 voice，章级资产契约冲突`,
      }],
    });
  }

  return { requirements: { characterSpeakers, voiceOnlySpeakers }, issues };
}
