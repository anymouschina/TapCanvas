import { describe, expect, it } from "vitest";

import {
  doesCompositionImageUrlCarryHash,
  parseKeyframeCompositionContract,
  renderKeyframeCompositionFacts,
  validateCompositionSubjectCoverage,
} from "./keyframe-composition-contract";

const validContract = {
  narrativeTask: "群仙依次穿过宫门，门与队列是第一视觉任务",
  focusKind: "event",
  focusTargetNames: ["入宫队列", "紫霄宫门"],
  focalPoint: [0.36, 0.48],
  shotScale: "establishing",
  environmentVisualWeight: "primary",
  subjects: [
    {
      name: "后土",
      visualWeight: "context",
      depthLayer: "background",
      centerPlacement: "forbidden",
      maxFrameHeightRatio: 0.24,
    },
    {
      name: "孟川",
      visualWeight: "context",
      depthLayer: "background",
      centerPlacement: "forbidden",
      maxFrameHeightRatio: 0.2,
    },
  ],
};

describe("keyframe composition contract", () => {
  it("normalizes a complete contract and produces a stable sha256", () => {
    const first = parseKeyframeCompositionContract(validContract);
    const second = parseKeyframeCompositionContract({ ...validContract });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(renderKeyframeCompositionFacts(first.contract)).toContain(
      "后土=context/background/center:forbidden/maxHeight:0.24",
    );
  });

  it("rejects missing narrative focus and invalid frame ratios instead of defaulting", () => {
    const result = parseKeyframeCompositionContract({
      ...validContract,
      narrativeTask: "",
      focalPoint: [1.2, 0.5],
      subjects: [{ ...validContract.subjects[0], maxFrameHeightRatio: 2 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("|")).toContain("narrativeTask");
    expect(result.issues.join("|")).toContain("focalPoint");
    expect(result.issues.join("|")).toContain("maxFrameHeightRatio");
  });

  it("checks exact subject coverage without semantic inference", () => {
    const parsed = parseKeyframeCompositionContract(validContract);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      validateCompositionSubjectCoverage({
        contract: parsed.contract,
        characterNames: ["后土", "孟川"],
      }),
    ).toEqual([]);
    expect(
      validateCompositionSubjectCoverage({
        contract: parsed.contract,
        characterNames: ["后土", "孟川", "女娲"],
      }).join("|"),
    ).toContain("女娲");
  });

  it("requires the rendered image path to carry the exact contract hash", () => {
    const parsed = parseKeyframeCompositionContract(validContract);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      doesCompositionImageUrlCarryHash(
        `https://cdn.test/gen/${parsed.hash}-render-id.png`,
        parsed.hash,
      ),
    ).toBe(true);
    expect(
      doesCompositionImageUrlCarryHash("https://cdn.test/gen/legacy-render.png", parsed.hash),
    ).toBe(false);
  });
});
