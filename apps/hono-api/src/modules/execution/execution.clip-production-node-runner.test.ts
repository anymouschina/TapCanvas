import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { buildWorkflowVideoEffectV2Identity } from "../task/workflow-video-effect-claim";
import { workflowImageEffectIdentity } from "./execution.image-runner";
import type { ClipProductionNodePlan } from "./execution.clip-production-nodes";
import {
	renderClipProductionReferenceHeader,
	renderClipProductionReferencePrompt,
} from "./execution.clip-production-reference-prompt";

const mocks = vi.hoisted(() => ({ freshReadFlowRow: vi.fn(), persistFlowPatch: vi.fn() }));
vi.mock("../task/video-orchestrator.flow-io", () => ({
	freshReadFlowRow: mocks.freshReadFlowRow, persistFlowPatch: mocks.persistFlowPatch,
}));

import { hydrateWorkflowClipReusedImageNode, materializeWorkflowClipProductionNodes } from "./execution.clip-production-node-runner";
import { workflowVideoEffectIdentity } from "./execution.video-runner";

const imageId = workflowImageEffectIdentity({ executionFamilyId: "family", runtimeNodeId: "plan",
	assetIdentity: { assetId: "effect", generationSpecVersion: "v1" } }).canvasNodeId;
const videoId = buildWorkflowVideoEffectV2Identity({ executionFamilyId: "family", clipId: "clip-0" }).canvasNodeId;
const referenceBindings = [{ nodeId: imageId, name: "张羽", referenceType: "character" }] as const;
const referenceImages = [{ sourceNodeIds: [imageId] }] as const;
const referenceHeader = renderClipProductionReferenceHeader({ bindings: referenceBindings, images: referenceImages });
const sourcePrompt = "video prompt";
const renderedPrompt = renderClipProductionReferencePrompt({ prompt: sourcePrompt, bindings: referenceBindings, images: referenceImages });
const nodePlan: ClipProductionNodePlan = {
	protocolVersion: "tapcanvas.clip-production-node-plan/v1", executionId: "execution", workflowKey: "workflow",
	imageNodes: [{ nodeId: imageId, assetItem: {
		protocolVersion: "tapcanvas.clip-production-asset-item/v1", assetId: "effect", effectAssetId: "effect",
		canonicalAssetId: "shared", state: "base", registryObjectId: "character-a",
		displayName: "张羽", referenceType: "character",
		referenceAssetBindings: [{ assetId: "existing-face", role: "identity" }],
		imageSource: { mode: "generate", generationSpecVersion: "v1",
			generationSpec: { prompt: "image prompt", negativePrompt: "negative", modelKey: "image-model", aspectRatio: "16:9", size: "2K" } },
		generationSpecVersion: "v1",
		generationSpec: { prompt: "image prompt", negativePrompt: "negative", modelKey: "image-model", aspectRatio: "16:9", size: "2K" },
		prompt: "image prompt", negativePrompt: "negative", modelKey: "image-model", aspectRatio: "16:9", size: "2K",
		consumerClipIds: ["clip-0"],
	} }],
	videoNodes: [{ sourceSnapshot: { clipId: "clip-0", sourceRanges: [{ sourceId: "chapter", sourceFingerprint: "hash", sourceIndex: 0, startOffset: 0, endOffset: 10 }], clipFacts: {} }, nodeId: videoId, clipId: "clip-0", clipIndex: 0, prompt: renderedPrompt, sourcePrompt, durationSeconds: 5,
		videoInputMode: "image_to_video", firstFrameImageNodeId: imageId, referenceImageNodeIds: [imageId],
		referenceBindings, referenceHeader }],
};

describe("Clip node canvas materialization", () => {
	beforeEach(() => { mocks.freshReadFlowRow.mockReset(); mocks.persistFlowPatch.mockReset(); });

	it("persists and reads back one image and one video with their dependency; replay is idempotent", async () => {
		const graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } = { nodes: [], edges: [] };
		mocks.freshReadFlowRow.mockImplementation(async () => ({ id: "flow", data: JSON.stringify(graph) }));
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: {
			createNodes: Record<string, unknown>[]; createEdges: Record<string, unknown>[];
		} }) => { graph.nodes.push(...input.patch.createNodes); graph.edges.push(...input.patch.createEdges); });
		const request = { executionId: "execution", executionFamilyId: "family", runtimeNodeId: "plan",
			ownerId: "owner", flowId: "flow", nodePlan,
			videoModelKey: "video-model", videoResolution: "720p", videoAspectRatio: "16:9",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K", imageQuality: "" };
		const first = await materializeWorkflowClipProductionNodes({} as WorkerEnv, request);
		expect(first).toMatchObject({ imageNodeIds: [imageId], videoNodeIds: [videoId] });
		expect(graph.nodes).toHaveLength(2);
		expect(graph.edges).toEqual([expect.objectContaining({ source: imageId, target: videoId })]);
		expect((graph.nodes[0]!.data as Record<string, unknown>)).toMatchObject({
			kind: "imageEdit", label: "张羽角色卡", displayName: "张羽", referenceType: "character",
			registryObjectId: "character-a", canonicalAssetId: "shared",
			referenceAssetBindings: [{ assetId: "existing-face", role: "identity" }],
		});
		expect((graph.nodes[1]!.data as Record<string, unknown>)).toMatchObject({
			workflowPreparedOnly: true, prompt: renderedPrompt, workflowSourcePrompt: sourcePrompt,
			workflowReferenceBindings: referenceBindings, workflowReferenceHeader: referenceHeader,
			firstFrameFromNodeId: imageId,
			workflowEffectSourceSnapshot: nodePlan.videoNodes[0]!.sourceSnapshot,
			referenceImageNodeIds: [imageId],
		});
		await materializeWorkflowClipProductionNodes({} as WorkerEnv, request);
		expect(mocks.persistFlowPatch).toHaveBeenCalledTimes(1);
	});

	it("re-renders the host-bound speech track at node materialization and freezes its evidence", async () => {
		const graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } = { nodes: [], edges: [] };
		mocks.freshReadFlowRow.mockImplementation(async () => ({ id: "flow", data: JSON.stringify(graph) }));
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: {
			createNodes: Record<string, unknown>[]; createEdges: Record<string, unknown>[];
		} }) => { graph.nodes.push(...input.patch.createNodes); graph.edges.push(...input.patch.createEdges); });
		const speechEvents = [{ speechEventId: "speech-1", speaker: "阿乔", delivery: "on_screen", text: "  我来。\n",
			textOrigin: "authored" as const, eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene" as const, sourceRanges: [] }];
		const video = nodePlan.videoNodes[0]!;
		const referenceImages = video.referenceImageNodeIds.map((nodeId) => ({ sourceNodeIds: [nodeId] }));
		const prompt = renderClipProductionReferencePrompt({ prompt: video.sourcePrompt, speechEvents,
			bindings: video.referenceBindings, images: referenceImages });
		const speechPlan: ClipProductionNodePlan = { ...nodePlan, videoNodes: [{ ...video, speechEvents, prompt }] };
		await materializeWorkflowClipProductionNodes({} as WorkerEnv, {
			executionId: "execution", executionFamilyId: "family", runtimeNodeId: "plan", ownerId: "owner", flowId: "flow",
			nodePlan: speechPlan, videoModelKey: "video-model", videoResolution: "720p", videoAspectRatio: "16:9",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K", imageQuality: "",
		});
		const videoNode = graph.nodes.find((node) => node.id === videoId);
		expect(videoNode?.data).toMatchObject({ prompt, workflowSpeechEvents: speechEvents, workflowSourcePrompt: video.sourcePrompt });
	});

	it("uses the same Clip identity at planning and provider submission", () => {
		expect(workflowVideoEffectIdentity({ executionFamilyId: "family",
			runtimeNodeId: "video-submit::item::clip-0", clipId: "clip-0", structuredClip: null }).canvasNodeId)
			.toBe(videoId);
	});

	it("materializes a text-only Clip without an image node or dependency edge", async () => {
		const graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } = { nodes: [], edges: [] };
		mocks.freshReadFlowRow.mockImplementation(async () => ({ id: "flow", data: JSON.stringify(graph) }));
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: {
			createNodes: Record<string, unknown>[]; createEdges: Record<string, unknown>[];
		} }) => { graph.nodes.push(...input.patch.createNodes); graph.edges.push(...input.patch.createEdges); });
		const textPlan: ClipProductionNodePlan = { ...nodePlan, imageNodes: [], videoNodes: [{ ...nodePlan.videoNodes[0]!,
			prompt: renderClipProductionReferencePrompt({ prompt: sourcePrompt, bindings: [], images: [] }),
			videoInputMode: "text_to_video", firstFrameImageNodeId: null,
			referenceImageNodeIds: [], referenceBindings: [], referenceHeader: "" }] };
		const result = await materializeWorkflowClipProductionNodes({} as WorkerEnv, {
			executionId: "execution", executionFamilyId: "family", runtimeNodeId: "plan", ownerId: "owner", flowId: "flow",
			nodePlan: textPlan, videoModelKey: "video-model", videoResolution: "720p", videoAspectRatio: "16:9", imageQuality: "",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K",
		});
		expect(result).toMatchObject({ imageNodeIds: [], videoNodeIds: [videoId], edgeIds: [] });
		expect(graph.nodes).toHaveLength(1);
		expect(graph.edges).toEqual([]);
		expect((graph.nodes[0]!.data as Record<string, unknown>)).toMatchObject({
			workflowPreparedOnly: true, workflowVideoInputMode: "text_to_video", referenceImageNodeIds: [],
		});
	});

	it("draws the story order between adjacent Clips as reference-only edges, once", async () => {
		const graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } = { nodes: [], edges: [] };
		mocks.freshReadFlowRow.mockImplementation(async () => ({ id: "flow", data: JSON.stringify(graph) }));
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: {
			createNodes: Record<string, unknown>[]; createEdges: Record<string, unknown>[];
		} }) => { graph.nodes.push(...input.patch.createNodes); graph.edges.push(...input.patch.createEdges); });
		const nextId = buildWorkflowVideoEffectV2Identity({ executionFamilyId: "family", clipId: "clip-1" }).canvasNodeId;
		const text = { ...nodePlan.videoNodes[0]!,
			prompt: renderClipProductionReferencePrompt({ prompt: sourcePrompt, bindings: [], images: [] }), videoInputMode: "text_to_video" as const,
			firstFrameImageNodeId: null, referenceImageNodeIds: [], referenceBindings: [], referenceHeader: "" };
		const twoClips: ClipProductionNodePlan = { ...nodePlan, imageNodes: [], videoNodes: [text,
			{ ...text, nodeId: nextId, clipId: "clip-1", clipIndex: 1, sourceSnapshot: { ...text.sourceSnapshot, clipId: "clip-1" } }] };
		const request = { executionId: "execution", executionFamilyId: "family", runtimeNodeId: "plan", ownerId: "owner", flowId: "flow",
			nodePlan: twoClips, videoModelKey: "video-model", videoResolution: "720p", videoAspectRatio: "16:9", imageQuality: "",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K" };
		await materializeWorkflowClipProductionNodes({} as WorkerEnv, request);
		await materializeWorkflowClipProductionNodes({} as WorkerEnv, request);
		expect(graph.edges).toEqual([{ id: `e-seq-${videoId}-${nextId}`, source: videoId, target: nextId,
			sourceHandle: "out-video", targetHandle: "in-any", label: "下一段",
			data: { executionRole: "reference_only", relationKind: "clip_sequence", label: "下一段" } }]);
	});

	it("hydrates an existing project asset into the exact planned semantic node without creating a duplicate", async () => {
		const reuseImageId = workflowImageEffectIdentity({ executionFamilyId: "family", runtimeNodeId: "plan",
			assetIdentity: { assetId: "reuse-effect", generationSpecVersion: "project-asset-reuse/v1" } }).canvasNodeId;
		const reuseBindings = [{ nodeId: reuseImageId, name: "张羽", referenceType: "character" }] as const;
		const reuseImages = [{ sourceNodeIds: [reuseImageId] }] as const;
		const reuseHeader = renderClipProductionReferenceHeader({ bindings: reuseBindings, images: reuseImages });
		const reusePlan: ClipProductionNodePlan = {
			...nodePlan,
			imageNodes: [{ nodeId: reuseImageId, assetItem: {
				protocolVersion: "tapcanvas.clip-production-asset-item/v1",
				assetId: "reuse-effect", effectAssetId: "reuse-effect", canonicalAssetId: "shared", state: "base",
				registryObjectId: "character-a", displayName: "张羽", referenceType: "character",
				referenceAssetBindings: [], imageSource: { mode: "reuse", existingAssetId: "ready-image", existingProjectId: "project" },
				generationSpecVersion: "project-asset-reuse/v1", existingAssetId: "ready-image", existingProjectId: "project",
				consumerClipIds: ["clip-0"],
			} }],
			videoNodes: [{ ...nodePlan.videoNodes[0]!, firstFrameImageNodeId: reuseImageId,
				prompt: renderClipProductionReferencePrompt({ prompt: sourcePrompt, bindings: reuseBindings, images: reuseImages }),
				referenceImageNodeIds: [reuseImageId], referenceBindings: reuseBindings, referenceHeader: reuseHeader }],
		};
		const graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } = { nodes: [], edges: [] };
		mocks.freshReadFlowRow.mockImplementation(async () => ({ id: "flow", data: JSON.stringify(graph) }));
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: {
			createNodes?: Record<string, unknown>[]; createEdges?: Record<string, unknown>[];
			patchNodeData?: Array<{ id: string; data: Record<string, unknown> }>;
		} }) => {
			graph.nodes.push(...(input.patch.createNodes ?? []));
			graph.edges.push(...(input.patch.createEdges ?? []));
			for (const item of input.patch.patchNodeData ?? []) {
				const node = graph.nodes.find((entry) => entry.id === item.id);
				if (!node) throw new Error("missing test node");
				node.data = item.data;
			}
		});
		await materializeWorkflowClipProductionNodes({} as WorkerEnv, {
			executionId: "execution", executionFamilyId: "family", runtimeNodeId: "plan",
			ownerId: "owner", flowId: "flow", nodePlan: reusePlan,
			videoModelKey: "video-model", videoResolution: "720p", videoAspectRatio: "16:9",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K", imageQuality: "",
		});
		const hydration = { executionId: "execution", executionFamilyId: "family", runtimeNodeId: "image-run",
			ownerId: "owner", flowId: "flow", effectAssetId: "reuse-effect",
			generationSpecVersion: "project-asset-reuse/v1", existingAssetId: "ready-image",
			imageUrl: "https://media.example/ready.png" };
		expect(await hydrateWorkflowClipReusedImageNode({} as WorkerEnv, hydration)).toEqual({ nodeId: reuseImageId });
		expect(await hydrateWorkflowClipReusedImageNode({} as WorkerEnv, hydration)).toEqual({ nodeId: reuseImageId });
		expect(graph.nodes).toHaveLength(2);
		expect(graph.edges).toEqual([expect.objectContaining({ source: reuseImageId, target: videoId })]);
		expect((graph.nodes[0]!.data as Record<string, unknown>)).toMatchObject({
			label: "张羽角色卡", status: "success", workflowPreparedOnly: false,
			imageUrl: "https://media.example/ready.png", assetId: "ready-image",
		});
		expect(mocks.persistFlowPatch).toHaveBeenCalledTimes(2);
	});

	it("hydrates a generation node by its frozen reuse identity when Palace finds an existing asset", async () => {
		const graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } = { nodes: [], edges: [] };
		mocks.freshReadFlowRow.mockImplementation(async () => ({ id: "flow", data: JSON.stringify(graph) }));
		mocks.persistFlowPatch.mockImplementation(async (input: { patch: {
			createNodes?: Record<string, unknown>[]; createEdges?: Record<string, unknown>[];
			patchNodeData?: Array<{ id: string; data: Record<string, unknown> }>;
		} }) => {
			graph.nodes.push(...(input.patch.createNodes ?? []));
			graph.edges.push(...(input.patch.createEdges ?? []));
			for (const item of input.patch.patchNodeData ?? []) {
				const node = graph.nodes.find((entry) => entry.id === item.id);
				if (!node) throw new Error("missing test node");
				node.data = item.data;
			}
		});
		const generationPlan: ClipProductionNodePlan = { ...nodePlan, imageNodes: [{ ...nodePlan.imageNodes[0]!,
			assetItem: { ...nodePlan.imageNodes[0]!.assetItem, assetReuseKey: "character-base-v1" } }] };
		await materializeWorkflowClipProductionNodes({} as WorkerEnv, {
			executionId: "execution", executionFamilyId: "family", runtimeNodeId: "plan", ownerId: "owner", flowId: "flow",
			nodePlan: generationPlan, videoModelKey: "video-model", videoResolution: "720p", videoAspectRatio: "16:9",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K", imageQuality: "",
		});
		const hydration = { executionId: "execution", executionFamilyId: "family", runtimeNodeId: "image-run",
			ownerId: "owner", flowId: "flow", effectAssetId: "effect", generationSpecVersion: "v1",
			assetReuseKey: "character-base-v1", existingAssetId: "historical-image",
			imageUrl: "https://media.example/historical.png" };
		expect(await hydrateWorkflowClipReusedImageNode({} as WorkerEnv, hydration)).toEqual({ nodeId: imageId });
		expect(await hydrateWorkflowClipReusedImageNode({} as WorkerEnv, hydration)).toEqual({ nodeId: imageId });
		expect(graph.nodes).toHaveLength(2);
		expect((graph.nodes[0]!.data as Record<string, unknown>)).toMatchObject({
			status: "success", assetReuseKey: "character-base-v1", existingAssetId: "historical-image",
			assetId: "historical-image", imageUrl: "https://media.example/historical.png",
		});
		await expect(hydrateWorkflowClipReusedImageNode({} as WorkerEnv, {
			...hydration, existingAssetId: "another-image",
		})).rejects.toThrow("missing or changed");
	});
});
