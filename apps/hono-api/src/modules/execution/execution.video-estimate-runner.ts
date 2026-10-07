import type { WorkerEnv } from "../../types";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import { buildVideoBillingSpecKey } from "../task/agents-tool-bridge.generate-video-to-canvas";
import { resolveProjectBillingTeamId } from "../task/agents-tool-bridge.billing-scope";
import { resolveVideoGenerationContract } from "../task/video-orchestrator.generation-contract";
import type { WorkflowVideoEstimateRequest, WorkflowVideoEstimateResult } from "./execution.node-executors";
import { createWorkflowInternalContext } from "./execution.video-runner";

export async function estimateWorkflowVideo(
	env: WorkerEnv,
	request: WorkflowVideoEstimateRequest,
): Promise<WorkflowVideoEstimateResult> {
	const context = createWorkflowInternalContext(env, request);
	if (request.projectId) {
		context.set("activeTeamId", await resolveProjectBillingTeamId(env.DB, {
			projectId: request.projectId,
			userId: request.ownerId,
		}));
	}
	const generationContract = await resolveVideoGenerationContract({
		c: context,
		videoModel: request.modelKey,
		videoInputModes: [...new Set(request.clips.flatMap((clip) => (
			clip.videoInputMode === "image_to_video" || clip.videoInputMode === "reference_to_video" || clip.videoInputMode === "text_to_video"
				? [clip.videoInputMode]
				: []
		)))],
	});
	const perClip = [];
	let estimatedCredits = 0;
	for (const clip of request.clips) {
		if (clip.videoInputMode === "image_to_video" || clip.videoInputMode === "reference_to_video") {
			if (clip.videoInputMode === "image_to_video" && generationContract.supportsFirstLastFrame !== true) {
				throw new Error(`Video model ${request.modelKey} does not declare first/last frame support`);
			}
			if (clip.videoInputMode === "reference_to_video" && generationContract.supportsReferenceImages !== true) {
				throw new Error(`Video model ${request.modelKey} does not declare reference-image support`);
			}
			const referenceImageCount = clip.referenceImageCount ?? request.referenceImageCount ?? 0;
			if (referenceImageCount <= 0) throw new Error(`Clip ${clip.itemId} requires at least one image reference`);
			if (generationContract.maxReferenceImages !== null && generationContract.maxReferenceImages !== undefined
				&& referenceImageCount > generationContract.maxReferenceImages) {
				throw new Error(`Clip ${clip.itemId} has ${referenceImageCount} image references but model ${request.modelKey} supports at most ${generationContract.maxReferenceImages}`);
			}
		}
		const credits = await resolveTeamCreditsCostForTask(context, {
			taskKind: "image_to_video",
			modelKey: request.modelKey,
			specKey: buildVideoBillingSpecKey(request.resolution, clip.durationSeconds),
		});
		estimatedCredits += credits;
		perClip.push({ itemId: clip.itemId, durationSeconds: clip.durationSeconds, credits });
	}
	return {
		estimateIdentity: `${request.executionId}:${request.runtimeNodeId}:estimate`,
		modelKey: request.modelKey,
		resolution: request.resolution,
		...(request.size ? { size: request.size } : {}),
		aspectRatio: request.aspectRatio,
		generationContract,
		estimatedCredits: Math.round(estimatedCredits * 100) / 100,
		perClip,
	};
}
