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

const BASE_YUE = "https://cdn/x/yue-base.png";
const QIN_YUE = "https://cdn/x/yue-qin.png"; // 兵马俑神将版岳山
const BASE_WAN = "https://cdn/x/wan-base.png";
const SCENE = "https://cdn/x/scene.png";

const clipOf = (over: Partial<StoryPlanClip>): StoryPlanClip =>
  ({ clipIndex: 0, ...over } as unknown as StoryPlanClip);

// 画布：岳山基态卡 + 岳山状态版卡(stateKey=qin-terracotta) + 万钧基态卡 + 场景卡
const rowTransforming = () =>
  rowWith([
    { id: "yue-base", data: { kind: "image", roleName: "岳山", imageUrl: BASE_YUE, label: "角色卡·岳山" } },
    {
      id: "yue-qin",
      data: {
        kind: "image",
        roleName: "岳山",
        stateKey: "qin-terracotta",
        stateVersionId: "state-yue-qin-v1",
        stateDescription: "兵马俑神将·振魂后",
        imageUrl: QIN_YUE,
        label: "角色卡·岳山（兵马俑神将）",
      },
    },
    { id: "wan-base", data: { kind: "image", roleName: "万钧", imageUrl: BASE_WAN, label: "角色卡·万钧" } },
    { id: "scene-1", data: { kind: "image", imageUrl: SCENE, label: "场景卡·断桥" } },
  ]);

describe("resolveClipReferenceImageEntries — 形态/状态感知角色卡绑定", () => {
  it("变身前（未标 characterStates）绑基态卡，不误绑状态版", () => {
    const entries = resolveClipReferenceImageEntries(
      rowTransforming(),
      clipOf({ characterRoleNames: ["岳山"] }),
      "",
    );
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(BASE_YUE);
    expect(urls).not.toContain(QIN_YUE);
  });

  it("变身后（characterStates 标 stateKey）绑对应状态版卡，且不再双绑基态", () => {
    const entries = resolveClipReferenceImageEntries(
      rowTransforming(),
      clipOf({ characterRoleNames: ["岳山"], characterStates: { 岳山: "qin-terracotta" } }),
      "",
    );
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(QIN_YUE);
    expect(urls).not.toContain(BASE_YUE); // 固定补绑跳过已状态绑定的角色 → 无基态双绑
    // 标签把状态描述渲染给模型看
    expect(entries.find((e) => e.url === QIN_YUE)?.label).toMatch(/兵马俑神将/);
  });

  it("同镜两角色、只有一人变身：变身者绑状态版、另一人绑基态，互不串（岳山神将+万钧基态）", () => {
    const entries = resolveClipReferenceImageEntries(
      rowTransforming(),
      clipOf({
        characterRoleNames: ["岳山", "万钧"],
        characterStates: { 岳山: "qin-terracotta" }, // 只有岳山变身，万钧仍基态
      }),
      "",
    );
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(QIN_YUE); // 岳山→状态版
    expect(urls).toContain(BASE_WAN); // 万钧→基态
    expect(urls).not.toContain(BASE_YUE); // 岳山基态不再混入
  });

  it("未变身角色显式列出时取基态，状态版卡绝不被误取", () => {
    const entries = resolveClipReferenceImageEntries(
      rowTransforming(),
      clipOf({ characterRoleNames: ["岳山"] }), // 无 characterStates
      "",
    );
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(BASE_YUE);
    expect(urls).not.toContain(QIN_YUE);
  });

  it("标了 stateKey 但画布无对应状态版 → 不得回退基态", () => {
    const entries = resolveClipReferenceImageEntries(
      rowTransforming(),
      clipOf({ characterRoleNames: ["岳山"], characterStates: { 岳山: "does-not-exist" } }),
      "",
    );
    expect(entries.map((e) => e.url)).not.toContain(BASE_YUE);
    expect(entries).toEqual([]);
  });

  it("状态锚要求同时逐字匹配 anchorNodeId、stateKey 与 stateVersionId", () => {
    const entries = resolveClipReferenceImageEntries(
      rowTransforming(),
      clipOf({
        characterRoleNames: ["岳山"],
        visualStateAnchorRequirements: [{
          characterName: "岳山",
          stateKey: "qin-terracotta",
          stateVersionId: "state-yue-qin-v1",
          stateScopes: ["present"],
          clipIndexes: [0],
          visualFacts: [{ key: "body", value: "terracotta" }],
          anchorNodeId: "yue-qin",
        }],
      }),
      "",
    );
    expect(entries.map((entry) => entry.url)).toEqual([QIN_YUE]);
  });

  it("状态锚 stateVersionId 不一致时原地缺失，不绑定同 stateKey 的旧图", () => {
    const entries = resolveClipReferenceImageEntries(
      rowTransforming(),
      clipOf({
        characterRoleNames: ["岳山"],
        visualStateAnchorRequirements: [{
          characterName: "岳山",
          stateKey: "qin-terracotta",
          stateVersionId: "state-yue-qin-v2",
          stateScopes: ["present"],
          clipIndexes: [0],
          visualFacts: [{ key: "body", value: "terracotta" }],
          anchorNodeId: "yue-qin",
        }],
      }),
      "",
    );
    expect(entries).toEqual([]);
  });

  it("无状态版卡的普通画布逐字等价旧行为（单卡直绑）", () => {
    const row = rowWith([
      { id: "wan-base", data: { kind: "image", roleName: "万钧", imageUrl: BASE_WAN, label: "角色卡·万钧" } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["万钧"] }),
      "",
    );
    expect(entries.map((e) => e.url)).toEqual([BASE_WAN]);
  });
});
