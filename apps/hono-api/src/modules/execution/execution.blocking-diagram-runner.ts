import { isDeepStrictEqual } from "node:util";

import type { WorkerEnv } from "../../types";
import { sha256Hex } from "../asset/book-content-hash";
import { renderBlockingDiagramToCanvas } from "../task/agents-tool-bridge.blocking-diagram";
import { freshReadFlowRow, persistFlowPatch } from "../task/video-orchestrator.flow-io";
import { createWorkflowInternalContext } from "./execution.video-runner";
import { resolveBlockingBackgroundBinding } from "./execution.blocking-backgrounds";

type JsonRecord = Record<string, unknown>;

export type WorkflowBlockingDiagramRequest = Readonly<{
	executionId: string;
	executionFamilyId: string;
	runtimeNodeId: string;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	chapterId?: string | null;
	beatSheetArtifact: unknown;
	backgroundBindings?: unknown;
}>;

export type WorkflowBlockingDiagramResult = Readonly<{
	beatSheetArtifact: Readonly<Record<string, unknown>>;
	bindings: readonly Readonly<{
		clipId: string;
		clipIndex: number;
		nodeId: string;
		imageUrl: string;
		reused: boolean;
	}>[];
}>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function persistentHttpUrl(value: unknown): string | null {
	const candidate = readString(value);
	if (!candidate) return null;
	try {
		const parsed = new URL(candidate);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
	} catch {
		return null;
	}
}

function parseBeatSheetArtifact(value: unknown): Readonly<{
	envelope: JsonRecord;
	beatSheet: JsonRecord & Readonly<{ beats: readonly unknown[] }>;
}> {
	const envelope = isRecord(value) ? { ...value } : {};
	const encoded = isRecord(value) && typeof value.text === "string" ? value.text : value;
	let parsed: unknown = encoded;
	if (typeof encoded === "string") {
		try {
			parsed = JSON.parse(encoded) as unknown;
		} catch (error: unknown) {
			throw new Error(`Blocking diagram materializer received invalid BeatSheet JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
		throw new Error("Blocking diagram materializer requires a non-empty BeatSheet beats array");
	}
	return { envelope, beatSheet: parsed as JsonRecord & Readonly<{ beats: readonly unknown[] }> };
}

function flowNodes(rowData: string): JsonRecord[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rowData) as unknown;
	} catch (error: unknown) {
		throw new Error(`Canvas flow is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) throw new Error("Canvas flow has no nodes array");
	return parsed.nodes.filter(isRecord);
}

function matchingPersistedDiagram(input: Readonly<{
	nodes: readonly JsonRecord[];
	nodeId: string;
	blockingPlan: JsonRecord;
}>): Readonly<{ imageUrl: string }> | null {
	const existing = input.nodes.find((node) => readString(node.id) === input.nodeId);
	if (!existing) return null;
	if (!isRecord(existing.data)) throw new Error(`Blocking diagram ${input.nodeId} has invalid node data`);
	const imageUrl = persistentHttpUrl(existing.data.imageUrl);
	if (!imageUrl
		|| readString(existing.data.productionLayer) !== "blocking_diagram"
		|| !isDeepStrictEqual(existing.data.blockingPlan, input.blockingPlan)) {
		throw new Error(`Blocking diagram ${input.nodeId} conflicts with the frozen workflow plan`);
	}
	return { imageUrl };
}

export async function materializeWorkflowBlockingDiagrams(
	env: WorkerEnv,
	request: WorkflowBlockingDiagramRequest,
): Promise<WorkflowBlockingDiagramResult> {
	const context = createWorkflowInternalContext(env, request);
	const parsed = parseBeatSheetArtifact(request.beatSheetArtifact);
	const bindings: Array<WorkflowBlockingDiagramResult["bindings"][number]> = [];
	const materializedBeats: JsonRecord[] = [];

	const materializeOne = async (clipIndex: number) => {
		const itemStartedAt = performance.now();
		const rawBeat = parsed.beatSheet.beats[clipIndex];
		if (!isRecord(rawBeat)) throw new Error(`BeatSheet beats[${clipIndex}] must be an object`);
		const clipId = readString(rawBeat.clipId);
		const blockingPlan = isRecord(rawBeat.blockingPlan) ? rawBeat.blockingPlan : null;
		if (!clipId || !blockingPlan) {
			throw new Error(`BeatSheet beats[${clipIndex}] requires clipId and the Agent-authored blockingPlan`);
		}
		const background = resolveBlockingBackgroundBinding(blockingPlan, request.backgroundBindings);
		const nodeId = `blocking-workflow-${sha256Hex(`${request.executionFamilyId}:${clipId}`).slice(0, 24)}`;
		const readStartedAt = performance.now();
		let row = await freshReadFlowRow({
			c: context,
			flowId: request.flowId,
			requestUserId: request.ownerId,
			devBypass: false,
			...(request.chapterId ? { chapterId: request.chapterId } : {}),
		});
		const initialReadMs = performance.now() - readStartedAt;
		let renderAndUploadMs = 0;
		let persistMs = 0;
		let readBackMs = 0;
		const persisted = matchingPersistedDiagram({
			nodes: flowNodes(row.data),
			nodeId,
			blockingPlan,
		});
		let imageUrl = persisted?.imageUrl ?? null;
		let reused = Boolean(persisted);
		if (!imageUrl) {
			const renderStartedAt = performance.now();
			const rendered = await renderBlockingDiagramToCanvas({
				c: context,
				requestUserId: request.ownerId,
				bodyArgs: { ...blockingPlan, ...(background ? { backgroundImageUrl: background.imageUrl } : {}) },
			});
			renderAndUploadMs = performance.now() - renderStartedAt;
			imageUrl = rendered.imageUrl;
			const node = {
				id: nodeId,
				type: "taskNode",
				position: { x: 520, y: 120 + clipIndex * 360 },
				data: {
					kind: "image",
					label: `站位图｜Clip ${clipIndex + 1}`,
					status: "success",
					imageUrl,
					imageResults: [{ url: imageUrl }],
					referenceType: "blocking",
					productionLayer: "blocking_diagram",
					clipId,
					clipIndex,
					sceneName: readString(blockingPlan.sceneName),
					durationSeconds: blockingPlan.durationSeconds,
					blockingPlan,
					...(background ? { backgroundNodeId: background.nodeId } : {}),
					compositionContract: rendered.compositionContract,
					compositionContractHash: rendered.compositionContractHash,
					compositionDiagnostics: rendered.compositionDiagnostics,
					workflowExecutionId: request.executionId,
					workflowExecutionFamilyId: request.executionFamilyId,
					workflowRuntimeNodeId: request.runtimeNodeId,
				},
			};
			const persistStartedAt = performance.now();
			await persistFlowPatch({
				c: context,
				row,
				flowId: request.flowId,
				requestUserId: request.ownerId,
				devBypass: false,
				...(request.chapterId ? { chapterId: request.chapterId } : {}),
				patch: { createNodes: [node] },
				affectedNodeIds: [nodeId],
			});
			persistMs = performance.now() - persistStartedAt;
			const readBackStartedAt = performance.now();
			row = await freshReadFlowRow({
				c: context,
				flowId: request.flowId,
				requestUserId: request.ownerId,
				devBypass: false,
				...(request.chapterId ? { chapterId: request.chapterId } : {}),
			});
			readBackMs = performance.now() - readBackStartedAt;
			const readBack = matchingPersistedDiagram({ nodes: flowNodes(row.data), nodeId, blockingPlan });
			if (!readBack || readBack.imageUrl !== imageUrl) {
				throw new Error(`Blocking diagram ${nodeId} read-back failed`);
			}
			reused = false;
		}
		console.info(JSON.stringify({
			event: "workflow_blocking_diagram_timing",
			executionId: request.executionId,
			runtimeNodeId: request.runtimeNodeId,
			clipId, clipIndex, nodeId, reused,
			initialReadMs, renderAndUploadMs, persistMs, readBackMs,
			elapsedMs: performance.now() - itemStartedAt,
		}));
		return {
			binding: { clipId, clipIndex, nodeId, imageUrl, reused },
			beat: { ...rawBeat, blockingFrameNodeId: nodeId, spatialBlocking: true },
		};
	};

	// Download/render/upload independent diagrams with bounded memory. Canvas
	// writes retain the existing atomic revision/retry protocol. Await the whole
	// batch on error so every completed upload can persist its own result.
	const concurrency = 4;
	for (let start = 0; start < parsed.beatSheet.beats.length; start += concurrency) {
		const results = await Promise.allSettled(Array.from(
			{ length: Math.min(concurrency, parsed.beatSheet.beats.length - start) },
			(_, offset) => materializeOne(start + offset),
		));
		const errors: unknown[] = [];
		for (const result of results) {
			if (result.status === "rejected") errors.push(result.reason);
			else { bindings.push(result.value.binding); materializedBeats.push(result.value.beat); }
		}
		if (errors.length) throw new AggregateError(errors,
			`Blocking diagram materialization failed: ${errors.map(error => error instanceof Error ? error.message : String(error)).join("; ")}`);
	}

	const beatSheet = { ...parsed.beatSheet, beats: materializedBeats };
	return {
		beatSheetArtifact: {
			...parsed.envelope,
			text: JSON.stringify(beatSheet),
			blockingDiagrams: bindings,
		},
		bindings,
	};
}
