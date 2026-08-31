import { describe, expect, it } from "vitest";
import {
  createBookStoryboardDirectorV12Fixture,
  createTaskStoryboardDirectorV12Fixture,
} from "../../../../../packages/schemas/storyboard-director-protocol/test-fixtures";
import {
  deriveShotPromptsFromStructuredData,
  normalizeStoryboardStructuredData,
  validateStoryboardDirectorV12Contract,
} from "./storyboard-structure";
import type { StoryboardDirectorV12ExpectedContext } from "./storyboard-structure";

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected record");
  return value as Record<string, unknown>;
}

function readShot(payload: Record<string, unknown>, index: number): Record<string, unknown> {
  const shots = Array.isArray(payload.shots) ? payload.shots : [];
  return readRecord(shots[index]);
}

function createExpectedBookContext(): StoryboardDirectorV12ExpectedContext {
  return {
    mode: "book_ledger",
    bookId: "book-archive-night",
    ledgerRevision: 12,
    effectiveAt: { chapter: 5, sequence: 10 },
    facts: [
      {
        factId: "fact_injury_xuzhou_left_wrist",
        category: "character_state",
        status: "confirmed",
        validFrom: { chapter: 1, sequence: 0 },
        validUntil: null,
        disclosure: { mode: "immediate", revealAt: null },
      },
      {
        factId: "fact_prop_copper_key_owner",
        category: "prop",
        status: "confirmed",
        validFrom: { chapter: 1, sequence: 0 },
        validUntil: null,
        disclosure: { mode: "immediate", revealAt: null },
      },
      {
        factId: "fact_xuzhou_suspicion_letter",
        category: "knowledge",
        status: "inferred",
        validFrom: { chapter: 5, sequence: 0 },
        validUntil: null,
        disclosure: { mode: "immediate", revealAt: null },
      },
      {
        factId: "fact_hidden_relation_04",
        category: "relationship",
        status: "confirmed",
        validFrom: { chapter: 1, sequence: 0 },
        validUntil: null,
        disclosure: {
          mode: "gated",
          revealAt: { chapter: 7, sequence: 0 },
        },
      },
    ],
  };
}

describe("storyboard structure helpers", () => {
  it("normalizes storyboard-director v1.2 and preserves traceable story locks", () => {
    const payload = createBookStoryboardDirectorV12Fixture();
    const validation = validateStoryboardDirectorV12Contract(payload, {
      expectedShotCount: 2,
      expectedContext: createExpectedBookContext(),
    });
    expect(validation.ok).toBe(true);

    const structured = normalizeStoryboardStructuredData(payload);
    expect(structured?.sourceSchemaVersion).toBe("storyboard-director/v1.2");
    expect(structured?.storyFactsContext).toMatchObject({
      mode: "book_ledger",
      bookId: "book-archive-night",
      ledgerRevision: 12,
    });
    expect(structured?.shots).toHaveLength(2);
    expect(structured?.shots[0]?.sourceShotId).toBe("SHOT_01");
    expect(structured?.shots[0]?.exitState).toContain("空白信封");
    expect(structured?.shots[1]?.purpose.continuity).toBe(structured?.shots[0]?.exitState);
    expect(structured?.shots[0]?.storyFactLocks?.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factId: "fact_hidden_relation_04", visibility: "hidden" }),
      ]),
    );

    const prompt = structured?.shots[0]?.render.promptText || "";
    expect(prompt).toContain("客观事实锁");
    expect(prompt).toContain("视角认知锁");
    expect(prompt).toContain("叙事保密锁");
    expect(prompt).toContain("许舟左手腕骨裂");
    expect(prompt).toContain("铜钥匙仍由顾宁持有");
    expect(prompt).toContain("镜尾客观状态");
    expect(prompt).not.toContain("fact_hidden_relation_04");

    if (!structured) throw new Error("expected structured storyboard");
    expect(normalizeStoryboardStructuredData(structured)).toBeNull();
    expect(deriveShotPromptsFromStructuredData(structured)).toEqual(
      structured.shots.map((shot) => shot.render.promptText),
    );
  });

  it("returns allowed enum values in structural story-fact diagnostics", () => {
    const payload = createBookStoryboardDirectorV12Fixture();
    const locks = readRecord(readShot(payload, 0).storyFactLocks);
    const bindings = Array.isArray(locks.bindings) ? locks.bindings : [];
    const binding = readRecord(bindings[0]);
    binding.status = "locked";
    binding.visibility = "public";
    binding.source = "unknown_source";

    const result = validateStoryboardDirectorV12Contract(payload, {
      expectedShotCount: 2,
      expectedContext: createExpectedBookContext(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diagnostics = result.issues.map((issue) => issue.message).join(" | ");
      expect(diagnostics).toContain("confirmed | inferred | draft_choice");
      expect(diagnostics).toContain("objective | viewpoint_only | hidden");
      expect(diagnostics).toContain("story_fact | task_context");
    }
  });

  it("binds visibility, status, category, activity, and reveal guards to the authoritative ledger", () => {
    const valid = validateStoryboardDirectorV12Contract(createBookStoryboardDirectorV12Fixture(), {
      expectedContext: createExpectedBookContext(),
    });
    expect(valid.ok).toBe(true);

    const visibilitySpoof = createBookStoryboardDirectorV12Fixture();
    for (let index = 0; index < 2; index += 1) {
      const locks = readRecord(readShot(visibilitySpoof, index).storyFactLocks);
      const bindings = Array.isArray(locks.bindings) ? locks.bindings : [];
      const hiddenBinding = readRecord(bindings[3]);
      hiddenBinding.visibility = "objective";
      hiddenBinding.directive = "模型自行伪报为已揭示事实";
      locks.revealGuards = [];
    }
    const visibilityResult = validateStoryboardDirectorV12Contract(visibilitySpoof, {
      expectedContext: createExpectedBookContext(),
    });
    expect(visibilityResult.ok).toBe(false);
    if (!visibilityResult.ok) {
      expect(visibilityResult.issues.map((issue) => issue.code)).toContain(
        "story_fact_hidden_visibility_required",
      );
    }

    const metadataSpoof = createBookStoryboardDirectorV12Fixture();
    const locks = readRecord(readShot(metadataSpoof, 0).storyFactLocks);
    const bindings = Array.isArray(locks.bindings) ? locks.bindings : [];
    const injuryBinding = readRecord(bindings[0]);
    injuryBinding.category = "relationship";
    injuryBinding.status = "draft_choice";
    const metadataResult = validateStoryboardDirectorV12Contract(metadataSpoof, {
      expectedContext: createExpectedBookContext(),
    });
    expect(metadataResult.ok).toBe(false);
    if (!metadataResult.ok) {
      const codes = metadataResult.issues.map((issue) => issue.code);
      expect(codes).toContain("story_fact_category_mismatch");
      expect(codes).toContain("story_fact_status_mismatch");
    }

    const inactiveFactBase = createExpectedBookContext();
    if (inactiveFactBase.mode !== "book_ledger") throw new Error("expected book ledger context");
    const inactiveFact: StoryboardDirectorV12ExpectedContext = {
      ...inactiveFactBase,
      facts: inactiveFactBase.facts.map((fact, index) =>
        index === 0 ? { ...fact, validUntil: { chapter: 5, sequence: 10 } } : fact,
      ),
    };
    const inactiveResult = validateStoryboardDirectorV12Contract(
      createBookStoryboardDirectorV12Fixture(),
      { expectedContext: inactiveFact },
    );
    expect(inactiveResult.ok).toBe(false);
    if (!inactiveResult.ok) {
      expect(inactiveResult.issues.map((issue) => issue.code)).toContain(
        "story_fact_not_active_at_shot",
      );
    }
  });

  it("allows forward shot story points but rejects a wrong entry point or regression", () => {
    const valid = validateStoryboardDirectorV12Contract(createBookStoryboardDirectorV12Fixture(), {
      expectedContext: createExpectedBookContext(),
    });
    expect(valid.ok).toBe(true);

    const wrongEntry = createBookStoryboardDirectorV12Fixture();
    const firstLocks = readRecord(readShot(wrongEntry, 0).storyFactLocks);
    firstLocks.effectiveAt = { chapter: 5, sequence: 9 };
    const wrongEntryResult = validateStoryboardDirectorV12Contract(wrongEntry);
    expect(wrongEntryResult.ok).toBe(false);
    if (!wrongEntryResult.ok) {
      expect(wrongEntryResult.issues.map((issue) => issue.code)).toContain(
        "first_shot_story_point_mismatch",
      );
    }

    const regression = createBookStoryboardDirectorV12Fixture();
    const secondLocks = readRecord(readShot(regression, 1).storyFactLocks);
    secondLocks.effectiveAt = { chapter: 5, sequence: 9 };
    const regressionResult = validateStoryboardDirectorV12Contract(regression);
    expect(regressionResult.ok).toBe(false);
    if (!regressionResult.ok) {
      expect(regressionResult.issues.map((issue) => issue.code)).toContain(
        "shot_story_point_regression",
      );
    }
  });

  it("preserves fractional shot duration in the deterministic v1.2 projection", () => {
    const payload = createBookStoryboardDirectorV12Fixture();
    readShot(payload, 0).durationSec = 2.5;
    readShot(payload, 1).durationSec = 3.75;

    const structured = normalizeStoryboardStructuredData(payload);
    expect(structured?.shots.map((shot) => shot.purpose.durationSec)).toEqual([2.5, 3.75]);
    expect(structured?.totalDurationSec).toBe(6.25);

    if (!structured) throw new Error("expected structured storyboard");
    expect(deriveShotPromptsFromStructuredData(structured)).toHaveLength(2);
    expect(normalizeStoryboardStructuredData(structured)).toBeNull();
  });

  it("hard-rejects storyboard-director v1.1 instead of falling through to legacy shot parsing", () => {
    expect(
      normalizeStoryboardStructuredData({
        schemaVersion: "storyboard-director/v1.1",
        shots: [{ render_prompt: "旧版本不应继续进入生产" }],
      }),
    ).toBeNull();
  });

  it("accepts task_context without fabricated fact IDs or ledger revision", () => {
    const payload = createTaskStoryboardDirectorV12Fixture();
    const validation = validateStoryboardDirectorV12Contract(payload, { expectedShotCount: 2 });
    expect(validation.ok).toBe(true);
    const structured = normalizeStoryboardStructuredData(payload);
    expect(structured?.storyFactsContext).toEqual(
      expect.objectContaining({
        mode: "task_context",
        bookId: null,
        ledgerRevision: null,
        effectiveAt: null,
        consumedFactIds: [],
        consumedContextKeys: ["ctx_001", "ctx_002"],
      }),
    );
  });

  it("rejects missing exit state, fact trace drift, and broken handoff", () => {
    const missingExit = createBookStoryboardDirectorV12Fixture();
    delete readShot(missingExit, 0).exitState;
    const missingExitResult = validateStoryboardDirectorV12Contract(missingExit);
    expect(missingExitResult.ok).toBe(false);
    if (!missingExitResult.ok) {
      expect(missingExitResult.issues.map((issue) => issue.code)).toContain("required_string_missing");
    }

    const traceDrift = createBookStoryboardDirectorV12Fixture();
    const context = readRecord(traceDrift.storyFactsContext);
    context.consumedFactIds = ["fact_injury_xuzhou_left_wrist"];
    const traceDriftResult = validateStoryboardDirectorV12Contract(traceDrift);
    expect(traceDriftResult.ok).toBe(false);
    if (!traceDriftResult.ok) {
      expect(traceDriftResult.issues.map((issue) => issue.code)).toContain("binding_fact_not_consumed");
    }

    const brokenHandoff = createBookStoryboardDirectorV12Fixture();
    const secondContinuity = readRecord(readShot(brokenHandoff, 1).continuity);
    secondContinuity.fromPrev = "与上一镜退出态不一致";
    const brokenHandoffResult = validateStoryboardDirectorV12Contract(brokenHandoff);
    expect(brokenHandoffResult.ok).toBe(false);
    if (!brokenHandoffResult.ok) {
      expect(brokenHandoffResult.issues.map((issue) => issue.code)).toContain("shot_exit_state_handoff_mismatch");
    }
  });

  it("rejects task_context bindings that impersonate story facts", () => {
    const payload = createTaskStoryboardDirectorV12Fixture();
    const locks = readRecord(readShot(payload, 0).storyFactLocks);
    const bindings = Array.isArray(locks.bindings) ? locks.bindings : [];
    bindings[0] = {
      source: "story_fact",
      factId: "fake_fact_id",
      category: "character_state",
      status: "confirmed",
      visibility: "objective",
      directive: "非法伪造账本事实",
    };
    const validation = validateStoryboardDirectorV12Contract(payload);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.map((issue) => issue.code)).toContain("story_fact_source_mode_mismatch");
    }
  });

  it("rejects missing ledger provenance, duplicate consumption, inferred-objective projection, and hidden text", () => {
    const missingProvenance = createBookStoryboardDirectorV12Fixture();
    const missingContext = readRecord(missingProvenance.storyFactsContext);
    delete missingContext.ledgerRevision;
    delete missingContext.effectiveAt;
    const missingResult = validateStoryboardDirectorV12Contract(missingProvenance);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      const codes = missingResult.issues.map((issue) => issue.code);
      expect(codes).toContain("required_number_missing");
      expect(codes).toContain("story_point_invalid");
    }

    const duplicateConsumption = createBookStoryboardDirectorV12Fixture();
    const duplicateContext = readRecord(duplicateConsumption.storyFactsContext);
    const factIds = Array.isArray(duplicateContext.consumedFactIds) ? duplicateContext.consumedFactIds : [];
    duplicateContext.consumedFactIds = [...factIds, factIds[0]];
    const duplicateResult = validateStoryboardDirectorV12Contract(duplicateConsumption);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.issues.map((issue) => issue.code)).toContain("string_array_duplicate");
    }

    const inferredObjective = createBookStoryboardDirectorV12Fixture();
    const inferredLocks = readRecord(readShot(inferredObjective, 0).storyFactLocks);
    const inferredBindings = Array.isArray(inferredLocks.bindings) ? inferredLocks.bindings : [];
    const inferredBinding = readRecord(inferredBindings[2]);
    inferredBinding.visibility = "objective";
    const inferredResult = validateStoryboardDirectorV12Contract(inferredObjective);
    expect(inferredResult.ok).toBe(false);
    if (!inferredResult.ok) {
      expect(inferredResult.issues.map((issue) => issue.code)).toContain("inferred_fact_cannot_be_objective");
    }

    const hiddenText = createBookStoryboardDirectorV12Fixture();
    const hiddenLocks = readRecord(readShot(hiddenText, 0).storyFactLocks);
    const hiddenBindings = Array.isArray(hiddenLocks.bindings) ? hiddenLocks.bindings : [];
    const hiddenBinding = readRecord(hiddenBindings[3]);
    hiddenBinding.directive = "这一字段会把隐藏真相暴露给生成模型";
    const hiddenTextResult = validateStoryboardDirectorV12Contract(hiddenText);
    expect(hiddenTextResult.ok).toBe(false);
    if (!hiddenTextResult.ok) {
      expect(hiddenTextResult.issues.map((issue) => issue.code)).toContain("additional_property_forbidden");
    }
  });

  it("normalizes only the complete storyboard-director/v1.2 artifact", () => {
    const artifact = createBookStoryboardDirectorV12Fixture();
    const structured = normalizeStoryboardStructuredData(artifact);
    const prompts = deriveShotPromptsFromStructuredData(artifact);

    expect(structured?.version).toBe("two_phase_v1");
    expect(structured?.sourceSchemaVersion).toBe("storyboard-director/v1.2");
    expect(structured?.shots).toHaveLength(2);
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => prompt.trim().length > 0)).toBe(true);
  });

  it("rejects unversioned, v1, v1.1, and internal projection-shaped inputs", () => {
    expect(normalizeStoryboardStructuredData({ shots: [{ render_prompt: "legacy" }] })).toBeNull();
    expect(normalizeStoryboardStructuredData({ schemaVersion: "storyboard-director/v1", shots: [] })).toBeNull();
    expect(normalizeStoryboardStructuredData({ schemaVersion: "storyboard-director/v1.1", shots: [] })).toBeNull();
    expect(
      normalizeStoryboardStructuredData({
        version: "two_phase_v1",
        sourceSchemaVersion: "storyboard-director/v1.2",
        shots: [],
      }),
    ).toBeNull();
  });
});
