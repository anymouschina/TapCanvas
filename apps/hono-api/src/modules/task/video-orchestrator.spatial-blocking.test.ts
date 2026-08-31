import { describe, expect, it } from "vitest";

import {
  buildSpatialBlockingWarning,
  isSpatialBlockingWarnEnabled,
} from "./video-orchestrator.spatial-blocking";
import { validateStoryPlan } from "./video-orchestrator.orchestrate";

describe("isSpatialBlockingWarnEnabled", () => {
  it("默认 ON，仅显式关闭才 OFF", () => {
    expect(isSpatialBlockingWarnEnabled({})).toBe(true);
    expect(isSpatialBlockingWarnEnabled({ VIDEO_SPATIAL_BLOCKING_WARN: "on" })).toBe(true);
    expect(isSpatialBlockingWarnEnabled({ VIDEO_SPATIAL_BLOCKING_WARN: "off" })).toBe(false);
    expect(isSpatialBlockingWarnEnabled({ VIDEO_SPATIAL_BLOCKING_WARN: "0" })).toBe(false);
    expect(isSpatialBlockingWarnEnabled({ VIDEO_SPATIAL_BLOCKING_WARN: "false" })).toBe(false);
  });
});

describe("buildSpatialBlockingWarning", () => {
  const spatialClip = { clipPrompt: "傅南爵推门进屋，看见空沙发", spatialBlocking: true };
  const plainClip = { clipPrompt: "她在车后座望向窗外，镜头缓慢推近侧脸" };

  it("显式空间调度镜无 blocking 参考 → 告警并点名 clip 序号", () => {
    const warning = buildSpatialBlockingWarning([plainClip, spatialClip]);
    expect(warning).toBeTruthy();
    expect(warning).toContain("clip1");
    expect(warning).not.toContain("clip0");
    expect(warning).toContain("blockingFrameNodeId");
  });

  it("带 blockingFrameNodeId 或未声明 spatialBlocking → 不告警", () => {
    expect(
      buildSpatialBlockingWarning([{ ...spatialClip, blockingFrameNodeId: "node-1" }]),
    ).toBeNull();
    expect(buildSpatialBlockingWarning([{ clipPrompt: "推门进屋" }])).toBeNull();
  });

  it("prompt 文本不参与空间决策；全部未声明 → null", () => {
    expect(
      buildSpatialBlockingWarning([
        { clipPrompt: "纯表演镜", storyboardPrompt: "他走出大厅，穿过人群" },
      ]),
    ).toBeNull();
    expect(buildSpatialBlockingWarning([plainClip])).toBeNull();
    expect(buildSpatialBlockingWarning([])).toBeNull();
  });
});

describe("validateStoryPlan 透传 blocking 字段", () => {
  it("clips[].spatialBlocking / blockingFrameNodeId 原样透传", () => {
    const plan = validateStoryPlan({
      runId: "r1",
      videoModel: "doubao-seedance-2-0-260128",
      targetDurationSeconds: 10,
      clips: [
        {
          clipPrompt: "推门进屋",
          spatialBlocking: true,
          blockingFrameNodeId: "blk-1",
          videoReferenceNodeIds: [],
          assetObjectContracts: [],
          continuityMode: "editorial_cut",
        },
        {
          clipPrompt: "窗前点烟",
          videoReferenceNodeIds: [],
          assetObjectContracts: [],
          continuityMode: "editorial_cut",
        },
      ],
    });
    expect(plan.clips[0]?.spatialBlocking).toBe(true);
    expect(plan.clips[0]?.blockingFrameNodeId).toBe("blk-1");
    expect(plan.clips[1]?.spatialBlocking).toBeUndefined();
    expect(plan.clips[1]?.blockingFrameNodeId).toBeUndefined();
  });
});
