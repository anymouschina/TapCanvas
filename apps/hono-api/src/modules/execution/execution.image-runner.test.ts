import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getFlowForOwner: vi.fn(),
	reconcileImageNodesForFlow: vi.fn(),
	generateImageToCanvas: vi.fn(),
}));

vi.mock("../flow/flow.repo", () => ({
	getFlowForOwner: mocks.getFlowForOwner,
}));

vi.mock("../task/agents-tool-bridge.generate-image-to-canvas", () => ({
	generateImageToCanvas: mocks.generateImageToCanvas,
	reconcileImageNodesForFlow: mocks.reconcileImageNodesForFlow,
}));

vi.mock("../task/agents-tool-bridge.billing-scope", () => ({
	resolveProjectBillingTeamId: vi.fn(),
}));

import {
	inspectPersistedWorkflowImageNode,
	persistedWorkflowImageRequestMatches,
	runWorkflowImageNode,
	workflowImageEffectIdentity,
} from "./execution.image-runner";

const request = {
	executionId: "execution-1",
	executionFamilyId: "family-1",
	ownerId: "owner-1",
	flowId: "flow-1",
	projectId: "project-1",
	runtimeNodeId: "image-1",
	itemIndex: 0,
	prompt: "prompt",
	negativePrompt: "negative",
	modelKey: "gpt-image-2",
	aspectRatio: "16:9",
	imageSize: "1K",
	referenceAssetBindings: [],
	previousEvidence: { canvasNodeId: "image-1::output::image", taskId: "task-1" },
	resumeOnly: true,
} as const;

function flowRow(data: Record<string, unknown>) {
	return {
		id: "flow-1",
		name: "Workflow",
		data: JSON.stringify(data),
		owner_id: "owner-1",
		project_id: "project-1",
		created_at: "2026-08-15T00:00:00.000Z",
		updated_at: "2026-08-15T00:00:00.000Z",
		canvas_revision: 1,
	};
}

describe("workflow image runner persistence", () => {
	beforeEach(() => {
		mocks.getFlowForOwner.mockReset();
		mocks.reconcileImageNodesForFlow.mockReset();
		mocks.generateImageToCanvas.mockReset();
	});
	it("reuses the same accepted task and canvas node identity", () => {
		expect(workflowImageEffectIdentity({ executionFamilyId: "family-1", runtimeNodeId: "image-1" })).toEqual({
			canvasNodeId: "image-1::family::family-1::output::image",
			effectId: "family-1:image-1:image-submit",
		});
		for (const status of ["queued", "running", "submitted", "submitting"]) {
			expect(inspectPersistedWorkflowImageNode(JSON.stringify({ nodes: [{ id: "image-1::output::image", data: { status, taskId: "task-1" } }] }), "image-1::output::image", "task-1")).toEqual({
				status: "waiting_external", nodeId: "image-1::output::image", taskId: "task-1", reused: true,
			});
		}
	});

	it("reuses the family-scoped image effect when a recovery lost its local receipt", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "image-1::family::family-1::output::image",
				data: {
					kind: "image",
					status: "running",
					taskId: "provider-family-image-1",
					prompt: "prompt",
					negativePrompt: "negative",
					modelKey: "gpt-image-2",
					aspect: "16:9",
					imageSize: "1K",
					referenceAssetBindings: [],
					referenceType: "character",
					roleName: "刘秀",
					characterAssetRole: "identity_anchor",
					characterProfileVersion: "character-card/v3",
					identityAnchors: ["清瘦脸型", "青色道袍"],
					prohibitedDrift: ["不得改变脸型、发型和年龄感"],
				},
			}],
			edges: [],
		}));

		await expect(runWorkflowImageNode({ DB: {} } as never, {
			...request,
			assetMetadata: {
				referenceType: "character",
				roleName: "刘秀",
				characterAssetRole: "identity_anchor",
				characterProfileVersion: "character-card/v3",
				identityAnchors: ["清瘦脸型", "青色道袍"],
				prohibitedDrift: ["不得改变脸型、发型和年龄感"],
			},
			previousEvidence: null,
			resumeOnly: false,
		})).resolves.toMatchObject({
			status: "waiting_external",
			nodeId: "image-1::family::family-1::output::image",
			taskId: "provider-family-image-1",
			reused: true,
		});
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("uses a new family-scoped node when recovery has no item-local evidence", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [
				{
					id: "image-1::output::image",
					data: {
						kind: "image",
						status: "failed",
						taskId: "provider-original-failed",
						prompt: "prompt",
						negativePrompt: "negative",
						modelKey: "gpt-image-2",
						aspect: "16:9",
						imageSize: "1K",
						referenceAssetBindings: [],
					},
				},
			],
			edges: [],
		}));

		mocks.generateImageToCanvas.mockResolvedValue({
			status: "running",
			nodeId: "image-1::family::family-1::output::image",
			taskId: "provider-fresh-image",
		});
		await expect(runWorkflowImageNode({ DB: {} } as never, {
			...request,
			assetMetadata: {
				referenceType: "character",
				roleName: "刘秀",
				characterAssetRole: "identity_anchor",
				characterProfileVersion: "character-card/v3",
				identityAnchors: ["清瘦脸型", "青色道袍"],
				prohibitedDrift: ["不得改变脸型、发型和年龄感"],
			},
			previousEvidence: null,
			resumeOnly: false,
		})).resolves.toMatchObject({
			status: "waiting_external",
			nodeId: "image-1::family::family-1::output::image",
			taskId: "provider-fresh-image",
		});
		expect(mocks.generateImageToCanvas).toHaveBeenCalledTimes(1);
		expect(mocks.generateImageToCanvas).toHaveBeenCalledWith(expect.objectContaining({
			bodyArgs: {
				node: expect.objectContaining({
					data: expect.objectContaining({
						referenceType: "character",
						roleName: "刘秀",
						characterAssetRole: "identity_anchor",
						characterProfileVersion: "character-card/v3",
						identityAnchors: ["清瘦脸型", "青色道袍"],
						prohibitedDrift: ["不得改变脸型、发型和年龄感"],
					}),
				}),
			},
		}));
	});

	it("accepts success only with a persistent image URL", () => {
		expect(inspectPersistedWorkflowImageNode(JSON.stringify({ nodes: [{ id: "image-output", data: { status: "success", imageUrl: "https://assets.example/final.png", assetId: "asset-1" } }] }), "image-output", "task-1")).toMatchObject({ status: "success", imageUrl: "https://assets.example/final.png", assetId: "asset-1" });
		expect(inspectPersistedWorkflowImageNode(JSON.stringify({ nodes: [{ id: "image-output", data: { status: "success", imageUrl: "blob:temporary" } }] }), "image-output", "task-1")).toMatchObject({ status: "failed", errorMessage: expect.stringContaining("without a persistent HTTP(S) URL") });
	});

	it("keeps an accepted image task waiting when its canvas node is temporarily unavailable", () => {
		expect(inspectPersistedWorkflowImageNode(JSON.stringify({ nodes: [] }), "image-output", "task-1")).toEqual({
			status: "waiting_external",
			nodeId: "image-output",
			taskId: "task-1",
			reused: true,
		});
		expect(inspectPersistedWorkflowImageNode(JSON.stringify({ nodes: [] }), "image-output", null)).toMatchObject({
			status: "failed",
			taskId: null,
			errorMessage: expect.stringContaining("no persisted canvas node or accepted provider task identity"),
		});
	});

	it("reuses a stable canvas output only when the generation contract is identical", () => {
		const request = {
			prompt: "same prompt",
			negativePrompt: "same negative",
			modelKey: "gpt-image-2",
			aspectRatio: "16:9",
			imageSize: "2K",
			referenceAssetBindings: [{ assetId: "asset-1", role: "identity" as const, strength: 0.8 }],
		};
		expect(persistedWorkflowImageRequestMatches({
			prompt: "same prompt",
			negativePrompt: "same negative",
			modelKey: "gpt-image-2",
			aspect: "16:9",
			imageSize: "2K",
			referenceAssetBindings: [{ assetId: "asset-1", role: "identity", strength: 0.8 }],
		}, request)).toBe(true);
		expect(persistedWorkflowImageRequestMatches({
			prompt: "changed prompt",
			negativePrompt: "same negative",
			modelKey: "gpt-image-2",
			aspect: "16:9",
			imageSize: "2K",
			referenceAssetBindings: [{ assetId: "asset-1", role: "identity", strength: 0.8 }],
		}, request)).toBe(false);
	});

	it("reconciles an accepted provider task during the durable external check", async () => {
		mocks.getFlowForOwner
			.mockResolvedValueOnce(flowRow({
				nodes: [{
					id: "image-1::output::image",
					data: { kind: "image", status: "submitting", taskId: "task-1" },
				}],
			}))
			.mockResolvedValueOnce(flowRow({
				nodes: [{
					id: "image-1::output::image",
					data: {
						kind: "image",
						status: "success",
						taskId: "task-1",
						imageUrl: "https://assets.example/image.png",
					},
				}],
			}));
		mocks.reconcileImageNodesForFlow.mockResolvedValue({
			ok: true,
			reconciled: 1,
			failed: 0,
			stillRunning: 0,
			details: [{ nodeId: "image-1::output::image", taskId: "task-1", status: "success" }],
		});

		const env = { DB: {}, INTERNAL_WORKER_TOKEN: "internal" } as never;
		await expect(runWorkflowImageNode(env, request)).resolves.toMatchObject({
			status: "success",
			nodeId: "image-1::output::image",
			taskId: "task-1",
			imageUrl: "https://assets.example/image.png",
			reused: true,
		});
		expect(mocks.reconcileImageNodesForFlow).toHaveBeenCalledTimes(1);
		expect(mocks.reconcileImageNodesForFlow).toHaveBeenCalledWith(expect.objectContaining({
			target: { nodeId: "image-1::output::image", taskId: "task-1" },
		}));
		expect(mocks.getFlowForOwner).toHaveBeenCalledTimes(2);
	});

	it("does not reconcile an already completed receipt", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "image-1::output::image",
				data: {
					kind: "image",
					status: "success",
					taskId: "task-1",
					imageUrl: "https://assets.example/image.png",
				},
			}],
		}));

		await expect(runWorkflowImageNode({ DB: {} } as never, { ...request, resumeOnly: false })).resolves.toMatchObject({
			status: "success",
			imageUrl: "https://assets.example/image.png",
		});
		expect(mocks.reconcileImageNodesForFlow).not.toHaveBeenCalled();
		expect(mocks.getFlowForOwner).toHaveBeenCalledTimes(1);
	});

	it("does not resubmit after an exact provider receipt is terminal failed", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "image-1::output::image",
				data: { kind: "image", status: "failed", taskId: "task-1", errorMessage: "provider failed" },
			}],
		}));
		await expect(runWorkflowImageNode({ DB: {} } as never, request)).resolves.toMatchObject({
			status: "failed",
			nodeId: "image-1::output::image",
			taskId: "task-1",
		});
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("does not resubmit a previously persisted terminal failure", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "image-1::family::family-1::output::image",
				data: { kind: "image", status: "failed", taskId: "task-retry-1", errorMessage: "provider failed again" },
			}],
		}));

		await expect(runWorkflowImageNode({ DB: {} } as never, {
			...request,
			resumeOnly: false,
			previousEvidence: {
				canvasNodeId: "image-1::family::family-1::output::image",
				taskId: "task-retry-1",
			},
		})).resolves.toMatchObject({
			status: "failed",
			taskId: "task-retry-1",
		});
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});
});
