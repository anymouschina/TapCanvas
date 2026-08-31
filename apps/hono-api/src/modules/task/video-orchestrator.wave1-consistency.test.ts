import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import {
  computeEffectiveCharacterStates,
  resolveClipReferenceImageEntries,
  type StoryPlanClip,
} from "./video-orchestrator.orchestrate";

const rowWith = (nodes: Array<Record<string, unknown>>): FlowRow => ({
  id: "flow-1",
  name: "Flow",
  data: JSON.stringify({ nodes, edges: [] }),
  owner_id: "user-1",
  project_id: "project-1",
  created_at: "2026-07-02T00:00:00.000Z",
  updated_at: "2026-07-02T00:00:00.000Z",
});

const clipOf = (over: Partial<StoryPlanClip>): StoryPlanClip =>
  ({ clipIndex: 0, clipPrompt: "", ...over } as unknown as StoryPlanClip);

describe("computeEffectiveCharacterStates — 形态状态前向填充", () => {
  it("把变身那一镜的 stateKey 前向延续到之后未标的镜头", () => {
    const clips = [
      clipOf({ characterStates: {} }), // 镜0 基态
      clipOf({ characterStates: { 岳山: "qin-terracotta" } }), // 镜1 变身
      clipOf({ characterStates: {} }), // 镜2 LLM 漏标
      clipOf({ characterStates: {} }), // 镜3 LLM 漏标
    ];
    expect(computeEffectiveCharacterStates(clips, 0)).toEqual({});
    expect(computeEffectiveCharacterStates(clips, 1)).toEqual({ 岳山: "qin-terracotta" });
    expect(computeEffectiveCharacterStates(clips, 2)).toEqual({ 岳山: "qin-terracotta" });
    expect(computeEffectiveCharacterStates(clips, 3)).toEqual({ 岳山: "qin-terracotta" });
  });

  it("显式回退键（基态/恢复/变回）清除延续", () => {
    const clips = [
      clipOf({ characterStates: { 岳山: "qin-terracotta" } }),
      clipOf({ characterStates: {} }), // 延续
      clipOf({ characterStates: { 岳山: "基态" } }), // 变回
      clipOf({ characterStates: {} }), // 应回基态
    ];
    expect(computeEffectiveCharacterStates(clips, 1)).toEqual({ 岳山: "qin-terracotta" });
    expect(computeEffectiveCharacterStates(clips, 2)).toEqual({});
    expect(computeEffectiveCharacterStates(clips, 3)).toEqual({});
  });

  it("本镜显式值覆盖延续值；多角色各自独立延续", () => {
    const clips = [
      clipOf({ characterStates: { 岳山: "qin-terracotta" } }),
      clipOf({ characterStates: { 万钧: "thunder-lord" } }), // 岳山延续 + 万钧新变身
      clipOf({ characterStates: { 岳山: "wounded" } }), // 岳山改状态、万钧延续
    ];
    expect(computeEffectiveCharacterStates(clips, 1)).toEqual({
      岳山: "qin-terracotta",
      万钧: "thunder-lord",
    });
    expect(computeEffectiveCharacterStates(clips, 2)).toEqual({
      岳山: "wounded",
      万钧: "thunder-lord",
    });
  });

  it("空/越界输入安全", () => {
    expect(computeEffectiveCharacterStates(undefined, 0)).toEqual({});
    expect(computeEffectiveCharacterStates([], 5)).toEqual({});
  });

  it("只在同一 temporal stateScope 内前向继承，回忆状态不污染现实", () => {
    const clips = [
      clipOf({
        temporalContext: { timelineId: "present", stateScope: "present", presentation: "current", relationToPrevious: "opening" },
        characterStates: { 沈知夏: "pregnant-three-months" },
      }),
      clipOf({
        temporalContext: { timelineId: "memory-1", stateScope: "memory-1", presentation: "memory", relationToPrevious: "enter_memory" },
        characterStates: { 沈知夏: "not-pregnant-past" },
      }),
      clipOf({
        temporalContext: { timelineId: "present", stateScope: "present", presentation: "current", relationToPrevious: "return_from_memory", returnAnchor: "手掌仍覆在微隆小腹" },
        characterStates: {},
      }),
    ];

    expect(computeEffectiveCharacterStates(clips, 1)).toEqual({ 沈知夏: "not-pregnant-past" });
    expect(computeEffectiveCharacterStates(clips, 2)).toEqual({ 沈知夏: "pregnant-three-months" });
  });
});

describe("resolveClipReferenceImageEntries — 完整返回结构化业务依赖", () => {
  it("不把未声明的章节角色卡填进参考图空位", () => {
    const HERO = "https://cdn/x/hero.png";
    const SCENE = "https://cdn/x/scene.png";
    const EXTRA1 = "https://cdn/x/extra1.png";
    const EXTRA2 = "https://cdn/x/extra2.png";
    const EXTRA3 = "https://cdn/x/extra3.png";
    const row = rowWith([
      { id: "c-hero", data: { kind: "image", productionLayer: "anchors", roleName: "主角", imageUrl: HERO } },
      { id: "scene", data: { kind: "image", productionLayer: "anchors", imageUrl: SCENE, label: "场景锚｜广场" } },
      { id: "c-e1", data: { kind: "image", productionLayer: "anchors", roleName: "路人甲", imageUrl: EXTRA1 } },
      { id: "c-e2", data: { kind: "image", productionLayer: "anchors", roleName: "路人乙", imageUrl: EXTRA2 } },
      { id: "c-e3", data: { kind: "image", productionLayer: "anchors", roleName: "路人丙", imageUrl: EXTRA3 } },
    ]);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["主角"], videoReferenceNodeIds: ["scene"], clipPrompt: "主角独自站在广场" }),
      "",
    ).map((e) => e.url);
    expect(urls).toHaveLength(2);
    expect(urls).toContain(HERO); // 出场角色（最高优先）
    expect(urls).toContain(SCENE); // 显式场景
    // 未出场角色即使存在于章节画布，也不会作为本镜安全网补绑。
    const extrasKept = [EXTRA1, EXTRA2, EXTRA3].filter((u) => urls.includes(u));
    expect(extrasKept).toHaveLength(0);
  });

  it("结构化声明的角色按声明顺序绑定，prompt 提及不参与", () => {
    const HERO = "https://cdn/x/hero.png";
    const MENTIONED = "https://cdn/x/mentioned.png";
    const ABSENT = "https://cdn/x/absent.png";
    const row = rowWith([
      { id: "c-hero", data: { kind: "image", productionLayer: "anchors", roleName: "主角", imageUrl: HERO } },
      { id: "c-m", data: { kind: "image", productionLayer: "anchors", roleName: "阿蛮", imageUrl: MENTIONED } },
      { id: "c-a", data: { kind: "image", productionLayer: "anchors", roleName: "远方人", imageUrl: ABSENT } },
    ]);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["主角", "阿蛮"], clipPrompt: "主角与阿蛮并肩而立" }),
      "",
    ).map((e) => e.url);
    expect(urls).toHaveLength(2);
    expect(urls).toContain(HERO);
    expect(urls).toContain(MENTIONED);
    expect(urls).not.toContain(ABSENT);
  });

  it("不截断超预算依赖，交给统一预算门禁显式拒绝", () => {
    const SCENE = "https://cdn/x/required-scene.png";
    const roleNames = Array.from({ length: 9 }, (_, index) => `角色${index + 1}`);
    const row = rowWith([
      ...roleNames.map((roleName, index) => ({
        id: `character-${index + 1}`,
        data: {
          kind: "image",
          productionLayer: "anchors",
          roleName,
          imageUrl: `https://cdn/x/character-${index + 1}.png`,
        },
      })),
      {
        id: "required-scene",
        data: {
          kind: "image",
          productionLayer: "anchors",
          referenceType: "scene",
          label: "场景卡｜紫霄宮門外候道場",
          imageUrl: SCENE,
        },
      },
    ]);

    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({
        characterRoleNames: roleNames,
        videoReferenceNodeIds: ["required-scene"],
        sceneName: "紫霄宮門外候道場",
      }),
      "",
    );

    expect(entries).toHaveLength(10);
		expect(entries).toContainEqual({
			url: SCENE,
			label: "场景卡·紫霄宮門外候道場",
		});
    expect(entries.filter((entry) => entry.label.startsWith("角色卡·"))).toHaveLength(9);
  });
});

describe("resolveClipReferenceImageEntries — 显式群像图不受本地语义改写", () => {
  const HERO = "https://cdn/x/hero.png";
  const GROUP = "https://cdn/x/group.png";
  const rowHeroAndGroup = () =>
    rowWith([
      { id: "c-hero", data: { kind: "image", productionLayer: "anchors", roleName: "孟川", imageUrl: HERO } },
      {
        id: "grp",
        data: {
          kind: "image",
          productionLayer: "anchors",
          referenceType: "ensemble",
          label: "群像图｜三骷髅",
          imageUrl: GROUP,
        },
      },
    ]);

  it("贴身单体特写镜显式绑定群像图时仍保留该资产", () => {
    const urls = resolveClipReferenceImageEntries(
      rowHeroAndGroup(),
      clipOf({
        characterRoleNames: ["孟川"],
        videoReferenceNodeIds: ["grp"],
        shots: [{ framing: "大特写（命中）", action: "掌中枪尖直刺骨爪正中心" }],
      } as Partial<StoryPlanClip>),
      "",
    ).map((e) => e.url);
    expect(urls).toContain(HERO);
    expect(urls).toContain(GROUP);
  });

  it("含全景 beat 的镜（可能真多主体同框）→ 保留群像图，不误剔", () => {
    const urls = resolveClipReferenceImageEntries(
      rowHeroAndGroup(),
      clipOf({
        characterRoleNames: ["孟川"],
        videoReferenceNodeIds: ["grp"],
        shots: [{ framing: "全景（爆发）", action: "骨臂炸裂，孟川窜向下一头骷髅" }],
      } as Partial<StoryPlanClip>),
      "",
    ).map((e) => e.url);
    expect(urls).toContain(HERO);
    expect(urls).toContain(GROUP); // 宽景 beat 交给群像图逻辑，纯净度护栏不介入
  });
});

describe("resolveClipReferenceImageEntries — 角色名归一化匹配（别名/排版差异）", () => {
  const HERO = "https://cdn/x/hero.png";
  const prevBind = process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS;
  beforeEach(() => {
    process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS = "off"; // 只验精确取卡路径，关掉固定补绑干扰
  });
  afterEach(() => {
    if (prevBind === undefined) delete process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS;
    else process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS = prevBind;
  });

  it("characterRoleNames 带空格/引号也能命中同一张卡", () => {
    const row = rowWith([
      { id: "c-li", data: { kind: "image", productionLayer: "anchors", roleName: "李长安", imageUrl: HERO } },
    ]);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["「李 长安」"] }),
      "",
    ).map((e) => e.url);
    expect(urls).toContain(HERO);
  });

  it("简称不通过本地子串语义兜底命中全名卡", () => {
    const row = rowWith([
      { id: "c-li", data: { kind: "image", productionLayer: "anchors", roleName: "李长安", imageUrl: HERO } },
    ]);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["长安"] }),
      "",
    ).map((e) => e.url);
    expect(urls).not.toContain(HERO);
  });
});
