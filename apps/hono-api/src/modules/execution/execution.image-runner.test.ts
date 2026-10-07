import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getFlowForOwner: vi.fn(),
	reconcileReceipt: vi.fn(),
	reconcileImageNodesForFlow: vi.fn(),
	generateImageToCanvas: vi.fn(),
	getRegisteredTask: vi.fn(),
}));

vi.mock("../task/task-result.repo", () => ({ getTaskResultByTaskId: mocks.getRegisteredTask }));

vi.mock("./execution.media-receipt", () => ({ reconcileWorkflowMediaReceipt: mocks.reconcileReceipt }));

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
	composeWorkflowImagePrompt,
	inspectPersistedWorkflowImageNode,
	persistedWorkflowImageRequestMatches,
	runWorkflowImageNode,
	workflowImageEffectIdentity,
} from "./execution.image-runner";
import { buildWorkflowImageClaim, buildWorkflowImageTaskId } from "../task/workflow-image-effect-claim";

const request = {
	executionMode: "once" as const,
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
		mocks.reconcileReceipt.mockReset();
		mocks.reconcileImageNodesForFlow.mockReset();
		mocks.generateImageToCanvas.mockReset();
		mocks.getRegisteredTask.mockReset().mockResolvedValue(null);
	});

	it("supplies the task identity authorized by the workflow image effect", async () => {
		const freshRequest = { ...request, previousEvidence: null, resumeOnly: false };
		const identity = workflowImageEffectIdentity(freshRequest);
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [], edges: [] }));
		mocks.generateImageToCanvas.mockResolvedValue({
			status: "running",
			nodeId: identity.canvasNodeId,
			taskId: "provider-task-1",
		});

		await expect(runWorkflowImageNode({ DB: {} } as never, freshRequest)).resolves.toMatchObject({
			status: "waiting_external",
			nodeId: identity.canvasNodeId,
			taskId: "provider-task-1",
		});
		expect(mocks.generateImageToCanvas.mock.calls[0]?.[0].bodyArgs.node.data).toMatchObject({
			workflowEffectId: identity.effectId,
			workflowTaskId: buildWorkflowImageTaskId({ ownerId: freshRequest.ownerId, effectId: identity.effectId }),
		});
	});

	it("reuses a confirmed prior image receipt after the prompt composer changes", async () => {
		const previousNodeId = "image-1::family::family-1::output::image";
		const resumed = {
			...request,
			executionId: "execution-2",
			previousEvidence: { canvasNodeId: previousNodeId, taskId: "task-1" },
			assetMetadata: {
				referenceType: "character",
				characterAssetRole: "identity_anchor",
				characterProfileVersion: "character-card/v3",
			},
		};
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: previousNodeId, data: {
			status: "success", taskId: "task-1", imageUrl: "https://assets.test/confirmed.png",
			prompt: "prompt\n\n【单人角色身份板约束】旧版已受理请求",
		} }], edges: [] }));
		await expect(runWorkflowImageNode({ DB: {} } as never, resumed)).resolves.toMatchObject({
			status: "success", nodeId: previousNodeId, taskId: "task-1",
			imageUrl: "https://assets.test/confirmed.png",
		});
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("uses a frozen retry budget once, confirms the task, and reuses its stable retry after replay", async () => {
		const originalRequest = { ...request, executionMode: "each" as const, runtimeNodeId: "images::item::one", previousEvidence: null, resumeOnly: false,
			mediaDeliveryPolicy: { version: 1 as const, maxRetries: 1 as const, exhausted: "deliver_successes" as const } };
		const original = workflowImageEffectIdentity(originalRequest);
		const failedData = { status: "failed", taskId: "old-task", prompt: request.prompt,
			negativePrompt: request.negativePrompt, modelKey: request.modelKey, aspect: request.aspectRatio,
			imageSize: request.imageSize, referenceAssetBindings: [] };
		const nodes: Array<{id:string;data:Record<string,unknown>}> = [{ id: original.canvasNodeId, data: failedData }];
		mocks.getFlowForOwner.mockImplementation(async () => flowRow({nodes,edges:[]}));
		mocks.reconcileReceipt.mockResolvedValue({status:"failed",nodeId:original.canvasNodeId,taskId:"old-task",errorMessage:"provider failure"});
		mocks.generateImageToCanvas.mockImplementation(async (input: {bodyArgs:{node:{id:string;data:Record<string,unknown>}}}) => {
			nodes.push({id:input.bodyArgs.node.id,data:{...input.bodyArgs.node.data,status:"running",taskId:"retry-task"}});
			return {status:"running",nodeId:input.bodyArgs.node.id,taskId:"retry-task"};
		});
		const first = await runWorkflowImageNode({DB:{}} as never,originalRequest);
		expect(first).toMatchObject({status:"waiting_external",taskId:"retry-task"});
		const replay = await runWorkflowImageNode({DB:{}} as never,originalRequest);
		expect(replay).toMatchObject({status:"waiting_external",taskId:"retry-task",nodeId:first.nodeId});
		expect(mocks.generateImageToCanvas).toHaveBeenCalledTimes(1);
		expect(nodes[0]?.data).toEqual(failedData);
		nodes[1]!.data.status = "failed";
		const exhausted = await runWorkflowImageNode({DB:{}} as never,{...originalRequest,resumeOnly:true,
			previousEvidence:{canvasNodeId:first.nodeId,taskId:"retry-task"}});
		expect(exhausted.status).toBe("failed");
		expect(mocks.generateImageToCanvas).toHaveBeenCalledTimes(1);
	});

	it("does not submit an automatic retry when the frozen budget is zero", async () => {
		const configured = { ...request, previousEvidence: null, resumeOnly: false,
			mediaDeliveryPolicy: { version: 1 as const, maxRetries: 0 as const, exhausted: "deliver_successes" as const } };
		const identity = workflowImageEffectIdentity(configured);
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: identity.canvasNodeId, data: {
			status: "failed", taskId: "failed-task", prompt: request.prompt, negativePrompt: request.negativePrompt,
			modelKey: request.modelKey, aspect: request.aspectRatio, imageSize: request.imageSize, referenceAssetBindings: [],
		} }], edges: [] }));
		expect((await runWorkflowImageNode({ DB: {} } as never, configured)).status).toBe("failed");
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it.each(["waiting_external", "success"] as const)("does not retry a stale failed projection when task reconciliation is %s", async status => {
		const configured = {...request,runtimeNodeId:"images::item::one",previousEvidence:null,resumeOnly:false,
			mediaDeliveryPolicy:{version:1 as const,maxRetries:1 as const,exhausted:"deliver_successes" as const}};
		const original = workflowImageEffectIdentity(configured);
		mocks.getFlowForOwner.mockResolvedValue(flowRow({nodes:[{id:original.canvasNodeId,data:{
			status:"failed",taskId:"original",prompt:request.prompt,negativePrompt:request.negativePrompt,
			modelKey:request.modelKey,aspect:request.aspectRatio,imageSize:request.imageSize,referenceAssetBindings:[],
		}}],edges:[]}));
		mocks.reconcileReceipt.mockResolvedValue({status,nodeId:original.canvasNodeId,taskId:"original",
			...(status === "success" ? {imageUrl:"https://assets.test/original.png",assetId:"original-asset"} : {}),reused:true});
		expect((await runWorkflowImageNode({DB:{}} as never,configured)).status).toBe(status);
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("preserves the authored character subject when composing the shared style", () => {
		const prompt = composeWorkflowImagePrompt({
			prompt: "二十余名候考学生，四个视角保持同一批人",
			stylePrompt: "两名超能力高中生在城市中持续战斗；高燃日漫风",
			assetMetadata: {
				referenceType: "character",
				roleName: "候考学生群体",
				characterAssetRole: "identity_anchor",
				characterProfileVersion: "character-card/v3",
			},
		});
		expect(prompt).toContain("二十余名候考学生，四个视角保持同一批人");
		expect(prompt).toContain("两名超能力高中生在城市中持续战斗");
		expect(prompt).not.toContain("【单人角色身份板约束】");
	});

	it("creates an explicitly authorized retry as a new effect and preserves the failed node", async () => {
		const authorizedRetry = { executorRef: "tapcanvas.image.generate/v1" as const, executionMode: "each" as const, nodeId: "images", itemId: "one", taskId: "old-task", canvasNodeId: "old-node", retryKey: "receipt-bound-key" };
		const retryRequest = { ...request, executionMode: "each" as const, runtimeNodeId: "images::item::one", authorizedRetry, previousEvidence: null, resumeOnly: false };
		const identity = workflowImageEffectIdentity(retryRequest);
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: "old-node", data: { status: "failed", taskId: "old-task" } }], edges: [] }));
		mocks.reconcileReceipt.mockResolvedValue({ status: "failed", nodeId: "old-node", taskId: "old-task", errorMessage: "confirmed provider failure" });
		mocks.generateImageToCanvas.mockResolvedValue({ status: "running", nodeId: identity.canvasNodeId, taskId: "new-task" });
		await expect(runWorkflowImageNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({ taskId: "new-task", status: "waiting_external" });
		expect(mocks.generateImageToCanvas.mock.calls[0][0].bodyArgs.node.id).toBe(identity.canvasNodeId);
		expect(identity.canvasNodeId).not.toBe("old-node");
		expect(identity.effectId).toContain("receipt-bound-key");
	});

	it("retries an itemless once image from node-level receipt evidence despite the previous failed evidence", async () => {
		const authorizedRetry = {
			executorRef: "tapcanvas.image.generate/v1" as const,
			executionMode: "once" as const,
			nodeId: "image-once", itemId: null, taskId: "old-task",
			canvasNodeId: "old-once-image", retryKey: "once-receipt-bound-key",
		};
		const retryRequest = {
			...request,
			runtimeNodeId: "image-once",
			executionMode: "once" as const,
			previousEvidence: { canvasNodeId: "old-once-image", taskId: "old-task" },
			resumeOnly: true,
			authorizedRetry,
		};
		const identity = workflowImageEffectIdentity(retryRequest);
		const retryNodeData = {
			status: "running", taskId: "new-once-task", prompt: composeWorkflowImagePrompt(retryRequest),
			negativePrompt: retryRequest.negativePrompt, modelKey: retryRequest.modelKey,
			aspect: retryRequest.aspectRatio, imageSize: retryRequest.imageSize,
			imageQuality: "", referenceAssetBindings: [], styleImages: [], stylePrompt: "", styleFingerprint: "",
		};
		let saved = flowRow({ nodes: [{ id: "old-once-image", data: { status: "failed", taskId: "old-task" } }], edges: [] });
		mocks.getFlowForOwner.mockImplementation(async () => saved);
		mocks.reconcileReceipt.mockResolvedValue({ status: "failed", nodeId: "old-once-image", taskId: "old-task", errorMessage: "confirmed provider failure" });
		mocks.generateImageToCanvas.mockImplementation(async () => {
			saved = flowRow({ nodes: [
				{ id: "old-once-image", data: { status: "failed", taskId: "old-task" } },
				{ id: identity.canvasNodeId, data: retryNodeData },
			], edges: [] });
			return { status: "running", nodeId: identity.canvasNodeId, taskId: "new-once-task" };
		});
		await expect(runWorkflowImageNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: identity.canvasNodeId, taskId: "new-once-task",
		});
		await expect(runWorkflowImageNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: identity.canvasNodeId, taskId: "new-once-task", reused: true,
		});
		expect(mocks.generateImageToCanvas).toHaveBeenCalledTimes(1);
		expect(saved.data).toContain("old-once-image");
	});

	it("refuses retry when the old receipt is now running or contains produced media", async () => {
		const authorizedRetry = { executorRef: "tapcanvas.image.generate/v1" as const, executionMode: "each" as const, nodeId: "images", itemId: "one", taskId: "old-task", canvasNodeId: "old-node", retryKey: "key" };
		for (const data of [{ status: "running", taskId: "old-task" }, { status: "failed", taskId: "old-task", imageUrl: "https://assets.test/already.png" }]) {
			mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: "old-node", data }], edges: [] }));
			await expect(runWorkflowImageNode({ DB: {} } as never, { ...request, executionMode: "each" as const, runtimeNodeId: "images::item::one", authorizedRetry, previousEvidence: null, resumeOnly: false })).rejects.toThrow("media_retry_failed_canvas_receipt_changed");
		}
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("reconciles an already accepted retry instead of paying again", async () => {
		const authorizedRetry = { executorRef: "tapcanvas.image.generate/v1" as const, executionMode: "each" as const, nodeId: "images", itemId: "one", taskId: "old-task", canvasNodeId: "old-node", retryKey: "key" };
		const retryRequest = { ...request, executionMode: "each" as const, runtimeNodeId: "images::item::one", authorizedRetry, previousEvidence: null, resumeOnly: false };
		const identity = workflowImageEffectIdentity(retryRequest);
		mocks.reconcileReceipt.mockResolvedValue({ status: "failed", nodeId: "old-node", taskId: "old-task", errorMessage: "confirmed provider failure" });
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [
			{ id: "old-node", data: { status: "failed", taskId: "old-task" } },
			{ id: identity.canvasNodeId, data: {
				status: "running", taskId: "accepted-new", prompt: composeWorkflowImagePrompt(retryRequest), negativePrompt: request.negativePrompt,
				modelKey: request.modelKey, aspect: request.aspectRatio, imageSize: request.imageSize, imageQuality: "",
				referenceAssetBindings: [], styleImages: [], stylePrompt: "", styleFingerprint: "",
			} },
		], edges: [] }));
		await expect(runWorkflowImageNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({ status: "waiting_external", taskId: "accepted-new", reused: true });
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("waits on the exact source image receipt when its provider state is still unknown", async () => {
		const authorizedRetry = { executorRef: "tapcanvas.image.generate/v1" as const, executionMode: "each" as const,
			nodeId: "images", itemId: "one", taskId: "old-task", canvasNodeId: "old-node", retryKey: "unknown-state-key" };
		const retryRequest = { ...request, executionMode: "each" as const, runtimeNodeId: "images::item::one",
			authorizedRetry, previousEvidence: { canvasNodeId: "old-node", taskId: "old-task" }, resumeOnly: true };
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: "old-node", data: { status: "failed", taskId: "old-task" } }], edges: [] }));
		mocks.reconcileReceipt.mockResolvedValue({ status: "waiting_external", nodeId: "old-node", taskId: "old-task", reused: true,
			observationFailure: { observedAt: "2026-09-23T00:00:00.000Z", message: "provider receipt query timed out" } });
		await expect(runWorkflowImageNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: "old-node", taskId: "old-task",
		});
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("does not add character-card isolation text to non-character image assets", () => {
		const prompt = composeWorkflowImagePrompt({
			prompt: "雨后商业街",
			stylePrompt: "日漫风",
			assetMetadata: { referenceType: "scene", sceneName: "商业街" },
		});
		expect(prompt).not.toContain("【单人角色身份板约束】");
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
		const assetMetadata = {
			referenceType: "character",
			roleName: "刘秀",
			characterAssetRole: "identity_anchor",
			characterProfileVersion: "character-card/v3",
			identityAnchors: ["清瘦脸型", "青色道袍"],
			prohibitedDrift: ["不得改变脸型、发型和年龄感"],
		} as const;
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "image-1::family::family-1::output::image",
				data: {
					kind: "image",
					status: "running",
					taskId: "provider-family-image-1",
					prompt: composeWorkflowImagePrompt({ prompt: "prompt", assetMetadata }),
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
			assetMetadata,
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
		expect(persistedWorkflowImageRequestMatches({
			prompt: "same prompt", negativePrompt: "same negative", modelKey: "gpt-image-2",
			aspect: "16:9", imageSize: "2K", referenceAssetBindings: [],
			sceneCard: { lighting: { direction: "left", quality: "soft" }, occupancy: "none" },
		}, { ...request, referenceAssetBindings: [], assetMetadata: {
			sceneCard: { occupancy: "none", lighting: { quality: "soft", direction: "left" } },
		} })).toBe(true);
	});

	it("submits a prepared image exactly once after a checkpoint with no accepted task", async () => {
		const resumed = { ...request, previousEvidence: null, resumeOnly: true };
		const identity = workflowImageEffectIdentity(resumed);
		const plannedTaskId = buildWorkflowImageTaskId({ ownerId: resumed.ownerId, effectId: identity.effectId });
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: identity.canvasNodeId, data: {
			kind: "image", status: "idle", workflowPreparedOnly: true,
			workflowEffectId: identity.effectId, workflowTaskId: plannedTaskId,
			prompt: resumed.prompt, negativePrompt: resumed.negativePrompt,
			modelKey: resumed.modelKey, aspect: resumed.aspectRatio,
			imageSize: resumed.imageSize, referenceAssetBindings: [],
		} }], edges: [] }));
		mocks.generateImageToCanvas.mockResolvedValue({
			status: "running", nodeId: identity.canvasNodeId, taskId: "accepted-task",
		});
		await expect(runWorkflowImageNode({ DB: {} } as never, {
			...resumed, previousEvidence: { canvasNodeId: identity.canvasNodeId, taskId: null },
		})).resolves.toMatchObject({ status: "waiting_external", taskId: "accepted-task" });
		expect(mocks.getRegisteredTask).toHaveBeenCalledWith(expect.anything(), resumed.ownerId, plannedTaskId);
		expect(mocks.generateImageToCanvas).toHaveBeenCalledTimes(1);
	});

	it("reconciles a registered prepared-image task instead of submitting it again", async () => {
		const resumed = { ...request, previousEvidence: null, resumeOnly: true };
		const identity = workflowImageEffectIdentity(resumed);
		const plannedTaskId = buildWorkflowImageTaskId({ ownerId: resumed.ownerId, effectId: identity.effectId });
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: identity.canvasNodeId, data: {
			kind: "image", status: "idle", workflowPreparedOnly: true,
			workflowEffectId: identity.effectId, workflowTaskId: plannedTaskId,
			prompt: resumed.prompt, negativePrompt: resumed.negativePrompt,
			modelKey: resumed.modelKey, aspect: resumed.aspectRatio,
			imageSize: resumed.imageSize, referenceAssetBindings: [],
		} }], edges: [] }));
		mocks.getRegisteredTask.mockResolvedValue({ id: plannedTaskId });
		mocks.reconcileReceipt.mockResolvedValue({
			status: "waiting_external", nodeId: identity.canvasNodeId, taskId: plannedTaskId, reused: true,
		});
		await expect(runWorkflowImageNode({ DB: {} } as never, {
			...resumed, previousEvidence: { canvasNodeId: identity.canvasNodeId, taskId: null },
		})).resolves.toMatchObject({ status: "waiting_external", taskId: plannedTaskId });
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
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

it('adopts an owner-scoped registered task after a crash before the canvas acceptance write', async () => {
  const fresh = { ...request, previousEvidence: null, resumeOnly: false, assetIdentity: { assetId: 'shared', generationSpecVersion: 'v1' } };
  const identity = workflowImageEffectIdentity(fresh);
  const taskId = buildWorkflowImageTaskId({ ownerId: request.ownerId, effectId: identity.effectId });
  const data = { status: 'submitting', workflowSubmissionState: 'submitting', workflowEffectId: identity.effectId,
    workflowTaskId: taskId, prompt: request.prompt, negativePrompt: request.negativePrompt,
    modelKey: request.modelKey, aspect: request.aspectRatio, imageSize: request.imageSize, referenceAssetBindings: [] };
  mocks.generateImageToCanvas.mockReset();
  mocks.getFlowForOwner.mockReset().mockResolvedValue(flowRow({ nodes: [{ id: identity.canvasNodeId, data }], edges: [] }));
  mocks.getRegisteredTask.mockReset().mockResolvedValue({ task_id: taskId });
  mocks.reconcileReceipt.mockResolvedValue({ status: 'success', nodeId: identity.canvasNodeId, taskId, reused: true,
    imageUrl: 'https://media.example/shared.png', assetId: 'real-asset' });
  const results = await Promise.all(['clip-a', 'clip-b'].map(runtimeNodeId => runWorkflowImageNode({ DB: {} } as never,
    { ...fresh, runtimeNodeId, resumeOnly: true, previousEvidence: { canvasNodeId: identity.canvasNodeId } })));
  expect(results.every(result => result.status === 'success' && result.taskId === taskId)).toBe(true);
  expect(mocks.getRegisteredTask).toHaveBeenCalledWith({}, request.ownerId, taskId);
  expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
  mocks.getRegisteredTask.mockResolvedValue(null);
  await expect(runWorkflowImageNode({ DB: {} } as never, fresh)).resolves.toMatchObject({ status: 'waiting_external', taskId: null });
  expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
});


it("recovers a missing projection through the accepted receipt without resubmission", async () => {
	mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [], edges: [] }));
	mocks.generateImageToCanvas.mockClear();
	mocks.reconcileImageNodesForFlow.mockClear();
	mocks.reconcileReceipt.mockResolvedValue({ status: "success", nodeId: request.previousEvidence.canvasNodeId, taskId: request.previousEvidence.taskId,
		imageUrl: "https://assets.test/result", assetId: "asset", reused: true });
	expect(await runWorkflowImageNode({ DB: {} } as never, request)).toMatchObject({ status: "success", imageUrl: "https://assets.test/result" });
	expect(mocks.reconcileReceipt).toHaveBeenCalledWith(expect.anything(), request.ownerId, request.previousEvidence.canvasNodeId, request.previousEvidence.taskId, "image");
	expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	expect(mocks.reconcileImageNodesForFlow).not.toHaveBeenCalled();
});

it('uses the asset specification identity across different producer steps and reuses accepted receipts', async () => {
  const assetIdentity = {assetId:'shared-image',generationSpecVersion:'spec-v1'};
  const first = {...request,assetIdentity,runtimeNodeId:'step-a::item::shared',previousEvidence:null,resumeOnly:false};
  const next = {...first,runtimeNodeId:'step-b::item::shared'};
  const identity=workflowImageEffectIdentity(first);
  expect(workflowImageEffectIdentity(next)).toEqual(identity);
  expect(workflowImageEffectIdentity({...next,assetIdentity:{...assetIdentity,generationSpecVersion:'spec-v2'}})).not.toEqual(identity);
  mocks.generateImageToCanvas.mockReset();
  mocks.getFlowForOwner.mockResolvedValue(flowRow({nodes:[{id:identity.canvasNodeId,data:{
    status:'running',taskId:'accepted-paid-task',prompt:request.prompt,negativePrompt:request.negativePrompt,
    modelKey:request.modelKey,aspect:request.aspectRatio,imageSize:request.imageSize,referenceAssetBindings:[],
  }}],edges:[]}));
  const results = await Promise.all([first,next].map(item=>runWorkflowImageNode({DB:{}} as never,item)));
  expect(results).toEqual([expect.objectContaining({taskId:'accepted-paid-task',reused:true}),expect.objectContaining({taskId:'accepted-paid-task',reused:true})]);
  expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
});

it("submits one stable shared image effect for concurrent independent Clip pipelines", async () => {
	const clipIds = ["clip-0", "clip-1"] as const;
	const assetIdentity = { assetId: "chapter-object:character-main:generate", generationSpecVersion: "chapter-object-plan/v1" };
	const shared = {
		...request,
		executionMode: "each" as const,
		projectId: null,
		assetIdentity,
		previousEvidence: null,
		resumeOnly: false,
	};
	const requests = clipIds.map((clipId, itemIndex) => ({
		...shared,
		executionId: `execution-${clipId}`,
		runtimeNodeId: `clip-media-pipeline::item::${clipId}::step::clip-asset-image-generate`,
		itemIndex,
	}));
	const identity = workflowImageEffectIdentity(requests[0]!);
	expect(workflowImageEffectIdentity(requests[1]!)).toEqual(identity);
	const graph: { nodes: Array<{ id: string; data: Record<string, unknown> }>; edges: unknown[] } = { nodes: [], edges: [] };
	let initialReadCount = 0;
	let releaseInitialReads: () => void = () => undefined;
	const initialReadsReady = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
	mocks.getFlowForOwner.mockImplementation(async () => {
		const snapshot = flowRow(structuredClone({ nodes: graph.nodes, edges: graph.edges }));
		if (initialReadCount < requests.length) {
			initialReadCount += 1;
			if (initialReadCount === requests.length) releaseInitialReads();
			await initialReadsReady;
		}
		return snapshot;
	});
	let providerAcceptances = 0;
	mocks.generateImageToCanvas.mockImplementation(async (input) => {
		const args = input as { bodyArgs: { node: { id: string; data: Record<string, unknown> } } };
		const node = args.bodyArgs.node;
		const effectId = node.data.workflowEffectId;
		if (typeof effectId !== "string") throw new Error("Workflow image effect ID is missing");
		const claim = buildWorkflowImageClaim({
			current: graph,
			node,
			nodeId: node.id,
			effectId,
			claimedAt: String(node.data.workflowRuntimeNodeId),
		});
		if (!("createNodes" in claim) || !claim.createNodes?.length) throw new Error("Expected the winning first image claim");
		graph.nodes.push(...claim.createNodes.map((claimed) => ({
			id: String(claimed.id),
			data: claimed.data as Record<string, unknown>,
		})));
		providerAcceptances += 1;
		const taskId = "provider-shared-image-task";
		const claimedNode = graph.nodes.find((candidate) => candidate.id === node.id);
		if (!claimedNode) throw new Error("Durable image claim disappeared before provider acceptance");
		claimedNode.data = { ...claimedNode.data, status: "running", taskId, workflowSubmissionState: "accepted" };
		return { status: "running", nodeId: node.id, taskId };
	});

	const waiting = await Promise.all(requests.map((item) => runWorkflowImageNode({ DB: {} } as never, item)));
	expect(waiting).toHaveLength(clipIds.length);
	expect(waiting.every((result) => result.status === "waiting_external"
		&& result.nodeId === identity.canvasNodeId && result.taskId === "provider-shared-image-task")).toBe(true);
	expect(providerAcceptances).toBe(1);
	expect(graph.nodes).toHaveLength(1);
	expect(graph.nodes[0]).toMatchObject({ id: identity.canvasNodeId, data: {
		workflowEffectId: identity.effectId,
		workflowTaskId: buildWorkflowImageTaskId({ ownerId: shared.ownerId, effectId: identity.effectId }),
		taskId: "provider-shared-image-task",
		status: "running",
	} });

	graph.nodes[0]!.data = {
		...graph.nodes[0]!.data,
		status: "success",
		imageUrl: "https://assets.example/shared-character.png",
		assetId: "shared-character-asset",
	};
	const consumers = await Promise.all(requests.map((item) => runWorkflowImageNode({ DB: {} } as never, {
		...item,
		previousEvidence: { canvasNodeId: identity.canvasNodeId, taskId: "provider-shared-image-task" },
		resumeOnly: true,
	})));
	expect(consumers.map((result) => result.status)).toEqual(["success", "success"]);
	expect(consumers.every((result) => result.status === "success"
		&& result.nodeId === identity.canvasNodeId
		&& result.imageUrl === "https://assets.example/shared-character.png")).toBe(true);
	expect(providerAcceptances).toBe(1);
});

it('waits on a competing durable claim until its receipt arrives without another submission', async () => {
  const fresh = {...request,previousEvidence:null,resumeOnly:false,assetIdentity:{assetId:'shared',generationSpecVersion:'v1'}};
  const identity = workflowImageEffectIdentity(fresh);
  const data = {status:'submitting',workflowSubmissionState:'submitting',workflowEffectId:identity.effectId,
    prompt:request.prompt,negativePrompt:request.negativePrompt,modelKey:request.modelKey,aspect:request.aspectRatio,
    imageSize:request.imageSize,referenceAssetBindings:[]};
  mocks.getFlowForOwner.mockReset(); mocks.generateImageToCanvas.mockReset();
  mocks.getFlowForOwner.mockResolvedValueOnce(flowRow({nodes:[],edges:[]}))
    .mockResolvedValue(flowRow({nodes:[{id:identity.canvasNodeId,data}],edges:[]}));
  mocks.generateImageToCanvas.mockRejectedValue(Object.assign(new Error('already claimed'),{code:'workflow_image_effect_already_claimed'}));
  const waiting = await runWorkflowImageNode({DB:{}} as never,fresh);
  expect(waiting).toEqual({status:'waiting_external',nodeId:identity.canvasNodeId,taskId:null,reused:true});
  mocks.generateImageToCanvas.mockReset();
  await expect(runWorkflowImageNode({DB:{}} as never,{...fresh,resumeOnly:true,previousEvidence:{canvasNodeId:identity.canvasNodeId}}))
    .resolves.toEqual(waiting);
  expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
  mocks.getFlowForOwner.mockResolvedValue(flowRow({nodes:[{id:identity.canvasNodeId,data:{...data,status:'running',taskId:'accepted'}}],edges:[]}));
  await expect(runWorkflowImageNode({DB:{}} as never,{...fresh,resumeOnly:true,previousEvidence:{canvasNodeId:identity.canvasNodeId}}))
    .resolves.toMatchObject({status:'waiting_external',taskId:'accepted',reused:true});
});
