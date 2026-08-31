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
				{ node_id: "queued", status: "queued", error_message: null, created_at: "2026-08-14T09:00:02.000Z" },
				{ node_id: "running", status: "running", error_message: null, created_at: "2026-08-14T09:00:03.000Z" },
				{ node_id: "approval", status: "waiting_external", error_message: null, created_at: "2026-08-14T09:00:04.000Z" },
			],
		};

		const dto = mapExecutionHistoryRow(row);

		expect(dto.focusNode).toEqual({ nodeId: "approval", nodeLabel: "人工审批", status: "waiting_external", errorMessage: null });
		expect(dto.nodeSummary).toMatchObject({ total: 3, queued: 1, running: 1, waitingExternal: 1 });
	});

	it("surfaces the failed node and its exact persisted error", () => {
		const row: ExecutionHistoryRow = {
			...baseExecution,
			status: "failed",
			finished_at: "2026-08-14T09:01:00.000Z",
			flow_versions: { data: JSON.stringify({ nodes: [{ id: "video", data: { workflowNodeId: "video-generator" } }] }) },
			workflow_node_runs: [
				{ node_id: "video", status: "failed", error_message: "provider task rejected", created_at: "2026-08-14T09:00:04.000Z" },
				{ node_id: "downstream", status: "queued", error_message: null, created_at: "2026-08-14T09:00:05.000Z" },
			],
		};

		expect(mapExecutionHistoryRow(row).focusNode).toEqual({
			nodeId: "video",
			nodeLabel: "video-generator",
			status: "failed",
			errorMessage: "provider task rejected",
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
