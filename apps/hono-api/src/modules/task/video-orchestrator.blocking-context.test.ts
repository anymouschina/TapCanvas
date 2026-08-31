import { describe, expect, it } from "vitest";

import type { Beat } from "./video-orchestrator.beat-sheet";
import {
  materializeBeatBlockingContexts,
  validateBeatKeyframeReferences,
} from "./video-orchestrator.blocking-context";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import {
  hashKeyframeCompositionContract,
  type KeyframeCompositionContract,
} from "./keyframe-composition-contract";

const compositionContract: KeyframeCompositionContract = {
  narrativeTask: "孟川与后土保持远距对峙",
  focusKind: "relationship",
  focusTargetNames: ["孟川", "后土"],
  focalPoint: [0.5, 0.5],
  shotScale: "wide",
  environmentVisualWeight: "secondary",
  subjects: [
    {
      name: "孟川",
      visualWeight: "primary",
      depthLayer: "midground",
      centerPlacement: "forbidden",
      maxFrameHeightRatio: 0.45,
    },
    {
      name: "后土",
      visualWeight: "primary",
      depthLayer: "midground",
      centerPlacement: "forbidden",
      maxFrameHeightRatio: 0.45,
    },
  ],
};
const compositionContractHash = hashKeyframeCompositionContract(compositionContract);
const blockingImageUrl = `https://cdn.test/${compositionContractHash}-blocking.png`;

const beat = (over: Partial<Beat> = {}): Beat => ({
  clipIndex: 0,
  logline: "远距对峙",
  startKeyframe: "双方相隔数百丈",
  endKeyframe: "剑光在中点消散",
  exitState: "双方仍保持远距",
  rhythmRole: "压迫",
  arcContract: { arcRole: "continuous", closureMode: "open_motion", arcFunction: "连续推进", sequenceContext: "多段序列中的技术窗口" },
  durationBudget: 10,
  sourceStartMarker: "开始",
  sourceEndMarker: "结束",
  speakerNames: [],
  dialogueScript: [],
  sceneName: "天外混沌",
  characterRoleNames: ["孟川"],
  vfxNames: [],
  storyboardImageNodeId: "keyframe-default",
  storyboardFrameCount: 1,
  videoReferenceNodeIds: [],
  continuityMode: "editorial_cut",
  assetObjectContracts: [],
  ...over,
});

const node = (id: string, data: Record<string, unknown>): VideoFlowNode => ({
  id,
  type: "taskNode",
  data,
});

const clipStoryboard = (
  id: string,
  data: Record<string, unknown> = {},
): VideoFlowNode =>
  node(id, {
    kind: "storyboardImage",
    productionLayer: "design_board",
    storyboardScope: "clip",
    storyboardFrameCount: 1,
    storyboardEditorCells: [{}],
    imageUrl: `https://cdn.test/${id}.png`,
    ...data,
  });

describe("blocking context materialization", () => {
  it("materializes bounded facts only for the explicitly selected beat", () => {
    const result = materializeBeatBlockingContexts({
      beats: [
        beat({ blockingFrameNodeId: "blocking-0" }),
        beat({ clipIndex: 1 }),
      ],
      nodes: [
        node("blocking-0", {
          kind: "image",
          imageUrl: blockingImageUrl,
          productionLayer: "blocking_diagram",
          sceneName: "天外混沌",
          prompt: "孟川画左，目标画右，相隔数百丈",
          productionMetadata: {
            compositionContract,
            compositionContractHash,
            lockedAnchors: {
              character: ["孟川画左"],
              scene: ["天外混沌"],
              shot: ["同侧轴线"],
              continuity: ["保持远距"],
            },
          },
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.beats[0]?.blockingContext).toMatchObject({
      sourceNodeId: "blocking-0",
      sourceImageUrl: blockingImageUrl,
      sceneName: "天外混沌",
      compositionContractHash,
    });
    expect(result.beats[1]?.blockingContext).toBeUndefined();
  });

  it("fails for a missing, wrong-type, or URL-less blocking node", () => {
    const missing = materializeBeatBlockingContexts({
      beats: [beat({ blockingFrameNodeId: "missing" })],
      nodes: [],
    });
    expect(missing.ok).toBe(false);

    const wrongType = materializeBeatBlockingContexts({
      beats: [beat({ blockingFrameNodeId: "board" })],
      nodes: [node("board", { kind: "image", imageUrl: "https://cdn.test/board.png" })],
    });
    expect(wrongType.ok).toBe(false);

    const noUrl = materializeBeatBlockingContexts({
      beats: [beat({ blockingFrameNodeId: "blocking" })],
      nodes: [node("blocking", { kind: "image", productionLayer: "blocking_diagram", prompt: "站位" })],
    });
    expect(noUrl.ok).toBe(false);
  });

  it("does not infer blocking from character count", () => {
    const result = materializeBeatBlockingContexts({
      beats: [beat({ characterRoleNames: ["孟川", "后土"] })],
      nodes: [],
    });
		expect(result.ok).toBe(true);
	});

	it("requires blocking for an explicitly spatial beat", () => {
		const result = materializeBeatBlockingContexts({
			beats: [beat({ spatialBlocking: true })],
			nodes: [],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues[0]?.code).toBe("blocking_node_required");
  });
});

describe("clip storyboard reference validation", () => {
  it("accepts a real one-frame clip storyboard", () => {
    expect(
      validateBeatKeyframeReferences({
        beats: [beat({ storyboardImageNodeId: "keyframe" })],
        nodes: [clipStoryboard("keyframe")],
      }),
    ).toEqual([]);
  });

  it("validates both real endpoints for bridge frames", () => {
    const issues = validateBeatKeyframeReferences({
      beats: [beat({
        continuityMode: "bridge_frames",
        storyboardImageNodeId: "start",
        lastFrameImageNodeId: "end",
      })],
      nodes: [
        clipStoryboard("start"),
        node("end", { kind: "image" }),
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("lastFrameImageNodeId");
    expect(issues[0]?.code).toBe("keyframe_image_url_missing");
  });

  it("accepts a generated three-frame clip storyboard", () => {
    expect(
      validateBeatKeyframeReferences({
        beats: [beat({ storyboardImageNodeId: "keyframe", storyboardFrameCount: 3 })],
        nodes: [
          clipStoryboard("keyframe", {
            storyboardFrameCount: 3,
            storyboardEditorCells: [{}, {}, {}],
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("accepts an ordinary image as a single-state keyframe", () => {
    expect(validateBeatKeyframeReferences({
      beats: [beat({ storyboardImageNodeId: "image", storyboardFrameCount: 1 })],
      nodes: [node("image", { kind: "image", productionLayer: "keyframe", imageUrl: "https://cdn.test/a.png" })],
    })).toEqual([]);
  });

  it("accepts any real image asset for a declared multi-frame storyboard without semantic layer gating", () => {
    const issues = validateBeatKeyframeReferences({
      beats: [beat({ storyboardImageNodeId: "image", storyboardFrameCount: 3 })],
      nodes: [node("image", {
        kind: "image",
        productionLayer: "keyframe",
        imageUrl: "https://cdn.test/a.png",
      })],
    });

    expect(issues).toEqual([]);
  });

  it("accepts an agent-authored single-image storyboard carrying only storyboardFrameCount (no editor cells)", () => {
    // ch1341-v3 形状：design_board + scope=clip + frameCount，无 storyboardEditorCells。
    expect(validateBeatKeyframeReferences({
      beats: [beat({ storyboardImageNodeId: "v3-board", storyboardFrameCount: 2 })],
      nodes: [
        node("v3-board", {
          kind: "image",
          productionLayer: "design_board",
          storyboardScope: "clip",
          storyboardFrameCount: 2,
          imageUrl: "https://cdn.test/v3-board.png",
        }),
      ],
    })).toEqual([]);
  });

  it("does not turn storyboardScope metadata into a semantic execution gate", () => {
    const issues = validateBeatKeyframeReferences({
      beats: [beat({ storyboardImageNodeId: "scopeless", storyboardFrameCount: 1 })],
      nodes: [
        node("scopeless", {
          kind: "image",
          productionLayer: "design_board",
          storyboardFrameCount: 1,
          imageUrl: "https://cdn.test/scopeless.png",
        }),
      ],
    });
    expect(issues).toEqual([]);
  });

  it("accepts semantic layer variants but still rejects provider bounds and missing URLs", () => {
    const master = node("master", {
      kind: "image",
      productionLayer: "master_board",
      imageUrl: "https://cdn.test/b.png",
    });
    expect(validateBeatKeyframeReferences({
      beats: [beat({ storyboardImageNodeId: master.id })],
      nodes: [master],
    })).toEqual([]);

    const multi = clipStoryboard("multi", {
      storyboardFrameCount: 4,
      storyboardEditorCells: [{}, {}, {}, {}],
    });
    expect(validateBeatKeyframeReferences({
      beats: [beat({ storyboardImageNodeId: multi.id, storyboardFrameCount: 4 })],
      nodes: [multi],
    })[0]?.code).toBe("keyframe_node_type_invalid");

    const empty = node("empty", { kind: "image" });
    expect(validateBeatKeyframeReferences({
      beats: [beat({ storyboardImageNodeId: empty.id })],
      nodes: [empty],
    })[0]?.code).toBe("keyframe_image_url_missing");
  });

  it("requires proof that the keyframe consumed the same blocking image as the beat", () => {
    const currentBeat = beat({
      characterRoleNames: ["孟川", "后土"],
      blockingFrameNodeId: "blocking",
      storyboardImageNodeId: "keyframe",
    });
    const blocking = node("blocking", {
      kind: "image",
      productionLayer: "blocking_diagram",
      imageUrl: blockingImageUrl,
      prompt: "孟川画左，后土画右",
      productionMetadata: {
        compositionContract,
        compositionContractHash,
      },
    });
    const missingEvidence = validateBeatKeyframeReferences({
      beats: [currentBeat],
      nodes: [
        blocking,
        clipStoryboard("keyframe"),
      ],
    });
    expect(missingEvidence[0]?.code).toBe("keyframe_blocking_binding_missing");

    const valid = validateBeatKeyframeReferences({
      beats: [currentBeat],
      nodes: [
        blocking,
        clipStoryboard("keyframe", {
          referenceImages: [blockingImageUrl],
          productionMetadata: {
            blockingFrameNodeId: "blocking",
            compositionContract,
            compositionContractHash,
          },
        }),
      ],
    });
    expect(valid).toEqual([]);

    const validFromSubmittedTaskEvidence = validateBeatKeyframeReferences({
      beats: [currentBeat],
      nodes: [
        blocking,
        clipStoryboard("keyframe", {
          taskId: "task-keyframe",
          productionMetadata: {
            blockingFrameNodeId: "blocking",
            compositionContract,
            compositionContractHash,
          },
        }),
      ],
      generationReferenceUrlsByTaskId: new Map([
        ["task-keyframe", [blockingImageUrl]],
      ]),
    });
    expect(validFromSubmittedTaskEvidence).toEqual([]);
  });
});
