/**
 * task.stored-task-utils.test.ts
 *
 * 针对真实 resolveStoredTaskRefKind 的单元测试（不 mock 被测函数本身）。
 * 主要验证 image_to_3d 归入 "video" 分支，确保异步入队路径能正确写 vendor_task_refs。
 */

import { describe, expect, it } from "vitest";
import { resolveStoredTaskRefKind } from "./task.stored-task-utils";

describe("resolveStoredTaskRefKind（真实实现，不 mock）", () => {
  // 回归：text_to_video 已有行为
  it("text_to_video → 'video'", () => {
    expect(resolveStoredTaskRefKind("text_to_video")).toBe("video");
  });

  // 回归：image_to_video 已有行为
  it("image_to_video → 'video'", () => {
    expect(resolveStoredTaskRefKind("image_to_video")).toBe("video");
  });

  // 🔴 关键：image_to_3d 必须也归入 "video"，否则异步入队路径写不了 vendor_task_refs
  it("image_to_3d → 'video'（修复前此用例失败，证明 bug 真实存在）", () => {
    expect(resolveStoredTaskRefKind("image_to_3d")).toBe("video");
  });

  // 回归：图片任务不受影响
  it("text_to_image → 'image'", () => {
    expect(resolveStoredTaskRefKind("text_to_image")).toBe("image");
  });

  it("image_edit → 'image'", () => {
    expect(resolveStoredTaskRefKind("image_edit")).toBe("image");
  });

  // 其他 kind 返回 null（不写 ref）
  it("其他 kind（如 text_to_speech）→ null", () => {
    // @ts-expect-error 故意传非 video/image kind 测试兜底行为
    expect(resolveStoredTaskRefKind("text_to_speech")).toBeNull();
  });
});
