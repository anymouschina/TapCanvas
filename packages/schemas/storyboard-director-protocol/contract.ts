import { validateCoreArtifactShape, validateShotCore } from "./director-shape-contract";
import {
  parseStoryFactLocks,
  parseStoryFactsContext,
  validateTraceInvariants,
} from "./story-facts-contract";
import {
  STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION,
  type StoryboardDirectorV12ValidatedContract,
  type StoryboardDirectorV12ValidatedShot,
  type StoryboardDirectorV12ValidationIssue,
  type StoryboardDirectorV12ValidationResult,
  type StoryboardExpectedStoryFactPolicy,
  type StoryboardStoryFactRevealGuard,
  type StoryboardStoryFactLocks,
  type StoryboardStoryFactsContext,
  type StoryboardStoryPoint,
} from "./types";
import { asRecord, compareStoryPoints, pushIssue } from "./validation-utils";

export function normalizeStoryboardStoryFactsContext(value: unknown): StoryboardStoryFactsContext | null {
  const issues: StoryboardDirectorV12ValidationIssue[] = [];
  const context = parseStoryFactsContext(value, "$.storyFactsContext", issues);
  return context && issues.length === 0 ? context : null;
}

export function normalizeStoryboardStoryFactLocks(
  value: unknown,
  context: StoryboardStoryFactsContext,
): StoryboardStoryFactLocks | null {
  const issues: StoryboardDirectorV12ValidationIssue[] = [];
  const locks = parseStoryFactLocks(value, context, "$.storyFactLocks", issues);
  return locks && issues.length === 0 ? locks : null;
}

export function normalizeStoryboardStructuredTrace(value: unknown): {
  storyFactsContext: StoryboardStoryFactsContext;
  shots: Array<{
    sourceShotId: string;
    exitState: string;
    storyFactLocks: StoryboardStoryFactLocks;
  }>;
} | null {
  const record = asRecord(value);
  if (!record) return null;
  const rawContext = record.storyFactsContext ?? record.story_facts_context;
  const storyFactsContext = normalizeStoryboardStoryFactsContext(rawContext);
  const rawShots = Array.isArray(record.shots) ? record.shots : null;
  if (!storyFactsContext || !rawShots) return null;
  const issues: StoryboardDirectorV12ValidationIssue[] = [];
  const validatedShots: StoryboardDirectorV12ValidatedShot[] = [];
  for (let index = 0; index < rawShots.length; index += 1) {
    const shotRecord = asRecord(rawShots[index]);
    if (!shotRecord) return null;
    const purpose = asRecord(shotRecord.purpose);
    const sourceShotId =
      typeof shotRecord.sourceShotId === "string"
        ? shotRecord.sourceShotId.trim()
        : typeof shotRecord.source_shot_id === "string"
          ? shotRecord.source_shot_id.trim()
          : "";
    const exitState =
      typeof shotRecord.exitState === "string"
        ? shotRecord.exitState.trim()
        : typeof shotRecord.exit_state === "string"
          ? shotRecord.exit_state.trim()
          : "";
    const continuityFromPrev =
      purpose && typeof purpose.continuity === "string"
        ? purpose.continuity.trim()
        : typeof shotRecord.continuity === "string"
          ? shotRecord.continuity.trim()
          : "";
    const storyFactLocks = parseStoryFactLocks(
      shotRecord.storyFactLocks ?? shotRecord.story_fact_locks,
      storyFactsContext,
      `$.shots[${index}].storyFactLocks`,
      issues,
    );
    if (!sourceShotId || !exitState || !continuityFromPrev || !storyFactLocks) return null;
    validatedShots.push({
      record: shotRecord,
      shotId: sourceShotId,
      exitState,
      continuityFromPrev,
      storyFactLocks,
    });
  }
  validateTraceInvariants(storyFactsContext, validatedShots, issues);
  if (issues.length > 0) return null;
  return {
    storyFactsContext,
    shots: validatedShots.map((shot) => ({
      sourceShotId: shot.shotId,
      exitState: shot.exitState,
      storyFactLocks: shot.storyFactLocks,
    })),
  };
}

export type StoryboardDirectorV12ExpectedContext =
  | {
      mode: "book_ledger";
      bookId: string;
      ledgerRevision: number;
      effectiveAt: { chapter: number; sequence: number };
      facts: readonly StoryboardExpectedStoryFactPolicy[];
    }
  | {
      mode: "task_context";
      allowedContextKeys: readonly string[];
    };

export function validateExpectedContext(
  context: StoryboardStoryFactsContext,
  shots: StoryboardDirectorV12ValidatedShot[],
  expected: StoryboardDirectorV12ExpectedContext,
  issues: StoryboardDirectorV12ValidationIssue[],
): void {
  if (context.mode !== expected.mode) {
    pushIssue(issues, "story_facts_expected_mode_mismatch", "$.storyFactsContext.mode", "事实来源模式与本轮真实上下文不一致");
    return;
  }
  if (expected.mode === "book_ledger" && context.mode === "book_ledger") {
    if (context.bookId !== expected.bookId) {
      pushIssue(issues, "story_facts_book_id_mismatch", "$.storyFactsContext.bookId", "bookId 与本轮真实账本不一致");
    }
    if (context.ledgerRevision !== expected.ledgerRevision) {
      pushIssue(
        issues,
        "story_facts_ledger_revision_mismatch",
        "$.storyFactsContext.ledgerRevision",
        "ledgerRevision 与本轮真实账本不一致",
      );
    }
    if (
      context.effectiveAt.chapter !== expected.effectiveAt.chapter ||
      context.effectiveAt.sequence !== expected.effectiveAt.sequence
    ) {
      pushIssue(
        issues,
        "story_facts_effective_at_mismatch",
        "$.storyFactsContext.effectiveAt",
        "effectiveAt 与本轮真实故事点不一致",
      );
    }
    const factById = new Map<string, StoryboardExpectedStoryFactPolicy>();
    for (const fact of expected.facts) {
      if (factById.has(fact.factId)) {
        pushIssue(
          issues,
          "expected_story_fact_duplicate",
          "$.storyFactsContext.consumedFactIds",
          `权威账本快照包含重复 factId: ${fact.factId}`,
        );
        continue;
      }
      factById.set(fact.factId, fact);
    }
    for (const factId of context.consumedFactIds) {
      if (!factById.has(factId)) {
        pushIssue(issues, "story_fact_not_in_source_snapshot", "$.storyFactsContext.consumedFactIds", `factId 不属于本轮账本快照: ${factId}`);
      }
    }
    for (let index = 0; index < shots.length; index += 1) {
      const effectiveAt = shots[index].storyFactLocks.effectiveAt;
      if (!effectiveAt) {
        pushIssue(
          issues,
          "shot_story_point_missing",
          `$.shots[${index}].storyFactLocks.effectiveAt`,
          "book_ledger 镜头必须提供事实故事点",
        );
        continue;
      }
      for (let bindingIndex = 0; bindingIndex < shots[index].storyFactLocks.bindings.length; bindingIndex += 1) {
        const binding = shots[index].storyFactLocks.bindings[bindingIndex];
        if (binding.source !== "story_fact") continue;
        const bindingPath = `$.shots[${index}].storyFactLocks.bindings[${bindingIndex}]`;
        const fact = factById.get(binding.factId);
        if (!fact) {
          pushIssue(
            issues,
            "story_fact_not_in_source_snapshot",
            `${bindingPath}.factId`,
            `factId 不属于本轮权威账本快照: ${binding.factId}`,
          );
          continue;
        }
        if (!isExpectedStoryFactActiveAt(fact, effectiveAt)) {
          pushIssue(
            issues,
            "story_fact_not_active_at_shot",
            `${bindingPath}.factId`,
            `factId 在当前镜头故事点并非有效事实: ${binding.factId}`,
          );
        }
        if (binding.category !== fact.category) {
          pushIssue(
            issues,
            "story_fact_category_mismatch",
            `${bindingPath}.category`,
            `category 与权威账本不一致: ${binding.factId}`,
          );
        }
        if (binding.status !== fact.status) {
          pushIssue(
            issues,
            "story_fact_status_mismatch",
            `${bindingPath}.status`,
            `status 与权威账本不一致: ${binding.factId}`,
          );
        }
        const disclosed = isExpectedStoryFactDisclosedAt(fact, effectiveAt);
        if (!disclosed && binding.visibility !== "hidden") {
          pushIssue(
            issues,
            "story_fact_hidden_visibility_required",
            `${bindingPath}.visibility`,
            `factId 尚未到权威揭示点，visibility 必须为 hidden: ${binding.factId}`,
          );
        }
        if (disclosed && binding.visibility === "hidden") {
          pushIssue(
            issues,
            "story_fact_hidden_visibility_forbidden",
            `${bindingPath}.visibility`,
            `factId 已到权威揭示点，不得继续标记 hidden: ${binding.factId}`,
          );
        }
        if (!disclosed && fact.disclosure.mode === "gated") {
          const guard = shots[index].storyFactLocks.revealGuards.find(
            (candidate): candidate is StoryboardStoryFactRevealGuard =>
              candidate.source === "story_fact" && candidate.factId === binding.factId,
          );
          if (!guard) {
            pushIssue(
              issues,
              "story_fact_authoritative_guard_missing",
              `$.shots[${index}].storyFactLocks.revealGuards`,
              `尚未揭示的 factId 缺少权威 reveal guard: ${binding.factId}`,
            );
          } else if (!storyPointCoordinatesEqual(guard.notBefore, fact.disclosure.revealAt)) {
            pushIssue(
              issues,
              "story_fact_authoritative_reveal_point_mismatch",
              `$.shots[${index}].storyFactLocks.revealGuards`,
              `reveal guard 的 notBefore 与权威 disclosure.revealAt 不一致: ${binding.factId}`,
            );
          }
        }
      }
    }
    return;
  }
  if (expected.mode === "task_context" && context.mode === "task_context") {
    const allowedContextKeys = new Set(expected.allowedContextKeys);
    for (const contextKey of context.consumedContextKeys) {
      if (!allowedContextKeys.has(contextKey)) {
        pushIssue(
          issues,
          "task_context_key_not_in_source_snapshot",
          "$.storyFactsContext.consumedContextKeys",
          `contextKey 不属于本轮显式上下文: ${contextKey}`,
        );
      }
    }
  }
}

function storyPointCoordinatesEqual(left: StoryboardStoryPoint, right: StoryboardStoryPoint): boolean {
  return left.chapter === right.chapter && left.sequence === right.sequence;
}

function isExpectedStoryFactActiveAt(
  fact: StoryboardExpectedStoryFactPolicy,
  point: StoryboardStoryPoint,
): boolean {
  if (compareStoryPoints(fact.validFrom, point) > 0) return false;
  return fact.validUntil === null || compareStoryPoints(point, fact.validUntil) < 0;
}

function isExpectedStoryFactDisclosedAt(
  fact: StoryboardExpectedStoryFactPolicy,
  point: StoryboardStoryPoint,
): boolean {
  return fact.disclosure.mode === "immediate" || compareStoryPoints(point, fact.disclosure.revealAt) >= 0;
}

export function validateStoryboardDirectorV12Contract(
  value: unknown,
  options: { expectedShotCount?: number; expectedContext?: StoryboardDirectorV12ExpectedContext } = {},
): StoryboardDirectorV12ValidationResult {
  const issues: StoryboardDirectorV12ValidationIssue[] = [];
  const record = asRecord(value);
  if (!record) {
    return {
      ok: false,
      issues: [{ code: "storyboard_root_invalid", path: "$", message: "分镜输出必须是 JSON 对象" }],
    };
  }
  const schemaVersion = typeof record.schemaVersion === "string" ? record.schemaVersion.trim() : "";
  if (schemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          code: "storyboard_schema_version_invalid",
          path: "$.schemaVersion",
          message: `schemaVersion 必须是 ${STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION}`,
        },
      ],
    };
  }

  const { globalStyle, rawShots } = validateCoreArtifactShape(record, issues);
  const storyFactsContext = parseStoryFactsContext(record.storyFactsContext, "$.storyFactsContext", issues);
  if (rawShots && rawShots.length > 128) {
    pushIssue(issues, "storyboard_shot_count_above_limit", "$.shots", "shots 最多允许 128 项");
  }
  if (options.expectedShotCount !== undefined && rawShots && rawShots.length !== options.expectedShotCount) {
    pushIssue(
      issues,
      "storyboard_shot_count_invalid",
      "$.shots",
      `期望 ${options.expectedShotCount} 个镜头，实际 ${rawShots.length}`,
    );
  }

  const shots: StoryboardDirectorV12ValidatedShot[] = [];
  for (let index = 0; index < (rawShots?.length ?? 0); index += 1) {
    const shotRecord = asRecord(rawShots?.[index]);
    if (!shotRecord) {
      pushIssue(issues, "storyboard_shot_invalid", `$.shots[${index}]`, "shot 必须是对象");
      continue;
    }
    const core = validateShotCore(shotRecord, index, issues);
    if (!storyFactsContext) continue;
    const storyFactLocks = parseStoryFactLocks(
      shotRecord.storyFactLocks,
      storyFactsContext,
      `$.shots[${index}].storyFactLocks`,
      issues,
    );
    if (!core.shotId || !core.exitState || !core.continuityFromPrev || !storyFactLocks) continue;
    shots.push({
      record: shotRecord,
      shotId: core.shotId,
      exitState: core.exitState,
      continuityFromPrev: core.continuityFromPrev,
      storyFactLocks,
    });
  }

  if (storyFactsContext) {
    validateTraceInvariants(storyFactsContext, shots, issues);
    if (options.expectedContext) validateExpectedContext(storyFactsContext, shots, options.expectedContext, issues);
  }
  if (issues.length > 0 || !globalStyle || !storyFactsContext || shots.length !== (rawShots?.length ?? 0)) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      record,
      globalStyle,
      storyFactsContext,
      shots,
    } satisfies StoryboardDirectorV12ValidatedContract,
  };
}
