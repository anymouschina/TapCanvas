import type { AppContext } from "../../types";
import { fetchTaskResultForPolling } from "../task/task.polling";
import { buildProviderTaskFailureMessage } from "../task/provider-task-failure";
import type { WorkflowImageRunResult, WorkflowVideoRunResult } from "./execution.node-executors";

/** An accepted task belongs to the execution, independently of its canvas projection. */
export async function reconcileWorkflowMediaReceipt(
	context: AppContext, ownerId: string, nodeId: string, taskId: string, media: "image",
): Promise<WorkflowImageRunResult>;
export async function reconcileWorkflowMediaReceipt(
	context: AppContext, ownerId: string, nodeId: string, taskId: string, media: "video",
): Promise<WorkflowVideoRunResult>;
export async function reconcileWorkflowMediaReceipt(
	context: AppContext, ownerId: string, nodeId: string, taskId: string, media: "image" | "video",
): Promise<WorkflowImageRunResult | WorkflowVideoRunResult> {
	const observedAt = new Date().toISOString();
	try {
		const outcome = await fetchTaskResultForPolling(context, ownerId, { taskId, mode: "public", timeoutMs: 20_000 })
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ message: "workflow_media_receipt_query_failed", nodeId, taskId, media, observedAt, failureReason: message }));
				return { observationFailure: { observedAt, message } };
			});
		if ("observationFailure" in outcome) {
			return { status: "waiting_external", nodeId, taskId, reused: true, observationFailure: outcome.observationFailure };
		}
		if (!outcome.ok) {
			const message = `Accepted media receipt query failed (HTTP ${outcome.status})`;
			if (outcome.status === 429 || outcome.status >= 500) {
				console.error(JSON.stringify({ message: "workflow_media_receipt_query_failed", nodeId, taskId, media, observedAt, failureReason: message }));
				return { status: "waiting_external", nodeId, taskId, reused: true, observationFailure: { observedAt, message } };
			}
			throw new Error(message);
		}
		const result = outcome.result;
		if (result.id !== taskId) throw new Error("Accepted media receipt task identity mismatch");
		console.info(JSON.stringify({ message: "workflow_media_receipt_reconciled", nodeId, taskId, media, observedAt,
			canvasProjection: "missing", providerStatus: result.status, assetIds: result.assets.map(asset => asset.assetId).filter(Boolean) }));
		if (result.status === "queued" || result.status === "running") {
			return { status: "waiting_external", nodeId, taskId, reused: true };
		}
		if (result.status === "failed") return { status: "failed", nodeId, taskId,
			errorMessage: buildProviderTaskFailureMessage(result) || `Accepted media task ${taskId} failed` };
		const asset = result.assets.find(candidate => candidate.type === media);
		if (!asset) throw new Error(`Successful task ${taskId} has no ${media} asset receipt`);
		const url = new URL(asset.url);
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Media receipt has no persistent HTTP(S) asset URL");
		if (media === "image") {
			if (!asset.assetId) throw new Error("Image receipt lacks the asset identity required for downstream binding without a canvas node");
			return { status: "success", nodeId, taskId, reused: true, imageUrl: asset.url, assetId: asset.assetId };
		}
		return { status: "success", nodeId, taskId, reused: true, videoUrl: asset.url, thumbnailUrl: asset.thumbnailUrl ?? null };
	} catch (error: unknown) {
		console.error(JSON.stringify({ message: "workflow_media_receipt_query_failed", nodeId, taskId, media, observedAt,
			failureReason: error instanceof Error ? error.message : String(error) }));
		throw error;
	}
}
