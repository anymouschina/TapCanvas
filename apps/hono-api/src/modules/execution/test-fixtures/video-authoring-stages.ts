import { parseChapterBeatPlan, parseChapterAssetPlan, parseClipDesign } from "../execution.video-authoring-stages";

export function stagedAuthoringFixture() {
  const chapter = parseChapterBeatPlan({
    sourceId: "chapter", sourceFingerprint: "source-hash",
    chapterArc: { storyPromise: "发现", protagonistThroughline: "追踪", primaryPayoff: "发现出口", endingHook: null },
    sourceCoveragePlan: { speechLedger: [] },
    sourceFidelityAudit: { sourceBeatLedger: [{ sourceBeatId: "event-1", sourceOrder: 0, durationSeconds: 10, summary: "门打开" }] },
    beats: [{ durationSeconds: 10, sourceSpan: "门打开", narrativeIntent: "展示出口", dominantFunction: "揭示", causalEntry: "门关闭", irreversibleResult: "门打开", handoffToNext: "出口出现",
      storyEvents: [{ sourceBeatId: "event-1", event: "门打开", exitState: "门打开", startSeconds: 0, endSeconds: 10 }] }],
  });
  const shared = parseChapterAssetPlan({ objectRegistry: [{ objectId: "scene", kind: "scene", name: "房间", physicalIdentityKey: null,
    referenceImageNodeIds: [], referenceAssetIds: [], referenceRole: "none", identityInvariant: "同一房间" }], assetPlans: [], backgroundPlans: [{ objectId: "scene", plan: { assetId: "floor", displayName: "房间底图", prompt: "无人房间", negativePrompt: "无标记", referenceAssetBindings: [] } }] });
  const clip = parseClipDesign({ clipIndex: 0, beat: {
    visualIntent: "展示出口", startKeyframe: "关闭的门", endKeyframe: "打开的门", dialoguePaceRate: 4,
    narrativeAudioPlan: { strategy: "visual_only", rationale: "无人发声", lines: [] },
    objectStates: [{ objectId: "scene", referenceAssetIds: [], referenceImageNodeIds: [], startState: "门关闭", spatialRelation: "出口在右侧", driver: "门轴运动", stateChange: "门打开", endState: "门打开" }],
  }, blockingPlan: { title: "房间", sceneName: "房间", landmarks: [], characters: [],
    camera: { at: [0.5, 0.9], lookAt: [0.5, 0.3] },
    backgroundObjectId: "scene",
    compositionContract: { narrativeTask: "展示出口", focusKind: "environment", focusTargetNames: ["房间"], focalPoint: [0.5, 0.5], shotScale: "wide", environmentVisualWeight: "primary", subjects: [] },
  }, timing: { transitionFromPrevious: "开场", transitionToNext: "结束", temporalDirectives: [] } });
  return { chapter, shared, clip };
}
