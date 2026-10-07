import type { WorkerEnv } from "../../types";
import { buildStoredVideoRetryNode } from "../task/canvas-video-retry";
import { buildWorkflowVideoEffectV2Identity, type WorkflowVideoRetryAuthorization } from "../task/workflow-video-effect-claim";
import { AppError } from "../../middleware/error";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getFlowForOwner: vi.fn(),
    retryCanvasVideo: vi.fn(),
	reconcileReceipt: vi.fn(),
	reconcileVideoNodesForFlow: vi.fn(),
	generateVideoToCanvas: vi.fn(),
	resolveProjectBillingTeamId: vi.fn(),
	freshReadFlowRow: vi.fn(),
	persistFlowPatch: vi.fn(),
	generateAudioToCanvas: vi.fn(),
	resolveVideoModelReferenceAudioPolicy: vi.fn(),
	resolveExecutionImageReferences: vi.fn(),
}));

vi.mock("../task/canvas-video-retry", async () => ({
  ...await vi.importActual<typeof import("../task/canvas-video-retry")>("../task/canvas-video-retry"),
  retryCanvasVideo: mocks.retryCanvasVideo,
}));

vi.mock("./execution.media-receipt", () => ({ reconcileWorkflowMediaReceipt: mocks.reconcileReceipt }));

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

vi.mock("../task/agents-tool-bridge.image-reference-ids", () => ({
	resolveExecutionImageReferences: mocks.resolveExecutionImageReferences,
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
	inspectPersistedWorkflowVideoAttempt,
	prepareWorkflowVideoProductionAssets,
	runWorkflowVideoNode,
	prepareWorkflowVideoNode,
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
	executionMode: "once" as const,
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
        mocks.retryCanvasVideo.mockReset();
		mocks.reconcileReceipt.mockReset();
		mocks.reconcileVideoNodesForFlow.mockReset();
		mocks.generateVideoToCanvas.mockReset();
		mocks.resolveProjectBillingTeamId.mockReset();
		mocks.freshReadFlowRow.mockReset();
		mocks.persistFlowPatch.mockReset();
		mocks.generateAudioToCanvas.mockReset();
		mocks.resolveVideoModelReferenceAudioPolicy.mockReset();
		mocks.resolveExecutionImageReferences.mockReset();
		mocks.freshReadFlowRow.mockImplementation(async () => mocks.getFlowForOwner());
	});
	it("persists a manually generatable node, reads it back and replays without provider submission", async () => {
		mocks.resolveExecutionImageReferences.mockResolvedValue([
			{ referenceId: "node:image-hero", source: "node", nodeId: "image-hero", assetId: null, assetRefId: "hero-ref", name: "剑修", url: "https://fixture.invalid/hero.png", previewOnly: false },
			{ referenceId: "node:image-forest", source: "node", nodeId: "image-forest", assetId: null, assetRefId: "forest-ref", name: "林地", url: "https://fixture.invalid/forest.png", previewOnly: false },
		]);
		let saved = flowRow({ nodes: [], edges: [] });
		mocks.freshReadFlowRow.mockImplementation(async () => saved);
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: { createNodes: unknown[] } }) => {
			saved = flowRow({ nodes: input.patch.createNodes, edges: [] });
		});
		const requestWithFirstFrame = { ...request, firstFrameUrl: "https://assets.example/opening-frame.png" };
		const first = await prepareWorkflowVideoNode({} as WorkerEnv, requestWithFirstFrame);
		expect(first).toMatchObject({ persisted: true, promptPersisted: true,
			imageDependencies: [
				{ referenceId: "node:image-hero", url: "https://fixture.invalid/hero.png" },
				{ referenceId: "node:image-forest", url: "https://fixture.invalid/forest.png" },
			] });
		expect(await prepareWorkflowVideoNode({} as WorkerEnv, requestWithFirstFrame)).toEqual(first);
		expect(mocks.persistFlowPatch).toHaveBeenCalledTimes(1);
		expect(mocks.persistFlowPatch.mock.calls[0]?.[0].patch.createNodes[0].data).toMatchObject({
			status: "idle", referenceImageNodeIds: request.referenceImageNodeIds,
			firstFrameUrl: "https://assets.example/opening-frame.png",
			videoModel: request.modelKey, videoDurationSeconds: 30, clipIndex: 0,
		});
		const persistedPrompt = mocks.persistFlowPatch.mock.calls[0]?.[0].patch.createNodes[0].data.prompt as string;
		expect(persistedPrompt).toContain("剑修（identity）：@hero-ref");
		expect(persistedPrompt).toContain("镜头1（0-30s）：剑修跨步出剑并承受反作用");
		expect(persistedPrompt).not.toContain("看清动作");
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("hydrates a planned Clip in place with real references and preserves its prompt and first-frame lineage", async () => {
		const clipRequest = { ...request, structuredClip: null, clipId: "clip-1", resumeOnly: false,
			promptSourceProtocol: "tapcanvas.clip-production-packets/v2" as const,
			videoInputMode: "image_to_video" as const, referenceImageNodeIds: ["image-hero"],
			firstFrameUrl: "https://fixture.invalid/hero.png" };
		const identity = workflowVideoEffectIdentity(clipRequest);
		const initial = { id: identity.canvasNodeId, type: "taskNode", position: { x: 560, y: 480 }, data: {
			kind: "video", label: "Clip 1", status: "idle", workflowPreparedOnly: true,
			prompt: "prompt", workflowVideoInputMode: "image_to_video", modelKey: request.modelKey,
			videoModel: request.modelKey, videoDurationSeconds: 30, videoResolution: "480p", aspectRatio: "16:9",
			referenceImageNodeIds: ["image-hero"], referenceAssetIds: [], firstFrameFromNodeId: "image-hero",
			workflowEffectId: identity.effectId, workflowExecutionFamilyId: "family-1", workflowClipId: "clip-1",
			workflowPromptSourceProtocol: "tapcanvas.clip-production-packets/v2",
		} };
		let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } = {
			nodes: [initial, { id: "image-hero", data: { kind: "image", status: "success", imageUrl: clipRequest.firstFrameUrl } }], edges: [],
		};
		mocks.freshReadFlowRow.mockImplementation(async () => flowRow(graph));
		mocks.resolveExecutionImageReferences.mockResolvedValue([
			{ referenceId: "node:image-hero", source: "node", nodeId: "image-hero", assetId: null,
				assetRefId: "hero-ref", name: "剑修", url: clipRequest.firstFrameUrl, previewOnly: false },
		]);
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: {
			patchNodeData?: Array<{ id: string; data: Record<string, unknown> }>;
			createEdges?: Array<Record<string, unknown>>;
		} }) => {
			graph = { nodes: graph.nodes.map((node) => {
				const patch = input.patch.patchNodeData?.find((item) => item.id === node.id);
				return patch ? { ...node, data: { ...(node.data as Record<string, unknown>), ...patch.data } } : node;
			}), edges: [...graph.edges, ...(input.patch.createEdges ?? [])] };
		});
		const receipt = await prepareWorkflowVideoNode({} as WorkerEnv, clipRequest);
		expect(await prepareWorkflowVideoNode({} as WorkerEnv, clipRequest)).toEqual(receipt);
		expect(receipt).toMatchObject({ nodeId: initial.id, persisted: true, promptPersisted: true,
			imageDependencies: [{ referenceId: "node:image-hero", url: clipRequest.firstFrameUrl }] });
		expect(graph.nodes).toHaveLength(2);
		expect(graph.nodes[0]).toMatchObject({ id: initial.id, position: initial.position, data: {
			prompt: "prompt", status: "idle", firstFrameFromNodeId: "image-hero", firstFrameUrl: clipRequest.firstFrameUrl,
			assetInputs: [{ url: clipRequest.firstFrameUrl, assetRefId: "hero-ref" }],
		} });
		expect(mocks.persistFlowPatch).toHaveBeenCalledTimes(1);
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("prepares a text-to-video Clip with no fabricated image dependencies", async () => {
		let saved = flowRow({ nodes: [], edges: [] });
		mocks.resolveExecutionImageReferences.mockResolvedValue([]);
		mocks.freshReadFlowRow.mockImplementation(async () => saved);
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: { createNodes: unknown[] } }) => {
			saved = flowRow({ nodes: input.patch.createNodes, edges: [] });
		});
		const receipt = await prepareWorkflowVideoNode({} as WorkerEnv, { ...request, structuredClip: null,
			videoInputMode: "text_to_video", referenceImageNodeIds: [], referenceAssetIds: [] });
		expect(receipt).toMatchObject({ persisted: true, promptPersisted: true, imageDependencies: [] });
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("persists visible station and reference topology for a prepared video prompt node", async () => {
		mocks.resolveExecutionImageReferences.mockResolvedValue([
			{ referenceId: "node:image-hero", source: "node", nodeId: "image-hero", assetId: null, assetRefId: "hero-ref", name: "剑修", url: "https://fixture.invalid/hero.png", previewOnly: false },
			{ referenceId: "node:image-forest", source: "node", nodeId: "image-forest", assetId: null, assetRefId: "forest-ref", name: "林地", url: "https://fixture.invalid/forest.png", previewOnly: false },
		]);
		let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } = {
			nodes: [
				{ id: "image-hero", data: { kind: "image", imageUrl: "https://fixture.invalid/hero.png" } },
				{ id: "image-forest", data: { kind: "image", imageUrl: "https://fixture.invalid/forest.png" } },
				{ id: "blocking-clip-1", data: { kind: "image", imageUrl: "https://fixture.invalid/blocking.png", productionLayer: "blocking_diagram" } },
			],
			edges: [],
		};
		mocks.freshReadFlowRow.mockImplementation(async () => flowRow(graph));
		mocks.persistFlowPatch.mockImplementation(async (input: {
			patch: { createNodes?: Array<Record<string, unknown>>; createEdges?: Array<Record<string, unknown>> };
		}) => {
			graph = {
				nodes: [...graph.nodes, ...(input.patch.createNodes ?? [])],
				edges: [...graph.edges, ...(input.patch.createEdges ?? [])],
			};
		});

		const result = await prepareWorkflowVideoNode({} as never, {
			...request,
			structuredClip: { ...request.structuredClip, blockingFrameNodeId: "blocking-clip-1", spatialBlocking: true },
		});

		expect(result.nodeId).toContain("::output::video");
		expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
			["image-hero", result.nodeId],
			["image-forest", result.nodeId],
			["blocking-clip-1", result.nodeId],
		]);
		expect(graph.edges.every((edge) => edge.targetHandle === "in-any")).toBe(true);
	});
	it("derives one stable paid-effect identity per runtime item", () => {
		expect(workflowVideoEffectIdentity({
			executionFamilyId: "family-1",
			runtimeNodeId: "video-1::item::segment-1",
		})).toEqual({
			canvasNodeId: "video-1::item::segment-1::family::family-1::output::video",
			clipId: null,
			effectId: "family-1:video-1::item::segment-1:video-submit",
		});
	});

	it("shares one output and effect identity across different runtime nodes for a frozen clip", () => {
		const first = workflowVideoEffectIdentity({
			executionFamilyId: "family-1",
			runtimeNodeId: "opening-video",
			structuredClip: { clipId: "chapter-hash:clip:0" },
		});
		const later = workflowVideoEffectIdentity({
			executionFamilyId: "family-1",
			runtimeNodeId: "full-video",
			structuredClip: { clipId: "chapter-hash:clip:0" },
		});

		expect(first).toEqual(later);
		expect(first).toMatchObject({ effectId: "family-1:video.generate:chapter-hash%3Aclip%3A0", clipId: "chapter-hash:clip:0" });
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

	it.each(["rejected_pre_upstream", "uncertain"])("retries only a proven unaccepted submission: %s", async (state) => {
		const nodeId = "video-1::family::family-1::output::video";
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{ id: nodeId, data: { kind: "video", status: "failed", workflowSubmissionState: state,
				workflowEffectId: "family-1:video-1:video-submit" } }], edges: [],
		}));
		mocks.generateVideoToCanvas.mockResolvedValue({ status: "running", nodeId, taskId: "accepted-retry" });
		const result = await runWorkflowVideoNode({ DB: {} } as never, {
			...request, previousEvidence: { canvasNodeId: nodeId, taskId: null }, resumeOnly: false,
		});
		expect(mocks.generateVideoToCanvas).toHaveBeenCalledTimes(state === "rejected_pre_upstream" ? 1 : 0);
		expect(result.status).toBe(state === "rejected_pre_upstream" ? "waiting_external" : "failed");
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

	it("preserves the exact persisted provider acceptance time during recovery", () => {
		expect(inspectPersistedWorkflowVideoNode(
			flowWithVideo({ status: "running", taskId: "provider-task-1", workflowSubmissionAcceptedAt: "2026-09-07T01:02:03.000Z" }),
			"video-output-1", "provider-task-1",
		)).toMatchObject({ taskId: "provider-task-1", providerAcceptedAt: "2026-09-07T01:02:03.000Z", status: "waiting_external" });
	});

	it.each(["pending", "awaiting_late_result"])("uses current typed %s receipt ahead of a stale failure projection", (disposition) => {
		const data = { kind: "video", status: "failed", taskId: "accepted", videoTaskId: "accepted",
			workflowExecutionId: "execution", workflowRuntimeNodeId: "submit", workflowEffectId: "effect",
			videoReceiptRecovery: { disposition }, errorMessage: "original timeout" };
		expect(inspectPersistedWorkflowVideoNode(flowWithVideo(data), "video-output-1", "accepted"))
			.toMatchObject({ status: "waiting_external", taskId: "accepted", reused: true });
		expect(data.errorMessage).toBe("original timeout");
	});

	it.each(["terminal", "action_failed"])("preserves a typed %s provider failure", (disposition) => {
		expect(inspectPersistedWorkflowVideoNode(flowWithVideo({ kind: "video", status: "failed", taskId: "accepted",
			workflowExecutionId: "execution", workflowRuntimeNodeId: "submit", workflowEffectId: "effect",
			videoReceiptRecovery: { disposition }, errorMessage: "provider failure" }), "video-output-1", "accepted"))
			.toMatchObject({ status: "failed", taskId: "accepted", errorMessage: "provider failure" });
	});

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

	it("reconciles an accepted v2 clip receipt without recomputing or resubmitting its provider request", async () => {
		const clipRequest = {
			...request,
			structuredClip: { ...request.structuredClip, clipId: "frozen-source:clip:0" },
			previousEvidence: null,
			resumeOnly: false,
		};
		const identity = workflowVideoEffectIdentity(clipRequest);
		const taskId = "accepted-v2-provider-task";
		mocks.getFlowForOwner.mockResolvedValue(flowRow({
			nodes: [{
				id: identity.canvasNodeId,
				data: {
					kind: "video",
					status: "running",
					taskId,
					workflowEffectId: identity.effectId,
					workflowClipId: identity.clipId,
					workflowExecutionFamilyId: clipRequest.executionFamilyId,
					workflowEffectFingerprint: "persisted-provider-request-fingerprint",
					workflowSubmissionState: "accepted",
				},
			}],
			edges: [],
		}));
		mocks.reconcileVideoNodesForFlow.mockResolvedValue({
			details: [{ nodeId: identity.canvasNodeId, taskId, status: "running" }],
		});

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...clipRequest,
			previousEvidence: { canvasNodeId: identity.canvasNodeId, taskId },
			resumeOnly: true,
		})).resolves.toMatchObject({
			status: "waiting_external",
			nodeId: identity.canvasNodeId,
			taskId,
			reused: true,
		});
		expect(mocks.reconcileVideoNodesForFlow).toHaveBeenCalledWith(expect.objectContaining({
			target: { nodeId: identity.canvasNodeId, taskId },
		}));
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("rejects a v2 task receipt when its canvas effect binding is missing", async () => {
		const clipRequest = {
			...request,
			structuredClip: { ...request.structuredClip, clipId: "frozen-source:clip:0" },
			previousEvidence: null,
			resumeOnly: false,
		};
		const identity = workflowVideoEffectIdentity(clipRequest);
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [], edges: [] }));

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...clipRequest,
			previousEvidence: { canvasNodeId: identity.canvasNodeId, taskId: "unbound-task" },
			resumeOnly: true,
		})).rejects.toMatchObject({ code: "workflow_video_resume_projection_missing" });
		expect(mocks.reconcileReceipt).not.toHaveBeenCalled();
		expect(mocks.reconcileVideoNodesForFlow).not.toHaveBeenCalled();
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	});

	it("refuses a v2 external resume without an exact node and task receipt", async () => {
		const clipRequest = {
			...request,
			structuredClip: { ...request.structuredClip, clipId: "frozen-source:clip:0" },
			previousEvidence: null,
			resumeOnly: true,
		};
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [], edges: [] }));

		await expect(runWorkflowVideoNode({ DB: {} } as never, clipRequest))
			.rejects.toMatchObject({ code: "workflow_video_resume_receipt_incomplete" });
		expect(mocks.reconcileReceipt).not.toHaveBeenCalled();
		expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
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
		const frameEvidence = {
			sourceEventCoverage: [{ storyEventIndex: 0, shotNos: [1] }],
			temporalFrameTrack: [{ windowIndex: 0, startSeconds: 0, endSeconds: 0.25, startState: "移动", transition: "接触", carryState: "偏转" }],
			temporalFrameCoverage: [{ windowIndex: 0, shotNos: [1] }],
		};
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [], edges: [] }));
		mocks.generateVideoToCanvas.mockResolvedValue({
			status: "running",
			nodeId: "video-1::family::family-1::output::video",
			taskId: "provider-task-2",
			reused: false,
		});

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request,
			structuredClip: { ...request.structuredClip, ...frameEvidence },
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
						...frameEvidence,
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


describe("workflow observes explicitly authorized stored video retries", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.reconcileVideoNodesForFlow.mockResolvedValue({}); });
  it("reconciles the retry task identity without paying again during family recovery", async () => {
    const source = { id: "original", data: { kind: "video", status: "failed", taskId: "old-task" } };
    const retry = buildStoredVideoRetryNode(source, "flow-1", 1);
    retry.data = { ...retry.data, status: "running", taskId: "retry-task" };
    mocks.freshReadFlowRow.mockResolvedValue(flowRow({ nodes: [source, retry], edges: [] }));
    const result = await runWorkflowVideoNode({ DB: {} } as never, { ...request,
      resumeOnly: true, previousEvidence: { canvasNodeId: source.id, taskId: "old-task" } });
    expect(result).toMatchObject({ status: "waiting_external", nodeId: retry.id, taskId: "retry-task" });
    expect(mocks.reconcileVideoNodesForFlow).toHaveBeenCalledWith(expect.objectContaining({ target: { nodeId: retry.id, taskId: "retry-task" } }));
    expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
  });
  it("uses the accepted retry receipt and then its real asset without overwriting the failed source", () => {
    const source = { id: "original", data: { kind: "video", status: "failed", taskId: "failed-task", prompt: "persisted prompt" } };
    const retry = buildStoredVideoRetryNode(source, "flow-1", 1);
    const running = { ...retry, data: { ...retry.data, status: "running", taskId: "retry-task" } };
    expect(inspectPersistedWorkflowVideoAttempt(JSON.stringify({ nodes: [source, running] }), source.id, "failed-task", "flow-1"))
      .toMatchObject({ status: "waiting_external", nodeId: retry.id, taskId: "retry-task" });
    const completed = { ...running, data: { ...running.data, status: "success", videoUrl: "https://assets.example/retry.mp4" } };
    expect(inspectPersistedWorkflowVideoAttempt(JSON.stringify({ nodes: [source, completed] }), source.id, "failed-task", "flow-1"))
      .toMatchObject({ status: "success", nodeId: retry.id, taskId: "retry-task", videoUrl: "https://assets.example/retry.mp4" });
    expect(source.data.status).toBe("failed");
  });
  it("cannot adopt an arbitrary node merely claiming the original id", () => {
    const source = { id: "original", data: { kind: "video", status: "failed", taskId: "failed-task" } };
    const unrelated = { id: "unrelated", data: { kind: "video", status: "success", videoUrl: "https://assets.example/other.mp4", videoRetrySourceNodeId: source.id, videoRetryIndex: 1 } };
    expect(inspectPersistedWorkflowVideoAttempt(JSON.stringify({ nodes: [source, unrelated] }), source.id, "failed-task", "flow-1").status).toBe("failed");
  });
});


it("recovers a missing projection through the accepted receipt without resubmission", async () => {
	mocks.freshReadFlowRow.mockResolvedValue(flowRow({ nodes: [], edges: [] }));
	mocks.generateVideoToCanvas.mockClear();
	mocks.reconcileVideoNodesForFlow.mockClear();
	mocks.reconcileReceipt.mockResolvedValue({ status: "success", nodeId: request.previousEvidence.canvasNodeId, taskId: request.previousEvidence.taskId,
		videoUrl: "https://assets.test/result", assetId: "asset", reused: true });
	expect(await runWorkflowVideoNode({ DB: {} } as never, request)).toMatchObject({ status: "success", videoUrl: "https://assets.test/result" });
	expect(mocks.reconcileReceipt).toHaveBeenCalledWith(expect.anything(), request.ownerId, request.previousEvidence.canvasNodeId, request.previousEvidence.taskId, "video");
	expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
	expect(mocks.reconcileVideoNodesForFlow).not.toHaveBeenCalled();
});

describe("workflow explicit one-retry policy", () => {
 it("does not submit an automatic retry when the frozen budget is zero", async () => {
  const previousFreshRead = mocks.freshReadFlowRow.getMockImplementation();
  const previousReconcile = mocks.reconcileReceipt.getMockImplementation();
  try {
  mocks.retryCanvasVideo.mockReset();
  const failedFlow=flowRow({nodes:[{id:"video-output-1",data:{kind:"video",status:"failed",taskId:"failed-task"}}],edges:[]});
  mocks.getFlowForOwner.mockResolvedValue(failedFlow);
  mocks.freshReadFlowRow.mockResolvedValue(failedFlow);
  mocks.reconcileReceipt.mockResolvedValue({status:"failed",nodeId:"video-output-1",taskId:"failed-task",errorMessage:"provider failed"});
  const result = await runWorkflowVideoNode({DB:{}} as never, {...request,
   previousEvidence:{canvasNodeId:"video-output-1",taskId:"failed-task"},
   mediaDeliveryPolicy:{version:1,maxRetries:0,exhausted:"deliver_successes"}});
  expect(result.status).toBe("failed");
  expect(mocks.retryCanvasVideo).not.toHaveBeenCalled();
  } finally {
   mocks.freshReadFlowRow.mockReset();
   mocks.reconcileReceipt.mockReset();
   if (previousFreshRead) mocks.freshReadFlowRow.mockImplementation(previousFreshRead);
   if (previousReconcile) mocks.reconcileReceipt.mockImplementation(previousReconcile);
  }
 });
 it("reuses successful source and does not pay again", async () => {
  mocks.retryCanvasVideo.mockReset();
  mocks.getFlowForOwner.mockResolvedValue(flowRow({nodes:[{id:"video-output-1",data:{kind:"video",status:"success",taskId:"original",videoUrl:"https://assets.test/original.mp4"}}],edges:[]}));
  const result = await runWorkflowVideoNode({DB:{}} as never, {...request, mediaDeliveryPolicy:{version:1,maxRetries:1,exhausted:"deliver_successes"}});
  expect(result.status).toBe("success"); expect(mocks.retryCanvasVideo).not.toHaveBeenCalled();
 });
 it("submits retry index one and observes that receipt without a second retry", async () => {
  mocks.retryCanvasVideo.mockReset();
  const source={id:"video-output-1",data:{kind:"video",status:"failed",taskId:"original"}};
  const retry=buildStoredVideoRetryNode(source,"flow-1",1);
  let saved=flowRow({nodes:[source],edges:[]});
  mocks.getFlowForOwner.mockImplementation(async()=>saved);
  mocks.freshReadFlowRow.mockImplementation(async()=>saved);
  mocks.retryCanvasVideo.mockImplementation(async()=>{
    saved=flowRow({nodes:[source,{...retry,data:{...retry.data,status:"failed",taskId:"retry-task"}}],edges:[]});
    return {nodeId:retry.id,taskId:"retry-task",status:"failed"};
  });
  const configured={...request,mediaDeliveryPolicy:{version:1,maxRetries:1,exhausted:"deliver_successes"} as const};
  expect((await runWorkflowVideoNode({DB:{}} as never,configured)).status).toBe("failed");
  expect((await runWorkflowVideoNode({DB:{}} as never,configured)).status).toBe("failed");
  expect(mocks.retryCanvasVideo).toHaveBeenCalledTimes(1);
  expect(mocks.retryCanvasVideo.mock.calls[0]?.[0].bodyArgs).toMatchObject({nodeId:source.id,retryIndex:1});
 });
});

describe("workflow authorized video item retries", () => {
	beforeEach(() => {
		mocks.getFlowForOwner.mockReset();
		mocks.retryCanvasVideo.mockReset();
		mocks.reconcileReceipt.mockReset();
		mocks.reconcileVideoNodesForFlow.mockReset();
		mocks.generateVideoToCanvas.mockReset();
		mocks.freshReadFlowRow.mockReset();
		mocks.freshReadFlowRow.mockImplementation(async () => mocks.getFlowForOwner());
		mocks.reconcileVideoNodesForFlow.mockResolvedValue({ details: [] });
	});

	it("uses stable retry index two after the automatic index one and never overwrites the failed attempt", async () => {
		const source = { id: "video-source", data: { kind: "video", status: "failed", taskId: "original-task", prompt: "frozen prompt" } };
		const retryOne = buildStoredVideoRetryNode(source, "flow-1", 1);
		retryOne.data = { ...retryOne.data, status: "failed", taskId: "automatic-retry-task" };
		const retryTwo = buildStoredVideoRetryNode(source, "flow-1", 2);
		let saved = flowRow({ nodes: [source, retryOne], edges: [] });
		mocks.getFlowForOwner.mockImplementation(async () => saved);
		mocks.freshReadFlowRow.mockImplementation(async () => saved);
		mocks.retryCanvasVideo.mockImplementation(async (input: { bodyArgs: { idempotencyKey: string } }) => {
			saved = flowRow({ nodes: [source, retryOne, { ...retryTwo, data: { ...retryTwo.data, status: "running", taskId: "manual-retry-task", videoRetryIdempotencyKey: input.bodyArgs.idempotencyKey } }], edges: [] });
			return { status: "running", nodeId: retryTwo.id, taskId: "manual-retry-task", idempotencyKey: input.bodyArgs.idempotencyKey };
		});
		const authorizedRetry = {
			executorRef: "tapcanvas.video.generate/v1" as const,
			executionMode: "each" as const,
			nodeId: "video-1",
			itemId: "clip-1",
			taskId: "automatic-retry-task",
			canvasNodeId: retryOne.id,
			retryKey: "a".repeat(64),
		};
		const retryRequest = {
			...request,
			executionMode: "each" as const,
			runtimeNodeId: "video-1::item::clip-1",
			previousEvidence: { canvasNodeId: retryOne.id, taskId: "automatic-retry-task" },
			resumeOnly: true,
			authorizedRetry,
		};

		await expect(runWorkflowVideoNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: retryTwo.id, taskId: "manual-retry-task",
		});
		await expect(runWorkflowVideoNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: retryTwo.id, taskId: "manual-retry-task",
		});
		expect(mocks.retryCanvasVideo).toHaveBeenCalledTimes(2);
		expect(mocks.retryCanvasVideo.mock.calls.map(([input]) => input.bodyArgs)).toEqual([
			expect.objectContaining({ nodeId: source.id, retryIndex: 2 }),
			expect.objectContaining({ nodeId: source.id, retryIndex: 2 }),
		]);
		expect(mocks.retryCanvasVideo.mock.calls[0]?.[0].bodyArgs.idempotencyKey)
			.toBe(mocks.retryCanvasVideo.mock.calls[1]?.[0].bodyArgs.idempotencyKey);
		expect(source.data.status).toBe("failed");
		expect(retryOne.data.status).toBe("failed");
	});

	it("continues beyond local attempt two with a stable identity and preserves earlier attempts", async () => {
		const source = { id: "video-source", data: { kind: "video", status: "failed", taskId: "original-task", prompt: "frozen prompt" } };
		const retryOne = buildStoredVideoRetryNode(source, "flow-1", 1);
		retryOne.data = { ...retryOne.data, status: "failed", taskId: "automatic-retry-task" };
		const retryTwo = buildStoredVideoRetryNode(source, "flow-1", 2);
		retryTwo.data = { ...retryTwo.data, status: "failed", taskId: "manual-retry-task-2" };
		const retryThree = buildStoredVideoRetryNode(source, "flow-1", 3);
		let saved = flowRow({ nodes: [source, retryOne, retryTwo], edges: [] });
		mocks.getFlowForOwner.mockImplementation(async () => saved);
		mocks.freshReadFlowRow.mockImplementation(async () => saved);
		mocks.retryCanvasVideo.mockImplementation(async (input: { bodyArgs: { idempotencyKey: string } }) => {
				saved = flowRow({ nodes: [source, retryOne, retryTwo,
					{ ...retryThree, data: { ...retryThree.data, status: "running", taskId: "manual-retry-task-3", videoRetryIdempotencyKey: input.bodyArgs.idempotencyKey } }], edges: [] });
			return { status: "running", nodeId: retryThree.id, taskId: "manual-retry-task-3", idempotencyKey: input.bodyArgs.idempotencyKey };
		});
		const retryRequest = {
			...request,
			executionMode: "each" as const,
			runtimeNodeId: "video-1::item::clip-1",
			resumeOnly: true,
			authorizedRetry: {
				executorRef: "tapcanvas.video.generate/v1" as const,
				executionMode: "each" as const,
				nodeId: "video-1", itemId: "clip-1", taskId: "manual-retry-task-2",
				canvasNodeId: retryTwo.id, retryKey: "e".repeat(64),
			},
		};

		await expect(runWorkflowVideoNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: retryThree.id, taskId: "manual-retry-task-3",
		});
		await expect(runWorkflowVideoNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: retryThree.id, taskId: "manual-retry-task-3",
		});
		expect(mocks.retryCanvasVideo).toHaveBeenCalledTimes(2);
		expect(mocks.retryCanvasVideo.mock.calls.map(([input]) => input.bodyArgs)).toEqual([
			expect.objectContaining({ nodeId: source.id, retryIndex: 3 }),
			expect.objectContaining({ nodeId: source.id, retryIndex: 3 }),
		]);
		expect(mocks.retryCanvasVideo.mock.calls[0]?.[0].bodyArgs.idempotencyKey)
			.toBe(mocks.retryCanvasVideo.mock.calls[1]?.[0].bodyArgs.idempotencyKey);
		expect(source.data.status).toBe("failed");
		expect(retryOne.data.status).toBe("failed");
		expect(retryTwo.data.status).toBe("failed");
	});

	it("retries an itemless once video from node-level evidence and reuses its accepted receipt", async () => {
		const source = { id: "video-once-canvas", data: { kind: "video", status: "failed", taskId: "old-once-task", prompt: "frozen prompt" } };
		const retryOne = buildStoredVideoRetryNode(source, "flow-1", 1);
		let saved = flowRow({ nodes: [source], edges: [] });
		mocks.getFlowForOwner.mockImplementation(async () => saved);
		mocks.freshReadFlowRow.mockImplementation(async () => saved);
		mocks.retryCanvasVideo.mockImplementation(async (input: { bodyArgs: { idempotencyKey: string } }) => {
			saved = flowRow({ nodes: [source, { ...retryOne, data: {
				...retryOne.data, status: "running", taskId: "new-once-task", videoRetryIdempotencyKey: input.bodyArgs.idempotencyKey,
			} }], edges: [] });
			return { status: "running", nodeId: retryOne.id, taskId: "new-once-task" };
		});
		const retryRequest = {
			...request,
			executionMode: "once" as const,
			runtimeNodeId: "video-once",
			previousEvidence: { canvasNodeId: source.id, taskId: "old-once-task" },
			resumeOnly: true,
			authorizedRetry: {
				executorRef: "tapcanvas.video.generate/v1" as const,
				executionMode: "once" as const,
				nodeId: "video-once", itemId: null, taskId: "old-once-task",
				canvasNodeId: source.id, retryKey: "f".repeat(64),
			},
		};

		await expect(runWorkflowVideoNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: retryOne.id, taskId: "new-once-task",
		});
		await expect(runWorkflowVideoNode({ DB: {} } as never, retryRequest)).resolves.toMatchObject({
			status: "waiting_external", nodeId: retryOne.id, taskId: "new-once-task",
		});
		expect(mocks.retryCanvasVideo).toHaveBeenCalledTimes(2);
		expect(mocks.retryCanvasVideo.mock.calls.map(([input]) => input.bodyArgs)).toEqual([
			expect.objectContaining({ nodeId: source.id, retryIndex: 1 }),
			expect.objectContaining({ nodeId: source.id, retryIndex: 1 }),
		]);
		expect(mocks.retryCanvasVideo.mock.calls[0]?.[0].bodyArgs.idempotencyKey)
			.toBe(mocks.retryCanvasVideo.mock.calls[1]?.[0].bodyArgs.idempotencyKey);
	});

	it("allows a null task id only for a persisted pre-upstream rejection and spends index one", async () => {
		const source = { id: "video-source", data: { kind: "video", status: "failed", taskId: "", workflowSubmissionState: "rejected_pre_upstream" } };
		const retryOne = buildStoredVideoRetryNode(source, "flow-1", 1);
		let saved = flowRow({ nodes: [source], edges: [] });
		mocks.getFlowForOwner.mockImplementation(async () => saved);
		mocks.freshReadFlowRow.mockImplementation(async () => saved);
		mocks.retryCanvasVideo.mockImplementation(async () => {
			saved = flowRow({ nodes: [source, { ...retryOne, data: { ...retryOne.data, status: "running", taskId: "real-retry-task" } }], edges: [] });
			return { status: "running", nodeId: retryOne.id, taskId: "real-retry-task" };
		});
		const authorizedRetry = {
			executorRef: "tapcanvas.video.generate/v1" as const,
			executionMode: "each" as const,
			nodeId: "video-1", itemId: "clip-1", taskId: null, canvasNodeId: source.id, retryKey: "b".repeat(64),
		};

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request, executionMode: "each" as const, runtimeNodeId: "video-1::item::clip-1", previousEvidence: { canvasNodeId: source.id, taskId: null },
			resumeOnly: true, authorizedRetry,
		})).resolves.toMatchObject({ status: "waiting_external", taskId: "real-retry-task" });
		expect(mocks.retryCanvasVideo).toHaveBeenCalledWith(expect.objectContaining({
			bodyArgs: expect.objectContaining({ nodeId: source.id, retryIndex: 1 }),
		}));
	});

	it("retries an exact failed item receipt while the prepared V2 source is still idle", async () => {
		const clipId = "clip:0";
		const identity = buildWorkflowVideoEffectV2Identity({ executionFamilyId: "family-1", clipId });
		const source = { id: identity.canvasNodeId, data: {
			kind: "video", status: "idle", workflowPreparedOnly: true,
			workflowExecutionFamilyId: "family-1", workflowClipId: clipId,
			workflowEffectOperation: "video.generate", workflowEffectId: identity.effectId,
		} };
		const retryKey = "b".repeat(64);
		const runtimeNodeId = `video-1::item::${clipId}`;
		let saved = flowRow({ nodes: [source], edges: [] });
		mocks.getFlowForOwner.mockImplementation(async () => saved);
		mocks.freshReadFlowRow.mockImplementation(async () => saved);
		mocks.retryCanvasVideo.mockImplementation(async (input: { bodyArgs: { idempotencyKey: string }; workflowRetryAuthorization: WorkflowVideoRetryAuthorization }) => {
			const retry = buildStoredVideoRetryNode(source, "flow-1", input.workflowRetryAuthorization.retryIndex, input.workflowRetryAuthorization);
			saved = flowRow({ nodes: [source, { ...retry, data: { ...retry.data, status: "running", taskId: "provider-retry-task", videoRetryIdempotencyKey: input.bodyArgs.idempotencyKey } }], edges: [] });
			return { status: "running", nodeId: retry.id, taskId: "provider-retry-task" };
		});

		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request, executionMode: "each" as const, runtimeNodeId,
			previousEvidence: { canvasNodeId: source.id, taskId: null }, resumeOnly: true,
			authorizedRetry: {
				executorRef: "tapcanvas.video.generate/v1" as const,
				executionMode: "each" as const, nodeId: "video-1", itemId: clipId,
				taskId: null, canvasNodeId: source.id, retryKey,
			},
		})).resolves.toMatchObject({ status: "waiting_external", taskId: "provider-retry-task" });
		expect(mocks.retryCanvasVideo).toHaveBeenCalledWith(expect.objectContaining({
			bodyArgs: expect.objectContaining({ nodeId: source.id, retryIndex: 1 }),
			workflowRetryAuthorization: expect.objectContaining({
				executionId: "execution-1", runtimeNodeId, sourceCanvasNodeId: source.id,
				failedCanvasNodeId: source.id, failedTaskId: null, retryKey,
				preUpstreamRejected: true, retryIndex: 1,
			}),
		}));
		expect(source.data.status).toBe("idle");
	});

	it("does not retry an uncertain receipt without a task id or a node that already has media", async () => {
		const uncertain = { id: "video-source", data: { kind: "video", status: "failed", taskId: "", workflowSubmissionState: "uncertain" } };
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [uncertain], edges: [] }));
		const authorizedRetry = {
			executorRef: "tapcanvas.video.generate/v1" as const,
			executionMode: "each" as const,
			nodeId: "video-1", itemId: "clip-1", taskId: null, canvasNodeId: uncertain.id, retryKey: "c".repeat(64),
		};
		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request, executionMode: "each" as const, runtimeNodeId: "video-1::item::clip-1", previousEvidence: { canvasNodeId: uncertain.id, taskId: null },
			resumeOnly: true, authorizedRetry,
		})).rejects.toMatchObject({ code: "video_retry_submission_uncertain" });

		const withAsset = { id: "video-source", data: { kind: "video", status: "failed", taskId: "failed-task", videoUrl: "https://assets.example/already.mp4" } };
		mocks.getFlowForOwner.mockResolvedValue(flowRow({ nodes: [withAsset], edges: [] }));
		await expect(runWorkflowVideoNode({ DB: {} } as never, {
			...request, executionMode: "each" as const, runtimeNodeId: "video-1::item::clip-1", previousEvidence: { canvasNodeId: withAsset.id, taskId: "failed-task" },
			resumeOnly: true, authorizedRetry: { ...authorizedRetry, taskId: "failed-task", canvasNodeId: withAsset.id, retryKey: "d".repeat(64) },
		})).rejects.toMatchObject({ code: "media_retry_asset_already_present" });
		expect(mocks.retryCanvasVideo).not.toHaveBeenCalled();
	});
});


describe("one-retry policy submission boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("keeps an uncertain accepted receipt waiting without declaring the clip exhausted", async () => {
    const source = { id: "video-output-1", data: { kind: "video", status: "failed", taskId: "original" } };
    const saved = flowRow({ nodes: [source], edges: [] });
    mocks.getFlowForOwner.mockResolvedValue(saved);
    mocks.freshReadFlowRow.mockResolvedValue(saved);
    mocks.retryCanvasVideo.mockResolvedValue({ status: "awaiting_receipt_confirmation", nodeId: source.id, taskId: "original" });
    const result = await runWorkflowVideoNode({ DB: {} } as never, { ...request,
      mediaDeliveryPolicy: { version: 1, maxRetries: 1, exhausted: "deliver_successes" } });
    expect(result).toMatchObject({ status: "waiting_external", taskId: "original" });
    expect(mocks.generateVideoToCanvas).not.toHaveBeenCalled();
  });
  it("applies the same retry policy to a confirmed initial submission failure", async () => {
    const nodeId = "video-1::family::family-1::output::video";
    const source = { id: nodeId, data: { kind: "video", status: "failed", workflowEffectId: "family-1:video-1:video-submit" } };
    let saved = flowRow({ nodes: [], edges: [] });
    mocks.getFlowForOwner.mockImplementation(async () => saved);
    mocks.freshReadFlowRow.mockImplementation(async () => saved);
    mocks.generateVideoToCanvas.mockImplementation(async () => {
      saved = flowRow({ nodes: [source], edges: [] });
      throw new Error("provider rejected submission");
    });
    const retry = buildStoredVideoRetryNode(source, "flow-1", 1);
    mocks.retryCanvasVideo.mockImplementation(async () => {
      saved = flowRow({ nodes: [source, { ...retry, data: { ...retry.data, status: "running", taskId: "retry-task" } }], edges: [] });
      return { status: "running", nodeId: retry.id, taskId: "retry-task" };
    });
    const result = await runWorkflowVideoNode({ DB: {} } as never, { ...request, previousEvidence: null, resumeOnly: false,
      mediaDeliveryPolicy: { version: 1, maxRetries: 1, exhausted: "deliver_successes" } });
    expect(result).toMatchObject({ status: "waiting_external", taskId: "retry-task" });
    expect(mocks.retryCanvasVideo).toHaveBeenCalledTimes(1);
  });
  it("retry refusal must not hide why the first submission failed", async () => {
    const nodeId = "video-1::family::family-1::output::video";
    const source = { id: nodeId, data: { kind: "video", status: "failed", workflowEffectId: "family-1:video-1:video-submit" } };
    let saved = flowRow({ nodes: [], edges: [] });
    mocks.getFlowForOwner.mockImplementation(async () => saved);
    mocks.freshReadFlowRow.mockImplementation(async () => saved);
    mocks.generateVideoToCanvas.mockImplementation(async () => {
      saved = flowRow({ nodes: [source], edges: [] });
      throw new AppError('{"code":400,"message":"模型不存在: Seedance 2.5 720P v2"}', {
        status: 400, code: "newapi:newapi_request_failed",
      });
    });
    mocks.retryCanvasVideo.mockImplementation(async () => {
      throw new AppError("Prior submission has no confirmed rejection or receipt; duplicate submission is unsafe", {
        status: 409, code: "video_retry_submission_uncertain", details: { nodeId },
      });
    });
    const error = await runWorkflowVideoNode({ DB: {} } as never, { ...request, previousEvidence: null, resumeOnly: false,
      mediaDeliveryPolicy: { version: 1, maxRetries: 1, exhausted: "deliver_successes" } }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("video_retry_submission_uncertain");
    // 原始供应商拒绝原因必须与重复提交保护同时可见，不能被后者顶掉。
    expect(appError.message).toContain("模型不存在: Seedance 2.5 720P v2");
    expect(appError.details).toMatchObject({ nodeId, priorFailure: { nodeId, errorMessage: expect.stringContaining("模型不存在") } });
  });
});
