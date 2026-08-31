import { describe, expect, it } from "vitest";

import {
  appendGptImageDenoise,
  GPT_IMAGE_DENOISE_SUFFIX,
  GPT_IMAGE_DENOISE_SUFFIX_CINEMATIC,
} from "./agents-tool-bridge.gpt-image-denoise";

describe("appendGptImageDenoise — gpt-image-2 固定追加去噪提示词", () => {
  it("modelAlias=gpt-image-2 → 追加去噪后缀", () => {
    const out = appendGptImageDenoise("a SHOKZ earbud hero shot", { modelAlias: "gpt-image-2" });
    expect(out.startsWith("a SHOKZ earbud hero shot, ")).toBe(true);
    expect(out).toContain("--no noise, grain, artifacts");
    expect(out.endsWith("plastic texture.")).toBe(true);
  });

  it("modelKey=gpt-image-2-official → 追加（覆盖变体后缀）", () => {
    const out = appendGptImageDenoise("x", { modelKey: "gpt-image-2-official" });
    expect(out).toContain(GPT_IMAGE_DENOISE_SUFFIX);
  });

  it("非 gpt-image-2（gemini）→ 原样不动", () => {
    const out = appendGptImageDenoise("x", { modelKey: "gemini-3-pro-image-preview" });
    expect(out).toBe("x");
  });

  it("幂等：已含去噪后缀 → 不重复追加", () => {
    const once = appendGptImageDenoise("hero", { modelAlias: "gpt-image-2" });
    const twice = appendGptImageDenoise(once, { modelAlias: "gpt-image-2" });
    expect(twice).toBe(once);
    expect(twice.match(/--no noise, grain, artifacts/g)?.length).toBe(1);
  });

  it("空 prompt + gpt-image-2 → 只返回后缀（不带前导逗号）", () => {
    const out = appendGptImageDenoise("", { modelAlias: "gpt-image-2" });
    expect(out).toBe(GPT_IMAGE_DENOISE_SUFFIX);
  });

  it("电影级意图 prompt → 用保质感变体（保留戏剧光影/对比/材质，不压平）", () => {
    const out = appendGptImageDenoise("史诗电影级密室，戏剧化布光", { modelAlias: "gpt-image-2" });
    expect(out).toContain(GPT_IMAGE_DENOISE_SUFFIX_CINEMATIC);
    expect(out).not.toContain(GPT_IMAGE_DENOISE_SUFFIX); // 不叠加原文寡淡后缀
    // 关键：不含压平戏剧感的词
    expect(out).not.toContain("soft diffused lighting");
    expect(out).not.toContain("balanced contrast");
    // 保留电影级正向
    expect(out).toContain("dramatic volumetric lighting");
    expect(out).toContain("chiaroscuro");
  });

  it("cinematic (英文) 意图 → 保质感变体", () => {
    const out = appendGptImageDenoise("epic cinematic hero portrait", { modelAlias: "gpt-image-2" });
    expect(out).toContain(GPT_IMAGE_DENOISE_SUFFIX_CINEMATIC);
  });

  it("电影级变体幂等：二次追加不重复", () => {
    const once = appendGptImageDenoise("cinematic 史诗镜头", { modelAlias: "gpt-image-2" });
    const twice = appendGptImageDenoise(once, { modelAlias: "gpt-image-2" });
    expect(twice).toBe(once);
  });

  it("非电影级 prompt 仍用 06-18 锁定原文（不改动既有行为）", () => {
    const out = appendGptImageDenoise("产品白底图", { modelAlias: "gpt-image-2" });
    expect(out).toContain(GPT_IMAGE_DENOISE_SUFFIX);
    expect(out).not.toContain(GPT_IMAGE_DENOISE_SUFFIX_CINEMATIC);
  });
});
