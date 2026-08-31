import { describe, expect, it } from "vitest";

import { isPermanentModerationFailure } from "./video-orchestrator.clip-resolve";

describe("isPermanentModerationFailure — 内容审核/版权拒＝确定性失败（首拒即永久，禁盲重试）", () => {
  it("输出侧版权拒（2026-07-10 怪兽片实测原文）→ true", () => {
    expect(
      isPermanentModerationFailure(
        "The request failed because the output video may be related to copyright restrictions. Request id: 0217836512",
      ),
    ).toBe(true);
    expect(
      isPermanentModerationFailure("OutputVideoSensitiveContentDetected.PolicyViolation"),
    ).toBe(true);
  });
  it("输入侧审核拒 → true（对齐提交侧 fail-fast 口径）", () => {
    expect(isPermanentModerationFailure("InputTextSensitiveContentDetected: ...")).toBe(true);
    expect(isPermanentModerationFailure("图片未通过内容审核")).toBe(true);
  });
  it("瞬时错误（429/5xx/网络）→ false，照常重试", () => {
    expect(isPermanentModerationFailure("429 Too Many Requests")).toBe(false);
    expect(isPermanentModerationFailure("internal server error")).toBe(false);
    expect(isPermanentModerationFailure("fetch failed")).toBe(false);
    expect(isPermanentModerationFailure("")).toBe(false);
    expect(isPermanentModerationFailure(undefined)).toBe(false);
  });
});
