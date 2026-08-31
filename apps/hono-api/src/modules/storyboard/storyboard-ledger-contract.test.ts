import { describe, expect, it } from "vitest";

import { createBookStoryboardDirectorV12Fixture } from "../../../../../packages/schemas/storyboard-director-protocol/test-fixtures";
import type { StoryFactsLedger } from "../agents/story-facts.schemas";
import { validateStoryboardArtifactAgainstLedger } from "./storyboard-ledger-contract";

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected record");
  return value as Record<string, unknown>;
}

function readShot(payload: Record<string, unknown>, index: number): Record<string, unknown> {
  const shots = Array.isArray(payload.shots) ? payload.shots : [];
  return readRecord(shots[index]);
}

function createLedger(): StoryFactsLedger {
  const now = "2026-07-30T00:00:00.000Z";
  const source = {
    kind: "book_chapter" as const,
    projectId: "project-archive-night",
    bookId: "book-archive-night",
    chapter: 5,
    contentSha256: "a".repeat(64),
    contentChars: 100,
    capturedAt: now,
  };
  const facts: StoryFactsLedger["facts"] = [
    {
      factId: "fact_injury_xuzhou_left_wrist",
      subject: { kind: "character_state", key: "character:xuzhou:left-wrist", name: "许舟左腕" },
      predicate: "状态",
      value: "骨裂固定",
      status: "confirmed",
      validFrom: { chapter: 1, sequence: 0 },
      validUntil: null,
      disclosure: { mode: "immediate", revealAt: null },
      source,
      createdRevision: 1,
      updatedRevision: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      factId: "fact_prop_copper_key_owner",
      subject: { kind: "prop", key: "prop:copper-key", name: "铜钥匙" },
      predicate: "持有人",
      value: "顾宁",
      status: "confirmed",
      validFrom: { chapter: 1, sequence: 0 },
      validUntil: null,
      disclosure: { mode: "immediate", revealAt: null },
      source,
      createdRevision: 2,
      updatedRevision: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      factId: "fact_xuzhou_suspicion_letter",
      subject: { kind: "knowledge", key: "knowledge:xuzhou:letter", name: "许舟的怀疑" },
      predicate: "认知",
      value: "顾宁隐瞒来信",
      status: "inferred",
      validFrom: { chapter: 5, sequence: 0 },
      validUntil: null,
      disclosure: { mode: "immediate", revealAt: null },
      source,
      createdRevision: 3,
      updatedRevision: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      factId: "fact_hidden_relation_04",
      subject: { kind: "relationship", key: "relationship:hidden-04", name: "隐藏关系" },
      predicate: "真实关系",
      value: "秘密正文",
      status: "confirmed",
      validFrom: { chapter: 1, sequence: 0 },
      validUntil: null,
      disclosure: { mode: "gated", revealAt: { chapter: 7, sequence: 0 } },
      source,
      createdRevision: 4,
      updatedRevision: 4,
      createdAt: now,
      updatedAt: now,
    },
  ];
  return {
    schemaVersion: 2,
    projectId: "project-archive-night",
    bookId: "book-archive-night",
    revision: 12,
    facts,
    commits: [],
    updatedAt: now,
  };
}

describe("storyboard ledger contract", () => {
  it("accepts a v1.2 artifact bound to the fresh schema-v2 ledger", () => {
    const result = validateStoryboardArtifactAgainstLedger({
      artifact: createBookStoryboardDirectorV12Fixture(),
      expectedShotCount: 2,
      expectedBookId: "book-archive-night",
      expectedChapter: 5,
      ledger: createLedger(),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects stale revisions and model-reported hidden visibility overrides", () => {
    const stale = createBookStoryboardDirectorV12Fixture();
    readRecord(stale.storyFactsContext).ledgerRevision = 11;
    const staleResult = validateStoryboardArtifactAgainstLedger({
      artifact: stale,
      expectedShotCount: 2,
      expectedBookId: "book-archive-night",
      expectedChapter: 5,
      ledger: createLedger(),
    });
    expect(staleResult.ok).toBe(false);
    if (!staleResult.ok) {
      expect(staleResult.issues.map((issue) => issue.code)).toContain(
        "story_facts_ledger_revision_mismatch",
      );
    }

    const visibilitySpoof = createBookStoryboardDirectorV12Fixture();
    for (let index = 0; index < 2; index += 1) {
      const locks = readRecord(readShot(visibilitySpoof, index).storyFactLocks);
      const bindings = Array.isArray(locks.bindings) ? locks.bindings : [];
      const hiddenBinding = readRecord(bindings[3]);
      hiddenBinding.visibility = "objective";
      hiddenBinding.directive = "伪报为已揭示事实";
      locks.revealGuards = [];
    }
    const spoofResult = validateStoryboardArtifactAgainstLedger({
      artifact: visibilitySpoof,
      expectedShotCount: 2,
      expectedBookId: "book-archive-night",
      expectedChapter: 5,
      ledger: createLedger(),
    });
    expect(spoofResult.ok).toBe(false);
    if (!spoofResult.ok) {
      expect(spoofResult.issues.map((issue) => issue.code)).toContain(
        "story_fact_hidden_visibility_required",
      );
    }
  });

  it("rejects a story point from another chapter", () => {
    const artifact = createBookStoryboardDirectorV12Fixture();
    const context = readRecord(artifact.storyFactsContext);
    context.effectiveAt = { chapter: 6, sequence: 10 };
    const firstLocks = readRecord(readShot(artifact, 0).storyFactLocks);
    firstLocks.effectiveAt = { chapter: 6, sequence: 10 };
    const secondLocks = readRecord(readShot(artifact, 1).storyFactLocks);
    secondLocks.effectiveAt = { chapter: 6, sequence: 11 };

    const result = validateStoryboardArtifactAgainstLedger({
      artifact,
      expectedShotCount: 2,
      expectedBookId: "book-archive-night",
      expectedChapter: 5,
      ledger: createLedger(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        "story_facts_effective_at_mismatch",
      );
    }
  });
});
