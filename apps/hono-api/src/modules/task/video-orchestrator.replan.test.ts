import { describe, expect, it } from "vitest";

import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import {
  buildPreservedArtifactSourceRefs,
  clonePersistedBeatSheet,
  isReplanSourceTerminalFailure,
  readPreservedReadyClipIndexes,
  readPersistedBeatSheetVideoModel,
  selectAcceptedPreservedMappings,
  sourceRunVideoNodes,
  validateReplanPreservation,
} from "./video-orchestrator.replan";
import { transformClonedReplanBeatSheet } from "./video-orchestrator.replan-transform";
import {
  readVideoReplanLineage,
  stampVideoReplanLineage,
} from "./video-orchestrator.replan-lineage";
import {
  buildSourceUnits,
  compileSourceCoverageSelection,
} from "./video-orchestrator.source-units";

const node = (id: string, data: Record<string, unknown>): VideoFlowNode => ({ id, data });

const successNode = (id: string, clipIndex: number): VideoFlowNode =>
  node(id, {
    kind: "video",
    status: "success",
    clipRunId: "source-run",
    clipIndex,
    taskId: `task-${clipIndex}`,
    videoUrl: `https://example.test/${clipIndex}.mp4`,
  });

describe("validateReplanPreservation", () => {
  it("把尚未起跑的 authoring_failed 与生产 failed 都视为可重规划终态", () => {
    expect(isReplanSourceTerminalFailure({
      state: "failed",
      authoringState: "authoring_done",
    })).toBe(true);
    expect(isReplanSourceTerminalFailure({
      state: "collecting",
      authoringState: "authoring_failed",
    })).toBe(true);
    expect(isReplanSourceTerminalFailure({
      state: "collecting",
      authoringState: "writing_dispatched",
    })).toBe(false);
    expect(isReplanSourceTerminalFailure({
      state: "video_running",
      authoringState: "authoring_failed",
    })).toBe(false);
  });

  it("已复用视频只认真实生产血缘，禁止用当前 run 后生成的 writer 反证旧视频", () => {
    expect(buildPreservedArtifactSourceRefs({
      sourceRunId: "run-v9",
      sourceClipIndex: 1,
      node: node("clip-1", {
        reusedRenderedClip: {
          sourceRunId: "run-v8",
          sourceClipIndex: 1,
        },
      }),
    })).toEqual([{ runId: "run-v8", clipIndex: 1 }]);
    expect(buildPreservedArtifactSourceRefs({
      sourceRunId: "run-v9",
      sourceClipIndex: 1,
      node: node("clip-1", {}),
    })).toEqual([{ runId: "run-v9", clipIndex: 1 }]);
    expect(buildPreservedArtifactSourceRefs({
      sourceRunId: "run-v9",
      sourceClipIndex: 1,
      node: node("clip-1", { reusedRenderedClip: {} }),
    })).toEqual([]);
  });

  it("源 run 视频即使被后续 replan 改绑，仍可按不可变复用血缘 fresh-read", () => {
    const direct = successNode("direct", 0);
    const rebound = node("rebound", {
      kind: "video",
      status: "success",
      clipRunId: "later-run",
      clipIndex: 1,
      taskId: "task-1",
      videoUrl: "https://example.test/1.mp4",
      reusedRenderedClip: { sourceRunId: "source-run", sourceClipIndex: 1 },
    });
    const unrelated = node("unrelated", {
      kind: "video",
      clipRunId: "later-run",
      reusedRenderedClip: { sourceRunId: "other-run", sourceClipIndex: 2 },
    });
    expect(sourceRunVideoNodes([direct, rebound, unrelated], "source-run").map((item) => item.id))
      .toEqual(["direct", "rebound"]);
  });

  it("只从 commit 的实际输入指纹验真结果读取可复用目标 clip", () => {
    expect(readPreservedReadyClipIndexes({
      preservedReadyClipIndexes: [2, 0, 2, -1, "4", 1.5],
    })).toEqual([2, 0, 4]);
    expect(readPreservedReadyClipIndexes({ preservedReadyClips: 11 })).toEqual([]);
    expect(selectAcceptedPreservedMappings([
      { sourceClipIndex: 0, targetClipIndex: 0, nodeId: "clip-0" },
      { sourceClipIndex: 1, targetClipIndex: 1, nodeId: "clip-1" },
      { sourceClipIndex: 2, targetClipIndex: 2, nodeId: "clip-2" },
    ], [0, 2])).toEqual([
      { sourceClipIndex: 0, targetClipIndex: 0, nodeId: "clip-0" },
      { sourceClipIndex: 2, targetClipIndex: 2, nodeId: "clip-2" },
    ]);
  });

  it("clones only valid persisted BeatSheet object JSON", () => {
    const source = { version: 2, runId: "source-run", beats: [{ clipIndex: 0 }] };
    const cloned = clonePersistedBeatSheet(JSON.stringify(source));
    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(clonePersistedBeatSheet("[]")).toBeNull();
    expect(clonePersistedBeatSheet("not-json")).toBeNull();
    expect(clonePersistedBeatSheet(null)).toBeNull();
    expect(
      readPersistedBeatSheetVideoModel(
        JSON.stringify({ meta: { videoModel: " model-a " } }),
      ),
    ).toBe("model-a");
    expect(readPersistedBeatSheetVideoModel(JSON.stringify({ meta: {} }))).toBe("");
  });

  it("accepts a one-to-one remap of every successful rendered clip", () => {
    const result = validateReplanPreservation({
      sourceNodes: [successNode("clip-0", 0), successNode("clip-4", 4)],
      targetBeatCount: 7,
      preservedClips: [
        { sourceClipIndex: 0, targetClipIndex: 0 },
        { sourceClipIndex: 4, targetClipIndex: 5 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      mappings: [
        { sourceClipIndex: 0, targetClipIndex: 0, nodeId: "clip-0" },
        { sourceClipIndex: 4, targetClipIndex: 5, nodeId: "clip-4" },
      ],
    });
  });

  it("rejects replan while any source clip is still running", () => {
    const result = validateReplanPreservation({
      sourceNodes: [
        successNode("clip-0", 0),
        node("clip-1", {
          kind: "video",
          status: "running",
          clipRunId: "source-run",
          clipIndex: 1,
          taskId: "task-1",
        }),
      ],
      targetBeatCount: 3,
      preservedClips: [{ sourceClipIndex: 0, targetClipIndex: 0 }],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "replan_source_tasks_still_running",
      nodeIds: ["clip-1"],
    });
  });

  it("allows clip-level reuse and leaves unselected successful assets preserved on the source run", () => {
    const result = validateReplanPreservation({
      sourceNodes: [successNode("clip-0", 0), successNode("clip-4", 4)],
      targetBeatCount: 6,
      preservedClips: [{ sourceClipIndex: 0, targetClipIndex: 0 }],
    });
    expect(result).toEqual({
      ok: true,
      mappings: [{ sourceClipIndex: 0, targetClipIndex: 0, nodeId: "clip-0" }],
    });

    expect(validateReplanPreservation({
      sourceNodes: [successNode("clip-0", 0)],
      targetBeatCount: 1,
      preservedClips: [],
    })).toEqual({ ok: true, mappings: [] });
  });

  it("rejects duplicate target positions and evidence without a real task id", () => {
    const duplicate = validateReplanPreservation({
      sourceNodes: [successNode("clip-0", 0), successNode("clip-4", 4)],
      targetBeatCount: 6,
      preservedClips: [
        { sourceClipIndex: 0, targetClipIndex: 1 },
        { sourceClipIndex: 4, targetClipIndex: 1 },
      ],
    });
    expect(duplicate).toMatchObject({
      ok: false,
      code: "replan_preserved_mapping_duplicate",
    });

    const missingTask = validateReplanPreservation({
      sourceNodes: [
        node("clip-0", {
          kind: "video",
          status: "success",
          clipRunId: "source-run",
          clipIndex: 0,
          videoUrl: "https://example.test/0.mp4",
        }),
      ],
      targetBeatCount: 2,
      preservedClips: [{ sourceClipIndex: 0, targetClipIndex: 0 }],
    });
    expect(missingTask).toMatchObject({
      ok: false,
      code: "replan_preserved_clip_evidence_invalid",
    });
  });

  it("ignores caller-transcribed node/task evidence and fresh-resolves the source node", () => {
    const result = validateReplanPreservation({
      sourceNodes: [successNode("clip-0", 0)],
      targetBeatCount: 2,
      preservedClips: [{
        sourceClipIndex: 0,
        targetClipIndex: 1,
        nodeId: "stale-caller-node",
        taskId: "stale-caller-task",
      }],
    });
    expect(result).toEqual({
      ok: true,
      mappings: [{ sourceClipIndex: 0, targetClipIndex: 1, nodeId: "clip-0" }],
    });
  });

  it("fails explicitly when source clip evidence is not uniquely resolvable", () => {
    const result = validateReplanPreservation({
      sourceNodes: [successNode("clip-a", 0), successNode("clip-b", 0)],
      targetBeatCount: 2,
      preservedClips: [{ sourceClipIndex: 0, targetClipIndex: 0 }],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "replan_source_success_evidence_ambiguous",
    });
  });
});

describe("transformClonedReplanBeatSheet", () => {
  const chapterText = [
    "甲段起点，卫生所里她从手术台惊醒，完整接收了陌生记忆并决定改变结局。",
    "乙段起点，一年前的相亲让他一见钟情，婚后一次次靠近却被冷淡拒绝。",
    "丙段起点，他偷偷购买育儿书，学习冲奶粉与换尿布，直到最后希望破灭。",
    "丁段起点，现实中的他压住情绪，拿起离婚报告，准备面对新的选择。",
  ].join("\n");

  it("clones untouched beats and only expands the declared failed source clip", () => {
    const units = buildSourceUnits({ chapterText, expectedBeatCount: 3 });
    const sourceCoverage = compileSourceCoverageSelection({
      chapterText,
      expectedBeatCount: 3,
      deliveryScope: "full_chapter",
      selection: {
        endUnitIds: [units[2]!.unitId, units[5]!.unitId, units.at(-1)!.unitId],
        speechLedger: [],
      },
    }).plan;
    const splitMarker = units[4]!.text.trim();
    const result = transformClonedReplanBeatSheet({
      sourceBeatSheet: {
        version: 2,
        runId: "source-run",
        beats: [
          { clipIndex: 0, logline: "source-0", durationBudget: 8 },
          {
            clipIndex: 1,
            logline: "source-1",
            sceneName: "军属家属院",
            durationBudget: 8,
            dialogueScript: [],
            speakerNames: [],
            videoReferenceNodeIds: ["character-card-1", "scene-card-1"],
            continuityMode: "reference_video",
            assetObjectContracts: [{
              kind: "scene",
              name: "军属家属院",
              referenceImageNodeIds: ["scene-card-1"],
              referenceRole: "environment",
            }],
            startKeyframe: "源起始帧",
            endKeyframe: "源结束帧",
            exitState: "源结束状态",
            lastFrameImageNodeId: "source-last-frame",
          },
          { clipIndex: 2, logline: "source-2", durationBudget: 8 },
        ],
        sourceCoveragePlan: sourceCoverage,
        meta: { executionScope: "media_delivery", deliveryScope: "full_chapter" },
      },
      chapterText,
      preservedMappings: [
        { sourceClipIndex: 0, targetClipIndex: 0 },
        { sourceClipIndex: 2, targetClipIndex: 3 },
      ],
      beatReplacements: [{
        sourceClipIndex: 1,
        splitStartMarkers: [splitMarker],
        replacementBeats: [
          { logline: "replacement-1a", durationBudget: 14, dialogueScript: [] },
          { logline: "replacement-1b", durationBudget: 16, dialogueScript: [] },
        ],
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const beats = result.beatSheet.beats as Array<Record<string, unknown>>;
    expect(beats.map((beat) => [beat.clipIndex, beat.logline])).toEqual([
      [0, "source-0"],
      [1, "replacement-1a"],
      [2, "replacement-1b"],
      [3, "source-2"],
    ]);
    expect(beats[1]).toMatchObject({
      sceneName: "军属家属院",
      videoReferenceNodeIds: ["character-card-1", "scene-card-1"],
      continuityMode: "reference_video",
      speakerNames: [],
      startKeyframe: "源起始帧",
    });
    expect(beats[1]).not.toHaveProperty("endKeyframe");
    expect(beats[1]).not.toHaveProperty("exitState");
    expect(beats[1]).not.toHaveProperty("lastFrameImageNodeId");
    expect(beats[2]).toMatchObject({
      sceneName: "军属家属院",
      videoReferenceNodeIds: ["character-card-1", "scene-card-1"],
      continuityMode: "editorial_cut",
      speakerNames: [],
      endKeyframe: "源结束帧",
      exitState: "源结束状态",
      lastFrameImageNodeId: "source-last-frame",
    });
    expect(beats[2]).not.toHaveProperty("startKeyframe");
    expect(result.beatSheet.meta).toEqual({
      executionScope: "media_delivery",
      deliveryScope: "full_chapter",
    });
    const spans = (result.beatSheet.sourceCoveragePlan as Record<string, unknown>)
      .spans as Array<Record<string, unknown>>;
    expect(spans.map((span) => span.clipIndex)).toEqual([0, 1, 2, 3]);
    expect(spans[1]!.sourceEndOffset).toBe(spans[2]!.sourceStartOffset);
    expect(spans[0]!.sourceStartOffset).toBe(0);
    expect(spans.at(-1)!.sourceEndOffset).toBe(sourceCoverage.spans.at(-1)!.sourceEndOffset);
  });

  it("rejects a preserved target that disagrees with the deterministic topology", () => {
    const units = buildSourceUnits({ chapterText, expectedBeatCount: 2 });
    const sourceCoverage = compileSourceCoverageSelection({
      chapterText,
      expectedBeatCount: 2,
      deliveryScope: "full_chapter",
      selection: {
        endUnitIds: [units[2]!.unitId, units.at(-1)!.unitId],
        speechLedger: [],
      },
    }).plan;
    const result = transformClonedReplanBeatSheet({
      sourceBeatSheet: {
        version: 2,
        beats: [
          { clipIndex: 0, logline: "source-0" },
          { clipIndex: 1, logline: "source-1" },
        ],
        sourceCoveragePlan: sourceCoverage,
      },
      chapterText,
      preservedMappings: [{ sourceClipIndex: 0, targetClipIndex: 1 }],
      beatReplacements: [],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "replan_preserved_target_mismatch",
    });
  });

  it("clones an unchanged frozen topology without requiring chapter text", () => {
    const units = buildSourceUnits({ chapterText, expectedBeatCount: 2 });
    const sourceCoverage = compileSourceCoverageSelection({
      chapterText,
      expectedBeatCount: 2,
      deliveryScope: "full_chapter",
      selection: {
        endUnitIds: [units[2]!.unitId, units.at(-1)!.unitId],
        speechLedger: [],
      },
    }).plan;
    const result = transformClonedReplanBeatSheet({
      sourceBeatSheet: {
        version: 2,
        runId: "source-run",
        beats: [
          { clipIndex: 0, logline: "source-0", durationBudget: 8 },
          { clipIndex: 1, logline: "source-1", durationBudget: 8 },
        ],
        sourceCoveragePlan: sourceCoverage,
        meta: { deliveryScope: "full_chapter" },
      },
      chapterText: "",
      preservedMappings: [],
      beatReplacements: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.beatSheet.beats).toEqual([
      expect.objectContaining({ clipIndex: 0, logline: "source-0" }),
      expect.objectContaining({ clipIndex: 1, logline: "source-1" }),
    ]);
  });
});

describe("video replan lineage", () => {
  it("keeps the logical root and increments the physical replan generation", () => {
    const first = stampVideoReplanLineage({
      beatSheet: { version: 2, meta: { videoModel: "model-1" } },
      sourceRunId: "source-run",
    });
    expect(readVideoReplanLineage(first)).toEqual({
      version: 1,
      rootRunId: "source-run",
      sourceRunId: "source-run",
      generation: 1,
    });

    const second = stampVideoReplanLineage({
      beatSheet: first,
      sourceRunId: "replan-run-1",
    });
    expect(readVideoReplanLineage(second)).toEqual({
      version: 1,
      rootRunId: "source-run",
      sourceRunId: "replan-run-1",
      generation: 2,
    });
    expect((second.meta as Record<string, unknown>).videoModel).toBe("model-1");
  });
});
