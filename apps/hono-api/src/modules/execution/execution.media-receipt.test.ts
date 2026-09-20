import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppContext } from "../../types";
const poll = vi.hoisted(() => vi.fn());
vi.mock("../task/task.polling", () => ({ fetchTaskResultForPolling: poll }));
import { reconcileWorkflowMediaReceipt } from "./execution.media-receipt";
const context = {} as AppContext;
beforeEach(() => { poll.mockReset(); });
function receipt(status: string, assets: readonly Record<string, unknown>[] = []) {
	poll.mockResolvedValue({ ok: true, vendor: "test", result: { id: "task", status, assets, raw: {} } });
}
describe("accepted media receipt independent of canvas projection", () => {
	it("recovers the existing image URL and stable asset identity", async () => {
		receipt("succeeded", [{ type: "image", url: "https://assets.test/a.png", assetId: "asset" }]);
		expect(await reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "image"))
			.toMatchObject({ status: "success", imageUrl: "https://assets.test/a.png", assetId: "asset", reused: true });
		expect(poll).toHaveBeenCalledWith(context, "owner", { taskId: "task", mode: "public", timeoutMs: 20000 });
	});
	it("recovers video without recreating its canvas node", async () => {
		receipt("succeeded", [{ type: "video", url: "https://assets.test/v.mp4" }]);
		expect(await reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "video"))
			.toMatchObject({ status: "success", videoUrl: "https://assets.test/v.mp4" });
	});
	it.each(["queued", "running"])("only waits on confirmed %s", async status => {
		receipt(status);
		expect(await reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "image"))
			.toMatchObject({ status: "waiting_external" });
	});
	it("preserves provider failure", async () => {
		receipt("failed");
		expect(await reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "image"))
			.toMatchObject({ status: "failed" });
	});
	it("does not represent query errors as a running provider task", async () => {
		poll.mockResolvedValue({ ok: false, status: 503, body: {} });
		expect(await reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "image")).toMatchObject({ status: "waiting_external", taskId: "task", observationFailure: { message: "Accepted media receipt query failed (HTTP 503)" } });
	});
	it("rejects missing asset identity instead of binding a deleted node", async () => {
		receipt("succeeded", [{ type: "image", url: "https://assets.test/a.png" }]);
		await expect(reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "image")).rejects.toThrow("asset identity");
	});
	it("does not accept a receipt from another task", async () => {
		poll.mockResolvedValue({ ok: true, result: { id: "other", status: "running", assets: [] } });
		await expect(reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "video")).rejects.toThrow("identity mismatch");
	});
});


it("retains the accepted task on transport failure", async () => {
 poll.mockRejectedValue(new Error("connection reset"));
 expect(await reconcileWorkflowMediaReceipt(context, "owner", "deleted", "task", "video"))
  .toMatchObject({ status: "waiting_external", taskId: "task", observationFailure: { message: "connection reset" } });
});
