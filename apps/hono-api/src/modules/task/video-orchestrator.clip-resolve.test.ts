import { describe, expect, it } from "vitest";

import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import {
  collectActiveOrchestratorRunIds,
  resolveClipVideoRuntime,
} from "./video-orchestrator.clip-resolve";

const node = (id: string, data: Record<string, unknown>): VideoFlowNode => ({ id, data });

describe("resolveClipVideoRuntime — 按 slot 或 (clipRunId, clipIndex) 认成片（治反复重造 clip0）", () => {
  it("优先命中确定性 slot 节点", () => {
    const nodes = [
      node("vclip-slot", { kind: "video", status: "success", videoUrl: "https://x/v.mp4" }),
    ];
    expect(resolveClipVideoRuntime(nodes, "vclip-slot", "run-1", 0)).toEqual({
      status: "success",
      videoUrl: "https://x/v.mp4",
      nodeId: "vclip-slot",
    });
  });

  it("slot id 对不上时，按 clipRunId+clipIndex 认出手动命名的成片（不再重造 clip0）", () => {
    const nodes = [
      node("agent-clip-01-retry", {
        kind: "video",
        status: "success",
        videoUrl: "https://x/v.mp4",
        clipRunId: "run-1",
        clipIndex: 0,
      }),
    ];
    expect(resolveClipVideoRuntime(nodes, "vclip-missing", "run-1", 0)).toEqual({
      status: "success",
      videoUrl: "https://x/v.mp4",
      nodeId: "agent-clip-01-retry",
    });
  });

  it("既无 slot 又无元数据匹配 → absent", () => {
    const nodes = [
      node("other", { kind: "video", status: "success", clipRunId: "run-9", clipIndex: 0 }),
    ];
    expect(resolveClipVideoRuntime(nodes, "vclip-missing", "run-1", 0)).toEqual({
      status: "absent",
    });
  });

  it("running/queued/submitted 统一归为 running", () => {
    const nodes = [node("vslot", { kind: "video", status: "queued" })];
    expect(resolveClipVideoRuntime(nodes, "vslot", "run-1", 0)).toMatchObject({
      status: "running",
      nodeId: "vslot",
    });
  });

  it("credit-finalizer 写回的 error 是失败终态，不能被当成 absent 后重挂在飞任务", () => {
    const nodes = [
      node("vslot", {
        kind: "video",
        status: "error",
        errorMessage: "OutputVideoSensitiveContentDetected.PolicyViolation",
        clipRunId: "run-1",
        clipIndex: 3,
      }),
    ];
    expect(resolveClipVideoRuntime(nodes, "vslot", "run-1", 3)).toEqual({
      status: "failed",
      error: "OutputVideoSensitiveContentDetected.PolicyViolation",
      nodeId: "vslot",
    });
  });
});

describe("collectActiveOrchestratorRunIds — 编排归属闸：探测活跃编排 run（治裸提交重复 clip）", () => {
  it("收集带 clipRunId 且活跃(running/queued/submitted/success)的去重 runId", () => {
    const nodes = [
      node("vclip-0", { kind: "video", status: "running", clipRunId: "run-1", clipIndex: 0 }),
      node("vclip-1", { kind: "video", status: "queued", clipRunId: "run-1", clipIndex: 1 }),
      node("vclip-2", { kind: "video", status: "success", clipRunId: "run-2", clipIndex: 0 }),
    ];
    expect(collectActiveOrchestratorRunIds(nodes).sort()).toEqual(["run-1", "run-2"]);
  });

  it("失败/未知状态不算活跃（允许裸路径降级恢复）", () => {
    const nodes = [
      node("vclip-f", { kind: "video", status: "failed", clipRunId: "run-1", clipIndex: 0 }),
      node("vclip-x", { kind: "video", clipRunId: "run-2", clipIndex: 0 }),
    ];
    expect(collectActiveOrchestratorRunIds(nodes)).toEqual([]);
  });

  it("没有 clipRunId 的裸视频节点（legacy 单镜直生）不构成编排 run", () => {
    const nodes = [
      node("g2-direct-clip-0", { kind: "video", status: "running" }),
      node("img-1", { kind: "image", imageUrl: "https://x/p.png", clipRunId: "run-1" }),
    ];
    expect(collectActiveOrchestratorRunIds(nodes)).toEqual([]);
  });

  it("composeVideo 也计入（成片节点带 clipRunId）", () => {
    const nodes = [
      node("compose", { kind: "composeVideo", status: "success", clipRunId: "run-9" }),
    ];
    expect(collectActiveOrchestratorRunIds(nodes)).toEqual(["run-9"]);
  });
});
