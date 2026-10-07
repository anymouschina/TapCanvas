import { describe, expect, it, vi } from "vitest";
import { hydrateExecutionHistoryFocus, selectExecutionHistoryFocus } from "./execution.history-focus";
import { encodeWorkflowOutput } from "./execution.output-storage";

const node = (node_id: string, status: string, created_at = "2026-01-01") => ({ node_id, status, created_at, error_message: null });
const label = (node_id: string, name: string | null = "冻结节点名") => ({
	flow_version_id: "v1", node_id, snapshot_type: "object", nodes_type: "array", label: name, workflow_node_id: "frozen-step",
});

describe("bounded execution history hydration", () => {
	it("does not read snapshots or receipts for terminal successes", async () => {
		const db = { $queryRaw: vi.fn(), workflow_node_runs: { findUnique: vi.fn() } };
		const rows = [{ id: "e1", flow_version_id: "v1", workflow_node_runs: [node("done", "success"), node("branch", "not_selected")] }];
		expect(await hydrateExecutionHistoryFocus(db as never, rows)).toEqual([{ ...rows[0], focus_node: null }]);
		expect(db.$queryRaw).not.toHaveBeenCalled();
		expect(db.workflow_node_runs.findUnique).not.toHaveBeenCalled();
	});

	it("preserves focus priority and creation order without loading outputs", () => {
		const waiting = node("wait", "waiting_external");
		expect(selectExecutionHistoryFocus([node("queued", "queued"), node("running", "running"), waiting])).toBe(waiting);
		const first = node("first", "failed", "2026-01-01");
		expect(selectExecutionHistoryFocus([waiting, node("later", "failed", "2026-01-02"), first])).toBe(first);
	});

	it("loads only the focused failed node's immutable label, never its output", async () => {
		const db = { $queryRaw: vi.fn().mockResolvedValue([label("failed", "  原始名称  ")]), workflow_node_runs: { findUnique: vi.fn() } };
		const rows = [{ id: "e1", flow_version_id: "v1", workflow_node_runs: [node("done", "success"), node("failed", "failed")] }];
		const result = await hydrateExecutionHistoryFocus(db as never, rows);
		expect(result[0]?.focus_node?.label).toBe("原始名称");
		expect(db.workflow_node_runs.findUnique).not.toHaveBeenCalled();
		expect(db.$queryRaw.mock.calls[0]![0].values).toEqual(['[{"flow_version_id":"v1","node_id":"failed"}]']);
	});

	it("reads waiting receipts one at a time and retains only their factual reasons", async () => {
		let activeReads = 0;
		const largeBody = "body-not-needed-in-history".repeat(20_000);
		const evidence = [
			{ continuationReason: "provider_balance_required", requestTerminal: { reason: "provider_balance_required" } },
			{ continuationReason: "provider_balance_required", requestTerminal: { reason: "provider_stream_interrupted" } },
		];
		const db = {
			$queryRaw: vi.fn().mockResolvedValue([label("wait1"), label("wait2", null)]),
			workflow_node_runs: { findUnique: vi.fn(async () => {
				activeReads += 1;
				expect(activeReads).toBe(1);
				await Promise.resolve();
				activeReads -= 1;
				return { output_refs: JSON.stringify(encodeWorkflowOutput({ ports: { text: largeBody }, evidence: evidence.shift() })) };
			}) },
		};
		const rows = [1, 2].map((id) => ({ id: `e${id}`, flow_version_id: "v1", workflow_node_runs: [node(`wait${id}`, "waiting_external")] }));
		const result = await hydrateExecutionHistoryFocus(db as never, rows);
		expect(result[0]?.focus_node?.waitingReason).toEqual({ code: "provider_balance_required", label: "等待余额恢复" });
		expect(result[1]?.focus_node).toMatchObject({ waitingReason: null, label: "frozen-step" });
		expect(JSON.stringify(result)).not.toContain(largeBody);
		expect(db.workflow_node_runs.findUnique).toHaveBeenCalledTimes(2);
		expect(db.workflow_node_runs.findUnique).toHaveBeenCalledWith({ where: { execution_id_node_id: { execution_id: "e1", node_id: "wait1" } }, select: { output_refs: true } });
	});

	it("reports invalid immutable snapshots explicitly", async () => {
		const db = { $queryRaw: vi.fn().mockResolvedValue([{ ...label("failed"), nodes_type: "object" }]), workflow_node_runs: { findUnique: vi.fn() } };
		await expect(hydrateExecutionHistoryFocus(db as never, [{ id: "e1", flow_version_id: "v1", workflow_node_runs: [node("failed", "failed")] }])).rejects.toThrow("must contain nodes");
	});
});
