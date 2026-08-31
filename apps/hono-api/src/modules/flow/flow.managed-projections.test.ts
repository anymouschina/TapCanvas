import { describe, expect, it } from "vitest";

import { preserveManagedFlowProjections, readWorkflowExecutionOutputIds } from "./flow.managed-projections";

const serverStatusNode = {
	id: "video-run-status",
	type: "taskNode",
	position: { x: -420, y: 0 },
	data: {
		managedProjection: "video_run_status",
		runId: "run-new",
		productionState: "failed",
		pendingUserInput: null,
	},
};

const workflowVideoNode = {
	id: "video-runtime::output::video",
	type: "taskNode",
	position: { x: 100, y: 120 },
	data: {
		kind: "video",
		status: "success",
		videoUrl: "https://assets.example.com/clip.mp4",
		workflowExecutionId: "execution-1",
		workflowRuntimeNodeId: "video-runtime",
		workflowEffectId: "execution-1:video-runtime:video-submit",
	},
};

const workflowExecutionNode = {
	id: "workflow-execution-status",
	type: "workflowExecutionNode",
	position: { x: 0, y: 0 },
	data: {
		kind: "workflowExecution",
		managedProjection: "workflow_execution",
		workflowRuntimeReference: false,
		workflowExecutionId: "execution-1",
		workflowExecutionCreatedAt: "2026-08-23T00:00:00.000Z",
		workflowStatus: "running",
	},
};

describe("preserveManagedFlowProjections", () => {
	it("keeps server runtime facts while accepting a user layout change", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [serverStatusNode], edges: [] },
			incoming: {
				nodes: [{
					...serverStatusNode,
					position: { x: 20, y: 30 },
					data: {
						managedProjection: "video_run_status",
						runId: "run-old",
						productionState: "scheduled",
						pendingUserInput: { requestId: "stale" },
					},
				}],
				edges: [],
			},
		});

		expect(result.nodes).toEqual([{
			...serverStatusNode,
			position: { x: 20, y: 30 },
		}]);
	});

	it("does not let a stale full snapshot delete the current server projection", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [serverStatusNode], edges: [] },
			incoming: { nodes: [{ id: "user-node", data: { kind: "text" } }], edges: [] },
		});

		expect(result.nodes).toEqual([
			{ id: "user-node", data: { kind: "text" } },
			serverStatusNode,
		]);
	});

	it("does not let a public snapshot mint a server projection", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [], edges: [] },
			incoming: {
				nodes: [
					{ id: "user-node", data: { kind: "text" } },
					serverStatusNode,
				],
				edges: [],
			},
		});

		expect(result.nodes).toEqual([{ id: "user-node", data: { kind: "text" } }]);
	});

	it("preserves the accepted workflow execution node across an empty stale save", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [workflowExecutionNode], edges: [] },
			incoming: { nodes: [], edges: [] },
		});

		expect(result.nodes).toEqual([workflowExecutionNode]);
	});

	it("rejects a client-minted workflow execution projection", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [], edges: [] },
			incoming: { nodes: [workflowExecutionNode], edges: [] },
		});

		expect(result.nodes).toEqual([]);
	});

	it("does not treat arbitrary user data as a managed projection", () => {
		const incoming = { nodes: [{ id: "n1", data: { managedProjection: "invented" } }], edges: [] };
		expect(preserveManagedFlowProjections({ existing: incoming, incoming })).toEqual(incoming);
	});

	it("preserves workflow media outputs and their edges across stale user saves", () => {
		const runtimeEdge = {
			id: "runtime-output-edge",
			source: workflowVideoNode.id,
			target: "delivery-node",
		};
		const result = preserveManagedFlowProjections({
			existing: {
				nodes: [workflowVideoNode, { id: "delivery-node", data: { kind: "text" } }],
				edges: [runtimeEdge],
			},
			incoming: {
				nodes: [{ id: "delivery-node", data: { kind: "text" } }],
				edges: [],
			},
		});

		expect(result.nodes).toContainEqual(workflowVideoNode);
		expect(result.edges).toContainEqual(runtimeEdge);
	});

	it("keeps server workflow media facts while accepting layout changes", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [workflowVideoNode], edges: [] },
			incoming: {
				nodes: [{
					...workflowVideoNode,
					position: { x: 900, y: 420 },
					data: { ...workflowVideoNode.data, status: "running", videoUrl: "" },
				}],
				edges: [],
			},
		});

		expect(result.nodes).toEqual([{ ...workflowVideoNode, position: { x: 900, y: 420 } }]);
	});

	it("rejects client-minted workflow execution outputs", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [], edges: [] },
			incoming: {
				nodes: [workflowVideoNode, { id: "user-node", data: { kind: "text" } }],
				edges: [{ id: "forged-edge", source: workflowVideoNode.id, target: "user-node" }],
			},
		});

		expect(result.nodes).toEqual([{ id: "user-node", data: { kind: "text" } }]);
		expect(result.edges).toEqual([]);
	});

	it("lets a user save delete a workflow output whose execution is terminal", () => {
		const result = preserveManagedFlowProjections({
			existing: {
				nodes: [workflowVideoNode, { id: "delivery-node", data: { kind: "text" } }],
				edges: [{ id: "e1", source: workflowVideoNode.id, target: "delivery-node" }],
			},
			incoming: { nodes: [{ id: "delivery-node", data: { kind: "text" } }], edges: [] },
			executionActive: { "execution-1": false },
		});

		expect(result.nodes.map((node) => node.id)).not.toContain(workflowVideoNode.id);
		expect(result.edges).toEqual([]);
	});

	it("keeps the user snapshot for a kept terminal-execution workflow output", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [workflowVideoNode], edges: [] },
			incoming: {
				nodes: [{
					...workflowVideoNode,
					position: { x: 700, y: 300 },
					data: { ...workflowVideoNode.data, label: "用户改名", status: "failed" },
				}],
				edges: [],
			},
			executionActive: { "execution-1": false },
		});

		expect(result.nodes).toEqual([{
			...workflowVideoNode,
			position: { x: 700, y: 300 },
			data: { ...workflowVideoNode.data, label: "用户改名", status: "failed" },
		}]);
	});

	it("still protects workflow outputs while their execution is active", () => {
		const runtimeEdge = {
			id: "runtime-output-edge",
			source: workflowVideoNode.id,
			target: "delivery-node",
		};
		const result = preserveManagedFlowProjections({
			existing: {
				nodes: [workflowVideoNode, { id: "delivery-node", data: { kind: "text" } }],
				edges: [runtimeEdge],
			},
			incoming: {
				nodes: [{ id: "delivery-node", data: { kind: "text" } }],
				edges: [],
			},
			executionActive: { "execution-1": true },
		});

		expect(result.nodes).toContainEqual(workflowVideoNode);
		expect(result.edges).toContainEqual(runtimeEdge);
	});

	it("protects run-status projections regardless of execution state", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [serverStatusNode], edges: [] },
			incoming: { nodes: [], edges: [] },
			executionActive: { "execution-1": false },
		});

		expect(result.nodes).toContainEqual(serverStatusNode);
	});

	it("collects unique workflow execution output ids for status lookup", () => {
		const otherOutput = {
			...workflowVideoNode,
			id: "video-runtime-2::output::video",
			data: { ...workflowVideoNode.data, workflowExecutionId: "execution-1" },
		};
		expect(readWorkflowExecutionOutputIds({
			nodes: [workflowVideoNode, otherOutput, serverStatusNode, { id: "text", data: { kind: "text" } }],
		})).toEqual(["execution-1"]);
	});
});
