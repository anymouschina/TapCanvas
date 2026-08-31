import { describe, expect, it } from "vitest";

import {
  flowGraphHasStuckImageNode,
  selectOrphanPlaceholderImageNodeIds,
  selectStuckImageNodeIds,
} from "./image-orphan-recovery";

describe("selectOrphanPlaceholderImageNodeIds（孤儿占位：无 task+无 url 的永转节点）", () => {
  it("挑出 running/queued + 无 taskId + 无 imageUrl 的孤儿（ch38 board-02/03）", () => {
    const nodes = [
      { id: "b2", data: { kind: "image", status: "queued" } },
      { id: "b3", data: { kind: "storyboardImage", status: "running" } },
    ];
    expect(selectOrphanPlaceholderImageNodeIds(nodes)).toEqual(["b2", "b3"]);
  });

  it("有 taskId 的不算孤儿（走正常回收）；有 imageUrl 的不算（已出图）", () => {
    const nodes = [
      { id: "a", data: { kind: "image", status: "queued", taskId: "t1" } },
      { id: "b", data: { kind: "image", status: "running", imageUrl: "http://x/y.png" } },
    ];
    expect(selectOrphanPlaceholderImageNodeIds(nodes)).toEqual([]);
  });

  it("success/error 不算孤儿", () => {
    const nodes = [{ id: "a", data: { kind: "image", status: "error" } }];
    expect(selectOrphanPlaceholderImageNodeIds(nodes)).toEqual([]);
  });

  it("孤儿也让 flowGraphHasStuckImageNode 命中（候选粗筛能抓到纯孤儿章节）", () => {
    expect(
      flowGraphHasStuckImageNode({ nodes: [{ id: "b2", data: { kind: "image", status: "queued" } }] }),
    ).toBe(true);
  });
});

describe("selectStuckImageNodeIds（sweep 安全门：只回收真卡死的图片节点）", () => {
  it("挑出 running/queued + 有 imageTaskId/taskId 的图片节点", () => {
    const nodes = [
      { id: "a", data: { kind: "image", status: "running", imageTaskId: "t1" } },
      { id: "b", data: { kind: "storyboardImage", status: "queued", taskId: "t2" } },
      { id: "c", data: { kind: "imageEdit", status: "running", imageTaskId: "t3" } },
    ];
    expect(selectStuckImageNodeIds(nodes)).toEqual(["a", "b", "c"]);
  });

  it("已 success/error 的不动（避免覆盖成片结果）", () => {
    const nodes = [
      { id: "a", data: { kind: "image", status: "success", imageTaskId: "t1" } },
      { id: "b", data: { kind: "image", status: "error", imageTaskId: "t2" } },
    ];
    expect(selectStuckImageNodeIds(nodes)).toEqual([]);
  });

  it("无 taskId 的不动（无从查上游，避免误判）", () => {
    const nodes = [{ id: "a", data: { kind: "image", status: "running" } }];
    expect(selectStuckImageNodeIds(nodes)).toEqual([]);
  });

  it("非图片节点（video/text）不动", () => {
    const nodes = [
      { id: "v", data: { kind: "video", status: "running", taskId: "t1" } },
      { id: "t", data: { kind: "text", status: "running" } },
    ];
    expect(selectStuckImageNodeIds(nodes)).toEqual([]);
  });

  it("flowGraphHasStuckImageNode 作候选粗筛", () => {
    expect(
      flowGraphHasStuckImageNode({
        nodes: [{ id: "a", data: { kind: "image", status: "running", imageTaskId: "t1" } }],
      }),
    ).toBe(true);
    expect(flowGraphHasStuckImageNode({ nodes: [] })).toBe(false);
    expect(flowGraphHasStuckImageNode(null)).toBe(false);
  });
});
