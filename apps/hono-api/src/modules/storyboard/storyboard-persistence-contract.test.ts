import { describe, expect, it } from "vitest";
import { createBookStoryboardDirectorV12Fixture } from "../../../../../packages/schemas/storyboard-director-protocol/test-fixtures";
import { deriveShotPromptsFromStructuredData, normalizeStoryboardStructuredData } from "./storyboard-structure";
import {
  canonicalizeStoryboardArtifact,
  requireExactStoryboardPreviousChunk,
  requireStoryboardV12ArtifactPayload,
  sha256StoryboardArtifactCanonical,
} from "./storyboard-persistence-contract";

describe("storyboard persistence contract", () => {
  it("requires the exact direct predecessor and never recovers tail state from frameUrls", () => {
    const chunks = [
      {
        chunkId: "chunk-direct",
        taskId: "task-a",
        chapter: 5,
        groupSize: 25 as const,
        chunkIndex: 0,
        tailFrameUrl: "https://assets.example.com/tail-direct.png",
        frameUrls: ["https://assets.example.com/frame-direct.png"],
      },
      {
        chunkId: "chunk-other-task",
        taskId: "task-b",
        chapter: 5,
        groupSize: 25 as const,
        chunkIndex: 0,
        tailFrameUrl: "https://assets.example.com/tail-other.png",
        frameUrls: ["https://assets.example.com/frame-other.png"],
      },
    ];

    expect(requireExactStoryboardPreviousChunk({
      chunks,
      taskId: "task-a",
      chapter: 5,
      groupSize: 25,
      chunkIndex: 1,
      previousChunkId: "chunk-direct",
      contextLabel: "test",
    })?.chunkId).toBe("chunk-direct");

    expect(() => requireExactStoryboardPreviousChunk({
      chunks,
      taskId: "task-a",
      chapter: 5,
      groupSize: 25,
      chunkIndex: 1,
      previousChunkId: "chunk-other-task",
      contextLabel: "test",
    })).toThrow(/不构成直接前驱关系/);

    expect(() => requireExactStoryboardPreviousChunk({
      chunks: [{
        ...chunks[0],
        tailFrameUrl: "",
        frameUrls: ["https://assets.example.com/frame-fallback-must-not-be-used.png"],
      }],
      taskId: "task-a",
      chapter: 5,
      groupSize: 25,
      chunkIndex: 1,
      previousChunkId: "chunk-direct",
      contextLabel: "test",
    })).toThrow(/缺少真实 tailFrameUrl/);

    expect(() => requireExactStoryboardPreviousChunk({
      chunks,
      taskId: "task-a",
      chapter: 5,
      groupSize: 25,
      chunkIndex: 1,
      contextLabel: "test",
    })).toThrow(/必须提供 previousChunkId/);
  });

  it("uses v1.2 structured data as the only prompt source", () => {
    const source = createBookStoryboardDirectorV12Fixture();
    const structured = normalizeStoryboardStructuredData(source);
    const derived = deriveShotPromptsFromStructuredData(structured);
    const result = requireStoryboardV12ArtifactPayload({
      storyboardStructured: source,
      shotPrompts: derived,
      maxShotPrompts: 128,
      contextLabel: "test",
    });
    expect(result.structured).toEqual(structured);
    expect(result.shotPrompts).toEqual(derived);
    expect(result.handoffEvidence).toBeNull();
  });

  it("rejects v1.1, unversioned structured data, and direct prompt divergence", () => {
    expect(() =>
      requireStoryboardV12ArtifactPayload({
        storyboardStructured: {
          schemaVersion: "storyboard-director/v1.1",
          shots: [{ prompt_text: "V11_PROMPT_BYPASS" }],
        },
        shotPrompts: ["V11_PROMPT_BYPASS"],
        maxShotPrompts: 128,
        contextLabel: "test",
      }),
    ).toThrow(/storyboard-director\/v1\.2/);

    expect(() =>
      requireStoryboardV12ArtifactPayload({
        storyboardStructured: {
          shots: [
            {
              dramatic_beat: "旧结构",
              story_purpose: "旧结构",
              render_prompt: "UNVERSIONED_PROMPT_BYPASS",
            },
          ],
        },
        maxShotPrompts: 128,
        contextLabel: "test",
      }),
    ).toThrow(/storyboard-director\/v1\.2/);

    const source = createBookStoryboardDirectorV12Fixture();
    expect(() =>
      requireStoryboardV12ArtifactPayload({
        storyboardStructured: source,
        shotPrompts: ["与事实 trace 不一致的提示词"],
        maxShotPrompts: 128,
        contextLabel: "test",
      }),
    ).toThrow(/不一致/);
  });

  it("requires exact cross-chunk exit-state and non-regressing story-point handoff", () => {
    const previousSource = createBookStoryboardDirectorV12Fixture();
    const previous = normalizeStoryboardStructuredData(previousSource);
    if (!previous) throw new Error("expected previous structured storyboard");
    const currentSource = createBookStoryboardDirectorV12Fixture();
    const currentShots = Array.isArray(currentSource.shots) ? currentSource.shots : [];
    const previousExitState = previous.shots[previous.shots.length - 1]?.exitState;
    const firstShot = currentShots[0] as Record<string, unknown>;
    const firstContinuity = firstShot.continuity as Record<string, unknown>;
    firstContinuity.fromPrev = previousExitState;
    const firstLocks = firstShot.storyFactLocks as Record<string, unknown>;
    firstLocks.effectiveAt = { chapter: 5, sequence: 12 };
    const secondShot = currentShots[1] as Record<string, unknown>;
    const secondLocks = secondShot.storyFactLocks as Record<string, unknown>;
    secondLocks.effectiveAt = { chapter: 5, sequence: 13 };
    const currentContext = currentSource.storyFactsContext as Record<string, unknown>;
    currentContext.effectiveAt = { chapter: 5, sequence: 12 };
    currentContext.ledgerRevision = 13;
    const result = requireStoryboardV12ArtifactPayload({
      storyboardStructured: currentSource,
      previousStoryboardArtifact: previousSource,
      requirePreviousHandoff: true,
      maxShotPrompts: 128,
      contextLabel: "test",
    });
    expect(result.handoffEvidence).toMatchObject({
      previousExitState,
      currentEntryState: previousExitState,
      previousEffectiveAt: { chapter: 5, sequence: 11 },
      currentEffectiveAt: { chapter: 5, sequence: 12 },
    });

    const brokenCurrent = structuredClone(currentSource);
    const brokenShots = Array.isArray(brokenCurrent.shots) ? brokenCurrent.shots : [];
    const brokenFirstShot = brokenShots[0] as Record<string, unknown>;
    const brokenContinuity = brokenFirstShot.continuity as Record<string, unknown>;
    brokenContinuity.fromPrev = "错误的跨分组进入态";
    expect(() =>
      requireStoryboardV12ArtifactPayload({
        storyboardStructured: brokenCurrent,
        previousStoryboardArtifact: previousSource,
        requirePreviousHandoff: true,
        maxShotPrompts: 128,
        contextLabel: "test",
      }),
    ).toThrow(/上一分组 exitState 不一致/);

    const regressedCurrent = structuredClone(currentSource);
    const regressedShots = Array.isArray(regressedCurrent.shots) ? regressedCurrent.shots : [];
    const regressedFirstShot = regressedShots[0] as Record<string, unknown>;
    const regressedFirstLocks = regressedFirstShot.storyFactLocks as Record<string, unknown>;
    regressedFirstLocks.effectiveAt = { chapter: 5, sequence: 10 };
    const regressedContext = regressedCurrent.storyFactsContext as Record<string, unknown>;
    regressedContext.effectiveAt = { chapter: 5, sequence: 10 };
    expect(() =>
      requireStoryboardV12ArtifactPayload({
        storyboardStructured: regressedCurrent,
        previousStoryboardArtifact: previousSource,
        requirePreviousHandoff: true,
        maxShotPrompts: 128,
        contextLabel: "test",
      }),
    ).toThrow(/早于上一分组尾镜/);
  });

  it("canonicalizes object keys recursively while preserving array order", () => {
    const left = {
      z: [{ second: 2, first: 1 }, "tail"],
      a: { beta: true, alpha: null },
    };
    const right = {
      a: { alpha: null, beta: true },
      z: [{ first: 1, second: 2 }, "tail"],
    };

    expect(canonicalizeStoryboardArtifact(left)).toBe(
      '{"a":{"alpha":null,"beta":true},"z":[{"first":1,"second":2},"tail"]}',
    );
    expect(sha256StoryboardArtifactCanonical(left)).toBe(
      sha256StoryboardArtifactCanonical(right),
    );
    expect(sha256StoryboardArtifactCanonical(left)).toBe(
      "9598597c10917ccd2b5fdd455c777046b0078cce2a7e4a2f1e22016439760756",
    );
    expect(sha256StoryboardArtifactCanonical({ values: [1, 2] })).not.toBe(
      sha256StoryboardArtifactCanonical({ values: [2, 1] }),
    );
  });

  it("returns the canonical artifact hash with the validated v1.2 payload", () => {
    const source = createBookStoryboardDirectorV12Fixture();
    const result = requireStoryboardV12ArtifactPayload({
      storyboardStructured: source,
      maxShotPrompts: 128,
      contextLabel: "test",
    });

    expect(result.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifactSha256).toBe(sha256StoryboardArtifactCanonical(source));
    expect(result.artifactSha256).toBe(sha256StoryboardArtifactCanonical(result.artifact));
  });

  it("keeps initial and atomic revalidation identities stable and detects artifact mutation", () => {
    const source = createBookStoryboardDirectorV12Fixture();
    const initial = requireStoryboardV12ArtifactPayload({
      storyboardStructured: source,
      maxShotPrompts: 128,
      contextLabel: "initial validation",
    });
    const atomic = requireStoryboardV12ArtifactPayload({
      storyboardStructured: structuredClone(source),
      maxShotPrompts: 128,
      contextLabel: "atomic validation",
    });
    expect(atomic.artifactSha256).toBe(initial.artifactSha256);

    const mutated = structuredClone(source);
    const shots = Array.isArray(mutated.shots) ? mutated.shots : [];
    const firstShot = shots[0] as Record<string, unknown>;
    const prompt = firstShot.prompt as Record<string, unknown>;
    prompt.cn = `${String(prompt.cn || "")} 增加一道门缝冷光。`;
    const mutatedAtomic = requireStoryboardV12ArtifactPayload({
      storyboardStructured: mutated,
      maxShotPrompts: 128,
      contextLabel: "atomic validation",
    });
    expect(mutatedAtomic.artifactSha256).not.toBe(initial.artifactSha256);
  });

  it("fails explicitly for undefined, non-finite, sparse, and cyclic artifact values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = new Array<unknown>(1);

    for (const invalid of [
      { value: undefined },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: sparse },
      cyclic,
    ]) {
      expect(() => canonicalizeStoryboardArtifact(invalid)).toThrow(
        /storyboard artifact 无法 canonicalize/,
      );
    }
  });
});
