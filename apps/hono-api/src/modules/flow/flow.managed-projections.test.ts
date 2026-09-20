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
	it.each(["queued", "running", "failed", "success"])("saves model and parameter edits on %s outputs during an active workflow", (status) => {
		const persisted = { ...workflowVideoNode, data: {
			...workflowVideoNode.data, status, taskId: "provider-task", progress: 42,
			videoModel: "original-model", videoResolution: "720p", videoDurationSeconds: 10,
		} };
		const edited = { ...persisted, data: {
			...persisted.data, videoModel: "user-model", videoResolution: "1080p", videoDurationSeconds: 5,
			videoGenerateAudio: false, status: "queued", taskId: "stale-task", progress: 0,
			videoUrl: "", workflowEffectId: "stale-effect",
		} };
		const result = preserveManagedFlowProjections({
			existing: { nodes: [persisted], edges: [] },
			incoming: { nodes: [edited], edges: [] },
			executionActive: { "execution-1": true },
		});
		expect(result.nodes).toEqual([{ ...persisted, data: {
			...persisted.data, videoModel: "user-model", videoResolution: "1080p", videoDurationSeconds: 5,
			videoGenerateAudio: false,
			workflowSubmittedSettings: { videoModel: "original-model", videoResolution: "720p", videoDurationSeconds: 10 },
		} }]);
		// A subsequent save retains the user's settings along with the provider receipt.
		expect(preserveManagedFlowProjections({
			existing: result, incoming: result, executionActive: { "execution-1": true },
		})).toEqual(result);
	});

  it("preserves the paired submitted prompt and image order through stale editor saves", () => {
    const snapshot = { prompt: "角色甲使用图2，道具使用图1", referenceMediaManifest: {
      images: [{ url: "https://example.com/prop.png", label: "道具" }, { url: "https://example.com/person.png", label: "角色甲" }], audios: [],
    }, preparedAt: "2026-09-09T00:00:00Z" };
    const persisted = { ...workflowVideoNode, data: { ...workflowVideoNode.data, workflowVideoSubmissionInput: snapshot } };
    const incoming = { ...persisted, data: { ...persisted.data, prompt: "new authoring", workflowVideoSubmissionInput: { prompt: "stale" } } };
    const result = preserveManagedFlowProjections({ existing: { nodes: [persisted], edges: [] }, incoming: { nodes: [incoming], edges: [] }, executionActive: { "execution-1": false } });
    expect(result.nodes).toEqual([expect.objectContaining({ data: expect.objectContaining({ prompt: "new authoring", workflowVideoSubmissionInput: snapshot }) })]);
  });

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

	it("allows the user to remove the workflow execution status card", () => {
		const result = preserveManagedFlowProjections({
			existing: { nodes: [workflowExecutionNode], edges: [] },
			incoming: { nodes: [], edges: [] },
		});

		expect(result.nodes).toEqual([]);
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

		expect(result.nodes).toEqual([{ id: "delivery-node", data: { kind: "text" } }]);
		expect(result.edges).toEqual([]);
	});

	it("keeps authoring edits but preserves runtime facts for a terminal-execution output", () => {
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
			data: { ...workflowVideoNode.data, label: "用户改名" },
		}]);
	});

	it.each(["accepted", "uncertain"])("protects %s media even after aggregate failure", (state) => {
		const pending = { ...workflowVideoNode, data: {
			...workflowVideoNode.data, status: "failed", videoUrl: "",
			workflowSubmissionState: state, taskId: "accepted-task",
		} };
		const result = preserveManagedFlowProjections({
			existing: { nodes: [pending], edges: [] },
			incoming: { nodes: [], edges: [] },
			executionActive: { "execution-1": false },
		});
		expect(result.nodes).toEqual([pending]);
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

it.each(["accepted", "uncertain"])("permits deleting a successful output after terminal workflow despite stale %s submission metadata", (workflowSubmissionState) => {
	const node = { ...workflowVideoNode, data: { ...workflowVideoNode.data, workflowSubmissionState } };
	const result = preserveManagedFlowProjections({
		existing: { nodes: [node], edges: [] },
		incoming: { nodes: [], edges: [] },
		executionActive: { "execution-1": false },
	});
	expect(result.nodes).toEqual([]);
});

it('preserves generated poster and video together when a stale browser saves a terminal output', () => {
  const data = { ...workflowVideoNode.data, videoThumbnailUrl: 'https://assets.example.com/generated.jpg' };
  const result = preserveManagedFlowProjections({
    existing: { nodes: [{ ...workflowVideoNode, data }], edges: [] },
    incoming: { nodes: [{ ...workflowVideoNode, data: { ...data, status: 'running', videoUrl: '', videoThumbnailUrl: 'https://assets.example.com/input.jpg', prompt: 'user edit' } }], edges: [] },
    executionActive: { 'execution-1': false },
  });
  expect(result.nodes).toEqual([{ ...workflowVideoNode, data: { ...data, prompt: 'user edit' } }]);
});
