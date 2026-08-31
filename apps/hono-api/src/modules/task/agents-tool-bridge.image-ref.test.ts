import { describe, expect, it } from "vitest";

import { isUsableImageRef } from "./agents-tool-bridge.image-ref";

describe("isUsableImageRef — 拦截占位/残缺图片引用（Q3a）", () => {
  it("http/https 真实 URL → 可用", () => {
    expect(isUsableImageRef("https://file.beqlee.icu/a.png")).toBe(true);
    expect(isUsableImageRef("http://x/y.jpg")).toBe(true);
  });

  it("带真实 base64 的 data URL → 可用", () => {
    const payload = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6l0AAAAASUVORK5CYII=";
    expect(isUsableImageRef(`data:image/png;base64,${payload}`)).toBe(true);
  });

  it("占位符 data URL → 不可用（就是 trace 里小T 传的那种）", () => {
    expect(isUsableImageRef("data:image/png;base64,placeholder")).toBe(false);
  });

  it("空 payload / 残缺 data URL → 不可用", () => {
    expect(isUsableImageRef("data:image/png;base64,")).toBe(false);
    expect(isUsableImageRef("data:image/png;base64,abc")).toBe(false);
  });

  it("裸字符串 / 空 / 非图片协议 → 不可用", () => {
    expect(isUsableImageRef("placeholder")).toBe(false);
    expect(isUsableImageRef("")).toBe(false);
    expect(isUsableImageRef("   ")).toBe(false);
    expect(isUsableImageRef("ftp://x/y.png")).toBe(false);
    expect(isUsableImageRef(null)).toBe(false);
    expect(isUsableImageRef(undefined)).toBe(false);
  });
});
