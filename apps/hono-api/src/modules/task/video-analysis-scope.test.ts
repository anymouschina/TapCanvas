import { describe, expect, it } from "vitest";
import { buildVideoAnalysisSegmentPrompt } from "./video-analysis-scope";

describe("video analysis input scope", () => {
  it("maps a nonzero segment clock to its source without claiming unseen footage is missing", () => {
    const question = "检查14–17秒衔接以及25–30秒节奏";
    const prompt = buildVideoAnalysisSegmentPrompt({
      question,
      segment: { index: 1, startSec: 15, endSec: 30.255 },
      segmentCount: 2,
      sourceDurationSeconds: 30.255238,
    });
    expect(prompt.startsWith(question)).toBe(true);
    const serialized = prompt.split("【本次实际媒体输入范围】")[1]?.split("\n")[0];
    expect(JSON.parse(serialized ?? "null")).toEqual({
      sourceDurationSeconds: 30.255238,
      segmentIndex: 1,
      segmentCount: 2,
      sourceStartSeconds: 15,
      sourceEndSeconds: 30.255,
      localTimeZeroEqualsSourceSeconds: 15,
      observationScope: "segment_only",
    });
    expect(prompt).toContain("跨越输入边界的问题标为尚无观察证据");
    expect(prompt).toContain("不能据此判定全片缺失");
  });
});
