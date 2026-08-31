import { describe, expect, it } from "vitest";

import { consolidateSuccessfulPropStatePatch } from "./prop-state-canvas-consolidation";

const stateIdentity = {
  mode: "state",
  canonicalName: "混元金斗",
  canonicalAssetId: "asset-1",
  stateKey: "clear-light",
  stateDescription: "斗身释放清光",
};

describe("consolidateSuccessfulPropStatePatch", () => {
  it("does not remove the base while the state image is still running", () => {
    const patch = {
      createNodes: [{
        id: "state",
        data: {
          kind: "imageEdit",
          label: "道具卡｜混元金斗",
          materialIdentity: stateIdentity,
          status: "running",
        },
      }],
    };
    expect(consolidateSuccessfulPropStatePatch({
      currentNodes: [{ id: "base", data: { kind: "image", label: "道具卡｜混元金斗" } }],
      currentEdges: [],
      patch,
    })).toEqual({ patch, replacements: [] });
  });

  it("replaces old canonical nodes after success and migrates their edges", () => {
    const result = consolidateSuccessfulPropStatePatch({
      currentNodes: [
        {
          id: "base",
          data: { kind: "image", label: "道具卡｜混元金斗", imageUrl: "https://cdn.test/base.png" },
        },
        {
          id: "state",
          data: {
            kind: "imageEdit",
            label: "道具卡｜混元金斗",
            materialIdentity: stateIdentity,
            status: "running",
          },
        },
      ],
      currentEdges: [{ id: "edge-old", source: "base", target: "video-1" }],
      patch: {
        patchNodeData: [{
          id: "state",
          data: { status: "success", imageUrl: "https://cdn.test/state.png" },
        }],
      },
    });

    expect(result.replacements).toEqual([{
      canonicalName: "混元金斗",
      stateNodeId: "state",
      removedNodeIds: ["base"],
    }]);
    expect(result.patch.deleteNodeIds).toEqual(["base"]);
    expect(result.patch.createEdges).toEqual([
      expect.objectContaining({ source: "state", target: "video-1" }),
    ]);
  });

  it("never migrates an edge to another node deleted by the same patch", () => {
    const result = consolidateSuccessfulPropStatePatch({
      currentNodes: [
        {
          id: "base",
          data: { kind: "image", label: "道具卡｜混元金斗", imageUrl: "https://cdn.test/base.png" },
        },
        {
          id: "wrong-state",
          data: { kind: "image", label: "道具卡｜混元金斗清光", imageUrl: "https://cdn.test/wrong.png" },
        },
        {
          id: "state",
          data: {
            kind: "imageEdit",
            label: "道具卡｜混元金斗",
            materialIdentity: stateIdentity,
            status: "success",
            imageUrl: "https://cdn.test/state.png",
          },
        },
      ],
      currentEdges: [{ id: "edge-obsolete", source: "base", target: "wrong-state" }],
      patch: {
        deleteNodeIds: ["wrong-state"],
        patchNodeData: [{ id: "state", data: { upstreamReferenceOrder: [] } }],
      },
    });

    expect(result.patch.deleteNodeIds).toEqual(["wrong-state", "base"]);
    expect(result.patch.createEdges).toBeUndefined();
  });
});
