import { createHash } from "node:crypto";

import { AppError } from "../../middleware/error";
import {
  deriveShotPromptsFromStructuredData,
  normalizeStoryboardStructuredData,
  STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION,
  type StoryboardStructuredData,
  type StoryboardStoryPoint,
} from "./storyboard-structure";

export type StoryboardPersistenceHandoffEvidence = {
  previousExitState: string;
  currentEntryState: string;
  previousEffectiveAt: StoryboardStoryPoint | null;
  currentEffectiveAt: StoryboardStoryPoint | null;
};

export type StoryboardPredecessorRecord = {
  chunkId: string;
  taskId: string;
  chapter: number;
  groupSize: 1 | 4 | 9 | 25;
  chunkIndex: number;
  tailFrameUrl: string;
};

function throwStoryboardArtifactCanonicalizationError(input: {
  path: string;
  reason: string;
}): never {
  throw new AppError(`storyboard artifact 无法 canonicalize：${input.reason}`, {
    status: 400,
    code: "storyboard_artifact_canonicalization_invalid",
    details: {
      path: input.path,
      reason: input.reason,
    },
  });
}

function canonicalizeStoryboardArtifactValue(
  value: unknown,
  ancestors: Set<object>,
  valuePath: string,
): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return throwStoryboardArtifactCanonicalizationError({
        path: valuePath,
        reason: "non-finite numbers are not valid JSON",
      });
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (value === undefined) {
    return throwStoryboardArtifactCanonicalizationError({
      path: valuePath,
      reason: "undefined is not valid JSON",
    });
  }
  if (typeof value !== "object") {
    return throwStoryboardArtifactCanonicalizationError({
      path: valuePath,
      reason: `${typeof value} is not valid JSON`,
    });
  }
  if (ancestors.has(value)) {
    return throwStoryboardArtifactCanonicalizationError({
      path: valuePath,
      reason: "cyclic references are not valid JSON",
    });
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return throwStoryboardArtifactCanonicalizationError({
      path: valuePath,
      reason: "symbol properties are not valid JSON",
    });
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const enumerableKeys = Object.keys(value);
      for (const key of enumerableKeys) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
          return throwStoryboardArtifactCanonicalizationError({
            path: `${valuePath}.${key}`,
            reason: "custom array properties are not valid JSON artifact fields",
          });
        }
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          return throwStoryboardArtifactCanonicalizationError({
            path: `${valuePath}[${index}]`,
            reason: "sparse array entries are undefined and not valid JSON",
          });
        }
        items.push(
          canonicalizeStoryboardArtifactValue(value[index], ancestors, `${valuePath}[${index}]`),
        );
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return throwStoryboardArtifactCanonicalizationError({
        path: valuePath,
        reason: "only plain JSON objects are supported",
      });
    }
    const keys = Object.keys(value).sort();
    const properties: string[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        return throwStoryboardArtifactCanonicalizationError({
          path: `${valuePath}.${key}`,
          reason: "accessor properties are not valid JSON artifact fields",
        });
      }
      properties.push(
        `${JSON.stringify(key)}:${canonicalizeStoryboardArtifactValue(
          descriptor.value,
          ancestors,
          `${valuePath}.${key}`,
        )}`,
      );
    }
    return `{${properties.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeStoryboardArtifact(value: unknown): string {
  return canonicalizeStoryboardArtifactValue(value, new Set<object>(), "$");
}

export function sha256StoryboardArtifactCanonical(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeStoryboardArtifact(value), "utf8")
    .digest("hex");
}

function isHttpAssetUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function requireExactStoryboardPreviousChunk<T extends StoryboardPredecessorRecord>(input: {
  chunks: readonly T[];
  taskId: string;
  chapter: number;
  groupSize: 1 | 4 | 9 | 25;
  chunkIndex: number;
  previousChunkId?: string | null;
  contextLabel: string;
}): T | null {
  const previousChunkId = String(input.previousChunkId || "").trim();
  if (input.chunkIndex <= 0) {
    if (previousChunkId) {
      throw new AppError(`${input.contextLabel} 首分组不得携带 previousChunkId`, {
        status: 400,
        code: "storyboard_previous_chunk_id_unexpected",
      });
    }
    return null;
  }
  if (!previousChunkId) {
    throw new AppError(`${input.contextLabel} chunkIndex > 0 时必须提供 previousChunkId`, {
      status: 400,
      code: "storyboard_previous_chunk_id_required",
    });
  }
  const previousChunk = input.chunks.find(
    (chunk) => String(chunk.chunkId || "").trim() === previousChunkId,
  );
  if (
    !previousChunk ||
    String(previousChunk.taskId || "").trim() !== input.taskId.trim() ||
    Number(previousChunk.chapter) !== input.chapter ||
    Number(previousChunk.groupSize) !== input.groupSize ||
    Number(previousChunk.chunkIndex) !== input.chunkIndex - 1
  ) {
    throw new AppError(
      `${input.contextLabel} previousChunkId 与当前 task/chapter/group/chunkIndex 不构成直接前驱关系`,
      {
        status: 409,
        code: "storyboard_previous_chunk_scope_mismatch",
      },
    );
  }
  const tailFrameUrl = String(previousChunk.tailFrameUrl || "").trim();
  if (!tailFrameUrl || !isHttpAssetUrl(tailFrameUrl)) {
    throw new AppError(`${input.contextLabel} 上一分组缺少真实 tailFrameUrl`, {
      status: 409,
      code: "storyboard_prev_tail_missing",
    });
  }
  return previousChunk;
}

function normalizeDirectShotPrompts(value: unknown, contextLabel: string): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new AppError(`${contextLabel} shotPrompts 必须是字符串数组`, {
      status: 400,
      code: "storyboard_persistence_shot_prompts_invalid",
    });
  }
  const prompts: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const prompt = typeof value[index] === "string" ? value[index].trim() : "";
    if (!prompt) {
      throw new AppError(`${contextLabel} shotPrompts[${index}] 必须是非空字符串`, {
        status: 400,
        code: "storyboard_persistence_shot_prompt_invalid",
      });
    }
    prompts.push(prompt);
  }
  return prompts;
}

function assertSamePrompts(input: {
  direct: readonly string[];
  derived: readonly string[];
  contextLabel: string;
}): void {
  if (
    input.direct.length === input.derived.length &&
    input.direct.every((prompt, index) => prompt === input.derived[index])
  ) {
    return;
  }
  throw new AppError(`${input.contextLabel} shotPrompts 与 v1.2 structured 派生结果不一致`, {
    status: 409,
    code: "storyboard_persistence_prompt_trace_mismatch",
    details: {
      directCount: input.direct.length,
      derivedCount: input.derived.length,
    },
  });
}

export function requireStoryboardV12ArtifactPayload(input: {
  storyboardStructured: unknown;
  previousStoryboardArtifact?: unknown;
  requirePreviousHandoff?: boolean;
  shotPrompts?: unknown;
  maxShotPrompts: number;
  contextLabel: string;
}): {
  artifact: Record<string, unknown>;
  artifactSha256: string;
  structured: StoryboardStructuredData;
  shotPrompts: string[];
  handoffEvidence: StoryboardPersistenceHandoffEvidence | null;
} {
  if (
    !input.storyboardStructured ||
    typeof input.storyboardStructured !== "object" ||
    Array.isArray(input.storyboardStructured)
  ) {
    throw new AppError(`${input.contextLabel} 必须提供完整的 storyboard-director/v1.2 JSON 对象`, {
      status: 400,
      code: "storyboard_persistence_v12_artifact_required",
    });
  }
  const canonicalArtifact = canonicalizeStoryboardArtifact(input.storyboardStructured);
  const artifact = JSON.parse(canonicalArtifact) as Record<string, unknown>;
  const artifactSha256 = createHash("sha256")
    .update(canonicalArtifact, "utf8")
    .digest("hex");
  if (artifact.schemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
    throw new AppError(`${input.contextLabel} 只接受完整的 storyboard-director/v1.2 artifact`, {
      status: 400,
      code: "storyboard_persistence_v12_artifact_required",
    });
  }
  const structured = normalizeStoryboardStructuredData(input.storyboardStructured);
  if (structured?.sourceSchemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
    throw new AppError(`${input.contextLabel} 必须提供有效的 storyboard-director/v1.2 structured`, {
      status: 400,
      code: "storyboard_persistence_v12_structured_required",
    });
  }
  const derived = deriveShotPromptsFromStructuredData(structured);
  if (derived.length === 0 || derived.length > input.maxShotPrompts) {
    throw new AppError(`${input.contextLabel} v1.2 structured 镜头数量非法`, {
      status: 400,
      code: "storyboard_persistence_shot_count_invalid",
      details: { shotCount: derived.length, maxShotPrompts: input.maxShotPrompts },
    });
  }
  const direct = normalizeDirectShotPrompts(input.shotPrompts, input.contextLabel);
  if (direct) assertSamePrompts({ direct, derived, contextLabel: input.contextLabel });
  const handoffEvidence = validatePreviousHandoff({
    current: structured,
    previousArtifact: input.previousStoryboardArtifact,
    required: input.requirePreviousHandoff === true,
    contextLabel: input.contextLabel,
  });
  return { artifact, artifactSha256, structured, shotPrompts: derived, handoffEvidence };
}

function compareStoryPoints(left: StoryboardStoryPoint, right: StoryboardStoryPoint): number {
  if (left.chapter !== right.chapter) return left.chapter - right.chapter;
  return left.sequence - right.sequence;
}

function validatePreviousHandoff(input: {
  current: StoryboardStructuredData;
  previousArtifact: unknown;
  required: boolean;
  contextLabel: string;
}): StoryboardPersistenceHandoffEvidence | null {
  if (!input.required && input.previousArtifact === undefined) return null;
  const previous = normalizeStoryboardStructuredData(input.previousArtifact);
  if (previous?.sourceSchemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
    throw new AppError(`${input.contextLabel} 上一分组缺少有效的 v1.2 artifact`, {
      status: 409,
      code: "storyboard_previous_v12_structured_required",
    });
  }
  const previousShot = previous.shots[previous.shots.length - 1];
  const currentShot = input.current.shots[0];
  const previousExitState = previousShot?.exitState?.trim() || "";
  const currentEntryState = currentShot?.purpose.continuity?.trim() || "";
  if (!previousExitState || !currentEntryState || previousExitState !== currentEntryState) {
    throw new AppError(`${input.contextLabel} 首镜 continuity.fromPrev 与上一分组 exitState 不一致`, {
      status: 409,
      code: "storyboard_previous_exit_state_mismatch",
      details: {
        hasPreviousExitState: Boolean(previousExitState),
        hasCurrentEntryState: Boolean(currentEntryState),
      },
    });
  }
  const previousContext = previous.storyFactsContext;
  const currentContext = input.current.storyFactsContext;
  if (!previousContext || !currentContext || previousContext.mode !== currentContext.mode) {
    throw new AppError(`${input.contextLabel} 前后分组 Story Facts 来源模式不一致`, {
      status: 409,
      code: "storyboard_previous_fact_mode_mismatch",
    });
  }
  const previousEffectiveAt = previousShot?.storyFactLocks?.effectiveAt ?? null;
  const currentEffectiveAt = currentShot?.storyFactLocks?.effectiveAt ?? null;
  if (previousContext.mode === "book_ledger" && currentContext.mode === "book_ledger") {
    if (previousContext.bookId !== currentContext.bookId) {
      throw new AppError(`${input.contextLabel} 前后分组 bookId 不一致`, {
        status: 409,
        code: "storyboard_previous_book_id_mismatch",
      });
    }
    if (currentContext.ledgerRevision < previousContext.ledgerRevision) {
      throw new AppError(`${input.contextLabel} 当前分组 ledgerRevision 早于上一分组`, {
        status: 409,
        code: "storyboard_previous_ledger_revision_regression",
      });
    }
    if (!previousEffectiveAt || !currentEffectiveAt) {
      throw new AppError(`${input.contextLabel} 前后分组缺少可比较的镜头故事点`, {
        status: 409,
        code: "storyboard_previous_story_point_missing",
      });
    }
    if (compareStoryPoints(currentEffectiveAt, previousEffectiveAt) < 0) {
      throw new AppError(`${input.contextLabel} 当前分组首镜故事点早于上一分组尾镜`, {
        status: 409,
        code: "storyboard_previous_story_point_regression",
      });
    }
  }
  return {
    previousExitState,
    currentEntryState,
    previousEffectiveAt: previousEffectiveAt ? structuredClone(previousEffectiveAt) : null,
    currentEffectiveAt: currentEffectiveAt ? structuredClone(currentEffectiveAt) : null,
  };
}
