import { describe, expect, it } from "vitest";

import { confirmBookStyleBible } from "./book-style-bible";

describe("confirmBookStyleBible", () => {
  it("确认 Style Bible 时只保存画风事实，不保存角色生成模板", () => {
    const next = confirmBookStyleBible({
      previous: { styleId: "style-1", styleName: "旧风格", characterPromptTemplate: "旧角色模板" },
      request: {
        styleName: "国风三维修仙动画",
        characterPromptTemplate: "不应进入新合同的角色模板",
        visualDirectives: ["宣纸纤维与矿物色层次"],
      },
      userId: "user-1",
      nowIso: "2026-07-19T00:00:00.000Z",
    });
    expect(next.styleName).toBe("国风三维修仙动画");
    expect(next.visualDirectives).toEqual(["宣纸纤维与矿物色层次"]);
    expect(next).not.toHaveProperty("characterPromptTemplate");
  });

  it("保留既有画风字段时也丢弃历史角色模板", () => {
    const next = confirmBookStyleBible({
      previous: { styleName: "已有风格", characterPromptTemplate: "已有动画模板" },
      request: {},
      userId: "user-1",
      nowIso: "2026-07-19T00:00:00.000Z",
    });
    expect(next.styleName).toBe("已有风格");
    expect(next).not.toHaveProperty("characterPromptTemplate");
  });
});
