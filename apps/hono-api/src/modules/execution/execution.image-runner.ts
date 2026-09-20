import { assetFactIdentity } from "./execution.asset-identity";
import { reconcileWorkflowMediaReceipt } from "./execution.media-receipt";
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
		JSON.stringify(value[key]) === JSON.stringify(expectedValue)
	));
}

function isCharacterIdentityAnchor(
	value: WorkflowImageRunRequest["assetMetadata"],
): value is Readonly<Record<string, unknown>> & { referenceType: "character"; characterAssetRole: "identity_anchor"; characterProfileVersion: "character-card/v3" } {
	return Boolean(
		value
		&& readString(value.referenceType) === "character"
		&& readString(value.characterAssetRole) === "identity_anchor"
		&& readString(value.characterProfileVersion) === "character-card/v3",
	);
}

/**
 * Character identity cards are single-subject reference boards.  Project
 * style locks are shared with scene/video generation and may mention a cast
 * or an action sequence, so the single-subject board contract must be placed
 * after that shared style text at the final prompt boundary.
 */
export function composeWorkflowImagePrompt(
	request: Pick<WorkflowImageRunRequest, "prompt" | "stylePrompt" | "assetMetadata">,
): string {
	const styledPrompt = request.stylePrompt
		? `${request.prompt}\n\n[项目统一视觉风格]\n${request.stylePrompt}`.trim()
		: request.prompt.trim();
	if (!isCharacterIdentityAnchor(request.assetMetadata)) return appendSceneCardConstraint(styledPrompt, request.assetMetadata?.referenceType);
	const roleName = readString(request.assetMetadata.roleName)
		|| readString(request.assetMetadata.canonicalName)
		|| readString(request.assetMetadata.displayName)
		|| "当前角色";
	return `${styledPrompt}\n\n【单人角色身份板约束】\n只呈现一个角色：${roleName}。四个信息区（正面脸、3/4脸、正面全身、背面全身）全部是同一角色的不同视角，不是四个角色；保持同一张脸、同一套服装结构、同一体型与同一身份物件。采用中性干净参考背景和中性基态，不绘制战斗动作、剧情现场或环境叙事。画面中不得出现第二个人、其他人物、群像、分身、镜中人、背景人物或陪衬角色。`.trim();
}

export function persistedWorkflowImageRequestMatches(
	data: Record<string, unknown>,
	request: Pick<WorkflowImageRunRequest,
		"prompt" | "negativePrompt" | "modelKey" | "aspectRatio" | "imageSize" | "imageQuality" | "referenceAssetBindings" | "assetMetadata"
		| "styleReferenceImages" | "stylePrompt" | "styleFingerprint"
	>,
): boolean {
	const expectedPrompt = composeWorkflowImagePrompt(request);
	return readString(data.prompt) === expectedPrompt
		&& readString(data.negativePrompt) === request.negativePrompt.trim()
		&& readString(data.modelKey) === request.modelKey
		&& (readString(data.aspect) || readString(data.aspectRatio)) === request.aspectRatio
		&& readString(data.imageSize) === request.imageSize
		&& readString(data.imageQuality) === readString(request.imageQuality)
		&& sameReferenceAssetBindings(data.referenceAssetBindings, request.referenceAssetBindings)
		&& JSON.stringify(data.styleImages ?? []) === JSON.stringify(request.styleReferenceImages ?? [])
		&& readString(data.stylePrompt) === readString(request.stylePrompt)
		&& readString(data.styleFingerprint) === readString(request.styleFingerprint)
		&& sameAssetMetadata(data, request.assetMetadata);
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

export async function runWorkflowImageNode(
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
	const previousNodeId = request.previousEvidence ? readString(request.previousEvidence.canvasNodeId) : "";
	const previousTaskId = request.previousEvidence ? readString(request.previousEvidence.taskId) : "";
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
	if (previousNodeId) {
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
	if (previousTaskId) throw new Error("Persisted image receipt is incomplete; canvasNodeId is required");
	if (request.resumeOnly) throw new Error("External image resume has no persisted canvas receipt; refusing a new provider submission");
	const identity = workflowImageEffectIdentity(request);
	const existingNode = flowNode(row.data, identity.canvasNodeId);
	if (existingNode) {
		if (!isRecord(existingNode.data) || !persistedWorkflowImageRequestMatches(existingNode.data, request)) {
			throw new Error(`Workflow image output ${identity.canvasNodeId} already exists with a different generation contract`);
		}
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

	if (request.authorizedRetry) {
		const authorization = request.authorizedRetry;
		if (`${authorization.nodeId}::item::${encodeURIComponent(authorization.itemId)}` !== request.runtimeNodeId) {
			throw new Error("media_retry_runtime_identity_mismatch");
		}
		const original = flowNode(row.data, authorization.canvasNodeId);
		if (!original || !isRecord(original.data)
			|| !["failed", "error"].includes(readString(original.data.status))
			|| (readString(original.data.taskId) || readString(original.data.imageTaskId)) !== authorization.taskId
			|| persistentHttpUrl(readString(original.data.imageUrl))
			|| (Array.isArray(original.data.imageResults) && original.data.imageResults.length > 0)) {
			throw new Error("media_retry_failed_canvas_receipt_changed");
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
					workflowEffectId: identity.effectId,
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
