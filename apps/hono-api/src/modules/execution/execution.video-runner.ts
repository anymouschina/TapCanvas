import type { AppContext, WorkerEnv } from "../../types";
import { resolveProjectBillingTeamId } from "../task/agents-tool-bridge.billing-scope";
import {
	generateVideoToCanvas,
	reconcileVideoNodesForFlow,
} from "../task/agents-tool-bridge.generate-video-to-canvas";
import type { WorkflowVideoRunRequest, WorkflowVideoRunResult } from "./execution.node-executors";
import type {
	WorkflowVoiceCatalog,
	WorkflowVoiceManifest,
	WorkflowVoicePlan,
} from "./execution.video-workflow-contract";
import { buildInternalApiKey } from "../apiKey/internal-api-key";
import { freshReadFlowRow } from "../task/video-orchestrator.flow-io";
import { persistFlowPatch } from "../task/video-orchestrator.flow-io";
import { isProviderTaskPendingStatus } from "../task/provider-task-status";
import { readVoiceCardProfile } from "../task/voice-card-dub";
import {
	resolveVideoModelReferenceAudioPolicy,
	type VideoReferenceAudioPolicy,
} from "../task/video-orchestrator.generation-contract";
import { listDoubaoSeedAudioVoices } from "../apiKey/seed-audio-voices";
import { generateAudioToCanvas } from "../task/agents-tool-bridge.generate-audio-to-canvas";
import { sha256Hex } from "../asset/book-content-hash";
import { workflowVideoSemanticLabel } from "./execution.media-label";
import {
	isVideoSubmitKnownPreUpstreamFailure,
	readVideoSubmitErrorCode,
	readVideoSubmitRejectedReferenceIds,
	readVideoSubmitRejectedUrls,
} from "../task/video-orchestrator.submit-error";
import { workflowVideoSubmissionFailureData } from "../task/workflow-video-effect-claim";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

const VOICE_CALIBRATION_SAMPLE = "山河清朗，风过竹林，灯火照归途，今日心绪沉静，言语清楚自然。";
const BUDGETED_VOICE_SAMPLE_CHARS_PER_SECOND = 3.2;

/**
 * Build a short phonetic calibration sample from the provider's live aggregate
 * reference-audio budget.  Voice cards identify the speaker through frozen
 * metadata/voiceId, so the spoken sample does not need to repeat a potentially
 * long character name.  The conservative character rate leaves headroom for
 * voice-to-voice duration variance at the maximum supported speech rate.
 */
export function buildBudgetedVoiceCalibrationText(input: Readonly<{
	speakerCount: number;
	audioPolicy: VideoReferenceAudioPolicy;
}>): string {
	const totalMaximum = input.audioPolicy.maximumTotalDurationSeconds;
	if (totalMaximum === undefined) return VOICE_CALIBRATION_SAMPLE;
	if (!Number.isInteger(input.speakerCount) || input.speakerCount <= 0) {
		throw new Error("结构化说话人数量必须为正整数");
	}
	const perSpeakerBudgetSeconds = Math.min(
		input.audioPolicy.maximumDurationSeconds,
		totalMaximum / input.speakerCount,
	);
	const targetCharacterCount = Math.max(
		10,
		Math.min(
			Array.from(VOICE_CALIBRATION_SAMPLE).length,
			Math.floor(perSpeakerBudgetSeconds * BUDGETED_VOICE_SAMPLE_CHARS_PER_SECOND),
		),
	);
	return Array.from(VOICE_CALIBRATION_SAMPLE).slice(0, targetCharacterCount).join("");
}

const STRUCTURED_CLIP_NODE_FIELDS = [
	"durationSeconds",
	"logline",
	"continuity",
	"editRhythm",
	"exitState",
	"temporalContext",
	"sceneState",
	"characterStates",
	"characterStateVersions",
	"visualStateRefs",
	"continuityLedger",
	"visualStateAnchorRequirements",
	"speakerBindings",
	"speechEvents",
	"voiceBinding",
	"referenceAudioUrls",
	"referenceAudioRequired",
	"assetObjectContracts",
	"dramaticCoverage",
	"shots",
] as const;

function workflowStructuredClipNodeData(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
	return Object.fromEntries(
		STRUCTURED_CLIP_NODE_FIELDS.flatMap((field) => (
			Object.prototype.hasOwnProperty.call(value, field) ? [[field, value[field]]] : []
		)),
	);
}

export function createWorkflowInternalContext(env: WorkerEnv, request: Readonly<{
	executionId: string;
	runtimeNodeId: string;
	ownerId: string;
}>): AppContext {
	const values = new Map<string, unknown>([
		["requestId", `workflow-video:${request.executionId}:${request.runtimeNodeId}`],
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
			url: "https://workflow.internal/executions/video-node",
			header: (name: string) => name.toLowerCase() === "x-api-key" && apiKey ? apiKey : undefined,
		} as unknown as AppContext["req"],
		get: (key: string) => values.get(key),
		set: (key: string, value: unknown) => { values.set(key, value); },
	} as unknown as AppContext;
}

export function assertWorkflowVoiceManifestAudioPolicy(
	entries: WorkflowVoiceManifest["entries"],
	audioPolicy: VideoReferenceAudioPolicy,
): void {
	let totalDurationSeconds = 0;
	for (const entry of entries) {
		const durationSeconds = entry.audioDurationSec;
		if (
			!Number.isFinite(durationSeconds)
			|| durationSeconds < audioPolicy.minimumDurationSeconds
			|| durationSeconds > audioPolicy.maximumDurationSeconds
		) {
			throw new Error(`配音卡 ${entry.speakerName} 的音频时长不符合模型合同`);
		}
		totalDurationSeconds += durationSeconds;
	}
	if (
		audioPolicy.maximumTotalDurationSeconds !== undefined
		&& totalDurationSeconds > audioPolicy.maximumTotalDurationSeconds
	) {
		throw new Error(
			`配音卡参考音频总时长 ${totalDurationSeconds}s 超过模型合同 ${audioPolicy.maximumTotalDurationSeconds}s`,
		);
	}
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

function flowNodes(rowData: string): Record<string, unknown>[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rowData) as unknown;
	} catch (error: unknown) {
		throw new Error(`Canvas flow is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) throw new Error("Canvas flow has no nodes array");
	return parsed.nodes.filter(isRecord);
}

/**
 * Resolve every structured dialogue speaker before the video node fans out.
 * The batch preflight is idempotent and runs before any provider submission,
 * preventing concurrent per-item voice-card patches from racing each other.
 */
export async function readWorkflowVoicePlanningFacts(
	env: WorkerEnv,
	request: Readonly<{
		executionId: string;
		runtimeNodeId: string;
		ownerId: string;
		flowId: string;
		projectId: string | null;
		chapterId?: string | null;
		speakerNames: readonly string[];
	}>,
): Promise<WorkflowVoiceCatalog> {
	const speakers = [...new Set(request.speakerNames.map((name) => name.trim()).filter(Boolean))];
	const context = createWorkflowInternalContext(env, request);
	if (request.projectId) {
		context.set("activeTeamId", await resolveProjectBillingTeamId(env.DB, {
			projectId: request.projectId,
			userId: request.ownerId,
		}));
	}
	const row = await freshReadFlowRow({
		c: context,
		flowId: request.flowId,
		requestUserId: request.ownerId,
		devBypass: false,
		...(request.chapterId ? { chapterId: request.chapterId } : {}),
	});
	const cards = flowNodes(row.data).flatMap((node) => {
		const card = readVoiceCardProfile(node as never);
		return card?.character && card.voiceId && persistentHttpUrl(card.audioUrl)
			&& typeof card.audioDurationSec === "number" && Number.isFinite(card.audioDurationSec)
			? [card]
			: [];
	});
	const existingBindings = speakers.flatMap((speakerName) => {
		const candidates = cards
			.filter((card) => card.character.trim() === speakerName)
			.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
		const voiceIds = new Set(candidates.map((card) => card.voiceId));
		if (voiceIds.size > 1) throw new Error(`说话人「${speakerName}」存在多个不同 voiceId，无法冻结唯一声音身份`);
		const card = candidates[0];
		if (!card || card.audioDurationSec === null) return [];
		return [{
			speakerName,
			voiceId: card.voiceId,
			voiceLabel: card.audioModel || "voice-card",
			nodeId: card.nodeId,
			audioUrl: card.audioUrl,
			audioDurationSec: card.audioDurationSec,
		}];
	});
	const catalog = await listDoubaoSeedAudioVoices(context);
	if (existingBindings.length < speakers.length && catalog.length === 0) {
		throw new Error("真实豆包音色目录为空，无法为缺少配音卡的说话人制定可执行选声计划");
	}
	return {
		protocolVersion: "tapcanvas.voice-catalog/v1",
		speakers,
		existingBindings,
		catalog: catalog.map((voice) => ({
			id: voice.id,
			name: voice.name,
			gender: voice.gender,
			age: voice.age,
			scene: voice.scene,
			description: voice.description,
			emotions: voice.emotions,
		})),
	};
}

export async function prepareWorkflowVideoProductionAssets(
	env: WorkerEnv,
	request: Readonly<{
		executionId: string;
		executionFamilyId: string;
		runtimeNodeId: string;
		ownerId: string;
		flowId: string;
		projectId: string | null;
		chapterId?: string | null;
		speakerNames: readonly string[];
		modelKey: string;
		voiceCatalog: WorkflowVoiceCatalog;
		voicePlan: WorkflowVoicePlan;
	}>,
): Promise<WorkflowVoiceManifest> {
	const speakerNames = [...new Set(request.speakerNames.map((name) => name.trim()).filter(Boolean))];
	if (speakerNames.length === 0) {
		return { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] };
	}
	const context = createWorkflowInternalContext(env, request);
	if (request.projectId) {
		context.set("activeTeamId", await resolveProjectBillingTeamId(env.DB, {
			projectId: request.projectId,
			userId: request.ownerId,
		}));
	}
	const plannedBySpeaker = new Map(request.voicePlan.entries.map((entry) => [entry.speakerName, entry] as const));
	const audioPolicy = await resolveVideoModelReferenceAudioPolicy({
		c: context,
		videoModel: request.modelKey,
	});
	if (audioPolicy.maximumDurationSeconds <= 0) {
		throw new Error(`视频模型 ${request.modelKey} 未声明可执行的参考音频时长合同`);
	}
	if (
		audioPolicy.maximumTotalDurationSeconds !== undefined
		&& speakerNames.length * audioPolicy.minimumDurationSeconds > audioPolicy.maximumTotalDurationSeconds
	) {
		throw new Error(
			`结构化说话人最短参考音频总时长 ${speakerNames.length * audioPolicy.minimumDurationSeconds}s 超过模型合同 ${audioPolicy.maximumTotalDurationSeconds}s`,
		);
	}
	const initialRow = await freshReadFlowRow({
		c: context,
		flowId: request.flowId,
		requestUserId: request.ownerId,
		devBypass: false,
		...(request.chapterId ? { chapterId: request.chapterId } : {}),
	});
	const initialCards = flowNodes(initialRow.data).flatMap((node) => {
		const card = readVoiceCardProfile(node as never);
		return card?.character && card.voiceId && persistentHttpUrl(card.audioUrl) ? [card] : [];
	});
	const readyInitialCards = new Map<string, (typeof initialCards)[number]>();
	for (const speakerName of speakerNames) {
		const planned = plannedBySpeaker.get(speakerName);
		if (!planned) throw new Error(`选声计划缺少说话人「${speakerName}」`);
		const currentCards = initialCards.filter((card) => card.character.trim() === speakerName);
		const currentVoiceIds = new Set(currentCards.map((card) => card.voiceId).filter(Boolean));
		if (currentVoiceIds.size > 1 || (currentVoiceIds.size === 1 && !currentVoiceIds.has(planned.voiceId))) {
			throw new Error(`说话人「${speakerName}」的当前配音卡与冻结选声计划冲突`);
		}
		const readyCurrentCard = currentCards.find((card) => (
			card.voiceId === planned.voiceId
			&& persistentHttpUrl(card.audioUrl)
			&& typeof card.audioDurationSec === "number"
			&& Number.isFinite(card.audioDurationSec)
			&& card.audioDurationSec >= audioPolicy.minimumDurationSeconds
			&& card.audioDurationSec <= audioPolicy.maximumDurationSeconds
		));
		if (readyCurrentCard) readyInitialCards.set(speakerName, readyCurrentCard);
	}
	const manifestEntry = (
		speakerName: string,
		card: (typeof initialCards)[number],
	): WorkflowVoiceManifest["entries"][number] => {
		const planned = plannedBySpeaker.get(speakerName);
		if (!planned || card.voiceId !== planned.voiceId) {
			throw new Error(`配音卡 ${speakerName} 的 voiceId 未按冻结选声计划物化`);
		}
		const audioUrl = persistentHttpUrl(card.audioUrl);
		if (!audioUrl) throw new Error(`配音卡 ${speakerName} 缺少持久音频 URL`);
		const durationSeconds = card.audioDurationSec;
		if (typeof durationSeconds !== "number") {
			throw new Error(`配音卡 ${speakerName} 的音频时长不符合模型合同`);
		}
		return {
			speakerName,
			voiceId: card.voiceId,
			voiceLabel: card.audioModel || "voice-card",
			nodeId: card.nodeId,
			audioUrl,
			audioDurationSec: durationSeconds,
		};
	};
	if (readyInitialCards.size === speakerNames.length) {
		const initialEntries = speakerNames.map((speakerName) => manifestEntry(
			speakerName,
			readyInitialCards.get(speakerName)!,
		));
		try {
			assertWorkflowVoiceManifestAudioPolicy(initialEntries, audioPolicy);
			return { protocolVersion: "tapcanvas.voice-manifest/v1", entries: initialEntries };
		} catch (error: unknown) {
			if (audioPolicy.maximumTotalDurationSeconds === undefined) throw error;
		}
	}
	const regenerateBudgetedSet = audioPolicy.maximumTotalDurationSeconds !== undefined;
	const budgetedCalibrationText = regenerateBudgetedSet
		? buildBudgetedVoiceCalibrationText({ speakerCount: speakerNames.length, audioPolicy })
		: null;
	const generatedNodeIds = new Map<string, string>();
	for (const speakerName of speakerNames) {
		if (!regenerateBudgetedSet && readyInitialCards.has(speakerName)) continue;
		const planned = plannedBySpeaker.get(speakerName);
		if (!planned) throw new Error(`选声计划缺少说话人「${speakerName}」`);
		const rowBeforeCreate = await freshReadFlowRow({
			c: context,
			flowId: request.flowId,
			requestUserId: request.ownerId,
			devBypass: false,
			...(request.chapterId ? { chapterId: request.chapterId } : {}),
		});
		const nodeId = `voicecard-workflow-${sha256Hex(
			`${request.executionFamilyId}:${speakerName}:${regenerateBudgetedSet ? "budgeted-v3" : "standard"}`,
		).slice(0, 24)}`;
		generatedNodeIds.set(speakerName, nodeId);
		await generateAudioToCanvas({
			c: context,
			requestUserId: request.ownerId,
			devBypass: false,
			flowId: request.flowId,
			row: rowBeforeCreate,
			bodyArgs: {
				node: {
					id: nodeId,
					data: {
						audioType: "voice_card",
						voiceCharacter: speakerName,
						voiceId: planned.voiceId,
						requireExactVoiceId: true,
						audioModel: "doubao-seed-audio-1-0",
						label: `配音卡｜${speakerName}`,
						...(regenerateBudgetedSet
							? { speed: 2, text: budgetedCalibrationText }
							: {}),
					},
				},
			},
			...(request.chapterId ? { chapterId: request.chapterId } : {}),
		});
	}
	const row = await freshReadFlowRow({
		c: context,
		flowId: request.flowId,
		requestUserId: request.ownerId,
		devBypass: false,
		...(request.chapterId ? { chapterId: request.chapterId } : {}),
	});
	const cardsBySpeaker = new Map(
		speakerNames.flatMap((speakerName) => {
			const generatedNodeId = generatedNodeIds.get(speakerName);
			const cards = flowNodes(row.data).flatMap((node) => {
			const card = readVoiceCardProfile(node as never);
				return card?.character.trim() === speakerName && persistentHttpUrl(card.audioUrl) ? [card] : [];
			});
			const selected = generatedNodeId
				? cards.find((card) => card.nodeId === generatedNodeId)
				: cards.find((card) => card.voiceId === plannedBySpeaker.get(speakerName)?.voiceId);
			return selected ? [[speakerName, selected] as const] : [];
		}),
	);
	const missing = speakerNames.filter((speakerName) => !cardsBySpeaker.has(speakerName));
	if (missing.length > 0) {
		throw new Error(`结构化说话人缺少可执行配音卡：${missing.join("、")}`);
	}
	const entries = speakerNames.map((speakerName) => {
		const card = cardsBySpeaker.get(speakerName);
		if (!card) throw new Error(`结构化说话人缺少可执行配音卡：${speakerName}`);
		return manifestEntry(speakerName, card);
	});
	assertWorkflowVoiceManifestAudioPolicy(entries, audioPolicy);
	return { protocolVersion: "tapcanvas.voice-manifest/v1", entries };
}

export function inspectPersistedWorkflowVideoNode(
	rowData: string,
	nodeId: string,
	taskId: string | null,
): WorkflowVideoRunResult {
	const node = flowNode(rowData, nodeId);
	if (!node || !isRecord(node.data)) {
		if (taskId) {
			return { status: "waiting_external", nodeId, taskId, reused: true };
		}
		return { status: "failed", nodeId, taskId: null, errorMessage: `Video output ${nodeId} has no persisted canvas node or accepted provider task identity` };
	}
	const data = node.data;
	const status = readString(data.status).toLowerCase();
	const persistedTaskId = readString(data.taskId) || readString(data.videoTaskId) || taskId || "";
	if (isProviderTaskPendingStatus(status)) {
		if (!persistedTaskId) {
			return { status: "failed", nodeId, taskId: null, errorMessage: `Persisted video node ${nodeId} is waiting without a provider task identity` };
		}
		return { status: "waiting_external", nodeId, taskId: persistedTaskId, reused: true };
	}
	if (status === "failed" || status === "error") {
		const errorMessage = readString(data.errorMessage)
			|| readString(data.clipSubmitError)
			|| readString(data.error)
			|| readString(data.lastError)
			|| `Video task ${persistedTaskId} failed`;
		const providerRejectedReferenceIds = Array.isArray(data.providerRejectedReferenceIds)
			? [...new Set(data.providerRejectedReferenceIds.flatMap((value) => readString(value) ? [readString(value)] : []))]
			: [];
		return {
			status: "failed",
			nodeId,
			taskId: persistedTaskId,
			errorMessage,
			errorCode: readString(data.errorCode) || null,
			...(providerRejectedReferenceIds.length > 0 ? { providerRejectedReferenceIds } : {}),
		};
	}
	const directUrl = readString(data.videoUrl);
	const firstResult = Array.isArray(data.videoResults) && isRecord(data.videoResults[0]) ? data.videoResults[0] : null;
	const videoUrl = persistentHttpUrl(directUrl || readString(firstResult?.url));
	if (status !== "success" || !videoUrl) {
		return { status: "failed", nodeId, taskId: persistedTaskId, errorMessage: `Video node ${nodeId} reached an invalid terminal state (${status || "missing"}) without a persistent HTTP(S) URL` };
	}
	return {
		status: "success",
		nodeId,
		taskId: persistedTaskId || null,
		videoUrl,
		thumbnailUrl: readString(data.videoThumbnailUrl) || readString(firstResult?.thumbnailUrl) || null,
		reused: true,
	};
}

export function workflowVideoEffectIdentity(
	request: Pick<WorkflowVideoRunRequest, "executionFamilyId" | "runtimeNodeId">,
): Readonly<{
	canvasNodeId: string;
	effectId: string;
}> {
	return {
		canvasNodeId: `${request.runtimeNodeId}::family::${request.executionFamilyId}::output::video`,
		effectId: `${request.executionFamilyId}:${request.runtimeNodeId}:video-submit`,
	};
}

export async function runWorkflowVideoNode(
	env: WorkerEnv,
	request: WorkflowVideoRunRequest,
): Promise<WorkflowVideoRunResult> {
	const context = createWorkflowInternalContext(env, request);
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
	if (previousNodeId) {
		let persisted = inspectPersistedWorkflowVideoNode(row.data, previousNodeId, previousTaskId || null);

		if (persisted.status === "waiting_external") {
			// Workflow execution is the durable owner of the accepted provider task.
			// Reconcile on every external check so refreshes, closed browsers and active
			// autosaves cannot strand a completed task behind a stale running canvas node.
			await reconcileVideoNodesForFlow({
				c: context,
				requestUserId: request.ownerId,
				devBypass: false,
				flowId: request.flowId,
				row,
				...(previousTaskId ? { target: { nodeId: previousNodeId, taskId: previousTaskId } } : {}),
				...(request.chapterId ? { chapterId: request.chapterId } : {}),
			});
			row = await readRow();
			persisted = inspectPersistedWorkflowVideoNode(row.data, previousNodeId, previousTaskId || null);
		}
		return persisted;
	}
	if (previousTaskId) throw new Error("Persisted video receipt is incomplete; canvasNodeId is required");
	if (request.resumeOnly) throw new Error("External video resume has no persisted canvas receipt; refusing a new provider submission");

	const identity = workflowVideoEffectIdentity(request);
	const existingNode = flowNode(row.data, identity.canvasNodeId);
	if (existingNode) {
		if (!isRecord(existingNode.data) || readString(existingNode.data.workflowEffectId) !== identity.effectId) {
			throw new Error(`Workflow video output ${identity.canvasNodeId} already exists with a different paid-effect identity`);
		}
		let persisted = inspectPersistedWorkflowVideoNode(row.data, identity.canvasNodeId, null);
		if (persisted.status === "waiting_external" && persisted.taskId) {
			await reconcileVideoNodesForFlow({
				c: context,
				requestUserId: request.ownerId,
				devBypass: false,
				flowId: request.flowId,
				row,
				target: { nodeId: identity.canvasNodeId, taskId: persisted.taskId },
				...(request.chapterId ? { chapterId: request.chapterId } : {}),
			});
			row = await readRow();
			persisted = inspectPersistedWorkflowVideoNode(row.data, identity.canvasNodeId, persisted.taskId);
		}
		return persisted;
	}

	if (request.projectId) {
		context.set("activeTeamId", await resolveProjectBillingTeamId(env.DB, {
			projectId: request.projectId,
			userId: request.ownerId,
		}));
	}
	let result: Awaited<ReturnType<typeof generateVideoToCanvas>>;
	try {
		result = await generateVideoToCanvas({
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
					...(request.structuredClip ? workflowStructuredClipNodeData(request.structuredClip) : {}),
					kind: "video",
					label: workflowVideoSemanticLabel({
						structuredClip: request.structuredClip,
						itemIndex: request.itemIndex,
					}),
					prompt: request.prompt,
					modelKey: request.modelKey,
					videoModel: request.modelKey,
					videoDurationSeconds: request.durationSeconds,
					videoResolution: request.resolution,
					aspectRatio: request.aspectRatio,
					referenceImageNodeIds: [...request.referenceImageNodeIds],
					referenceAssetIds: [...request.referenceAssetIds],
					workflowEffectId: identity.effectId,
					...(request.estimateIdentity ? { workflowEstimateIdentity: request.estimateIdentity } : {}),
					...(request.generationContract ? { generationContract: request.generationContract } : {}),
					workflowExecutionId: request.executionId,
					workflowRuntimeNodeId: request.runtimeNodeId,
				},
				},
			},
		});
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const errorCode = readVideoSubmitErrorCode(error);
		const providerRejectedReferenceIds = readVideoSubmitRejectedReferenceIds(error);
		// The bridge already attempts this terminal write at the paid boundary.
		// Repeat it from a fresh canvas snapshot after the submit call unwinds so a
		// concurrent sibling patch cannot leave the effect visually "submitting".
		try {
			const failureRow = await readRow();
			const existing = flowNode(failureRow.data, identity.canvasNodeId);
			if (existing && isRecord(existing.data)) {
				const persisted = inspectPersistedWorkflowVideoNode(
					failureRow.data,
					identity.canvasNodeId,
				null,
				);
				if (persisted.status === "success" || persisted.status === "waiting_external") {
					return persisted;
				}
				await persistFlowPatch({
					c: context,
					row: failureRow,
					flowId: request.flowId,
					requestUserId: request.ownerId,
					devBypass: false,
					...(request.chapterId ? { chapterId: request.chapterId } : {}),
					patch: {
						allowOverwrite: true,
						patchNodeData: [{
							id: identity.canvasNodeId,
							data: workflowVideoSubmissionFailureData({
								base: existing.data,
								knownPreUpstream: isVideoSubmitKnownPreUpstreamFailure(error),
								errorCode,
								errorMessage,
								failedAt: new Date().toISOString(),
								providerRejectedUrls: readVideoSubmitRejectedUrls(error),
								providerRejectedReferenceIds,
							}),
						}],
					},
					affectedNodeIds: [identity.canvasNodeId],
				});
			}
		} catch (persistenceError: unknown) {
			console.error("[workflow-video-runner] failed to persist exact terminal submit evidence", {
				executionId: request.executionId,
				nodeId: identity.canvasNodeId,
				error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
			});
		}
		return {
			status: "failed",
			nodeId: identity.canvasNodeId,
			taskId: null,
			errorMessage,
			errorCode,
			...(providerRejectedReferenceIds.length > 0 ? { providerRejectedReferenceIds } : {}),
		};
	}
	if (result.status === "running") {
		if (!result.taskId) throw new Error(`Video provider accepted node ${result.nodeId} without a stable task identity`);
		return { status: "waiting_external", nodeId: result.nodeId, taskId: result.taskId, reused: result.reused === true };
	}
	const videoUrl = persistentHttpUrl(result.videoUrl);
	if (!videoUrl) throw new Error(`Video node ${result.nodeId} completed without a persistent HTTP(S) URL`);
	return {
		status: "success",
		nodeId: result.nodeId,
		taskId: result.taskId,
		videoUrl,
		thumbnailUrl: result.thumbnailUrl,
		reused: result.reused === true,
	};
}
