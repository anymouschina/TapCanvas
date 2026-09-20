import { describe, expect, it } from "vitest";

import {
  assetObjectContractIdentityKey,
  formatAssetObjectContracts,
  formatAssetObjectReferenceLocks,
  parseAssetObjectContracts,
  requiresAuthoringVisualReference,
} from "./video-orchestrator.asset-object-contract";
import { assetObjectContractSchema } from "./video-orchestrator.tool-schema";
import { FLOW_NODE_ID_MAX_LENGTH } from "../flow/flow-node-id.constants";

const base = {
  referenceImageNodeIds: ["asset-base"],
  referenceRole: "prop",
  forbiddenTransfer: "不迁移参考图背景、机位与无关对象",
  identityInvariant: "对象身份不变",
  startState: "起始状态明确",
  spatialRelation: "空间关系明确",
  scale: "尺度参照明确",
  driver: "法力驱动",
  stateChange: "沿既定轨迹变化",
  endState: "落到明确终态",
};

describe("asset object contracts", () => {
  it("requires the first structured draft to declare a physical identity slot for every object", () => {
    expect(assetObjectContractSchema.required).toContain("physicalIdentityKey");
    expect(assetObjectContractSchema.properties?.physicalIdentityKey).toMatchObject({
      oneOf: [expect.objectContaining({ type: "string" }), { type: "null" }],
    });
  });

  it("accepts a real workflow-projected image node identity wider than the old UI-sized bound", () => {
    const projectedNodeId = [
      "video-workflow-852f5557-904a-4efb-920f-fbcaabe3cfe1",
      "asset-image-generate::item::asset-character-li-changan-identity-v1",
      "family::workflow-execution-f5472878f13a73eaff8c9c3d976bd78637cc019f",
      "output::image",
      "projection::source-revision-63",
    ].join(":");
    expect(projectedNodeId.length).toBeGreaterThan(200);
    expect(projectedNodeId.length).toBeLessThanOrEqual(FLOW_NODE_ID_MAX_LENGTH);

    const result = parseAssetObjectContracts([{
      ...base,
      kind: "character",
      name: "李长安",
      referenceRole: "identity",
      referenceImageNodeIds: [projectedNodeId],
    }]);

    expect(result.errors).toEqual([]);
    expect(result.contracts[0]?.referenceImageNodeIds).toEqual([projectedNodeId]);
  });

  it("preserves opaque persisted reference identities without applying prose budgets", () => {
    const nodeId = "n".repeat(FLOW_NODE_ID_MAX_LENGTH + 1);
    const assetId = `project-node:project:scope:${nodeId}`;
    const result = parseAssetObjectContracts([{
      ...base,
      kind: "character",
      name: "李长安",
      referenceRole: "identity",
      referenceImageNodeIds: [nodeId],
      referenceAssetIds: [assetId],
    }]);

    expect(result.errors).toEqual([]);
    expect(result.contracts[0]).toMatchObject({ referenceImageNodeIds: [nodeId], referenceAssetIds: [assetId] });
  });

  it("allows an explicit empty array only when the caller selects the no-object contract", () => {
    expect(parseAssetObjectContracts([]).errors).toContain(
      "assetObjectContracts 必须至少声明一个资产对象",
    );
    expect(parseAssetObjectContracts([], "assetObjectContracts", { allowEmpty: true })).toEqual({
      contracts: [],
      errors: [],
    });
  });

  it("keeps a descriptive prop without promoting it to a hard image dependency", () => {
    const result = parseAssetObjectContracts([
      { ...base, kind: "prop", name: "混沌钟", referenceRole: "none", referenceImageNodeIds: [] },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.contracts).toEqual([
      expect.objectContaining({
        kind: "prop",
        name: "混沌钟",
        referenceRole: "none",
        referenceImageNodeIds: [],
        referenceAssetIds: [],
      }),
    ]);
  });

  it("requires identity roles to bind concrete reference image nodes at execution", () => {
    const result = parseAssetObjectContracts([
      {
        ...base,
        kind: "character",
        name: "红衣枪客",
        referenceRole: "identity",
        referenceImageNodeIds: [],
      },
    ]);
    expect(result.contracts).toEqual([]);
    expect(result.errors.join("|")).toContain(
      "必须通过 referenceImageNodeIds 或 referenceAssetIds 绑定真实图片资产",
    );
  });

  it("preserves an agents-selected cross-chapter project asset binding", () => {
    const referenceAssetId =
      "project-node:chapter:chapter-1:scene-family-compound";
    const result = parseAssetObjectContracts([
      {
        ...base,
        kind: "scene",
        name: "军属宿舍（卧房与灶台同屋）",
        referenceRole: "environment",
        referenceImageNodeIds: [],
        referenceAssetIds: [referenceAssetId],
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.contracts[0]).toMatchObject({
      kind: "scene",
      name: "军属宿舍（卧房与灶台同屋）",
      referenceImageNodeIds: [],
      referenceAssetIds: [referenceAssetId],
    });
  });

  it.each(["character", "scene", "prop"])("preserves multiple selected images of one %s in the published schema and runtime", (kind) => {
    const referenceAssetIds = ["project-node:chapter:ch1:view-a", "project-node:chapter:ch1:view-b", "uploaded-detail"];
    const result = parseAssetObjectContracts([
      {
        ...base,
        kind,
        name: "军属宿舍",
        referenceRole: "environment",
        referenceImageNodeIds: [],
        referenceAssetIds,
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.contracts[0]?.referenceAssetIds).toEqual(referenceAssetIds);
    expect(assetObjectContractSchema.properties?.referenceAssetIds).not.toHaveProperty("maxItems");
  });

  it.each([null, "asset-a", ["asset-a", 7], ["asset-a", " "]])("does not silently drop malformed selected references: %j", (referenceAssetIds) => {
    const result = parseAssetObjectContracts([{ ...base, kind: "prop", name: "商品", referenceAssetIds }]);
    expect(result.contracts).toEqual([]);
    expect(result.errors).toContain("assetObjectContracts[0].referenceAssetIds 必须是非空字符串 ID 数组");
  });

  it("keeps a draft identity contract when the authoring phase has not created its node yet", () => {
    const result = parseAssetObjectContracts(
      [{ ...base, kind: "character", name: "红衣枪客", referenceRole: "identity", referenceImageNodeIds: [] }],
      "beats[0].assetObjectContracts",
      { allowMissingReferenceImageNodeIds: true },
    );

    expect(result).toEqual({
      contracts: [expect.objectContaining({
        kind: "character",
        name: "红衣枪客",
        referenceImageNodeIds: [],
      })],
      errors: [],
    });
  });

  it("separates descriptive objects from hard visual reference dependencies", () => {
    expect(requiresAuthoringVisualReference({
      referenceRole: "none",
      referenceImageNodeIds: [],
      referenceAssetIds: [],
    })).toBe(false);
    expect(requiresAuthoringVisualReference({
      referenceRole: "prop",
      referenceImageNodeIds: [],
      referenceAssetIds: [],
    })).toBe(true);
    expect(requiresAuthoringVisualReference({
      referenceRole: "environment",
      referenceImageNodeIds: [],
      referenceAssetIds: [],
    })).toBe(true);
    expect(requiresAuthoringVisualReference({
      referenceRole: "prop",
      referenceImageNodeIds: ["prop-reference"],
      referenceAssetIds: [],
    })).toBe(true);
  });

  it.each(["identity", "wardrobe", "prop", "environment", "palette", "composition", "vfx"])(
    "retains declared %s references before materialization and requires binding at execution",
    (referenceRole) => {
      const input = [{ ...base, kind: "prop", name: "对象", referenceRole, referenceImageNodeIds: [] }];
      const draft = parseAssetObjectContracts(input, "objects", { allowMissingReferenceImageNodeIds: true });
      expect(draft.errors).toEqual([]);
      expect(requiresAuthoringVisualReference(draft.contracts[0]!)).toBe(true);
      expect(parseAssetObjectContracts(input).errors.join("|")).toContain(
        "必须通过 referenceImageNodeIds 或 referenceAssetIds 绑定真实图片资产",
      );
    },
  );

  it("keeps a pure text-to-video scene without creating an authoring image dependency", () => {
    const result = parseAssetObjectContracts([{
      kind: "scene",
      name: "雨后小城街道",
      referenceImageNodeIds: [],
      referenceRole: "none",
      startState: "雨后路面映出店铺暖灯",
      endState: "公交驶离后街道恢复安静",
    }]);

    expect(result.errors).toEqual([]);
    expect(result.contracts).toEqual([expect.objectContaining({
      kind: "scene",
      name: "雨后小城街道",
      referenceRole: "none",
      referenceImageNodeIds: [],
    })]);
    expect(requiresAuthoringVisualReference(result.contracts[0]!)).toBe(false);
  });

  it("accepts the minimal executable identity contract without creative prose fields", () => {
    const result = parseAssetObjectContracts(
      [{
        kind: "scene",
        name: "军属家属院",
        referenceImageNodeIds: [],
        referenceRole: "environment",
      }],
      "beats[0].assetObjectContracts",
      { allowMissingReferenceImageNodeIds: true },
    );

    expect(result.errors).toEqual([]);
    expect(result.contracts).toEqual([{
      kind: "scene",
      name: "军属家属院",
      referenceImageNodeIds: [],
      referenceAssetIds: [],
      referenceRole: "environment",
    }]);
  });

  it("keeps sword light as an explicit VFX object instead of a physical sword", () => {
    const result = parseAssetObjectContracts([
      {
        ...base,
        kind: "vfx",
        referenceRole: "vfx",
        name: "青萍剑光",
        referenceImageNodeIds: ["vfx-qingping-light"],
        identityInvariant: "冷青能量光迹，不是青萍剑实体",
        stateChange: "从远方发源，横越混沌后消散",
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.contracts[0]).toMatchObject({
      kind: "vfx",
      name: "青萍剑光",
      identityInvariant: "冷青能量光迹，不是青萍剑实体",
    });
  });

  it("encodes a suspended bell with no hand contact and a small-to-large activation chain", () => {
    const result = parseAssetObjectContracts([
      {
        ...base,
        kind: "prop",
        name: "混沌钟",
        startState: "古朴小钟悬浮于太一掌心上方",
        spatialRelation: "掌心与钟体保持清晰间隙，不接触",
        scale: "起态小于掌宽，发动后扩展为巨钟",
        driver: "太一以法力隔空托举并催动",
        stateChange: "小钟先悬浮稳定，随后迎风变大并释放钟波",
        endState: "巨钟悬空完成发动，冲击波扩散",
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.contracts[0]?.spatialRelation).toContain("不接触");
    expect(result.contracts[0]?.stateChange).toContain("迎风变大");
  });

  it("renders compact reference locks while preserving motion facts in the structured contract", () => {
    const result = parseAssetObjectContracts([{ ...base, kind: "prop", name: "混沌钟" }]);
    const rendered = formatAssetObjectReferenceLocks(
      result.contracts,
      new Map([
        [assetObjectContractIdentityKey("prop", "混沌钟"), ["@图2", "@图3"]],
      ]),
    );
    expect(rendered).toBe(`参考图绑定：\n混沌钟（${base.referenceRole}）：@图2、@图3；身份不变量：${base.identityInvariant}；禁止从参考图迁移：${base.forbiddenTransfer}`);
    expect(rendered).not.toContain("法力驱动");
    expect(rendered).not.toContain("沿既定轨迹变化");
    expect(rendered).not.toContain("落到明确终态");
    expect(result.contracts[0]).toMatchObject({
      driver: "法力驱动",
      stateChange: "沿既定轨迹变化",
      endState: "落到明确终态",
    });
    const compactWithoutFinalIndices = formatAssetObjectReferenceLocks(result.contracts);
    expect(Array.from(compactWithoutFinalIndices).length).toBeLessThan(
      Array.from(formatAssetObjectContracts(result.contracts)).length,
    );
  });

  it("preserves each bound object's reference scope without inventing absent facts", () => {
    const contracts = parseAssetObjectContracts([
      { ...base, kind: "character", referenceRole: "identity", name: "甲", identityInvariant: "蓝衣", forbiddenTransfer: "背景" },
      { ...base, kind: "character", referenceRole: "identity", name: "乙", identityInvariant: "白衣", forbiddenTransfer: "姿势" },
      { ...base, kind: "prop", name: "杯", identityInvariant: undefined, forbiddenTransfer: undefined },
      { ...base, kind: "scene", name: "未绑定空间" },
    ]).contracts;
    expect(formatAssetObjectReferenceLocks(contracts, new Map([
      [assetObjectContractIdentityKey("character", "甲"), ["@图1", "@图2", "@图1"]],
      [assetObjectContractIdentityKey("character", "乙"), ["@图3"]],
      [assetObjectContractIdentityKey("prop", "杯"), ["@图4"]],
    ]))).toBe("参考图绑定：\n甲（identity）：@图1、@图2；身份不变量：蓝衣；禁止从参考图迁移：背景\n乙（identity）：@图3；身份不变量：白衣；禁止从参考图迁移：姿势\n杯（prop）：@图4");
  });

  it("rejects undeclared fields instead of silently preserving a parallel contract", () => {
    const result = parseAssetObjectContracts([
      { ...base, kind: "vfx", name: "青萍剑光", physicalSword: true },
    ]);
    expect(result.errors.join("|")).toContain("physicalSword 不是允许字段");
  });
});
