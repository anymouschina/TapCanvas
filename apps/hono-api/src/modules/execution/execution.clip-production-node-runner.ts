import { REFERENCE_ONLY_EXECUTION_ROLE } from "@tapcanvas/canvas-edge-semantics";
import { isDeepStrictEqual } from "node:util";
import type { WorkerEnv } from "../../types";
import { freshReadFlowRow, persistFlowPatch } from "../task/video-orchestrator.flow-io";
import { buildWorkflowVideoEffectV2Identity, WORKFLOW_VIDEO_EFFECT_OPERATION } from "../task/workflow-video-effect-claim";
import { buildWorkflowImageTaskId } from "../task/workflow-image-effect-claim";
import { buildClipInputEdges } from "../task/video-orchestrator.input-edges";
import { createWorkflowInternalContext } from "./execution.video-runner";
import { composeWorkflowImagePrompt, workflowImageEffectIdentity } from "./execution.image-runner";
import { clipProductionAssetMetadata } from "./execution.clip-production";
import { workflowImageSemanticLabel } from "./execution.media-label";
import { PublicFlowCreateNodeSchema } from "../flow/flow.public.schemas";
import type { ClipProductionNodePlan } from "./execution.clip-production-nodes";
import { renderClipProductionReferenceHeader, renderClipProductionReferencePrompt } from "./execution.clip-production-reference-prompt";

type JsonRecord = Record<string, unknown>;

export type WorkflowClipNodeMaterializationRequest = Readonly<{
	executionId: string;
	executionFamilyId: string;
	runtimeNodeId: string;
	ownerId: string;
	flowId: string;
	chapterId?: string | null;
	nodePlan: ClipProductionNodePlan;
	videoModelKey: string;
	videoResolution: string;
	videoAspectRatio: string;
	videoSize?: string;
	imageModelKey: string;
	imageAspectRatio: string;
	imageSize: string;
	imageQuality: string;
	stylePrompt?: string | null;
	styleFingerprint?: string | null;
	styleReferenceImages?: readonly string[];
}>;

export type WorkflowClipReuseHydrationRequest = Readonly<{
	executionId: string;
	executionFamilyId: string;
	runtimeNodeId: string;
	ownerId: string;
	flowId: string;
	chapterId?: string | null;
	effectAssetId: string;
	generationSpecVersion: string;
	existingAssetId: string;
	assetReuseKey?: string;
	imageUrl: string;
}>;

function record(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function read(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function flow(rowData: string): Readonly<{ nodes: JsonRecord[]; edges: JsonRecord[] }> {
	let parsed: unknown;
	try { parsed = JSON.parse(rowData) as unknown; }
	catch (error: unknown) { throw new Error(`Canvas flow is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
	if (!record(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("Canvas flow requires nodes and edges arrays");
	return { nodes: parsed.nodes.filter(record), edges: parsed.edges.filter(record) };
}

function assertFrozenNode(existing: JsonRecord, planned: JsonRecord): void {
	if (existing.id !== planned.id || !record(existing.data) || !record(planned.data)) throw new Error(`Planned canvas node ${read(planned.id)} changed shape`);
	const data = existing.data;
	const expected = planned.data;
	for (const field of ["kind", "prompt", "workflowEffectId", "workflowExecutionFamilyId", "workflowClipId",
		"workflowVideoInputMode", "modelKey", "videoDurationSeconds", "videoResolution", "aspectRatio",
		"workflowSourcePrompt", "workflowSpeechEvents", "workflowReferenceBindings", "workflowReferenceHeader",
		"negativePrompt", "imageSize", "registryObjectId", "canonicalAssetId", "assetState",
		"displayName", "referenceType", "referenceAssetBindings", "generationSpecVersion"] as const) {
		if (!isDeepStrictEqual(data[field], expected[field])) throw new Error(`Planned canvas node ${read(planned.id)} changed frozen ${field}`);
	}
	if (!isDeepStrictEqual(data.referenceImageNodeIds, expected.referenceImageNodeIds)) {
		throw new Error(`Planned canvas node ${read(planned.id)} changed image references`);
	}
	// The provider submission replaces the planned video data and may drop the
	// manual-canvas first-frame pointer. Its frozen reference IDs and persisted
	// dependency edges remain the authoritative execution lineage after claim.
	if (data.workflowPreparedOnly === true
		&& !isDeepStrictEqual(data.firstFrameFromNodeId, expected.firstFrameFromNodeId)) {
		throw new Error(`Planned canvas node ${read(planned.id)} changed first-frame dependency`);
	}
}

function buildNodes(request: WorkflowClipNodeMaterializationRequest): JsonRecord[] {
	const imageNodes = request.nodePlan.imageNodes.map(({ nodeId, assetItem }, index) => {
		const assetMetadata = clipProductionAssetMetadata(assetItem);
		const identity = workflowImageEffectIdentity({ executionFamilyId: request.executionFamilyId,
			runtimeNodeId: request.runtimeNodeId,
			assetIdentity: { assetId: assetItem.effectAssetId, generationSpecVersion: assetItem.generationSpecVersion } });
		if (identity.canvasNodeId !== nodeId) throw new Error(`Image ${assetItem.effectAssetId} changed planned node identity`);
		return {
			id: nodeId, type: "taskNode", position: { x: 160, y: 120 + index * 360 },
			data: {
				...assetMetadata,
				kind: assetItem.referenceAssetBindings.length > 0 ? "imageEdit" : "image",
				label: workflowImageSemanticLabel({ assetMetadata, itemIndex: index }),
				status: "idle", workflowPreparedOnly: true,
				...(assetItem.imageSource.mode === "generate" ? {
					prompt: composeWorkflowImagePrompt({ prompt: assetItem.prompt!, stylePrompt: request.stylePrompt, assetMetadata }),
					negativePrompt: assetItem.negativePrompt,
					modelKey: assetItem.modelKey,
					aspect: assetItem.aspectRatio,
					imageSize: assetItem.size,
				} : {
					modelKey: request.imageModelKey,
					aspect: request.imageAspectRatio,
					imageSize: request.imageSize,
					existingAssetId: assetItem.existingAssetId,
					existingProjectId: assetItem.existingProjectId,
				}),
				imageQuality: request.imageQuality,
				referenceAssetBindings: [...assetItem.referenceAssetBindings],
				...(request.styleReferenceImages?.length ? { styleImages: [...request.styleReferenceImages] } : {}),
				...(request.stylePrompt ? { stylePrompt: request.stylePrompt, stylePromptApplied: true } : {}),
				...(request.styleFingerprint ? { styleFingerprint: request.styleFingerprint } : {}),
				assetIdentity: assetItem.effectAssetId, generationSpecVersion: assetItem.generationSpecVersion,
				canonicalAssetId: assetItem.canonicalAssetId, assetState: assetItem.state,
				registryObjectId: assetItem.registryObjectId,
				workflowEffectId: identity.effectId,
				workflowTaskId: buildWorkflowImageTaskId({ ownerId: request.ownerId, effectId: identity.effectId }),
				workflowExecutionId: request.executionId, workflowExecutionFamilyId: request.executionFamilyId,
				workflowRuntimeNodeId: request.runtimeNodeId,
			},
		};
	});
	const videoNodes = request.nodePlan.videoNodes.map((video) => {
		const identity = buildWorkflowVideoEffectV2Identity({ executionFamilyId: request.executionFamilyId, clipId: video.clipId });
		if (identity.canvasNodeId !== video.nodeId) throw new Error(`Clip ${video.clipId} changed planned node identity`);
		const referenceImages = video.referenceImageNodeIds.map((nodeId) => ({ sourceNodeIds: [nodeId] }));
		const referenceHeader = renderClipProductionReferenceHeader({ bindings: video.referenceBindings, images: referenceImages });
		const prompt = renderClipProductionReferencePrompt({
			prompt: video.sourcePrompt, speechEvents: video.speechEvents,
			bindings: video.referenceBindings, images: referenceImages, stylePrompt: request.stylePrompt,
		});
		if (referenceHeader !== video.referenceHeader || prompt !== video.prompt) {
			throw new Error(`Clip ${video.clipId} reference prompt differs from its frozen packet bindings`);
		}
		return {
			id: video.nodeId, type: "taskNode", position: { x: 560, y: 120 + video.clipIndex * 360 },
			data: {
				kind: "video", label: `Clip ${video.clipIndex + 1}`, status: "idle", workflowPreparedOnly: true,
				prompt, workflowPromptSourceProtocol: "tapcanvas.clip-production-packets/v2",
				workflowSourcePrompt: video.sourcePrompt,
				...(video.speechEvents === undefined ? {} : { workflowSpeechEvents: video.speechEvents }),
				workflowReferenceBindings: video.referenceBindings.map((binding) => ({ ...binding })),
				workflowReferenceHeader: video.referenceHeader,
				workflowVideoInputMode: video.videoInputMode, modelKey: request.videoModelKey, videoModel: request.videoModelKey,
				videoDurationSeconds: video.durationSeconds, videoResolution: request.videoResolution,
				...(request.videoSize ? { videoSize: request.videoSize } : {}), aspectRatio: request.videoAspectRatio,
				referenceImageNodeIds: [...video.referenceImageNodeIds], referenceAssetIds: [],
				firstFrameImageNodeId: video.firstFrameImageNodeId,
				...(video.firstFrameImageNodeId ? { firstFrameFromNodeId: video.firstFrameImageNodeId } : {}),
				...(request.stylePrompt ? { stylePrompt: request.stylePrompt, stylePromptApplied: true } : {}),
				...(request.styleFingerprint ? { styleFingerprint: request.styleFingerprint } : {}),
				workflowEffectId: identity.effectId, workflowClipId: video.clipId,
				workflowEffectSourceSnapshot: video.sourceSnapshot,
				workflowEffectOperation: WORKFLOW_VIDEO_EFFECT_OPERATION,
				workflowExecutionId: request.executionId, workflowExecutionFamilyId: request.executionFamilyId,
				workflowRuntimeNodeId: request.runtimeNodeId, clipIndex: video.clipIndex,
			},
		};
	});
	return [...imageNodes, ...videoNodes];
}

/** Persist the complete Clip graph once. Every planned node is read back before the receipt is returned. */
export async function materializeWorkflowClipProductionNodes(
	env: WorkerEnv,
	request: WorkflowClipNodeMaterializationRequest,
): Promise<Readonly<{ imageNodeIds: readonly string[]; videoNodeIds: readonly string[]; edgeIds: readonly string[] }>> {
	if (!read(request.videoModelKey) || !read(request.videoResolution) || !read(request.videoAspectRatio)) {
		throw new Error("Clip node materialization requires frozen video model, resolution and aspect ratio");
	}
	const context = createWorkflowInternalContext(env, request);
	const readRow = () => freshReadFlowRow({ c: context, flowId: request.flowId, requestUserId: request.ownerId,
		devBypass: false, ...(request.chapterId ? { chapterId: request.chapterId } : {}) });
	const planned = buildNodes(request);
	for (const node of planned) {
		const parsed = PublicFlowCreateNodeSchema.safeParse(node);
		if (!parsed.success) {
			throw new Error(`Planned Clip canvas node ${read(node.id)} violates createNodes protocol: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
		}
	}
	const plannedById = new Map(planned.map((node) => [read(node.id), node]));
	if (plannedById.size !== planned.length) throw new Error("Clip node plan contains duplicate canvas identities");
	const row = await readRow();
	const current = flow(row.data);
	const currentById = new Map(current.nodes.map((node) => [read(node.id), node]));
	const createNodes = planned.filter((node) => {
		const existing = currentById.get(read(node.id));
		if (existing) { assertFrozenNode(existing, node); return false; }
		return true;
	});
	const graphWithPlannedNodes = { nodes: [...current.nodes, ...createNodes], edges: current.edges };
	const createEdges = request.nodePlan.videoNodes.flatMap((video) => buildClipInputEdges({
		current: graphWithPlannedNodes, clipNodeId: video.nodeId,
		sourceNodeIds: video.referenceImageNodeIds, targetWillBeCreated: true,
	}));
	// Story order is drawn on the canvas: each Clip points at the next one. The edge only shows the
	// order; reference_only keeps every runner from treating the previous Clip as a media input.
	const existingEdgeIds = new Set(current.edges.map((edge) => read(edge.id)));
	const ordered = [...request.nodePlan.videoNodes].sort((left, right) => left.clipIndex - right.clipIndex);
	const sequenceEdges = ordered.slice(1).flatMap((video, index) => {
		const previous = ordered[index]!;
		const id = `e-seq-${previous.nodeId}-${video.nodeId}`;
		return existingEdgeIds.has(id) ? [] : [{ id, source: previous.nodeId, target: video.nodeId,
			sourceHandle: "out-video", targetHandle: "in-any", label: "下一段",
			data: { executionRole: REFERENCE_ONLY_EXECUTION_ROLE, relationKind: "clip_sequence", label: "下一段" } }];
	});
	if (createNodes.length || createEdges.length || sequenceEdges.length) {
		await persistFlowPatch({ c: context, row, flowId: request.flowId, requestUserId: request.ownerId, devBypass: false,
			...(request.chapterId ? { chapterId: request.chapterId } : {}),
			patch: { createNodes, createEdges: [...createEdges, ...sequenceEdges] },
			affectedNodeIds: [...plannedById.keys()],
		});
	}
	const saved = flow((await readRow()).data);
	const savedById = new Map(saved.nodes.map((node) => [read(node.id), node]));
	for (const node of planned) {
		const persisted = savedById.get(read(node.id));
		if (!persisted) throw new Error(`Planned canvas node ${read(node.id)} was not persisted`);
		assertFrozenNode(persisted, node);
	}
	const edgePairs = new Set(saved.edges.map((edge) => `${read(edge.source)}→${read(edge.target)}`));
	for (const video of request.nodePlan.videoNodes) for (const source of video.referenceImageNodeIds) {
		if (!edgePairs.has(`${source}→${video.nodeId}`)) throw new Error(`Clip ${video.clipId} image dependency ${source} was not persisted`);
	}
	return { imageNodeIds: request.nodePlan.imageNodes.map((image) => image.nodeId),
		videoNodeIds: request.nodePlan.videoNodes.map((video) => video.nodeId),
		edgeIds: saved.edges.filter((edge) => request.nodePlan.videoNodes.some((video) => video.nodeId === edge.target))
			.map((edge) => read(edge.id)).filter(Boolean) };
}

/** Reuse keeps the preplanned Clip image identity and edges; it never submits to the provider. */
export async function hydrateWorkflowClipReusedImageNode(
	env: WorkerEnv,
	request: WorkflowClipReuseHydrationRequest,
): Promise<Readonly<{ nodeId: string }>> {
	const persistentUrl = new URL(request.imageUrl);
	if ((persistentUrl.protocol !== "https:" && persistentUrl.protocol !== "http:")
		|| !read(request.existingAssetId)) throw new Error("Clip reuse requires a real HTTP(S) image URL and asset ID");
	const identity = workflowImageEffectIdentity({
		executionFamilyId: request.executionFamilyId,
		runtimeNodeId: request.runtimeNodeId,
		assetIdentity: { assetId: request.effectAssetId, generationSpecVersion: request.generationSpecVersion },
	});
	const context = createWorkflowInternalContext(env, request);
	const readRow = () => freshReadFlowRow({ c: context, flowId: request.flowId, requestUserId: request.ownerId,
		devBypass: false, ...(request.chapterId ? { chapterId: request.chapterId } : {}) });
	const row = await readRow();
	const node = flow(row.data).nodes.find((candidate) => read(candidate.id) === identity.canvasNodeId);
	const plannedAssetId = node && record(node.data) ? read(node.data.existingAssetId) : "";
	const plannedReuseKey = node && record(node.data) ? read(node.data.assetReuseKey) : "";
	const matchesDeclaredReuse = plannedAssetId === request.existingAssetId;
	const matchesNodeIdentity = !plannedAssetId && Boolean(request.assetReuseKey)
		&& plannedReuseKey === request.assetReuseKey;
	if (!node || !record(node.data) || read(node.data.workflowEffectId) !== identity.effectId
		|| read(node.data.assetIdentity) !== request.effectAssetId
		|| (!matchesDeclaredReuse && !matchesNodeIdentity)) {
		throw new Error(`Planned Clip reuse node ${identity.canvasNodeId} is missing or changed`);
	}
	const data = node.data;
	if (data.status === "success") {
		if (read(data.imageUrl) !== persistentUrl.toString() || read(data.assetId) !== request.existingAssetId) {
			throw new Error(`Planned Clip reuse node ${identity.canvasNodeId} has conflicting result`);
		}
		return { nodeId: identity.canvasNodeId };
	}
	if (data.workflowPreparedOnly !== true || data.status !== "idle") {
		throw new Error(`Planned Clip reuse node ${identity.canvasNodeId} is no longer ready for reuse`);
	}
	const finalData = {
		...data,
		status: "success",
		workflowPreparedOnly: false,
		workflowAssetOrigin: "existing_asset",
		existingAssetId: request.existingAssetId,
		imageUrl: persistentUrl.toString(),
		imageResults: [{ url: persistentUrl.toString(), assetId: request.existingAssetId }],
		assetId: request.existingAssetId,
	};
	await persistFlowPatch({ c: context, row, flowId: request.flowId, requestUserId: request.ownerId, devBypass: false,
		...(request.chapterId ? { chapterId: request.chapterId } : {}),
		patch: { patchNodeData: [{ id: identity.canvasNodeId, data: finalData }], allowOverwrite: true },
		affectedNodeIds: [identity.canvasNodeId],
	});
	const saved = flow((await readRow()).data).nodes.find((candidate) => read(candidate.id) === identity.canvasNodeId);
	if (!saved || !record(saved.data) || saved.data.status !== "success"
		|| read(saved.data.imageUrl) !== persistentUrl.toString()
		|| read(saved.data.assetId) !== request.existingAssetId) {
		throw new Error(`Clip reuse node ${identity.canvasNodeId} was not persisted with its resolved asset`);
	}
	return { nodeId: identity.canvasNodeId };
}
