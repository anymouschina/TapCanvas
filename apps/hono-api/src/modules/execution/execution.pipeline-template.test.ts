import { describe, expect, it, vi } from "vitest";
import { createWorkflowCollection, isWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";
import { executeRegisteredWorkflowNode, type WorkflowAgentRunRequest, type WorkflowNodeExecutionContext, type WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import { runWorkflowPipelineNode } from "./execution.pipeline-runner";
import type { WorkflowNodeExecutionResult, WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";
import { aggregateClipProduction } from "./execution.clip-production-aggregate";
import { clipProductionBlockingFixture } from "./test-fixtures/clip-production-blocking";

// Import the real persisted template without loading browser stores or layout services.
vi.mock("../../../../web/src/canvas/store", () => ({ useRFStore: {} }));
vi.mock("../../../../web/src/canvas/utils/nodeBounds", () => ({ getNodeAbsPosition: vi.fn() }));
vi.mock("../../../../web/src/auth/isAdmin", () => ({ isCurrentUserAdmin: () => true }));

function collection(values: readonly unknown[], ids: readonly string[], port: string) {
	return createWorkflowCollection({ collectionId: `test:${port}`, producerNodeId: "test", producerPortId: port, values, itemIds: ids });
}

type CanvasTemplateModule = Readonly<{
	buildVideoWorkflowCanvasDefinitionPatch: (input: Readonly<{
		workflowInstanceId: string;
		workflowGroupId: string;
		executionScope: "media_delivery";
		executionVariant?: "full_video" | "first_video";
		existingNodes?: readonly Readonly<{ id: string; data?: Readonly<Record<string, unknown>> }>[];
		existingEdges: readonly [];
	}>) => Readonly<{ patchNodeData: readonly Readonly<{ id: string; data: Record<string, unknown> }>[] }>;
}>;

async function mediaNode(executionVariant: "full_video" | "first_video" = "first_video"): Promise<WorkflowNodeSnapshot> {
	// Keep the browser implementation outside the production API TypeScript graph.
	// Vitest still loads the actual template and checks its runtime protocol below.
	const templateModulePath: string = "../../../../web/src/canvas/videoWorkflowCanvasTemplate";
	const templateModule: unknown = await import(templateModulePath);
	if (!templateModule || typeof templateModule !== "object"
		|| !("buildVideoWorkflowCanvasDefinitionPatch" in templateModule)
		|| typeof templateModule.buildVideoWorkflowCanvasDefinitionPatch !== "function") {
		throw new Error("Real template module has no patch builder");
	}
	const patch = (templateModule as CanvasTemplateModule).buildVideoWorkflowCanvasDefinitionPatch({
		workflowInstanceId: "template-test", workflowGroupId: "template-group",
		executionScope: "media_delivery", executionVariant, existingEdges: [],
		existingNodes: executionVariant === "full_video" ? fullVideoModelConfig() : undefined,
	});
	const node = patch.patchNodeData.find((candidate) => candidate.id.endsWith(":clip-media-pipeline"));
	if (!node) throw new Error("Real template has no media pipeline");
	return { id: node.id, type: "taskNode", kind: "workflowStage", data: node.data };
}

function fullVideoModelConfig() {
	const modelConfig = (workflowNodeId: string, data: Record<string, unknown>) => ({
		id: `config:${workflowNodeId}`, data: { workflowNodeId, ...data },
	});
	return [
		modelConfig("clip-production-agent", { workflowAgentModelKey: "test-agent-model" }),
		modelConfig("cost-estimate", { workflowVideoModelKey: "test-video-model", workflowVideoResolution: "720p", workflowVideoAspectRatio: "16:9" }),
		modelConfig("video-submit", { workflowVideoModelKey: "test-video-model", workflowVideoResolution: "720p", workflowVideoSize: "720p", workflowVideoAspectRatio: "16:9" }),
	];
}

/** Full-video planning node: authors every Clip and persists the whole chapter's nodes. */
async function fullVideoNode(): Promise<WorkflowNodeSnapshot> {
	const templateModulePath: string = "../../../../web/src/canvas/videoWorkflowCanvasTemplate";
	const templateModule: unknown = await import(templateModulePath);
	if (!templateModule || typeof templateModule !== "object"
		|| !("buildVideoWorkflowCanvasDefinitionPatch" in templateModule)
		|| typeof templateModule.buildVideoWorkflowCanvasDefinitionPatch !== "function") {
		throw new Error("Real template module has no patch builder");
	}
	const patch = (templateModule as CanvasTemplateModule).buildVideoWorkflowCanvasDefinitionPatch({
		workflowInstanceId: "full-video-test", workflowGroupId: "full-video-group",
		executionScope: "media_delivery", executionVariant: "full_video", existingEdges: [],
		existingNodes: fullVideoModelConfig(),
	});
	const node = patch.patchNodeData.find((candidate) => candidate.id.endsWith(":clip-production-pipeline"));
	if (!node) throw new Error("Real template has no full-video Clip planning pipeline");
	return { id: node.id, type: "taskNode", kind: "workflowStage", data: node.data };
}

async function fullVideoTemplateNode(workflowNodeId: string): Promise<WorkflowNodeSnapshot> {
	const templateModulePath: string = "../../../../web/src/canvas/videoWorkflowCanvasTemplate";
	const templateModule = await import(templateModulePath) as CanvasTemplateModule;
	const patch = templateModule.buildVideoWorkflowCanvasDefinitionPatch({
		workflowInstanceId: "full-video-test", workflowGroupId: "full-video-group",
		executionScope: "media_delivery", executionVariant: "full_video", existingEdges: [],
	});
	const node = patch.patchNodeData.find((candidate) => candidate.id.endsWith(`:${workflowNodeId}`));
	if (!node) throw new Error(`Real template has no ${workflowNodeId}`);
	return { id: node.id, type: "taskNode", kind: "workflowStage", data: node.data };
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function sourceSegment(index: number) {
	const clipId = `clip-${index}`;
	const range = { sourceIndex: 0, startOffset: index * 10, endOffset: index * 10 + 10,
		sourceId: "chapter", sourceFingerprint: "sha256:chapter" };
	return { protocolVersion: "tapcanvas.clip-source-segment/v1", clipId, clipIndex: index,
		sourceId: "chapter", sourceFingerprint: "sha256:chapter", durationSeconds: 5,
		sourceRanges: [range], sourceSlices: [{ ...range, text: `片段${index}原文` }] };
}

function chapterSequenceClip(index: number) {
	return { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: `clip-${index}`,
		clipIndex: index, durationSeconds: 5, speechEvents: [] };
}

function clipProductionDraft(index: number) {
	const source = sourceSegment(index);
	return {
		protocolVersion: "tapcanvas.clip-production-packet/v2", clipId: source.clipId,
		clipIndex: index, durationSeconds: source.durationSeconds, videoInputMode: "image_to_video",
		firstFrameAssetIndex: 0, referenceAssetIndices: [0], sourceRanges: source.sourceRanges,
		videoPrompt: {
			scene: `Clip ${index} 的测试场景：主角位于房间内。`,
			// One item per host segment; the 5 s event-free chapter-sequence clip is a single segment.
			shots: [
				{ action: "主角从门边走向桌前，在桌前停下。", camera: "固定全景", sound: "脚步声", storyEventIds: [], speechEventIds: [] },
			],
		}, blockingPlan: clipProductionBlockingFixture(),
		clipFacts: { sequenceClipId: source.clipId, action: { start: "起", movement: "行", result: "止" } },
		assetIntents: [{ registryObjectId: "character-main", imageSource: { mode: "generate" } }],
		imageModelKey: "test-image-model", imageAspectRatio: "16:9", imageSize: "2K",
	};
}

function chapterAssets() {
	return {
		objectRegistry: [{ objectId: "character-main", kind: "character", name: "主角",
			physicalIdentityKey: "character-main", referenceRole: "identity", identityInvariant: "主角身份不变",
			imageSource: { mode: "generate", referenceAssetBindings: [], plan: {
				prompt: "冻结的共享角色参考图提示词", negativePrompt: "不要改变身份", identityAnchors: ["稳定身份"], prohibitedDrift: ["不得换人"],
			} } }],
		backgroundPlans: [{ objectId: "background-main", plan: { prompt: "冻结背景" } }],
	};
}

function deliveryContract() {
	return {
		protocolVersion: "2", workflowKey: "video",
		generationContract: { videoModel: "test-video-model", durationOptions: [5], maxDurationSeconds: 5,
			resolution: "720p", aspectRatio: "16:9", size: "720p",
			referenceAudioPolicy: { minimumDurationSeconds: 0, maximumDurationSeconds: 0 },
			supportsTextToVideo: true, supportsReferenceImages: true, supportsFirstLastFrame: true, maxReferenceImages: 4 },
		imageGenerationContract: { modelKey: "test-image-model", aspectRatio: "16:9", size: "2K" },
	};
}

function stepOutput(context: WorkflowNodeExecutionContext, ports: Record<string, unknown>): WorkflowNodeOutputV1 {
	const spec = context.node.data.workflowAtomicSpec as { executorRef: string };
	return { protocolVersion: "1", executorRef: spec.executorRef, nodeId: context.node.id,
		executionMode: "once", ports, artifacts: [], evidence: { executorCompleted: true }, itemRuns: [] };
}

describe("real video template through durable pipeline and each-item aggregation", () => {
	it.each([true, false])("runs image dependencies before selecting onlyVideoNodes=%s delivery", async (onlyVideoNodes) => {
		const calls: string[] = [];
		const deps = {} as WorkflowNodeExecutorDependencies;
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const stepId = context.node.id.split("::step::").at(-1)!;
			const clipId = context.runtimeItemLineage?.at(-1)?.itemId;
			if (!clipId) throw new Error("Outer each-mode lost Clip lineage");
			calls.push(`${clipId}:${stepId}`);
			if (stepId === "video-execution-choice") {
				// Use the real structural condition executor; only expensive/persistence operations are mocked.
				return executeRegisteredWorkflowNode(context, deps);
			}
			const imageUrl = `https://media.example/${clipId}.png`;
			const clip = { clipId };
			const ready = { clipId, nodeId: `video-${clipId}`, imageUrl, persisted: true, promptPersisted: true, dependenciesReady: true };
			const outputs: Record<string, Record<string, unknown>> = {
				"clip-production-media-project": {
					"clip-production": collection([clip], [clipId], "clip-production"),
					"asset-items": collection([{ clipId }], [clipId], "asset-items"),
				},
				"clip-asset-image-generate": { "asset-bindings": collection([{ imageUrl }], [clipId], "asset-bindings") },
				"clip-production-project": { "prompt-package": { clipId, imageUrl } },
				"voice-materialize": { "voice-manifest": { mode: "provider_native" } },
				"cost-estimate": { estimate: { clipId, estimatedCredits: 1 } },
				"production-handoff": { "production-plan": collection([ready], [clipId], "production-plan") },
				"video-node-prepare": { "prepared-nodes": collection([ready], [clipId], "prepared-nodes") },
				"video-submit": { "provider-receipts": collection([{ clipId, taskId: `task-${clipId}` }], [clipId], "provider-receipts") },
				"video-results": { "video-assets": collection([{ clipId, videoUrl: `https://media.example/${clipId}.mp4` }], [clipId], "video-assets") },
			};
			const ports = outputs[stepId];
			if (!ports) throw new Error(`Unmocked side effect: ${stepId}`);
			return { ok: true, outputRefs: stepOutput(context, ports) };
		};
		const clipIds = ["clip-0", "clip-1"];
		const context: WorkflowNodeExecutionContext = {
			executionId: "execution-1", executionFamilyId: "family-1", ownerId: "owner-1",
			flowId: "flow-1", projectId: "project-1", workflowKey: "video", node: await mediaNode(),
			inputs: {
				authorization: [{ onlyVideoNodes }],
				"delivery-contract": [{ protocolVersion: "2" }],
				"media-items": [collection(clipIds.map((clipId) => ({ clipId })), clipIds, "media-items")],
			},
		};
		const result = await executeWorkflowNodeByMode(context, deps, (itemContext, dependencies) => (
			runWorkflowPipelineNode(itemContext, dependencies, executeStep)
		));
		expect(result.ok, JSON.stringify(result)).toBe(true);
		if (!result.ok) throw new Error("Pipeline failed");
		const selected = onlyVideoNodes ? "prepared-nodes" : "video-assets";
		const excluded = onlyVideoNodes ? "video-assets" : "prepared-nodes";
		expect(Object.keys(result.outputRefs.ports)).toEqual(["prompt-package", "estimate", selected]);
		expect(result.outputRefs.ports).not.toHaveProperty(excluded);
		const receipts = result.outputRefs.ports[selected];
		if (!isWorkflowCollection(receipts)) throw new Error("Outer each-mode did not preserve delivery collection");
		expect(receipts.items.map((item) => item.itemId)).toEqual(clipIds);
		for (const [index, clipId] of clipIds.entries()) {
			const item = receipts.items[index]!;
			if (!isWorkflowCollection(item.value)) throw new Error("Nested Clip receipt collection was lost");
			expect(item.value.items).toHaveLength(1);
			expect(item.value.items[0]?.itemId).toBe(clipId);
			const selectedStep = onlyVideoNodes ? "video-node-prepare" : "video-submit";
			const excludedStep = onlyVideoNodes ? "video-submit" : "video-node-prepare";
			expect(calls.indexOf(`${clipId}:clip-asset-image-generate`)).toBeLessThan(calls.indexOf(`${clipId}:video-execution-choice`));
			expect(calls.indexOf(`${clipId}:video-execution-choice`)).toBeLessThan(calls.indexOf(`${clipId}:${selectedStep}`));
			expect(calls).not.toContain(`${clipId}:${excludedStep}`);
			if (onlyVideoNodes) expect(calls).not.toContain(`${clipId}:video-results`);
			expect(result.outputRefs.itemRuns[index]?.evidence.pipelineStepFacts).toMatchObject({
				"video-execution-choice": { status: "success", selectedOutputPorts: [onlyVideoNodes ? "matched" : "unmatched"] },
				[selectedStep]: { status: "success" }, [excludedStep]: { status: "not_selected" },
			});
		}
	});

	it("persists every Clip node before any image or video submission, even while one writer is still running", async () => {
		const calls: string[] = [];
		const clipZeroStarted = deferred<void>();
		const clipOneFinished = deferred<void>();
		const releaseClipZero = deferred<void>();
		const imageNodeByAsset = new Map<string, string>();
		const videoNodeByClip = new Map<string, string>();
		const clipIdFrom = (runtimeNodeId: string): string => {
			const clipId = /::item::(clip-[01])(?:::|$)/.exec(decodeURIComponent(runtimeNodeId))?.[1];
			if (!clipId) throw new Error(`Runtime node lost Clip identity: ${runtimeNodeId}`);
			return clipId;
		};
		const deps: WorkflowNodeExecutorDependencies = {
			runAgent: async (request: WorkflowAgentRunRequest) => {
				const clipId = clipIdFrom(request.nodeId);
				const index = Number(clipId.slice("clip-".length));
				calls.push(`${clipId}:writer-start`);
				if (index === 0) {
					clipZeroStarted.resolve();
					await releaseClipZero.promise;
				}
				calls.push(`${clipId}:writer-finish`);
				if (index === 1) clipOneFinished.resolve();
				return {
					taskId: `writer-task-${clipId}`, text: JSON.stringify(clipProductionDraft(index)), assets: [],
					expectedDelivery: { artifactType: "tapcanvas.clip-production-packet/v2" },
					deliveryEvidence: { clipId }, deliveryVerification: { version: 2, status: "satisfied" },
					requestTerminal: { version: 1, terminal: true, status: "succeeded", reason: "delivery_verification_satisfied" },
				};
			},
			runJavascript: async () => ({ output: null, durationMs: 0 }),
			runImage: async (request) => {
				calls.push(`${clipIdFrom(request.runtimeNodeId)}:image-submit`);
				const imageNodeId = imageNodeByAsset.get(request.assetIdentity?.assetId ?? "");
				if (!imageNodeId) throw new Error("Image generation has no materialized node identity");
				return { status: "success", nodeId: imageNodeId, taskId: `image-task-${request.itemIndex}`,
					imageUrl: `https://media.example/${request.itemIndex}.png`, assetId: `image-asset-${request.itemIndex}`, reused: false };
			},
			materializeClipProductionNodes: async (request) => {
				calls.push(`materialize:${request.nodePlan.videoNodes.map((video) => video.clipId).join(",")}`);
				for (const image of request.nodePlan.imageNodes) imageNodeByAsset.set(image.assetItem.effectAssetId, image.nodeId);
				for (const video of request.nodePlan.videoNodes) videoNodeByClip.set(video.clipId, video.nodeId);
				return { imageNodeIds: request.nodePlan.imageNodes.map((image) => image.nodeId),
					videoNodeIds: request.nodePlan.videoNodes.map((video) => video.nodeId), edgeIds: ["edge-chapter"] };
			},
			runVideoEstimate: async (request) => ({
				estimateIdentity: `estimate-${request.clips[0]?.itemId ?? "empty"}`,
				modelKey: request.modelKey, resolution: request.resolution, aspectRatio: request.aspectRatio,
				generationContract: { videoModel: request.modelKey, durationOptions: [5], maxDurationSeconds: 5,
					referenceAudioPolicy: { minimumDurationSeconds: 0, maximumDurationSeconds: 0 },
					supportsTextToVideo: true, supportsReferenceImages: true, supportsFirstLastFrame: true, maxReferenceImages: 4 },
				estimatedCredits: request.clips.length,
				perClip: request.clips.map((clip) => ({ ...clip, credits: 1 })),
			}),
			runVideo: async (request) => {
				const clipId = request.clipId;
				if (!clipId) throw new Error("Provider submission lost Clip identity");
				calls.push(`${clipId}:video-submit-accepted`);
				const nodeId = videoNodeByClip.get(clipId);
				if (!nodeId) throw new Error(`Clip ${clipId} has no materialized video node`);
				return { status: "success", nodeId, taskId: `video-task-${clipId}`,
					providerAcceptedAt: "2026-09-30T00:00:00.000Z", videoUrl: `https://media.example/${clipId}.mp4`,
					thumbnailUrl: null, reused: false };
			},
		};
		const runNode = (context: WorkflowNodeExecutionContext) => executeWorkflowNodeByMode(context, deps, (itemContext, dependencies) => (
			runWorkflowPipelineNode(itemContext, dependencies, (stepContext, stepDependencies) => (
				executeWorkflowNodeByMode(stepContext, stepDependencies, executeRegisteredWorkflowNode)))));
		const base = { executionId: "full-video-execution", executionFamilyId: "full-video-family", ownerId: "owner-1",
			flowId: "flow-1", projectId: "project-1", workflowKey: "video" } as const;
		const clipIds = ["clip-0", "clip-1"];
		const sources = clipIds.map((_, index) => sourceSegment(index));
		const sequences = clipIds.map((_, index) => chapterSequenceClip(index));

		const planning = runNode({ ...base, node: await fullVideoNode(), inputs: {
			"delivery-contract": [deliveryContract()],
			"source-segments": [collection(sources, clipIds, "clip-segments")],
			"clip-sequences": [collection(sequences, clipIds, "clip-sequences")],
			"chapter-assets": [chapterAssets()],
		} });
		try {
			const progressed = await Promise.race([
				Promise.all([clipZeroStarted.promise, clipOneFinished.promise]).then(() => ({ kind: "progressed" as const })),
				planning.then((settled) => ({ kind: "settled" as const, settled })),
				new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 3000)),
			]);
			if (progressed.kind === "settled") throw new Error(`Planning settled before both writers ran: ${JSON.stringify(progressed.settled)}`);
			if (progressed.kind === "timeout") throw new Error(`Writers did not both start; reached: ${calls.join(" | ")}`);
			// Give any eager per-Clip continuation a chance to run before asserting the barrier.
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(calls).toContain("clip-1:writer-finish");
			expect(calls).not.toContain("clip-0:writer-finish");
			expect(calls.some((call) => call.startsWith("materialize:"))).toBe(false);
			expect(calls.some((call) => call.endsWith(":image-submit") || call.endsWith(":video-submit-accepted"))).toBe(false);
		} finally {
			releaseClipZero.resolve();
		}
		const planned = await planning;
		expect(planned.ok, JSON.stringify(planned)).toBe(true);
		if (!planned.ok) throw new Error("Full-video planning failed");
		// One materialization for the whole chapter, and planning itself submits no media.
		expect(calls.filter((call) => call.startsWith("materialize:"))).toEqual(["materialize:clip-0,clip-1"]);
		expect(calls.some((call) => call.endsWith(":image-submit") || call.endsWith(":video-submit-accepted"))).toBe(false);
		const mediaItems = planned.outputRefs.ports["media-items"];
		if (!isWorkflowCollection(mediaItems)) throw new Error("Planning did not emit whole-chapter media items");
		expect(mediaItems.items.map((item) => item.itemId)).toEqual(clipIds);

		const media = await runNode({ ...base, node: await mediaNode("full_video"), inputs: {
			authorization: [{ onlyVideoNodes: false }], "delivery-contract": [deliveryContract()], "media-items": [mediaItems],
		} });
		expect(media.ok, JSON.stringify(media)).toBe(true);
		if (!media.ok) throw new Error("Full-video media pipeline failed");
		const materializedAt = calls.indexOf("materialize:clip-0,clip-1");
		for (const clipId of clipIds) {
			expect(calls.indexOf(`${clipId}:video-submit-accepted`)).toBeGreaterThan(materializedAt);
		}
		const promptPackages = media.outputRefs.ports["prompt-package"];
		const estimates = media.outputRefs.ports.estimate;
		const videoAssets = media.outputRefs.ports["video-assets"];
		if (!isWorkflowCollection(promptPackages) || !isWorkflowCollection(estimates) || !isWorkflowCollection(videoAssets)) {
			throw new Error("Full-video per-Clip receipts are not WorkflowCollections");
		}
		const aggregated = aggregateClipProduction({ executionId: base.executionId, nodeId: "aggregate-test",
			sourceSegments: collection(sources, clipIds, "clip-segments"), promptPackages, estimates, videoAssets });
		expect(aggregated.clipCount).toBe(2);
		expect(aggregated.ports["prompt-package"]).toMatchObject({ clips: [
			{ itemId: "clip-0", clipIndex: 0, durationSeconds: 5 }, { itemId: "clip-1", clipIndex: 1, durationSeconds: 5 },
		], deliveryEvidence: { clipCount: 2, totalDurationSeconds: 10 } });
		expect(aggregated.ports.estimate).toMatchObject({ estimatedCredits: 2,
			perClip: [{ itemId: "clip-0", durationSeconds: 5 }, { itemId: "clip-1", durationSeconds: 5 }] });
		expect(aggregated.ports["video-assets"]).toMatchObject({ items: [
			{ itemId: "clip-0", value: expect.objectContaining({ videoUrl: "https://media.example/clip-0.mp4" }) },
			{ itemId: "clip-1", value: expect.objectContaining({ videoUrl: "https://media.example/clip-1.mp4" }) },
		] });
		expect(media.outputRefs.itemRuns.map((run) => run.itemId)).toEqual(clipIds);
		expect(media.outputRefs.itemRuns.every((run) => run.status === "success")).toBe(true);
	}, 20000);

	it("puts chapter asset cards on the canvas and generates them under the identity Clip pipelines later claim", async () => {
		const previewMaterialized: string[] = [];
		const clipMaterialized: string[] = [];
		const imageRequests: Array<{ runtimeNodeId: string; assetId: string; family: string; prompt: string; imageQuality: string }> = [];
		const deps: WorkflowNodeExecutorDependencies = {
			runAgent: async () => ({
				taskId: "writer-task-clip-0", text: JSON.stringify(clipProductionDraft(0)), assets: [],
				expectedDelivery: { artifactType: "tapcanvas.clip-production-packet/v2" },
				deliveryEvidence: { clipId: "clip-0" }, deliveryVerification: { version: 2, status: "satisfied" },
				requestTerminal: { version: 1, terminal: true, status: "succeeded", reason: "delivery_verification_satisfied" },
			}),
			runJavascript: async () => ({ output: null, durationMs: 0 }),
			materializeClipProductionNodes: async (request) => {
				const target = request.nodePlan.videoNodes.length === 0 ? previewMaterialized : clipMaterialized;
				target.push(...request.nodePlan.imageNodes.map((image) => image.nodeId));
				return { imageNodeIds: request.nodePlan.imageNodes.map((image) => image.nodeId),
					videoNodeIds: request.nodePlan.videoNodes.map((video) => video.nodeId), edgeIds: [] };
			},
			runImage: async (request) => {
				imageRequests.push({ runtimeNodeId: request.runtimeNodeId, assetId: request.assetIdentity?.assetId ?? "",
					family: request.executionFamilyId, prompt: request.prompt, imageQuality: request.imageQuality ?? "" });
				return { status: "success", nodeId: previewMaterialized[0] ?? clipMaterialized[0] ?? "missing",
					taskId: "image-task", imageUrl: "https://media.example/character.png", assetId: "image-asset", reused: false };
			},
			runVideo: async () => { throw new Error("Video submission is outside the asset identity contract under test"); },
		};
		const runNode = (context: WorkflowNodeExecutionContext) => executeWorkflowNodeByMode(context, deps, (itemContext, dependencies) => (
			runWorkflowPipelineNode(itemContext, dependencies, (stepContext, stepDependencies) => (
				executeWorkflowNodeByMode(stepContext, stepDependencies, executeRegisteredWorkflowNode)))));
		const base = { executionId: "execution-preview", executionFamilyId: "family-preview", ownerId: "owner-1",
			flowId: "flow-1", projectId: "project-1", workflowKey: "video" } as const;

		const preview = await runNode({ ...base, node: await fullVideoTemplateNode("chapter-asset-preview"),
			inputs: { "chapter-assets": [chapterAssets()], "delivery-contract": [deliveryContract()] } });
		expect(preview.ok, JSON.stringify(preview)).toBe(true);
		expect(previewMaterialized).toHaveLength(1);
		expect(imageRequests).toHaveLength(1);

		// Planning persists the chapter's nodes; the media stage stops after image
		// generation here (no estimate runner), since only its image identity matters.
		const planning = await runNode({ ...base, node: await fullVideoNode(), inputs: {
			"delivery-contract": [deliveryContract()],
			"source-segments": [collection([sourceSegment(0)], ["clip-0"], "clip-segments")],
			"clip-sequences": [collection([chapterSequenceClip(0)], ["clip-0"], "clip-sequences")],
			"chapter-assets": [chapterAssets()],
		} });
		expect(planning.ok, JSON.stringify(planning)).toBe(true);
		if (!planning.ok) throw new Error("Full-video planning failed");
		expect(clipMaterialized).toEqual(previewMaterialized);
		const clipRun = await runNode({ ...base, node: await mediaNode("full_video"), inputs: {
			authorization: [{ onlyVideoNodes: true }], "delivery-contract": [deliveryContract()],
			"media-items": [planning.outputRefs.ports["media-items"]],
		} });
		expect(imageRequests.length, JSON.stringify(clipRun).slice(0, 600)).toBeGreaterThanOrEqual(2);
		const [previewImage, clipImage] = imageRequests;
		expect(clipImage?.runtimeNodeId).not.toBe(previewImage?.runtimeNodeId);
		expect({ ...clipImage, runtimeNodeId: "" }).toEqual({ ...previewImage, runtimeNodeId: "" });
	}, 20000);
});
