import type { WorkerEnv } from "../../types";
import { AppError } from "../../middleware/error";
import { concatVideosToCanvas } from "../task/agents-tool-bridge.video-concat";
import type { ConcatVideosToCanvasResult } from "../task/agents-tool-bridge.video-concat";
import type { WorkflowVideoConcatRequest, WorkflowVideoConcatResult } from "./execution.node-executors";
import { createWorkflowInternalContext } from "./execution.video-runner";
import { registerGeneratedMediaAsset } from "../asset/asset.hosting";

export async function concatWorkflowVideos(
	env: WorkerEnv,
	request: WorkflowVideoConcatRequest,
): Promise<WorkflowVideoConcatResult> {
	if (request.videoUrls.length === 0) throw new Error("Workflow concat requires at least one persistent video URL");
	if (!request.projectId) throw new Error("Workflow concat requires a project id for final asset registration");
	const internalContext = createWorkflowInternalContext(env, request);
	if (request.videoUrls.length === 1) {
		const videoUrl = request.videoUrls[0];
		const assetId = await registerGeneratedMediaAsset({
			c: internalContext,
			userId: request.ownerId,
			meta: {
				type: "video",
				url: videoUrl,
				sourceUrl: videoUrl,
				taskId: request.executionId,
				generationContext: {
					projectId: request.projectId,
					flowId: request.flowId,
					...(request.chapterId ? { chapterId: request.chapterId } : {}),
					nodeId: request.runtimeNodeId,
					workflowExecutionId: request.executionId,
				},
				durationSec: request.targetDurationSeconds,
			},
		});
		return { videoUrl, assetId, clipCount: 1, reusedSingleClip: true } as const;
	}
	// 多段成片由独立 media-worker 在后台拼接并直接上传对象存储。
	let result: ConcatVideosToCanvasResult;
	try {
		result = await concatVideosToCanvas({
			c: internalContext,
			requestUserId: request.ownerId,
			row: null,
			bodyArgs: {
				clipUrls: request.videoUrls,
				fileName: `${request.executionId}-${request.runtimeNodeId}.mp4`,
				aspectRatio: request.aspectRatio,
			},
		});
	} catch (error: unknown) {
		if (error instanceof AppError) {
			const detailMessage = error.details && typeof error.details === "object" && !Array.isArray(error.details)
				&& typeof (error.details as Record<string, unknown>).message === "string"
				? (error.details as Record<string, unknown>).message as string
				: "";
			throw new Error(detailMessage ? `${error.code}: ${detailMessage}` : `${error.code}: ${error.message}`);
		}
		throw error;
	}
	const assetId = await registerGeneratedMediaAsset({
		c: internalContext,
		userId: request.ownerId,
		meta: {
			type: "video",
			url: result.videoUrl,
			sourceUrl: result.videoUrl,
			vendor: "media-worker",
			taskId: request.executionId,
			generationContext: {
				projectId: request.projectId,
				flowId: request.flowId,
				...(request.chapterId ? { chapterId: request.chapterId } : {}),
				nodeId: request.runtimeNodeId,
				workflowExecutionId: request.executionId,
			},
			durationSec: request.targetDurationSeconds,
		},
	});
	return {
		videoUrl: result.videoUrl,
		assetId,
		clipCount: result.clipCount,
		concatPolicy: result.concatPolicy,
		reusedSingleClip: false,
	} as const;
}
