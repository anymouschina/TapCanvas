import type { StoryFactsLedger } from "../agents/story-facts.schemas";
import {
  validateStoryboardDirectorV12Contract,
  type StoryboardDirectorV12ValidationResult,
  type StoryboardExpectedStoryFactPolicy,
} from "./storyboard-structure";

function toExpectedFactPolicy(
  fact: StoryFactsLedger["facts"][number],
): StoryboardExpectedStoryFactPolicy {
  return {
    factId: fact.factId,
    category: fact.subject.kind,
    status: fact.status,
    validFrom: structuredClone(fact.validFrom),
    validUntil: fact.validUntil ? structuredClone(fact.validUntil) : null,
    disclosure: structuredClone(fact.disclosure),
  };
}

export function validateStoryboardArtifactAgainstLedger(input: {
  artifact: unknown;
  expectedShotCount?: number;
  expectedBookId: string;
  expectedChapter: number;
  ledger: StoryFactsLedger;
}): StoryboardDirectorV12ValidationResult {
  const structural = validateStoryboardDirectorV12Contract(input.artifact, {
    expectedShotCount: input.expectedShotCount,
  });
  if (!structural.ok) return structural;
  if (structural.value.storyFactsContext.mode !== "book_ledger") {
    return {
      ok: false,
      issues: [
        {
          code: "story_facts_expected_mode_mismatch",
          path: "$.storyFactsContext.mode",
          message: "真实 book 的章节分镜必须使用 book_ledger 事实来源模式",
        },
      ],
    };
  }
  if (input.ledger.bookId !== input.expectedBookId) {
    return {
      ok: false,
      issues: [
        {
          code: "story_facts_ledger_identity_mismatch",
          path: "$.storyFactsContext.bookId",
          message: "读取到的 Story Facts 账本不属于当前 book",
        },
      ],
    };
  }
  return validateStoryboardDirectorV12Contract(input.artifact, {
    expectedShotCount: input.expectedShotCount,
    expectedContext: {
      mode: "book_ledger",
      bookId: input.expectedBookId,
      ledgerRevision: input.ledger.revision,
      effectiveAt: {
        chapter: input.expectedChapter,
        sequence: structural.value.storyFactsContext.effectiveAt.sequence,
      },
      facts: input.ledger.facts.map(toExpectedFactPolicy),
    },
  });
}
