import { describe, expect, it } from "vitest";
import {
  buildClipQaPrompt,
  formatClipQaFeedback,
  parseClipQaVerdict,
  readClipQaNodeState,
} from "./video-orchestrator.clip-qa";
describe("parseClipQaVerdict", () => {
  it("parses a clean verdict", () => {
    const v = parseClipQaVerdict('{"pass": false, "problems": ["死机位"], "fixHints": ["运镜动词前置"]}');
    expect(v).toEqual({ pass: false, problems: ["死机位"], fixHints: ["运镜动词前置"] });
  });
  it("extracts JSON embedded in prose", () => {
    const v = parseClipQaVerdict('好的，结论如下：\n```json\n{"pass": true, "problems": [], "fixHints": []}\n```\n以上。');
    expect(v?.pass).toBe(true);
  });
  it("returns null on garbage or missing pass field", () => {
    expect(parseClipQaVerdict("这段视频很好")).toBeNull();
    expect(parseClipQaVerdict('{"problems": []}')).toBeNull();
    expect(parseClipQaVerdict("")).toBeNull();
  });
  it("coerces non-string list items and drops empties", () => {
    const v = parseClipQaVerdict('{"pass": false, "problems": ["a", "", 3], "fixHints": null}');
    expect(v).toEqual({ pass: false, problems: ["a", "3"], fixHints: [] });
  });
});

describe("readClipQaNodeState", () => {
  it("reads defaults from empty data", () => {
    expect(readClipQaNodeState(undefined)).toEqual({ verdict: "", attempts: 0, errors: 0, eligible: false });
  });
  it("reads persisted state", () => {
    expect(
      readClipQaNodeState({
        clipQaVerdict: "pass",
        clipQaAttempts: 1,
        clipQaErrorCount: 2,
        selfQaEligible: true,
      }),
    ).toEqual({ verdict: "pass", attempts: 1, errors: 2, eligible: true });
  });
  it("treats blank verdict as no verdict (regen reset shape)", () => {
    expect(readClipQaNodeState({ clipQaVerdict: "  " }).verdict).toBe("");
  });
});

describe("buildClipQaPrompt / formatClipQaFeedback", () => {
  it("embeds clip prompt and duration and demands strict JSON", () => {
    const p = buildClipQaPrompt({ clipPrompt: "方源穿过石缝", durationSeconds: 4 });
    expect(p).toContain("方源穿过石缝");
    expect(p).toContain("4s");
    expect(p).toContain('"pass"');
  });
  it("joins problems and hints into one bounded feedback line", () => {
    const fb = formatClipQaFeedback({ pass: false, problems: ["死机位"], fixHints: ["加跟摇"] });
    expect(fb).toBe("问题：死机位；修复：加跟摇");
  });
});
