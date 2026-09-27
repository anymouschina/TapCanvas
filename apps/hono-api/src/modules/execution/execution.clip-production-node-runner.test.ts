import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { buildWorkflowVideoEffectV2Identity } from "../task/workflow-video-effect-claim";
import { workflowImageEffectIdentity } from "./execution.image-runner";
import type { ClipProductionNodePlan } from "./execution.clip-production-nodes";

const mocks = vi.hoisted(() => ({ freshReadFlowRow: vi.fn(), persistFlowPatch: vi.fn() }));
vi.mock("../task/video-orchestrator.flow-io", () => ({
	freshReadFlowRow: mocks.freshReadFlowRow, persistFlowPatch: mocks.persistFlowPatch,
}));

import { hydrateWorkflowClipReusedImageNode, materializeWorkflowClipProductionNodes } from "./execution.clip-production-node-runner";
import { workflowVideoEffectIdentity } from "./execution.video-runner";

const imageId = workflowImageEffectIdentity({ executionFamilyId: "family", runtimeNodeId: "plan",
	assetIdentity: { assetId: "effect", generationSpecVersion: "v1" } }).canvasNodeId;
const videoId = buildWorkflowVideoEffectV2Identity({ executionFamilyId: "family", clipId: "clip-0" }).canvasNodeId;
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
	videoNodes: [{ sourceSnapshot: { clipId: "clip-0", sourceRanges: [{ sourceId: "chapter", sourceFingerprint: "hash", sourceIndex: 0, startOffset: 0, endOffset: 10 }], clipFacts: {} }, nodeId: videoId, clipId: "clip-0", clipIndex: 0, prompt: "video prompt", durationSeconds: 5,
		videoInputMode: "image_to_video", firstFrameImageNodeId: imageId, referenceImageNodeIds: [imageId] }],
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
			workflowPreparedOnly: true, prompt: "video prompt", firstFrameFromNodeId: imageId,
			workflowEffectSourceSnapshot: nodePlan.videoNodes[0]!.sourceSnapshot,
			referenceImageNodeIds: [imageId],
		});
		await materializeWorkflowClipProductionNodes({} as WorkerEnv, request);
		expect(mocks.persistFlowPatch).toHaveBeenCalledTimes(1);
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
			videoInputMode: "text_to_video", firstFrameImageNodeId: null, referenceImageNodeIds: [] }] };
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

	it("hydrates an existing project asset into the exact planned semantic node without creating a duplicate", async () => {
		const reuseImageId = workflowImageEffectIdentity({ executionFamilyId: "family", runtimeNodeId: "plan",
			assetIdentity: { assetId: "reuse-effect", generationSpecVersion: "project-asset-reuse/v1" } }).canvasNodeId;
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
				referenceImageNodeIds: [reuseImageId] }],
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
