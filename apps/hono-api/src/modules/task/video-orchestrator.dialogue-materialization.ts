type DialogueContractLine = {
  lineId: string;
  speakerName: string;
  text: string;
  delivery?: "on_screen" | "off_screen" | "voice_over";
};

export type WriterDialogueMaterializationIssue = {
  path: string;
  problem: string;
};

export type WriterDialogueMaterializationResult =
  | { ok: true; clip: Record<string, unknown> }
  | { ok: false; issues: WriterDialogueMaterializationIssue[] };

/**
 * Project the speaker asset kinds and exact spoken-ledger coordinates already
 * determined by frozen workflow facts, then remove the machine-owned
 * shot-to-speech relation from the Agent envelope. The writer still owns event
 * existence, stable IDs, speech windows and performance. The host compiles
 * references only after final shot-duration reconciliation.
 *
 * This is intentionally a projection rather than a semantic fallback. It does
 * not invent speech events, alter their timing, or infer a role from a name.
 * For an event that already points at an exact frozen lineId, the Unicode range,
 * speaker, frozen delivery and absence of copied source text are deterministic
 * protocol facts, so they are compiled instead of spending a second model turn
 * repairing coordinates the model does not own.
 */
export function projectWriterSpeechStructure(input: Readonly<{
  clip: Record<string, unknown>;
  dialogueScript: readonly DialogueContractLine[];
  characterRoleNames: readonly string[];
}>): Record<string, unknown> {
  if (input.dialogueScript.length === 0) {
    const shots = Array.isArray(input.clip.shots)
      ? input.clip.shots.map((rawShot) => {
          if (!rawShot || typeof rawShot !== "object" || Array.isArray(rawShot)) return rawShot;
          const shot = { ...(rawShot as Record<string, unknown>) };
          delete shot.speechEventIds;
          return shot;
        })
      : input.clip.shots;
    return { ...input.clip, speakerBindings: [], shots };
  }

  const visibleCharacters = new Set(input.characterRoleNames.map(readText).filter(Boolean));
  const expectedSpeakerNames = [...new Set(input.dialogueScript.map((line) => line.speakerName))];
  const rawBindings = Array.isArray(input.clip.speakerBindings) ? input.clip.speakerBindings : [];
  const bindingByName = new Map<string, Record<string, unknown>>();
  for (const rawBinding of rawBindings) {
    if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) continue;
    const binding = rawBinding as Record<string, unknown>;
    const name = readText(binding.name);
    if (name && !bindingByName.has(name)) bindingByName.set(name, binding);
  }
  const speakerBindings = expectedSpeakerNames.map((name) => {
    const existing = bindingByName.get(name);
    const existingKind = existing?.assetKind;
    const assetKind = existingKind === "character" || existingKind === "voice"
      ? existingKind
      : visibleCharacters.has(name) ? "character" : "voice";
    return { name, assetKind };
  });

  const projectedShots = Array.isArray(input.clip.shots) ? input.clip.shots.map((rawShot) => {
    if (!rawShot || typeof rawShot !== "object" || Array.isArray(rawShot)) return rawShot;
    const shot = { ...(rawShot as Record<string, unknown>) };
    delete shot.speechEventIds;
    return shot;
  }) : input.clip.shots;
  const lineById = new Map(input.dialogueScript.map((line) => [line.lineId, line] as const));
  const projectedSpeechEvents = Array.isArray(input.clip.speechEvents)
    ? input.clip.speechEvents.map((rawEvent) => {
        if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return rawEvent;
        const event = { ...(rawEvent as Record<string, unknown>) };
        const line = lineById.get(readText(event.lineId));
        if (!line) return event;
        event.startOffset = 0;
        event.endOffset = Array.from(line.text).length;
        event.speakerName = line.speakerName;
        if (line.delivery) event.delivery = line.delivery;
        delete event.spokenText;
        delete event.dialogue;
        delete event.text;
        return event;
      })
    : input.clip.speechEvents;
  return {
    ...input.clip,
    speakerBindings,
    speechEvents: projectedSpeechEvents,
    shots: projectedShots,
  };
}

/**
 * Compile the exact shot-to-speech interval relation from the final shot clock.
 * This must run after every duration normalization and is deliberately the only
 * function that creates `shots[].speechEventIds`.
 */
export function compileShotSpeechEventReferences(
  clip: Record<string, unknown>,
): Record<string, unknown> {
  const eventWindows = Array.isArray(clip.speechEvents) ? clip.speechEvents.flatMap((rawEvent) => {
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return [];
    const event = rawEvent as Record<string, unknown>;
    const speechEventId = readText(event.speechEventId);
    const startSeconds = readFiniteNumber(event.startSeconds);
    const endSeconds = readFiniteNumber(event.endSeconds);
    if (!speechEventId || startSeconds === null || endSeconds === null || endSeconds <= startSeconds) return [];
    return [{ speechEventId, startSeconds, endSeconds }];
  }) : [];
  let cursor = 0;
  const shots = Array.isArray(clip.shots) ? clip.shots.map((rawShot) => {
    if (!rawShot || typeof rawShot !== "object" || Array.isArray(rawShot)) return rawShot;
    const shot = { ...(rawShot as Record<string, unknown>) };
    delete shot.speechEventIds;
    const durationSeconds = readFiniteNumber(shot.durationSeconds);
    if (durationSeconds === null || durationSeconds <= 0) return shot;
    const startSeconds = cursor;
    const endSeconds = cursor + durationSeconds;
    cursor = endSeconds;
    const speechEventIds = eventWindows
      .filter((event) => event.startSeconds < endSeconds && event.endSeconds > startSeconds)
      .map((event) => event.speechEventId);
    if (speechEventIds.length > 0) shot.speechEventIds = [...new Set(speechEventIds)];
    return shot;
  }) : clip.shots;
  return { ...clip, shots };
}

type MaterializedSpeechEvent = Readonly<{
  speechEventId: string;
  lineId: string;
  startOffset: number;
  endOffset: number;
  startSeconds: number;
  endSeconds: number;
  speakerName: string;
  delivery: "on_screen" | "off_screen" | "voice_over";
  performance?: string;
  spokenText: string;
}>;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDelivery(value: unknown): DialogueContractLine["delivery"] | null {
  return value === "on_screen" || value === "off_screen" || value === "voice_over"
    ? value
    : null;
}

/**
 * Materialize the independent speech timeline from the frozen spoken ledger.
 *
 * Shots own only visual time. Speech events own spoken time and may cross any
 * number of editorial cuts. Every frozen line is scheduled once as a whole
 * Unicode range, so a camera cut can never split the spoken source into
 * fragments such as “尸骨未” / “寒”. The server still owns every spoken byte:
 * the writer supplies coordinates and performance, never the source text.
 */
export function materializeWriterSpeechEvents(input: {
  clip: Record<string, unknown>;
  dialogueScript: readonly DialogueContractLine[];
  clipDurationSeconds: number;
}): WriterDialogueMaterializationResult {
  const issues: WriterDialogueMaterializationIssue[] = [];
  const expectedById = new Map(input.dialogueScript.map((line) => [line.lineId, line] as const));
  const rawEvents = Array.isArray(input.clip.speechEvents) ? input.clip.speechEvents : [];
  const materializedEvents: MaterializedSpeechEvent[] = [];
  const seenEventIds = new Set<string>();
  const seenLineIds = new Set<string>();

  if (input.dialogueScript.length === 0 && rawEvents.length > 0) {
    issues.push({ path: "speechEvents", problem: "冻结人声脚本为空时必须是空数组" });
  }

  rawEvents.forEach((rawEvent, eventIndex) => {
    const path = `speechEvents[${eventIndex}]`;
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      issues.push({ path, problem: "必须是对象" });
      return;
    }
    const event = rawEvent as Record<string, unknown>;
    const speechEventId = readText(event.speechEventId);
    const lineId = readText(event.lineId);
    const line = expectedById.get(lineId);
    const startOffset = readFiniteNumber(event.startOffset);
    const endOffset = readFiniteNumber(event.endOffset);
    const startSeconds = readFiniteNumber(event.startSeconds);
    const endSeconds = readFiniteNumber(event.endSeconds);
    const speakerName = readText(event.speakerName);
    const delivery = readDelivery(event.delivery);
    const performance = readText(event.performance);

    if (!speechEventId) issues.push({ path: `${path}.speechEventId`, problem: "必须是非空稳定 ID" });
    else if (seenEventIds.has(speechEventId)) issues.push({ path: `${path}.speechEventId`, problem: "不得重复" });
    else seenEventIds.add(speechEventId);

    if (!line) {
      issues.push({ path: `${path}.lineId`, problem: `${JSON.stringify(lineId)} 不属于冻结人声脚本` });
      return;
    }
    if (seenLineIds.has(lineId)) {
      issues.push({ path: `${path}.lineId`, problem: "每条冻结人声必须由一个完整 speech event 唯一承载" });
    }
    seenLineIds.add(lineId);

    const codePointLength = Array.from(line.text).length;
    if (!Number.isInteger(startOffset) || startOffset !== 0 || !Number.isInteger(endOffset) || endOffset !== codePointLength) {
      issues.push({
        path,
        problem: `必须完整承载冻结行的 Unicode 半开区间 [0,${codePointLength})；不得按镜头切分台词`,
      });
    }
    if (startSeconds === null || startSeconds < 0) {
      issues.push({ path: `${path}.startSeconds`, problem: "必须是大于等于 0 的有限数字" });
    }
    if (endSeconds === null || startSeconds === null || endSeconds <= startSeconds) {
      issues.push({ path: `${path}.endSeconds`, problem: "必须大于 startSeconds" });
    } else if (endSeconds > input.clipDurationSeconds) {
      issues.push({ path: `${path}.endSeconds`, problem: `不得超过 clip 时长 ${input.clipDurationSeconds}s` });
    }
    if (speakerName !== line.speakerName) {
      issues.push({ path: `${path}.speakerName`, problem: `必须等于冻结说话人 ${JSON.stringify(line.speakerName)}` });
    }
    if (!delivery) {
      issues.push({ path: `${path}.delivery`, problem: "必须是 on_screen/off_screen/voice_over" });
    } else if (line.delivery && delivery !== line.delivery) {
      issues.push({ path: `${path}.delivery`, problem: `必须等于冻结 delivery=${line.delivery}` });
    }
    if (hasOwn(event, "spokenText") || hasOwn(event, "dialogue") || hasOwn(event, "text")) {
      issues.push({ path, problem: "writer 不得提交台词正文；正文由服务端从冻结台账物化" });
    }

    if (
      speechEventId
      && Number.isInteger(startOffset)
      && Number.isInteger(endOffset)
      && startSeconds !== null
      && endSeconds !== null
      && delivery
    ) {
      materializedEvents.push({
        speechEventId,
        lineId,
        startOffset: startOffset as number,
        endOffset: endOffset as number,
        startSeconds,
        endSeconds,
        speakerName: line.speakerName,
        delivery,
        ...(performance ? { performance } : {}),
        spokenText: line.text,
      });
    }
  });

  for (const line of input.dialogueScript) {
    if (!seenLineIds.has(line.lineId)) {
      issues.push({ path: `dialogueScript[${JSON.stringify(line.lineId)}]`, problem: "缺少唯一完整 speech event" });
    }
  }

  const rawShots = Array.isArray(input.clip.shots) ? input.clip.shots : [];
  const shots = rawShots.map((rawShot, shotIndex): unknown => {
    if (!rawShot || typeof rawShot !== "object" || Array.isArray(rawShot)) return rawShot;
    const shot = rawShot as Record<string, unknown>;
    for (const forbiddenField of [
      "dialogue",
      "dialogueLineId",
      "dialogueStartOffset",
      "dialogueEndOffset",
      "dialogueDelivery",
      "dialoguePerformance",
      "speakerName",
    ] as const) {
      if (hasOwn(shot, forbiddenField)) {
        issues.push({
          path: `shots[${shotIndex}].${forbiddenField}`,
          problem: "人声字段只允许出现在 clip.speechEvents；shots 只承载视觉与非人声音效",
        });
      }
    }
    const projected = { ...shot };
    delete projected.speechEventIds;
    return projected;
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, clip: { ...input.clip, speechEvents: materializedEvents, shots } };
}
