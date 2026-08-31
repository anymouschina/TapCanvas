export const BEAT_TEMPORAL_PRESENTATIONS = [
  "current",
  "memory",
  "anticipation",
  "parallel",
  "subjective",
] as const;

export type BeatTemporalPresentation = typeof BEAT_TEMPORAL_PRESENTATIONS[number];

export const BEAT_TEMPORAL_RELATIONS = [
  "opening",
  "continuous",
  "enter_memory",
  "continue_memory",
  "return_from_memory",
  "parallel_cut",
  "time_jump",
] as const;

export type BeatTemporalRelation = typeof BEAT_TEMPORAL_RELATIONS[number];

/**
 * Agent-authored temporal facts for one clip.
 *
 * `stateScope` is the deterministic persistence boundary. Character asset
 * states may flow between clips in the same scope, but never across memory,
 * anticipation, parallel, or present-day scopes merely because their clip
 * indexes are adjacent.
 */
export type BeatTemporalContext = {
  timelineId: string;
  stateScope: string;
  presentation: BeatTemporalPresentation;
  relationToPrevious: BeatTemporalRelation;
  transitionCue?: string;
  returnAnchor?: string;
};

/** Visible entry/exit facts for the exact subscene used by one clip. */
export type BeatSceneState = {
  subscene: string;
  interiorExterior: "interior" | "exterior" | "mixed";
  timeOfDay: string;
  lighting: string;
  spatialAnchor: string;
  stateIn: string;
  stateOut: string;
};

/**
 * A visible character-state version is deliberately separate from a state
 * card key. It can preserve pregnancy, injury, wardrobe, carried objects and
 * other visible facts even when no dedicated derived character image exists.
 */
export type BeatCharacterStateVersion = {
  stateId: string;
  visualState: string;
  stateIn: string;
  stateOut: string;
};

export type BeatCharacterStateVersions = Record<string, BeatCharacterStateVersion>;

type ParseResult<T> = {
  value?: T;
  errors: string[];
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const readRequiredString = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string => {
  const value = typeof record[key] === "string" ? record[key].trim() : "";
  if (!value) errors.push(`${path}.${key} 必须是非空字符串`);
  return value;
};

const readOptionalString = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string | undefined => {
  if (record[key] === undefined) return undefined;
  const value = typeof record[key] === "string" ? record[key].trim() : "";
  if (!value) errors.push(`${path}.${key} 提交时必须是非空字符串`);
  return value || undefined;
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

export function parseBeatTemporalContext(
  value: unknown,
  path = "temporalContext",
): ParseResult<BeatTemporalContext> {
  if (value === undefined) return { errors: [] };
  const errors: string[] = [];
  const record = readRecord(value);
  if (!record) return { errors: [`${path} 必须是对象`] };
  validateExactKeys(
    record,
    ["timelineId", "stateScope", "presentation", "relationToPrevious", "transitionCue", "returnAnchor"],
    path,
    errors,
  );
  const timelineId = readRequiredString(record, "timelineId", path, errors);
  const stateScope = readRequiredString(record, "stateScope", path, errors);
  const presentation = readRequiredString(record, "presentation", path, errors) as BeatTemporalPresentation;
  const relationToPrevious = readRequiredString(record, "relationToPrevious", path, errors) as BeatTemporalRelation;
  if (!BEAT_TEMPORAL_PRESENTATIONS.includes(presentation)) {
    errors.push(`${path}.presentation 必须是 ${BEAT_TEMPORAL_PRESENTATIONS.join("/")}`);
  }
  if (!BEAT_TEMPORAL_RELATIONS.includes(relationToPrevious)) {
    errors.push(`${path}.relationToPrevious 必须是 ${BEAT_TEMPORAL_RELATIONS.join("/")}`);
  }
  const transitionCue = readOptionalString(record, "transitionCue", path, errors);
  const returnAnchor = readOptionalString(record, "returnAnchor", path, errors);
  if (errors.length) return { errors };
  return {
    value: {
      timelineId,
      stateScope,
      presentation,
      relationToPrevious,
      ...(transitionCue ? { transitionCue } : {}),
      ...(returnAnchor ? { returnAnchor } : {}),
    },
    errors,
  };
}

export function parseBeatSceneState(
  value: unknown,
  path = "sceneState",
): ParseResult<BeatSceneState> {
  if (value === undefined) return { errors: [] };
  const errors: string[] = [];
  const record = readRecord(value);
  if (!record) return { errors: [`${path} 必须是对象`] };
  validateExactKeys(
    record,
    ["subscene", "interiorExterior", "timeOfDay", "lighting", "spatialAnchor", "stateIn", "stateOut"],
    path,
    errors,
  );
  const subscene = readRequiredString(record, "subscene", path, errors);
  const interiorExterior = readRequiredString(record, "interiorExterior", path, errors) as BeatSceneState["interiorExterior"];
  const timeOfDay = readRequiredString(record, "timeOfDay", path, errors);
  const lighting = readRequiredString(record, "lighting", path, errors);
  const spatialAnchor = readRequiredString(record, "spatialAnchor", path, errors);
  const stateIn = readRequiredString(record, "stateIn", path, errors);
  const stateOut = readRequiredString(record, "stateOut", path, errors);
  if (!["interior", "exterior", "mixed"].includes(interiorExterior)) {
    errors.push(`${path}.interiorExterior 必须是 interior/exterior/mixed`);
  }
  if (errors.length) return { errors };
  return {
    value: { subscene, interiorExterior, timeOfDay, lighting, spatialAnchor, stateIn, stateOut },
    errors,
  };
}

export function parseBeatCharacterStateVersions(
  value: unknown,
  path = "characterStateVersions",
): ParseResult<BeatCharacterStateVersions> {
  if (value === undefined) return { errors: [] };
  const errors: string[] = [];
  const record = readRecord(value);
  if (!record) return { errors: [`${path} 必须是对象`] };
  const versions: BeatCharacterStateVersions = {};
  for (const [rawName, rawVersion] of Object.entries(record)) {
    const name = rawName.trim();
    if (!name) {
      errors.push(`${path} 的角色名必须非空`);
      continue;
    }
    const versionPath = `${path}.${name}`;
    const versionRecord = readRecord(rawVersion);
    if (!versionRecord) {
      errors.push(`${versionPath} 必须是对象`);
      continue;
    }
    validateExactKeys(versionRecord, ["stateId", "visualState", "stateIn", "stateOut"], versionPath, errors);
    const stateId = readRequiredString(versionRecord, "stateId", versionPath, errors);
    const visualState = readRequiredString(versionRecord, "visualState", versionPath, errors);
    const stateIn = readRequiredString(versionRecord, "stateIn", versionPath, errors);
    const stateOut = readRequiredString(versionRecord, "stateOut", versionPath, errors);
    if (stateId && visualState && stateIn && stateOut) {
      versions[name] = { stateId, visualState, stateIn, stateOut };
    }
  }
  if (errors.length) return { errors };
  return { value: versions, errors };
}

export const readTemporalStateScope = (
  context: Pick<BeatTemporalContext, "stateScope"> | undefined,
): string => context?.stateScope.trim() || "__unscoped__";
