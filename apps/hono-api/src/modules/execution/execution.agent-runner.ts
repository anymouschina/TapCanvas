import type { AppContext, WorkerEnv } from "../../types";
import { AppError } from "../../middleware/error";
import {
	createWorkflowAgentRateLimitBackpressureEvidence,
	isWorkflowAgentRateLimitFailureCode,
	parseWorkflowAgentPhysicalFailureEvidence,
	remainingWorkflowAgentPhysicalRetryDelayMs,
	type WorkflowAgentPhysicalFailureEvidence,
} from "./execution.agent-backpressure";
import {
	buildTaskRequest,
	resolveInactiveChatTurnRecoveryKind,
	resumePersistedAgentsChatTurn,
	runPersistedAgentsChatTask,
} from "../task/public-agents-chat";
import type { AgentsChatRequestDto } from "../apiKey/apiKey.schemas";
import {
	getAgentsChatTurnStatus,
	type AgentsChatTurnStatusSnapshot,
} from "../task/task.agents-chat-runtime";
import type {
	WorkflowAgentRunRequest,
	WorkflowAgentRunResult,
	WorkflowPromptExampleCandidateSearchObservation,
} from "./execution.node-executors";
import { isWorkflowProjectImageReady, type WorkflowProjectContext } from "./execution.project-context";
import { buildInternalApiKey } from "../apiKey/internal-api-key";
import { parseAgentExecutionProvenance } from "../task/agent-execution-provenance";
import { cancelWorkflowAgentTurns } from "./execution.agent-cancellation";
import {
	BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
	VIDEO_WRITER_ARTIFACT_CONTRACT_NAME,
	VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION,
	WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY,
	WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
} from "./execution.agent-output-contract";
import {
	workflowAgentPublicTurnId,
	workflowAgentSessionKey,
} from "./execution.agent-identity";
import { getExecutionTraceLifecycleSnapshot } from "../memory/execution-trace-events.repo";
import { computeWorkflowAgentPhysicalAttemptDeadlineAt } from "./execution.production-start-deadline";

const WORKFLOW_AGENT_STATUS_DEADLINE_MS = 10_000;
const WORKFLOW_AGENT_INACTIVE_ADMISSION_GRACE_MS = 60_000;

const WORKFLOW_AGENT_GENERATION_FENCE_PENDING = "workflow_agent_physical_generation_fence_pending";

function workflowAgentContinuationResumeOutcome(
	error: unknown,
): "already_active" | "not_ready" | null {
	if (!(error instanceof AppError)) return null;
	if (error.code === "chat_resume_turn_active") return "already_active";
	if (error.code === "chat_resume_continuation_not_ready") return "not_ready";
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFreshInactiveWorkflowAgentAdmission(
	turn: NonNullable<AgentsChatTurnStatusSnapshot["turn"]>,
	nowMs = Date.now(),
): boolean {
	if (turn.state !== "unknown") return false;
	if (
		turn.phase !== "accepted"
		&& turn.phase !== "agent_running"
		&& turn.phase !== "completion_verifying"
	) return false;
	const lastConfirmedMs = Date.parse(turn.lastConfirmedAt);
	return isFreshWorkflowAgentAdmissionTimestamp(lastConfirmedMs, nowMs);
}

function isFreshWorkflowAgentAdmissionTimestamp(
	updatedAt: string | number,
	nowMs = Date.now(),
): boolean {
	const updatedAtMs = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt);
	if (!Number.isFinite(updatedAtMs)) return false;
	const ageMs = Math.max(0, nowMs - updatedAtMs);
	return ageMs < WORKFLOW_AGENT_INACTIVE_ADMISSION_GRACE_MS;
}

function pickRecordFields(
	record: Record<string, unknown>,
	fields: readonly string[],
): Record<string, unknown> {
	const projected: Record<string, unknown> = {};
	for (const field of fields) {
		if (Object.prototype.hasOwnProperty.call(record, field)) {
			projected[field] = record[field];
		}
	}
	return projected;
}

function projectBeatSheetForAssetPlanning(
	text: string,
	projectContext: WorkflowProjectContext | null | undefined,
): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		return text;
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.beats)) return text;
	const readyImageIds = new Set(
		(projectContext?.assetSnapshot ?? [])
			.filter(isWorkflowProjectImageReady)
			.map((asset) => asset.assetId),
	);
	const beats = parsed.beats.map((beat) => {
		if (!isRecord(beat)) return beat;
		const projected = pickRecordFields(beat, [
			"beatId",
			"clipId",
			"clipIndex",
			"durationSeconds",
			"setting",
			"characters",
			"visualAction",
			"continuity",
			"assetObjectContracts",
		]);
		if (!Array.isArray(projected.assetObjectContracts)) return projected;
		projected.assetObjectContracts = projected.assetObjectContracts.map((contract) => {
			if (!isRecord(contract) || !Array.isArray(contract.referenceAssetIds)) return contract;
			return {
				...contract,
				referenceAssetIds: contract.referenceAssetIds.filter(
					(value): value is string => typeof value === "string" && readyImageIds.has(value.trim()),
				),
			};
		});
		return projected;
	});
	return JSON.stringify({
		...pickRecordFields(parsed, [
			"protocolVersion",
			"filmBible",
			"castManifest",
			"meta",
		]),
		beats,
	});
}

function workflowAgentPromptInputs(
	request: WorkflowAgentRunRequest,
): Readonly<Record<string, readonly unknown[]>> {
	return Object.fromEntries(Object.entries(request.inputs).map(([port, values]) => [
		port,
		values.map((value) => {
			if (!isRecord(value) || typeof value.text !== "string") return value;
			const text = request.outputArtifactType === "tapcanvas.asset-plans/v1"
				? projectBeatSheetForAssetPlanning(value.text, request.projectContext)
				: value.text;
			return {
				...pickRecordFields(value, ["taskId", "assets"]),
				text,
			};
		}),
	]));
}

function workflowAgentProjectContextPromptFacts(
	projectContext: NonNullable<WorkflowAgentRunRequest["projectContext"]>,
	outputArtifactType: string,
): Readonly<Record<string, unknown>> {
	const selectedAssetIds = new Set(projectContext.selectedAssetIds);
	const visibleAssetIds = new Set(projectContext.projectAssetIds);
	const projectAssetCandidates = isWorkflowBeatSheetArtifactType(outputArtifactType)
		? projectContext.assetSnapshot
			.filter((asset) => (
				asset.projectId === projectContext.projectId
				&& visibleAssetIds.has(asset.assetId)
				&& asset.mediaKind === "image"
				&& asset.state === "ready"
				&& asset.productionEligible
			))
			.map((asset) => ({
				assetId: asset.assetId,
				name: asset.name,
				canonicalName: asset.canonicalName,
				kind: asset.kind,
				referenceType: asset.referenceType,
				approvalStatus: asset.approvalStatus,
				origin: asset.origin,
				flowId: asset.flowId,
				nodeId: asset.nodeId,
				sourceFacts: asset.sourceFacts,
				selected: selectedAssetIds.has(asset.assetId),
				updatedAt: asset.updatedAt,
			}))
		: undefined;
	return {
		version: projectContext.version,
		projectId: projectContext.projectId,
		canvasId: projectContext.canvasId,
		sourceNodeId: projectContext.sourceNodeId,
		selectedAssetIds: projectContext.selectedAssetIds,
		projectAssetCount: projectContext.projectAssetIds.length,
		assetSnapshotCount: projectContext.assetSnapshot.length,
		timeline: projectContext.timeline,
		selection: projectContext.selection,
		permissions: projectContext.permissions,
		selectedAssetSnapshot: projectContext.assetSnapshot.filter((asset) => (
			selectedAssetIds.has(asset.assetId)
		)),
		...(projectAssetCandidates ? { projectAssetCandidates } : {}),
		capturedAt: projectContext.capturedAt,
	};
}

function createInternalWorkflowContext(
	env: WorkerEnv,
	request: WorkflowAgentRunRequest,
	publicTurnId: string,
): AppContext {
	const values = new Map<string, unknown>([
		["requestId", publicTurnId],
		["userId", request.ownerId],
		["publicApi", false],
	]);
	const internalToken = String(env.INTERNAL_WORKER_TOKEN ?? "").trim();
	const apiKey = buildInternalApiKey({
		internalWorkerToken: internalToken,
		userId: request.ownerId,
	}) ?? "";
	return {
		env,
		req: {
			url: "https://workflow.internal/executions/agent-node",
			header: (name: string) => name.toLowerCase() === "x-api-key" && apiKey
				? apiKey
				: undefined,
		} as unknown as AppContext["req"],
		get: (key: string) => values.get(key),
		set: (key: string, value: unknown) => {
			values.set(key, value);
		},
	} as unknown as AppContext;
}

const WORKFLOW_PROMPT_EXAMPLE_SEARCH_STATUSES = new Set<
	WorkflowPromptExampleCandidateSearchObservation["status"]
>([
	"not_attempted",
	"candidate_found",
	"no_match",
	"retrieval_failed",
	"invalid_evidence",
	"tool_unavailable",
]);

function parsePromptExampleCandidateSearchObservation(
	value: unknown,
): WorkflowPromptExampleCandidateSearchObservation | null {
	if (!isRecord(value) || value.version !== 1) return null;
	if (!WORKFLOW_PROMPT_EXAMPLE_SEARCH_STATUSES.has(
		value.status as WorkflowPromptExampleCandidateSearchObservation["status"],
	)) return null;
	if (value.mediaType !== "image" && value.mediaType !== "video") return null;
	if (
		typeof value.attempted !== "boolean"
		|| typeof value.remoteAttempted !== "boolean"
		|| typeof value.candidateCount !== "number"
		|| !Number.isInteger(value.candidateCount)
		|| value.candidateCount < 0
		|| value.blocking !== false
		|| typeof value.rationale !== "string"
		|| !value.rationale.trim()
	) return null;
	const toolCallId = typeof value.toolCallId === "string" && value.toolCallId.trim()
		? value.toolCallId.trim()
		: null;
	return {
		version: 1,
		status: value.status as WorkflowPromptExampleCandidateSearchObservation["status"],
		mediaType: value.mediaType,
		attempted: value.attempted,
		remoteAttempted: value.remoteAttempted,
		candidateCount: value.candidateCount,
		blocking: false,
		rationale: value.rationale.trim(),
		...(toolCallId ? { toolCallId } : {}),
	};
}

function readAgentResponse(result: unknown): WorkflowAgentRunResult {
	if (!isRecord(result)) throw new Error("Agents workflow node returned an invalid result");
	const taskId = typeof result.id === "string" ? result.id.trim() : "";
	const raw = isRecord(result.raw) ? result.raw : null;
	const meta = raw && isRecord(raw.meta) ? raw.meta : null;
	const text = raw && typeof raw.text === "string" ? raw.text : "";
	if (!taskId || !raw || !meta) {
		throw new Error("Agents workflow node returned no task identity or delivery metadata");
	}
	const rawAssets = Array.isArray(result.assets) ? result.assets : [];
	const executionProvenance = parseAgentExecutionProvenance(meta.executionProvenance);
	const runtime = isRecord(meta.runtime) ? meta.runtime : null;
	const promptExampleCandidateSearch = parsePromptExampleCandidateSearchObservation(
		runtime?.promptExampleCandidateSearch,
	);
	const assets = rawAssets.flatMap((asset) => {
		if (!isRecord(asset)) return [];
		const type = typeof asset.type === "string" ? asset.type.trim() : "";
		const url = typeof asset.url === "string" ? asset.url.trim() : "";
		if (!type || !url) return [];
		return [{
			type,
			url,
			assetId: typeof asset.assetId === "string" && asset.assetId.trim()
				? asset.assetId.trim()
				: null,
		}];
	});
	return {
		taskId,
		text,
		assets,
		expectedDelivery: meta.expectedDelivery ?? null,
		deliveryEvidence: meta.deliveryEvidence ?? null,
		deliveryVerification: meta.deliveryVerification ?? null,
		requestTerminal: meta.requestTerminal ?? null,
		...(executionProvenance ? { executionProvenance } : {}),
		...(promptExampleCandidateSearch ? { promptExampleCandidateSearch } : {}),
	};
}

function unwrapWorkflowAgentTransportEnvelope(
	request: WorkflowAgentRunRequest,
	result: WorkflowAgentRunResult,
): WorkflowAgentRunResult {
	if (request.outputEncoding !== "json_array") return result;
	const terminal = isRecord(result.requestTerminal) ? result.requestTerminal : null;
	if (terminal?.status !== "succeeded") return result;
	let parsed: unknown;
	try {
		parsed = JSON.parse(result.text.trim());
	} catch {
		throw new Error("Workflow json_array transport envelope is not valid JSON");
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
		throw new Error("Workflow json_array transport envelope must contain an items array");
	}
	const minimumArrayLength = request.jsonArrayContract?.minimumArrayLength ?? 1;
	const envelopeKeys = Object.keys(parsed);
	if (Object.prototype.hasOwnProperty.call(parsed, "minItems") && parsed.minItems !== minimumArrayLength) {
		throw new Error(`Workflow json_array transport envelope minItems must equal ${minimumArrayLength}`);
	}
	if (parsed.items.length < minimumArrayLength) {
		throw new Error(`Workflow json_array transport envelope requires at least ${minimumArrayLength} items`);
	}
	const discardedTransportKeys = envelopeKeys.filter((key) => key !== "items" && key !== "minItems");
	if (discardedTransportKeys.length > 0) {
		console.warn(JSON.stringify({
			event: "workflow_agent_json_array_transport_projected",
			executionId: request.executionId,
			nodeId: request.nodeId,
			discardedKeys: discardedTransportKeys.sort(),
		}));
	}
	return {
		...result,
		text: JSON.stringify(parsed.items),
	};
}

function attachSuspendedWorkflowTurnIdentity(
	result: WorkflowAgentRunResult,
	request: WorkflowAgentRunRequest,
	publicTurnId: string,
): WorkflowAgentRunResult {
	const terminal = isRecord(result.requestTerminal) ? result.requestTerminal : null;
	if (terminal?.status !== "suspended") return result;
	const upstreamEvidence = isRecord(result.deliveryEvidence) ? result.deliveryEvidence : null;
	const physicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(request);
	const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
	return {
		...result,
		deliveryEvidence: {
			...(upstreamEvidence ?? {}),
			sessionKey: sessionKeyForWorkflowAgent(request),
			logicalTaskId: publicTurnId,
			...(physicalRetryOrdinal === null ? {} : { physicalRetryOrdinal }),
			...(recoveryWindow && !isRecord(upstreamEvidence?.recoveryWindow)
				? { recoveryWindow }
				: {}),
			...(result.deliveryEvidence != null && !upstreamEvidence
				? { upstreamDeliveryEvidence: result.deliveryEvidence }
				: {}),
		},
	};
}

function durableTurnProvenance(
	turn: NonNullable<AgentsChatTurnStatusSnapshot["turn"]>,
): Pick<WorkflowAgentRunResult, "executionProvenance" | "executionProvenanceHistory"> {
	const history = turn.executionProvenanceHistory ?? [];
	const latest = history[history.length - 1];
	return {
		...(latest ? { executionProvenance: latest } : {}),
		...(history.length > 0 ? { executionProvenanceHistory: history } : {}),
	};
}

const RECOVERABLE_AGENTS_BRIDGE_CODES = new Set([
	"agents_bridge_stream_interrupted",
	"agents_bridge_fetch_failed",
	"agents_bridge_headers_timeout_dropped",
	"agents_remote_tool_callback_base_missing",
	"provider_stream_interrupted",
	"agents_chat_runtime_timeout",
	"agents_chat_runtime_transport_unknown",
	"durable_turn_storage_unavailable",
	"workflow_agent_role_timeout",
]);

const RECOVERABLE_AGENTS_CHAT_RUNTIME_STATUSES = new Set([502, 503, 504]);
const RECOVERABLE_AGENTS_BRIDGE_REJECTION_CODES = new Set([
	"agents_bridge_failed",
	"agents_bridge_queue_failed",
]);
const RECOVERABLE_AGENTS_BRIDGE_REJECTION_STATUSES = new Set([
	408,
	425,
	429,
	500,
	502,
	503,
	504,
]);

function agentsBridgeErrorCode(error: unknown): string | null {
	if (error instanceof AppError) return error.code.trim() || null;
	if (!isRecord(error)) return null;
	const code = error.code;
	return typeof code === "string" && code.trim() ? code.trim() : null;
}

export function isRecoverableWorkflowAgentInterruption(error: unknown): boolean {
	const code = agentsBridgeErrorCode(error);
	if (code === null) return false;
	if (RECOVERABLE_AGENTS_BRIDGE_CODES.has(code)) return true;
	if (RECOVERABLE_AGENTS_BRIDGE_REJECTION_CODES.has(code)) {
		const status = error instanceof AppError
			? error.status
			: isRecord(error) && typeof error.status === "number"
				? error.status
				: null;
		return status !== null && RECOVERABLE_AGENTS_BRIDGE_REJECTION_STATUSES.has(status);
	}
	if (code !== "agents_chat_runtime_request_failed") return false;
	const status = error instanceof AppError
		? error.status
		: isRecord(error) && typeof error.status === "number"
			? error.status
			: null;
	return status !== null && RECOVERABLE_AGENTS_CHAT_RUNTIME_STATUSES.has(status);
}

function interruptedAgentResult(
	request: WorkflowAgentRunRequest,
	publicTurnId: string,
	error: unknown,
): WorkflowAgentRunResult {
	const code = agentsBridgeErrorCode(error);
	if (!code) throw new Error("Recoverable Agents bridge interruption has no structured code");
	const physicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(request);
	const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
	return {
		taskId: publicTurnId,
		text: "",
		assets: [],
		expectedDelivery: null,
			deliveryEvidence: {
			transportInterrupted: true,
			errorCode: code,
			sessionKey: sessionKeyForWorkflowAgent(request),
			logicalTaskId: publicTurnId,
			retryableByDurableWorkflow: true,
			...(physicalRetryOrdinal === null ? {} : { physicalRetryOrdinal }),
			...(recoveryWindow ? { recoveryWindow } : {}),
		},
		deliveryVerification: null,
		requestTerminal: {
			status: "suspended",
			reason: "workflow_agent_transport_recovery_pending",
		},
	};
}

function sessionKeyForWorkflowAgent(request: WorkflowAgentRunRequest): string {
	return workflowAgentSessionKey({
		executionId: request.executionId,
		nodeId: request.nodeId,
		physicalRetryOrdinal: workflowAgentPhysicalRetryOrdinal(request),
	});
}

/**
 * A new physical generation is a fencing event for the immediately preceding
 * generation of the same immutable Workflow Agent node. A delayed durable
 * continuation from the previous generation may become runnable again during
 * an API/bridge restart; retiring it before the new generation is admitted
 * prevents two model calls from authoring the same typed artifact concurrently.
 *
 * This fence is identity-only: it is derived from execution/node/retry
 * ordinals, never from prompts, workflow names, or media semantics. Agent
 * cancellation also leaves already accepted provider/media side effects intact.
 */
async function fencePreviousWorkflowAgentPhysicalGeneration(
	env: WorkerEnv,
	request: WorkflowAgentRunRequest,
	currentPublicTurnId: string,
	currentPhysicalRetryOrdinal: number,
): Promise<Readonly<{
	fenced: boolean;
	previousPublicTurnId: string;
	errorCode: string | null;
}>> {
	const previousPhysicalRetryOrdinal = currentPhysicalRetryOrdinal - 1;
	const previousPublicTurnId = workflowAgentPublicTurnId({
		executionId: request.executionId,
		nodeId: request.nodeId,
		physicalRetryOrdinal: previousPhysicalRetryOrdinal > 0 ? previousPhysicalRetryOrdinal : null,
	});
	if (previousPublicTurnId === currentPublicTurnId) {
		return { fenced: true, previousPublicTurnId, errorCode: null };
	}
	const context = createInternalWorkflowContext(env, request, currentPublicTurnId);
	const [result] = await cancelWorkflowAgentTurns({
		context,
		userId: request.ownerId,
		interruptReasonCode: "provider_stream_interrupted",
		targets: [{
			sessionId: previousPublicTurnId,
			turnId: previousPublicTurnId,
			nodeId: request.nodeId,
			runtimeNodeId: request.nodeId,
		}],
	});
	return {
		fenced: Boolean(result && result.status !== "failed"),
		previousPublicTurnId,
		errorCode: result?.errorCode ?? null,
	};
}

function waitingWorkflowAgentGenerationFenceResult(input: Readonly<{
	request: WorkflowAgentRunRequest;
	currentPublicTurnId: string;
	previousPublicTurnId: string;
	physicalRetryOrdinal: number;
	physicalFailureReason: string;
	fenceErrorCode: string | null;
}>): WorkflowAgentRunResult {
	return {
		taskId: input.currentPublicTurnId,
		text: "",
		assets: [],
		expectedDelivery: workflowAgentExpectedDelivery(input.request),
		deliveryEvidence: {
			version: 1,
			source: "workflow_agent_generation_fence",
			sessionKey: sessionKeyForWorkflowAgent(input.request),
			logicalTaskId: input.currentPublicTurnId,
			retryablePhysicalFailure: true,
			physicalFailureReason: input.physicalFailureReason,
			physicalRetryOrdinal: input.physicalRetryOrdinal,
			generationFencePending: true,
			previousPublicTurnId: input.previousPublicTurnId,
			currentPublicTurnId: input.currentPublicTurnId,
			fenceErrorCode: input.fenceErrorCode,
		},
		deliveryVerification: null,
		requestTerminal: {
			status: "suspended",
			reason: WORKFLOW_AGENT_GENERATION_FENCE_PENDING,
		},
	};
}

function workflowAgentExpectedDelivery(
	request: WorkflowAgentRunRequest,
): Readonly<Record<string, unknown>> {
	return {
		version: 1,
		taskGoal: request.instruction,
		requestedOutput: request.outputArtifactType,
		successCriteria: [request.deliveryRequirement],
		requiresExecutionDelivery: false,
	};
}

function workflowClipWriterRequiresSpeechEvents(request: WorkflowAgentRunRequest): boolean {
	if (request.outputArtifactType !== "tapcanvas.clip-prompts/v2") return false;
	for (const values of Object.values(request.inputs)) {
		for (const value of values) {
			if (isRecord(value) && Array.isArray(value.spokenScript) && value.spokenScript.length > 0) {
				return true;
			}
		}
	}
	return false;
}

function workflowClipWriterTimelineDurationSeconds(request: WorkflowAgentRunRequest): number | null {
	if (request.outputArtifactType !== "tapcanvas.clip-prompts/v2") return null;
	for (const value of request.inputs["clip-contexts"] ?? []) {
		if (!isRecord(value) || !isRecord(value.beat)) continue;
		const durationSeconds = value.beat.durationSeconds;
		if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0) {
			return durationSeconds;
		}
	}
	return null;
}

function workflowAgentStructuredOutput(
	request: WorkflowAgentRunRequest,
): Readonly<Record<string, unknown>> | null {
	if (request.outputEncoding === "json_array") {
		const contract = request.jsonArrayContract;
		const requiredFields = [
			...(contract?.itemRequiredStringFields ?? []),
			...(contract?.itemRequiredNumberFields ?? []),
			...(contract?.itemRequiredNonEmptyArrayFields ?? []),
			...Object.keys(contract?.itemStringArrayAllowedValues ?? {}),
			...Object.keys(contract?.itemStringAllowedValues ?? {}),
		];
		const itemObject = requiredFields.length > 0 || Boolean(contract?.itemAllowedFields)
			|| Boolean(contract?.itemExactStringFieldsByIdentity)
			|| Boolean(contract?.itemRequiredNonEmptyArrayFieldsByIdentity)
			? {
				requiredStringFields: contract?.itemRequiredStringFields,
				stringFormats: contract?.itemStringFormats,
				stringAllowedValues: contract?.itemStringAllowedValues,
				dropItemsWithDisallowedStringFields: request.outputArtifactType === "tapcanvas.asset-plans/v1"
					&& contract?.itemStringFormats?.role === "asset-role-v1"
					&& Boolean(contract.itemStringAllowedValues?.role)
					? ["role"]
					: undefined,
				requiredNumberFields: contract?.itemRequiredNumberFields,
				exactNumberFields: contract?.itemExactNumberFields,
				stringArrayAllowedValues: contract?.itemStringArrayAllowedValues,
				requiredNonEmptyArrayFieldsByIdentity: contract?.itemRequiredNonEmptyArrayFieldsByIdentity,
				exactStringFieldsByIdentity: contract?.itemExactStringFieldsByIdentity,
				allowedFields: contract?.itemAllowedFields,
			}
			: undefined;
		return {
			outputContract: {
				kind: "json",
				submissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
				requiredArrayField: "items",
				allowedTopLevelFields: ["items"],
				...(contract?.minimumArrayLength === undefined
					? {}
					: { minimumArrayLength: contract.minimumArrayLength }),
				...(contract?.expectedArrayLength === undefined ? {} : { expectedArrayLength: contract.expectedArrayLength }),
				...(contract?.itemRequiredNonEmptyArrayFields?.length
					? { requiredNonEmptyArrayPaths: contract.itemRequiredNonEmptyArrayFields }
					: {}),
				...(itemObject ? { itemObject } : {}),
				description: `Workflow typed port ${request.outputArtifactType} uses an object transport envelope with one non-empty items array`,
			},
			responseFormat: { type: "json_object" },
		};
	}
	if (request.outputEncoding === "json_object") {
		const contract = request.jsonObjectContract;
		if (!contract) throw new Error("Workflow json_object output requires an explicit structural contract");
		const requiredNonEmptyArrayPaths = [
			...(contract.itemRequiredNonEmptyArrayFields ?? []),
			...(workflowClipWriterRequiresSpeechEvents(request) ? ["speakerBindings", "speechEvents"] : []),
		].filter((field, index, fields) => fields.indexOf(field) === index);
		const contractIdentity = request.outputArtifactType === "tapcanvas.clip-prompts/v2"
			? {
				contractName: VIDEO_WRITER_ARTIFACT_CONTRACT_NAME,
				contractVersion: VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION,
			}
			: contract.contractName
				? { contractName: contract.contractName, contractVersion: contract.contractVersion }
				: {};
		const compilerOwnsClipEnvelope = request.outputArtifactType === "tapcanvas.clip-prompts/v2";
		const requiredStringFields = compilerOwnsClipEnvelope
			? (contract.requiredStringFields ?? []).filter((field) => field !== "selfQaNote")
			: contract.requiredStringFields ?? [];
		const requiredNumberFields = contract.requiredNumberFields ?? [];
		const requiredObjectFields = compilerOwnsClipEnvelope
			? (contract.requiredObjectFields ?? []).filter(
				(field) => field !== "creativeReview" && field !== "sourceFidelityAudit",
			)
			: contract.requiredObjectFields ?? [];
		const requiredArrayFields = contract.requiredArrayFields ?? [];
		const expectedArrayLengths = { ...(contract.expectedArrayLengths ?? {}) };
		const singleRequiredArrayField = requiredArrayFields.length === 1 ? requiredArrayFields[0] : null;
		const expectedArrayLengthKeys = Object.keys(expectedArrayLengths);
		const canUseSingleArrayContract = Boolean(singleRequiredArrayField)
			&& requiredStringFields.length === 0
			&& requiredNumberFields.length === 0
			&& requiredObjectFields.length === 0
			&& (
				expectedArrayLengthKeys.length === 0
				|| (compilerOwnsClipEnvelope
					&& expectedArrayLengthKeys.length === 1
					&& expectedArrayLengthKeys[0] === singleRequiredArrayField)
			);
		if (
			canUseSingleArrayContract
			&& singleRequiredArrayField
		) {
			const itemTimelineDurationSeconds = compilerOwnsClipEnvelope
				? workflowClipWriterTimelineDurationSeconds(request)
				: null;
			const exactAssetIds = !compilerOwnsClipEnvelope
				&& contract.itemExactAssetIds && "expected" in contract.itemExactAssetIds
				? {
					declarationPaths: [...contract.itemExactAssetIds.declarationPaths],
					expected: [...contract.itemExactAssetIds.expected],
				}
				: null;
			return {
				outputContract: {
					kind: "json",
					submissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
					...(compilerOwnsClipEnvelope
						? { executionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY }
						: {}),
					...contractIdentity,
					requiredArrayField: singleRequiredArrayField,
					...(expectedArrayLengths[singleRequiredArrayField] === undefined
						? {}
						: { expectedArrayLength: expectedArrayLengths[singleRequiredArrayField] }),
					...(itemTimelineDurationSeconds === null ? {} : { itemTimelineDurationSeconds }),
					...(requiredNonEmptyArrayPaths.length
						? { requiredNonEmptyArrayPaths }
						: {}),
					...(exactAssetIds ? { itemExactAssetIds: exactAssetIds } : {}),
					// 顶层严格化：根对象只允许声明合同内的顶层字段。模型必须在
					// 唯一提交中满足；偏差只记录并失败，不进入纠偏链。
					allowedTopLevelFields: [...contract.allowedFields],
					description: `Workflow typed port ${request.outputArtifactType} requires one non-empty top-level array field`,
				},
				responseFormat: { type: "json_object" },
			};
		}
		// BeatSheet 的 clip 数量与边界由 Agent 按语义决定；这里只保留节点显式提供的
		// 结构合同，不再把供应商最大时长硬编码成叙事切片。
		const arrayItemExactNumberFields = compilerOwnsClipEnvelope
			? {}
			: { ...(contract.arrayItemExactNumberFields ?? {}) };
		const arrayItemNumberAllowedValues = compilerOwnsClipEnvelope
			? {}
			: { ...(contract.arrayItemNumberAllowedValues ?? {}) };
		const arrayItemRequiredStringFields = { ...(contract.arrayItemRequiredStringFields ?? {}) };
		const arrayItemRequiredStringArrayFields = {
			...(contract.arrayItemRequiredStringArrayFields ?? {}),
		};
		const arrayItemRequiredNonEmptyStringArrayFields = {
			...(contract.arrayItemRequiredNonEmptyStringArrayFields ?? {}),
		};
		const arrayItemAllowedFields = { ...(contract.arrayItemAllowedFields ?? {}) };
		const arrayItemExactStringFields = compilerOwnsClipEnvelope
			? {}
			: { ...(contract.arrayItemExactStringFields ?? {}) };
		const arrayItemExactStringArrayFields = compilerOwnsClipEnvelope
			? {}
			: { ...(contract.arrayItemExactStringArrayFields ?? {}) };
		// Clip asset-object contracts are caller-frozen compiler inputs. The Hono
		// node executor projects their complete canonical objects before applying
		// the same strict validator, so agents-cli must not spend creative turns
		// copying opaque IDs into its authored response. Other artifact
		// types retain exact-set enforcement inside agents-cli.
		const exactAssetIds = request.outputArtifactType !== "tapcanvas.clip-prompts/v2"
			&& contract.itemExactAssetIds && "expected" in contract.itemExactAssetIds
			&& requiredArrayFields.length === 1
			? {
				[requiredArrayFields[0]]: {
					declarationPaths: [...contract.itemExactAssetIds.declarationPaths],
					expected: [...contract.itemExactAssetIds.expected],
				},
			}
			: null;
		return {
			outputContract: {
				kind: "json",
				submissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
				...(compilerOwnsClipEnvelope
					? { executionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY }
					: {}),
				...contractIdentity,
				requiredStringFields,
				...(contract.exactStringFields ? { exactStringFields: contract.exactStringFields } : {}),
				...(requiredNumberFields.length > 0 ? { requiredNumberFields } : {}),
				...(requiredObjectFields.length > 0 ? { requiredObjectFields } : {}),
				...(requiredArrayFields.length > 0 ? { requiredArrayFields } : {}),
				...(Object.keys(expectedArrayLengths).length > 0 ? { expectedArrayLengths } : {}),
				...(Object.keys(arrayItemRequiredStringFields).length > 0 ? { arrayItemRequiredStringFields } : {}),
				...(Object.keys(arrayItemRequiredStringArrayFields).length > 0
					? { arrayItemRequiredStringArrayFields }
					: {}),
				...(Object.keys(arrayItemRequiredNonEmptyStringArrayFields).length > 0
					? { arrayItemRequiredNonEmptyStringArrayFields }
					: {}),
				...(Object.keys(arrayItemAllowedFields).length > 0 ? { arrayItemAllowedFields } : {}),
				...(Object.keys(arrayItemExactNumberFields).length > 0 ? { arrayItemExactNumberFields } : {}),
				...(Object.keys(arrayItemNumberAllowedValues).length > 0 ? { arrayItemNumberAllowedValues } : {}),
				...(Object.keys(arrayItemExactStringFields).length > 0 ? { arrayItemExactStringFields } : {}),
				...(Object.keys(arrayItemExactStringArrayFields).length > 0 ? { arrayItemExactStringArrayFields } : {}),
				...(exactAssetIds ? { arrayItemExactAssetIds: exactAssetIds } : {}),
				allowedFields: contract.allowedFields,
				description: `Workflow typed port ${request.outputArtifactType} requires one strict JSON object`,
			},
			responseFormat: { type: "json_object" },
		};
	}
	if (request.outputEncoding !== "json_artifact") return null;
	return {
		outputContract: {
			kind: "json",
			submissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
			requiredStringFields: ["artifactType", "text"],
			exactStringFields: { artifactType: request.outputArtifactType },
			allowedFields: ["artifactType", "text"],
			description: `Workflow typed port ${request.outputArtifactType} requires one non-empty JSON artifact object`,
		},
		responseFormat: { type: "json_object" },
	};
}

function workflowAgentPhysicalClipNotice(inputs: WorkflowAgentRunRequest["inputs"]): string {
	for (const value of inputs["delivery-contract"] ?? []) {
		if (!isRecord(value) || !isRecord(value.generationContract)) continue;
		const topology = isRecord(value.generationContract.providerSubmissionTopology)
			? value.generationContract.providerSubmissionTopology
			: null;
		if (!topology) {
			const requestedClipCount = value.generationContract.requestedClipCount;
			if (
				typeof requestedClipCount === "number"
				&& Number.isInteger(requestedClipCount)
				&& requestedClipCount > 0
			) {
				return `用户已经冻结物理 Clip 数量为 ${String(requestedClipCount)}：BeatSheet 的 beats 必须恰好包含 ${String(requestedClipCount)} 项并从 clipIndex=0 连续编号；每项 durationSeconds 仍由 Agent 在服务端允许的供应商时长集合中依据剧情边界选择。不得多拆或少拆物理 Clip。`;
			}
			continue;
		}
		const count = topology.expectedClipCount;
		const durations = topology.minimumClipDurations;
		if (typeof count !== "number" || !Number.isInteger(count) || !Array.isArray(durations)) continue;
		return `服务端已冻结 providerSubmissionTopology（source=${String(topology.source)}）：物理视频必须严格提交 ${String(count)} 个 Clip，BeatSheet 的 beats 必须按顺序逐项对应这 ${String(count)} 个物理 Clip，durationSeconds 必须严格等于 ${JSON.stringify(durations)}；不得再按语义拆成更多或更少的物理 Clip。语义事件仍写在每个 beat 的 storyEvents 内。Agent 必须在首稿中一次性提交每个 storyEvent 的 entryState/exitState 与每个 beat 的 exitState；runtime 只验收和记录，不会补写状态链。`;
	}
	return "";
}

function isWorkflowBeatSheetArtifactType(artifactType: string): boolean {
	return artifactType === "tapcanvas.beat-sheet/v2"
		|| artifactType === "tapcanvas.launch-beat-sheet/v1";
}

function workflowAgentPrompt(request: WorkflowAgentRunRequest): string {
	const promptInputs = workflowAgentPromptInputs(request);
	const clipWriterFirstPassChecklist = request.outputArtifactType === "tapcanvas.clip-prompts/v2"
		? [
			"视频 Clip writer 首稿提交检查：clip-contexts[0].spokenScript 是冻结的人声唯一来源，不能省略、改写或换字段名。",
			"shots[].durationSeconds 是最终可执行秒数，不是相对权重。提交前从 cursor=0 开始按数组顺序计算每镜半开区间 [shotStart,shotEnd)：shotStart=cursor，shotEnd=cursor+durationSeconds，再令 cursor=shotEnd；最后 cursor 必须精确等于冻结 beat.durationSeconds。runtime 不会缩放、吸收余差或改写任何镜头时长。",
			"对每个 shots[N].depictedStoryEventIndices 中声明的零基事件 i，必须使用上述最终镜头区间验证 shotStart < storyEvents[i].endSeconds 且 shotEnd > storyEvents[i].startSeconds。边界相等不算相交：事件在 16 秒结束、镜头从 16 秒开始时，该镜绝不能继续声明该事件。每个冻结事件仍必须至少由一个真正演出它且时间相交的镜头声明。",
			"当 spokenScript 为空时，speakerBindings 必须省略或严格输出 []，speechEvents 必须是 []；shots 不得出现任何人声正文或人声字段。",
			"当 spokenScript 非空时，每个冻结 lineId 必须由一个且仅一个 speechEvents 项完整承载：先逐字复制 spokenScript[].lineId，lineId 必须与冻结 ID 完全相等（例如 ch1-l005 不能写成 speech-ch1-l005 或 line-ch1-l005）；speechEventId 才是独立的事件标识，可采用 speech-<lineId> 形式。事件还必须给出 startOffset=0、endOffset=该行 Unicode 码点长度、clip 内独立 startSeconds/endSeconds、speakerName、delivery、performance；performance 只写语速、音量、气息、停顿、重音和潜台词，禁止人物站位、肢体/道具动作、镜头或剧情事件；禁止按镜头切分台词。",
			"shots 不得提交 speechEventIds；调用方会在模型首稿已经闭合的最终镜头时钟上按时间窗相交关系确定性编译。同一 SpeechEvent 可以跨多个镜头，切镜不得截断、重启或重复发声。writer 不得提交 spokenText、dialogue 或其它台词正文。",
			"有对白时 speakerBindings 必须只包含冻结说话人且顺序一致，每项 name 非空、assetKind 只能是 character 或 voice，禁止空字符串；角色入画的说话人用 character，纯声音通道才用 voice。",
			"顶层 selfQaNote、creativeReview 与 sourceFidelityAudit 都只是可选追溯证据；缺失或格式不完整不得阻止生产，也不得用审计文字代替 clips 中的真实内容。",
			"不要把对白放进 dialogueScript、speech 或 shot 文案来规避事件合同；只有一个冻结对白行时，建立一个覆盖 [0,N) 的完整 SpeechEvent，逐镜引用仍由调用方编译。",
			"从冻结输入重新生成完整 clips、shots、动作、镜头和资产字段；最终只输出一个完整 JSON 对象。",
		].join("\n")
		: "";
	return [
		"执行当前工作流 Agent 原子节点。",
		"本节点没有执行期纠偏通道：模型只提交一次完整首稿；runtime 不回灌错误、不补字段、不重生成、不切换模型。提交前必须自行完成整体复核。",
		clipWriterFirstPassChecklist,
		`任务目标：${request.instruction}`,
		`声明输出产物：${request.outputArtifactType}`,
		`本节点交付合同：${request.deliveryRequirement}`,
			request.outputArtifactType === "tapcanvas.beat-sheet/v2"
				? `当前 BeatSheet 运行时合同版本为 ${BEAT_SHEET_ARTIFACT_CONTRACT_VERSION}，采用单一事实源：章级 Agent 在唯一提交前完成来源审查与戏剧分析，只提交 sourceCoveragePlan、chapterArc、objectRegistry、beats 中的执行事实。chapterArc 只包含 storyPromise、protagonistThroughline、primaryPayoff、endingHook。sourceCoveragePlan.speechLedger 逐字声明人声；每个 storyEvent 必须一次写全 sourceBeatId、event、entryState、exitState 与本地时间轴，每个 beat.exitState 必须等于本 Beat 最后一项 storyEvent.exitState，跨事件和跨 Beat 连续性由 Agent 自行保证。每段声明 dominantFunction、causalEntry、irreversibleResult、handoffToNext。对象只在根级 objectRegistry 注册一次，每个对象必须显式提交 physicalIdentityKey、referenceImageNodeIds 与 referenceRole，且只能绑定冻结 ProjectContext 能验真的 referenceAssetIds；character 的 physicalIdentityKey 非空，其它 kind 严格为 null。只为成片中真正需要跨 Clip 保持可辨认身份或空间连续性的对象建立参考职责；一次性路人、匿名围观者、背景人群和只承担群体反应的非核心群体，若个体身份无需跨 Clip 连续，必须由模型在唯一首稿中设为 referenceRole=none 且两个引用 ID 数组为空，不为其创建角色卡。beat.objectStates 只通过 objectId 提交状态增量。sourceFidelityAudit 可省略；若输出，只是模型自检诊断，宿主不会生成或改写。clipId、characters、speakers、dialogueScript 与 assetObjectContracts 由宿主根据已提交的确定性事实编译；显式所选资产只能由模型写入根级 objectRegistry[].referenceAssetIds，宿主不会代替模型猜测或补绑。最终 JSON 是下游执行合同，不是分析报告；逐秒摄影调度仍由后续 Clip writer 创作。`
			: request.outputArtifactType === "tapcanvas.launch-beat-sheet/v1"
				? `当前首 Clip BeatSheet 与章级 BeatSheet 使用同一个单一事实源合同版本 ${BEAT_SHEET_ARTIFACT_CONTRACT_VERSION}，只是 beats 必须恰好一项且 clipIndex=0。一次提交 sourceCoveragePlan、chapterArc、objectRegistry 和唯一 beat 的执行事实；每个 storyEvent 写全 entryState、exitState 与本地时间轴，beat.exitState 等于最后一个 storyEvent.exitState。每个 objectRegistry 项显式提交 physicalIdentityKey、referenceImageNodeIds、referenceRole 与已验真 referenceAssetIds。只为成片中真正需要持续可辨认身份或空间连续性的对象建立参考职责；无需身份连续的一次性路人、匿名围观者、背景人群和非核心群体必须设为 referenceRole=none 且两个引用 ID 数组为空。sourceFidelityAudit 可省略；若输出，只是模型自检诊断，宿主不会生成或改写。clipId、characters、speakers、dialogueScript 和 assetObjectContracts 由宿主根据已提交的确定性事实编译。没有新增叙事人声时 narrativeAudioPlan 必须输出 {\"lines\":[]}。`
			: request.outputArtifactType === "tapcanvas.clip-prompts/v2"
				? `当前视频 writer 运行时合同版本为 ${VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION}：writer 创作有序 shots、独立 speechEvents、动作、摄影、表演、逐镜 depictedStoryEventIndices 和创作自检。每条冻结人声必须由一个完整 SpeechEvent 承载并可跨镜头。shots[].durationSeconds 是最终可执行秒数，必须精确加总到冻结 clip durationSeconds；speechEvents 与累计 shot 区间使用同一绝对时钟。每个 depictedStoryEventIndices 声明必须同时满足语义真实承载和半开时间区间严格相交，边界相等不算相交。runtime 不缩放镜头时长、不重映射事件索引，也不回灌修订。shots[].speechEventIds、sourceEventCoverage、temporalFrameTrack 与 temporalFrameCoverage 均由调用方确定性编译；writer 禁止复制任何机器字段。`
					: "",
			isWorkflowBeatSheetArtifactType(request.outputArtifactType)
				? [
					"每次完整结构化提交前，模型必须一次性自检：所有来源对白逐字保留并分配到有效 clipIndex；物理时长使用供应商允许值；storyEvents、sourceBeatId、对象引用和叙事人声结构可被下游读取；语义节拍、参数、对白容量、来源顺序、时间分配与状态连续性由模型整体判断。",
					"runtime 只会拒绝无法解析、无法引用或无法提交给供应商的确定性硬边界；其它模型创作一致性问题只记录诊断，不做字段级补丁，也不阻塞工作流推进。",
					"每个 storyEvents 项都必须携带非空 sourceBeatId，相同来源事件在跨 Clip 时复用同一 ID。sourceBeatId 是 Agent 对来源事件的显式语义归属，不由宿主猜测；runtime 只据此记录来源覆盖诊断，不生成或改写 sourceFidelityAudit。",
				].join("\n")
				: "",
			request.deliveryScope
			? `系统级共享工作流本次由调用者项目发起（deliveryScope=${JSON.stringify(request.deliveryScope)}）。你的工具画布范围就是调用者项目画布。复用资产时只能从 ProjectContext 的 projectAssetIds 中选择，并在资产计划声明 existingAssetId + existingProjectId；禁止输出或依赖 existingImageUrl，资源 URL 由执行期 Asset Resolver 按 ID 解析。`
			: "",
		request.projectContext
			? [
				"本次冻结 ProjectContext（这是运行时权限过滤后的事实，不是提示词猜测）：",
				JSON.stringify(workflowAgentProjectContextPromptFacts(request.projectContext, request.outputArtifactType)),
				isWorkflowBeatSheetArtifactType(request.outputArtifactType)
					? "projectAssetCandidates 是当前项目在本次执行快照中全部已就绪、可生产的图片身份候选。提交唯一首稿前，必须按角色肉身、场景空间及来源事实完成语义核对；展示名、canonicalName 或章节内称谓不同不代表新身份。确认是同一角色肉身或同一场景状态时，把候选 assetId 原样写入对应 objectRegistry[].referenceAssetIds；character 同时优先沿用候选 sourceFacts.physicalIdentityKey。确认是新人物、新地点或可见状态确实不同才保持引用为空并生成新资产。不得仅因字符串不完全相同重复生图，也不得把相似但不同身份强行复用。这个判断只在本次 BeatSheet 首稿中完成，runtime 后续只验证精确 ID 的项目归属、图片就绪状态和单对象绑定，不会返回语义纠偏。"
					: "完整 projectAssetIds/assetSnapshot 仍由服务端保存并用于权限、复用身份和输出合同校验，不在模型提示中重复展开。标准资产能力语义：list_project_assets=读取服务端快照；get_asset/search_project_assets 只能返回许可集合内条目；get_current_selection=读取 selection。不得尝试访问快照外资产。",
			].join("\n")
			: "",
		request.projectContext && isWorkflowBeatSheetArtifactType(request.outputArtifactType) && request.projectContext.selectedAssetIds.length > 0
			? [
				"显式所选资产是一等执行事实，不是可选参考。对下面 selectedAssetIds 中的每个 ID，必须在本次唯一首稿提交前依据 selectedAssetSnapshot 的 canonicalName、kind、referenceType 与 sourceFacts 完成语义匹配，并把该 ID 原样写入恰好一个匹配对象的根级 objectRegistry[].referenceAssetIds；同一根对象最多绑定一个 canonical selected asset。必须覆盖全部 selectedAssetIds，不得遗漏、替换、另生成相似对象或把 ID 写进 beats。beats[].assetObjectContracts 由宿主从 objectRegistry 与 objectStates 确定性派生，模型不得输出；runtime 只验证绑定，不会补绑、猜测或把拒因回灌给模型。",
				"唯一提交前逐项复核：selectedAssetIds 的每个 ID 都在 objectRegistry[].referenceAssetIds 中精确出现一次，并且匹配对象的 name、physicalIdentityKey、referenceRole、identityInvariant 与 selectedAssetSnapshot 来源事实一致。",
				JSON.stringify({ selectedAssetIds: request.projectContext.selectedAssetIds, selectedAssetSnapshot: request.projectContext.assetSnapshot.filter((asset) => request.projectContext?.selectedAssetIds.includes(asset.assetId)) }),
			].join("\n")
			: "",
		workflowAgentPhysicalClipNotice(request.inputs),
		"若上游 canvas-facts 携带 authoritativeSources，它是本次工作流的唯一来源正文投影；先逐字读取该字段，再使用 nodes 里的其他结构事实，禁止从历史会话、素材名称或模型常识补写来源。",
		"若上游 canvas-facts 携带 userRequest，它是当前用户本轮逐字冻结的执行与创作要求；必须按其中明确的 adaptationMode 落实到本节点产物。faithful 模式不得改写 authoritativeSources 故事事实；creative 模式把 authoritativeSources 当作创作底稿，在核心人物关系、世界规则、主线因果与关键结果不偏离的前提下允许新增桥段、对白、冲突、反转、视觉包装和商业化表达，新增人声单独进入 narrativeAudioPlan 并保留来源锚点与创作理由。userRequest 不是故事正文，不得把其中的操作说明、模型名或规格写成剧情。",
		"上游端口事实（JSON）：",
		JSON.stringify(promptInputs),
		request.outputEncoding === "json_array" && request.jsonArrayContract
			? `数组结构合同（JSON）：${JSON.stringify(request.jsonArrayContract)}`
			: "",
		request.outputEncoding === "json_object" && request.jsonObjectContract
			? `对象结构合同（JSON）：${JSON.stringify(request.jsonObjectContract)}`
			: "",
		"本节点产物由最终响应的 text 端口接收；禁止用 write_file、bash 或 exec_command 保存中间文件，必须在最终响应中直接交付声明产物。",
		[
			request.requiredSkills.length > 0
				? `本节点的冻结 Workflow Skill 依赖已经预载：${JSON.stringify(request.requiredSkills)}。按预载骨架给出的精确 sectionId/resource 使用 Skill 渐进读取所需正文；禁止调用 skill_search 重新发现或替换这些依赖。知识证据仍按需要使用 knowledge_search → knowledge_read，候选可见不等于正文已读，禁止伪称引用。完成必要读取后直接交付本节点声明的产物。`
				: "本节点默认拥有完整 Skill 目录与完整向量知识库的检索权限，无需节点挂载。仅在当前产物需要专业方法或声明性证据时，按本轮原始任务使用 skill_search → Skill、knowledge_search → knowledge_read 渐进读取；候选或目录可见不等于正文已读，禁止伪称引用。完成必要读取后直接交付本节点声明的产物。",
			request.promptExampleRetrievalScope
				? request.promptExampleRetrievalScope.searchPolicy === "required_non_blocking"
					? `本节点还是 typed 结构化设计资产提示词作者：案例检索被限定在 ${request.promptExampleRetrievalScope.mediaType} 媒体源。runtime 会在首次创作推理前发起恰好一次候选检索尝试；搜索只返回候选元数据，writer 再按相关性、信息增益与上下文成本读取零条、一条或多条正文，不设固定候选数、最少读取数或自动正文预取。零命中、工具未注册、索引或检索故障都必须如实写入 trace/diagnostics 并继续原创；禁止伪称引用，也禁止把召回数量或质量升级为失败。`
					: `本节点还是 typed 结构化设计资产提示词作者：案例检索被限定在 ${request.promptExampleRetrievalScope.mediaType} 媒体源。仅在当前产物需要案例证据时调用 prompt_example_search 获取候选，再按相关性、信息增益与上下文成本读取零条、一条或多条正文；不设固定数量或自动正文预取。搜索、读取、零命中、工具未注册、索引或检索故障都必须如实写入 trace/diagnostics；无可用正文时继续原创，禁止伪称引用，也禁止把召回数量或质量升级为失败。`
				: "",
		].filter(Boolean).join("\n"),
		isWorkflowBeatSheetArtifactType(request.outputArtifactType)
			? "BeatSheet 的 narrativeAudioPlan 必须始终是对象（至少包含 lines 数组）；没有新增叙事人声时使用 {\"lines\":[]}，禁止使用空数组。"
			: "",
		request.outputEncoding === "json_artifact"
			? `最终响应必须只包含一个严格 JSON 对象，结构为 {"artifactType":${JSON.stringify(request.outputArtifactType)},"text":"完整产物正文"}；禁止 Markdown 代码围栏、前后说明和额外顶层字段。text 必须是实际产物，不得是完成声明或产物摘要。`
			: request.outputEncoding === "json_object"
				? "最终响应必须只包含符合对象结构合同的严格 JSON 对象；禁止 Markdown 代码围栏、前后说明和额外字段。"
				: request.outputEncoding === "json_array"
					? "最终响应必须只包含一个严格 JSON 对象，结构为 {\"items\":[...完整数组项]}；items 必须符合数组结构合同且非空，禁止 Markdown 代码围栏、前后说明和额外顶层字段。运行时会在验证后确定性解包为 typed port 所需的顶层数组。"
					: "最终响应正文必须就是完整产物本身，不得只返回完成声明、产物摘要或下一步说明。",
		"工作流运行时会基于 typed output 与真实任务终态构造 expectedDelivery → deliveryEvidence → deliveryVerification；最终响应不得输出这些协议字段或验收报告，只交付本节点声明的产物。",
	].filter(Boolean).join("\n\n");
}

function workflowAgentRetrievalUserRequest(request: WorkflowAgentRunRequest): string {
	const promptInputs = workflowAgentPromptInputs(request);
	const visit = (value: unknown, depth: number): string => {
		if (depth > 8 || !value) return "";
		if (Array.isArray(value)) {
			for (const item of value) {
				const found = visit(item, depth + 1);
				if (found) return found;
			}
			return "";
		}
		if (!isRecord(value)) return "";
		const canvasFacts = isRecord(value.canvasFacts) ? value.canvasFacts : null;
		const canvasText = canvasFacts && typeof canvasFacts.text === "string"
			? canvasFacts.text.trim()
			: "";
		if (canvasText) return canvasText;
		if (canvasFacts && Array.isArray(canvasFacts.nodes)) {
			for (const node of canvasFacts.nodes) {
				if (!isRecord(node) || typeof node.content !== "string") continue;
				const content = node.content.trim();
				if (content) return content;
			}
		}
		if (typeof value.sourceMode === "string" && typeof value.text === "string" && value.text.trim()) {
			return value.text.trim();
		}
		for (const nested of Object.values(value)) {
			const found = visit(nested, depth + 1);
			if (found) return found;
		}
		return "";
	};
	return visit(promptInputs, 0) || JSON.stringify(promptInputs);
}

function workflowAgentRetrievalContext(request: WorkflowAgentRunRequest): Readonly<{
	protocolVersion: "retrieval-context/v1";
	facts: readonly Readonly<{
		id: string;
		text: string;
		source: "instruction" | "delivery" | "input" | "scope";
	}>[];
}> {
	type RetrievalFact = Readonly<{
		id: string;
		text: string;
		source: "instruction" | "delivery" | "input" | "scope";
	}>;
	const inputFacts = Object.entries(workflowAgentPromptInputs(request))
		.slice(0, 4)
		.map(([port, values]): RetrievalFact => ({
			id: `input-port:${port}`,
			text: JSON.stringify(values).slice(0, 4_000),
			source: "input",
		}));
	const facts: RetrievalFact[] = [
		{ id: "node-instruction", text: request.instruction, source: "instruction" },
		{ id: "delivery-requirement", text: request.deliveryRequirement, source: "delivery" },
		{ id: "output-artifact-type", text: request.outputArtifactType, source: "delivery" },
		...(request.forcedAgentRole
			? [{ id: "forced-agent-role", text: request.forcedAgentRole, source: "scope" as const }]
			: []),
		...inputFacts,
	];
	return {
		protocolVersion: "retrieval-context/v1",
		facts: facts.slice(0, 8),
	};
}

// 无进展恢复窗口上限：物理窗口（默认 900s，见 agents-cli runtime.createCapabilityGrant）
// 内慢速大体积结构化输出可能因供应商间歇空响应连续数窗无进展；窗口预算放大后，
// 上限同步放宽，让重试在真实故障窗口内有机会成功，而不是在 LLM 侧波动期过早判死。
const WORKFLOW_AGENT_NO_PROGRESS_WINDOW_LIMIT = 5;
const WORKFLOW_AGENT_NO_PROGRESS_RETRY_BASE_DELAY_MS = 60_000;
const WORKFLOW_AGENT_NO_PROGRESS_RETRY_MAX_DELAY_MS = 15 * 60_000;
const WORKFLOW_AGENT_NO_PROGRESS_PHYSICAL_FAILURE = "workflow_agent_no_progress_window_exhausted";
const RETRYABLE_WORKFLOW_AGENT_PHYSICAL_FAILURE_CODES = new Set([
	"workflow_agent_role_timeout",
	"provider_stream_interrupted",
	"llm_response_too_large",
]);

type WorkflowAgentRecoveryWindow = Readonly<{
	progressRevision: number;
	physicalRunId: string;
	windowsWithoutProgress: number;
	limit: number;
}>;

function nonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: null;
}

function previousRecoveryWindow(previousEvidence: Record<string, unknown> | null): WorkflowAgentRecoveryWindow | null {
	if (!previousEvidence) return null;
	const deliveryEvidence = isRecord(previousEvidence.deliveryEvidence)
		? previousEvidence.deliveryEvidence
		: previousEvidence;
	const recoveryWindow = isRecord(deliveryEvidence.recoveryWindow)
		? deliveryEvidence.recoveryWindow
		: null;
	const progressRevision = nonNegativeInteger(recoveryWindow?.progressRevision);
	const physicalRunId = typeof recoveryWindow?.physicalRunId === "string"
		? recoveryWindow.physicalRunId.trim()
		: "";
	const windowsWithoutProgress = nonNegativeInteger(recoveryWindow?.windowsWithoutProgress);
	if (progressRevision === null || !physicalRunId || windowsWithoutProgress === null) return null;
	return {
		progressRevision,
		physicalRunId,
		windowsWithoutProgress,
		limit: WORKFLOW_AGENT_NO_PROGRESS_WINDOW_LIMIT,
	};
}

function nextRecoveryWindow(
	request: WorkflowAgentRunRequest,
	checkpoint: Readonly<{ progressRevision: number; physicalRunId: string }>,
): WorkflowAgentRecoveryWindow {
	const previous = previousRecoveryWindow(request.previousEvidence);
	const observesSamePhysicalRun = previous?.progressRevision === checkpoint.progressRevision
		&& previous.physicalRunId === checkpoint.physicalRunId;
	const observesNewPhysicalRunWithoutProgress = previous?.progressRevision === checkpoint.progressRevision
		&& previous.physicalRunId !== checkpoint.physicalRunId;
	return {
		progressRevision: checkpoint.progressRevision,
		physicalRunId: checkpoint.physicalRunId,
		windowsWithoutProgress: observesSamePhysicalRun
			? previous.windowsWithoutProgress
			: observesNewPhysicalRunWithoutProgress
				? previous.windowsWithoutProgress + 1
				: 1,
		limit: WORKFLOW_AGENT_NO_PROGRESS_WINDOW_LIMIT,
	};
}

function durableTurnEvidence(input: Readonly<{
	request: WorkflowAgentRunRequest;
	sessionKey: string;
	turn: NonNullable<AgentsChatTurnStatusSnapshot["turn"]>;
	recoveryWindow?: WorkflowAgentRecoveryWindow;
}>): Readonly<Record<string, unknown>> {
	const checkpoint = input.turn.recoveryCheckpoint;
	const physicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(input.request);
	const rateLimitDeferralCount = parseWorkflowAgentPhysicalFailureEvidence(
		input.request.previousEvidence,
	)?.rateLimitDeferralCount ?? null;
	const noProgressRecoveryEpoch = workflowAgentNoProgressRecoveryEpoch(input.request);
	const recoveryWindow = input.recoveryWindow
		?? previousRecoveryWindow(input.request.previousEvidence);
	return {
		version: 1,
		source: "agents_cli_durable_turn_status",
		sessionKey: input.sessionKey,
		logicalTaskId: input.turn.turnId,
		internalTurnId: input.turn.internalTurnId,
		state: input.turn.state,
		phase: input.turn.phase,
		lastConfirmedAt: input.turn.lastConfirmedAt,
		outputArtifactType: input.request.outputArtifactType,
		...(physicalRetryOrdinal === null ? {} : { physicalRetryOrdinal }),
		...(rateLimitDeferralCount === null ? {} : { rateLimitDeferralCount }),
		...(noProgressRecoveryEpoch === 0 ? {} : { noProgressRecoveryEpoch }),
		...(recoveryWindow ? { recoveryWindow } : {}),
		...(checkpoint
			? {
				recoveryCheckpoint: {
					reasonCode: checkpoint.reasonCode,
					physicalRunId: checkpoint.physicalRunId,
					progressRevision: checkpoint.progressRevision,
					durableTaskReferenceCount: checkpoint.durableTaskReferences.length,
					durableProgressClaimCount: checkpoint.durableProgressClaims.length,
				},
			}
			: {}),
	};
}
function waitingAgentResult(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	sessionKey: string;
	turn: NonNullable<AgentsChatTurnStatusSnapshot["turn"]>;
	reason: string;
	recoveryWindow?: WorkflowAgentRecoveryWindow;
}>): WorkflowAgentRunResult {
	return {
		taskId: input.publicTurnId,
		text: "",
		assets: [],
		expectedDelivery: workflowAgentExpectedDelivery(input.request),
		deliveryEvidence: durableTurnEvidence(input),
		deliveryVerification: null,
		requestTerminal: {
			status: "suspended",
			reason: input.reason,
		},
		...durableTurnProvenance(input.turn),
	};
}

function waitingAcceptedWorkflowTurnProjectionResult(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	sessionKey: string;
	traceStartedAt: string;
	traceUpdatedAt: string;
	traceStatus: "running" | "waiting_async";
}>): WorkflowAgentRunResult {
	const physicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(input.request);
	const recoveryWindow = previousRecoveryWindow(input.request.previousEvidence);
	return {
		taskId: input.publicTurnId,
		text: "",
		assets: [],
		expectedDelivery: workflowAgentExpectedDelivery(input.request),
		deliveryEvidence: {
			version: 1,
			source: "execution_trace_admission",
			sessionKey: input.sessionKey,
			logicalTaskId: input.publicTurnId,
			state: "accepted",
			phase: "turn_projection_pending",
			traceStatus: input.traceStatus,
			traceStartedAt: input.traceStartedAt,
			traceUpdatedAt: input.traceUpdatedAt,
			outputArtifactType: input.request.outputArtifactType,
			...(physicalRetryOrdinal === null ? {} : { physicalRetryOrdinal }),
			...(recoveryWindow ? { recoveryWindow } : {}),
		},
		deliveryVerification: null,
		requestTerminal: {
			status: "suspended",
			reason: "workflow_agent_accepted_turn_projection_pending",
		},
	};
}

function waitingWorkflowAgentRateLimitBackpressureResult(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	physicalFailure: WorkflowAgentPhysicalFailureEvidence;
}>): WorkflowAgentRunResult {
	return {
		taskId: input.publicTurnId,
		text: "",
		assets: [],
		expectedDelivery: workflowAgentExpectedDelivery(input.request),
		deliveryEvidence: input.physicalFailure.evidence,
		deliveryVerification: null,
		requestTerminal: {
			status: "suspended",
			reason: "workflow_agent_rate_limit_backpressure",
		},
	};
}

function workflowAgentNoProgressRecoveryEpoch(
	request: WorkflowAgentRunRequest,
): number {
	const evidence = previousAgentDeliveryEvidence(request.previousEvidence);
	return nonNegativeInteger(evidence?.noProgressRecoveryEpoch) ?? 0;
}

function deferWorkflowAgentNoProgressRecovery(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	baseEvidence: Readonly<Record<string, unknown>>;
	recoveryWindow: WorkflowAgentRecoveryWindow;
	text?: string;
	provenance?: Pick<WorkflowAgentRunResult, "executionProvenance" | "executionProvenanceHistory">;
	nowMs?: number;
}>): WorkflowAgentRunResult {
	const currentPhysicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(input.request) ?? 0;
	const physicalRetryOrdinal = currentPhysicalRetryOrdinal + 1;
	const noProgressRecoveryEpoch = workflowAgentNoProgressRecoveryEpoch(input.request) + 1;
	const retryAfterMs = Math.min(
		WORKFLOW_AGENT_NO_PROGRESS_RETRY_BASE_DELAY_MS
			* (2 ** Math.min(noProgressRecoveryEpoch - 1, 20)),
		WORKFLOW_AGENT_NO_PROGRESS_RETRY_MAX_DELAY_MS,
	);
	const retryNotBeforeAt = new Date((input.nowMs ?? Date.now()) + retryAfterMs).toISOString();
	const nextPhysicalRunId = workflowAgentPublicTurnId({
		executionId: input.request.executionId,
		nodeId: input.request.nodeId,
		physicalRetryOrdinal,
	});
	return {
		taskId: input.publicTurnId,
		text: input.text ?? "",
		assets: [],
		expectedDelivery: workflowAgentExpectedDelivery(input.request),
		deliveryEvidence: {
			...input.baseEvidence,
			retryablePhysicalFailure: true,
			physicalFailureReason: WORKFLOW_AGENT_NO_PROGRESS_PHYSICAL_FAILURE,
			physicalRetryOrdinal,
			noProgressRecoveryEpoch,
			retryAfterMs,
			retryNotBeforeAt,
			recoveryWindow: {
				progressRevision: input.recoveryWindow.progressRevision,
				physicalRunId: nextPhysicalRunId,
				windowsWithoutProgress: 0,
				limit: WORKFLOW_AGENT_NO_PROGRESS_WINDOW_LIMIT,
			},
		},
		deliveryVerification: null,
		requestTerminal: {
			status: "suspended",
			reason: "workflow_agent_no_progress_recovery_deferred",
		},
		...(input.provenance ?? {}),
	};
}

function deferWorkflowAgentDurableRateLimit(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	sessionKey: string;
	turn: NonNullable<AgentsChatTurnStatusSnapshot["turn"]>;
}>): WorkflowAgentRunResult {
	const previousDelivery = previousAgentDeliveryEvidence(input.request.previousEvidence);
	const persistedEvidence = createWorkflowAgentRateLimitBackpressureEvidence({
		deliveryEvidence: {
			...(previousDelivery ?? {}),
			...durableTurnEvidence({
				request: input.request,
				sessionKey: input.sessionKey,
				turn: input.turn,
			}),
		},
	}, Date.now(), `${input.request.executionFamilyId}:${input.request.nodeId}`);
	const physicalFailure = parseWorkflowAgentPhysicalFailureEvidence({
		deliveryEvidence: persistedEvidence,
	});
	if (!physicalFailure) {
		throw new AppError("Workflow Agent rate-limit checkpoint is invalid", {
			status: 500,
			code: "workflow_agent_rate_limit_checkpoint_invalid",
		});
	}
	return {
		...waitingWorkflowAgentRateLimitBackpressureResult({
			request: input.request,
			publicTurnId: input.publicTurnId,
			physicalFailure,
		}),
		...durableTurnProvenance(input.turn),
	};
}

function retryWorkflowAgentPhysicalRun(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	sessionKey: string;
	turn: NonNullable<AgentsChatTurnStatusSnapshot["turn"]>;
	failureReason: string;
}>): WorkflowAgentRunResult {
	const previousPhysicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(input.request) ?? 0;
	const previousWindow = previousRecoveryWindow(input.request.previousEvidence);
	const recoveryWindow = nextRecoveryWindow(
		input.request,
		input.turn.recoveryCheckpoint ?? {
			progressRevision: previousWindow?.progressRevision ?? 0,
			physicalRunId: input.publicTurnId,
		},
	);
	if (recoveryWindow && recoveryWindow.windowsWithoutProgress >= recoveryWindow.limit) {
		return deferWorkflowAgentNoProgressRecovery({
			request: input.request,
			publicTurnId: input.publicTurnId,
			baseEvidence: durableTurnEvidence({
				request: input.request,
				sessionKey: input.sessionKey,
				turn: input.turn,
				recoveryWindow,
			}),
			recoveryWindow,
			text: input.turn.finalResponse ?? "",
			provenance: durableTurnProvenance(input.turn),
		});
	}
	const nextPhysicalRetryOrdinal = previousPhysicalRetryOrdinal + 1;
	return {
		...waitingAgentResult({
			request: input.request,
			publicTurnId: input.publicTurnId,
			sessionKey: input.sessionKey,
			turn: input.turn,
			...(recoveryWindow ? { recoveryWindow } : {}),
			reason: "workflow_agent_physical_retry_pending",
		}),
		deliveryEvidence: {
			...durableTurnEvidence({
				request: input.request,
				sessionKey: input.sessionKey,
				turn: input.turn,
				...(recoveryWindow ? { recoveryWindow } : {}),
			}),
			retryablePhysicalFailure: true,
			physicalFailureReason: input.failureReason,
			physicalRetryOrdinal: nextPhysicalRetryOrdinal,
		},
	};
}

function retryWorkflowAgentMissingDurableTurn(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	sessionKey: string;
	traceStatus: string;
	traceUpdatedAt: string;
}>): WorkflowAgentRunResult {
	const previousWindow = previousRecoveryWindow(input.request.previousEvidence);
	const recoveryWindow = nextRecoveryWindow(input.request, {
		progressRevision: previousWindow?.progressRevision ?? 0,
		physicalRunId: input.publicTurnId,
	});
	const currentPhysicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(input.request) ?? 0;
	const deliveryEvidence = {
		version: 1,
			source: "execution_trace_without_durable_turn",
		sessionKey: input.sessionKey,
		logicalTaskId: input.publicTurnId,
		state: "unknown",
		phase: "turn_projection_missing",
		lastConfirmedAt: input.traceUpdatedAt,
		traceStatus: input.traceStatus,
		outputArtifactType: input.request.outputArtifactType,
		recoveryWindow,
	};
	if (recoveryWindow.windowsWithoutProgress >= recoveryWindow.limit) {
		return deferWorkflowAgentNoProgressRecovery({
			request: input.request,
			publicTurnId: input.publicTurnId,
			baseEvidence: deliveryEvidence,
			recoveryWindow,
		});
	}
	return {
		taskId: input.publicTurnId,
		text: "",
		assets: [],
		expectedDelivery: workflowAgentExpectedDelivery(input.request),
		deliveryEvidence: {
			...deliveryEvidence,
			retryablePhysicalFailure: true,
			physicalFailureReason: "workflow_agent_durable_turn_missing",
			physicalRetryOrdinal: currentPhysicalRetryOrdinal + 1,
		},
		deliveryVerification: null,
		requestTerminal: {
			status: "suspended",
			reason: "workflow_agent_physical_retry_pending",
		},
	};
}

async function recoverWorkflowAgentNodeFromDurableTurn(
	context: AppContext,
	request: WorkflowAgentRunRequest,
	publicTurnId: string,
): Promise<WorkflowAgentRunResult> {
	const sessionKey = sessionKeyForWorkflowAgent(request);
	const snapshot = await getAgentsChatTurnStatus(
		context,
		request.ownerId,
		sessionKey,
		{ timeoutMs: WORKFLOW_AGENT_STATUS_DEADLINE_MS },
	);
	const turn = snapshot.turn;
	if (!turn) {
		// Admission and durable turn projection are two causally ordered facts,
		// not one atomic write. Concurrent reconcilers can observe the immutable
		// execution-trace admission after the winning request is accepted but
		// before agents-cli has projected TurnStarted into its durable session.
		// The accepted trace owns the exact public turn identity during this
		// window; keep reconciling it instead of failing the logical Workflow node
		// (which would cancel the winner that is still starting).
		const admission = await getExecutionTraceLifecycleSnapshot(context.env.DB, {
			traceId: publicTurnId,
			userId: request.ownerId,
		});
		if (
			admission
			&& (admission.status === "running" || admission.status === "waiting_async")
			&& admission.logicalTaskId === publicTurnId
			&& admission.rootTraceId === publicTurnId
		) {
			if (isFreshWorkflowAgentAdmissionTimestamp(admission.updatedAt)) {
				return waitingAcceptedWorkflowTurnProjectionResult({
					request,
					publicTurnId,
					sessionKey,
					traceStartedAt: admission.startedAt,
					traceUpdatedAt: admission.updatedAt,
					traceStatus: admission.status,
				});
			}
			// An admitted trace without a durable turn is only a short projection
			// handoff. Once that handoff is stale, retaining `running` forever
			// would make every external check a no-op and strand the workflow.
			// Re-enter the bounded physical retry ledger instead; the trace is
			// immutable and the exact public turn identity prevents duplicate
			// submissions while the stale generation is fenced.
			return retryWorkflowAgentMissingDurableTurn({
				request,
				publicTurnId,
				sessionKey,
				traceStatus: admission.status,
				traceUpdatedAt: admission.updatedAt,
			});
		}
		if (
			admission
			&& admission.logicalTaskId === publicTurnId
			&& admission.rootTraceId === publicTurnId
		) {
			return retryWorkflowAgentMissingDurableTurn({
				request,
				publicTurnId,
				sessionKey,
				traceStatus: admission.status,
				traceUpdatedAt: admission.updatedAt,
			});
		}
		throw new AppError("Workflow Agent durable turn is missing", {
			status: 409,
			code: "workflow_agent_durable_turn_missing",
			details: { sessionKey, publicTurnId },
		});
	}
	if (turn.turnId !== publicTurnId) {
		throw new AppError("Workflow Agent durable turn identity changed", {
			status: 409,
			code: "workflow_agent_durable_turn_mismatch",
			details: {
				sessionKey,
				expectedTurnId: publicTurnId,
				actualTurnId: turn.turnId,
			},
		});
	}
	if (snapshot.activeTurn || turn.state === "running") {
		const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
		return waitingAgentResult({
			request,
			publicTurnId,
			sessionKey,
			turn,
			reason: "workflow_agent_turn_still_running",
			...(recoveryWindow ? { recoveryWindow } : {}),
		});
	}
	if (turn.state === "suspended") {
		// Provider balance is an external deterministic boundary, not an
		// ineffective recovery window. agents-cli may legitimately preserve a
		// recovery checkpoint beside this suspension so the exact typed-output
		// frontier can continue after the account is funded. Never let the mere
		// presence of that checkpoint route balance wait through same-request
		// resume or the no-progress counter.
		if (turn.reasonCode === "provider_balance_required") {
			const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
			return waitingAgentResult({
				request,
				publicTurnId,
				sessionKey,
				turn,
				reason: "provider_balance_required",
				...(recoveryWindow ? { recoveryWindow } : {}),
			});
		}
		const checkpoint = turn.recoveryCheckpoint;
		if (checkpoint) {
			const recoveryWindow = nextRecoveryWindow(request, checkpoint);
			if (recoveryWindow.windowsWithoutProgress >= recoveryWindow.limit) {
				return deferWorkflowAgentNoProgressRecovery({
					request,
					publicTurnId,
					baseEvidence: durableTurnEvidence({
						request,
						sessionKey,
						turn,
						recoveryWindow,
					}),
					recoveryWindow,
					provenance: durableTurnProvenance(turn),
				});
			}
			let continuationScheduled = false;
			try {
				const continuation = await resumePersistedAgentsChatTurn({
					c: context,
					userId: request.ownerId,
					sessionKey,
					turnId: publicTurnId,
				});
				continuationScheduled = continuation.resumed;
			} catch (error: unknown) {
				const resumeOutcome = workflowAgentContinuationResumeOutcome(error);
				if (resumeOutcome === null) throw error;
				continuationScheduled = resumeOutcome === "already_active";
			}
			if (!continuationScheduled) {
				return retryWorkflowAgentPhysicalRun({
					request,
					publicTurnId,
					sessionKey,
					turn,
					failureReason: checkpoint.reasonCode,
				});
			}
			return waitingAgentResult({
				request,
				publicTurnId,
				sessionKey,
				turn,
				recoveryWindow,
				reason: "workflow_agent_same_task_continuation_scheduled",
			});
		}
		// A provider transport can terminate before agents-cli persists a recovery
		// checkpoint. There is no durable in-run frontier to resume, but the frozen
		// Workflow node input is still sufficient to start a distinct physical run.
		// Keep that rebuild inside the existing bounded physical retry ledger.
		if (
			turn.reasonCode !== null
			&& RETRYABLE_WORKFLOW_AGENT_PHYSICAL_FAILURE_CODES.has(turn.reasonCode)
		) {
			return retryWorkflowAgentPhysicalRun({
				request,
				publicTurnId,
				sessionKey,
				turn,
				failureReason: turn.reasonCode,
			});
		}
		return waitingAgentResult({
			request,
			publicTurnId,
			sessionKey,
			turn,
			reason: turn.reasonCode ?? "workflow_agent_turn_suspended",
		});
	}
	// A typed Agent turn gets exactly one complete structured submission. Expose
	// the persisted raw candidate once so the node boundary can record the same
	// immutable failure evidence; neither this runner nor the node executor may
	// resume that turn, feed the error back, merge a candidate or schedule a new
	// structured attempt.
	if (
		turn.state === "failed"
		&& turn.reasonCode === "structured_output_invalid"
		&& request.outputEncoding !== "plain_text"
	) {
		return {
			taskId: publicTurnId,
			text: turn.finalResponse ?? "",
			assets: [],
			expectedDelivery: workflowAgentExpectedDelivery(request),
			deliveryEvidence: {
				...durableTurnEvidence({ request, sessionKey, turn }),
				physicalActionTerminal: "structured_output_invalid",
			},
			deliveryVerification: null,
			requestTerminal: {
				status: "succeeded",
				reason: "agents_cli_single_submission_recorded",
			},
			...durableTurnProvenance(turn),
		};
	}
	if (
		turn.state === "failed"
		&& isWorkflowAgentRateLimitFailureCode(turn.reasonCode)
	) {
		return deferWorkflowAgentDurableRateLimit({
			request,
			publicTurnId,
			sessionKey,
			turn,
		});
	}
	if (
		turn.state === "failed"
		&& turn.reasonCode !== null
		&& RETRYABLE_WORKFLOW_AGENT_PHYSICAL_FAILURE_CODES.has(turn.reasonCode)
	) {
		return retryWorkflowAgentPhysicalRun({
			request,
			publicTurnId,
			sessionKey,
			turn,
			failureReason: turn.reasonCode,
		});
	}
	// A bridge/process restart can leave the durable turn at an inactive
	// accepted/agent-running checkpoint before the status reconciler has had a
	// chance to project it as `suspended`. That shape is already a resumable
	// public-chat contract; a workflow node must keep waiting/reconciling it,
	// never convert the transient `unknown` projection into a terminal node
	// failure. The resume endpoint still performs the authoritative same-user,
	// same-session, same-turn CAS proof before it schedules anything.
	if (turn.state === "unknown" && resolveInactiveChatTurnRecoveryKind(turn) !== null) {
		// Durable admission and in-memory activation are separate writes. During
		// that short handoff, status can truthfully expose an inactive `unknown`
		// checkpoint even though the accepted request is about to install its live
		// owner. Starting a distinct physical run in this window duplicates model
		// spend and lets two corrections race for one retained candidate. Observe a
		// bounded freshness window first; only an older checkpoint is eligible for
		// orphan continuation/retry reconciliation.
		if (isFreshInactiveWorkflowAgentAdmission(turn)) {
			const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
			return waitingAgentResult({
				request,
				publicTurnId,
				sessionKey,
				turn,
				...(recoveryWindow ? { recoveryWindow } : {}),
				reason: "workflow_agent_accepted_turn_activation_pending",
			});
		}
		let continuationScheduled = false;
		try {
			const continuation = await resumePersistedAgentsChatTurn({
				c: context,
				userId: request.ownerId,
				sessionKey,
				turnId: publicTurnId,
			});
			continuationScheduled = continuation.resumed;
		} catch (error: unknown) {
			const resumeOutcome = workflowAgentContinuationResumeOutcome(error);
			if (resumeOutcome === null) throw error;
			continuationScheduled = resumeOutcome === "already_active";
		}
		if (!continuationScheduled) {
			return retryWorkflowAgentPhysicalRun({
				request,
				publicTurnId,
				sessionKey,
				turn,
				failureReason: "workflow_agent_orphaned_checkpoint",
			});
		}
		const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
		return waitingAgentResult({
			request,
			publicTurnId,
			sessionKey,
			turn,
			...(recoveryWindow ? { recoveryWindow } : {}),
			reason: continuationScheduled
				? "workflow_agent_orphaned_turn_continuation_scheduled"
				: "workflow_agent_orphaned_turn_continuation_pending",
		});
	}
	if (turn.state === "needs_input") {
		return {
			taskId: publicTurnId,
			text: turn.finalResponse ?? "",
			assets: [],
			expectedDelivery: workflowAgentExpectedDelivery(request),
			deliveryEvidence: durableTurnEvidence({ request, sessionKey, turn }),
			deliveryVerification: null,
			requestTerminal: {
				status: "needs_input",
				reason: turn.reasonCode ?? "workflow_agent_turn_needs_input",
			},
			...durableTurnProvenance(turn),
		};
	}
	if (turn.state !== "succeeded") {
		return {
			taskId: publicTurnId,
			text: turn.finalResponse ?? "",
			assets: [],
			expectedDelivery: workflowAgentExpectedDelivery(request),
			deliveryEvidence: durableTurnEvidence({ request, sessionKey, turn }),
			deliveryVerification: null,
			requestTerminal: {
				status: "failed",
				reason: turn.reasonCode ?? `workflow_agent_turn_${turn.state}`,
			},
			...durableTurnProvenance(turn),
		};
	}
	if (!turn.finalResponse) {
		throw new AppError("Workflow Agent succeeded without a persisted terminal response", {
			status: 502,
			code: "workflow_agent_terminal_response_missing",
			details: { sessionKey, publicTurnId, phase: turn.phase },
		});
	}
	const evidence = durableTurnEvidence({ request, sessionKey, turn });
	return unwrapWorkflowAgentTransportEnvelope(request, {
		taskId: publicTurnId,
		text: turn.finalResponse,
		assets: [],
		expectedDelivery: workflowAgentExpectedDelivery(request),
		deliveryEvidence: evidence,
		// A durable Agent turn finishing proves only that its physical model run
		// ended. The Workflow typed-output contract is validated by the caller
		// before it projects a satisfied delivery verification.
		deliveryVerification: null,
		requestTerminal: {
			status: "succeeded",
			reason: "agents_cli_durable_turn_succeeded",
		},
		...durableTurnProvenance(turn),
	});
}

export async function runWorkflowAgentNode(
	env: WorkerEnv,
	request: WorkflowAgentRunRequest,
): Promise<WorkflowAgentRunResult> {
	const physicalRetryEvidence = request.resumeOnly
		? parseWorkflowAgentPhysicalFailureEvidence(request.previousEvidence)
		: null;
	const publicTurnId = workflowAgentPublicTurnId({
		executionId: request.executionId,
		nodeId: request.nodeId,
		physicalRetryOrdinal: workflowAgentPhysicalRetryOrdinal(request),
	});
	const context = createInternalWorkflowContext(env, request, publicTurnId);
	try {
		if (request.resumeOnly) {
			if (physicalRetryEvidence) {
				// A persisted physical-retry checkpoint owns its quiet window.
				// Reconciliation may run often, but it must remain a zero-model-call
				// operation until the absolute retry time is due. This makes both rate
				// limiting and no-progress retirement restart-safe without a retry storm.
				if (remainingWorkflowAgentPhysicalRetryDelayMs(physicalRetryEvidence) > 0) {
					if (physicalRetryEvidence.reason !== "llm_http_429") {
						return {
							taskId: publicTurnId,
							text: "",
							assets: [],
							expectedDelivery: workflowAgentExpectedDelivery(request),
							deliveryEvidence: physicalRetryEvidence.evidence,
							deliveryVerification: null,
							requestTerminal: {
								status: "suspended",
								reason: "workflow_agent_no_progress_recovery_deferred",
							},
						};
					}
					return waitingWorkflowAgentRateLimitBackpressureResult({
						request,
						publicTurnId,
						physicalFailure: physicalRetryEvidence,
					});
				}
				const fence = await fencePreviousWorkflowAgentPhysicalGeneration(
					env,
					request,
					publicTurnId,
					physicalRetryEvidence.retryOrdinal,
				);
				if (!fence.fenced) {
					return waitingWorkflowAgentGenerationFenceResult({
						request,
						currentPublicTurnId: publicTurnId,
						previousPublicTurnId: fence.previousPublicTurnId,
						physicalRetryOrdinal: physicalRetryEvidence.retryOrdinal,
						physicalFailureReason: physicalRetryEvidence.reason,
						fenceErrorCode: fence.errorCode,
					});
				}
				return await runFreshWorkflowAgentAttempt(
					env,
					request,
					publicTurnId,
				);
			}
			return await recoverWorkflowAgentNodeFromDurableTurn(
				context,
				request,
				publicTurnId,
			);
		}
		return await runFreshWorkflowAgentAttempt(env, request, publicTurnId);
	} catch (error: unknown) {
		if (error instanceof AppError && error.code === "agents_chat_turn_already_exists") {
			return await recoverWorkflowAgentNodeFromDurableTurn(
				context,
				request,
				publicTurnId,
			);
		}
		if (!isRecoverableWorkflowAgentInterruption(error)) throw error;
		return interruptedAgentResult(request, publicTurnId, error);
	}
}

function previousAgentDeliveryEvidence(
	previousEvidence: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (!previousEvidence) return null;
	let current = previousEvidence;
	for (let depth = 0; depth < 8; depth += 1) {
		const nested = current.deliveryEvidence;
		if (!isRecord(nested) || nested === current) return current;
		current = nested;
	}
	return current;
}

function workflowAgentPhysicalRetryOrdinal(
	request: WorkflowAgentRunRequest,
): number | null {
	if (!request.resumeOnly) return null;
	const evidence = previousAgentDeliveryEvidence(request.previousEvidence);
	const ordinal = nonNegativeInteger(evidence?.physicalRetryOrdinal);
	return ordinal !== null && ordinal > 0 ? ordinal : null;
}

async function runFreshWorkflowAgentAttempt(
	env: WorkerEnv,
	request: WorkflowAgentRunRequest,
	publicTurnId: string,
): Promise<WorkflowAgentRunResult> {
	const context = createInternalWorkflowContext(env, request, publicTurnId);
	const structuredOutput = workflowAgentStructuredOutput(request);
	const attemptMaxOutputTokens = request.maxOutputTokens;
	const effectiveRequiredSkills: readonly string[] = request.requiredSkills;
	const effectiveMountedKnowledgeCardIds: readonly string[] = [];
	const effectiveAllowedTools = request.allowedTools;
	const workflowPhysicalAttemptDeadlineAt = request.productionStartDeadline
		? computeWorkflowAgentPhysicalAttemptDeadlineAt({
			productionStartDeadline: request.productionStartDeadline,
		  })
		: null;
	const requestInput: AgentsChatRequestDto = {
		prompt: workflowAgentPrompt(request),
		modelKey: request.modelKey,
		sessionKey: sessionKeyForWorkflowAgent(request),
		...(request.deliveryScope?.chapterId
			? { chapterId: request.deliveryScope.chapterId }
			: { canvasFlowId: request.flowId }),
		...(request.projectId ? { canvasProjectId: request.projectId } : {}),
		canvasNodeId: request.nodeId,
		...(effectiveRequiredSkills.length > 0
			? { requiredSkills: [...effectiveRequiredSkills] }
			: {}),
		...(effectiveMountedKnowledgeCardIds.length > 0
			? { mountedKnowledgeCardIds: [...effectiveMountedKnowledgeCardIds] }
			: {}),
		...(request.promptExampleRetrievalScope
			? { promptExampleRetrievalScope: request.promptExampleRetrievalScope }
			: {}),
		executionToolPolicy: {
			mode: "restricted",
			allowedTools: [...effectiveAllowedTools],
		},
		...(request.forcedAgentRole
			? {
				forcedAgentRole: request.forcedAgentRole,
				allowedSubagentTypes: [request.forcedAgentRole],
			}
			: {}),
		...(structuredOutput
			? { response_format: structuredOutput.responseFormat }
			: {}),
		stream: false,
	};
	const taskRequest = buildTaskRequest(requestInput);
	Object.assign(taskRequest.extras as Record<string, unknown>, {
		publicTurnId,
		logicalTaskId: publicTurnId,
		maxOutputTokens: attemptMaxOutputTokens,
		...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
		...(workflowPhysicalAttemptDeadlineAt ? { workflowPhysicalAttemptDeadlineAt } : {}),
		workflowKey: request.workflowKey ?? "agent-workflow/v1",
		retrievalUserRequest: workflowAgentRetrievalUserRequest(request),
		retrievalContext: workflowAgentRetrievalContext(request),
		disabledSkills: [],
		mountedKnowledgeCardIds: [...effectiveMountedKnowledgeCardIds],
		disabledKnowledgeCardIds: [],
		diagnosticsLabel: `workflow-node:${request.nodeId}`,
		structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
		...(request.promptExampleRetrievalScope
			? { promptExampleRetrievalScope: request.promptExampleRetrievalScope }
			: {}),
		...(structuredOutput ?? {}),
		continuationExecutionContract: {
			version: 1,
			directForcedAgentExecution: true,
			structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
			maxOutputTokens: attemptMaxOutputTokens,
			...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
			...(workflowPhysicalAttemptDeadlineAt ? { workflowPhysicalAttemptDeadlineAt } : {}),
			retrievalUserRequest: workflowAgentRetrievalUserRequest(request),
			retrievalContext: workflowAgentRetrievalContext(request),
			disabledSkills: [],
			mountedKnowledgeCardIds: [...effectiveMountedKnowledgeCardIds],
			disabledKnowledgeCardIds: [],
			...(structuredOutput ?? {}),
		},
	});
	const persisted = await runPersistedAgentsChatTask({
		c: context,
		userId: request.ownerId,
		rootRequestId: publicTurnId,
		requestInput,
		taskRequest,
		directForcedAgentExecution: true,
		// runWorkflowAgentNode is itself the authenticated internal boundary.  A
		// suspended physical Agent run is owned by the durable Workflow execution
		// even when a deployment omits INTERNAL_WORKER_TOKEN (for example during a
		// local API rebuild).  Conditioning these ownership facts on that optional
		// transport credential makes the same logical node publish as unowned and
		// terminally fail exactly while its durable turn remains resumable.
		trustedPublicContinuation: true,
		trustedInternalExecution: true,
		...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
	});
	const transportResult = attachSuspendedWorkflowTurnIdentity(
		unwrapWorkflowAgentTransportEnvelope(request, readAgentResponse(persisted.result)),
		request,
		publicTurnId,
	);
	const requestTerminal = isRecord(transportResult.requestTerminal)
		? transportResult.requestTerminal
		: null;
	if (requestTerminal?.status !== "suspended") return transportResult;

	// The HTTP result is only the transport projection of the physical Agent
	// window.  A suspended Workflow Agent is owned by its durable turn, whose
	// checkpoint may carry a more precise external boundary than the response
	// envelope (for example provider_balance_required).  Re-read that authority
	// before publishing node evidence so the queue cannot mistake an external
	// dependency wait for a retryable provider interruption and replay the same
	// model several times.
	return recoverWorkflowAgentNodeFromDurableTurn(
		context,
		request,
		publicTurnId,
	);
}
