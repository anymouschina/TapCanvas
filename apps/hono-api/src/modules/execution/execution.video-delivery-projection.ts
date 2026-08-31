import type { WorkerEnv } from "../../types";
import {
	freshReadFlowRow,
	persistFlowPatch,
	readFlowEdges,
	readFlowNodes,
	type VideoFlowNode,
} from "../task/video-orchestrator.flow-io";
import { createWorkflowInternalContext } from "./execution.video-runner";

export type WorkflowFilmProjectionRequest = Readonly<{
	executionId: string;
	runtimeNodeId: string;
	ownerId: string;
	flowId: string;
	chapterId?: string | null;
	videoUrl: string;
	assetId: string;
	clipCount: number;
	targetDurationSeconds: number | null;
	aspectRatio: string;
	sourceNodeIds: readonly string[];
	concatPolicy?: Readonly<{
		joinMode: "hard_cut" | "xfade";
		xfadeSeconds: number;
		colorMatch: boolean;
	}>;
}>;

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Persist the durable workflow master into the delivery canvas.
 *
 * The execution concat runner creates the media artifact. This is the single
 * shared write boundary that makes that artifact visible in either a project
 * flow or a chapter canvas, and is idempotent by executionId.
 */
export async function projectWorkflowFilmToCanvas(
	env: WorkerEnv,
	input: WorkflowFilmProjectionRequest,
): Promise<void> {
	const videoUrl = readString(input.videoUrl);
	if (!videoUrl) throw new Error("workflow_film_projection_video_url_missing");
	const assetId = readString(input.assetId);
	if (!assetId) throw new Error("workflow_film_projection_asset_id_missing");

	const c = createWorkflowInternalContext(env, {
		executionId: input.executionId,
		runtimeNodeId: input.runtimeNodeId,
		ownerId: input.ownerId,
	});
	const row = await freshReadFlowRow({
		c,
		flowId: input.flowId,
		requestUserId: input.ownerId,
		devBypass: false,
		...(input.chapterId ? { chapterId: input.chapterId } : {}),
	});
	const nodes = readFlowNodes(row);
	const nodeId = `film-${input.executionId}`;
	const current = nodes.find((node) => node.id === nodeId) ?? null;
	const existingEdges = new Set(readFlowEdges(row).map((edge) => readString(edge.id)).filter(Boolean));
	const sourceNodeSet = new Set(nodes.map((node) => node.id));
	const sourceNodeIds = input.sourceNodeIds.filter((sourceId, index, all) => (
		sourceId && sourceNodeSet.has(sourceId) && all.indexOf(sourceId) === index
	));
	const createEdges = sourceNodeIds.flatMap((sourceId, index) => {
		const id = `e-workflow-film-${input.executionId}-${index + 1}`;
		if (existingEdges.has(id)) return [];
		return [{
			id,
			source: sourceId,
			target: nodeId,
			type: "typed",
			label: `片段 ${index + 1}`,
			data: { edgeType: "video", relationKind: "compose_source", executionRole: "source" },
		}];
	});
	const filmData: Record<string, unknown> = {
		kind: "composeVideo",
		label: `成片 ${input.targetDurationSeconds ?? ""}s`,
		status: "success",
		videoUrl,
		assetId,
		serverAssetId: assetId,
		assetRegistrationStatus: "ready",
		videoResults: [{ url: videoUrl, assetId }],
		clipRunId: input.executionId,
		clipCount: input.clipCount,
		...(input.targetDurationSeconds !== null ? { durationSeconds: input.targetDurationSeconds } : {}),
		...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
		...(input.concatPolicy ? { concatPolicy: input.concatPolicy } : {}),
	};
	await persistFlowPatch({
		c,
		row,
		flowId: input.flowId,
		requestUserId: input.ownerId,
		devBypass: false,
		...(input.chapterId ? { chapterId: input.chapterId } : {}),
		affectedNodeIds: [nodeId],
		patch: (current
			? {
				patchNodeData: [{ id: nodeId, data: filmData }],
				allowOverwrite: true,
				...(createEdges.length ? { createEdges } : {}),
			}
			: {
				createNodes: [{
					id: nodeId,
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: filmData,
				}],
				...(createEdges.length ? { createEdges } : {}),
			}) as never,
	});
}
