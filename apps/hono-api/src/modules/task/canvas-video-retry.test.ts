import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
const mocks = vi.hoisted(() => ({
  generate: vi.fn(), reconcile: vi.fn(), nodes: new Map<string, VideoFlowNode>(),
}));
vi.mock("./agents-tool-bridge.generate-video-to-canvas", () => ({
  generateVideoToCanvas: mocks.generate, reconcileVideoNodesForFlow: mocks.reconcile,
}));
vi.mock("./video-orchestrator.flow-io", () => ({
  freshReadFlowRow: vi.fn(async () => ({})),
  findFlowNode: (_row: unknown, id: string) => mocks.nodes.get(id) ?? null,
  readDurableNodeVideoUrl: (node: VideoFlowNode | undefined) => node?.data.videoUrl ?? "",
}));
vi.mock("./video-orchestrator.authoring.repo", () => ({ stableContentHash: (value: unknown) => JSON.stringify(value) }));
import { buildStoredVideoRetryNode, retryCanvasVideo } from "./canvas-video-retry";

describe("stored video retry", () => {
  const source = (): VideoFlowNode => ({ id: "original", type: "task", position: { x: 100, y: 200 }, data: {
    kind: "video", status: "failed", taskId: "old-task", workflowEffectId: "old-effect",
    workflowExecutionId: "original-execution", prompt: "Frozen prompt", shots: [{ action: "Frozen shot" }],
    referenceImageNodeIds: ["image-1"], referenceImages: ["https://asset.test/1.png"],
    videoModel: "selected-model", clipRunId: "old-run", clipIndex: 1,
  } });
  const input = (retryIndex = 1) => ({ c: {} as never, requestUserId: "owner", devBypass: false, flowId: "flow", row: {} as never,
    bodyArgs: { nodeId: "original", retryIndex, idempotencyKey: "request" } });
  beforeEach(() => {
    vi.clearAllMocks(); mocks.nodes.clear(); mocks.nodes.set("original", source());
    mocks.generate.mockResolvedValue({ ok: true, status: "running", taskId: "new-task" });
    mocks.reconcile.mockResolvedValue({ details: [{ nodeId: "original", taskId: "old-task", status: "failed", providerConfirmedFailure: true }] });
  });
  it("reconciles first and submits exact stored creation inputs under a stable new identity", async () => {
    const before = structuredClone(mocks.nodes.get("original"));
    await retryCanvasVideo(input());
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0]);
    const node = mocks.generate.mock.calls[0][0].bodyArgs.node as VideoFlowNode;
    expect(node.data).toMatchObject({ prompt: "Frozen prompt", shots: [{ action: "Frozen shot" }], referenceImageNodeIds: ["image-1"], videoModel: "selected-model" });
    expect(node.data.taskId).toBeUndefined(); expect(node.data.clipRunId).toBeUndefined();
    expect(node.data.workflowEffectId).not.toBe("old-effect");
    expect(mocks.nodes.get("original")).toEqual(before);
  });
  it("returns an asset recovered by the fresh lookup without creating another paid task", async () => {
    mocks.reconcile.mockImplementationOnce(async () => {
      mocks.nodes.set("original", { ...source(), data: { ...source().data, videoUrl: "https://asset.test/real.mp4" } });
      return { details: [] };
    });
    expect(await retryCanvasVideo(input())).toMatchObject({ reused: true, status: "success", videoUrl: "https://asset.test/real.mp4" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not treat a query error or a pending receipt as a confirmed provider rejection", async () => {
    mocks.reconcile.mockResolvedValueOnce({ details: [{ nodeId: "original", taskId: "old-task", status: "failed" }] });
    await retryCanvasVideo(input());
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("cannot bypass an existing attempt by changing the request key", async () => {
    const existing = buildStoredVideoRetryNode(source(), "flow", 1);
    existing.data.taskId = "already-accepted"; mocks.nodes.set(existing.id, existing);
    await retryCanvasVideo({ ...input(), bodyArgs: { nodeId: "original", retryIndex: 1, idempotencyKey: "another-key" } });
    expect(mocks.generate.mock.calls[0][0].bodyArgs.node).toBe(existing);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("requires the first retry before a second and rejects a third", async () => {
    await expect(retryCanvasVideo(input(2))).rejects.toMatchObject({ code: "video_retry_previous_attempt_missing" });
    await expect(retryCanvasVideo(input(3))).rejects.toMatchObject({ code: "invalid_video_retry_request" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not resubmit a receipt-less uncertain attempt", async () => {
    const node = source(); delete node.data.taskId; node.data.workflowSubmissionState = "uncertain";
    mocks.nodes.set(node.id, node);
    await expect(retryCanvasVideo(input())).rejects.toMatchObject({ code: "video_retry_submission_uncertain" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
