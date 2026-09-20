import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getFlowForOwner: vi.fn(),
	reconcileReceipt: vi.fn(),
	reconcileImageNodesForFlow: vi.fn(),
	generateImageToCanvas: vi.fn(),
}));

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

	it("places the single-subject identity-board contract after shared project style text", () => {
		const prompt = composeWorkflowImagePrompt({
			prompt: "短黑发、蓝白电弧",
			stylePrompt: "两名超能力高中生在城市中持续战斗；高燃日漫风",
			assetMetadata: {
				referenceType: "character",
				roleName: "physical-student-a",
				characterAssetRole: "identity_anchor",
				characterProfileVersion: "character-card/v3",
			},
		});
		expect(prompt).toContain("两名超能力高中生在城市中持续战斗");
		expect(prompt).toContain("【单人角色身份板约束】");
		expect(prompt).toContain("四个信息区（正面脸、3/4脸、正面全身、背面全身）全部是同一角色的不同视角");
		expect(prompt).toContain("不得出现第二个人、其他人物、群像、分身");
		expect(prompt.lastIndexOf("【单人角色身份板约束】")).toBeGreaterThan(prompt.lastIndexOf("[项目统一视觉风格]"));
	});

	it("creates an explicitly authorized retry as a new effect and preserves the failed node", async () => {
		const authorizedRetry = { nodeId: "images", itemId: "one", taskId: "old-task", canvasNodeId: "old-node", retryKey: "receipt-bound-key" };
		const retryRequest = { ...request, runtimeNodeId: "images::item::one", authorizedRetry, previousEvidence: null, resumeOnly: false };
		const identity = workflowImageEffectIdentity(retryRequest);
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: "old-node", data: { status: "failed", taskId: "old-task" } }], edges: [] }));
		mocks.generateImageToCanvas.mockResolvedValue({ status: "running", nodeId: identity.canvasNodeId, taskId: "new-task" });
		await expect(runWorkflowImageNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({ taskId: "new-task", status: "waiting_external" });
		expect(mocks.generateImageToCanvas.mock.calls[0][0].bodyArgs.node.id).toBe(identity.canvasNodeId);
		expect(identity.canvasNodeId).not.toBe("old-node");
		expect(identity.effectId).toContain("receipt-bound-key");
	});

	it("refuses retry when the old receipt is now running or contains produced media", async () => {
		const authorizedRetry = { nodeId: "images", itemId: "one", taskId: "old-task", canvasNodeId: "old-node", retryKey: "key" };
		for (const data of [{ status: "running", taskId: "old-task" }, { status: "failed", taskId: "old-task", imageUrl: "https://assets.test/already.png" }]) {
			mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: "old-node", data }], edges: [] }));
			await expect(runWorkflowImageNode({ DB: {} } as never, { ...request, runtimeNodeId: "images::item::one", authorizedRetry, previousEvidence: null, resumeOnly: false })).rejects.toThrow("media_retry_failed_canvas_receipt_changed");
		}
		expect(mocks.generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("reconciles an already accepted retry instead of paying again", async () => {
		const authorizedRetry = { nodeId: "images", itemId: "one", taskId: "old-task", canvasNodeId: "old-node", retryKey: "key" };
		const retryRequest = { ...request, runtimeNodeId: "images::item::one", authorizedRetry, previousEvidence: null, resumeOnly: false };
		const identity = workflowImageEffectIdentity(retryRequest);
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [{ id: identity.canvasNodeId, data: {
			status: "running", taskId: "accepted-new", prompt: request.prompt, negativePrompt: request.negativePrompt,
			modelKey: request.modelKey, aspect: request.aspectRatio, imageSize: request.imageSize, referenceAssetBindings: [],
		} }], edges: [] }));
		await expect(runWorkflowImageNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({ status: "waiting_external", taskId: "accepted-new", reused: true });
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
