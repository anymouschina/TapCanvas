import { describe, expect, it } from "vitest";

import {
  advanceAssetRepairProgress,
  applyAuthoringAssetBindings,
  applyStoryPlanAssetBindings,
  buildIdempotentAssetRepairReplayDeclaration,
  buildAssetRepairProductionArtifactRoots,
  buildAssetRepairDeclaration,
  carryAssetRepairProgress,
  expandAssetRepairBindingsForFrozenReferences,
  verifyStateAnchorBaseReference,
} from "./video-orchestrator.asset-repair";

describe("authoring asset repair bindings", () => {
  it("expands repair only to sibling clips sharing the same frozen old reference", () => {
    const makeClip = (nodeId: string) => ({
      clipPrompt: "镜头执行提示词",
      assetObjectContracts: [{
        kind: "scene" as const,
        name: "军属家属院霍家",
        referenceRole: "environment" as const,
        referenceImageNodeIds: [nodeId],
      }],
    });
    const expanded = expandAssetRepairBindingsForFrozenReferences({
      plan: { clips: [makeClip("stale-scene"), makeClip("stale-scene"), makeClip("newer-scene")] },
      bindings: [{
        kind: "scene",
        name: "军属家属院霍家",
        referenceAssetId: "project-scene",
        clipIndexes: [0],
      }],
    });

    expect(expanded).toEqual([expect.objectContaining({ clipIndexes: [0, 1] })]);
  });

  it("atomically replaces stale chapter references with a selected project asset", () => {
    const referenceAssetId = "project-node:chapter:chapter-1:scene-family-compound";
    const clips = applyStoryPlanAssetBindings({
      plan: {
        clips: [{
          clipPrompt: "镜头执行提示词",
          videoReferenceNodeIds: ["character-node", "stale-scene-node"],
          assetObjectContracts: [{
            kind: "scene",
            name: "军属家属院霍家",
            referenceRole: "environment",
            referenceImageNodeIds: ["stale-scene-node"],
          }],
        }],
      },
      bindings: [{
        kind: "scene",
        name: "军属家属院霍家",
        referenceAssetId,
        clipIndexes: [0],
      }],
    });

    expect(clips[0]?.videoReferenceNodeIds).toEqual(["character-node"]);
    expect(clips[0]?.assetObjectContracts?.[0]).toMatchObject({
      referenceImageNodeIds: [],
      referenceAssetIds: [referenceAssetId],
    });
  });

  it("reconstructs a consumed repair cursor only from an identical frozen plan binding", () => {
    const referenceAssetId = "project-node:chapter:chapter-1:scene-family-compound";
    const plan = {
      clips: [{
        clipPrompt: "镜头执行提示词",
        assetObjectContracts: [{
          kind: "scene" as const,
          name: "军属家属院霍家",
          referenceRole: "environment" as const,
          identityInvariant: "同一院落",
          startState: "白天",
          spatialRelation: "院门连接主屋",
          scale: "院落",
          driver: "人物回家",
          stateChange: "进入院内",
          endState: "停在主屋前",
          referenceImageNodeIds: [],
          referenceAssetIds: [referenceAssetId],
        }],
      }],
    };

    const replay = buildIdempotentAssetRepairReplayDeclaration({
      runId: "run-1",
      plan,
      bindings: [{
        kind: "scene",
        name: "军属家属院霍家",
        referenceAssetId,
        clipIndexes: [0],
      }],
    });
    expect(replay).toMatchObject({
      reasonCode: "asset_repair_idempotent_replay",
      requiredAssets: [{ kind: "scene", name: "军属家属院霍家", clipIndexes: [0] }],
    });

    expect(buildIdempotentAssetRepairReplayDeclaration({
      runId: "run-1",
      plan,
      bindings: [{
        kind: "scene",
        name: "军属家属院霍家",
        referenceAssetId: "different-asset",
        clipIndexes: [0],
      }],
    })).toBeNull();
  });

  it("reopens only repaired result roots and never invalidates accepted provider submissions", () => {
    expect(buildAssetRepairProductionArtifactRoots([4, 4, 2, -1, 1.5])).toEqual([
      "video-result:2",
      "video-result:4",
    ]);
  });

  it("freezes an agents-selected project asset without pretending its source node belongs to this chapter", () => {
    const referenceAssetId = "project-node:chapter:chapter-1:scene-family-compound";
    const result = JSON.parse(applyAuthoringAssetBindings({
      beatSheetJson: JSON.stringify({
        version: 2,
      beats: [{
        clipIndex: 0,
        videoReferenceNodeIds: ["current-character", "stale-scene-node"],
        assetObjectContracts: [{
          kind: "scene",
          name: "军属宿舍（卧房与灶台同屋）",
          referenceImageNodeIds: ["stale-scene-node"],
        }],
        }],
      }),
      bindings: [{
        kind: "scene",
        name: "军属宿舍（卧房与灶台同屋）",
        referenceAssetId,
      }],
    })) as {
      beats: Array<{
        videoReferenceNodeIds: string[];
        assetObjectContracts: Array<{
          referenceImageNodeIds: string[];
          referenceAssetIds?: string[];
        }>;
      }>;
    };

    expect(result.beats[0]?.videoReferenceNodeIds).toEqual(["current-character"]);
    expect(result.beats[0]?.assetObjectContracts[0]).toMatchObject({
      referenceImageNodeIds: [],
      referenceAssetIds: [referenceAssetId],
    });
  });

  it("advances partial verified bindings monotonically instead of discarding the batch", () => {
    const initial = buildAssetRepairDeclaration({
      runId: "run-1",
      reasonCode: "asset_coverage_incomplete",
      requiredAssets: [
        {
          kind: "scene",
          name: "军属家属院",
          referenceRole: "environment",
          clipIndexes: [0],
          affectedNodeIds: [],
        },
        {
          kind: "character",
          name: "沈清棠",
          referenceRole: "identity",
          clipIndexes: [0, 1],
          affectedNodeIds: [],
        },
      ],
    });

    const first = advanceAssetRepairProgress({
      declaration: initial,
      verifiedBindings: [{
        kind: "scene",
        name: "军属家属院",
        referenceAssetId: "project-scene-1",
      }],
    });

    expect(first.complete).toBe(false);
    expect(first.declaration.requiredAssets).toEqual([
      expect.objectContaining({ kind: "character", name: "沈清棠" }),
    ]);
    expect(first.declaration.progress).toMatchObject({
      revision: 1,
      totalCount: 2,
      resolvedBindings: [expect.objectContaining({ referenceAssetId: "project-scene-1" })],
    });

    const final = advanceAssetRepairProgress({
      declaration: first.declaration,
      verifiedBindings: [{
        kind: "character",
        name: "沈清棠",
        nodeId: "character-node-1",
      }],
    });
    expect(final.complete).toBe(true);
    expect(final.declaration.progress).toMatchObject({ revision: 2, totalCount: 2 });
    expect(final.resolvedBindings).toHaveLength(2);
  });

  it("preserves progress when the authoring driver refreshes mutable coverage", () => {
    const initial = buildAssetRepairDeclaration({
      runId: "run-1",
      reasonCode: "asset_coverage_incomplete",
      requiredAssets: [{
        kind: "scene",
        name: "军属家属院",
        referenceRole: "environment",
        clipIndexes: [0],
        affectedNodeIds: [],
      }],
    });
    const progressed = advanceAssetRepairProgress({
      declaration: initial,
      verifiedBindings: [{
        kind: "scene",
        name: "军属家属院",
        referenceAssetId: "project-scene-1",
      }],
    }).declaration;
    const refreshed = buildAssetRepairDeclaration({
      runId: "run-1",
      reasonCode: "asset_coverage_incomplete",
      requiredAssets: [{
        kind: "prop",
        name: "搪瓷杯",
        referenceRole: "prop",
        clipIndexes: [1],
        affectedNodeIds: [],
      }],
    });

    expect(carryAssetRepairProgress({ declaration: refreshed, previous: progressed }).progress)
	  .toMatchObject({ revision: 2, totalCount: 2 });
  });

  it("reopens a previously resolved identity when fresh coverage reports it missing again", () => {
    const initial = buildAssetRepairDeclaration({
      runId: "run-1",
      reasonCode: "asset_coverage_incomplete",
      requiredAssets: [{
        kind: "scene",
        name: "军属家属院",
        referenceRole: "environment",
        clipIndexes: [0],
        affectedNodeIds: [],
      }],
    });
    const progressed = advanceAssetRepairProgress({
      declaration: initial,
      verifiedBindings: [{
        kind: "scene",
        name: "军属家属院",
        referenceAssetId: "project-scene-1",
      }],
    }).declaration;
    const staleCoverage = buildAssetRepairDeclaration({
      runId: "run-1",
      reasonCode: "asset_coverage_incomplete",
      requiredAssets: [{
        kind: "scene",
        name: "军属家属院",
        referenceRole: "environment",
        clipIndexes: [0],
        affectedNodeIds: [],
      }, {
        kind: "prop",
        name: "搪瓷杯",
        referenceRole: "prop",
        clipIndexes: [1],
        affectedNodeIds: [],
      }],
    });

    const carried = carryAssetRepairProgress({ declaration: staleCoverage, previous: progressed });

    expect(carried.requiredAssets).toEqual([
      expect.objectContaining({ kind: "scene", name: "军属家属院" }),
      expect.objectContaining({ kind: "prop", name: "搪瓷杯" }),
    ]);
    expect(carried.progress).toMatchObject({
      revision: 2,
      totalCount: 2,
      resolvedBindings: [],
    });
  });

  it("projects one canonical evidence record per static identity into the repair cursor", () => {
    const evidence = (clipIndex: number) => ({
      clipIndex,
      referenceRole: "environment",
      identityInvariant: "同一军属宿舍的结构与陈设保持不变",
      startState: "室内白天",
      spatialRelation: "床与八仙桌相邻",
      scale: "室内中景",
      driver: "人物在同一空间行动",
      stateChange: "人物走位变化",
      endState: "仍在同一宿舍",
    });
    const declaration = buildAssetRepairDeclaration({
      runId: "run-1",
      reasonCode: "asset_coverage_incomplete",
      requiredAssets: [{
        kind: "scene",
        name: "军属宿舍",
        referenceRole: "environment",
        clipIndexes: [0, 1, 2],
        affectedNodeIds: [],
        sourceEvidence: [evidence(0), evidence(1), evidence(2)],
      }],
    });

    expect(declaration.requiredAssets[0]?.sourceEvidence).toEqual([evidence(0)]);
    expect(declaration.requiredAssets[0]?.clipIndexes).toEqual([0, 1, 2]);
  });

  it("keeps two visual-state versions of the same character as independent repair identities", () => {
    const declaration = buildAssetRepairDeclaration({
      runId: "run-state",
      reasonCode: "asset_coverage_incomplete",
      requiredAssets: [
        {
          kind: "character",
          name: "沈知夏",
          stateKey: "present-pregnant",
          stateVersionId: "state-present-pregnant-v1",
          stateScopes: ["present"],
          visualFacts: [{ key: "pregnancy", value: "three-month visible pregnancy" }],
          referenceRole: "character_state",
          clipIndexes: [0, 8, 9],
          affectedNodeIds: [],
        },
        {
          kind: "character",
          name: "沈知夏",
          stateKey: "premarriage-nonpregnant",
          stateVersionId: "state-premarriage-v1",
          stateScopes: ["memory-premarriage"],
          visualFacts: [{ key: "pregnancy", value: "not pregnant" }],
          referenceRole: "character_state",
          clipIndexes: [3],
          affectedNodeIds: [],
        },
      ],
    });

    expect(declaration.version).toBe(3);
    expect(declaration.requiredAssets).toHaveLength(2);
    expect(declaration.requiredAssets.map((asset) => asset.stateVersionId)).toEqual([
      "state-present-pregnant-v1",
      "state-premarriage-v1",
    ]);

    const progressed = advanceAssetRepairProgress({
      declaration,
      verifiedBindings: [{
        kind: "character",
        name: "沈知夏",
        stateKey: "present-pregnant",
        stateVersionId: "state-present-pregnant-v1",
        nodeId: "state-anchor-pregnant",
      }],
    });
    expect(progressed.complete).toBe(false);
    expect(progressed.declaration.requiredAssets).toEqual([
      expect.objectContaining({ stateVersionId: "state-premarriage-v1" }),
    ]);
  });

  it("accepts a state anchor only when it references a same-name ready base character", () => {
    const baseNode = {
      id: "character-base",
      data: {
        referenceType: "character",
        roleName: "沈知夏",
        characterProfileVersion: "character-card/v3",
        imageUrl: "https://oss.example.com/character-base.png",
      },
    };
    const stateNode = {
      id: "character-state-pregnant",
      data: {
        referenceType: "character",
        roleName: "沈知夏",
        characterProfileVersion: "character-card/v3",
        stateKey: "present-pregnant",
        stateVersionId: "state-present-pregnant-v1",
        referenceImageNodeIds: ["character-base"],
        imageUrl: "https://oss.example.com/character-state-pregnant.png",
      },
    };

    expect(verifyStateAnchorBaseReference({
      stateNode,
      flowNodes: [baseNode, stateNode],
      characterName: "沈知夏",
    })).toEqual({
      ok: true,
      baseNodeId: "character-base",
      baseImageUrl: "https://oss.example.com/character-base.png",
    });
    expect(verifyStateAnchorBaseReference({
      stateNode: {
        ...stateNode,
        data: { ...stateNode.data, referenceImageNodeIds: [] },
      },
      flowNodes: [baseNode, stateNode],
      characterName: "沈知夏",
    })).toMatchObject({
      ok: false,
      code: "asset_repair_state_base_reference_missing",
    });
    expect(verifyStateAnchorBaseReference({
      stateNode,
      flowNodes: [{
        ...baseNode,
        data: { ...baseNode.data, roleName: "霍沉舟" },
      }, stateNode],
      characterName: "沈知夏",
    })).toMatchObject({
      ok: false,
      code: "asset_repair_state_base_reference_invalid",
    });
  });

  it("writes a verified state anchor back to both the chapter timeline and affected beats", () => {
    const result = JSON.parse(applyAuthoringAssetBindings({
      beatSheetJson: JSON.stringify({
        version: 2,
        visualStateTimeline: {
          version: 1,
          intervals: [{
            characterName: "沈知夏",
            stateScope: "present",
            stateVersionId: "state-present-pregnant-v1",
            stateKey: "present-pregnant",
            startClipIndex: 0,
            endClipIndex: 1,
            visualFacts: [{ key: "pregnancy", value: "three-month visible pregnancy" }],
            anchorPolicy: "state_specific",
          }],
        },
        beats: [{
          clipIndex: 0,
          videoReferenceNodeIds: ["character-base"],
          visualStateAnchorRequirements: [{
            characterName: "沈知夏",
            stateKey: "present-pregnant",
            stateVersionId: "state-present-pregnant-v1",
            stateScopes: ["present"],
            clipIndexes: [0, 1],
            visualFacts: [{ key: "pregnancy", value: "three-month visible pregnancy" }],
          }],
          assetObjectContracts: [{
            kind: "character",
            name: "沈知夏",
            referenceImageNodeIds: ["character-base"],
          }],
        }],
      }),
      bindings: [{
        kind: "character",
        name: "沈知夏",
        stateKey: "present-pregnant",
        stateVersionId: "state-present-pregnant-v1",
        nodeId: "state-anchor-pregnant",
        clipIndexes: [0],
      }],
    })) as {
      visualStateTimeline: { intervals: Array<{ anchorNodeId?: string }> };
      beats: Array<{
        videoReferenceNodeIds: string[];
        visualStateAnchorRequirements: Array<{ anchorNodeId?: string }>;
      }>;
    };

    expect(result.visualStateTimeline.intervals[0]?.anchorNodeId).toBe("state-anchor-pregnant");
    expect(result.beats[0]?.visualStateAnchorRequirements[0]?.anchorNodeId)
      .toBe("state-anchor-pregnant");
    expect(result.beats[0]?.videoReferenceNodeIds).toEqual(["state-anchor-pregnant"]);
  });
});
