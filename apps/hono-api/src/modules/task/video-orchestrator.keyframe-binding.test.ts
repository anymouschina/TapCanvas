import { describe, expect, it } from "vitest";

import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import { bindExplicitClipKeyframes } from "./video-orchestrator.keyframe-binding";

type TestClip = {
  title: string;
  storyboardImageNodeId?: string;
  storyboardFrameCount?: number;
};

function bind(clips: readonly TestClip[], nodes: readonly VideoFlowNode[]) {
  return bindExplicitClipKeyframes({
    runId: "run-1",
    clips,
    nodes,
    clipIndexFor: (_clip, arrayIndex) => arrayIndex,
    existingNodeIdFor: (clip) => clip.storyboardImageNodeId ?? "",
    existingFrameCountFor: (clip) => clip.storyboardFrameCount,
    withBinding: (clip, binding) => ({
      ...clip,
      storyboardImageNodeId: binding.nodeId,
      ...(binding.storyboardFrameCount !== undefined
        ? { storyboardFrameCount: binding.storyboardFrameCount }
        : {}),
    }),
  });
}

function keyframeNode(overrides: Record<string, unknown> = {}): VideoFlowNode {
  return {
    id: String(overrides.id ?? "keyframe-1"),
    data: {
      kind: "storyboardImage",
      clipRunId: "run-1",
      clipIndex: 1,
      storyboardScope: "clip",
      creationStage: "beat_keyframe",
      ...overrides,
    },
  };
}

describe("bindExplicitClipKeyframes", () => {
  it("按精确 runId + clipIndex + scope/stage 把生成节点写入目标 clip", () => {
    const result = bind(
      [
        { title: "first" },
        { title: "five-to-one" },
      ],
      [
        keyframeNode({
          id: "keyframe-1",
          clipIndex: 1,
          storyboardFrameCount: 3,
          label: "完全不依赖标签匹配",
        }),
      ],
    );

    expect(result).toEqual({
      ok: true,
      clips: [
        { title: "first" },
        {
          title: "five-to-one",
          storyboardImageNodeId: "keyframe-1",
          storyboardFrameCount: 3,
        },
      ],
      bindings: [{ clipIndex: 1, nodeId: "keyframe-1", storyboardFrameCount: 3 }],
    });
  });

  it("不从标签、提示词、位置或不完整元数据推断归属", () => {
    const result = bind(
      [{ title: "five-to-one" }],
      [
        keyframeNode({ id: "wrong-run", clipRunId: "other-run", clipIndex: 0 }),
        keyframeNode({ id: "wrong-scope", clipRunId: "run-1", clipIndex: 0, storyboardScope: "chapter" }),
        keyframeNode({ id: "wrong-stage", clipRunId: "run-1", clipIndex: 0, creationStage: "asset_reference" }),
        {
          id: "label-only",
          data: {
            kind: "storyboardImage",
            label: "five-to-one",
            prompt: "五对一合围",
          },
        },
      ],
    );

    expect(result).toEqual({ ok: true, clips: [{ title: "five-to-one" }], bindings: [] });
  });

  it("同一 clip 有两个显式候选时显式失败，不随机挑一个", () => {
    const result = bind(
      [{ title: "clip-1" }],
      [keyframeNode({ id: "keyframe-a", clipIndex: 0 }), keyframeNode({ id: "keyframe-b", clipIndex: 0 })],
    );

    expect(result).toMatchObject({ ok: false, code: "clip_keyframe_binding_ambiguous" });
    if (!result.ok) {
      expect(result.details).toMatchObject({ clipIndex: 0, nodeIds: ["keyframe-a", "keyframe-b"] });
    }
  });

  it("已有 BeatSheet 引用与显式节点冲突时失败，不覆盖既有合同", () => {
    const result = bind(
      [{ title: "clip-1", storyboardImageNodeId: "declared-node" }],
      [keyframeNode({ id: "metadata-node", clipIndex: 0 })],
    );

    expect(result).toMatchObject({ ok: false, code: "clip_keyframe_binding_conflict" });
  });

  it("拒绝超出 1～3 状态范围的显式元数据", () => {
    const result = bind(
      [{ title: "clip-1" }],
      [keyframeNode({ id: "invalid-count", clipIndex: 0, storyboardFrameCount: 4 })],
    );

    expect(result).toMatchObject({ ok: false, code: "clip_keyframe_binding_metadata_invalid" });
  });
});
