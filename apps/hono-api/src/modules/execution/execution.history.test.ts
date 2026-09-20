import { describe, expect, it } from "vitest";
import {
	mapExecutionHistoryRow,
	mapExecutionSnapshotRow,
	type ExecutionHistoryRow,
} from "./execution.repo";

const baseExecution = {
	id: "execution-1",
	flow_id: "flow-1",
	flow_version_id: "version-1",
	execution_family_id: "execution-1",
	owner_id: "owner-1",
	status: "running",
	concurrency: 1,
	trigger: "manual",
	error_message: null,
	created_at: "2026-08-14T09:00:00.000Z",
	started_at: "2026-08-14T09:00:01.000Z",
	finished_at: null,
} as const;

describe("workflow execution history projection", () => {
	it("surfaces a waiting node ahead of ordinary running and queued nodes", () => {
		const row: ExecutionHistoryRow = {
			...baseExecution,
			flow_versions: { data: JSON.stringify({ nodes: [{ id: "approval", data: { label: "人工审批" } }] }) },
			workflow_node_runs: [
				{ node_id: "queued", status: "queued", error_message: null, created_at: "2026-08-14T09:00:02.000Z", output_refs: null },
				{ node_id: "running", status: "running", error_message: null, created_at: "2026-08-14T09:00:03.000Z", output_refs: null },
				{ node_id: "approval", status: "waiting_external", error_message: null, created_at: "2026-08-14T09:00:04.000Z", output_refs: null },
			],
		};

		const dto = mapExecutionHistoryRow(row);

		expect(dto.focusNode).toEqual({
			nodeId: "approval",
			nodeLabel: "人工审批",
			status: "waiting_external",
			errorMessage: null,
			waitingReasonCode: null,
			waitingReasonLabel: null,
		});
		expect(dto.nodeSummary).toMatchObject({ total: 3, queued: 1, running: 1, waitingExternal: 1 });
	});

	it("names the exact external boundary of the waiting focus node from its receipt", () => {
		const row: ExecutionHistoryRow = {
			...baseExecution,
			flow_versions: { data: JSON.stringify({ nodes: [{ id: "beat-sheet-agent", data: { label: "BeatSheet 创作 Agent" } }] }) },
			workflow_node_runs: [
				{
					node_id: "beat-sheet-agent",
					status: "waiting_external",
					error_message: null,
					created_at: "2026-08-14T09:00:04.000Z",
					output_refs: JSON.stringify({ evidence: {
						continuationReason: "provider_balance_required",
						requestTerminal: { status: "suspended", reason: "provider_balance_required" },
						deliveryEvidence: { recoveryCheckpoint: { reasonCode: "provider_balance_required" } },
					} }),
				},
			],
		};

		expect(mapExecutionHistoryRow(row).focusNode).toMatchObject({
			nodeId: "beat-sheet-agent",
			waitingReasonCode: "provider_balance_required",
			waitingReasonLabel: "等待余额恢复",
		});
	});

	it("keeps the generic wait when the receipt declares conflicting reasons", () => {
		const row: ExecutionHistoryRow = {
			...baseExecution,
			flow_versions: { data: JSON.stringify({ nodes: [{ id: "beat-sheet-agent", data: { label: "BeatSheet 创作 Agent" } }] }) },
			workflow_node_runs: [
				{
					node_id: "beat-sheet-agent",
					status: "waiting_external",
					error_message: null,
					created_at: "2026-08-14T09:00:04.000Z",
					output_refs: JSON.stringify({ evidence: {
						continuationReason: "provider_balance_required",
						requestTerminal: { status: "suspended", reason: "provider_stream_interrupted" },
					} }),
				},
			],
		};

		expect(mapExecutionHistoryRow(row).focusNode).toMatchObject({
			waitingReasonCode: null,
			waitingReasonLabel: null,
		});
	});

	it("surfaces the failed node and its exact persisted error", () => {
		const row: ExecutionHistoryRow = {
			...baseExecution,
			status: "failed",
			finished_at: "2026-08-14T09:01:00.000Z",
			flow_versions: { data: JSON.stringify({ nodes: [{ id: "video", data: { workflowNodeId: "video-generator" } }] }) },
			workflow_node_runs: [
				{ node_id: "video", status: "failed", error_message: "provider task rejected", created_at: "2026-08-14T09:00:04.000Z", output_refs: null },
				{ node_id: "downstream", status: "queued", error_message: null, created_at: "2026-08-14T09:00:05.000Z", output_refs: null },
			],
		};

		expect(mapExecutionHistoryRow(row).focusNode).toEqual({
			nodeId: "video",
			nodeLabel: "video-generator",
			status: "failed",
			errorMessage: "provider task rejected",
			waitingReasonCode: null,
			waitingReasonLabel: null,
		});
	});

	it("parses the immutable flow version instead of reading the current flow", () => {
		const dto = mapExecutionSnapshotRow({
			id: "execution-1",
			flow_id: "flow-1",
			flow_version_id: "version-1",
			flow_versions: {
				name: "一键成片工作流",
				data: JSON.stringify({ nodes: [{ id: "historical-node" }], edges: [] }),
				created_at: "2026-08-14T09:00:00.000Z",
			},
		});

		expect(dto.flowVersionId).toBe("version-1");
		expect(dto.data).toEqual({ nodes: [{ id: "historical-node" }], edges: [] });
	});
});
