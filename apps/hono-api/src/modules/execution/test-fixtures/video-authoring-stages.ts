import { parseChapterBeatPlan, parseChapterAssetPlan, parseClipDesign } from "../execution.video-authoring-stages";
import { parseSourceUnitLedger } from "../execution.source-unit-ledger";
import { sceneReferenceFixture } from "../execution.scene-reference-fixture";

export function stagedAuthoringFixture() {
  const ledger = parseSourceUnitLedger({ sourceId: "chapter", sourceFingerprint: "source-hash", units: [{
    unitId: "unit-1", sourceLineId: "source-line-1", text: "门打开", expression: "narration", speakerName: null, delivery: null,
  }] });
  const chapter = parseChapterBeatPlan({
    sourceId: "chapter", sourceFingerprint: "source-hash",
    chapterArc: { storyPromise: "发现", protagonistThroughline: "追踪", primaryPayoff: "发现出口", endingHook: null },
    sourceFidelityAudit: { sourceBeatLedger: [{ sourceBeatId: "event-1", sourceOrder: 0, durationSeconds: 10, summary: "门打开" }] },
    beats: [{ durationSeconds: 10, dialoguePaceRate: 4, sourceUnitRefs: [{ unitId: "unit-1", startOffset: 0, endOffset: 3 }], startKeyframe: "关闭的门", endKeyframe: "打开的门", sourceSpan: "门打开", narrativeIntent: "展示出口", dominantFunction: "揭示", causalEntry: "门关闭", irreversibleResult: "门打开", handoffToNext: "出口出现",
      storyEvents: [{ sourceBeatId: "event-1", event: "门打开", exitState: "门打开", startSeconds: 0, endSeconds: 10 }] }],
  });
  const shared = parseChapterAssetPlan({ objectRegistry: [{ objectId: "scene", kind: "scene", name: "房间", physicalIdentityKey: null,
    imageSource: { mode: "generate", referenceAssetBindings: [], plan: { sceneCard: sceneReferenceFixture, identityAnchors: ["同一房间"], prohibitedDrift: ["空间保持一致"] } },
    referenceRole: "environment", identityInvariant: "同一房间" }], backgroundPlans: [{ objectId: "scene", plan: { assetId: "floor", displayName: "房间底图", prompt: "无人房间", negativePrompt: "无标记", referenceAssetBindings: [] } }] });
  const clip = parseClipDesign({ clipIndex: 0, beat: {
    visualIntent: "展示出口",
    narrativeAudioPlan: { strategy: "visual_only", rationale: "无人发声", lines: [] },
    objectStates: [{ objectId: "scene", referenceAssetIds: [], referenceImageNodeIds: [], startState: "门关闭", spatialRelation: "出口在右侧", driver: "门轴运动", stateChange: "门打开", endState: "门打开" }],
  }, blockingPlan: { title: "房间", sceneName: "房间", landmarks: [], characters: [],
    camera: { at: [0.5, 0.9], lookAt: [0.5, 0.3] },
    backgroundObjectId: "scene",
    compositionContract: { narrativeTask: "展示出口", focusKind: "environment", focusTargetNames: ["房间"], focalPoint: [0.5, 0.5], shotScale: "wide", environmentVisualWeight: "primary", subjects: [] },
  }, timing: { transitionFromPrevious: "开场", transitionToNext: "结束", temporalDirectives: [] } });
  return { chapter, shared, clip, ledger };
}
