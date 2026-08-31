/**
 * Agent-authored visual state topology.
 *
 * The runtime never infers pregnancy, injury, wardrobe, posture, hand usage or
 * spatial meaning from prose. Agents assign stable state/fact identifiers;
 * Hono only validates ranges, references and exact boundary equality.
 */

export type VisualStateFact = {
  key: string;
  value: string;
};

export type CharacterVisualStateInterval = {
  characterName: string;
  stateScope: string;
  stateVersionId: string;
  stateKey: string;
  startClipIndex: number;
  endClipIndex: number;
  visualFacts: VisualStateFact[];
  anchorPolicy: "identity" | "state_specific";
  anchorNodeId?: string;
};

export type VisualStateTimeline = {
  version: 1;
  intervals: CharacterVisualStateInterval[];
};

export type ContinuityBoundarySnapshot = {
  stateScope: string;
  facts: VisualStateFact[];
};

export type BeatContinuityLedger = {
  inheritsPreviousExit: boolean;
  entry: ContinuityBoundarySnapshot;
  exit: ContinuityBoundarySnapshot;
};

export type VisualStateAnchorRequirement = {
  characterName: string;
  stateScopes: string[];
  stateVersionId: string;
  stateKey: string;
  clipIndexes: number[];
  visualFacts: VisualStateFact[];
  anchorNodeId?: string;
};

type ParseResult<T> = {
  value?: T;
  errors: string[];
};

type BeatStateProjection = {
  clipIndex: number;
  stateScope?: string;
  characterStateVersions?: Record<string, { stateId: string }>;
  characterStates?: Record<string, string>;
  visualStateRefs?: Record<string, string[]>;
  continuityLedger?: BeatContinuityLedger;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const readString = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string => {
  const value = typeof record[key] === "string" ? record[key].trim() : "";
  if (!value) errors.push(`${path}.${key} 必须是非空字符串`);
  return value;
};

const readInteger = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): number => {
  const value = Number(record[key]);
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${path}.${key} 必须是非负整数`);
  }
  return value;
};

const validateExactKeys = (
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  errors: string[],
): void => {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} 不是允许字段`);
  }
};

const factIdentity = (fact: VisualStateFact): string => fact.key;

const parseFacts = (
  value: unknown,
  path: string,
  errors: string[],
): VisualStateFact[] => {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`);
    return [];
  }
  const facts: VisualStateFact[] = [];
  const seen = new Set<string>();
  value.forEach((rawFact, index) => {
    const factPath = `${path}[${index}]`;
    const record = readRecord(rawFact);
    if (!record) {
      errors.push(`${factPath} 必须是对象`);
      return;
    }
    validateExactKeys(record, ["key", "value"], factPath, errors);
    const key = readString(record, "key", factPath, errors);
    const factValue = readString(record, "value", factPath, errors);
    if (key && seen.has(key)) errors.push(`${path} 的 key「${key}」不得重复`);
    if (key) seen.add(key);
    if (key && factValue) facts.push({ key, value: factValue });
  });
  return facts.sort((left, right) => left.key.localeCompare(right.key));
};

const parseBoundary = (
  value: unknown,
  path: string,
  errors: string[],
): ContinuityBoundarySnapshot | undefined => {
  const record = readRecord(value);
  if (!record) {
    errors.push(`${path} 必须是对象`);
    return undefined;
  }
  validateExactKeys(record, ["stateScope", "facts"], path, errors);
  const stateScope = readString(record, "stateScope", path, errors);
  const facts = parseFacts(record.facts, `${path}.facts`, errors);
  return stateScope ? { stateScope, facts } : undefined;
};

export function parseBeatContinuityLedger(
  value: unknown,
  path = "continuityLedger",
): ParseResult<BeatContinuityLedger> {
  if (value === undefined) return { errors: [] };
  const errors: string[] = [];
  const record = readRecord(value);
  if (!record) return { errors: [`${path} 必须是对象`] };
  validateExactKeys(record, ["inheritsPreviousExit", "entry", "exit"], path, errors);
  if (typeof record.inheritsPreviousExit !== "boolean") {
    errors.push(`${path}.inheritsPreviousExit 必须是 boolean`);
  }
  const entry = parseBoundary(record.entry, `${path}.entry`, errors);
  const exit = parseBoundary(record.exit, `${path}.exit`, errors);
  if (errors.length || !entry || !exit) return { errors };
  return {
    value: {
      inheritsPreviousExit: record.inheritsPreviousExit as boolean,
      entry,
      exit,
    },
    errors,
  };
}

export function parseBeatVisualStateRefs(
  value: unknown,
  path = "visualStateRefs",
): ParseResult<Record<string, string[]>> {
  if (value === undefined) return { errors: [] };
  const errors: string[] = [];
  const record = readRecord(value);
  if (!record) return { errors: [`${path} 必须是对象`] };
  const refs: Record<string, string[]> = {};
  for (const [rawCharacterName, rawStateVersionIds] of Object.entries(record)) {
    const characterName = rawCharacterName.trim();
    if (!characterName) {
      errors.push(`${path} 的角色名必须非空`);
      continue;
    }
    if (!Array.isArray(rawStateVersionIds) || rawStateVersionIds.length === 0) {
      errors.push(`${path}.${characterName} 必须是非空 stateVersionId 数组`);
      continue;
    }
    const stateVersionIds = rawStateVersionIds.map((item) =>
      typeof item === "string" ? item.trim() : "",
    );
    if (stateVersionIds.some((item) => !item)) {
      errors.push(`${path}.${characterName} 只能包含非空字符串`);
      continue;
    }
    if (new Set(stateVersionIds).size !== stateVersionIds.length) {
      errors.push(`${path}.${characterName} 不得重复 stateVersionId`);
      continue;
    }
    refs[characterName] = stateVersionIds;
  }
  return errors.length ? { errors } : { value: refs, errors };
}

export function parseVisualStateTimeline(
  value: unknown,
  path = "visualStateTimeline",
): ParseResult<VisualStateTimeline> {
  if (value === undefined) return { errors: [] };
  const errors: string[] = [];
  const record = readRecord(value);
  if (!record) return { errors: [`${path} 必须是对象`] };
  validateExactKeys(record, ["version", "intervals"], path, errors);
  if (record.version !== 1) errors.push(`${path}.version 必须是 1`);
  if (!Array.isArray(record.intervals)) {
    errors.push(`${path}.intervals 必须是数组`);
    return { errors };
  }
  const intervals: CharacterVisualStateInterval[] = [];
  const identities = new Set<string>();
  record.intervals.forEach((rawInterval, index) => {
    const intervalPath = `${path}.intervals[${index}]`;
    const interval = readRecord(rawInterval);
    if (!interval) {
      errors.push(`${intervalPath} 必须是对象`);
      return;
    }
    validateExactKeys(
      interval,
      [
        "characterName",
        "stateScope",
        "stateVersionId",
        "stateKey",
        "startClipIndex",
        "endClipIndex",
        "visualFacts",
        "anchorPolicy",
        "anchorNodeId",
      ],
      intervalPath,
      errors,
    );
    const characterName = readString(interval, "characterName", intervalPath, errors);
    const stateScope = readString(interval, "stateScope", intervalPath, errors);
    const stateVersionId = readString(interval, "stateVersionId", intervalPath, errors);
    const stateKey = readString(interval, "stateKey", intervalPath, errors);
    const startClipIndex = readInteger(interval, "startClipIndex", intervalPath, errors);
    const endClipIndex = readInteger(interval, "endClipIndex", intervalPath, errors);
    const visualFacts = parseFacts(interval.visualFacts, `${intervalPath}.visualFacts`, errors);
    const anchorPolicy = interval.anchorPolicy;
    if (anchorPolicy !== "identity" && anchorPolicy !== "state_specific") {
      errors.push(`${intervalPath}.anchorPolicy 必须是 identity/state_specific`);
    }
    const anchorNodeId = interval.anchorNodeId === undefined
      ? undefined
      : readString(interval, "anchorNodeId", intervalPath, errors);
    if (endClipIndex < startClipIndex) {
      errors.push(`${intervalPath}.endClipIndex 不得早于 startClipIndex`);
    }
    const identity =
      `${characterName}\u0000${stateScope}\u0000${stateVersionId}\u0000${startClipIndex}\u0000${endClipIndex}`;
    if (characterName && stateScope && stateVersionId && identities.has(identity)) {
      errors.push(`${intervalPath} 的角色、作用域、状态版本与生效区间组合重复`);
    }
    identities.add(identity);
    if (
      characterName &&
      stateScope &&
      stateVersionId &&
      stateKey &&
      (anchorPolicy === "identity" || anchorPolicy === "state_specific")
    ) {
      intervals.push({
        characterName,
        stateScope,
        stateVersionId,
        stateKey,
        startClipIndex,
        endClipIndex,
        visualFacts,
        anchorPolicy,
        ...(anchorNodeId ? { anchorNodeId } : {}),
      });
    }
  });

  const ordered = [...intervals].sort((left, right) =>
    left.characterName.localeCompare(right.characterName) ||
    left.stateScope.localeCompare(right.stateScope) ||
    left.startClipIndex - right.startClipIndex ||
    left.endClipIndex - right.endClipIndex,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous.characterName === current.characterName &&
      previous.stateScope === current.stateScope &&
      current.startClipIndex <= previous.endClipIndex
    ) {
      errors.push(
        `${path}.intervals 的角色「${current.characterName}」在作用域「${current.stateScope}」存在重叠区间 ` +
        `${previous.startClipIndex}-${previous.endClipIndex} 与 ${current.startClipIndex}-${current.endClipIndex}`,
      );
    }
  }
  const versions = new Map<string, CharacterVisualStateInterval>();
  for (const interval of intervals) {
    const key = `${interval.characterName}\u0000${interval.stateVersionId}`;
    const previous = versions.get(key);
    if (!previous) {
      versions.set(key, interval);
      continue;
    }
    if (
      previous.stateKey !== interval.stateKey ||
      previous.anchorPolicy !== interval.anchorPolicy ||
      JSON.stringify(previous.visualFacts) !== JSON.stringify(interval.visualFacts)
    ) {
      errors.push(
        `${path}.intervals 的角色「${interval.characterName}」状态版本「${interval.stateVersionId}」` +
        "跨作用域复用时必须逐字保持 stateKey、anchorPolicy 与 visualFacts",
      );
    }
    if (previous.anchorNodeId && interval.anchorNodeId && previous.anchorNodeId !== interval.anchorNodeId) {
      errors.push(
        `${path}.intervals 的角色「${interval.characterName}」状态版本「${interval.stateVersionId}」不得绑定多个 anchorNodeId`,
      );
    }
  }
  if (errors.length) return { errors };
  return { value: { version: 1, intervals }, errors };
}

const factsByKey = (facts: readonly VisualStateFact[]): Map<string, string> =>
  new Map(facts.map((fact) => [factIdentity(fact), fact.value]));

export function validateVisualContinuityTopology(input: {
  beats: readonly BeatStateProjection[];
  timeline?: VisualStateTimeline;
}): string[] {
  const errors: string[] = [];
  const hasStateVersions = input.beats.some(
    (beat) => beat.characterStateVersions && Object.keys(beat.characterStateVersions).length > 0,
  );
  if (hasStateVersions && !input.timeline) {
    errors.push("visualStateTimeline 必填；存在 characterStateVersions 时必须声明角色状态生效区间与锚图策略");
  }

  input.beats.forEach((beat, index) => {
    const ledger = beat.continuityLedger;
    if (!ledger) return;
    if (index === 0 && ledger.inheritsPreviousExit) {
      errors.push("beats[0].continuityLedger.inheritsPreviousExit 必须为 false");
      return;
    }
    if (!ledger.inheritsPreviousExit) return;
    const previous = input.beats[index - 1]?.continuityLedger;
    if (!previous) {
      errors.push(`beats[${index}].continuityLedger 声明继承，但上一 beat 缺少 continuityLedger`);
      return;
    }
    if (previous.exit.stateScope !== ledger.entry.stateScope) {
      errors.push(
        `beats[${index}].continuityLedger.entry.stateScope 必须等于上一 beat exit.stateScope；` +
        `期望「${previous.exit.stateScope}」，收到「${ledger.entry.stateScope}」`,
      );
      return;
    }
    const expected = factsByKey(previous.exit.facts);
    const actual = factsByKey(ledger.entry.facts);
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    for (const key of keys) {
      if (expected.get(key) !== actual.get(key)) {
        errors.push(
          `beats[${index}].continuityLedger.entry.facts 的「${key}」未逐字承接上一 beat exit；` +
          `期望 ${JSON.stringify(expected.get(key) ?? null)}，收到 ${JSON.stringify(actual.get(key) ?? null)}`,
        );
      }
    }
  });

  if (!input.timeline) return errors;
  for (const beat of input.beats) {
    const scope = beat.stateScope?.trim();
    for (const [characterName, stateVersionIds] of Object.entries(beat.visualStateRefs ?? {})) {
      for (const stateVersionId of stateVersionIds) {
        const matches = input.timeline.intervals.filter(
          (interval) =>
            interval.characterName === characterName &&
            interval.stateVersionId === stateVersionId &&
            interval.startClipIndex <= beat.clipIndex &&
            interval.endClipIndex >= beat.clipIndex,
        );
        if (matches.length !== 1) {
          errors.push(
            `beats[${beat.clipIndex}].visualStateRefs.${characterName} 的状态版本「${stateVersionId}」` +
            `必须命中 visualStateTimeline 中唯一覆盖当前 clip 的区间；收到 ${matches.length} 个`,
          );
        }
      }
    }
    for (const [characterName, version] of Object.entries(beat.characterStateVersions ?? {})) {
      const explicitRefs = beat.visualStateRefs?.[characterName];
      if (explicitRefs?.length) {
        if (!explicitRefs.includes(version.stateId)) {
          errors.push(
            `beats[${beat.clipIndex}].characterStateVersions.${characterName}.stateId ` +
            `必须属于 visualStateRefs.${characterName}`,
          );
        }
        continue;
      }
      const candidates = input.timeline.intervals.filter(
        (interval) =>
          interval.characterName === characterName &&
          interval.stateScope === scope &&
          interval.startClipIndex <= beat.clipIndex &&
          interval.endClipIndex >= beat.clipIndex,
      );
      if (candidates.length !== 1) {
		const coveringIntervals = input.timeline.intervals.filter(
		  (interval) =>
			interval.characterName === characterName &&
			interval.startClipIndex <= beat.clipIndex &&
			interval.endClipIndex >= beat.clipIndex,
		);
        errors.push(
		  `beats[${beat.clipIndex}].characterStateVersions.${characterName} 必须命中 visualStateTimeline 中唯一生效区间；` +
		  `收到 ${candidates.length} 个，当前 temporalContext.stateScope=${JSON.stringify(scope ?? null)}，` +
		  `覆盖当前 clip 的可用区间=${JSON.stringify(coveringIntervals.map((interval) => ({
			stateScope: interval.stateScope,
			stateVersionId: interval.stateVersionId,
			stateKey: interval.stateKey,
		  })))}`,
        );
        continue;
      }
      const interval = candidates[0];
      if (interval.stateVersionId !== version.stateId) {
        errors.push(
          `beats[${beat.clipIndex}].characterStateVersions.${characterName}.stateId 必须等于生效区间 stateVersionId「${interval.stateVersionId}」`,
        );
      }
      if (interval.anchorPolicy === "state_specific") {
        const selectedStateKey = beat.characterStates?.[characterName]?.trim();
        if (selectedStateKey !== interval.stateKey) {
          errors.push(
            `beats[${beat.clipIndex}].characterStates.${characterName} 必须绑定状态锚 stateKey「${interval.stateKey}」`,
          );
        }
      }
    }
  }
  return errors;
}

export function collectVisualStateAnchorRequirements(
  timeline: VisualStateTimeline | undefined,
): VisualStateAnchorRequirement[] {
  if (!timeline) return [];
  const grouped = new Map<string, VisualStateAnchorRequirement>();
  for (const interval of timeline.intervals) {
    if (interval.anchorPolicy !== "state_specific") continue;
    const key = `${interval.characterName}\u0000${interval.stateVersionId}\u0000${interval.stateKey}`;
    const clipIndexes = Array.from(
      { length: interval.endClipIndex - interval.startClipIndex + 1 },
      (_, offset) => interval.startClipIndex + offset,
    );
    const previous = grouped.get(key);
    if (previous) {
      previous.stateScopes = [...new Set([...previous.stateScopes, interval.stateScope])];
      previous.clipIndexes = [...new Set([...previous.clipIndexes, ...clipIndexes])].sort((left, right) => left - right);
      if (!previous.anchorNodeId && interval.anchorNodeId) previous.anchorNodeId = interval.anchorNodeId;
      continue;
    }
    grouped.set(key, {
      characterName: interval.characterName,
      stateScopes: [interval.stateScope],
      stateVersionId: interval.stateVersionId,
      stateKey: interval.stateKey,
      clipIndexes,
      visualFacts: interval.visualFacts.map((fact) => ({ ...fact })),
      ...(interval.anchorNodeId ? { anchorNodeId: interval.anchorNodeId } : {}),
    });
  }
  return [...grouped.values()];
}
