import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assetFactIdentity } from "./execution.asset-identity";
import { reconcileWorkflowMediaReceipt } from "./execution.media-receipt";
import { matchesWorkflowMediaItemRuntimeNodeId } from "./execution.media-retry";
import { appendSceneCardConstraint } from "../../../../../packages/schemas/scene-card-prompt";
import type { AppContext, WorkerEnv } from "../../types";
import { resolveProjectBillingTeamId } from "../task/agents-tool-bridge.billing-scope";
import {
	generateImageToCanvas,
	reconcileImageNodesForFlow,
} from "../task/agents-tool-bridge.generate-image-to-canvas";
import type { WorkflowImageRunRequest, WorkflowImageRunResult } from "./execution.node-executors";
import { buildInternalApiKey } from "../apiKey/internal-api-key";
import { freshReadFlowRow } from "../task/video-orchestrator.flow-io";
import { isProviderTaskPendingStatus } from "../task/provider-task-status";
import { workflowImageSemanticLabel } from "./execution.media-label";
import { buildWorkflowImageTaskId } from "../task/workflow-image-effect-claim";
import { getTaskResultByTaskId } from "../task/task-result.repo";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function createInternalContext(env: WorkerEnv, request: WorkflowImageRunRequest): AppContext {
	const values = new Map<string, unknown>([
		["requestId", `workflow-image:${request.executionId}:${request.runtimeNodeId}`],
		["userId", request.ownerId],
		["publicApi", false],
	]);
	const internalToken = readString(env.INTERNAL_WORKER_TOKEN);
	const apiKey = buildInternalApiKey({
		internalWorkerToken: internalToken,
		userId: request.ownerId,
	}) ?? "";
	return {
		env,
		req: {
			url: "https://workflow.internal/executions/image-node",
			header: (name: string) => name.toLowerCase() === "x-api-key" && apiKey ? apiKey : undefined,
		} as unknown as AppContext["req"],
		get: (key: string) => values.get(key),
		set: (key: string, value: unknown) => { values.set(key, value); },
	} as unknown as AppContext;
}

function persistentHttpUrl(value: unknown): string | null {
	const candidate = readString(value);
	if (!candidate) return null;
	try {
		const parsed = new URL(candidate);
		return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
	} catch {
		return null;
	}
}

function flowNode(rowData: string, nodeId: string): Record<string, unknown> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rowData) as unknown;
	} catch (error: unknown) {
		throw new Error(`Canvas flow is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) throw new Error("Canvas flow has no nodes array");
	const matched = parsed.nodes.find((node) => isRecord(node) && readString(node.id) === nodeId);
	return isRecord(matched) ? matched : null;
}

function sameReferenceAssetBindings(
	value: unknown,
	expected: WorkflowImageRunRequest["referenceAssetBindings"],
): boolean {
	if (!Array.isArray(value)) return expected.length === 0;
	if (value.length !== expected.length) return false;
	return value.every((rawBinding, index) => {
		if (!isRecord(rawBinding)) return false;
		const expectedBinding = expected[index];
		if (!expectedBinding) return false;
		const strength = rawBinding.strength;
		return readString(rawBinding.assetId) === expectedBinding.assetId
			&& readString(rawBinding.role) === expectedBinding.role
			&& (expectedBinding.strength === undefined
				? strength === undefined
				: typeof strength === "number" && strength === expectedBinding.strength);
	});
}

function sameAssetMetadata(value: Record<string, unknown>, expected: WorkflowImageRunRequest["assetMetadata"]): boolean {
	if (!expected) return true;
	return Object.entries(expected).every(([key, expectedValue]) => (
		isDeepStrictEqual(value[key], expectedValue)
	));
}

export function composeWorkflowImagePrompt(
	request: Pick<WorkflowImageRunRequest, "prompt" | "stylePrompt" | "assetMetadata">,
): string {
	const styledPrompt = request.stylePrompt
		? `${request.prompt}\n\n[项目统一视觉风格]\n${request.stylePrompt}`.trim()
		: request.prompt.trim();
	const referenceType = request.assetMetadata?.referenceType;
	return appendSceneCardConstraint(styledPrompt, referenceType);
}

function workflowImageRequestMismatchFields(
	data: Record<string, unknown>,
	request: Pick<WorkflowImageRunRequest,
		"prompt" | "negativePrompt" | "modelKey" | "aspectRatio" | "imageSize" | "imageQuality" | "referenceAssetBindings" | "assetMetadata"
		| "styleReferenceImages" | "stylePrompt" | "styleFingerprint"
	>,
): readonly string[] {
	const expectedPrompt = composeWorkflowImagePrompt(request);
	return [
		["prompt", readString(data.prompt) === expectedPrompt],
		["negativePrompt", readString(data.negativePrompt) === request.negativePrompt.trim()],
		["modelKey", readString(data.modelKey) === request.modelKey],
		["aspect", (readString(data.aspect) || readString(data.aspectRatio)) === request.aspectRatio],
		["imageSize", readString(data.imageSize) === request.imageSize],
		["imageQuality", readString(data.imageQuality) === readString(request.imageQuality)],
		["referenceAssetBindings", sameReferenceAssetBindings(data.referenceAssetBindings, request.referenceAssetBindings)],
		["styleImages", JSON.stringify(data.styleImages ?? []) === JSON.stringify(request.styleReferenceImages ?? [])],
		["stylePrompt", readString(data.stylePrompt) === readString(request.stylePrompt)],
		["styleFingerprint", readString(data.styleFingerprint) === readString(request.styleFingerprint)],
		["assetMetadata", sameAssetMetadata(data, request.assetMetadata)],
	].flatMap(([field, matches]) => matches ? [] : [field as string]);
}

export function persistedWorkflowImageRequestMatches(
	data: Record<string, unknown>,
	request: Parameters<typeof workflowImageRequestMismatchFields>[1],
): boolean {
	return workflowImageRequestMismatchFields(data, request).length === 0;
}

export function inspectPersistedWorkflowImageNode(
	rowData: string,
	nodeId: string,
	taskId: string | null,
): WorkflowImageRunResult {
	const node = flowNode(rowData, nodeId);
	if (!node || !isRecord(node.data)) {
		if (taskId) {
			return { status: "waiting_external", nodeId, taskId, reused: true };
		}
		return { status: "failed", nodeId, taskId: null, errorMessage: `Image output ${nodeId} has no persisted canvas node or accepted provider task identity` };
	}
	const data = node.data;
	const status = readString(data.status).toLowerCase();
	const persistedTaskId = readString(data.taskId) || readString(data.imageTaskId) || taskId || "";
	if (status === "submitting" && readString(data.workflowSubmissionState) === "submitting"
		&& readString(data.workflowEffectId) && !persistedTaskId) {
		// The durable claim is real; provider acceptance has not been observed.
		// Wait for that same claim's receipt, never submit an alternate task.
		return { status: "waiting_external", nodeId, taskId: null, reused: true };
	}
	if (isProviderTaskPendingStatus(status)) {
		if (!persistedTaskId) return { status: "failed", nodeId, taskId: null, errorMessage: `Persisted image node ${nodeId} is waiting without a provider task identity` };
		return { status: "waiting_external", nodeId, taskId: persistedTaskId, reused: true };
	}
	if (status === "failed" || status === "error") {
		return { status: "failed", nodeId, taskId: persistedTaskId || null, errorMessage: readString(data.errorMessage) || readString(data.error) || `Image task ${persistedTaskId} failed` };
	}
	const firstResult = Array.isArray(data.imageResults) && isRecord(data.imageResults[0]) ? data.imageResults[0] : null;
	const imageUrl = persistentHttpUrl(readString(data.imageUrl) || readString(firstResult?.url));
	if (status !== "success" || !imageUrl) {
		return { status: "failed", nodeId, taskId: persistedTaskId || null, errorMessage: `Image node ${nodeId} reached an invalid terminal state (${status || "missing"}) without a persistent HTTP(S) URL` };
	}
	return {
		status: "success",
		nodeId,
		taskId: persistedTaskId || null,
		imageUrl,
		assetId: readString(data.assetId) || readString(firstResult?.assetId) || null,
		reused: true,
	};
}

function isUnsubmittedPreparedImageNode(
	data: Record<string, unknown>,
): boolean {
	return data.workflowPreparedOnly === true && data.status === "idle"
		&& !readString(data.taskId) && !readString(data.imageTaskId)
		&& !readString(data.imageUrl) && !Array.isArray(data.imageResults);
}

export function workflowImageEffectIdentity(
	request: Pick<WorkflowImageRunRequest, "executionFamilyId" | "runtimeNodeId" | "authorizedRetry" | "assetIdentity">,
): Readonly<{
	canvasNodeId: string;
	effectId: string;
}> {
	const suffix = request.authorizedRetry ? `::retry::${request.authorizedRetry.retryKey}` : "";
	const identity = request.assetIdentity
		? assetFactIdentity("workflow-asset", request.assetIdentity)
		: request.runtimeNodeId;
	return {
		canvasNodeId: `${identity}::family::${request.executionFamilyId}::output::image${suffix}`,
		effectId: `${request.executionFamilyId}:${identity}:image-submit${suffix}`,
	};
}

async function runWorkflowImageAttempt(
	env: WorkerEnv,
	request: WorkflowImageRunRequest,
): Promise<WorkflowImageRunResult> {
	const context = createInternalContext(env, request);
	const readRow = () => freshReadFlowRow({
		c: context,
		flowId: request.flowId,
		requestUserId: request.ownerId,
		devBypass: false,
		...(request.chapterId ? { chapterId: request.chapterId } : {}),
	});
	let row = await readRow();
	const adoptRegisteredClaim = async (rowData: string, nodeId: string): Promise<WorkflowImageRunResult | null> => {
		const claimed = flowNode(rowData, nodeId);
		if (!claimed || !isRecord(claimed.data) || claimed.data.status !== "submitting"
			|| claimed.data.workflowSubmissionState !== "submitting" || readString(claimed.data.taskId)) return null;
		const effectId = readString(claimed.data.workflowEffectId);
		const taskId = readString(claimed.data.workflowTaskId);
		if (!effectId || !taskId) return null;
		if (taskId !== buildWorkflowImageTaskId({ ownerId: request.ownerId, effectId })
			|| !persistedWorkflowImageRequestMatches(claimed.data, request)) {
			throw new Error("Workflow image claim task identity or generation contract changed");
		}
		// Task registration and canvas receipt projection are separate durable writes.
		// Adopt only the exact owner-scoped task; absence never authorizes resubmission.
		const registered = await getTaskResultByTaskId(env.DB, request.ownerId, taskId);
		if (!registered) return null;
		console.info(JSON.stringify({ message: "workflow_image_claim_task_adopted", executionId: request.executionId,
			runtimeNodeId: request.runtimeNodeId, nodeId, taskId, effectId }));
		return reconcileWorkflowMediaReceipt(context, request.ownerId, nodeId, taskId, "image");
	};
	if (request.authorizedRetry) {
		const authorization = request.authorizedRetry;
		const exactRuntimeNodeId = authorization.executionMode === "once"
			? authorization.itemId === null && authorization.nodeId === request.runtimeNodeId
			: authorization.itemId !== null
				&& matchesWorkflowMediaItemRuntimeNodeId({
					nodeId: authorization.nodeId,
					itemId: authorization.itemId,
					runtimeNodeId: request.runtimeNodeId,
				});
		if (authorization.executorRef !== "tapcanvas.image.generate/v1" || authorization.taskId === null
			|| authorization.executionMode !== request.executionMode || !exactRuntimeNodeId) {
			throw new Error("media_retry_executor_identity_mismatch");
		}
		const original = flowNode(row.data, authorization.canvasNodeId);
		if (!original || !isRecord(original.data)
			|| !["failed", "error"].includes(readString(original.data.status))
			|| (readString(original.data.taskId) || readString(original.data.imageTaskId)) !== authorization.taskId
			|| persistentHttpUrl(readString(original.data.imageUrl))
			|| (Array.isArray(original.data.imageResults) && original.data.imageResults.length > 0)) {
			throw new Error("media_retry_failed_canvas_receipt_changed");
		}
		const confirmed = await reconcileWorkflowMediaReceipt(
			context, request.ownerId, authorization.canvasNodeId, authorization.taskId, "image",
		);
		if (confirmed.status !== "failed") return confirmed;
		row = await readRow();
		const latestOriginal = flowNode(row.data, authorization.canvasNodeId);
		if (!latestOriginal || !isRecord(latestOriginal.data)
			|| !["failed", "error"].includes(readString(latestOriginal.data.status))
			|| (readString(latestOriginal.data.taskId) || readString(latestOriginal.data.imageTaskId)) !== authorization.taskId
			|| persistentHttpUrl(readString(latestOriginal.data.imageUrl))
			|| (Array.isArray(latestOriginal.data.imageResults) && latestOriginal.data.imageResults.length > 0)) {
			const persisted = inspectPersistedWorkflowImageNode(row.data, authorization.canvasNodeId, authorization.taskId);
			if (persisted.status !== "failed") return persisted;
			throw new Error("media_retry_failed_canvas_receipt_changed");
		}
	}
	const previousNodeId = request.previousEvidence ? readString(request.previousEvidence.canvasNodeId) : "";
	const previousTaskId = request.previousEvidence ? readString(request.previousEvidence.taskId) : "";
	const identity = workflowImageEffectIdentity(request);
	let unsubmittedPreparedResume = false;
	if (previousNodeId && request.executionId !== request.executionFamilyId) {
		console.info(JSON.stringify({ message: "workflow_image_prior_receipt_decision",
			executionId: request.executionId, runtimeNodeId: request.runtimeNodeId,
			previousNodeId, identityNodeId: identity.canvasNodeId,
			previousTaskId, resumeOnly: request.resumeOnly,
		}));
	}
	if (request.resumeOnly) {
		console.info(JSON.stringify({
			message: "image_resume_evidence",
			executionId: request.executionId,
			runtimeNodeId: request.runtimeNodeId,
			itemIndex: request.itemIndex,
			previousNodeId,
			previousTaskId,
			evidenceKeys: request.previousEvidence ? Object.keys(request.previousEvidence) : [],
		}));
	}
	if (!request.authorizedRetry && previousNodeId) {
		const previousNode = flowNode(row.data, previousNodeId);
		if (previousNodeId === identity.canvasNodeId && !previousTaskId
			&& previousNode && isRecord(previousNode.data)
			&& isUnsubmittedPreparedImageNode(previousNode.data)) {
			const mismatches = workflowImageRequestMismatchFields(previousNode.data, request);
			if (mismatches.length > 0) {
				throw new Error(`Prepared image ${previousNodeId} has a different generation contract: ${mismatches.join(", ")}`);
			}
			const plannedTaskId = readString(previousNode.data.workflowTaskId);
			if (!plannedTaskId || plannedTaskId !== buildWorkflowImageTaskId({ ownerId: request.ownerId, effectId: identity.effectId })) {
				throw new Error("Prepared image node has an invalid durable task identity");
			}
			const registered = await getTaskResultByTaskId(env.DB, request.ownerId, plannedTaskId);
			if (registered) return reconcileWorkflowMediaReceipt(context, request.ownerId, previousNodeId, plannedTaskId, "image");
			// No task was accepted. This is the first submission for an already
			// prepared effect, even when a checkpoint resumed its image item.
			unsubmittedPreparedResume = true;
		} else {
		const adopted = await adoptRegisteredClaim(row.data, previousNodeId);
		if (adopted) return adopted;
		if (previousTaskId && !flowNode(row.data, previousNodeId)) {
			return reconcileWorkflowMediaReceipt(context, request.ownerId, previousNodeId, previousTaskId, "image");
		}
		let persisted = inspectPersistedWorkflowImageNode(row.data, previousNodeId, previousTaskId || null);

		if (persisted.status === "waiting_external" && persisted.taskId) {
			// A workflow execution is itself the durable owner of an accepted provider task.
			// Reconcile its persisted canvas receipt on every external check instead of waiting
			// for the browser or the stale-flow sweep.
			await reconcileImageNodesForFlow({
				c: context,
				requestUserId: request.ownerId,
				devBypass: false,
				flowId: request.flowId,
				row,
				...(previousTaskId ? { target: { nodeId: previousNodeId, taskId: previousTaskId } } : {}),
				...(request.chapterId ? { chapterId: request.chapterId } : {}),
			});
			row = await readRow();
			persisted = inspectPersistedWorkflowImageNode(row.data, previousNodeId, previousTaskId || null);
		}
		if (persisted.status === "waiting_external" && persisted.taskId && !flowNode(row.data, persisted.nodeId)) {
			return reconcileWorkflowMediaReceipt(context, request.ownerId, persisted.nodeId, persisted.taskId, "image");
		}
		return persisted;
		}
	}
	if (!request.authorizedRetry && previousTaskId) throw new Error("Persisted image receipt is incomplete; canvasNodeId is required");
	if (!request.authorizedRetry && request.resumeOnly && !unsubmittedPreparedResume) throw new Error("External image resume has no persisted canvas receipt; refusing a new provider submission");
	const existingNode = flowNode(row.data, identity.canvasNodeId);
	if (existingNode) {
		if (!isRecord(existingNode.data) || !persistedWorkflowImageRequestMatches(existingNode.data, request)) {
			throw new Error(`Workflow image output ${identity.canvasNodeId} already exists with a different generation contract`);
		}
		const prepared = isUnsubmittedPreparedImageNode(existingNode.data);
		if (!prepared) {
			const adopted = await adoptRegisteredClaim(row.data, identity.canvasNodeId);
			if (adopted) return adopted;
			let persisted = inspectPersistedWorkflowImageNode(row.data, identity.canvasNodeId, null);
			if (persisted.status === "waiting_external" && persisted.taskId) {
				await reconcileImageNodesForFlow({
					c: context,
					requestUserId: request.ownerId,
					devBypass: false,
					flowId: request.flowId,
					row,
					target: { nodeId: identity.canvasNodeId, taskId: persisted.taskId },
					...(request.chapterId ? { chapterId: request.chapterId } : {}),
				});
				row = await readRow();
				persisted = inspectPersistedWorkflowImageNode(row.data, identity.canvasNodeId, persisted.taskId);
			}
			if (persisted.status === "waiting_external" && persisted.taskId && !flowNode(row.data, persisted.nodeId)) {
				return reconcileWorkflowMediaReceipt(context, request.ownerId, persisted.nodeId, persisted.taskId, "image");
			}
			return persisted;
		}
	}

	if (request.projectId) {
		context.set("activeTeamId", await resolveProjectBillingTeamId(env.DB, { projectId: request.projectId, userId: request.ownerId }));
	}
	let result: Awaited<ReturnType<typeof generateImageToCanvas>>;
	try {
	result = await generateImageToCanvas({
		c: context,
		requestUserId: request.ownerId,
		devBypass: false,
		flowId: request.flowId,
		row,
		...(request.chapterId ? { chapterId: request.chapterId } : {}),
		bodyArgs: {
			node: {
				id: identity.canvasNodeId,
				type: "taskNode",
				position: { x: 160, y: 120 + request.itemIndex * 360 },
				data: {
					...(request.assetMetadata ?? {}),
					kind: request.referenceAssetBindings.length > 0 ? "imageEdit" : "image",
					label: workflowImageSemanticLabel({
						assetMetadata: request.assetMetadata,
						itemIndex: request.itemIndex,
					}),
					prompt: composeWorkflowImagePrompt(request),
					negativePrompt: request.negativePrompt,
					modelKey: request.modelKey,
					aspect: request.aspectRatio,
					imageSize: request.imageSize,
					imageQuality: request.imageQuality ?? "",
					referenceAssetBindings: request.referenceAssetBindings,
					...(request.styleReferenceImages && request.styleReferenceImages.length > 0
						? { styleImages: [...request.styleReferenceImages] }
						: {}),
					...(request.stylePrompt ? { stylePrompt: request.stylePrompt, stylePromptApplied: true } : {}),
					...(request.styleFingerprint ? { styleFingerprint: request.styleFingerprint } : {}),
					waitForResult: false,
					...(request.authorizedRetry ? { workflowMediaRetry: request.authorizedRetry } : {}),
					workflowEffectId: identity.effectId,
					workflowTaskId: buildWorkflowImageTaskId({
						ownerId: request.ownerId,
						effectId: identity.effectId,
					}),
					workflowExecutionId: request.executionId,
					workflowExecutionFamilyId: request.executionFamilyId,
					workflowRuntimeNodeId: request.runtimeNodeId,
				},
			},
		},
	});
	} catch (error: unknown) {
		if (!isRecord(error) || error.code !== "workflow_image_effect_already_claimed") throw error;
		const current = await readRow();
		const claimed = flowNode(current.data, identity.canvasNodeId);
		if (!claimed || !isRecord(claimed.data) || readString(claimed.data.workflowEffectId) !== identity.effectId
			|| !persistedWorkflowImageRequestMatches(claimed.data, request)) throw error;
		const adopted = await adoptRegisteredClaim(current.data, identity.canvasNodeId);
		if (adopted) return adopted;
		return inspectPersistedWorkflowImageNode(current.data, identity.canvasNodeId, null);
	}
	if ("batch" in result) throw new Error("Workflow image runner received an unexpected batch result");
	if (result.status === "running") {
		if (!result.taskId) throw new Error(`Image provider accepted node ${result.nodeId} without a stable task identity`);
			return { status: "waiting_external", nodeId: result.nodeId, taskId: result.taskId, reused: false };
	}
	const imageUrl = persistentHttpUrl(result.imageUrl);
	if (!imageUrl) throw new Error(`Image node ${result.nodeId} completed without a persistent HTTP(S) URL`);
	return { status: "success", nodeId: result.nodeId, taskId: result.taskId, imageUrl, assetId: null, reused: false };
}

/** Consume the frozen one-retry budget only after an authoritative failed receipt.
 * The retry has a stable, separate effect identity; replay after a lost checkpoint
 * finds that same node/claim. Original failures and successful siblings stay intact.
 */
export async function runWorkflowImageNode(
	env: WorkerEnv,
	request: WorkflowImageRunRequest,
): Promise<WorkflowImageRunResult> {
	const result = await runWorkflowImageAttempt(env, request);
	if (result.status !== "failed" || !result.taskId || !request.mediaDeliveryPolicy?.maxRetries
		|| request.authorizedRetry) return result;
	const originalIdentity = workflowImageEffectIdentity(request);
	// An accepted retry never recursively receives another automatic budget.
	if (result.nodeId !== originalIdentity.canvasNodeId) return result;
	const separator = request.runtimeNodeId.lastIndexOf("::item::");
	if (request.executionMode === "each" && separator < 1) return result;
	const confirmed = await reconcileWorkflowMediaReceipt(
		createInternalContext(env, request), request.ownerId, result.nodeId, result.taskId, "image",
	);
	if (confirmed.status !== "failed") return confirmed;
	const retryKey = createHash("sha256").update(JSON.stringify([
		request.executionFamilyId, originalIdentity.effectId, result.taskId, "automatic-image-retry", 1,
	])).digest("hex");
	console.info(JSON.stringify({ message: "workflow_image_retry_authorized",
		executionId: request.executionId, executionFamilyId: request.executionFamilyId,
		runtimeNodeId: request.runtimeNodeId, originalTaskId: result.taskId, retryKey, retryIndex: 1,
	}));
	return runWorkflowImageAttempt(env, {
		...request, resumeOnly: false, previousEvidence: null,
		authorizedRetry: {
			executorRef: "tapcanvas.image.generate/v1",
			executionMode: request.executionMode,
			nodeId: request.executionMode === "each" ? request.runtimeNodeId.slice(0, separator) : request.runtimeNodeId,
			itemId: request.executionMode === "each"
				? decodeURIComponent(request.runtimeNodeId.slice(separator + "::item::".length))
				: null,
			taskId: result.taskId, canvasNodeId: result.nodeId, retryKey,
		},
	});
}
