import { describe, expect, it } from "vitest";
import type { FilmReviewVerdict } from "./video-orchestrator.film-review";
import {
  buildFilmReworkClipFeedback,
  readFilmReworkAttempts,
} from "./video-orchestrator.film-rework";

const failVerdict = (over: Partial<FilmReviewVerdict> = {}): FilmReviewVerdict => ({
  verdict: "fail",
  score: 4,
  dimensionScores: null,
  failedCriteria: [{ id: "V1", name: "身份", reason: "第3段串脸" }],
  passCriteria: [],
  suggestion: "重做第3段",
  failedClipIndices: [3],
  ...over,
});

describe("readFilmReworkAttempts", () => {
  it("读 filmReworkAttempts；缺/非法 → 0", () => {
    expect(readFilmReworkAttempts({ filmReworkAttempts: 1 })).toBe(1);
    expect(readFilmReworkAttempts({})).toBe(0);
    expect(readFilmReworkAttempts(undefined)).toBe(0);
    expect(readFilmReworkAttempts({ filmReworkAttempts: -5 })).toBe(0);
    expect(readFilmReworkAttempts({ filmReworkAttempts: "x" })).toBe(0);
  });
});

describe("buildFilmReworkClipFeedback", () => {
  it("把整片审片失败项+建议整理成非阻塞诊断", () => {
    const fb = buildFilmReworkClipFeedback(
      failVerdict({
        failedCriteria: [
          { id: "V4", name: "动作物理", reason: "手指穿模" },
          { id: "V1", name: "身份", reason: "第3段串脸" },
        ],
        suggestion: "锁定面部DNA重出",
      }),
    );
    expect(fb).toContain("成片审片");
    expect(fb).toContain("不阻塞当前资产交付");
    expect(fb).toContain("手指穿模");
    expect(fb).toContain("锁定面部DNA重出");
    expect(fb.length).toBeLessThanOrEqual(2000);
  });
});
