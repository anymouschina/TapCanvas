import { describe, expect, it } from "vitest";

import {
  parseReferenceLabel,
  summarizeClipAssetBinding,
  summarizeClipAssetContracts,
  diagnoseClipBinding,
} from "./video-orchestrator.clip-asset-binding";

describe("parseReferenceLabel — 从参考图标签还原资产身份（可观测性根基）", () => {
  it("角色卡·<名>（含状态/视图后缀）→ character + 纯角色名", () => {
    expect(parseReferenceLabel("角色卡·齐夏")).toEqual({ kind: "character", name: "齐夏" });
    expect(parseReferenceLabel("角色卡｜齐夏")).toEqual({ kind: "character", name: "齐夏" });
    expect(parseReferenceLabel("角色卡·岳山（兵马俑神将版）·视图2")).toEqual({
      kind: "character",
      name: "岳山",
    });
  });
  it("场景卡/场景锚/场景参考 → scene", () => {
    expect(parseReferenceLabel("场景卡｜封闭网格密室")).toEqual({
      kind: "scene",
      name: "封闭网格密室",
    });
    expect(parseReferenceLabel("场景锚·暴雨官道")).toEqual({ kind: "scene", name: "暴雨官道" });
  });
  it("道具卡/道具锚/道具参考 → prop", () => {
    expect(parseReferenceLabel("道具卡·山羊头骨面具")).toEqual({
      kind: "prop",
      name: "山羊头骨面具",
    });
  });
  it("群像图 → ensemble；站位图 → blocking", () => {
    expect(parseReferenceLabel("群像图｜圆桌十人+山羊头").kind).toBe("ensemble");
    expect(parseReferenceLabel("站位图·严格沿用人物画左/画右").kind).toBe("blocking");
  });
  it("无法识别前缀 → other（不猜）", () => {
    expect(parseReferenceLabel("参考图").kind).toBe("other");
    expect(parseReferenceLabel("场景/参考图").kind).toBe("other");
    expect(parseReferenceLabel("").kind).toBe("other");
  });
});

describe("summarizeClipAssetBinding — 每镜结构化资产绑定摘要", () => {
  it("按 kind 归类去重，统计 total", () => {
    const s = summarizeClipAssetBinding([
      { url: "u1", label: "角色卡·齐夏" },
      { url: "u2", label: "角色卡·山羊头人" },
      { url: "u3", label: "场景卡｜封闭网格密室" },
      { url: "u4", label: "道具卡·座钟" },
      { url: "u5", label: "群像图｜圆桌十人" },
      { url: "u6", label: "站位图·xx" },
      { url: "u7", label: "参考图" },
    ]);
    expect(s.characters).toEqual(["齐夏", "山羊头人"]);
    expect(s.scenes).toEqual(["封闭网格密室"]);
    expect(s.props).toEqual(["座钟"]);
    expect(s.ensembles).toEqual(["圆桌十人"]);
    expect(s.blocking).toBe(1);
    expect(s.other).toBe(1);
    expect(s.total).toBe(7);
  });
  it("同名角色多视图只计一次", () => {
    const s = summarizeClipAssetBinding([
      { url: "u1", label: "角色卡·齐夏·视图1" },
      { url: "u2", label: "角色卡·齐夏·视图2" },
    ]);
    expect(s.characters).toEqual(["齐夏"]);
    expect(s.total).toBe(2);
  });
});

describe("summarizeClipAssetContracts — 不从标签反推职责", () => {
  it("uses structured kind and name even when the human label format is absent", () => {
    expect(summarizeClipAssetContracts([
      { kind: "character", name: "怒海·赫尔斯", referenceImageNodeIds: ["char-1"] },
      { kind: "scene", name: "界级传送阵", referenceImageNodeIds: ["scene-1"] },
      { kind: "vfx", name: "猩红血气巨兽", referenceImageNodeIds: ["vfx-1"] },
    ])).toEqual({
      characters: ["怒海·赫尔斯"],
      scenes: ["界级传送阵"],
      props: [],
      ensembles: [],
      blocking: 0,
      other: 1,
      total: 3,
    });
  });
});

describe("diagnoseClipBinding — 漂移诊断告警", () => {
  it("出镜角色在文本声明但无卡绑定 → 报 missing-character-card", () => {
    const diags = diagnoseClipBinding({
      clipIndex: 2,
      binding: summarizeClipAssetBinding([{ url: "u1", label: "场景卡｜密室" }]),
      onScreenRoleNames: ["齐夏"],
      cap: 8,
      droppedCount: 0,
    });
    expect(diags.some((d) => d.code === "missing-character-card")).toBe(true);
    expect(diags.find((d) => d.code === "missing-character-card")?.message).toContain("齐夏");
  });
  it("参考图超上限被截断 → 报 refs-truncated（含丢弃数）", () => {
    const diags = diagnoseClipBinding({
      clipIndex: 0,
      binding: summarizeClipAssetBinding([{ url: "u1", label: "角色卡·齐夏" }]),
      onScreenRoleNames: ["齐夏"],
      cap: 8,
      droppedCount: 3,
    });
    const d = diags.find((x) => x.code === "refs-truncated");
    expect(d).toBeTruthy();
    expect(d?.message).toContain("3");
  });
  it("一镜无任何场景绑定 → 报 no-scene（场景飘早警）", () => {
    const diags = diagnoseClipBinding({
      clipIndex: 1,
      binding: summarizeClipAssetBinding([{ url: "u1", label: "角色卡·齐夏" }]),
      onScreenRoleNames: ["齐夏"],
      cap: 8,
      droppedCount: 0,
    });
    expect(diags.some((d) => d.code === "no-scene")).toBe(true);
  });
  it("绑定齐全（出镜角色都有卡 + 有场景 + 未截断）→ 无告警", () => {
    const diags = diagnoseClipBinding({
      clipIndex: 0,
      binding: summarizeClipAssetBinding([
        { url: "u1", label: "角色卡·齐夏" },
        { url: "u2", label: "场景卡｜密室" },
      ]),
      onScreenRoleNames: ["齐夏"],
      cap: 8,
      droppedCount: 0,
    });
    expect(diags.filter((d) => d.level === "warn")).toEqual([]);
  });
});
