import { describe, expect, it } from "vitest";

import {
  containsHttpImageUrlDeep,
  isHttpImageUrl,
  redactHttpImageUrls,
  removeHttpImageUrlsDeep,
} from "./agents-image-url-privacy";

describe("agents image URL privacy", () => {
  const imageUrl =
    "https://file.beqlee.icu/uploads/user/example/20260705/style.png?X-Amz-Signature=secret";

  it("detects image URLs structurally without classifying ordinary web or video URLs", () => {
    expect(isHttpImageUrl(imageUrl)).toBe(true);
    expect(isHttpImageUrl("https://example.com/page?id=1")).toBe(false);
    expect(isHttpImageUrl("https://example.com/video.mp4")).toBe(false);
  });

  it("redacts pasted image URLs while preserving surrounding punctuation", () => {
    expect(redactHttpImageUrls(`全局画风参考：${imageUrl}。`)).toBe(
      "全局画风参考：[图片引用已隐藏]。",
    );
  });

  it("removes complete image URL values deeply and keeps non-image URLs", () => {
    const sanitized = removeHttpImageUrlsDeep({
      imageUrl,
      prompt: `参考 ${imageUrl}，保持画风`,
      videoUrl: "https://example.com/video.mp4",
      referenceImages: [imageUrl],
    });

    expect(sanitized).toEqual({
      prompt: "参考 [图片引用已隐藏]，保持画风",
      videoUrl: "https://example.com/video.mp4",
      referenceImages: [],
    });
    expect(containsHttpImageUrlDeep(sanitized)).toBe(false);
  });
});
