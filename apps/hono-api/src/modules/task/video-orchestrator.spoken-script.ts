export const NARRATIVE_AUDIO_STRATEGIES = [
  "visual_only",
  "source_speech_only",
  "source_grounded_voice",
  "mixed",
] as const;

export type NarrativeAudioStrategy = (typeof NARRATIVE_AUDIO_STRATEGIES)[number];
export type SpokenDelivery = "on_screen" | "off_screen" | "voice_over";

export type SpokenScriptLine = {
  lineId: string;
  speakerName: string;
  text: string;
  /** Source dialogue freezes this field; supplemental audio may defer it to the Clip writer. */
  delivery?: SpokenDelivery;
};

export type NarrativeAudioLine = SpokenScriptLine & {
  /**
   * `null` places the line before the first source line. Otherwise this must
   * name the source dialogue line after which the authored line is spoken.
   * Array order breaks ties without changing the immutable source order.
   */
  afterSourceLineId: string | null;
  /** Agent-authored provenance labels; Hono preserves but never interprets them. */
  sourceEvidence: string[];
  narrativeFunction?: string;
};

export type NarrativeAudioPlan = {
  strategy: NarrativeAudioStrategy;
  rationale: string;
  lines: NarrativeAudioLine[];
};

const readNonEmptyString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function parseNarrativeAudioPlan(
  raw: unknown,
  path: string,
  errors: string[],
): NarrativeAudioPlan | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) && raw.length === 0) {
    // The exact empty list proves that no narrative line or semantic audio
    // decision exists. Accept it as the same optional absence represented by
    // the canonical `{ lines: [] }`; non-empty arrays remain invalid.
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${path} 必须是对象`);
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  // An empty line set has no executable speech. Strategy/rationale are then
  // optional diagnostics only and cannot block downstream production. Strict
  // structure remains mandatory as soon as at least one narrative line exists.
  if (Array.isArray(record.lines) && record.lines.length === 0) {
    return undefined;
  }
  // Some structured providers place an otherwise empty audio-plan object
  // inside `lines` instead of returning the plan object itself. When the
  // nested plan also declares no lines, this is a lossless structural shape
  // error rather than authored narration; normalize it to the canonical
  // empty projection and keep the downstream clip contract deterministic.
  if (
    record.strategy === undefined
    && record.rationale === undefined
    && Array.isArray(record.lines)
    && record.lines.length === 1
    && record.lines[0]
    && typeof record.lines[0] === "object"
    && !Array.isArray(record.lines[0])
  ) {
    const nested = record.lines[0] as Record<string, unknown>;
    if (
      typeof nested.strategy === "string"
      && typeof nested.rationale === "string"
      && Array.isArray(nested.lines)
      && nested.lines.length === 0
    ) {
      return undefined;
    }
  }
  const strategy = record.strategy;
  const rationale = readNonEmptyString(record.rationale);
  if (!NARRATIVE_AUDIO_STRATEGIES.includes(strategy as NarrativeAudioStrategy)) {
    errors.push(`${path}.strategy 必须是 ${NARRATIVE_AUDIO_STRATEGIES.join("/")}`);
  }
  if (!rationale) errors.push(`${path}.rationale 必须是非空字符串`);
  if (!Array.isArray(record.lines)) {
    errors.push(`${path}.lines 必须是数组；不使用新增人声时传 []`);
    return undefined;
  }
  const seenLineIds = new Set<string>();
  const lines = record.lines.flatMap((item, index): NarrativeAudioLine[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path}.lines[${index}] 必须是对象`);
      return [];
    }
    const line = item as Record<string, unknown>;
    const lineId = readNonEmptyString(line.lineId);
    const speakerName = readNonEmptyString(line.speakerName);
    const text = readNonEmptyString(line.text);
    const delivery = line.delivery;
    const afterSourceLineId = line.afterSourceLineId === null
      ? null
      : readNonEmptyString(line.afterSourceLineId);
    const narrativeFunction = readNonEmptyString(line.narrativeFunction);
    const sourceEvidence = Array.isArray(line.sourceEvidence)
      ? line.sourceEvidence
          .map(readNonEmptyString)
          .filter(Boolean)
      : [];

    if (!lineId) errors.push(`${path}.lines[${index}].lineId 必须是非空字符串`);
    if (lineId && seenLineIds.has(lineId)) {
      errors.push(`${path}.lines[${index}].lineId=${lineId} 重复`);
    }
    if (lineId) seenLineIds.add(lineId);
    if (!speakerName) errors.push(`${path}.lines[${index}].speakerName 必须是非空字符串`);
    if (!text) errors.push(`${path}.lines[${index}].text 必须是非空字符串`);
    if (delivery !== undefined
      && delivery !== "on_screen"
      && delivery !== "off_screen"
      && delivery !== "voice_over") {
      errors.push(`${path}.lines[${index}].delivery 必须是 on_screen/off_screen/voice_over`);
    }
    if (line.afterSourceLineId !== null && !afterSourceLineId) {
      errors.push(`${path}.lines[${index}].afterSourceLineId 必须是 null 或非空 dialogueScript lineId`);
    }
    if (!Array.isArray(line.sourceEvidence)) {
      errors.push(`${path}.lines[${index}].sourceEvidence 必须是字符串数组`);
    }
    if (
      !lineId ||
      !speakerName ||
      !text ||
      (delivery !== undefined
        && delivery !== "on_screen"
        && delivery !== "off_screen"
        && delivery !== "voice_over") ||
      (line.afterSourceLineId !== null && !afterSourceLineId)
    ) {
      return [];
    }
    return [{
      lineId,
      speakerName,
      text,
      ...(delivery === undefined ? {} : { delivery }),
      afterSourceLineId,
      sourceEvidence,
      ...(narrativeFunction ? { narrativeFunction } : {}),
    }];
  });

  if (!NARRATIVE_AUDIO_STRATEGIES.includes(strategy as NarrativeAudioStrategy) || !rationale) {
    return undefined;
  }
  return {
    strategy: strategy as NarrativeAudioStrategy,
    rationale,
    lines,
  };
}

export function validateNarrativeAudioPlacement(
  sourceDialogue: readonly SpokenScriptLine[],
  narrativeAudioPlan: NarrativeAudioPlan | undefined,
  path: string,
  errors: string[],
): void {
  const sourceLineIds = new Set(sourceDialogue.map((line) => line.lineId));
  for (const [index, line] of (narrativeAudioPlan?.lines ?? []).entries()) {
    if (line.afterSourceLineId !== null && !sourceLineIds.has(line.afterSourceLineId)) {
      errors.push(
        `${path}.lines[${index}].afterSourceLineId=${line.afterSourceLineId} 必须引用当前 dialogueScript 的 lineId`,
      );
    }
  }
}

export function combineSpokenScript(
  sourceDialogue: readonly SpokenScriptLine[],
  narrativeAudioPlan?: NarrativeAudioPlan,
): SpokenScriptLine[] {
  const narrativeLines = narrativeAudioPlan?.lines ?? [];
  const projectNarrativeLine = (line: NarrativeAudioLine): SpokenScriptLine => ({
    lineId: line.lineId,
    speakerName: line.speakerName,
    text: line.text,
    delivery: line.delivery,
  });
  const beforeSource = narrativeLines
    .filter((line) => line.afterSourceLineId === null)
    .map(projectNarrativeLine);
  const interleaved = sourceDialogue.flatMap((sourceLine) => [
    { ...sourceLine },
    ...narrativeLines
      .filter((line) => line.afterSourceLineId === sourceLine.lineId)
      .map(projectNarrativeLine),
  ]);
  const sourceLineIds = new Set(sourceDialogue.map((line) => line.lineId));
  const unresolved = narrativeLines
    .filter((line) => line.afterSourceLineId !== null && !sourceLineIds.has(line.afterSourceLineId))
    .map(projectNarrativeLine);
  return [...beforeSource, ...interleaved, ...unresolved];
}

export function collectSpokenSpeakerNames(lines: readonly SpokenScriptLine[]): string[] {
  return Array.from(new Set(lines.map((line) => line.speakerName.trim()).filter(Boolean)));
}
