import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildAnalyzeVideoResult,
  extractResponsesText,
  resolveVideoUnderstandingModel,
} from "./agents-tool-bridge.analyze-video";

describe("analyze video provenance", () => {
  it("uses the dedicated video understanding model instead of caller-selected image models", () => {
    expect(resolveVideoUnderstandingModel()).toBe("doubao-seed-2-0-lite-260428");
  });
  it("returns verifiable hashes and the actual execution facts", async () => {
    const prompt = "对照 BeatSheet 检查叙事债务兑现与 reaction carrier";
    const text = "兑现动作可见，但冲击后的反应镜头不足。";
    const result = await buildAnalyzeVideoResult({
      text,
      videoUrl: "https://assets.tapcanvas.test/final.mp4",
      model: "video-understand-test",
      fps: 2,
      prompt,
      segmentCount: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      text,
      videoUrl: "https://assets.tapcanvas.test/final.mp4",
      model: "video-understand-test",
      fps: 2,
      segmentCount: 3,
      promptHash: createHash("sha256").update(prompt).digest("hex"),
      analysisHash: createHash("sha256").update(text).digest("hex"),
    });
    expect(Number.isFinite(Date.parse(result.analyzedAt))).toBe(true);
  });

  it("binds a canonical hash to the exact writer dramatic coverage shown to video understanding", async () => {
    const dramaticCoverage = [{
      clipIndex: 0,
      dramaticCoverage: {
        stateActions: [{ shotNos: [1, 2], actionId: "state-0" }],
        debt: { shotNos: [2], lifecycleAction: "resolve", debtId: "debt-0" },
      },
    }];
    const canonical = [{
      clipIndex: 0,
      dramaticCoverage: {
        debt: { debtId: "debt-0", lifecycleAction: "resolve", shotNos: [2] },
        stateActions: [{ actionId: "state-0", shotNos: [1, 2] }],
      },
    }];
    const result = await buildAnalyzeVideoResult({
      text: "逐项观察",
      videoUrl: "https://assets.tapcanvas.test/final.mp4",
      model: "video-understand-test",
      fps: 1,
      prompt: "逐项核对",
      segmentCount: 1,
      dramaticCoverage,
    });
    expect(result.dramaticCoverageHash).toBe(
      createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    );
  });

  it("extracts response text without untyped response traversal", () => {
    expect(extractResponsesText(JSON.stringify({
      output: [{
        type: "message",
        content: [
          { type: "output_text", text: "第一段" },
          { type: "ignored", text: "不可见" },
          { type: "output_text", text: "第二段" },
        ],
      }],
    }))).toBe("第一段第二段");
  });
});
