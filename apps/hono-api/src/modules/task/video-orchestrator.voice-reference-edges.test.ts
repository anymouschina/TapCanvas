import { describe, expect, it } from "vitest";
import {
  buildVoiceReferenceEdgeSyncPlan,
  readVoiceReferenceNodeIds,
} from "./video-orchestrator.voice-reference-edges";

function voiceCard(id: string) {
  return { id, type: "taskNode", data: { kind: "audio", audioType: "voice_card" } };
}

function video(id: string) {
  return { id, type: "taskNode", data: { kind: "video" } };
}

describe("readVoiceReferenceNodeIds", () => {
  it("reads unique structural nodeId bindings in source order", () => {
    expect(readVoiceReferenceNodeIds([
      { character: "甲", nodeId: "voice-a" },
      { character: "乙", nodeId: "voice-b" },
      { character: "甲", nodeId: "voice-a" },
      null,
    ])).toEqual(["voice-a", "voice-b"]);
  });
});

describe("buildVoiceReferenceEdgeSyncPlan", () => {
  it("creates a deterministic typed reference-only provenance edge", () => {
    const plan = buildVoiceReferenceEdgeSyncPlan({
      current: { nodes: [voiceCard("voice-a"), video("clip-a")], edges: [] },
      clipNodeId: "clip-a",
      voiceReferenceNodeIds: ["voice-a"],
    });
    expect(plan).toEqual({
      createEdges: [{
        id: "e-voice-reference-voice-a-clip-a",
        source: "voice-a",
        target: "clip-a",
        sourceHandle: "out-audio",
        targetHandle: "in-any",
        type: "typed",
        label: "音色",
        data: {
          edgeType: "audio",
          relationKind: "voice_reference",
          executionRole: "reference_only",
          label: "音色",
        },
      }],
      deleteEdgeIds: [],
    });
  });

  it("is idempotent when the canonical edge already exists", () => {
    const edge = {
      id: "e-voice-reference-voice-a-clip-a",
      source: "voice-a",
      target: "clip-a",
      sourceHandle: "out-audio",
      targetHandle: "in-any",
      type: "typed",
      label: "音色",
      data: {
        edgeType: "audio",
        relationKind: "voice_reference",
        executionRole: "reference_only",
        label: "音色",
      },
    };
    expect(buildVoiceReferenceEdgeSyncPlan({
      current: { nodes: [voiceCard("voice-a"), video("clip-a")], edges: [edge] },
      clipNodeId: "clip-a",
      voiceReferenceNodeIds: ["voice-a"],
    })).toEqual({ createEdges: [], deleteEdgeIds: [] });
  });

  it("removes stale reference edges and leaves unused voice cards disconnected", () => {
    const stale = {
      id: "e-voice-reference-voice-old-clip-a",
      source: "voice-old",
      target: "clip-a",
      data: {
        edgeType: "audio",
        relationKind: "voice_reference",
        executionRole: "reference_only",
      },
    };
    const plan = buildVoiceReferenceEdgeSyncPlan({
      current: {
        nodes: [voiceCard("voice-old"), voiceCard("voice-new"), voiceCard("voice-unused"), video("clip-a")],
        edges: [stale],
      },
      clipNodeId: "clip-a",
      voiceReferenceNodeIds: ["voice-new"],
    });
    expect(plan.deleteEdgeIds).toEqual([stale.id]);
    expect(plan.createEdges.map((edge) => edge.source)).toEqual(["voice-new"]);
  });

  it("hard-converts an ordinary direct voice-card edge into reference-only semantics", () => {
    const plan = buildVoiceReferenceEdgeSyncPlan({
      current: {
        nodes: [voiceCard("voice-a"), video("clip-a")],
        edges: [{ id: "manual-audio-edge", source: "voice-a", target: "clip-a", sourceHandle: "out-audio", targetHandle: "in-any" }],
      },
      clipNodeId: "clip-a",
      voiceReferenceNodeIds: ["voice-a"],
    });
    expect(plan.deleteEdgeIds).toEqual(["manual-audio-edge"]);
    expect(plan.createEdges[0]?.data.executionRole).toBe("reference_only");
  });

  it("allows a target created by the same patch", () => {
    expect(buildVoiceReferenceEdgeSyncPlan({
      current: { nodes: [voiceCard("voice-a")], edges: [] },
      clipNodeId: "clip-a",
      voiceReferenceNodeIds: ["voice-a"],
      targetWillBeCreated: true,
    }).createEdges).toHaveLength(1);
  });

  it("fails explicitly for missing or non-voice-card sources", () => {
    expect(() => buildVoiceReferenceEdgeSyncPlan({
      current: { nodes: [video("clip-a")], edges: [] },
      clipNodeId: "clip-a",
      voiceReferenceNodeIds: ["missing"],
    })).toThrow("source node does not exist");
    expect(() => buildVoiceReferenceEdgeSyncPlan({
      current: {
        nodes: [{ id: "audio-a", data: { kind: "audio", audioType: "speech" } }, video("clip-a")],
        edges: [],
      },
      clipNodeId: "clip-a",
      voiceReferenceNodeIds: ["audio-a"],
    })).toThrow("not an audio voice card");
  });
});
