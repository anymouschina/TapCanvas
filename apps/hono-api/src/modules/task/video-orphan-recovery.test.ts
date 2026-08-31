import { describe, it, expect } from "vitest";
import {
  selectStuckVideoNodeIds,
  flowGraphHasStuckVideoNode,
  isOrphanRecoveryEnabled,
} from "./video-orphan-recovery";

describe("selectStuckVideoNodeIds", () => {
  it("picks running video nodes that have a taskId", () => {
    const nodes = [
      { id: "v1", data: { kind: "video", status: "running", taskId: "task_a" } },
      { id: "v2", data: { kind: "video", status: "queued", videoTaskId: "task_b" } },
    ];
    expect(selectStuckVideoNodeIds(nodes)).toEqual(["v1", "v2"]);
  });

  it("ignores already-terminal video nodes", () => {
    const nodes = [
      { id: "v1", data: { kind: "video", status: "success", taskId: "task_a", videoUrl: "http://x" } },
      { id: "v2", data: { kind: "video", status: "failed", taskId: "task_b" } },
    ];
    expect(selectStuckVideoNodeIds(nodes)).toEqual([]);
  });

  it("ignores running video nodes without a taskId (not yet submitted upstream)", () => {
    const nodes = [{ id: "v1", data: { kind: "video", status: "running" } }];
    expect(selectStuckVideoNodeIds(nodes)).toEqual([]);
  });

  it("recovers a submitting workflow video from its immutable execution identity", () => {
    const runtimeNodeId = "video-submit::item::clip%3A3";
    const familyId = "family-1";
    const nodeId = `${runtimeNodeId}::family::${familyId}::output::video`;
    const nodes = [{
      id: nodeId,
      data: {
        kind: "video",
        status: "submitting",
        workflowExecutionId: "execution-1",
        workflowRuntimeNodeId: runtimeNodeId,
        workflowEffectId: `${familyId}:${runtimeNodeId}:video-submit`,
      },
    }];
    expect(selectStuckVideoNodeIds(nodes)).toEqual([nodeId]);
  });

  it("ignores non-video kinds", () => {
    const nodes = [
      { id: "i1", data: { kind: "image", status: "running", taskId: "task_a" } },
      { id: "s1", data: { kind: "storyboardImage", status: "running", taskId: "task_b" } },
    ];
    expect(selectStuckVideoNodeIds(nodes)).toEqual([]);
  });

  it("recovers composeVideo nodes too", () => {
    const nodes = [{ id: "c1", data: { kind: "composeVideo", status: "submitted", taskId: "task_c" } }];
    expect(selectStuckVideoNodeIds(nodes)).toEqual(["c1"]);
  });

  it("is robust to malformed input", () => {
    expect(selectStuckVideoNodeIds(null)).toEqual([]);
    expect(selectStuckVideoNodeIds(undefined)).toEqual([]);
    expect(selectStuckVideoNodeIds([null, 1, "x", {}])).toEqual([]);
  });
});

describe("flowGraphHasStuckVideoNode", () => {
  it("true when a stuck video node exists", () => {
    expect(
      flowGraphHasStuckVideoNode({ nodes: [{ id: "v1", data: { kind: "video", status: "running", taskId: "t" } }] }),
    ).toBe(true);
  });
  it("false for empty / terminal-only graphs", () => {
    expect(flowGraphHasStuckVideoNode({ nodes: [] })).toBe(false);
    expect(flowGraphHasStuckVideoNode({ nodes: [{ id: "v", data: { kind: "video", status: "success" } }] })).toBe(false);
    expect(flowGraphHasStuckVideoNode(null)).toBe(false);
  });
});

describe("isOrphanRecoveryEnabled", () => {
  it("default ON（2026-07-02 翻正：幂等失败兜底，非起跑硬闸）", () => {
    expect(isOrphanRecoveryEnabled({})).toBe(true);
    expect(isOrphanRecoveryEnabled({ VIDEO_ORPHAN_RECOVERY: "" })).toBe(true);
    expect(isOrphanRecoveryEnabled({ VIDEO_ORPHAN_RECOVERY: "on" })).toBe(true);
    expect(isOrphanRecoveryEnabled({ VIDEO_ORPHAN_RECOVERY: "1" })).toBe(true);
  });
  it("OFF only for explicit falsy flag values", () => {
    expect(isOrphanRecoveryEnabled({ VIDEO_ORPHAN_RECOVERY: "false" })).toBe(false);
    expect(isOrphanRecoveryEnabled({ VIDEO_ORPHAN_RECOVERY: "0" })).toBe(false);
    expect(isOrphanRecoveryEnabled({ VIDEO_ORPHAN_RECOVERY: "off" })).toBe(false);
    expect(isOrphanRecoveryEnabled({ VIDEO_ORPHAN_RECOVERY: "no" })).toBe(false);
  });
});
