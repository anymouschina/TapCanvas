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

  it("keeps the shared flow node identity bound deterministic", () => {
    const result = parseAssetObjectContracts([{
      ...base,
      kind: "character",
      name: "李长安",
      referenceRole: "identity",
      referenceImageNodeIds: ["n".repeat(FLOW_NODE_ID_MAX_LENGTH + 1)],
    }]);

    expect(result.contracts).toEqual([]);
    expect(result.errors).toContain(
      `assetObjectContracts[0].referenceImageNodeIds 每项最多 ${FLOW_NODE_ID_MAX_LENGTH} 字`,
    );
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
      { ...base, kind: "prop", name: "混沌钟", referenceImageNodeIds: [] },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.contracts).toEqual([
      expect.objectContaining({
        kind: "prop",
        name: "混沌钟",
        referenceRole: "prop",
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

  it("rejects multiple canonical project assets for one object identity", () => {
    const result = parseAssetObjectContracts([
      {
        ...base,
        kind: "scene",
        name: "军属宿舍",
        referenceRole: "environment",
        referenceImageNodeIds: [],
        referenceAssetIds: ["project-node:chapter:ch1:scene-a", "project-node:chapter:ch1:scene-b"],
      },
    ]);

    expect(result.contracts).toEqual([]);
    expect(result.errors.join("|")).toContain("最多绑定一个 canonical 项目资产");
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
    })).toBe(false);
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
    expect(rendered).toContain("@图N 以本次供应商最终 content[] 顺序为唯一真相");
    expect(rendered).toContain("@图2+@图3（prop:混沌钟）=prop");
    expect(rendered).toContain("保持：对象身份不变");
    expect(rendered).toContain("禁迁：不迁移参考图背景、机位与无关对象");
    expect(rendered).toContain("动作、位移、受力与终态以镜头表为准");
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

  it("rejects undeclared fields instead of silently preserving a parallel contract", () => {
    const result = parseAssetObjectContracts([
      { ...base, kind: "vfx", name: "青萍剑光", physicalSword: true },
    ]);
    expect(result.errors.join("|")).toContain("physicalSword 不是允许字段");
  });
});
