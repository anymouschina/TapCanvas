import { describe, expect, it } from "vitest";

import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import { rebindReplanBeatSheetReferences } from "./video-orchestrator.replan-reference";

function node(id: string, data: Record<string, unknown>): VideoFlowNode {
  const referenceType = data.referenceType;
  return {
    id,
    data: {
      ...data,
      ...(referenceType === "character" && !data.characterProfileVersion
        ? { characterProfileVersion: "character-card/v3" }
        : {}),
      ...(referenceType === "scene" && !data.sceneProfileVersion
        ? { sceneProfileVersion: "scene-card/v1" }
        : {}),
    },
  };
}

describe("rebindReplanBeatSheetReferences", () => {
  it("rebinds an existing node id when its structured identity drifted", () => {
    const beatSheet = {
      beats: [{
        clipIndex: 4,
        videoReferenceNodeIds: ["old-scene"],
        assetObjectContracts: [{
          kind: "scene",
          name: "军属家属院霍家",
          referenceImageNodeIds: ["old-scene"],
        }],
      }],
    };
    const result = rebindReplanBeatSheetReferences({
      beatSheet,
      currentNodes: [
        node("old-scene", {
          kind: "image",
          referenceType: "scene",
          sceneName: "军属家属院",
          imageUrl: "https://assets.test/old-scene.png",
        }),
        node("exact-scene", {
          kind: "image",
          referenceType: "scene",
          sceneName: "军属家属院霍家",
          imageUrl: "https://assets.test/exact-scene.png",
        }),
      ],
    });

    const repairedBeat = (result.beatSheet.beats as Array<Record<string, unknown>>)[0];
    const repairedContract = (repairedBeat?.assetObjectContracts as Array<Record<string, unknown>>)[0];
    expect(repairedContract?.referenceImageNodeIds).toEqual(["exact-scene"]);
    expect(repairedBeat?.videoReferenceNodeIds).toEqual(["exact-scene"]);
    expect(result.evidence).toMatchObject({
      rebound: [{
        oldNodeId: "old-scene",
        newNodeId: "exact-scene",
        kind: "scene",
        name: "军属家属院霍家",
        clipIndexes: [4],
      }],
      unresolved: [],
    });
  });

  it("does not bind an explicitly rejected identity card", () => {
    const beatSheet = {
      beats: [{
        clipIndex: 0,
        videoReferenceNodeIds: [],
        assetObjectContracts: [{
          kind: "character",
          name: "角色甲",
          referenceImageNodeIds: [],
        }],
      }],
    };
    const result = rebindReplanBeatSheetReferences({
      beatSheet,
      currentNodes: [node("rejected-role", {
        kind: "image",
        referenceType: "character",
        roleName: "角色甲",
        imageUrl: "https://assets.test/rejected.png",
        approvalStatus: "rejected",
      })],
    });

    expect(result.evidence.bound).toEqual([]);
    expect(
      ((result.beatSheet.beats as Array<Record<string, unknown>>)[0]
        ?.assetObjectContracts as Array<Record<string, unknown>>)[0]
        ?.referenceImageNodeIds,
    ).toEqual([]);
  });
});
