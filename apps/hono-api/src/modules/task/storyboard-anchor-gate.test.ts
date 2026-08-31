import { describe, expect, it } from "vitest";

import {
  applyChapterReusePolicy,
  buildStoryboardAnchorCandidatesFromAssets,
  parseChapterIndexFromId,
  readCardChapterIndex,
} from "./storyboard-anchor-gate";

const mkCard = (
  kind: string,
  name: string,
  sourceChapterId: string | null,
  updatedAt = "",
  id = `${kind}-${name}-${sourceChapterId}`,
) => ({
  id,
  kind,
  name,
  updatedAt,
  latestVersion: { data: { imageUrl: `https://cdn/${id}.jpg`, ...(sourceChapterId ? { sourceChapterId } : {}) } },
});

describe("parseChapterIndexFromId / readCardChapterIndex", () => {
  it("从 book-{bookId}-ch{N} 解析章节序号", () => {
    expect(parseChapterIndexFromId("book-______-1782086262614-ch41")).toBe(41);
    expect(parseChapterIndexFromId("book-x-ch1")).toBe(1);
  });
  it("非法/UUID/空 → null（未知章节）", () => {
    expect(parseChapterIndexFromId("550e8400-e29b-41d4-a716-446655440000")).toBeNull();
    expect(parseChapterIndexFromId("book-x")).toBeNull();
    expect(parseChapterIndexFromId("")).toBeNull();
    expect(parseChapterIndexFromId(undefined)).toBeNull();
  });
  it("readCardChapterIndex 读 latestVersion.data.sourceChapterId", () => {
    expect(readCardChapterIndex(mkCard("scene", "山道", "book-b-ch5"))).toBe(5);
    expect(readCardChapterIndex(mkCard("scene", "山道", null))).toBeNull();
  });
});

describe("applyChapterReusePolicy（章节复用策略）", () => {
  it("场景卡：跨章可复用·就近排序（2026-07-10 用户推翻旧「限本章」：所有同名资产项目级复用就近获取）", () => {
    const scenes = [
      mkCard("scene", "本章场景", "book-b-ch41"),
      mkCard("scene", "他章场景", "book-b-ch40"),
      mkCard("scene", "无章节场景", null),
      mkCard("scene", "未来章场景", "book-b-ch50"), // 未来章不回流
    ];
    const out = applyChapterReusePolicy({ characters: [], scenes, props: [], currentChapterIndex: 41 });
    expect(out.scenes.map((s) => s.name)).toEqual(["本章场景", "他章场景", "无章节场景"]);
  });

  it("场景卡：同名跨章 → 就近取最新一张（同名去重）", () => {
    const scenes = [
      mkCard("scene", "祭坛残殿", "book-b-ch9", "2026-01-01", "s-ch9"),
      mkCard("scene", "祭坛残殿", "book-b-ch10", "2026-01-02", "s-ch10"), // 更近章 → 取这张
    ];
    const out = applyChapterReusePolicy({ characters: [], scenes, props: [], currentChapterIndex: 11 });
    expect(out.scenes.map((s) => s.id ?? s.name)).toEqual(["s-ch10"]);
  });

  it("道具卡：同名跨章就近去重（法宝项目级永续复用）", () => {
    const props = [
      mkCard("prop", "混元金斗", "book-b-ch9", "2026-01-01", "p-ch9"),
      mkCard("prop", "混元金斗", "book-b-ch11", "2026-01-03", "p-ch11"),
      mkCard("prop", "弑神枪残体", "book-b-ch4", "2026-01-01", "p-ch4"),
    ];
    const out = applyChapterReusePolicy({ characters: [], scenes: [], props, currentChapterIndex: 12 });
    expect(out.props.map((p) => p.id ?? p.name)).toEqual(["p-ch11", "p-ch4"]);
  });

  it("角色卡：≤当前章按名取最新（就近优先于 updatedAt）", () => {
    const characters = [
      mkCard("character", "李长安", "book-b-ch10", "2026-01-01", "lca-ch10"),
      mkCard("character", "李长安", "book-b-ch38", "2026-02-01", "lca-ch38"), // 最近章 → 取这张
      mkCard("character", "李长安", "book-b-ch50", "2026-03-01", "lca-ch50"), // 未来章 → 排除
      mkCard("character", "薛大家", "book-b-ch41", "2026-02-10", "xdj-ch41"),
    ];
    const out = applyChapterReusePolicy({ characters, scenes: [], props: [], currentChapterIndex: 41 });
    const picked = out.characters.map((c) => c.id).sort();
    expect(picked).toEqual(["lca-ch38", "xdj-ch41"]); // 每角色一张，李长安取 ch38 非 ch50
  });

  it("角色卡：同章多版取 updatedAt 最新；无章节卡仍纳入(身份优先)", () => {
    const characters = [
      mkCard("character", "牛秀才", "book-b-ch41", "2026-02-01", "nxc-old"),
      mkCard("character", "牛秀才", "book-b-ch41", "2026-02-09", "nxc-new"), // 同章更晚
      mkCard("character", "船夫", null, "2026-01-01", "cf-unknown"), // 无章节仍纳入
    ];
    const out = applyChapterReusePolicy({ characters, scenes: [], props: [], currentChapterIndex: 41 });
    const ids = out.characters.map((c) => c.id).sort();
    expect(ids).toEqual(["cf-unknown", "nxc-new"]);
  });

  it("currentChapterIndex==null：不限制场景、角色按名取最新（退化）", () => {
    const scenes = [mkCard("scene", "任意场景", "book-b-ch3")];
    const characters = [
      mkCard("character", "甲", "book-b-ch3", "2026-01-01", "jia-ch3"),
      mkCard("character", "甲", "book-b-ch9", "2026-02-01", "jia-ch9"),
    ];
    const out = applyChapterReusePolicy({ characters, scenes, props: [], currentChapterIndex: null });
    expect(out.scenes).toHaveLength(1); // 不限制
    expect(out.characters.map((c) => c.id)).toEqual(["jia-ch9"]); // 仍按名取最新
  });

  it("道具原样透传", () => {
    const props = [mkCard("prop", "短剑", "book-b-ch40")];
    const out = applyChapterReusePolicy({ characters: [], scenes: [], props, currentChapterIndex: 41 });
    expect(out.props).toEqual(props);
  });
});

describe("buildStoryboardAnchorCandidatesFromAssets（正向锚定装配纯函数）", () => {
  it("character/scene 装配成带标签候选 + referenceImages URL 数组", () => {
    const { candidates, referenceImages } = buildStoryboardAnchorCandidatesFromAssets([
      {
        id: "a1",
        kind: "character",
        name: "张三",
        latestVersion: { data: { imageUrl: "https://cdn/zhang.jpg", stateDescription: "少年" } },
      },
      {
        id: "a2",
        kind: "scene",
        name: "书房",
        latestVersion: { data: { imageUrl: "https://cdn/study.jpg" } },
      },
    ]);
    expect(referenceImages).toEqual(["https://cdn/zhang.jpg", "https://cdn/study.jpg"]);
    expect(candidates[0]).toMatchObject({
      assetId: "a1",
      kind: "character",
      name: "张三",
      imageUrl: "https://cdn/zhang.jpg",
      label: "角色参考：张三",
      description: "少年",
    });
    expect(candidates[1].label).toBe("场景参考：书房");
  });

  it("缺 imageUrl 回退 threeViewImageUrl；都缺则跳过", () => {
    const { candidates } = buildStoryboardAnchorCandidatesFromAssets([
      { id: "a1", kind: "character", name: "三视图", latestVersion: { data: { threeViewImageUrl: "https://cdn/3v.jpg" } } },
      { id: "a2", kind: "character", name: "无图", latestVersion: { data: {} } },
      { id: "a3", kind: "character", name: "无版本", latestVersion: null },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].imageUrl).toBe("https://cdn/3v.jpg");
  });

  it("按 imageUrl 去重，并截到 limit", () => {
    const { candidates, referenceImages } = buildStoryboardAnchorCandidatesFromAssets(
      [
        { id: "a1", kind: "character", name: "甲", latestVersion: { data: { imageUrl: "https://cdn/x.jpg" } } },
        { id: "a2", kind: "scene", name: "乙", latestVersion: { data: { imageUrl: "https://cdn/x.jpg" } } },
        { id: "a3", kind: "prop", name: "丙", latestVersion: { data: { imageUrl: "https://cdn/y.jpg" } } },
      ],
      1,
    );
    // 去重后第二条同 url 被丢；limit=1 只保留第一条
    expect(referenceImages).toEqual(["https://cdn/x.jpg"]);
    expect(candidates).toHaveLength(1);
  });

  it("空/非数组输入 → 空结果，不抛", () => {
    expect(buildStoryboardAnchorCandidatesFromAssets([]).candidates).toEqual([]);
    expect(
      buildStoryboardAnchorCandidatesFromAssets(undefined as never).referenceImages,
    ).toEqual([]);
  });

  it("kind 映射标签前缀：prop=道具参考 / style=画风参考 / 未知=参考", () => {
    const { candidates } = buildStoryboardAnchorCandidatesFromAssets([
      { id: "p", kind: "prop", name: "木盒", latestVersion: { data: { imageUrl: "https://cdn/p.jpg" } } },
      { id: "s", kind: "style", name: "胶片", latestVersion: { data: { imageUrl: "https://cdn/s.jpg" } } },
      { id: "u", kind: "weird", name: "X", latestVersion: { data: { imageUrl: "https://cdn/u.jpg" } } },
    ]);
    expect(candidates.map((c) => c.label)).toEqual(["道具参考：木盒", "画风参考：胶片", "参考：X"]);
  });
});
