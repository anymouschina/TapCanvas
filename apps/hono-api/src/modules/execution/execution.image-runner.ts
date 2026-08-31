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

export function persistedWorkflowImageRequestMatches(
	data: Record<string, unknown>,
	request: Pick<WorkflowImageRunRequest,
		"prompt" | "negativePrompt" | "modelKey" | "aspectRatio" | "imageSize" | "referenceAssetBindings" | "assetMetadata"
	>,
): boolean {
	return readString(data.prompt) === request.prompt.trim()
		&& readString(data.negativePrompt) === request.negativePrompt.trim()
		&& readString(data.modelKey) === request.modelKey
		&& (readString(data.aspect) || readString(data.aspectRatio)) === request.aspectRatio
		&& readString(data.imageSize) === request.imageSize
		&& sameReferenceAssetBindings(data.referenceAssetBindings, request.referenceAssetBindings)
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
	request: Pick<WorkflowImageRunRequest, "executionFamilyId" | "runtimeNodeId">,
): Readonly<{
	canvasNodeId: string;
	effectId: string;
}> {
	return {
		canvasNodeId: `${request.runtimeNodeId}::family::${request.executionFamilyId}::output::image`,
		effectId: `${request.executionFamilyId}:${request.runtimeNodeId}:image-submit`,
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
		let persisted = inspectPersistedWorkflowImageNode(row.data, previousNodeId, previousTaskId || null);

		if (persisted.status === "waiting_external") {
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
		return persisted;
	}

	if (request.projectId) {
		context.set("activeTeamId", await resolveProjectBillingTeamId(env.DB, { projectId: request.projectId, userId: request.ownerId }));
	}
	const result = await generateImageToCanvas({
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
					prompt: request.prompt,
					negativePrompt: request.negativePrompt,
					modelKey: request.modelKey,
					aspect: request.aspectRatio,
					imageSize: request.imageSize,
					referenceAssetBindings: request.referenceAssetBindings,
					waitForResult: false,
					workflowEffectId: identity.effectId,
					workflowExecutionId: request.executionId,
					workflowRuntimeNodeId: request.runtimeNodeId,
				},
			},
		},
	});
	if ("batch" in result) throw new Error("Workflow image runner received an unexpected batch result");
	if (result.status === "running") {
		if (!result.taskId) throw new Error(`Image provider accepted node ${result.nodeId} without a stable task identity`);
			return { status: "waiting_external", nodeId: result.nodeId, taskId: result.taskId, reused: false };
	}
	const imageUrl = persistentHttpUrl(result.imageUrl);
	if (!imageUrl) throw new Error(`Image node ${result.nodeId} completed without a persistent HTTP(S) URL`);
	return { status: "success", nodeId: result.nodeId, taskId: result.taskId, imageUrl, assetId: null, reused: false };
}
