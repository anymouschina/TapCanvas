import { normalizeWithMap } from "./video-orchestrator.source-coverage";
import {
  buildCanonicalSourceCoverageSpan,
} from "./video-orchestrator.source-units";

export type RequestedPreservedClipMapping = {
  sourceClipIndex: number;
  targetClipIndex: number;
};

type ParsedBeatReplacement = {
  sourceClipIndex: number;
  splitStartMarkers: string[];
  replacementBeats: Record<string, unknown>[];
};

export type ReplanBeatSheetTransformResult =
  | {
      ok: true;
      beatSheet: Record<string, unknown>;
      targetBeatCount: number;
      expectedTargetIndexBySource: Map<number, number>;
    }
  | { ok: false; code: string; message: string };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readIndex(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readDialogueSpeakerNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    const record = readRecord(item);
    const speakerName = typeof record?.speakerName === "string"
      ? record.speakerName.trim()
      : "";
    return speakerName ? [speakerName] : [];
  })));
}

function buildInheritedReplacementBeat(input: {
  sourceBeat: Record<string, unknown>;
  replacementBeat: Record<string, unknown>;
  replacementIndex: number;
  replacementCount: number;
}): Record<string, unknown> {
  const inherited = structuredClone(input.sourceBeat);
  delete inherited.clipIndex;
  delete inherited.sourceStartMarker;
  delete inherited.sourceEndMarker;
  delete inherited.pacingDecision;

  if (input.replacementIndex > 0) {
    inherited.continuityMode = "editorial_cut";
    delete inherited.startKeyframe;
    delete inherited.enterStateNote;
    delete inherited.storyboardImageNodeId;
    delete inherited.storyboardFrameCount;
  }
  if (input.replacementIndex < input.replacementCount - 1) {
    delete inherited.endKeyframe;
    delete inherited.exitState;
    delete inherited.lastFrameImageNodeId;
  }

  const dialogueScript = structuredClone(input.replacementBeat.dialogueScript);
  return {
    ...inherited,
    ...input.replacementBeat,
    dialogueScript,
    speakerNames: readDialogueSpeakerNames(dialogueScript),
  };
}

function parseBeatReplacements(value: unknown): ParsedBeatReplacement[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const parsed: ParsedBeatReplacement[] = [];
  for (const item of value) {
    const record = readRecord(item);
    const sourceClipIndex = readIndex(record?.sourceClipIndex);
    const replacementBeats = Array.isArray(record?.replacementBeats)
      ? record.replacementBeats.map(readRecord)
      : null;
    const splitStartMarkers = Array.isArray(record?.splitStartMarkers)
      ? record.splitStartMarkers.map((marker) => typeof marker === "string" ? marker.trim() : "")
      : null;
    if (
      sourceClipIndex == null ||
      !replacementBeats ||
      replacementBeats.length === 0 ||
      replacementBeats.some((beat) => !beat) ||
      !splitStartMarkers ||
      splitStartMarkers.some((marker) => !marker) ||
      splitStartMarkers.length !== replacementBeats.length - 1
    ) {
      return null;
    }
    parsed.push({
      sourceClipIndex,
      splitStartMarkers,
      replacementBeats: replacementBeats as Record<string, unknown>[],
    });
  }
  return parsed;
}

function locateUniqueNormalizedMarker(input: {
  chapterNorm: string;
  marker: string;
  startOffset: number;
  endOffset: number;
}): number | null {
  const markerNorm = normalizeWithMap(input.marker).norm;
  if (!markerNorm) return null;
  const first = input.chapterNorm.indexOf(markerNorm, input.startOffset);
  if (first <= input.startOffset || first >= input.endOffset) return null;
  const second = input.chapterNorm.indexOf(markerNorm, first + 1);
  if (second >= 0 && second < input.endOffset) return null;
  return first;
}

export function transformClonedReplanBeatSheet(input: {
  sourceBeatSheet: Record<string, unknown>;
  chapterText: string;
  preservedMappings: RequestedPreservedClipMapping[];
  beatReplacements: unknown;
}): ReplanBeatSheetTransformResult {
  const cloned = structuredClone(input.sourceBeatSheet);
  const sourceBeats = Array.isArray(cloned.beats)
    ? cloned.beats.map(readRecord)
    : null;
  const sourceCoverage = readRecord(cloned.sourceCoveragePlan);
  const sourceSpans = Array.isArray(sourceCoverage?.spans)
    ? sourceCoverage.spans.map(readRecord)
    : null;
  const speechLedger = Array.isArray(sourceCoverage?.speechLedger)
    ? structuredClone(sourceCoverage.speechLedger)
    : null;
  const replacements = parseBeatReplacements(input.beatReplacements);
  if (
    !sourceBeats ||
    sourceBeats.length === 0 ||
    sourceBeats.some((beat) => !beat) ||
    !sourceSpans ||
    sourceSpans.length !== sourceBeats.length ||
    sourceSpans.some((span) => !span) ||
    !speechLedger ||
    !replacements
  ) {
    return {
      ok: false,
      code: "replan_source_transform_contract_invalid",
      message:
        "源 BeatSheet 必须包含连续 beats、canonical sourceCoveragePlan 与 speechLedger；beatReplacements 必须是结构完整的局部替换数组。",
    };
  }

  const replacementBySource = new Map<number, ParsedBeatReplacement>();
  for (const replacement of replacements) {
    if (replacementBySource.has(replacement.sourceClipIndex)) {
      return {
        ok: false,
        code: "replan_beat_replacement_duplicate",
        message: `sourceClipIndex=${replacement.sourceClipIndex} 被重复声明为局部替换。`,
      };
    }
    replacementBySource.set(replacement.sourceClipIndex, replacement);
  }

  const preservedBySource = new Map<number, number>();
  for (const mapping of input.preservedMappings) {
    if (preservedBySource.has(mapping.sourceClipIndex)) {
      return {
        ok: false,
        code: "replan_preserved_mapping_duplicate",
        message: `sourceClipIndex=${mapping.sourceClipIndex} 被重复声明为复用片段。`,
      };
    }
    preservedBySource.set(mapping.sourceClipIndex, mapping.targetClipIndex);
  }

  const requiresSourceRemap = replacements.length > 0;
  const { norm: chapterNorm, map } = normalizeWithMap(input.chapterText);
  if (requiresSourceRemap && (!chapterNorm || map.length === 0)) {
    return {
      ok: false,
      code: "replan_chapter_source_missing",
      message: "当前章节原文不可用，无法对有 beatReplacements 的局部重规划生成 canonical source coverage。",
    };
  }

  const targetBeats: Record<string, unknown>[] = [];
  const targetSpans: Record<string, unknown>[] = [];
  const expectedTargetIndexBySource = new Map<number, number>();
  let targetClipIndex = 0;
  for (let sourceClipIndex = 0; sourceClipIndex < sourceBeats.length; sourceClipIndex += 1) {
    const sourceBeat = sourceBeats[sourceClipIndex];
    const sourceSpan = sourceSpans[sourceClipIndex];
    if (
      !sourceBeat ||
      !sourceSpan ||
      readIndex(sourceBeat.clipIndex) !== sourceClipIndex ||
      readIndex(sourceSpan.clipIndex) !== sourceClipIndex
    ) {
      return {
        ok: false,
        code: "replan_source_clip_sequence_invalid",
        message: `源 BeatSheet 的 beat/span clipIndex 必须从 0 连续递增；异常位置=${sourceClipIndex}。`,
      };
    }
    const sourceStartOffset = readIndex(sourceSpan.sourceStartOffset);
    const sourceEndOffset = readIndex(sourceSpan.sourceEndOffset);
    if (
      sourceStartOffset == null ||
      sourceEndOffset == null ||
      sourceEndOffset <= sourceStartOffset ||
      (requiresSourceRemap && sourceEndOffset > chapterNorm.length)
    ) {
      return {
        ok: false,
        code: "replan_source_coverage_invalid",
        message: `源 BeatSheet 的 canonical coverage 无效；clipIndex=${sourceClipIndex}。`,
      };
    }

    const replacement = replacementBySource.get(sourceClipIndex);
    if (!replacement) {
      expectedTargetIndexBySource.set(sourceClipIndex, targetClipIndex);
      const preservedTarget = preservedBySource.get(sourceClipIndex);
      if (preservedTarget !== undefined && preservedTarget !== targetClipIndex) {
        return {
          ok: false,
          code: "replan_preserved_target_mismatch",
          message:
            `源 clip ${sourceClipIndex} 在局部重规划后的唯一目标位置应为 ${targetClipIndex}，` +
            `收到 ${preservedTarget}。`,
        };
      }
      const remappedSpan: Record<string, unknown> = {
        ...sourceSpan,
        clipIndex: targetClipIndex,
      };
      targetBeats.push({
        ...sourceBeat,
        clipIndex: targetClipIndex,
        sourceStartMarker: remappedSpan.sourceStartMarker,
        sourceEndMarker: remappedSpan.sourceEndMarker,
      });
      targetSpans.push(remappedSpan);
      targetClipIndex += 1;
      continue;
    }

    if (preservedBySource.has(sourceClipIndex)) {
      return {
        ok: false,
        code: "replan_replacement_conflicts_with_preserved_clip",
        message: `源 clip ${sourceClipIndex} 同时声明复用与替换；禁止覆盖已成功付费资产。`,
      };
    }
    const boundaries = [sourceStartOffset];
    let previousBoundary = sourceStartOffset;
    for (const marker of replacement.splitStartMarkers) {
      const boundary = locateUniqueNormalizedMarker({
        chapterNorm,
        marker,
        startOffset: previousBoundary,
        endOffset: sourceEndOffset,
      });
      if (boundary == null || boundary <= previousBoundary) {
        return {
          ok: false,
          code: "replan_split_marker_invalid_or_ambiguous",
          message:
            `源 clip ${sourceClipIndex} 的 splitStartMarker 无法在原跨度内唯一定位：${marker}`,
        };
      }
      boundaries.push(boundary);
      previousBoundary = boundary;
    }
    boundaries.push(sourceEndOffset);

    replacement.replacementBeats.forEach((replacementBeat, replacementIndex) => {
      const span = buildCanonicalSourceCoverageSpan({
        chapterText: input.chapterText,
        map,
        clipIndex: targetClipIndex,
        startOffset: boundaries[replacementIndex]!,
        endOffset: boundaries[replacementIndex + 1]!,
      });
      const inheritedReplacementBeat = buildInheritedReplacementBeat({
        sourceBeat,
        replacementBeat,
        replacementIndex,
        replacementCount: replacement.replacementBeats.length,
      });
      targetBeats.push({
        ...inheritedReplacementBeat,
        clipIndex: targetClipIndex,
        sourceStartMarker: span.sourceStartMarker,
        sourceEndMarker: span.sourceEndMarker,
      });
      targetSpans.push(span);
      targetClipIndex += 1;
    });
  }

  const unknownReplacementIndexes = [...replacementBySource.keys()].filter(
    (sourceClipIndex) => sourceClipIndex >= sourceBeats.length,
  );
  if (unknownReplacementIndexes.length > 0) {
    return {
      ok: false,
      code: "replan_replacement_source_clip_unknown",
      message: `beatReplacements 包含不存在的源 clip：${unknownReplacementIndexes.join(",")}`,
    };
  }

  for (const [sourceClipIndex, targetIndex] of preservedBySource) {
    if (expectedTargetIndexBySource.get(sourceClipIndex) !== targetIndex) {
      return {
        ok: false,
        code: "replan_preserved_source_clip_unknown_or_replaced",
        message: `preservedClips 包含不存在或已被替换的源 clip：${sourceClipIndex}`,
      };
    }
  }

  cloned.beats = targetBeats;
  cloned.sourceCoveragePlan = {
    ...sourceCoverage,
    spans: targetSpans,
    speechLedger,
  };
  const meta = readRecord(cloned.meta);
  if (meta) {
    const totalDurationSeconds = targetBeats.reduce((sum, beat) => {
      const duration = Number(beat.durationBudget);
      return Number.isFinite(duration) && duration > 0 ? sum + duration : sum;
    }, 0);
    const nextMeta = { ...meta };
    if (meta.deliveryScope === "full_chapter") {
      delete nextMeta.targetDurationSeconds;
    } else if (totalDurationSeconds > 0) {
      nextMeta.targetDurationSeconds = totalDurationSeconds;
    }
    cloned.meta = nextMeta;
  }
  return {
    ok: true,
    beatSheet: cloned,
    targetBeatCount: targetBeats.length,
    expectedTargetIndexBySource,
  };
}
