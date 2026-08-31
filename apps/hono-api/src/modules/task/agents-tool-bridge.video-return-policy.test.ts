import { describe, expect, it } from "vitest";

import { shouldReturnVideoAsync } from "./agents-tool-bridge.video-return-policy";

describe("shouldReturnVideoAsync — 视频默认提交即返回，杜绝长同步 fetch failed", () => {
  it("raw 单镜有 taskId 时异步返回", () => {
    expect(shouldReturnVideoAsync({ billingTaskId: "t1" })).toBe(true);
  });

  it("章节单镜有 taskId 时同样异步返回", () => {
    expect(shouldReturnVideoAsync({ billingTaskId: "chapter-task" })).toBe(true);
  });

  it("无 billingTaskId 时只允许 inline 收口", () => {
    expect(shouldReturnVideoAsync({ billingTaskId: "" })).toBe(false);
    expect(shouldReturnVideoAsync({})).toBe(false);
  });
});
