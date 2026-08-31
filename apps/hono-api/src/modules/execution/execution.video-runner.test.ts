import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getFlowForOwner: vi.fn(),
	reconcileVideoNodesForFlow: vi.fn(),
	generateVideoToCanvas: vi.fn(),
	resolveProjectBillingTeamId: vi.fn(),
	freshReadFlowRow: vi.fn(),
	persistFlowPatch: vi.fn(),
	generateAudioToCanvas: vi.fn(),
	resolveVideoModelReferenceAudioPolicy: vi.fn(),
}));

vi.mock("../flow/flow.repo", () => ({
	getFlowForOwner: mocks.getFlowForOwner,
}));

vi.mock("../task/agents-tool-bridge.generate-video-to-canvas", () => ({
	generateVideoToCanvas: mocks.generateVideoToCanvas,
	reconcileVideoNodesForFlow: mocks.reconcileVideoNodesForFlow,
}));

vi.mock("../task/agents-tool-bridge.billing-scope", () => ({
	resolveProjectBillingTeamId: mocks.resolveProjectBillingTeamId,
}));

vi.mock("../task/video-orchestrator.flow-io", () => ({
	freshReadFlowRow: mocks.freshReadFlowRow,
	persistFlowPatch: mocks.persistFlowPatch,
}));

vi.mock("../task/agents-tool-bridge.generate-audio-to-canvas", () => ({
	generateAudioToCanvas: mocks.generateAudioToCanvas,
}));

vi.mock("../task/video-orchestrator.generation-contract", () => ({
	resolveVideoModelReferenceAudioPolicy: mocks.resolveVideoModelReferenceAudioPolicy,
}));

import {
	buildBudgetedVoiceCalibrationText,
	assertWorkflowVoiceManifestAudioPolicy,
	inspectPersistedWorkflowVideoNode,
	prepareWorkflowVideoProductionAssets,
	runWorkflowVideoNode,
	workflowVideoEffectIdentity,
} from "./execution.video-runner";

function flowWithVideo(data: Record<string, unknown>): string {
	return JSON.stringify({
		nodes: [{ id: "video-output-1", type: "taskNode", data }],
		edges: [],
	});
}

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

const request = {
	executionId: "execution-1",
	executionFamilyId: "family-1",
	ownerId: "owner-1",
	flowId: "flow-1",
	projectId: "project-1",
	runtimeNodeId: "video-1",
	itemIndex: 0,
	prompt: "prompt",
	structuredClip: {
		durationSeconds: 30,
		logline: "剑修完成动作",
		assetObjectContracts: [{ kind: "character", name: "剑修", referenceImageNodeIds: ["image-hero"], referenceRole: "identity" }],
		shots: [{ shotNo: 1, visualTask: "看清动作", action: "剑修跨步出剑并承受反作用", durationSeconds: 30 }],
	},
	modelKey: "doubao-seedance-2.5",
	durationSeconds: 30,
	resolution: "480p",
	aspectRatio: "16:9",
	referenceImageNodeIds: ["image-hero", "image-forest"],
	referenceAssetIds: [],
	estimateIdentity: "estimate-1",
	previousEvidence: { canvasNodeId: "video-output-1", taskId: "provider-task-1" },
	resumeOnly: true,
} as const;

describe("workflow video runner durable effects", () => {
	beforeEach(() => {
		mocks.getFlowForOwner.mockReset();
		mocks.reconcileVideoNodesForFlow.mockReset();
		mocks.generateVideoToCanvas.mockReset();
		mocks.resolveProjectBillingTeamId.mockReset();
		mocks.freshReadFlowRow.mockReset();
		mocks.persistFlowPatch.mockReset();
		mocks.generateAudioToCanvas.mockReset();
		mocks.resolveVideoModelReferenceAudioPolicy.mockReset();
		mocks.freshReadFlowRow.mockImplementation(async () => mocks.getFlowForOwner());
	});
	it("derives one stable paid-effect identity per runtime item", () => {
		expect(workflowVideoEffectIdentity({
			executionFamilyId: "family-1",
			runtimeNodeId: "video-1::item::segment-1",
		})).toEqual({
			canvasNodeId: "video-1::item::segment-1::family::family-1::output::video",
			effectId: "family-1:video-1::item::segment-1:video-submit",
		});
	});

	it("does not invent a total reference-audio limit from the per-audio duration limit", () => {
		const entries = [
			{
				speakerName: "甲",
				voiceId: "voice-a",
				voiceLabel: "A",
				nodeId: "voice-card-a",
				audioUrl: "https://assets.example/a.mp3",
				audioDurationSec: 17.2,
			},
			{
				speakerName: "乙",
				voiceId: "voice-b",
				voiceLabel: "B",
				nodeId: "voice-card-b",
				audioUrl: "https://assets.example/b.mp3",
				audioDurationSec: 18.1,
			},
		] as const;
		expect(() => assertWorkflowVoiceManifestAudioPolicy(entries, {
			minimumDurationSeconds: 1.8,
			maximumDurationSeconds: 30.2,
		})).not.toThrow();
		expect(() => assertWorkflowVoiceManifestAudioPolicy(entries, {
			minimumDurationSeconds: 1.8,
			maximumDurationSeconds: 30.2,
			maximumTotalDurationSeconds: 30.2,
		})).toThrow("配音卡参考音频总时长 35.3s 超过模型合同 30.2s");
	});

	it("sizes calibration text from the live aggregate reference-audio budget", () => {
		const text = buildBudgetedVoiceCalibrationText({
			speakerCount: 2,
			audioPolicy: {
				minimumDurationSeconds: 1.8,
				maximumDurationSeconds: 15.2,
				maximumTotalDurationSeconds: 15.2,
			},
		});
		expect(Array.from(text)).toHaveLength(24);
		expect(text).toBe("山河清朗，风过竹林，灯火照归途，今日心绪沉静，言");
	});

	it("appends budgeted voice-card samples when the existing manifest exceeds an explicit total limit", async () => {
		const speakers = ["甲", "乙", "丙"] as const;
		const initialNodes = speakers.map((speakerName, index) => ({
			id: `existing-${index + 1}`,
			data: {
				audioType: "voice_card",
				voiceCharacter: speakerName,
				doubaoVoiceId: `voice-${index + 1}`,
				audioUrl: `https://assets.example/existing-${index + 1}.mp3`,
				audioDurationSec: 8.2,
				audioModel: "doubao-seed-audio-1-0",
			},
		}));
		mocks.resolveVideoModelReferenceAudioPolicy.mockResolvedValue({
			minimumDurationSeconds: 1.8,
			maximumDurationSeconds: 15.2,
			maximumTotalDurationSeconds: 15.2,
		});
		mocks.generateAudioToCanvas.mockImplementation(async (input: Readonly<{
			bodyArgs: Readonly<{ node: Readonly<{ id: string }> }>;
		}>) => ({
			ok: true as const,
			flowId: "flow-1",
			nodeId: input.bodyArgs.node.id,
			audioUrl: `https://assets.example/${input.bodyArgs.node.id}.mp3`,
			assetId: `asset-${input.bodyArgs.node.id}`,
			durationSec: 4,
			voiceId: "voice",
			audioType: "voice_card",
			voiceCharacter: "speaker",
		}));
		mocks.freshReadFlowRow.mockImplementation(async () => {
			const generatedNodes = mocks.generateAudioToCanvas.mock.calls.map(([input], index) => {
				const request = input as Readonly<{
					bodyArgs: Readonly<{
						node: Readonly<{
							id: string;
							data: Readonly<{ voiceCharacter: string; voiceId: string }>;
						}>;
					}>;
				}>;
				return {
					id: request.bodyArgs.node.id,
					data: {
						audioType: "voice_card",
						voiceCharacter: request.bodyArgs.node.data.voiceCharacter,
						doubaoVoiceId: request.bodyArgs.node.data.voiceId,
						audioUrl: `https://assets.example/budgeted-${index + 1}.mp3`,
						audioDurationSec: 4,
						audioModel: "doubao-seed-audio-1-0",
					},
				};
			});
			return flowRow({ nodes: [...initialNodes, ...generatedNodes], edges: [] });
		});

		const manifest = await prepareWorkflowVideoProductionAssets({} as never, {
			executionId: "execution-voice-budget",
			executionFamilyId: "family-voice-budget",
			runtimeNodeId: "voice-materialize",
			ownerId: "owner-1",
			flowId: "flow-1",
			projectId: null,
			speakerNames: speakers,
			modelKey: "doubao-seedance-2.0",
			voiceCatalog: {
				protocolVersion: "tapcanvas.voice-catalog/v1",
				speakers,
				existingBindings: [],
				catalog: [],
			},
			voicePlan: {
				protocolVersion: "tapcanvas.voice-plan/v1",
				entries: speakers.map((speakerName, index) => ({
					speakerName,
					voiceId: `voice-${index + 1}`,
					rationale: "冻结音色",
				})),
			},
		});

		expect(mocks.generateAudioToCanvas).toHaveBeenCalledTimes(3);
		expect(mocks.generateAudioToCanvas.mock.calls.map(([input]) => (
			(input as { bodyArgs: { node: { data: Record<string, unknown> } } }).bodyArgs.node.data.speed
		))).toEqual([2, 2, 2]);
		expect(mocks.generateAudioToCanvas.mock.calls.map(([input]) => Array.from(String(
			(input as { bodyArgs: { node: { data: Record<string, unknown> } } }).bodyArgs.node.data.text,
		)).length)).toEqual([16, 16, 16]);
		expect(manifest.entries.map((entry) => ({
			speakerName: entry.speakerName,
			audioDurationSec: entry.audioDurationSec,
			isBudgetedNode: entry.nodeId !== `existing-${speakers.indexOf(entry.speakerName as typeof speakers[number]) + 1}`,
		}))).toEqual([
			{ speakerName: "甲", audioDurationSec: 4, isBudgetedNode: true },
			{ speakerName: "乙", audioDurationSec: 4, isBudgetedNode: true },
			{ speakerName: "丙", audioDurationSec: 4, isBudgetedNode: true },
		]);
	});

	it("reuses the family-scoped paid effect when a recovery lost its local receipt", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "video-1::family::family-1::output::video",
				data: {
					kind: "video",
					status: "running",
					taskId: "provider-family-task-1",
					workflowEffectId: "family-1:video-1:video-submit",
				},
			}],
			edges: [],
		}));

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request,
			previousEvidence: null,
			resumeOnly: false,
		})).resolves.toMatchObject({
			status: "waiting_external",
			nodeId: "video-1::family::family-1::output::video",
			taskId: "provider-family-task-1",
			reused: true,
		});
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it.each(["queued", "running", "submitted", "submitting"])(
		"polls an accepted task in structural provider state %s by its persisted identities",
		(status) => {
			expect(inspectPersistedWorkflowVideoNode(
				flowWithVideo({ status, taskId: "provider-task-1" }),
				"video-output-1",
				"provider-task-1",
			)).toEqual({
				status: "waiting_external",
				nodeId: "video-output-1",
				taskId: "provider-task-1",
				reused: true,
			});
		},
	);

	it("accepts an immediate terminal asset even when the provider has no task id", () => {
		expect(inspectPersistedWorkflowVideoNode(
			flowWithVideo({ status: "success", videoUrl: "https://assets.example/video.mp4" }),
			"video-output-1",
			null,
		)).toMatchObject({
			status: "success",
			nodeId: "video-output-1",
			taskId: null,
			videoUrl: "https://assets.example/video.mp4",
			reused: true,
		});
	});

	it("fails a waiting node that lost its provider task identity", () => {
		expect(inspectPersistedWorkflowVideoNode(
			flowWithVideo({ status: "running" }),
			"video-output-1",
			null,
		)).toMatchObject({
			status: "failed",
			taskId: null,
			errorMessage: expect.stringContaining("without a provider task identity"),
		});
	});

	it("preserves the exact provider failure recorded by a legacy browser poller", () => {
		expect(inspectPersistedWorkflowVideoNode(
			flowWithVideo({
				status: "error",
				videoTaskId: "provider-task-copyright",
				lastError: "The output video may be related to copyright restrictions.",
				errorCode: "OutputVideoSensitiveContentDetected.PolicyViolation",
			}),
			"video-output-1",
			"provider-task-copyright",
		)).toMatchObject({
			status: "failed",
			taskId: "provider-task-copyright",
			errorMessage: "The output video may be related to copyright restrictions.",
			errorCode: "OutputVideoSensitiveContentDetected.PolicyViolation",
		});
	});

	it("keeps an accepted video task waiting when its canvas node is temporarily unavailable", () => {
		expect(inspectPersistedWorkflowVideoNode(
			JSON.stringify({ nodes: [], edges: [] }),
			"video-output-1",
			"provider-task-1",
		)).toEqual({
			status: "waiting_external",
			nodeId: "video-output-1",
			taskId: "provider-task-1",
			reused: true,
		});
		expect(inspectPersistedWorkflowVideoNode(
			JSON.stringify({ nodes: [], edges: [] }),
			"video-output-1",
			null,
		)).toMatchObject({
			status: "failed",
			taskId: null,
			errorMessage: expect.stringContaining("no persisted canvas node or accepted provider task identity"),
		});
	});

	it("reconciles an accepted provider task during the durable external check", async () => {
		mocks.getFlowForOwner
			.mockResolvedValueOnce(flowRow({
				nodes: [{ id: "video-output-1", data: { kind: "video", status: "submitting", taskId: "provider-task-1" } }],
				edges: [],
			}))
			.mockResolvedValueOnce(flowRow({
				nodes: [{
					id: "video-output-1",
					data: {
						kind: "video",
						status: "success",
						taskId: "provider-task-1",
						videoUrl: "https://assets.example/video.mp4",
					},
				}],
				edges: [],
			}));
		mocks.reconcileVideoNodesForFlow.mockResolvedValue({
			ok: true,
			reconciled: 1,
			failed: 0,
			stillRunning: 0,
			postersBackfilled: 0,
			posterBackfillFailed: 0,
			details: [{ nodeId: "video-output-1", taskId: "provider-task-1", status: "success" }],
		});

		await expect(runWorkflowVideoNode({ DB: {}, INTERNAL_WORKER_TOKEN: "internal" } as never, request)).resolves.toMatchObject({
			status: "success",
			nodeId: "video-output-1",
			taskId: "provider-task-1",
			videoUrl: "https://assets.example/video.mp4",
			reused: true,
		});
		expect(mocks.reconcileVideoNodesForFlow).toHaveBeenCalledTimes(1);
		expect(mocks.reconcileVideoNodesForFlow).toHaveBeenCalledWith(expect.objectContaining({
			target: { nodeId: "video-output-1", taskId: "provider-task-1" },
		}));
		expect(mocks.getFlowForOwner).toHaveBeenCalledTimes(2);
	});

	it("does not reconcile an already completed receipt", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "video-output-1",
				data: {
					kind: "video",
					status: "success",
					taskId: "provider-task-1",
					videoUrl: "https://assets.example/video.mp4",
				},
			}],
			edges: [],
		}));

		await expect(runWorkflowVideoNode({ DB: {} } as never, { ...request, resumeOnly: false })).resolves.toMatchObject({
			status: "success",
			videoUrl: "https://assets.example/video.mp4",
		});
		expect(mocks.reconcileVideoNodesForFlow).not.toHaveBeenCalled();
		expect(mocks.getFlowForOwner).toHaveBeenCalledTimes(1);
	});

	it("does not resubmit after an exact provider receipt is terminal failed", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "video-output-1",
				data: { kind: "video", status: "failed", taskId: "provider-task-1", errorMessage: "provider failed" },
			}],
			edges: [],
		}));
		await expect(runWorkflowVideoNode({ DB: {} } as never, request)).resolves.toMatchObject({
			status: "failed",
			taskId: "provider-task-1",
		});
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("preserves exact provider rejection evidence on a persisted failed node", () => {
		expect(inspectPersistedWorkflowVideoNode(
			flowWithVideo({
				status: "failed",
				errorCode: "ark_moderation_rejected",
				errorMessage: "内容审核未通过：1 个参考素材被拒",
				providerRejectedReferenceIds: ["asset-rejected"],
			}),
			"video-output-1",
			null,
		)).toMatchObject({
			status: "failed",
			errorCode: "ark_moderation_rejected",
			providerRejectedReferenceIds: ["asset-rejected"],
		});
	});

	it("does not resubmit a provider rejection that has no accepted task receipt", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: "video-output-1",
				data: {
					kind: "video",
					status: "failed",
					taskId: "",
					errorMessage: "request rejected before provider acceptance",
				},
			}],
			edges: [],
		}));
		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request,
			previousEvidence: { canvasNodeId: "video-output-1", taskId: "" },
		})).resolves.toMatchObject({
			status: "failed",
			taskId: "",
		});
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("creates a new family-scoped node for a fresh explicit execution", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [
				{
					id: "video-1::output::video",
					data: {
						kind: "video",
						status: "failed",
						taskId: "provider-original-failed",
						workflowEffectId: "family-1:video-1:video-submit",
					},
				},
			],
			edges: [],
		}));

		mocks.generateVideoToCanvas.mockResolvedValue({
			status: "running",
			nodeId: "video-1::family::family-1::output::video",
			taskId: "provider-fresh",
			reused: false,
		});
		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request,
			previousEvidence: null,
			resumeOnly: false,
		})).resolves.toMatchObject({
			status: "waiting_external",
			nodeId: "video-1::family::family-1::output::video",
			taskId: "provider-fresh",
		});
		expect(mocks.generateVideoToCanvas).toHaveBeenCalledTimes(1);
	});

	it("fresh-reads and re-persists a provider rejection after concurrent canvas writes", async () => {
		const identity = workflowVideoEffectIdentity(request);
		mocks.getFlowForOwner
			.mockResolvedValueOnce(flowRow({ nodes: [], edges: [] }))
			.mockResolvedValueOnce(flowRow({
				nodes: [{
					id: identity.canvasNodeId,
					data: {
						kind: "video",
						status: "submitting",
						workflowEffectId: identity.effectId,
						workflowSubmissionState: "submitting",
					},
				}],
				edges: [],
			}));
		const rejection = Object.assign(new Error("内容审核未通过：1 个参考素材被拒"), {
			code: "ark_moderation_rejected",
			providerRejectedReferenceIds: ["asset-rejected"],
			details: {
				upstreamData: {
					code: "ark_moderation_rejected",
					data: { rejected_urls: ["https://cdn.test/rejected.png?signature=provider"] },
				},
			},
		});
		mocks.generateVideoToCanvas.mockRejectedValue(rejection);
		mocks.persistFlowPatch.mockResolvedValue({ row: flowRow({ nodes: [], edges: [] }) });

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request,
			previousEvidence: null,
			resumeOnly: false,
		})).resolves.toMatchObject({
			status: "failed",
			errorCode: "ark_moderation_rejected",
			providerRejectedReferenceIds: ["asset-rejected"],
		});
		expect(mocks.persistFlowPatch).toHaveBeenCalledWith(expect.objectContaining({
			patch: {
				allowOverwrite: true,
				patchNodeData: [{
					id: identity.canvasNodeId,
					data: expect.objectContaining({
						status: "failed",
						workflowSubmissionState: "rejected_by_provider",
						providerRejectedReferenceIds: ["asset-rejected"],
					}),
				}],
			},
		}));
	});

	it("preserves an existing family-scoped terminal failure without another submission", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [
				{
					id: "video-1::family::family-1::output::video",
					data: {
						kind: "video",
						status: "failed",
						taskId: "",
						workflowEffectId: "family-1:video-1:video-submit",
						errorMessage: "provider rejected input",
					},
				},
			],
			edges: [],
		}));
		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request,
			previousEvidence: null,
			resumeOnly: false,
		})).resolves.toMatchObject({
			status: "failed",
			errorMessage: "provider rejected input",
		});
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("persists the structured Clip beside the clean execution prompt for final manifest rendering", async () => {
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [], edges: [] }));
		mocks.generateVideoToCanvas.mockResolvedValue({
			status: "running",
			nodeId: "video-1::family::family-1::output::video",
			taskId: "provider-task-2",
			reused: false,
		});

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request,
			previousEvidence: null,
			resumeOnly: false,
		})).resolves.toMatchObject({
			status: "waiting_external",
			taskId: "provider-task-2",
		});

		expect(mocks.generateVideoToCanvas).toHaveBeenCalledWith(expect.objectContaining({
			bodyArgs: {
				node: expect.objectContaining({
					data: expect.objectContaining({
						prompt: "prompt",
						workflowExecutionId: "execution-1",
						referenceAssetIds: [],
						shots: [{ shotNo: 1, visualTask: "看清动作", action: "剑修跨步出剑并承受反作用", durationSeconds: 30 }],
						assetObjectContracts: [{ kind: "character", name: "剑修", referenceImageNodeIds: ["image-hero"], referenceRole: "identity" }],
					}),
				}),
			},
		}));
	});
});
