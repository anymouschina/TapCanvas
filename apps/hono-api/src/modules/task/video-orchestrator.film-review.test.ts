import { describe, it, expect } from "vitest";
import {
  FILM_REVIEW_MAX_ERRORS,
  buildFilmReviewPrompt,
  formatFilmReviewNodeData,
  parseFilmReviewVerdict,
  readFilmReviewState,
} from "./video-orchestrator.film-review";

describe("video-orchestrator.film-review", () => {
  describe("parseFilmReviewVerdict — 宽容解析", () => {
    it("合法 pass verdict 完整解析", () => {
      const v = parseFilmReviewVerdict(
        JSON.stringify({
          verdict: "pass",
          score: 7,
          dimensionScores: {
            fidelity: 9,
            visual: 9,
            motion: 9,
            coherence: 9,
            aesthetic: 8,
            usable: 10,
            overall: 92,
          },
          failedCriteria: [],
          passCriteria: ["V1", "V2", "V3", "V4", "V5", "V6", "V7"],
          suggestion: "",
        }),
      );
      expect(v).not.toBeNull();
      expect(v!.verdict).toBe("pass");
      expect(v!.score).toBe(7);
      expect(v!.dimensionScores?.overall).toBe(92);
      expect(v!.passCriteria).toHaveLength(7);
      expect(v!.failedCriteria).toHaveLength(0);
    });

    it("fail verdict 带 failedCriteria", () => {
      const v = parseFilmReviewVerdict(
        '前面有废话 {"verdict":"fail","score":5,"failedCriteria":[{"id":"V4","name":"动作物理合理","reason":"手指穿模"},{"id":"V1","name":"角色身份连贯","reason":"第3段串脸"}],"suggestion":"重做第3段"} 后面也有',
      );
      expect(v).not.toBeNull();
      expect(v!.verdict).toBe("fail");
      expect(v!.failedCriteria.map((f) => f.id)).toEqual(["V4", "V1"]);
      expect(v!.suggestion).toBe("重做第3段");
      expect(v!.dimensionScores).toBeNull();
    });

    it("score 越界被 clamp 到 0-7", () => {
      expect(parseFilmReviewVerdict('{"verdict":"pass","score":99}')!.score).toBe(7);
      expect(parseFilmReviewVerdict('{"verdict":"fail","score":-3}')!.score).toBe(0);
    });

    it("无 verdict 字段 / 非法 verdict → null", () => {
      expect(parseFilmReviewVerdict('{"score":7}')).toBeNull();
      expect(parseFilmReviewVerdict('{"verdict":"maybe"}')).toBeNull();
    });

    it("非 JSON / 空 → null", () => {
      expect(parseFilmReviewVerdict("视频看起来不错")).toBeNull();
      expect(parseFilmReviewVerdict("")).toBeNull();
      expect(parseFilmReviewVerdict("{坏的 json")).toBeNull();
    });

    it("提取 failedClipIndices（失败镜归因，1-based 原样保留）", () => {
      const v = parseFilmReviewVerdict(
        '{"verdict":"fail","score":4,"failedClipIndices":[3,1],"failedCriteria":[{"id":"V1","name":"身份","reason":"第3段串脸"}]}',
      );
      expect(v!.failedClipIndices).toEqual([3, 1]);
    });

    it("缺 failedClipIndices → 空数组；过滤非有限/非数字项", () => {
      expect(parseFilmReviewVerdict('{"verdict":"pass","score":7}')!.failedClipIndices).toEqual([]);
      expect(
        parseFilmReviewVerdict('{"verdict":"fail","score":4,"failedClipIndices":[2,"x",null,3.0]}')!
          .failedClipIndices,
      ).toEqual([2, 3]);
    });
  });

  describe("readFilmReviewState", () => {
    it("读 verdict + errors", () => {
      expect(
        readFilmReviewState({ filmReviewVerdict: "pass", filmReviewErrorCount: 1 }),
      ).toEqual({ verdict: "pass", errors: 1 });
    });
    it("空 data → 空 verdict, 0 errors", () => {
      expect(readFilmReviewState(undefined)).toEqual({ verdict: "", errors: 0 });
    });
  });

  describe("formatFilmReviewNodeData", () => {
    it("pass → 写 verdict/score，可选字段省略空值", () => {
      const data = formatFilmReviewNodeData({
        verdict: "pass",
        score: 7,
        dimensionScores: null,
        failedCriteria: [],
        passCriteria: ["V1"],
        suggestion: "",
        failedClipIndices: [],
      });
      expect(data.filmReviewVerdict).toBe("pass");
      expect(data.filmReviewScore).toBe(7);
      expect(data.filmReviewPassed).toEqual(["V1"]);
      expect("filmReviewFailed" in data).toBe(false);
      expect("filmReviewSuggestion" in data).toBe(false);
      expect("filmReviewDimensions" in data).toBe(false);
    });
    it("fail → 带 failed + suggestion + dimensions", () => {
      const data = formatFilmReviewNodeData({
        verdict: "fail",
        score: 5,
        dimensionScores: {
          fidelity: 6,
          visual: 7,
          motion: 5,
          coherence: 6,
          aesthetic: 6,
          usable: 5,
          overall: 60,
        },
        failedCriteria: [{ id: "V4", name: "动作物理合理", reason: "穿模" }],
        passCriteria: ["V1", "V2"],
        suggestion: "重做第3段",
        failedClipIndices: [3],
      });
      expect(data.filmReviewVerdict).toBe("fail");
      expect(data.filmReviewFailed).toHaveLength(1);
      expect(data.filmReviewSuggestion).toBe("重做第3段");
      expect((data.filmReviewDimensions as { overall: number }).overall).toBe(60);
    });
  });

  it("buildFilmReviewPrompt — 含 V1-V7 与 JSON 合同，注入分段意图", () => {
    const p = buildFilmReviewPrompt({
      targetDurationSeconds: 26,
      clipPrompts: ["第一段扼喉", "第二段对峙"],
    });
    for (const id of ["V1", "V2", "V3", "V4", "V5", "V6", "V7"]) {
      expect(p).toContain(id);
    }
    expect(p).toContain('"verdict"');
    expect(p).toContain("26s");
    expect(p).toContain("第一段扼喉");
  });

  it("buildFilmReviewPrompt — 要求归因失败镜 failedClipIndices", () => {
    const p = buildFilmReviewPrompt({
      targetDurationSeconds: 10,
      clipPrompts: ["A", "B"],
    });
    expect(p).toContain("failedClipIndices");
  });

  it("FILM_REVIEW_MAX_ERRORS 是有限正整数（错误预算，防卡死）", () => {
    expect(FILM_REVIEW_MAX_ERRORS).toBeGreaterThan(0);
    expect(Number.isInteger(FILM_REVIEW_MAX_ERRORS)).toBe(true);
  });
});
