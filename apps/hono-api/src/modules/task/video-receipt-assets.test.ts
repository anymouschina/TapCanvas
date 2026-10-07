import { describe, expect, it, vi } from "vitest";
import { hostHistoricalVideoReceiptAssets } from "./video-receipt-assets";
import { TaskResultSchema } from "./task.schemas";

describe("historical video receipt materialization", () => {
  const result = TaskResultSchema.parse({ id: "public-task", kind: "text_to_video", status: "failed", assets: [], raw: {},
    receiptAssets: [{ type: "video", url: "https://provider.example/old.mp4", observedAt: 100 }] });

  it("hosts historical results independently of failed current status and keeps current assets separate", async () => {
    const hostAssets = vi.fn().mockResolvedValue([{ type: "video", url: "https://owned.example/old.mp4", assetId: "historical-asset" }]);
    const hosted = await hostHistoricalVideoReceiptAssets({ result, hostAssets });
    expect(hosted).toMatchObject({ status: "failed", assets: [], receiptAssets: [{ type: "video",
      url: "https://owned.example/old.mp4", sourceUrl: "https://provider.example/old.mp4", observedAt: 100, assetId: "historical-asset" }] });
    await hostHistoricalVideoReceiptAssets({ result, stored: hosted, hostAssets });
    expect(hostAssets).toHaveBeenCalledTimes(1);
  });

  it("retains hosted history when a later GET returns no additional historical assets", async () => {
    const stored = { ...result, receiptAssets: [{ type: "video" as const, url: "https://owned.example/old.mp4", observedAt: 100,
      sourceUrl: "https://provider.example/old.mp4" }] };
    const hostAssets = vi.fn();
    const hosted = await hostHistoricalVideoReceiptAssets({ result: { ...result, receiptAssets: [] }, stored, hostAssets });
    expect(hosted.receiptAssets).toEqual(stored.receiptAssets);
    expect(hostAssets).not.toHaveBeenCalled();
  });
});
