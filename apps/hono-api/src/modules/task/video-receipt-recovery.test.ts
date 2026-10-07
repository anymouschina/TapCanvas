import { describe, expect, it } from "vitest";
import { TaskResultSchema } from "./task.schemas";
import { appendSupersededVideoReceipt, buildVideoReceiptEvidencePatch, readNewApiReceiptEvidence, readNewApiReceiptRecovery, readTaskReceiptRecovery, receiptAwaitsEvidence } from "./video-receipt-recovery";

describe("video receipt recovery", () => {
  it("parses structured provider recovery without inferring state from failure prose", () => {
    expect(readNewApiReceiptRecovery({ error: "timeout download error" })).toBeUndefined();
    expect(readNewApiReceiptRecovery({ receipt_recovery: { disposition: "awaiting_late_result",
      failure_kind: "download", observed_at: 123, terminal_billing_preserved: true } })).toEqual({
      disposition: "awaiting_late_result", failureKind: "download", observedAt: 123, terminalBillingPreserved: true,
    });
    expect(receiptAwaitsEvidence(undefined)).toBe(false);
    expect(receiptAwaitsEvidence({ disposition: "action_failed" })).toBe(false);
    expect(() => readNewApiReceiptRecovery({ receipt_recovery: { disposition: "invented" } })).toThrow();
  });

  it("keeps typed terminal billing evidence through task schema serialization", () => {
    const result = TaskResultSchema.parse({ id: "receipt", kind: "text_to_video", status: "succeeded", assets: [], raw: {},
      receiptRecovery: { disposition: "terminal", terminalBillingPreserved: true } });
    expect(readTaskReceiptRecovery(TaskResultSchema.parse(JSON.parse(JSON.stringify(result)) as unknown)))
      .toEqual({ disposition: "terminal", terminalBillingPreserved: true });
  });

  it("appends old receipt asset evidence once without including active attempt fields", () => {
    const result = TaskResultSchema.parse({ id: "old", kind: "text_to_video", status: "succeeded", raw: {},
      assets: [{ type: "video", url: "https://owned.example/old.mp4" }] });
    const input = { nodeData: { status: "running", videoTaskId: "new" }, taskId: "old", vendor: "newapi", result };
    const patch = appendSupersededVideoReceipt(input);
    expect(patch).toEqual({ videoReceiptHistory: [expect.objectContaining({ taskId: "old", assets: result.assets })] });
    expect(appendSupersededVideoReceipt({ ...input, nodeData: { ...input.nodeData, ...patch } })).toBeNull();
  });

  it("parses sanitized historical receipt evidence without introducing it into current assets", () => {
    expect(readNewApiReceiptEvidence({ receipt_assets: [{ url: "https://provider.example/history.mp4", observed_at: 100 }],
      receipt_reconciliation: { revision: 3, pending_receipts: 1, observed_receipts: 2, identity_error: true } })).toEqual({
      receiptAssets: [{ type: "video", url: "https://provider.example/history.mp4", observedAt: 100 }],
      receiptReconciliation: { revision: 3, pendingReceipts: 1, observedReceipts: 2, identityError: true },
    });
  });

  it("appends owned historical assets once and keeps current selection untouched", () => {
    const result = TaskResultSchema.parse({ id: "public-task", kind: "text_to_video", status: "succeeded", assets: [], raw: {},
      receiptAssets: [{ type: "video", url: "https://owned.example/history.mp4", observedAt: 100, sourceUrl: "https://provider.example/history.mp4" }],
      receiptReconciliation: { revision: 3, pendingReceipts: 0, observedReceipts: 2 } });
    const nodeData = { status: "success", videoUrl: "https://owned.example/current.mp4", videoPrimaryIndex: 0 };
    const patch = buildVideoReceiptEvidencePatch({ nodeData, taskId: result.id, vendor: "newapi", result });
    expect(patch).toMatchObject({ videoReceiptReconciliation: result.receiptReconciliation,
      videoReceiptHistory: [{ historicalReceipt: true, assets: result.receiptAssets }] });
    expect(patch).not.toHaveProperty("videoUrl");
    expect(buildVideoReceiptEvidencePatch({ nodeData: { ...nodeData, ...patch }, taskId: result.id, vendor: "newapi", result })).toBeNull();
  });

  it("replaces stale awaiting receipt metadata with provider terminal evidence once", () => {
    const result = TaskResultSchema.parse({ id: "public-task", kind: "text_to_video", status: "succeeded", assets: [], raw: {},
      receiptRecovery: { disposition: "terminal", terminalBillingPreserved: true } });
    const nodeData = { status: "success", videoUrl: "https://owned.example/current.mp4",
      videoReceiptRecovery: { disposition: "awaiting_late_result" } };
    const patch = buildVideoReceiptEvidencePatch({ nodeData, taskId: result.id, vendor: "newapi", result });
    expect(patch).toEqual({ videoReceiptRecovery: result.receiptRecovery });
    expect(buildVideoReceiptEvidencePatch({ nodeData: { ...nodeData, ...patch }, taskId: result.id, vendor: "newapi", result })).toBeNull();
  });
});
