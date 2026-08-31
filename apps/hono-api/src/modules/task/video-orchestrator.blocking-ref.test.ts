import { describe, expect, it } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import {
  resolveClipReferenceImageEntries,
  type StoryPlanClip,
} from "./video-orchestrator.orchestrate";

const rowWith = (nodes: Array<Record<string, unknown>>): FlowRow => ({
  id: "flow-1",
  name: "Flow",
  data: JSON.stringify({ nodes, edges: [] }),
  owner_id: "user-1",
  project_id: "project-1",
  created_at: "2026-06-08T00:00:00.000Z",
  updated_at: "2026-06-08T00:00:00.000Z",
});

const BLOCKING = "https://cdn/x/blocking.png";
const CARD = "https://cdn/x/card.png";

const clipOf = (over: Partial<StoryPlanClip>): StoryPlanClip =>
  ({ clipIndex: 0, ...over } as unknown as StoryPlanClip);

describe("resolveClipReferenceImageEntries — 站位图只服务关键帧规划", () => {
	it("explicit_only 只展开显式 nodeId，不按 characterRoleNames/sceneName/propNames 自动补资产", () => {
		const row = rowWith([
			{ id: "selected", data: { kind: "image", productionLayer: "anchors", imageUrl: CARD, roleCardReferenceImages: [{ url: "https://cdn/x/card-side.png" }] } },
			{ id: "auto-role", data: { kind: "image", referenceType: "character", roleName: "阿强", imageUrl: "https://cdn/x/auto-role.png" } },
			{ id: "auto-scene", data: { kind: "image", referenceType: "scene", sceneName: "广场", imageUrl: "https://cdn/x/auto-scene.png" } },
		]);
		const entries = resolveClipReferenceImageEntries(
			row,
			clipOf({ videoReferenceNodeIds: ["selected"], characterRoleNames: ["阿强"], sceneName: "广场" }),
			"",
			undefined,
			undefined,
			{ authority: "explicit_only" },
		);
		expect(entries.map((entry) => entry.url)).toEqual([CARD, "https://cdn/x/card-side.png"]);
	});

  it("clip.blockingFrameNodeId 不进入视频参考图，显式角色资产仍保留", () => {
    const row = rowWith([
      { id: "blk", data: { kind: "image", productionLayer: "blocking_diagram", imageUrl: BLOCKING } },
      { id: "card-1", data: { kind: "image", productionLayer: "anchors", imageUrl: CARD, label: "角色卡·阿强" } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ videoReferenceNodeIds: ["card-1"], blockingFrameNodeId: "blk" }),
      "",
    );
    const urls = entries.map((e) => e.url);
    expect(urls).not.toContain(BLOCKING);
    expect(urls).toContain(CARD);
  });

  it("只有 blockingFrameNodeId 时视频参考集合为空", () => {
    const row = rowWith([
      { id: "blk", data: { kind: "image", productionLayer: "blocking_diagram", imageUrl: BLOCKING } },
    ]);
    const entries = resolveClipReferenceImageEntries(row, clipOf({ blockingFrameNodeId: "blk" }), "");
    expect(entries).toEqual([]);
  });

  it("无 blockingFrameNodeId 时逐字等价旧行为（不注入额外参考）", () => {
    const row = rowWith([
      { id: "card-1", data: { kind: "image", productionLayer: "anchors", imageUrl: CARD, label: "角色卡·阿强" } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ videoReferenceNodeIds: ["card-1"] }),
      "",
    );
    expect(entries.map((e) => e.url)).toEqual([CARD]);
  });

  it("blockingFrameNodeId 指向的节点没有真实 imageUrl 时安全跳过（不抛、不注入空）", () => {
    const row = rowWith([
      { id: "blk", data: { kind: "image", productionLayer: "blocking_diagram", status: "running" } },
      { id: "card-1", data: { kind: "image", productionLayer: "anchors", imageUrl: CARD, label: "角色卡·阿强" } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ videoReferenceNodeIds: ["card-1"], blockingFrameNodeId: "blk" }),
      "",
    );
    expect(entries.map((e) => e.url)).toEqual([CARD]);
  });

  it("显式 referenceImageNodeIds 不按本地语义标签改写或丢弃", () => {
    const row = rowWith([
      { id: "blk", data: { kind: "image", referenceType: "blocking", imageUrl: BLOCKING } },
      {
        id: "board",
        data: {
          kind: "image",
          productionLayer: "design_board",
          imageUrl: "https://cdn/x/board.png",
          storyboardEditorCells: [{}, {}],
        },
      },
      { id: "card-1", data: { kind: "image", productionLayer: "anchors", imageUrl: CARD, label: "角色卡·阿强" } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ videoReferenceNodeIds: ["blk", "board", "card-1"] }),
      "",
    );
    expect(entries.map((entry) => entry.url)).toEqual([
      BLOCKING,
      "https://cdn/x/board.png",
      CARD,
    ]);
  });
});

describe("resolveClipReferenceImageEntries — sceneName 确定性绑定同名场景卡", () => {
  it("没有 referenceImageNodeIds 时仍按 canonical sceneName 精确绑定场景，且不串入其它场景", () => {
    const LUO_HOME = "https://cdn/x/luo-home.png";
    const XIAO_HOME = "https://cdn/x/xiao-home.png";
    const row = rowWith([
      { id: "luo", data: { kind: "image", referenceType: "scene", label: "场景卡｜罗家顶层复式客厅", imageUrl: LUO_HOME } },
      { id: "xiao", data: { kind: "image", referenceType: "scene", label: "场景卡｜肖家客厅", imageUrl: XIAO_HOME } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ sceneName: "罗家顶层复式客厅" }),
      "",
    );
    expect(entries.map((entry) => entry.url)).toEqual([LUO_HOME]);
    expect(entries[0]?.label).toBe("场景卡·罗家顶层复式客厅");
  });

  it("优先读取结构化 sceneName，不被展示标签的版本后缀阻断", () => {
    const ARRIVAL = "https://cdn/x/arrival-r1.png";
    const row = rowWith([
      {
        id: "arrival-r1",
        data: {
          kind: "image",
          productionLayer: "anchors",
          sceneName: "界级传送阵·奥术永恒星降临空间",
          label: "场景卡｜界级传送阵·奥术永恒星降临空间 r1",
          imageUrl: ARRIVAL,
        },
      },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ sceneName: "界级传送阵·奥术永恒星降临空间" }),
      "",
    );
    expect(entries).toEqual([{
      url: ARRIVAL,
      label: "场景卡·界级传送阵·奥术永恒星降临空间",
    }]);
  });
});

describe("resolveClipReferenceImageEntries — 只消费本 clip 显式资产", () => {
  const LICHANGAN = "https://cdn/x/lichangan.png";
  const FEIFEI = "https://cdn/x/feifei.png";
  const SHUSHENG = "https://cdn/x/shusheng.png";
  const SCENE = "https://cdn/x/scene.png";

  it("clip 只列李长安时不补绑飞飞与书生", () => {
      const row = rowWith([
        { id: "c-li", data: { kind: "image", productionLayer: "anchors", roleName: "李长安", imageUrl: LICHANGAN } },
        { id: "c-fei", data: { kind: "image", productionLayer: "anchors", roleName: "飞飞", imageUrl: FEIFEI } },
        { id: "c-shu", data: { kind: "image", productionLayer: "anchors", roleName: "书生", imageUrl: SHUSHENG } },
        { id: "scene", data: { kind: "image", productionLayer: "anchors", imageUrl: SCENE, label: "场景锚｜枯木林" } },
      ]);
      const entries = resolveClipReferenceImageEntries(
        row,
        clipOf({ characterRoleNames: ["李长安"], videoReferenceNodeIds: ["scene"] }),
        "",
      );
      const urls = entries.map((e) => e.url);
      // 显式角色与显式场景保留，未声明角色不会进入本镜参考数组。
      expect(urls).toContain(LICHANGAN);
      expect(urls).not.toContain(FEIFEI);
      expect(urls).not.toContain(SHUSHENG);
      expect(urls).toContain(SCENE);
      expect(urls[0]).toBe(LICHANGAN); // clip 显式列的排前
  });

  it("去重：clip 已显式列的角色只绑定一次", () => {
    const row = rowWith([
      { id: "c-li", data: { kind: "image", productionLayer: "anchors", roleName: "李长安", imageUrl: LICHANGAN } },
      { id: "c-fei", data: { kind: "image", productionLayer: "anchors", roleName: "飞飞", imageUrl: FEIFEI } },
    ]);
    const entries = resolveClipReferenceImageEntries(row, clipOf({ characterRoleNames: ["李长安"] }), "");
    const liCount = entries.filter((e) => e.url === LICHANGAN).length;
    expect(liCount).toBe(1);
  });

  it("废弃的 VIDEO_BIND_CHAPTER_CHARACTER_CARDS 开关不能恢复全章补绑", () => {
    const prev = process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS;
    process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS = "true";
    try {
      const row = rowWith([
        { id: "c-li", data: { kind: "image", productionLayer: "anchors", roleName: "李长安", imageUrl: LICHANGAN } },
        { id: "c-fei", data: { kind: "image", productionLayer: "anchors", roleName: "飞飞", imageUrl: FEIFEI } },
      ]);
      const entries = resolveClipReferenceImageEntries(row, clipOf({ characterRoleNames: ["李长安"] }), "");
      const urls = entries.map((e) => e.url);
      expect(urls).toContain(LICHANGAN);
      expect(urls).not.toContain(FEIFEI);
    } finally {
      if (prev === undefined) delete process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS;
      else process.env.VIDEO_BIND_CHAPTER_CHARACTER_CARDS = prev;
    }
  });
});
