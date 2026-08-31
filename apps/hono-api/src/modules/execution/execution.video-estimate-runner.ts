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
	});
	const perClip = [];
	let estimatedCredits = 0;
	for (const clip of request.clips) {
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
		aspectRatio: request.aspectRatio,
		generationContract,
		estimatedCredits: Math.round(estimatedCredits * 100) / 100,
		perClip,
	};
}
