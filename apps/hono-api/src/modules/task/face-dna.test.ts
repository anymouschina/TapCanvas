import { describe, expect, it } from "vitest";

import { inferCharacterGender } from "./face-dna";

describe("inferCharacterGender（现有配音选择辅助）", () => {
  it("识别明确男性与女性描述", () => {
    expect(inferCharacterGender("28岁汉族男性，冷峻")).toBe("male");
    expect(inferCharacterGender("a handsome young man")).toBe("male");
    expect(inferCharacterGender("年轻女子，温婉")).toBe("female");
    expect(inferCharacterGender("a beautiful woman")).toBe("female");
  });

  it("识别现有中文亲属称谓", () => {
    expect(inferCharacterGender("姨妈")).toBe("female");
    expect(inferCharacterGender("舅妈")).toBe("female");
    expect(inferCharacterGender("姑父")).toBe("male");
    expect(inferCharacterGender("姐夫")).toBe("male");
  });

  it("证据不足或冲突时不推断", () => {
    expect(inferCharacterGender("一位修士")).toBeUndefined();
    expect(inferCharacterGender("兄妹")).toBeUndefined();
    expect(inferCharacterGender("夫妻")).toBeUndefined();
    expect(inferCharacterGender("")).toBeUndefined();
  });
});
