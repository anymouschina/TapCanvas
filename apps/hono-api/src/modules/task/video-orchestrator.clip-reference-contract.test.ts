import { describe, expect, it } from "vitest";

import type { AssetObjectContract } from "./video-orchestrator.asset-object-contract";
import {
  buildCanonicalVideoReferenceNodeIds,
  findLegacyClipReferenceFields,
  validateClipAssetObjectCoverage,
  validateFrameReferenceSeparation,
} from "./video-orchestrator.clip-reference-contract";

function contract(
  kind: AssetObjectContract["kind"],
  name: string,
  nodeId: string,
): AssetObjectContract {
  return {
    kind,
    name,
    referenceImageNodeIds: [nodeId],
    referenceRole: kind === "scene" ? "environment" : kind === "prop" ? "prop" : "identity",
    forbiddenTransfer: "不迁移无关内容",
    identityInvariant: `${name}身份与造型不变`,
    startState: "起始状态",
    spatialRelation: "明确空间关系",
    scale: "尺度固定",
    driver: "动作驱动明确",
    stateChange: "发生可见变化",
    endState: "结束状态",
  };
}

describe("clip video reference single authority", () => {
  it("compiles object-contract references and explicit references into one stable list", () => {
    expect(
      buildCanonicalVideoReferenceNodeIds({
        videoReferenceNodeIds: ["hero", "scene", "extra", "hero"],
        assetObjectContracts: [
          contract("character", "墨", "hero"),
          contract("scene", "雨夜废墟", "scene"),
        ],
      }),
    ).toEqual(["hero", "scene", "extra"]);
  });

  it("replaces a character base card with the exact state anchor for that clip", () => {
    expect(buildCanonicalVideoReferenceNodeIds({
      videoReferenceNodeIds: ["hero-base", "scene", "hero-state"],
      assetObjectContracts: [
        contract("character", "沈知夏", "hero-base"),
        contract("scene", "卫生所", "scene"),
      ],
      visualStateAnchorRequirements: [{
        characterName: "沈知夏",
        stateKey: "present-pregnant",
        stateVersionId: "state-present-pregnant-v1",
        anchorNodeId: "hero-state",
      }],
    })).toEqual(["scene", "hero-state"]);
  });

  it("detects the removed clip-level reference field without translating it", () => {
    expect(findLegacyClipReferenceFields({ referenceImageNodeIds: ["legacy"] })).toEqual([
      "referenceImageNodeIds",
    ]);
    expect(findLegacyClipReferenceFields({ videoReferenceNodeIds: [] })).toEqual([]);
  });

  it("requires every structured on-screen object to have a same-kind canonical contract", () => {
    const errors = validateClipAssetObjectCoverage(
      {
        characterRoleNames: ["墨", "霜"],
        sceneName: "雨夜废墟",
        propNames: ["黑刃"],
        vfxNames: ["白色冲击波"],
        assetObjectContracts: [
          contract("character", "墨", "hero-mo"),
          contract("scene", "雨夜废墟", "scene-rain"),
        ],
      },
      "clips[1]",
    );
    expect(errors).toEqual([
      "clips[1].assetObjectContracts 缺 character:霜",
      "clips[1].assetObjectContracts 缺 prop:黑刃",
      "clips[1].assetObjectContracts 缺 vfx:白色冲击波",
    ]);
  });

  it("keeps business references separate from first/last-frame roles", () => {
    expect(
      validateFrameReferenceSeparation({
        videoReferenceNodeIds: ["hero", "bridge"],
        storyboardImageNodeId: "bridge",
        lastFrameImageNodeId: "tail",
        path: "clips[2]",
      }),
    ).toEqual([
      "clips[2].videoReferenceNodeIds 不得重复 storyboardImageNodeId=bridge",
    ]);
  });
});
