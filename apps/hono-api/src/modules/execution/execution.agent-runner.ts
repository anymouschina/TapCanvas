import { resolveWorkflowAgentPhysicalContinuationReason } from "./execution.agent-physical-continuation";
import { projectAcceptedWorkflowAuthorSource, WORKFLOW_AUTHOR_TRANSPORT_CONVERTER } from "./execution.author-source";
import { distinctPerformanceModes } from "../../../../../packages/schemas/performance-routing/index.mjs";
import { CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION } from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { projectAtomicAuthorSelfCheckMetadata } from "../../../../../packages/schemas/atomic-author-selfcheck/index.cjs";
import { createHash } from "node:crypto";
import { projectWorkflowPhysicalFailureRepairEvidence } from "./execution.agent-repair-evidence";
import { projectAgentRequestContextMetrics } from "../task/agent-request-context-metrics";
import { isDeepStrictEqual } from "node:util";
import { projectRuntimeBoundJsonOutputContract } from "../../../../../packages/schemas/json-schema-runtime-bindings/index.mjs";
import { findVisibleAcceptedTurnContentPath, projectAcceptedTurnBodyReference } from "./execution.agent-context-reference";
import { collectWorkflowCandidateProjections, type WorkflowInputLocation } from "./execution.retrieval-input-projection";
import { collectWorkflowInputReadProjections } from "./execution.input-read-projection";
import { verifyWorkflowAgentRepairHandoff, WorkflowAgentRepairSourceMismatchError } from "./execution.agent-repair-handoff";
import { isWorkflowBeatSheetArtifactType, isWorkflowChapterAssetArtifactType, workflowAgentProjectContextPromptFacts } from "./execution.agent-project-context";
import { projectWorkflowProvenanceForPrompt } from "./execution.prompt-provenance";
import { workflowProjectImageCatalog } from "./execution.project-image-candidates";
import { OPENING_FRAME_PLAN_ARTIFACT_TYPE } from "./execution.opening-frame";
import { readWorkflowAgentOutputRepair } from "./execution.agent-output-repair";
import { normalizeAuthorRevisionEvidence } from "../../../../../packages/schemas/author-revision-evidence/index.cjs";
import type { AppContext, WorkerEnv } from "../../types";
import { AppError } from "../../middleware/error";
import { readWorkflowAgentPreferences } from "./execution.agent-preferences";
import {
	normalizeStructuredOutputReviewProjectionIssue,
	projectStructuredOutputReview,
} from "../task/structured-output-review";
import {
	isTransientDatabaseConflictError,
	readDatabaseErrorCodes,
} from "../../platform/node/database-read-retry";
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
import { createWorkflowAgentActivityReporter } from "./execution.agent-progress";
import { projectClipSequenceForWriter } from "./execution.clip-timeline-contract";
import {
	getAgentsChatTurnStatus,
	isAgentsChatRuntimeContractViolationCode,
	type AgentsChatTurnStatusSnapshot,
} from "../task/task.agents-chat-runtime";
import type {
	WorkflowAgentRunRequest,
	WorkflowAgentRunResult,
	WorkflowKnowledgeCandidateSearchObservation,
	WorkflowPromptExampleCandidateSearchObservation,
} from "./execution.node-executors";
import {
	WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
	WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN,
	WORKFLOW_SEQUENCE_CONTROL_PLAN_PROTOCOL_VERSION,
} from "@tapcanvas/workflow-kernel-protocol";
import { isWorkflowProjectImageReady, type WorkflowProjectContext } from "./execution.project-context";
import { buildInternalApiKey } from "../apiKey/internal-api-key";
import { parseAgentExecutionProvenance } from "../task/agent-execution-provenance";
import { cancelWorkflowAgentTurns } from "./execution.agent-cancellation";
import {
	BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
	VIDEO_WRITER_ARTIFACT_CONTRACT_NAME,
	VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION,
	WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY,
	WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
	WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY,
} from "./execution.agent-output-contract";
import {
	workflowAgentPublicTurnId,
	previousWorkflowAgentTurnOrdinal,
	workflowAgentSessionKey,
	workflowAgentTurnOrdinal,
} from "./execution.agent-identity";
import { getExecutionTraceLifecycleSnapshot } from "../memory/execution-trace-events.repo";
import { readWorkflowAgentSettledResult } from "./execution.agent-settled-result";
import { WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD } from "./execution.workflow-source-authority";
import {
	projectFrozenSourceScopePromptInputs,
	type FrozenSourceScopePromptProjection,
} from "./execution.source-scope-prompt-projection";

const WORKFLOW_AGENT_STATUS_DEADLINE_MS = 10_000;
const WORKFLOW_AGENT_INACTIVE_ADMISSION_GRACE_MS = 60_000;
const OPENING_CLIP_SOURCE_WINDOW_MAX_UTF16_UNITS = 4_096;
// A provider stream interruption can leave the durable turn projected as
// running even though no process can advance it. After this quiet period the
// exact physical generation is fenced and the same logical task opens a fresh
// provider attempt instead of polling the dead turn forever.
const WORKFLOW_AGENT_STALE_INTERRUPTED_TURN_MS = 2 * 60_000;

const WORKFLOW_AGENT_GENERATION_FENCE_PENDING = "workflow_agent_physical_generation_fence_pending";

function workflowAgentContinuationResumeOutcome(
	error: unknown,
): "already_active" | "not_ready" | "ownership_changed" | null {
	if (!(error instanceof AppError)) return null;
	if (error.code === "chat_resume_turn_active") return "already_active";
	if (error.code === "chat_resume_continuation_not_ready") return "not_ready";
	if (error.code === "chat_resume_turn_mismatch" || error.code === "chat_resume_claim_superseded") return "ownership_changed";
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string {
	const candidate = value[key];
	return typeof candidate === "string" ? candidate.trim() : "";
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

function isStaleInterruptedWorkflowAgentTurn(
	previousEvidence: Record<string, unknown> | null,
	nowMs = Date.now(),
): boolean {
	if (!previousEvidence) return false;
	let current = previousEvidence;
	for (let depth = 0; depth < 8; depth += 1) {
		const checkpoint = current.recoveryCheckpoint;
		const reasonCode = isRecord(checkpoint) && typeof checkpoint.reasonCode === "string"
			? checkpoint.reasonCode.trim()
			: "";
		if (reasonCode === "provider_stream_interrupted") {
			const lastConfirmedAt = typeof current.lastConfirmedAt === "string"
				? Date.parse(current.lastConfirmedAt)
				: Number.NaN;
			return Number.isFinite(lastConfirmedAt)
				&& nowMs - lastConfirmedAt >= WORKFLOW_AGENT_STALE_INTERRUPTED_TURN_MS;
		}
		const nested = current.deliveryEvidence;
		if (!isRecord(nested) || nested === current) break;
		current = nested;
	}
	return false;
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

function projectClipWriterSequenceContext(value: Record<string, unknown>): Record<string, unknown> {
	const current = isRecord(value.current) ? value.current : null;
	const clipIndex = typeof current?.clipIndex === "number" && Number.isInteger(current.clipIndex)
		? current.clipIndex
		: null;
	const sequenceControlPlan = isRecord(value.sequenceControlPlan)
		? {
			...pickRecordFields(value.sequenceControlPlan, ["protocolVersion", "totalDurationSeconds"]),
			...(Array.isArray(value.sequenceControlPlan.segments)
				? { segments: clipIndex === null
					? value.sequenceControlPlan.segments
					: value.sequenceControlPlan.segments.flatMap((segment, index) => index === clipIndex ? [segment] : []) }
				: {}),
		}
		: value.sequenceControlPlan;
	const sequenceTimeline = Array.isArray(value.sequenceTimeline)
		? value.sequenceTimeline.flatMap((entry) => {
			if (!isRecord(entry)) return [];
			const entryIndex = typeof entry.clipIndex === "number" && Number.isInteger(entry.clipIndex)
				? entry.clipIndex
				: null;
			// The writer only needs the current segment and the two continuity
			// neighbours. The complete chapter timeline is already frozen in the
			// parent artifact and repeating it here multiplied every Clip prompt.
			if (clipIndex !== null && entryIndex !== null && Math.abs(entryIndex - clipIndex) > 1) return [];
			return [pickRecordFields(entry, ["clipId", "clipIndex", "sourceSpan", "startKeyframe", "endKeyframe", "exitState", "characters", "timing"])]
		})
		: value.sequenceTimeline;
	const sequenceContextScope = isRecord(value.sequenceContextScope)
		? pickRecordFields(value.sequenceContextScope, [
			"protocolVersion", "currentClipIndex", "totalClipCount", "timeline", "controlPlan",
			"readPolicy", "fullSequenceRead",
		])
		: value.sequenceContextScope;
	return {
		...pickRecordFields(value, ["chapterArc", "executionPolicy"]),
		sequenceControlPlan,
		sequenceTimeline,
		sequenceContextScope,
		...Object.fromEntries(["previous", "current", "next"].flatMap((key) => {
			const neighbour = value[key];
			if (!isRecord(neighbour)) return [[key, neighbour]];
			const contracts = Array.isArray(neighbour.assetObjectContracts)
				? neighbour.assetObjectContracts.map((contract) => isRecord(contract)
					? pickRecordFields(contract, ["name", "kind", "physicalIdentityKey", "referenceAssetIds", "referenceImageNodeIds", "referenceRole"])
					: contract)
				: undefined;
			if (key === "current") {
				// beat.assetObjectContracts is the canonical current-Clip registry;
				// remove its sequenceContext duplicate while retaining all other
				// current beat facts for the writer.
				const { assetObjectContracts: _duplicateContracts, ...currentFacts } = neighbour;
				return [[key, currentFacts]];
			}
			const continuityFacts = pickRecordFields(neighbour, [
				"clipId", "clipIndex", "sourceSpan", "startKeyframe", "endKeyframe",
				"exitState", "handoffToNext", "characters", "spokenScript", "timing",
			]);
		return [[key, { ...continuityFacts, ...(contracts ? { assetObjectContracts: contracts } : {}) }]];
		})),
	};
}

/**
 * Clip writer inputs are already bound to one frozen beat.  Repeating the full
 * chapter source, canvas node bodies and authoring receipts for every clip
 * turns a bounded per-clip task into a chapter-sized model request.  Keep the
 * original input for runtime validation and project only the prompt-facing
 * copy to immutable identities plus the beat-scoped facts the writer needs.
 */
function projectClipWriterPromptValue(value: unknown, depth = 0, currentClipId = ""): unknown {
	if (depth > 10) return value;
	if (Array.isArray(value)) return value.map((item) => projectClipWriterPromptValue(item, depth + 1, currentClipId));
	if (!isRecord(value)) return value;
	const promptValue: Record<string, unknown> = (
		currentClipId
		&& Array.isArray(value.consumerClipIds)
		&& value.consumerClipIds.some((candidate: unknown) => candidate === currentClipId)
	)
		? { ...value, consumerClipIds: [currentClipId] }
		: value;

	if (Object.prototype.hasOwnProperty.call(promptValue, "sourceEvidence")) {
		const sourceEvidence = promptValue.sourceEvidence;
		if (isRecord(sourceEvidence)) {
			const projectedSources = Array.isArray(sourceEvidence.sources)
				? sourceEvidence.sources.flatMap((source: unknown) => {
					if (!isRecord(source)) return [];
					return [{
						...pickRecordFields(source, ["sourceId", "sourceFingerprint"]),
						...(typeof source.content === "string" ? { contentCharacters: source.content.length } : {}),
					}];
				})
				: undefined;
			return Object.fromEntries(Object.entries(promptValue).flatMap(([key, child]) => {
				if (
					key === "assetObjectContracts"
					&& isRecord(promptValue.beat)
					&& isDeepStrictEqual(promptValue.assetObjectContracts, promptValue.beat.assetObjectContracts)
				) return [];
				if (key === "sequenceContext" && isRecord(child)) return [[key, projectClipWriterSequenceContext(child)]];
				if (key === "sourceEvidence") {
					return [[key, {
						...pickRecordFields(sourceEvidence, ["protocolVersion", "origin", "status", "sourceId", "sourceFingerprint", "diagnostic"]),
						...(projectedSources ? { sources: projectedSources } : {}),
					}]];
				}
				return [[key, projectClipWriterPromptValue(child, depth + 1, currentClipId)]];
			}));
		}
	}

	if (Object.prototype.hasOwnProperty.call(promptValue, "canvasFacts") && isRecord(promptValue.canvasFacts)) {
		const canvasFacts = promptValue.canvasFacts;
		const authoritativeSources = Array.isArray(canvasFacts.authoritativeSources)
			? canvasFacts.authoritativeSources.flatMap((source: unknown) => {
				if (!isRecord(source)) return [];
				return [{
					...pickRecordFields(source, ["sourceId", "sourceFingerprint", "sourceType", "title"]),
					...(typeof source.content === "string" ? { contentCharacters: source.content.length } : {}),
				}];
			})
			: undefined;
		return {
			...Object.fromEntries(Object.entries(promptValue).map(([key, child]) => [
				key,
				key === "canvasFacts"
					? {
						...pickRecordFields(canvasFacts, [
							"protocolVersion", "sourceMode", "sourceId", "sourceFingerprint",
							"userRequest", "selection", "referenceVideoAnalyses",
						]),
						...(authoritativeSources ? { authoritativeSources } : {}),
					}
						: projectClipWriterPromptValue(child, depth + 1, currentClipId),
				])),
			};
	}

	return Object.fromEntries(Object.entries(promptValue).flatMap(([key, child]) => {
		// beat.assetObjectContracts is the canonical current registry. The
		// top-level copy is identical input bookkeeping and has no extra facts
		// for a Clip writer, so omit it from the prompt-facing projection.
		if (
			key === "assetObjectContracts"
			&& isRecord(promptValue.beat)
			&& isDeepStrictEqual(promptValue.assetObjectContracts, promptValue.beat.assetObjectContracts)
		) return [];
		if (key === "sequenceContext" && isRecord(child)) return [[key, projectClipWriterSequenceContext(child)]];
		return [[key, projectClipWriterPromptValue(child, depth + 1, currentClipId)]];
	}));
}

function projectClipWriterCollectionInput(
	value: unknown,
	inputPort: string,
	request: WorkflowAgentRunRequest,
): unknown {
	if (!isRecord(value) || !Array.isArray(value.items)) return value;
	const clipContext = request.inputs["clip-contexts"]?.[0];
	const clipId = isRecord(clipContext) && isRecord(clipContext.beat)
		? readString(clipContext.beat, "clipId")
		: "";
	const items = value.items.filter(isRecord);
	if (inputPort === "asset-bindings" && clipId) {
		const matched = items.filter((item) => {
			const itemValue = isRecord(item.value) ? item.value : null;
			const assetPlan = itemValue && isRecord(itemValue.assetPlan) ? itemValue.assetPlan : null;
			return Array.isArray(assetPlan?.consumerClipIds) && assetPlan.consumerClipIds.includes(clipId);
		});
		return {
			...value,
			items: matched.map((item) => {
				const itemValue = isRecord(item.value) ? item.value : {};
				const assetPlan = isRecord(itemValue.assetPlan) ? itemValue.assetPlan : {};
				const binding = isRecord(itemValue.binding) ? itemValue.binding : {};
				const asset = isRecord(itemValue.asset) ? itemValue.asset : {};
				const projectedAssetPlan = pickRecordFields(assetPlan, [
					"assetId", "consumerClipIds", "displayName", "objectId", "referenceAssetBindings", "role",
				]);
				const projectedBinding = pickRecordFields(binding, ["assetId", "bindingId", "consumerClipIds", "objectId", "referenceRole"]);
				return {
					...item,
					value: {
						asset: pickRecordFields(asset, ["assetId", "mediaType", "source"]),
						assetPlan: Array.isArray(assetPlan.consumerClipIds)
							? { ...projectedAssetPlan, consumerClipIds: [clipId] }
							: projectedAssetPlan,
						binding: Array.isArray(binding.consumerClipIds) && binding.consumerClipIds.includes(clipId)
							? { ...projectedBinding, consumerClipIds: [clipId] }
							: projectedBinding,
						...pickRecordFields(itemValue, ["generatedAssetId", "imageUrl", "nodeId", "taskId"]),
					},
				};
			}),
		};
	}
	if (request.runtimeItemIndex !== undefined && items.length > 1) {
		const selected = items[request.runtimeItemIndex];
		return { ...value, items: selected ? [selected] : [] };
	}
	return value;
}

/**
 * Clip design receives one frozen beat and only needs adjacent continuity
 * anchors. Keep the complete input for host validation, but avoid replaying
 * lineage offsets and full neighbouring event ledgers into every model call.
 * This is a structural projection: it never selects objects from narrative
 * text and it preserves the complete shared identity pool and references.
 */
function projectClipDesignBeat(value: unknown, adjacent: boolean): unknown {
	if (!isRecord(value)) return value;
	const fields = adjacent
		? [
			"clipId", "clipIndex", "durationSeconds", "startKeyframe", "endKeyframe",
			"causalEntry", "irreversibleResult", "handoffToNext", "dominantFunction",
		]
		: [
			"clipId", "clipIndex", "durationSeconds", "dialoguePaceRate", "dialogueScript",
			"startKeyframe", "endKeyframe", "sourceSpan", "narrativeIntent", "dominantFunction",
			"causalEntry", "irreversibleResult", "handoffToNext", "storyEvents",
		];
	return pickRecordFields(value, fields);
}

function projectClipDesignRegistry(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	return value.map((entry) => {
		if (!isRecord(entry)) return entry;
		return pickRecordFields(entry, [
			"objectId", "kind", "name", "physicalIdentityKey", "referenceRole",
			"identityInvariant", "referenceAssetIds", "referenceImageNodeIds",
			// Optional deterministic continuity constraints, when present.
			"forbiddenTransfer", "scale",
		]);
	});
}

function projectClipDesignPromptValue(value: unknown): unknown {
	if (!isRecord(value)) return value;
	return {
		...value,
		...(Object.prototype.hasOwnProperty.call(value, "beat")
			? { beat: projectClipDesignBeat(value.beat, false) }
			: {}),
		...(Object.prototype.hasOwnProperty.call(value, "previousBeat")
			? { previousBeat: projectClipDesignBeat(value.previousBeat, true) }
			: {}),
		...(Object.prototype.hasOwnProperty.call(value, "nextBeat")
			? { nextBeat: projectClipDesignBeat(value.nextBeat, true) }
			: {}),
		...(Object.prototype.hasOwnProperty.call(value, "objectRegistry")
			? { objectRegistry: projectClipDesignRegistry(value.objectRegistry) }
			: {}),
	};
}

function workflowAgentPromptInputs(
	request: WorkflowAgentRunRequest,
): Readonly<Record<string, readonly unknown[]>> {
	const hasDedicatedCanvasFactsPort = (request.inputs["canvas-facts"]?.length ?? 0) > 0;
	const clipContext = request.inputs["clip-contexts"]?.[0];
	const currentClipId = isRecord(clipContext) && isRecord(clipContext.beat)
		? readString(clipContext.beat, "clipId")
		: "";
	return Object.fromEntries(Object.entries(request.inputs).map(([port, values]) => [
		port,
		values.map((value) => {
			const itemProjectedValue = request.outputArtifactType === "tapcanvas.clip-prompts/v2"
				? projectClipWriterCollectionInput(value, port, request)
				: request.outputArtifactType === CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION && port === "clip-sequence"
					? projectClipSequenceForWriter(value)
				: request.outputArtifactType === "tapcanvas.clip-design/v2" && port === "clip-design-inputs"
					? projectClipDesignPromptValue(value)
			: request.outputArtifactType === "tapcanvas.opening-clip/v3" && port === "canvas-facts"
					? projectOpeningClipCanvasFacts(value)
			: request.outputArtifactType === "tapcanvas.opening-clip/v3" && port === "delivery-contract"
					? projectOpeningClipDeliveryContract(value)
			: request.outputArtifactType === OPENING_FRAME_PLAN_ARTIFACT_TYPE && port === "canvas-facts"
					? projectOpeningClipCanvasFacts(value)
			: request.outputArtifactType === OPENING_FRAME_PLAN_ARTIFACT_TYPE && port === "delivery-contract"
					? projectOpeningClipDeliveryContract(value)
				: value;
			const rawPromptValue = request.outputArtifactType === "tapcanvas.clip-prompts/v2"
				? projectClipWriterPromptValue(itemProjectedValue, 0, currentClipId)
				: itemProjectedValue;
			const promptValue = port === "canvas-facts"
				? projectAcceptedTurnBodyReference(rawPromptValue)
				: isRecord(rawPromptValue) && "canvasFacts" in rawPromptValue
					? { ...rawPromptValue, canvasFacts: projectAcceptedTurnBodyReference(rawPromptValue.canvasFacts) }
					: rawPromptValue;
			// delivery-contract carries a projected copy of canvasFacts for downstream
			// deterministic executors. When the Agent already has the dedicated
			// canvas-facts port, keeping that copy in the prompt creates two competing
			// source bodies and needlessly doubles the context. Preserve the contract
			// envelope and mark the canonical source port instead.
			if (port === "delivery-contract" && hasDedicatedCanvasFactsPort && isRecord(promptValue) && "canvasFacts" in promptValue) {
				const { canvasFacts: _duplicateCanvasFacts, ...contractFacts } = promptValue;
				return {
					...contractFacts,
					canvasFactsSourcePort: "canvas-facts",
				};
			}
			if (!isRecord(promptValue) || typeof promptValue.text !== "string") return promptValue;
			const text = request.outputArtifactType === "tapcanvas.asset-plans/v1"
				? projectBeatSheetForAssetPlanning(promptValue.text, request.projectContext)
				: promptValue.text;
			return {
				...pickRecordFields(promptValue, [
					"taskId",
					"assets",
					"executionProvenance",
					"executionProvenanceHistory",
					"knowledgeCandidateSearch",
					"promptExampleCandidateSearch",
					"retrievalCandidateSets",
				]),
				text,
			};
		}),
	]));
}

/**
 * Retrieval receipts are audit evidence, not prompt content. A previous Agent
 * may have searched hundreds of candidate cards; carrying every candidate
 * body into the next node makes the next model call grow with the entire
 * retrieval frontier. Keep the receipt identity and count so provenance is
 * preserved, while requiring the current Agent to perform a fresh bounded
 * search when it needs to choose evidence.
 */
function compactRetrievalReceipt(value: unknown, depth = 0): unknown {
	if (depth > 8) return value;
	if (Array.isArray(value)) return value.map((item) => compactRetrievalReceipt(item, depth + 1));
	const record = isRecord(value);
	if (!record) return value;
	const compact: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(record)) {
		if ((key === "entries" || key === "candidates") && Array.isArray(child)) {
			compact[`${key}Count`] = child.length;
			continue;
		}
		compact[key] = compactRetrievalReceipt(child, depth + 1);
	}
	return compact;
}

function compactWorkflowRetrievalFacts(value: unknown, location: WorkflowInputLocation, depth = 0): unknown {
	if (depth > 8) return value;
	if (Array.isArray(value)) return value.map((item, index) => compactWorkflowRetrievalFacts(item, { ...location, path: [...location.path, String(index)] }, depth + 1));
	if (!isRecord(value)) return value;

	const compact: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "executionProvenance" || key === "executionProvenanceHistory"
			|| key === "dependencyProvenance" || key === "dependencyProvenanceHistory") {
			compact[key] = projectWorkflowProvenanceForPrompt(child);
			continue;
		}
		if (key === "knowledgeCandidateSearch"
			|| key === "promptExampleCandidateSearch"
			|| key === "retrievalCandidateSets") {
			compact[key] = compactRetrievalReceipt(child);
			continue;
		}
		compact[key] = compactWorkflowRetrievalFacts(child, { ...location, path: [...location.path, key] }, depth + 1);
	}
	return compact;
}

function compactWorkflowPromptFacts(
	inputs: Readonly<Record<string, readonly unknown[]>>,
  identity: Pick<WorkflowInputLocation, "executionId" | "nodeId">,
): Readonly<Record<string, readonly unknown[]>> {
	return Object.fromEntries(
		Object.entries(inputs).map(([port, values]) => [
			port,
			values.map((value, index) => compactWorkflowRetrievalFacts(value, { ...identity, path: [port, String(index)] })),
		]),
	);
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

function parseKnowledgeCandidateSearchObservation(
	value: unknown,
): WorkflowKnowledgeCandidateSearchObservation | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const statuses = new Set<WorkflowKnowledgeCandidateSearchObservation["status"]>([
		"not_attempted",
		"candidate_found",
		"no_match",
		"retrieval_failed",
		"invalid_evidence",
		"tool_unavailable",
	]);
	if (
		typeof value.status !== "string"
		|| !statuses.has(value.status as WorkflowKnowledgeCandidateSearchObservation["status"])
	) return null;
	if (
		typeof value.attempted !== "boolean"
		|| typeof value.candidateCount !== "number"
		|| !Number.isInteger(value.candidateCount)
		|| value.candidateCount < 0
		|| value.blocking !== false
		|| typeof value.rationale !== "string"
		|| !Array.isArray(value.domains)
		|| value.domains.some((domain) => typeof domain !== "string")
	) return null;
	const toolCallId = typeof value.toolCallId === "string" && value.toolCallId.trim()
		? value.toolCallId.trim()
		: null;
	const candidateSetId = typeof value.candidateSetId === "string" && value.candidateSetId.trim()
		? value.candidateSetId.trim()
		: null;
	return {
		version: 1,
		status: value.status as WorkflowKnowledgeCandidateSearchObservation["status"],
		attempted: value.attempted,
		candidateCount: value.candidateCount,
		blocking: false,
		rationale: value.rationale.trim(),
		domains: value.domains.map((domain) => domain.trim()).filter(Boolean),
		...(candidateSetId ? { candidateSetId } : {}),
		...(toolCallId ? { toolCallId } : {}),
	};
}

export function normalizeWorkflowAgentOutcome(result: unknown): WorkflowAgentRunResult {
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
	const contextMetrics = projectAgentRequestContextMetrics(runtime?.upstreamRequestContextMetrics);
	const structuredOutputReviewProjection = projectStructuredOutputReview(runtime?.structuredOutputReview);
	const structuredOutputReview = structuredOutputReviewProjection.review;
	const normalizedReviewProjectionIssue = normalizeStructuredOutputReviewProjectionIssue(
		runtime?.structuredOutputReviewProjectionIssue,
	);
	const structuredOutputReviewProjectionIssue = structuredOutputReviewProjection.issue
		?? normalizedReviewProjectionIssue
		?? (runtime && Object.prototype.hasOwnProperty.call(runtime, "structuredOutputReviewProjectionIssue")
			? { reason: "invalid_receipt" as const, droppedObservationCount: 0 }
			: null);
	const structuredOutputFailure = isRecord(meta.structuredOutputExecutionFailure)
		? meta.structuredOutputExecutionFailure
		: runtime && isRecord(runtime.structuredOutputExecutionFailure)
			? runtime.structuredOutputExecutionFailure
		: null;
	const promptExampleCandidateSearch = parsePromptExampleCandidateSearchObservation(
		runtime?.promptExampleCandidateSearch,
	);
	const knowledgeCandidateSearch = parseKnowledgeCandidateSearchObservation(
		runtime?.knowledgeCandidateSearch,
	);
	const retrievalCandidateSets = Array.isArray(runtime?.retrievalCandidateSets)
		? runtime.retrievalCandidateSets.filter((item): item is Record<string, unknown> => isRecord(item))
		: [];
	const upstreamRequestContexts = Array.isArray(runtime?.upstreamRequestContexts)
		? runtime.upstreamRequestContexts.filter((item): item is Record<string, unknown> => isRecord(item)).slice(-16)
		: [];
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
		...(structuredOutputFailure ? { structuredOutputFailure } : {}),
		...(executionProvenance ? { executionProvenance } : {}),
		...(promptExampleCandidateSearch ? { promptExampleCandidateSearch } : {}),
		...(knowledgeCandidateSearch ? { knowledgeCandidateSearch } : {}),
		...(retrievalCandidateSets.length > 0 ? { retrievalCandidateSets } : {}),
		...(upstreamRequestContexts.length > 0 ? { upstreamRequestContexts } : {}),
		...(contextMetrics.metrics ? { upstreamRequestContextMetrics: contextMetrics.metrics } : {}),
		...(contextMetrics.issue || runtime?.upstreamRequestContextMetricsIssue === "invalid_request_context_metrics"
			? { upstreamRequestContextMetricsIssue: "invalid_request_context_metrics" as const } : {}),
		...(structuredOutputReview ? { structuredOutputReview } : {}),
		...(typeof runtime?.acceptedAuthorSourceIssue === "string" ? { acceptedAuthorSourceIssue: runtime.acceptedAuthorSourceIssue } : {}),
		...projectAcceptedWorkflowAuthorSource(runtime?.acceptedAuthorSource, text),
		...projectAtomicAuthorSelfCheckMetadata(runtime, `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`),
		...(structuredOutputReviewProjectionIssue ? { structuredOutputReviewProjectionIssue } : {}),
	};
}

export function unwrapWorkflowAgentTransportEnvelope(
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
	const text = JSON.stringify(parsed.items);
	const atomicProjection = projectAtomicAuthorSelfCheckMetadata(result,
		`sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`);
	// The author observed the provider envelope. Unwrapping changes its identity;
	// keep the source hash in the diagnostic instead of certifying different bytes.
	const {
		atomicAuthorSelfCheck: _sourceObservation,
		atomicAuthorSelfCheckProjectionIssue: _sourceProjectionIssue,
		...transportResult
	} = result;
	return { ...transportResult, text, ...atomicProjection,
		...(result.acceptedAuthorSource ? { authorSourceTransportSteps: [
			...(result.authorSourceTransportSteps ?? []), { converterId: WORKFLOW_AUTHOR_TRANSPORT_CONVERTER.id,
				converterVersion: WORKFLOW_AUTHOR_TRANSPORT_CONVERTER.version, text } ] } : {}),
	};
}

/** Project the immutable delivery facts that opening authoring actually consumes. */
function projectOpeningClipCanvasFacts(value: unknown): unknown {
	if (!isRecord(value)) return value;
	let remainingSourceWindowUnits = OPENING_CLIP_SOURCE_WINDOW_MAX_UTF16_UNITS;
	const authoritativeSources = Array.isArray(value.authoritativeSources)
		? value.authoritativeSources.map((source) => {
			if (!isRecord(source) || typeof source.content !== "string") return source;
			const sourceLength = source.content.length;
			let endOffset = Math.min(sourceLength, remainingSourceWindowUnits);
			if (endOffset < sourceLength && endOffset > 0) {
				const lastVisibleCodeUnit = source.content.charCodeAt(endOffset - 1);
				const firstHiddenCodeUnit = source.content.charCodeAt(endOffset);
				if (lastVisibleCodeUnit >= 0xd800 && lastVisibleCodeUnit <= 0xdbff
					&& firstHiddenCodeUnit >= 0xdc00 && firstHiddenCodeUnit <= 0xdfff) {
					endOffset -= 1;
				}
			}
			remainingSourceWindowUnits -= endOffset;
			return {
				...source,
				content: source.content.slice(0, endOffset),
				sourceWindow: {
					startOffset: 0,
					endOffset,
					sourceLength,
					offsetUnit: "utf16_code_unit",
					complete: endOffset === sourceLength,
				},
			};
		})
		: null;
	return {
		...pickRecordFields(value, ["protocolVersion", "sourceMode", "flowId", "groupId", "sourceNodeIds", "userRequest"]),
		...(authoritativeSources ? { authoritativeSources } : {}),
	};
}

function projectOpeningClipDeliveryContract(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const canvasFacts = isRecord(value.canvasFacts) ? value.canvasFacts : null;
	const generationContract = isRecord(value.generationContract) ? value.generationContract : null;
	const projectedCanvasFacts = canvasFacts ? projectOpeningClipCanvasFacts(canvasFacts) : null;
	return {
		...pickRecordFields(value, ["protocolVersion", "executionScope"]),
		...(generationContract ? { generationContract: pickRecordFields(generationContract, [
			"videoModel", "resolution", "aspectRatio", "size", "durationOptions", "maxDurationSeconds", "providerSubmissionTopology",
		]) } : {}),
		...(canvasFacts && isRecord(projectedCanvasFacts) ? { canvasFacts: {
			...pickRecordFields(canvasFacts, ["sourceMode", "flowId", "groupId", "sourceNodeIds", "userRequest"]),
			...(Array.isArray(projectedCanvasFacts.authoritativeSources)
				? { authoritativeSources: projectedCanvasFacts.authoritativeSources }
				: {}),
		} } : {}),
	};
}

function openingClipSourceWindowInstruction(request: WorkflowAgentRunRequest): string {
	if (request.outputArtifactType !== "tapcanvas.opening-clip/v3") return "";
	return [
		"opening-clip 输入中的 authoritativeSources[].content 是按来源顺序提供的有限前缀窗口；每项 sourceWindow 给出可见的绝对 UTF-16 半开区间 [startOffset,endOffset)、完整来源长度 sourceLength，以及 complete。",
		"sourceRanges 只提交连续的来源前缀：sourceIndex 按 authoritativeSources 顺序从 0 开始，startOffset 必须是 0；若进入下一来源，前一个范围必须覆盖完整来源。endOffset 与 sourceWindow 的 UTF-16 code-unit 偏移一致，只能选择可见 content 范围，且不能切开 surrogate pair。complete=false 的窗口末尾不是章节结尾。",
		"clipPrompt 只写直接执行的文生视频提示词；不要在输出中加入 Clip 身份、时长、来源 ID/指纹、对白转写或解释字段。宿主会用完整冻结来源验证范围，切出原文并绑定供应商参数；后续整章 Agent 另行产出结构化 Clip 0，已受理首段视频及其原始 prompt/hash/sourceRanges 会保留作媒体事实。",
	].join("\n");
}

function attachWorkflowTurnIdentity(
	result: WorkflowAgentRunResult,
	request: WorkflowAgentRunRequest,
	publicTurnId: string,
): WorkflowAgentRunResult {
	const upstreamEvidence = isRecord(result.deliveryEvidence) ? result.deliveryEvidence : null;
	const physicalRetryOrdinal = workflowAgentPhysicalRetryOrdinal(request);
	const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
	return {
		...result,
		taskId: publicTurnId,
		deliveryEvidence: {
			...(upstreamEvidence ?? {}),
			transportTaskId: result.taskId,
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
): Pick<WorkflowAgentRunResult,
		| "executionProvenance"
		| "executionProvenanceHistory"
		| "acceptedAuthorSource"
		| "acceptedAuthorSourceIssue"
		| "structuredOutputReview"
		| "structuredOutputReviewProjectionIssue"
		| "atomicAuthorSelfCheck"
		| "atomicAuthorSelfCheckProjectionIssue"
	> {
	const history = turn.executionProvenanceHistory ?? [];
	const latest = history[history.length - 1];
	return {
		...(latest ? { executionProvenance: latest } : {}),
		...(history.length > 0 ? { executionProvenanceHistory: history } : {}),
		...(turn.acceptedAuthorSourceIssue ? { acceptedAuthorSourceIssue: turn.acceptedAuthorSourceIssue } : {}),
		...projectAcceptedWorkflowAuthorSource(turn.acceptedAuthorSource, turn.finalResponse ?? ""),
		...(turn.structuredOutputReview ? { structuredOutputReview: turn.structuredOutputReview } : {}),
		...projectAtomicAuthorSelfCheckMetadata(turn, typeof turn.finalResponse === "string" ? `sha256:${createHash("sha256").update(turn.finalResponse, "utf8").digest("hex")}` : undefined),
		...(turn.structuredOutputReviewProjectionIssue
			? { structuredOutputReviewProjectionIssue: turn.structuredOutputReviewProjectionIssue }
			: {}),
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
	// Database failures emitted by an accepted Agents turn are a transport
	// interruption for the Workflow node. Keep the exact durable turn identity
	// and let the next external check reconcile its persisted state; never wrap
	// the Agent/tool execution itself in a blind database retry.
	if (isTransientDatabaseConflictError(error)) return true;
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
	const databaseCode = readDatabaseErrorCodes(error)
		.find((candidate) => isTransientDatabaseConflictError({ code: candidate }));
	const code = databaseCode ?? agentsBridgeErrorCode(error);
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
	observedPreviousOrdinal = currentPhysicalRetryOrdinal - 1,
): Promise<Readonly<{
	fenced: boolean;
	previousPublicTurnId: string;
	errorCode: string | null;
}>> {
	const previousPhysicalRetryOrdinal = observedPreviousOrdinal;
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
			sessionId: sessionKeyForWorkflowAgent(request),
			turnId: previousPublicTurnId,
			nodeId: request.nodeId,
			runtimeNodeId: request.nodeId,
		}],
	});
	const runtimeError = result?.receipt?.runtimeError ?? null;
	if (runtimeError && isAgentsChatRuntimeContractViolationCode(runtimeError.code)) {
		// Every later fence attempt reads the same durable turn and gets the same
		// invalid payload; reporting "fence pending" would poll it forever.
		throw new AppError(runtimeError.message, {
			status: 502,
			code: runtimeError.code,
			details: { sessionKey: sessionKeyForWorkflowAgent(request), previousPublicTurnId },
		});
	}
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
		...(request.userIntentContract ? { parentUserIntentContract: request.userIntentContract } : {}),
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

function workflowClipWriterSpeechContract(request: WorkflowAgentRunRequest): Readonly<Record<string, unknown>> | null {
	const contexts = request.inputs["clip-contexts"] ?? [];
	const value = contexts[0];
	if (!isRecord(value) || !Array.isArray(value.spokenScript)) return null;
	return {
		dialoguePaceRate: value.dialoguePaceRate ?? null,
		lines: value.spokenScript,
	};
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

function workflowClipWriterTimelineEventIntervals(
	request: WorkflowAgentRunRequest,
): ReadonlyArray<Readonly<{ startSeconds: number; endSeconds: number }>> | null {
	if (request.outputArtifactType !== "tapcanvas.clip-prompts/v2") return null;
	for (const value of request.inputs["clip-contexts"] ?? []) {
		if (!isRecord(value) || !isRecord(value.beat) || !Array.isArray(value.beat.storyEvents)) continue;
		const intervals = value.beat.storyEvents.flatMap((rawEvent): Array<{ startSeconds: number; endSeconds: number }> => {
			if (!isRecord(rawEvent)) return [];
			const startSeconds = rawEvent.startSeconds;
			const endSeconds = rawEvent.endSeconds;
			return typeof startSeconds === "number" && Number.isFinite(startSeconds)
				&& startSeconds >= 0 && typeof endSeconds === "number" && Number.isFinite(endSeconds)
				&& endSeconds > startSeconds
				? [{ startSeconds, endSeconds }]
				: [];
		});
		if (intervals.length !== value.beat.storyEvents.length || intervals.length === 0) return null;
		const durationSeconds = workflowClipWriterTimelineDurationSeconds(request);
		const first = intervals[0];
		const last = intervals[intervals.length - 1];
		if (
			durationSeconds !== null
			&& first
			&& last
			&& first.startSeconds > 0
			&& Number((last.endSeconds - first.startSeconds).toFixed(6)) === Number(durationSeconds.toFixed(6))
		) {
			return intervals.map((interval) => ({
				startSeconds: Number((interval.startSeconds - first.startSeconds).toFixed(6)),
				endSeconds: Number((interval.endSeconds - first.startSeconds).toFixed(6)),
			}));
		}
		return intervals;
	}
	return null;
}

export function workflowAgentStructuredOutput(
	request: WorkflowAgentRunRequest,
): Readonly<Record<string, unknown>> | null {
	const submissionPolicy = request.failurePolicy === "single_submission"
		? WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY
		: WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY;
	const policy = {
		submissionPolicy,
		reviewPolicy: request.reviewPolicy ?? "disabled",
		...(request.executionPolicy === "single_inference"
			? { executionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY } : {}),
	};
	// Every structured authoring port is governed by a caller-frozen contract.
	// Invalid candidates stay ephemeral and are fed back to the same ReAct
	// execution chain for structural repair; no local field rewrite is allowed.
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
				...policy,
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
		const contract = request.jsonObjectContract?.jsonSchema
			? projectRuntimeBoundJsonOutputContract(request.jsonObjectContract)
			: request.jsonObjectContract;
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
		const canUseSingleArrayContract = !contract.jsonSchema && Boolean(singleRequiredArrayField)
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
			const itemSpeechContract = compilerOwnsClipEnvelope ? workflowClipWriterSpeechContract(request) : null;
			const itemTimelineDurationSeconds = compilerOwnsClipEnvelope
				? workflowClipWriterTimelineDurationSeconds(request)
				: null;
			const itemTimelineEventIntervals = compilerOwnsClipEnvelope
				? workflowClipWriterTimelineEventIntervals(request)
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
					...policy,
					// Typed writer output remains schema-checked, but structural failures
					// must be repairable by the same ReAct execution chain.
					...contractIdentity,
					requiredArrayField: singleRequiredArrayField,
					...(expectedArrayLengths[singleRequiredArrayField] === undefined
						? {}
						: { expectedArrayLength: expectedArrayLengths[singleRequiredArrayField] }),
					...(itemSpeechContract ? { itemSpeechContract } : {}),
					...(itemTimelineDurationSeconds === null ? {} : { itemTimelineDurationSeconds }),
					...(itemTimelineEventIntervals === null ? {} : { itemTimelineEventIntervals }),
					...(requiredNonEmptyArrayPaths.length
						? { requiredNonEmptyArrayPaths }
						: {}),
					...(exactAssetIds ? { itemExactAssetIds: exactAssetIds } : {}),
					// 顶层严格化：根对象只允许声明合同内的顶层字段。
					allowedTopLevelFields: [...new Set([...contract.allowedFields, ...(compilerOwnsClipEnvelope ? ["creativeReview", "selfQaNote"] : [])])],
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
				...policy,
				...contractIdentity,
				requiredStringFields,
				...(contract.jsonSchema ? { jsonSchema: contract.jsonSchema } : {}),
				...(contract.exactStringFields ? { exactStringFields: contract.exactStringFields } : {}),
				...(contract.knownExistingAssetIds?.length
					? { knownExistingAssetIds: [...contract.knownExistingAssetIds] }
					: {}),
				...(requiredNumberFields.length > 0 ? { requiredNumberFields } : {}),
				...(requiredObjectFields.length > 0 ? { requiredObjectFields } : {}),
				...(contract.requiredNonEmptyStringPaths?.length
					? { requiredNonEmptyStringPaths: [...contract.requiredNonEmptyStringPaths] }
					: {}),
				...(contract.requiredObjectPaths?.length
					? { requiredObjectPaths: [...contract.requiredObjectPaths] }
					: {}),
				...(contract.requiredArrayPaths?.length
					? { requiredArrayPaths: [...contract.requiredArrayPaths] }
					: {}),
				...(contract.optionalNonEmptyStringPaths?.length
					? { optionalNonEmptyStringPaths: [...contract.optionalNonEmptyStringPaths] }
					: {}),
				...(contract.exactStringPaths && Object.keys(contract.exactStringPaths).length > 0
					? { exactStringPaths: { ...contract.exactStringPaths } }
					: {}),
				...(requiredArrayFields.length > 0 ? { requiredArrayFields } : {}),
				...(Object.keys(expectedArrayLengths).length > 0 ? { expectedArrayLengths } : {}),
				...(Object.keys(arrayItemRequiredStringFields).length > 0 ? { arrayItemRequiredStringFields } : {}),
				...(Object.keys(contract.arrayItemStringFormats ?? {}).length > 0
					? { arrayItemStringFormats: contract.arrayItemStringFormats }
					: {}),
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
			...policy,
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
		return `服务端已冻结 providerSubmissionTopology（source=${String(topology.source)}）：物理视频必须严格提交 ${String(count)} 个 Clip，BeatSheet 的 beats 必须按顺序逐项对应这 ${String(count)} 个物理 Clip，durationSeconds 必须严格等于 ${JSON.stringify(durations)}；不得再按语义拆成更多或更少的物理 Clip。语义事件仍写在每个 beat 的 storyEvents 内。Agent 只提交 startKeyframe 与每个 storyEvent 的 exitState；runtime 在唯一提交边界按物理顺序确定性投影每个 entryState 与 beat.exitState，不存在可冲突的重复状态字段。`;
	}
	return "";
}

function workflowLatestUserRequestInstruction(
	request: WorkflowAgentRunRequest,
	promptInputs: Readonly<Record<string, readonly unknown[]>>,
): string {
	const inputs = request.inputs;
	const seen = new Set<object>();
	let userIntentContract: Record<string, unknown> | null = request.userIntentContract ?? null;
	let userRequest: Record<string, unknown> | null = null;
	const collectFacts = (value: unknown, depth = 0): void => {
		if ((!isRecord(value) && !Array.isArray(value)) || seen.has(value) || depth > 12) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const child of value) collectFacts(child, depth + 1);
			return;
		}
		const intent = value.userIntentContract;
		if (!userIntentContract && isRecord(intent) && typeof intent.contractHash === "string") {
			userIntentContract = intent;
		}
		const direct = value.userRequest;
		if (!userRequest && isRecord(direct) && readString(direct, "kind") === "public_chat_turn" && readString(direct, "content")) {
			userRequest = direct;
		}
		const accepted = value[WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD] ?? value.acceptedTurnSource;
		if (!userRequest && isRecord(accepted) && readString(accepted, "text")) {
			userRequest = {
				kind: "public_chat_turn",
				requestId: readString(accepted, "sourceId"),
				content: readString(accepted, "text"),
				requestFingerprint: readString(accepted, "fingerprint"),
			};
		}
		// Accepted text and the frozen intent can live in sibling input artifacts.
		// Finding either one must not discard the other (including standing preferences).
		for (const child of Object.values(value)) collectFacts(child, depth + 1);
	};
	for (const values of Object.values(inputs)) collectFacts(values);
	const currentUserRequest = userRequest as Record<string, unknown> | null;
	if (currentUserRequest) {
		const content = typeof currentUserRequest.content === "string" ? currentUserRequest.content : "";
		const requestId = readString(currentUserRequest, "requestId");
		const visiblePath = findVisibleAcceptedTurnContentPath(currentUserRequest, promptInputs);
		return [
				"本次 accepted public-chat turn 是当前执行链中最新的用户指令，优先级高于旧画布文本对呈现方式的隐含要求。",
				"userRequest 是当前请求；UserIntentContract 是父 Agent 冻结的完整目标与已确认事实；authoritativeSources 是保留来源身份的输入内容，来源可能是叙事正文或创作请求。它们不是可互换的字段，具体创作决策由 Agent 根据这些事实与 Skill 作出。expandedSourceDraft 保持辅助草稿身份，不得冒充已确认来源。",
				...(userIntentContract
					? [`同一执行链携带的 UserIntentContract 是已冻结的父任务目标；本节点只交付其声明的产物，按合同要求落实本节点承担的内容，不重复执行父任务的媒体动作：${JSON.stringify(userIntentContract)}`]
					: []),
			visiblePath
				? `当前 accepted public-chat turn 的逐字事实已在冻结输入 ${visiblePath}.content 中提供；requestId=${JSON.stringify(requestId)}。`
				: `当前 accepted public-chat turn（逐字事实）：${JSON.stringify({ content, requestId })}`,
		].join("\n");
	}
	if (userIntentContract) {
		return [
			"当前执行链携带一份已冻结的 UserIntentContract；它是父任务的用户目标、出口形态、要求与已确认事实，优先级高于旧文本和领域默认方法。本节点只交付其声明的产物，落实本节点承担的内容，不重复执行父任务的媒体动作。",
			`当前 UserIntentContract（逐字结构化事实）：${JSON.stringify(userIntentContract)}`,
		].join("\n");
	}
	return "当前执行链没有可验证的 accepted public-chat turn；不得从旧文本、模板或模型常识推断用户未提出的节奏、收束、悬念或结果。";
}

function workflowAgentProviderRecoveryEvidence(
	previousEvidence: Record<string, unknown> | null,
): Readonly<Record<string, unknown>> | null {
	if (!previousEvidence) return null;
	let current: Record<string, unknown> | null = previousEvidence;
	for (let depth = 0; current && depth < 8; depth += 1) {
		const failure = isRecord(current.structuredOutputFailure)
			? current.structuredOutputFailure
			: null;
		const providerFailure = failure && isRecord(failure.providerFailure)
			? failure.providerFailure
			: isRecord(current.providerResponseRejection)
				? current.providerResponseRejection
			: null;
		if (providerFailure) {
			const projected = pickRecordFields(providerFailure, [
				"protocolVersion",
				"reasonCode",
				"terminalState",
				"providerCode",
				"providerErrorType",
				"providerReason",
				"partialTextChars",
				"partialToolCallCount",
				"responseId",
				"recoveryMode",
				"responseScope",
				"acceptedSideEffect",
			]);
			return Object.keys(projected).length > 0 ? projected : null;
		}
		const nested: unknown = current.deliveryEvidence;
		current = isRecord(nested) && nested !== current ? nested : null;
	}
	return null;
}

const WORKFLOW_PROVIDER_RECOVERY_RECEIPT_FIELDS = [
	"protocolVersion",
	"reasonCode",
	"terminalState",
	"providerCode",
	"providerErrorType",
	"providerReason",
	"partialTextChars",
	"partialToolCallCount",
	"responseId",
	"recoveryMode",
	"responseScope",
	"acceptedSideEffect",
] as const;

function projectWorkflowAgentProviderRecoveryReceipt(
	value: unknown,
): Readonly<Record<string, unknown>> | null {
	if (!isRecord(value)
		|| value.protocolVersion !== "provider-response-rejection/v1"
		|| value.reasonCode !== "provider_response_rejected"
		|| value.terminalState !== "failed"
		|| typeof value.providerCode !== "string"
		|| !value.providerCode.trim()
		|| value.recoveryMode !== "agent_replan"
		|| value.responseScope !== "current_provider_response_only"
		|| value.acceptedSideEffect !== false) {
		return null;
	}
	return pickRecordFields(value, WORKFLOW_PROVIDER_RECOVERY_RECEIPT_FIELDS);
}

function workflowAgentProviderRecoveryEvidenceFromResult(
	result: WorkflowAgentRunResult,
): Readonly<Record<string, unknown>> | null {
	const structuredFailure = isRecord(result.structuredOutputFailure)
		? result.structuredOutputFailure
		: isRecord(result.deliveryEvidence) && isRecord(result.deliveryEvidence.structuredOutputFailure)
			? result.deliveryEvidence.structuredOutputFailure
			: null;
	const providerFailure = structuredFailure && isRecord(structuredFailure.providerFailure)
		? structuredFailure.providerFailure
		: isRecord(result.deliveryEvidence) && isRecord(result.deliveryEvidence.providerResponseRejection)
			? result.deliveryEvidence.providerResponseRejection
			: null;
	return projectWorkflowAgentProviderRecoveryReceipt(providerFailure);
}

function workflowAgentProviderRecoveryPrompt(
	request: WorkflowAgentRunRequest,
): string {
	const evidence = workflowAgentProviderRecoveryEvidence(request.previousEvidence);
	if (!evidence) return "";
	return [
		"上一物理窗口收到一份结构化供应商拒绝回执；它是恢复证据，不是用户事实、产物正文或可复用候选：",
		JSON.stringify(evidence),
		"保持同一模型、同一输入、同一结构化合同和同一逻辑任务。请依据 exact providerCode、terminalState 与 providerErrorType 自主决定合法修订；禁止原样重提交被拒候选、切换模型、把 providerReason 写入产物，或重放已成功/可能已受理的副作用。若不能形成合法修订，保留该证据并结束当前物理窗口交给 durable continuation。",
	].join("\n");
}

function workflowAgentDraftTransportInstruction(request: WorkflowAgentRunRequest): string {
	if (request.executionPolicy === "single_inference" || request.failurePolicy === "single_submission"
		|| request.outputEncoding === "plain_text") return "";
	return "物理轮次响应与逻辑任务的最终交付不同：从首轮起可以按 agents-cli 的原生 edits 协议输出纯 JSON 编辑批次，也可以直接提交完整候选。运行时保留草稿并在同一任务内继续构建；中间批次不是交付，不要求在单次推理内构建全部产物。只有完整候选通过冻结合同校验后才进入最终 text 端口；最终产物仍必须满足以下全部字段与交付范围。";
}

export function workflowAgentPrompt(
	request: WorkflowAgentRunRequest,
	sourceScopeProjection: FrozenSourceScopePromptProjection = projectFrozenSourceScopePromptInputs(workflowAgentPromptInputs(request)),
): string {
	const promptInputs = compactWorkflowPromptFacts(sourceScopeProjection.inputs, request);
	const authoringContract = request.jsonObjectContract?.jsonSchema
		? projectRuntimeBoundJsonOutputContract(request.jsonObjectContract)
		: request.jsonObjectContract;
	const projectContextPromptFacts = request.projectContext
		? workflowAgentProjectContextPromptFacts(request.projectContext, request.outputArtifactType, request.projectContextPromptMode)
		: null;
	const projectAssetCandidates = isRecord(projectContextPromptFacts)
		&& isRecord(projectContextPromptFacts.projectAssetCandidates)
		? projectContextPromptFacts.projectAssetCandidates
		: null;
	const canInspectAssets = request.allowedTools.includes("tapcanvas_workflow_execution_inspect")
		&& (request.executionPolicy !== "single_inference" || request.outputEncoding === "plain_text")
		&& request.projectContext !== null && request.projectContext !== undefined;
	const chapterAssetAuthor = isWorkflowChapterAssetArtifactType(request.outputArtifactType);
	const frozenAssetMatch = canInspectAssets && chapterAssetAuthor
		? JSON.stringify({ tool: "tapcanvas_workflow_execution_inspect", executionId: request.executionId,
			view: "asset_match", match: { referenceType: "declared reference type", canonicalName: "exact canonical subject name" } })
		: null;
	const frozenAssetRead = canInspectAssets
		&& (chapterAssetAuthor || (Array.isArray(projectAssetCandidates?.items)
			&& projectAssetCandidates.items.length > 0))
		? JSON.stringify({ tool: "tapcanvas_workflow_execution_inspect", executionId: request.executionId, view: "assets", assetIds: chapterAssetAuthor ? "exact IDs returned by frozenAssetMatch or selectedAssetSnapshot" : "exact IDs from projectAssetCandidates" })
		: null;
	const projectAssetCatalogInstruction = "projectAssetCandidates 是当前项目在本次执行快照中可引用的已就绪、可生产图片精简身份目录；selectedAssetIds 仅表示用户本轮显式选择约束，不是资产可见性边界。sharedFacts 与 items 按 mergeRule 共同组成完整目录。输出的资产引用 ID 必须逐字取自目录；sourceFacts、analysisEvidence 和 analysisDiagnostics 仅在实际读取后构成详情证据。可调用能力以本轮实际工具定义为准。";
	const chapterAssetLookupInstruction = [
		"项目资产未全量注入当前上下文；selectedAssetIds 与 selectedAssetSnapshot 只声明用户本轮显式选择约束，不表示完整资产目录。imageSource.mode=reuse 的 assetIds 声明直接复用精确资产 ID；imageSource.mode=generate 的 referenceAssetBindings 仅绑定生成输入，不能替代直接复用声明。权限与稳定身份关系由运行时冻结合同验证，不因查询结果缩窄。",
		frozenAssetMatch
			? "frozenAssetMatch 按结构化身份条件读取冻结项目资产；match 必须声明 referenceType，且至少声明 assetId、physicalIdentityKey、canonicalName、assetReuseKey 之一；assetPurpose 与 stateKey 只进一步限定用途和状态。返回匹配状态、候选与精确 ID。详情可继续用同一只读工具 view=assets 按返回 assetIds 读取；未实际读取的详情不是已知事实。"
			: "本节点实际执行合同未开放资产匹配工具；不得宣称调用了资产查询或读取未提供的候选。",
	].join("\n");
	const inputReadInstruction = "输入中的 workflow.input-reference/v1 是冻结事实的读取句柄，不是已读取正文。按当前任务需要自主调用 contentRead，沿同一 revision 分页读取 JSON 文本；目录、类型和长度不能替代内容证据。原输入及完整输出合同不因引用而改变。";
	if (request.promptMode === "compact_structured") {
		if (request.outputEncoding !== "json_object" || !request.jsonObjectContract) {
			throw new Error("compact_structured prompt requires a json_object contract");
		}
		return [
			frozenAssetMatch ? `frozenAssetMatch: ${frozenAssetMatch}` : "",
			frozenAssetRead ? `frozenAssetRead: ${frozenAssetRead}` : "",
			"执行当前工作流的单项结构化任务。只依据下列冻结输入与合同，最终交付一个完整 JSON 对象；禁止 Markdown、说明文字或额外字段。",
			workflowAgentDraftTransportInstruction(request),
			`任务目标：${request.instruction}`,
			`输出产物：${request.outputArtifactType}`,
			`交付合同：${request.deliveryRequirement}`,
			inputReadInstruction,
			projectAssetCandidates ? `本次冻结 ProjectContext：${JSON.stringify(projectContextPromptFacts)}` : "",
			projectAssetCandidates ? projectAssetCatalogInstruction : "",
			chapterAssetAuthor ? `本次冻结 ProjectContext：${JSON.stringify(projectContextPromptFacts)}` : "",
			chapterAssetAuthor ? chapterAssetLookupInstruction : "",
			`冻结输入（JSON）：${JSON.stringify(promptInputs)}`,
			// A jsonSchema contract travels to agents-cli as outputContract, which
			// delivers it once (submit tool parameters or an inline fallback).
			request.jsonObjectContract.jsonSchema
				? ""
				: `输出结构（JSON Schema）：${JSON.stringify(authoringContract)}`,
			"根据冻结输入填写所有必填字段。最终交付前核对字段、引用和边界；提交失败时保留精确错误供诊断。",
		].filter(Boolean).join("\n\n");
	}
	const canonicalSourcePort = (request.inputs["canvas-facts"]?.length ?? 0) > 0
		? "canvas-facts"
		: "delivery-contract.canvasFacts";
	const sourceContextInstruction = sourceScopeProjection.status === "projected"
		? `上下文来源采用单一事实源：${canonicalSourcePort} 中 authoritativeSources 保持冻结来源身份。prompt 副本中出现 contentReference 时，表示宿主已依据 sourceId、fingerprint、ranges、slices 与同 scope 的结构化 speechEvents 精确核验，并用来源引用替换重复全文；它不表示当前 prompt 已提供引用目标的全文。clip-segment.sourceSlices 与匹配 clip-sequence.speechEvents 是当前作用域可直接使用的来源和人声事实。delivery-contract 仍冻结时长、供应商和交付边界；运行时保留原始来源输入用于校验。不得声称读取了未实际提供的来源正文。`
		: `上下文来源采用单一事实源：${canonicalSourcePort} 中的 authoritativeSources 是运行时冻结的来源正文和身份；delivery-contract 冻结时长、供应商和交付边界${canonicalSourcePort === "canvas-facts" ? "，并通过 canvasFactsSourcePort 指向 canvas-facts，不重复承载来源正文" : "，其 canvasFacts 是本节点的来源正文投影"}。逐 Clip writer 的提示副本只保留来源身份、指纹和正文长度，并把当前 beat 的冻结事件、人声与相邻承接事实作为执行输入；原始正文仍保留在运行时输入用于校验，不在每个 Clip 中重复传输。父 UserIntentContract 中的要求和 confirmedFacts 与来源正文各保留原有身份；二者均可供 Agent 使用，不能以正文未提供最终产物为由抹去已明确的创作目标。素材名称、Skill 示例和模型常识不构成观察事实。`;
	const promptInputHeader = sourceScopeProjection.status === "projected"
		? "上游端口事实（JSON，已核验来源正文以 contentReference 引用；当前范围原文保留在 sourceSlices，结构化人声保留在 speechEvents）："
		: `上游端口事实（JSON，${canonicalSourcePort === "canvas-facts" ? "delivery-contract 中的 canvasFactsSourcePort 仅表示引用，不是第二份来源正文" : "delivery-contract.canvasFacts 是唯一来源正文投影"}）：`;
	const clipWriterFirstPassChecklist = request.outputArtifactType === "tapcanvas.clip-prompts/v2"
		? [
			"视频 Clip writer 首稿提交检查：clip-contexts[0].spokenScript 是冻结的人声唯一来源，不能省略、改写或换字段名。",
			"shots[].durationSeconds 是最终可执行秒数，不是相对权重。提交前从 cursor=0 开始按数组顺序计算每镜半开区间 [shotStart,shotEnd)：shotStart=cursor，shotEnd=cursor+durationSeconds，再令 cursor=shotEnd；最后 cursor 必须精确等于冻结 beat.durationSeconds。runtime 不会缩放、吸收余差或改写任何镜头时长。",
			`冻结 storyEvents 的实际半开区间按零基下标为 ${JSON.stringify(workflowClipWriterTimelineEventIntervals(request) ?? [])}；对每个 shots[N].depictedStoryEventIndices 中声明的零基事件 i，必须使用最终镜头区间验证 shotStart < storyEvents[i].endSeconds 且 shotEnd > storyEvents[i].startSeconds。边界相等不算相交；每个冻结事件仍必须至少由一个真正演出它且时间相交的镜头声明。`,
			"当 spokenScript 为空时，speakerBindings 必须省略或严格输出 []，speechEvents 必须是 []；shots 不得出现任何人声正文或人声字段。",
			"当 spokenScript 非空时，speechEvents 必须按 spokenScript 原始顺序一项对应一条冻结人声；不要输出 lineId 或 speechEventId（宿主在唯一提交边界按数组位置绑定冻结 lineId 并生成稳定 transport ID）。每个事件仍必须给出 startOffset=0、endOffset=对应冻结行 Unicode 码点长度、clip 内独立 startSeconds/endSeconds、speakerName、delivery、performance；performance 只写语速、音量、气息、停顿、重音和潜台词，禁止人物站位、肢体/道具动作、镜头或剧情事件；禁止按镜头切分台词。",
			"shots 不得提交 speechEventIds；调用方会在模型首稿已经闭合的最终镜头时钟上按时间窗相交关系确定性编译。同一 SpeechEvent 可以跨多个镜头，切镜不得截断、重启或重复发声。writer 不得提交 spokenText、dialogue 或其它台词正文。",
			"motionDynamics 是语义可选的机器执行合同：只有当前 shot 明确属于高动力、且主体存在可声明的实际位移或受力时才输出对象；低动力或没有合法方向时语义上省略整个对象。若当前严格提交工具 schema 要求该属性存在，用 JSON null 表示省略；禁止构造 motionDynamics.direction=none、空字符串或其它占位对象。若输出 motionDynamics，motionDynamics.direction 表示主体实际位移/受力方向，不表示镜头运动方向，只能使用 ASCII 枚举 left、right、forward、backward、upward、downward 或 diagonal；不要输出中文方向、自然语言句子、箭头符号或自造枚举。tempo 只能是 instant|fast|sustained，force 只能是 light|medium|heavy，airborne 只能是 none|brief|extended，rotation 只能是 none|partial|full，brakingMode 只能是 ground_friction|wall_impact|grip|counterforce，environmentalResponse 只能是 none|dust|debris|splash|deformation；不要把动作说明塞进枚举字段。",
			"有对白时 speakerBindings 必须只包含冻结说话人且顺序一致，每项 name 非空、assetKind 只能是 character 或 voice，禁止空字符串；角色入画的说话人用 character，纯声音通道才用 voice。",
			"顶层 selfQaNote、creativeReview 与 sourceFidelityAudit 都只是可选追溯证据；缺失或格式不完整不得阻止生产，也不得用审计文字代替 clips 中的真实内容。",
			"不要把对白放进 dialogueScript、speech 或 shot 文案来规避事件合同；只有一个冻结对白行时，建立一个覆盖 [0,N) 的完整 SpeechEvent，逐镜引用仍由调用方编译。",
			"从冻结输入重新生成完整 clips、shots、动作、镜头和资产字段；最终只输出一个完整 JSON 对象。",
		].join("\n")
		: "";
	return [
		frozenAssetMatch ? `frozenAssetMatch: ${frozenAssetMatch}` : "",
		frozenAssetRead ? `frozenAssetRead: ${frozenAssetRead}` : "",
		"执行当前工作流 Agent 原子节点。",
		workflowAgentProviderRecoveryPrompt(request),
		"本节点最终交付必须是完整结构化候选；每个物理响应按本次冻结的执行与提交策略处理。runtime 不改写语义字段、不切换模型、不重复已成功的副作用；runtime 不缩放镜头时长、不重映射事件索引，也不回灌修订已冻结的语义事实。结构失败保留精确字段路径与失败证据；是否进入同链修复及当前物理动作边界由 agents-cli 按冻结策略处理，不由本提示词另设首轮完整要求或固定修复次数。",
		clipWriterFirstPassChecklist,
		isWorkflowBeatSheetArtifactType(request.outputArtifactType)
			? "BeatSheet 状态字段硬约束：每个 storyEvents 项只由 Agent 提交 sourceBeatId、event、exitState、startSeconds、endSeconds；严禁输出 entryState。Beat 项严禁输出 exitState。首事件入口使用 startKeyframe，后续 entryState 与 Beat exitState 由提交边界按顺序确定性投影。"
			: "",
		`任务目标：${request.instruction}`,
		`声明输出产物：${request.outputArtifactType}`,
		`本节点交付合同：${request.deliveryRequirement}`,
			request.outputArtifactType === "tapcanvas.beat-sheet/v2"
				? `当前 BeatSheet 运行时合同版本为 ${BEAT_SHEET_ARTIFACT_CONTRACT_VERSION}，采用单一事实源：章级 Agent 在唯一提交前完成来源审查、戏剧分析和整段成片序列设计，只提交 sourceCoveragePlan、chapterArc、sequenceControlPlan、objectRegistry、beats 中的执行事实。sourceCoveragePlan 是必填根对象；即使当前来源没有任何对白，也必须原样输出 {"speechLedger":[]}，不得省略或用 null/空数组替代该对象。若来源有对白，speechLedger 逐字声明人声。chapterArc 只包含 storyPromise、protagonistThroughline、primaryPayoff、endingHook；endingHook 只有用户明确要求或 authoritativeSources 已有未闭合事件时填写非空字符串，否则必须填写 null，禁止为满足字段而编造悬念、收势、胜负未决或生死未明。sequenceControlPlan 必须声明 protocolVersion=${WORKFLOW_SEQUENCE_CONTROL_PLAN_PROTOCOL_VERSION}、totalDurationSeconds，以及按 beats 顺序逐项声明 segments：clipId、连续 startSeconds/endSeconds、temporalDirectives 和 transitionFromPrevious/transitionToNext。temporalDirectives 是通用时间处理指令，每项只声明非空 kind、时间窗和 reason；它可以表达由当前视频任务决定的任意时间处理，runtime 不按 kind 做语义路由。sequenceControlPlan 是整段生命链唯一的时间处理和跨 Clip 承接事实源；后续 Clip writer 只能执行当前 segment，不得另行发明节奏、重复闭环或改写总时长。时间处理、动作密度、收束方式和出口状态必须依据最新用户指令与已加载领域 Skill 的结构化判断；不得由运行时自行补写未授权的叙事功能。每个 storyEvent 只提交 sourceBeatId、event、exitState、startSeconds、endSeconds，严禁提交 entryState；每个 beat 也严禁提交 exitState。首事件入口来自 startKeyframe，后续 entryState 与 beat.exitState 由提交边界按顺序确定性投影，保证跨事件和跨 Beat 连续性。每段声明 dominantFunction、causalEntry、irreversibleResult、handoffToNext。对象只在根级 objectRegistry 注册一次，每个对象必须显式提交 physicalIdentityKey、referenceImageNodeIds 与 referenceRole，referenceRole 只能是 none/identity/wardrobe/prop/environment/palette/composition/vfx；scale（如需）只能是非空字符串，禁止数字。且只能绑定冻结 ProjectContext 能验真的 referenceAssetIds；character 的 physicalIdentityKey 非空，其它 kind 严格为 null。只为成片中真正需要跨 Clip 保持可辨认身份或空间连续性的对象建立参考职责；一次性路人、匿名围观者、背景人群和只承担群体反应的非核心群体，若个体身份无需跨 Clip 连续，必须由模型在唯一首稿中设为 referenceRole=none 且两个引用 ID 数组为空，不为其创建角色卡。beat.objectStates 必须按 objectRegistry 中的对象各提交至多一项，禁止同一 objectId 在同一 beat 重复；每项通过 objectId 提交该对象的状态增量，并显式提交本段 referenceAssetIds/referenceImageNodeIds 两个数组：只能选该对象 registry 内的 ID；无已有图片时均为空数组，禁止省略后继承全局集合。sourceFidelityAudit.sourceBeatLedger 是必填来源事件账本，通过 sourceBeatId 对应 storyEvents；宿主只验证结构与引用，不判定语义覆盖，也不会生成或改写账本。clipId、characters、speakers、dialogueScript 与 assetObjectContracts 由宿主根据已提交的确定性事实编译；显式所选资产由模型在根级 objectRegistry 中绑定 referenceAssetIds 或当前画布的 referenceImageNodeIds；同一对象允许多图，宿主只按冻结 ID 映射解析，不猜测对象。最终 JSON 是下游执行合同，不是分析报告；BeatSheet 冻结整段序列控制，Clip writer 只负责执行。`
			: request.outputArtifactType === "tapcanvas.launch-beat-sheet/v1"
				? `当前首 Clip BeatSheet 与章级 BeatSheet 使用同一个单一事实源合同版本 ${BEAT_SHEET_ARTIFACT_CONTRACT_VERSION}，只是 beats 必须恰好一项且 clipIndex=0。一次提交 sourceCoveragePlan、chapterArc、sequenceControlPlan、objectRegistry 和唯一 beat 的执行事实；sequenceControlPlan 仍需包含一个覆盖该 beat 全部时长的 segment、开放的 temporalDirectives 与前后转场接口，不能省略。每个 storyEvent 只提交 sourceBeatId、event、exitState 与本地时间轴，严禁提交 entryState；beat.exitState 也由提交边界确定性投影。每个 objectStates 项必须显式提交 referenceAssetIds/referenceImageNodeIds，选择该对象 registry 的本段有序子集；没有已有引用时提交空数组，宿主不会自动继承全局引用。每个 objectRegistry 项显式提交 physicalIdentityKey、referenceImageNodeIds、referenceRole 与已验真 referenceAssetIds；referenceRole 只能是 none/identity/wardrobe/prop/environment/palette/composition/vfx，scale（如需）只能是非空字符串。只为成片中真正需要持续可辨认身份或空间连续性的对象建立参考职责；无需身份连续的一次性路人、匿名围观者、背景人群和非核心群体必须设为 referenceRole=none 且两个引用 ID 数组为空。sourceFidelityAudit.sourceBeatLedger 是必填来源事件账本，宿主仅检查结构和引用，不判定语义覆盖或改写账本。clipId、characters、speakers、dialogueScript 和 assetObjectContracts 由宿主根据已提交的确定性事实编译。没有新增叙事人声时 narrativeAudioPlan 必须输出 {\"lines\":[]}。`
			: request.outputArtifactType === "tapcanvas.clip-prompts/v2"
				? `当前视频 writer 运行时合同版本为 ${VIDEO_WRITER_ARTIFACT_CONTRACT_VERSION}：writer 创作有序 shots、独立 speechEvents、动作、摄影、表演、逐镜 depictedStoryEventIndices 和创作自检。writer 必须把 sequenceContext.sequenceContextScope 声明的当前段、邻窗和 readPolicy 视为可见范围；当前段继续服从 sequenceContext.sequenceControlPlan 与 current.timing 的冻结事实，远处段落按 scope.fullSequenceRead 指针使用 tapcanvas_execution_node_runs_get 读取，不把省略范围当作未知以外的事实，也不要求重复注入整段 sequenceTimeline。writer 只执行当前 Beat，不创建独立 clip 闭环；首镜承接 previous 的退出与 current.timing.transitionFromPrevious，末镜落实 current.timing.transitionToNext 并把未完成动作交给 next。所有时间处理只能落在 current.timing.temporalDirectives 声明的区间内；writer 不得自行添加、删除或更改任何时间处理指令。每条冻结人声必须由一个完整 SpeechEvent 承载并可跨镜头。shots[].durationSeconds 是最终可执行秒数，必须精确加总到冻结 clip durationSeconds；speechEvents 与累计 shot 区间使用同一绝对时钟。用户明确给出的数值边界按原值执行；节奏、动作、摄影与切点由 agents 根据用户事实和已加载 Skill 决定，宿主不从语义用词推导额外数值规格。每个 depictedStoryEventIndices 声明必须同时满足语义真实承载和半开时间区间严格相交，边界相等不算相交。runtime 不缩放镜头时长、不重映射事件索引、不改写语义字段；结构失败保留精确路径、候选长度与哈希，按冻结提交策略处理同链修复和当前动作边界。shots[].speechEventIds、sourceEventCoverage、temporalFrameTrack 与 temporalFrameCoverage 均由调用方确定性编译；writer 禁止复制任何机器字段。`
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
				JSON.stringify(projectContextPromptFacts),
				request.outputArtifactType === OPENING_FRAME_PLAN_ARTIFACT_TYPE
						? "projectAssetCandidates 是冻结作用域内可被输出合同引用的真实图片身份目录；你可按需要调用只读 frozenAssetRead 检查候选的精确事实。输出中的 assetId 必须逐字取自该目录；宿主只校验冻结 ready-image 权限范围，不替 Agent 判断资产语义是否匹配。"
				: isWorkflowBeatSheetArtifactType(request.outputArtifactType)
					? "projectAssetCandidates 是当前项目在本次执行快照中全部已就绪、可生产图片的精简身份目录；sourceFacts、analysisEvidence 和 analysisDiagnostics 通过 frozenAssetRead 指定的只读工具按所需 assetIds 读取。按任务需要自主选择读取哪些详情，没有最低读取数量。提交唯一首稿前，必须按角色肉身、场景空间及来源事实完成语义核对；展示名、canonicalName 或章节内称谓不同不代表新身份。确认是同一角色肉身或同一场景状态时，把候选 assetId 原样写入对应 objectRegistry[].referenceAssetIds；character 同时优先沿用候选 physicalIdentityKey（详情中为 sourceFacts.physicalIdentityKey）。确认是新人物、新地点或可见状态确实不同才保持引用为空并生成新资产。不得仅因字符串不完全相同重复生图，也不得把相似但不同身份强行复用。这个判断只在本次 BeatSheet 首稿中完成，runtime 后续只验证精确 ID 的项目归属、图片就绪状态和单对象绑定，不会返回语义纠偏。"
					: isWorkflowChapterAssetArtifactType(request.outputArtifactType)
						? chapterAssetLookupInstruction
				: "完整 projectAssetIds/assetSnapshot 仍由服务端保存并用于权限、复用身份和输出合同校验，不在模型提示中重复展开。可调用能力以本轮实际工具定义为准，不得尝试访问快照外资产。",
			].join("\n")
			: "",
		request.projectContext && isWorkflowBeatSheetArtifactType(request.outputArtifactType) && request.projectContext.selectedAssetIds.length > 0
			? [
				"显式所选资产是一等执行事实，不是可选参考。对下面 selectedAssetIds 中的每个 ID，先依据 selectedAssetSnapshot 的身份目录判断；需要 sourceFacts 或图片分析时，通过 frozenAssetRead 按精确 ID 读取，再在本次唯一首稿提交前完成语义匹配，并把该 ID 原样写入恰好一个匹配对象的根级 objectRegistry[].referenceAssetIds；同一根对象可绑定多张真实参考图，完整保留其有序 ID；节点 ID 由宿主依据冻结画布精确解析为资产 ID。必须覆盖全部 selectedAssetIds，不得遗漏、替换、另生成相似对象。全局 registry 是素材池；每个 beat.objectStates 必须显式提交 referenceAssetIds/referenceImageNodeIds，只选择该对象在本段使用的有序子集，不能省略。beats[].assetObjectContracts 由宿主从 objectRegistry 与 objectStates 确定性派生，模型不得输出；runtime 只解析和验证显式绑定，不按名称猜测；结构性缺项通过同一逻辑任务的 outputRepair 回灌。",
				"唯一提交前逐项复核：selectedAssetIds 的每个 ID 都在 objectRegistry[].referenceAssetIds 中精确出现一次，并且匹配对象的 name、physicalIdentityKey、referenceRole、identityInvariant 与 selectedAssetSnapshot 来源事实一致。",
				JSON.stringify({ selectedAssetIds: request.projectContext.selectedAssetIds,
					selectedAssetSnapshot: workflowProjectImageCatalog(request.projectContext).filter((asset) => request.projectContext?.selectedAssetIds.includes(asset.assetId)) }),
			].join("\n")
			: "",
		request.projectContext && (
			(request.projectContext.visualStyle?.referenceImages.length ?? 0) > 0
			|| Boolean(request.projectContext.visualStyle?.styleLock)
		)
			? "本次执行已冻结项目级视觉锚点 visualStyle：后续所有人物、场景、道具和视频 Clip 必须继承同一组风格参考图与 styleLock.stylePrompt；不得在不同 Clip 间切换动漫/写实等媒介或色彩体系。风格图只承担 style/palette 职责，不替代角色身份图；若锚点来自 Project Look Bible 的文本合同，即使没有风格图，也必须把该合同作为每个视觉资产计划和视频 Clip 的共享风格输入。"
			: "本次执行未发现已锁定的项目风格参考图；不得假装存在风格图或精确色卡，保持风格未知并在产物诊断中记录。",
		workflowAgentPhysicalClipNotice(request.inputs),
		workflowLatestUserRequestInstruction(request, promptInputs),
		sourceContextInstruction,
		"若上游 canvas-facts 携带 referenceVideoAnalyses，它是本次明确选中的参考视频的唯一视觉/听觉事实来源；必须先读取其中的逐秒镜头、动作、场景、剪辑与声音信息，再编写 BeatSheet 或 clip prompt。参考视频只用于理解，禁止把原视频 URL 或原视频本体作为生成接口输入。",
		"若上游 canvas-facts 携带 userRequest，它是当前用户本轮逐字冻结的执行与创作要求。保留其来源身份，与 authoritativeSources 故事正文区分；依据本节点声明的输出 schema 和按需读取的 Skill 完成任务，不从其它节点推导输出字段。",
		openingClipSourceWindowInstruction(request),
		inputReadInstruction,
		promptInputHeader,
		JSON.stringify(promptInputs),
		request.outputArtifactType === "tapcanvas.clip-prompts/v2"
			? "authoringEvidencePacket 保存上游读取来源与回执；来源元数据不等于当前上下文已包含正文，不能据此伪称掌握正文内容。asset-bindings 是已验真的物化图片集合，assetPlan.consumerClipIds 声明其消费者。sequenceContext.previous/current/next 保存同一来源下相邻段的事件、逐字人声、关键帧与对象状态；它们是冻结输入，当前节点输出作用域仍是当前 clip。"
			: "",
		request.outputEncoding === "json_array" && request.jsonArrayContract
			? `数组结构合同（JSON）：${JSON.stringify(request.jsonArrayContract)}`
			: "",
		// jsonSchema contracts are delivered once by agents-cli from outputContract
		// (submit tool parameters, or inline when no terminal tool is attached).
		request.outputEncoding === "json_object" && request.jsonObjectContract && !request.jsonObjectContract.jsonSchema
			? `对象结构合同（JSON）：${JSON.stringify(authoringContract)}`
			: "",
		"本节点完整产物由最终响应的 text 端口接收；禁止用 write_file、bash 或 exec_command 保存中间文件。",
		workflowAgentDraftTransportInstruction(request),
		[
			request.requiredSkills.length > 0
				? `本节点的冻结 Workflow Skill 依赖已经预载：${JSON.stringify(request.requiredSkills)}。按预载骨架给出的精确 sectionId/resource 使用 Skill 渐进读取所需正文；skill_search 仍可用于发现当前请求需要的额外 Skill，但不得用它替换或否定这些预载依赖。${request.allowedTools.includes("knowledge_search") ? "知识证据仍按需要使用 knowledge_search → knowledge_read，候选可见不等于正文已读，禁止伪称引用。" : "本节点未装配可选知识检索工具；不得伪称引用未读取的知识案例，依据已提供事实与 Skill 继续创作。"} 完成必要读取后直接交付本节点声明的产物。`
				: request.allowedTools.includes("knowledge_search")
					? "本节点默认拥有完整 Skill 目录与完整向量知识库的检索权限，无需节点挂载。仅在当前产物需要专业方法或声明性证据时，按本轮原始任务使用 skill_search → Skill、knowledge_search → knowledge_read 渐进读取；候选或目录可见不等于正文已读，禁止伪称引用。完成必要读取后直接交付本节点声明的产物。"
					: request.allowedTools.includes("skill_search") && request.allowedTools.includes("Skill")
						? "本节点可使用完整 Skill 目录；仅在当前产物需要专业方法时按需使用 skill_search → Skill。可选知识检索工具未装配；不得伪称引用未读取的知识案例，依据已提供事实与 Skill 继续创作。"
						: "本节点没有挂载 Skill 或 skill_search 工具，也没有预载 Workflow Skills；仅依据本节点已提供的事实交付声明产物，不要声称读取了未提供的 Skill。",
			request.promptExampleRetrievalScope
				? `本节点的案例源限定为 ${request.promptExampleRetrievalScope.mediaType}；检索工具由 Agent 按当前证据缺口选择使用，不是首次创作前的固定步骤。复用上游已有候选和正文回执；无证据时允许原创，只有实际读取的正文才可声明来源。`
				: "",
		].filter(Boolean).join("\n"),
		isWorkflowBeatSheetArtifactType(request.outputArtifactType)
			? "BeatSheet 的 narrativeAudioPlan 必须始终是对象（至少包含 lines 数组）；没有新增叙事人声时使用 {\"lines\":[]}，禁止使用空数组。strategy=source_speech_only 时，lines 可以显式复述当前 Beat 的冻结源对白以声明其音频策略；宿主会将其视为同一份源语音账本，绝不重复追加。strategy=source_grounded_voice 或 mixed 时，lines 才表示真正新增、且不属于 sourceCoveragePlan.speechLedger 或 dialogueScript 的人声；不得复制、改写或重新编号任何源对白。每条新增人声必须使用与 dialogueScript 完全不同的 lineId；afterSourceLineId 只能是 null 或当前 Beat 的源对白 lineId。没有源对白时全部为 null，并按 lines 数组顺序执行；不得引用新增人声或跨 Beat 的 lineId。"
			: "",
		request.outputEncoding === "json_artifact"
			? `最终交付必须只包含一个严格 JSON 对象，结构为 {"artifactType":${JSON.stringify(request.outputArtifactType)},"text":"完整产物正文"}；禁止 Markdown 代码围栏、前后说明和额外顶层字段。text 必须是实际产物，不得是完成声明或产物摘要。`
			: request.outputEncoding === "json_object"
				? "最终交付必须只包含符合对象结构合同的严格 JSON 对象；禁止 Markdown 代码围栏、前后说明和额外字段。"
				: request.outputEncoding === "json_array"
					? "最终交付必须只包含一个严格 JSON 对象，结构为 {\"items\":[...完整数组项]}；items 必须符合数组结构合同且非空，禁止 Markdown 代码围栏、前后说明和额外顶层字段。运行时会在验证后确定性解包为 typed port 所需的顶层数组。"
					: "最终响应正文必须就是完整产物本身，不得只返回完成声明、产物摘要或下一步说明。",
		"工作流运行时会基于 typed output 与真实任务终态构造 expectedDelivery → deliveryEvidence → deliveryVerification；最终响应不得输出这些协议字段或验收报告，只交付本节点声明的产物。",
	].filter(Boolean).join("\n\n");
}

export const WORKFLOW_AGENT_RETRIEVAL_QUERY_MAX_CHARS = 24_000;

function boundWorkflowAgentRetrievalText(value: string): string {
	if (value.length <= WORKFLOW_AGENT_RETRIEVAL_QUERY_MAX_CHARS) return value;
	const headLength = Math.floor(WORKFLOW_AGENT_RETRIEVAL_QUERY_MAX_CHARS / 2);
	const tailLength = WORKFLOW_AGENT_RETRIEVAL_QUERY_MAX_CHARS - headLength;
	return `${value.slice(0, headLength)}\n…[retrieval query structurally bounded]…\n${value.slice(-tailLength)}`;
}

export function workflowAgentRetrievalUserRequest(request: WorkflowAgentRunRequest): string {
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
	return boundWorkflowAgentRetrievalText(visit(promptInputs, 0) || JSON.stringify(promptInputs));
}

export function workflowAgentRetrievalContext(request: WorkflowAgentRunRequest): Readonly<{
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
		...(request.userIntentContract
			? [{ id: "parent-user-intent", text: JSON.stringify(request.userIntentContract), source: "input" as const }]
			: []),
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
	const providerRecoveryEvidence = workflowAgentProviderRecoveryEvidence(input.request.previousEvidence);
	return {
		version: 1,
		source: "agents_cli_durable_turn_status",
		sessionKey: input.sessionKey,
		logicalTaskId: input.turn.turnId,
		internalTurnId: input.turn.internalTurnId,
		state: input.turn.state,
		phase: input.turn.phase,
		reasonCode: input.turn.reasonCode,
		lastConfirmedAt: input.turn.lastConfirmedAt,
		outputArtifactType: input.request.outputArtifactType,
		...(physicalRetryOrdinal === null ? {} : { physicalRetryOrdinal }),
		...(rateLimitDeferralCount === null ? {} : { rateLimitDeferralCount }),
		...(noProgressRecoveryEpoch === 0 ? {} : { noProgressRecoveryEpoch }),
		...(providerRecoveryEvidence
			? { providerResponseRejection: providerRecoveryEvidence, recoveryMode: "agent_replan" }
			: {}),
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
}>): WorkflowAgentRunResult & { deliveryEvidence: Readonly<Record<string, unknown>> } {
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
	// Window counts are observations, not proof that every safe path is closed.
	// Pass the exact physical failure to the author through the unified ephemeral
	// repair channel; the Agent owns replanning and deterministic terminal evidence.
	const taskRepairEvidence = projectWorkflowPhysicalFailureRepairEvidence({
		...input.baseEvidence,
		physicalFailureReason: WORKFLOW_AGENT_NO_PROGRESS_PHYSICAL_FAILURE,
		noProgressRecoveryEpoch,
		recoveryWindow: input.recoveryWindow,
		physicalRetryOrdinal,
	});
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
			taskRepairEvidence,
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

/** Candidate submission closes one physical action; its schema receipt can repair the logical task. */
function workflowAgentFailureCanContinue(request: WorkflowAgentRunRequest, reason: unknown): boolean {
	return resolveWorkflowAgentPhysicalContinuationReason(reason) !== null
		|| (reason === "structured_output_invalid" && request.outputEncoding !== "plain_text");
}

function retryWorkflowAgentPhysicalRun(input: Readonly<{
	request: WorkflowAgentRunRequest;
	publicTurnId: string;
	sessionKey: string;
	turn: NonNullable<AgentsChatTurnStatusSnapshot["turn"]>;
	failureReason: string;
}>): WorkflowAgentRunResult {
	if (input.request.failurePolicy === "single_submission"
		&& !workflowAgentFailureCanContinue(input.request, input.failureReason)) {
		return {
			taskId: input.publicTurnId,
			text: input.turn.finalResponse ?? "",
			assets: [],
			expectedDelivery: workflowAgentExpectedDelivery(input.request),
			deliveryEvidence: {
				...durableTurnEvidence({ request: input.request, sessionKey: input.sessionKey, turn: input.turn }),
				failurePolicy: "single_submission",
				physicalFailureReason: input.failureReason,
				retryablePhysicalFailure: false,
			},
			deliveryVerification: null,
			requestTerminal: { status: "failed", reason: input.failureReason },
			...durableTurnProvenance(input.turn),
		};
	}
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
	const previousErrorCode = previousAgentDeliveryEvidence(input.request.previousEvidence)?.errorCode;
	if (input.request.failurePolicy === "single_submission" && input.traceStatus === "failed" && typeof previousErrorCode === "string"
		&& previousErrorCode.trim() && !workflowAgentFailureCanContinue(input.request, previousErrorCode.trim())) {
		const failureReason = previousErrorCode.trim();
		return {
			taskId: input.publicTurnId,
			text: "",
			assets: [],
			expectedDelivery: workflowAgentExpectedDelivery(input.request),
			deliveryEvidence: {
				sessionKey: input.sessionKey,
				logicalTaskId: input.publicTurnId,
				traceStatus: input.traceStatus,
				traceUpdatedAt: input.traceUpdatedAt,
				errorCode: failureReason,
				failurePolicy: "single_submission",
				retryablePhysicalFailure: false,
			},
			deliveryVerification: null,
			requestTerminal: { status: "failed", reason: failureReason },
		};
	}
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
	observed?: AgentsChatTurnStatusSnapshot,
): Promise<WorkflowAgentRunResult> {
	const sessionKey = sessionKeyForWorkflowAgent(request);
	const snapshot = observed ?? await getAgentsChatTurnStatus(
		context,
		request.ownerId,
		sessionKey,
		{ timeoutMs: WORKFLOW_AGENT_STATUS_DEADLINE_MS,
			...(request.outputEncoding !== "plain_text" ? { includeStructuredOutputRepair: true } : {}) },
	);
	const structuralFailure = !snapshot.activeTurn && snapshot.turn?.turnId === publicTurnId
		&& snapshot.turn.reasonCode === "structured_output_invalid" && request.outputEncoding !== "plain_text";
	const retainedRepair = structuralFailure && snapshot.structuredOutputRepair
		? verifyWorkflowAgentRepairHandoff({ checkpoint: snapshot.structuredOutputRepair,
			sourceContext: workflowAgentStructuredSourceContext(request) }) : null;
	const result = await observeWorkflowAgentNodeFromDurableTurn(context, request, publicTurnId, snapshot);
	if (!structuralFailure) return result;
	console.info(JSON.stringify({ message: "workflow_agent_structured_failure_reconciled",
		executionId: request.executionId, nodeId: request.nodeId, publicTurnId,
		candidateAvailability: retainedRepair ? "retained_checkpoint" : "unavailable",
		candidateCharacters: typeof retainedRepair?.candidate === "string" ? retainedRepair.candidate.length : 0,
		source: "exact_durable_turn", authorInferenceExecuted: false }));
	return { ...result,
		...(retainedRepair && isRecord(result.requestTerminal) && result.requestTerminal.status === "suspended"
			? { text: retainedRepair.candidate as string } : {}),
		deliveryEvidence: { ...(isRecord(result.deliveryEvidence) ? result.deliveryEvidence : {}),
			...(retainedRepair ? { structuredOutputRepair: retainedRepair } : {}),
			structuredFailureObservation: { version: 1, code: "structured_output_invalid",
				candidateAvailability: retainedRepair ? "retained_checkpoint" : "unavailable",
				source: "exact_durable_turn" } } };
}

async function observeWorkflowAgentNodeFromDurableTurn(
	context: AppContext,
	request: WorkflowAgentRunRequest,
	publicTurnId: string,
	snapshot: AgentsChatTurnStatusSnapshot,
): Promise<WorkflowAgentRunResult> {
	const sessionKey = sessionKeyForWorkflowAgent(request);
	const turn = snapshot.turn;
	console.info(JSON.stringify({
		message: "workflow_agent_recovery_observation",
		executionId: request.executionId,
		nodeId: request.nodeId,
		publicTurnId,
		observedTurnId: turn?.turnId ?? null,
		physicalRetryOrdinal: workflowAgentPhysicalRetryOrdinal(request),
		activeTurn: snapshot.activeTurn,
		state: turn?.state ?? null,
		reasonCode: turn?.reasonCode ?? null,
		hasRecoveryCheckpoint: Boolean(turn?.recoveryCheckpoint),
	}));
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
		const ordinal = workflowAgentPhysicalRetryOrdinal(request);
		const observedOrdinal = workflowAgentTurnOrdinal({
			executionId: request.executionId,
			nodeId: request.nodeId,
			observedTurnId: turn.turnId,
		});
		if (ordinal !== null && observedOrdinal !== null && observedOrdinal > ordinal) {
			// The durable session is now owned by a newer physical generation. The
			// old reconciler must not fence or repost it: doing so creates two model
			// calls against one retained checkpoint and is the source of orphaned
			// retries that keep a Workflow node alive without advancing it.
			const recoveryWindow = previousRecoveryWindow(request.previousEvidence);
			return waitingAgentResult({
				request,
				publicTurnId,
				sessionKey,
				turn,
				...(recoveryWindow ? { recoveryWindow } : {}),
				reason: "workflow_agent_newer_physical_owner_active",
			});
		}
		const predecessorOrdinal = ordinal !== null ? previousWorkflowAgentTurnOrdinal({
			executionId: request.executionId, nodeId: request.nodeId,
			currentOrdinal: ordinal, observedTurnId: turn.turnId,
		}) : null;
		if (predecessorOrdinal !== null) {
			// The stable session can still expose its previous generation before
			// the new turn's admission. Normal submission fences that exact turn
			// and admits the requested idempotent public identity with its checkpoint.
			const fence = await fencePreviousWorkflowAgentPhysicalGeneration(context.env, request, publicTurnId, ordinal!, predecessorOrdinal);
			if (!fence.fenced) return waitingWorkflowAgentGenerationFenceResult({
				request, currentPublicTurnId: publicTurnId, previousPublicTurnId: fence.previousPublicTurnId,
				physicalRetryOrdinal: ordinal!, physicalFailureReason: "provider_stream_interrupted", fenceErrorCode: fence.errorCode,
			});
			const admission = await getExecutionTraceLifecycleSnapshot(context.env.DB, {
				traceId: publicTurnId,
				userId: request.ownerId,
			});
			if (admission?.logicalTaskId === publicTurnId && admission.rootTraceId === publicTurnId) {
				// An older session projection does not revoke immutable admission.
				// Never repost an accepted identity: reconcile the handoff, then use
				// the existing physical-retry ledger if its projection was lost.
				if ((admission.status === "running" || admission.status === "waiting_async")
					&& isFreshWorkflowAgentAdmissionTimestamp(admission.updatedAt)) {
					return waitingAcceptedWorkflowTurnProjectionResult({
						request, publicTurnId, sessionKey,
						traceStartedAt: admission.startedAt, traceUpdatedAt: admission.updatedAt,
						traceStatus: admission.status,
					});
				}
				return retryWorkflowAgentMissingDurableTurn({
					request, publicTurnId, sessionKey,
					traceStatus: admission.status, traceUpdatedAt: admission.updatedAt,
				});
			}
			return runFreshWorkflowAgentAttempt(context.env, request, publicTurnId);
		}
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
		if (isStaleInterruptedWorkflowAgentTurn(request.previousEvidence)) {
			return retryWorkflowAgentPhysicalRun({
				request,
				publicTurnId,
				sessionKey,
				turn,
				failureReason: "provider_stream_interrupted",
			});
		}
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
	// A provider rejection has no accepted candidate to resume. Its structured
	// receipt can be projected as either a failed or suspended physical turn;
	// both need a fenced, same-model replan instead of an unowned wait.
	if (
		(turn.state === "failed" || turn.state === "suspended")
		&& (turn.reasonCode === "provider_response_rejected"
			|| turn.reasonCode === "llm_provider_response_failed")
		&& workflowAgentProviderRecoveryEvidence(request.previousEvidence)
	) {
		return retryWorkflowAgentPhysicalRun({
			request,
			publicTurnId,
			sessionKey,
			turn,
			failureReason: "workflow_agent_provider_replan_required",
		});
	}
	if (
		turn.state === "suspended"
		|| (turn.state === "failed"
			&& turn.recoveryCheckpoint != null
			&& turn.suspension?.physicalRunId === turn.recoveryCheckpoint.physicalRunId)
	) {
		// A matching durable physical suspension remains a continuation even if
		// a transport finalizer recorded a failed physical checkpoint.
		// Provider balance is an external deterministic boundary, not an
		// ineffective recovery window. agents-cli may legitimately preserve a
		// recovery checkpoint beside this suspension so the exact typed-output
		// frontier can continue after the account is funded. Never let the mere
		// presence of that checkpoint route balance wait through same-request
		// resume or the no-progress counter.
		if (turn.reasonCode === "provider_balance_required") {
			if (request.failurePolicy === "single_submission") {
				return retryWorkflowAgentPhysicalRun({ request, publicTurnId, sessionKey, turn,
					failureReason: "provider_balance_required" });
			}
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
				if (resumeOutcome === "ownership_changed") {
					const result = waitingAgentResult({ request, publicTurnId, sessionKey, turn,
						reason: "workflow_agent_resume_ownership_changed" });
					return { ...result, deliveryEvidence: { ...result.deliveryEvidence,
						reconciliationFailure: { action: "resume", code: agentsBridgeErrorCode(error) } } };
				}
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
			&& resolveWorkflowAgentPhysicalContinuationReason(turn.reasonCode) !== null
		) {
			return retryWorkflowAgentPhysicalRun({
				request,
				publicTurnId,
				sessionKey,
				turn,
				failureReason: resolveWorkflowAgentPhysicalContinuationReason(turn.reasonCode)!,
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
	// A repairable typed Agent turn must never be projected as success merely
	// because its first physical run recorded an invalid candidate. Preserve the
	// exact durable evidence and open the normal physical retry path; the next
	// run reuses the same logical task/identity and lets agents-cli continue the
	// format-repair conversation without replaying side effects.
	if (
		turn.state === "failed"
		&& turn.reasonCode === "structured_output_invalid"
		&& request.outputEncoding !== "plain_text"
	) {
		return retryWorkflowAgentPhysicalRun({
			request,
			publicTurnId,
			sessionKey,
			turn,
			failureReason: "structured_output_invalid",
		});
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
		&& resolveWorkflowAgentPhysicalContinuationReason(turn.reasonCode) !== null
	) {
		return retryWorkflowAgentPhysicalRun({
			request,
			publicTurnId,
			sessionKey,
			turn,
			failureReason: resolveWorkflowAgentPhysicalContinuationReason(turn.reasonCode)!,
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
			if (resumeOutcome === "ownership_changed") {
				const result = waitingAgentResult({ request, publicTurnId, sessionKey, turn,
					reason: "workflow_agent_resume_ownership_changed" });
				return { ...result, deliveryEvidence: { ...result.deliveryEvidence,
					reconciliationFailure: { action: "resume", code: agentsBridgeErrorCode(error) } } };
			}
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
	const outputRepair = readWorkflowAgentOutputRepair(request.previousEvidence);
	if (outputRepair?.sourceTurnId === publicTurnId) {
		return retryWorkflowAgentPhysicalRun({
			request, publicTurnId, sessionKey, turn,
			failureReason: "structured_output_invalid",
		});
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
		if (request.initialRecovery && !request.resumeOnly) {
			if (request.initialRecovery.nodeId !== request.nodeId || request.initialRecovery.sourceExecutionId === request.executionId) {
				throw new Error("workflow_agent_initial_recovery_scope_invalid");
			}
			const sessionKey = sessionKeyForWorkflowAgent(request);
			const snapshot = await getAgentsChatTurnStatus(context, request.ownerId, sessionKey,
				{ timeoutMs: WORKFLOW_AGENT_STATUS_DEADLINE_MS, includeStructuredOutputRepair: true });
			const admission = await getExecutionTraceLifecycleSnapshot(env.DB, { traceId: publicTurnId, userId: request.ownerId });
			console.info(JSON.stringify({ message: "workflow_agent_initial_recovery_admission",
				executionId: request.executionId, nodeId: request.nodeId, publicTurnId,
				sourceExecutionId: request.initialRecovery.sourceExecutionId,
				sourceNodeRunId: request.initialRecovery.sourceNodeRunId,
				observedTurnId: snapshot.turn?.turnId ?? null, traceStatus: admission?.status ?? null,
				candidateAvailability: "unavailable", action: snapshot.turn || admission ? "reconcile" : "admit_frozen_attempt" }));
			if (snapshot.turn || admission) return await recoverWorkflowAgentNodeFromDurableTurn(context, request, publicTurnId, snapshot);
		}
		// A queued retry is an observation of an earlier failure, not authority
		// to discard a response that settled afterward. Reconcile immutable exact
		// predecessors even when the shared session already belongs to a successor.
		const ordinal = workflowAgentPhysicalRetryOrdinal(request);
		if (request.resumeOnly && ordinal !== null && !readWorkflowAgentOutputRepair(request.previousEvidence)
			&& !normalizeAuthorRevisionEvidence(request.authorRepair)) {
			const previousPublicTurnIds = Array.from({ length: ordinal }, (_, previousOrdinal) => workflowAgentPublicTurnId({
				executionId: request.executionId, nodeId: request.nodeId, physicalRetryOrdinal: previousOrdinal || null }));
			const settled = await readWorkflowAgentSettledResult(env.DB, { ownerId: request.ownerId,
				sessionKey: sessionKeyForWorkflowAgent(request), publicTurnIds: previousPublicTurnIds,
				outputContract: workflowAgentStructuredOutput(request)?.outputContract ?? null });
			if (settled) {
				const current = await getAgentsChatTurnStatus(context, request.ownerId, sessionKeyForWorkflowAgent(request),
					{ timeoutMs: WORKFLOW_AGENT_STATUS_DEADLINE_MS });
				if (current.activeTurn && current.turn) {
					// Do not declare this node finished while an accepted successor can
					// still produce actions. Its exact owner must settle or be explicitly
					// interrupted before the immutable predecessor can be reconciled.
					return waitingAgentResult({ request, publicTurnId, sessionKey: sessionKeyForWorkflowAgent(request),
						turn: current.turn, reason: "workflow_agent_successor_still_running" });
				}
				const result = unwrapWorkflowAgentTransportEnvelope(request, normalizeWorkflowAgentOutcome({
					id: settled.publicTurnId, assets: [], raw: { text: settled.text, meta: settled.meta },
				}));
				console.info(JSON.stringify({ message: "workflow_agent_settled_predecessor_reconciled",
					executionId: request.executionId, nodeId: request.nodeId, requestedPublicTurnId: publicTurnId,
					settledPublicTurnId: settled.publicTurnId, traceId: settled.traceId,
					candidateCharacters: settled.text.length, authorInferenceExecuted: false }));
				return { ...result, deliveryEvidence: {
					...(isRecord(result.deliveryEvidence) ? result.deliveryEvidence : {}),
					sessionKey: sessionKeyForWorkflowAgent(request), logicalTaskId: settled.publicTurnId,
					source: "immutable_settled_workflow_agent_result", settledTraceId: settled.traceId,
					physicalRetryOrdinal: workflowAgentTurnOrdinal({ executionId: request.executionId, nodeId: request.nodeId, observedTurnId: settled.publicTurnId }) || null,
				} };
			}
		}
		if (request.resumeOnly) {
			if (physicalRetryEvidence) {
				// A candidate submission policy limits the physical submission, not
				// same-task correction of a structurally rejected candidate.
				if (request.failurePolicy === "single_submission"
					&& !workflowAgentFailureCanContinue(request, physicalRetryEvidence.reason)) {
					return { taskId: publicTurnId, text: "", assets: [],
						expectedDelivery: workflowAgentExpectedDelivery(request),
						deliveryEvidence: { ...physicalRetryEvidence.evidence, retryablePhysicalFailure: false,
							failurePolicy: "single_submission" },
						deliveryVerification: null,
						requestTerminal: { status: "failed", reason: physicalRetryEvidence.reason } };
				}
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
		let interruptionError = error;
		if (agentsBridgeErrorCode(error) === "structured_output_invalid" && request.outputEncoding !== "plain_text") {
			try {
				return await recoverWorkflowAgentNodeFromDurableTurn(context, request, publicTurnId);
			} catch (recoveryError: unknown) {
				interruptionError = recoveryError;
			}
		}
		if (error instanceof AppError && error.code === "agents_chat_turn_already_exists") {
			try {
				return await recoverWorkflowAgentNodeFromDurableTurn(context, request, publicTurnId);
			} catch (recoveryError: unknown) {
				interruptionError = recoveryError;
			}
		}
		if (interruptionError instanceof WorkflowAgentRepairSourceMismatchError) {
			console.warn(JSON.stringify({ message: "workflow_agent_repair_source_mismatch",
				executionId: request.executionId, nodeId: request.nodeId, publicTurnId,
				...interruptionError.diagnostics }));
		}
		if (!isRecoverableWorkflowAgentInterruption(interruptionError)) throw interruptionError;
		const interrupted = interruptedAgentResult(request, publicTurnId, interruptionError);
		return agentsBridgeErrorCode(error) === "structured_output_invalid" ? { ...interrupted,
			deliveryEvidence: { ...(isRecord(interrupted.deliveryEvidence) ? interrupted.deliveryEvidence : {}),
				structuredFailureObservation: { version: 1, code: "structured_output_invalid",
					candidateAvailability: "observation_failed", source: "exact_durable_turn",
					observationErrorCode: agentsBridgeErrorCode(interruptionError) } } } : interrupted;
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

function workflowAgentStructuredSourceFacts(request: WorkflowAgentRunRequest,
	inputs = workflowAgentPromptInputs(request)) {
	return { inputs, userIntentContract: request.userIntentContract ?? null,
		projectContext: request.projectContext
			? workflowAgentProjectContextPromptFacts(request.projectContext, request.outputArtifactType, request.projectContextPromptMode) : null };
}

function workflowAgentStructuredSourceContext(request: WorkflowAgentRunRequest): string {
	return JSON.stringify(workflowAgentStructuredSourceFacts(request));
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
	frozenRequest: WorkflowAgentRunRequest,
	publicTurnId: string,
): Promise<WorkflowAgentRunResult> {
	const preferenceReceipt = await readWorkflowAgentPreferences(env.DB, {
		executionId: frozenRequest.executionId,
		nodeId: frozenRequest.nodeId,
		ownerId: frozenRequest.ownerId,
	});
	const request: WorkflowAgentRunRequest = preferenceReceipt
		? { ...frozenRequest, ...preferenceReceipt.preferences }
		: frozenRequest;
	if (preferenceReceipt) console.info(JSON.stringify({
		message: "workflow_agent_preferences_applied",
		executionId: request.executionId, nodeId: request.nodeId, publicTurnId,
		modelKey: request.modelKey, preferences: preferenceReceipt.preferences,
		preferenceScope: preferenceReceipt.nodeId === null ? "execution" : "node",
		idempotencyKey: preferenceReceipt.idempotencyKey,
	}));
	const context = createInternalWorkflowContext(env, request, publicTurnId);
	const structuredOutput = workflowAgentStructuredOutput(request);
	if (request.structuredOutputTokenBudget !== undefined
		&& (!Number.isInteger(request.structuredOutputTokenBudget)
			|| request.structuredOutputTokenBudget < WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN
			|| request.structuredOutputTokenBudget > WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX)) {
		throw new Error(`structuredOutputTokenBudget must be between ${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN} and ${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX}`);
	}
	// Large structured artifacts retain the protocol maximum unless their node
	// declares a smaller physical inference budget. A compact budget bounds one
	// provider action; typed-output repair and durable continuation still belong
	// to the same logical task.
	const attemptMaxOutputTokens = structuredOutput
		? request.structuredOutputTokenBudget ?? WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX
		: request.maxOutputTokens;
	const promptInputsForValidation = workflowAgentPromptInputs(request);
	const sourceScopePromptProjection = projectFrozenSourceScopePromptInputs(promptInputsForValidation);
	if (sourceScopePromptProjection.observedSourceFacts) {
		console.info(JSON.stringify({
			message: "workflow_agent_source_scope_prompt_projection",
			executionId: request.executionId,
			nodeId: request.nodeId,
			status: sourceScopePromptProjection.status,
			reason: sourceScopePromptProjection.reason,
			segmentPort: sourceScopePromptProjection.segmentPort,
			sequencePort: sourceScopePromptProjection.sequencePort,
			sourceCount: sourceScopePromptProjection.sourceCount,
			removedSourceBodyCount: sourceScopePromptProjection.removedSourceBodyCount,
			removedQuotedUnitCount: sourceScopePromptProjection.removedQuotedUnitCount,
			inputCharactersBefore: sourceScopePromptProjection.inputCharactersBefore,
			inputCharactersAfter: sourceScopePromptProjection.inputCharactersAfter,
			inputCharactersSaved: sourceScopePromptProjection.inputCharactersBefore - sourceScopePromptProjection.inputCharactersAfter,
		}));
	}
	const effectiveRequiredSkills: readonly string[] = request.requiredSkills;
	// Preserve explicit upstream knowledge consumption across workflow stages.
	// The previous implementation unconditionally erased this list, so a card
	// read by text expansion/BeatSheet was invisible to Clip Writer and had to be
	// rediscovered (or was silently not consumed at all).
	const effectiveMountedKnowledgeCardIds: readonly string[] = request.mountedKnowledgeCardIds;
	const effectiveAllowedTools = request.allowedTools;
	const requestInput: AgentsChatRequestDto & { prompt: string } = {
		prompt: [workflowAgentPrompt(request, sourceScopePromptProjection), ...(request.productionStartDeadline ? [
			`生产启动时间目标（仅事实诊断，不是动作截止或任务终止条件）：${JSON.stringify({ ...request.productionStartDeadline, blocking: false })}`,
		] : [])].join("\n\n"),
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
		...(request.outputArtifactType ? { outputArtifactType: request.outputArtifactType } : {}),
		...(request.performanceModes?.length ? { performanceModes: distinctPerformanceModes(request.performanceModes) } : {}),
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
	if (request.disableRoleSkillBundle === true) {
		taskRequest.extras = { ...taskRequest.extras, disableRoleSkillBundle: true };
	}
	const outputRepair = readWorkflowAgentOutputRepair(request.previousEvidence);
	const authorRepair = normalizeAuthorRevisionEvidence(request.authorRepair);
	if (authorRepair && (authorRepair.targetNodeId !== request.nodeId || !structuredOutput)) {
		throw new Error("workflow_author_repair_target_contract_invalid");
	}
	const providerRecoveryEvidence = workflowAgentProviderRecoveryEvidence(request.previousEvidence);
	const priorDeliveryEvidence = previousAgentDeliveryEvidence(request.previousEvidence);
	const taskRepairEvidence = projectWorkflowPhysicalFailureRepairEvidence(priorDeliveryEvidence);
	// Structured-output validation and repair binding retain the established
	// prompt-input projection; only the model-facing prompt receives the exact
	// frozen-source scope reduction above.
	const projectedPromptInputs = promptInputsForValidation;
	const structuredOutputSourceFacts = workflowAgentStructuredSourceFacts(request, projectedPromptInputs);
	let structuredOutputSourceContext = JSON.stringify(structuredOutputSourceFacts);
	const { projections: candidateReadProjections, unreferencedCandidateSets } = collectWorkflowCandidateProjections(structuredOutputSourceFacts.inputs, request);
	const inputReadProjection = collectWorkflowInputReadProjections(
		compactWorkflowPromptFacts(sourceScopePromptProjection.inputs, request),
		request,
		{ excludedSources: candidateReadProjections.map((projection) => projection.source) },
	);
	const contextReadProjections = [...candidateReadProjections, ...inputReadProjection.projections];
	console.info(JSON.stringify({
		message: "workflow_agent_input_read_projection",
		executionId: request.executionId,
		nodeId: request.nodeId,
		...inputReadProjection.diagnostics,
	}));
	let retainedRepair: Record<string, unknown> | null = null;
	if (isRecord(priorDeliveryEvidence?.structuredOutputRepair)) {
		if (!structuredOutput) throw new Error("workflow_agent_structured_repair_contract_missing");
		retainedRepair = verifyWorkflowAgentRepairHandoff({ checkpoint: priorDeliveryEvidence.structuredOutputRepair,
			sourceContext: structuredOutputSourceContext });
	}
	if (authorRepair) {
		console.info(JSON.stringify({
			message: "workflow_agent_author_revision_evidence_bound", executionId: request.executionId,
			nodeId: request.nodeId, sourceExecutionId: authorRepair.sourceExecutionId,
			sourceNodeRunId: authorRepair.sourceNodeRunId, sourceKind: authorRepair.sourceKind,
			deliveryHash: authorRepair.deliveryHash, deliveryCharacters: authorRepair.deliveryArtifact.length,
			diagnosticCharacters: authorRepair.diagnostic.length,
			blocking: false,
		}));
	}
	const repairSource = request.previousEvidence?.agentRepairSource;
	if (isRecord(repairSource)) {
		if (!structuredOutput || typeof repairSource.sessionKey !== "string" || typeof repairSource.turnId !== "string") {
			throw new Error("workflow_agent_repair_source_invalid");
		}
		const snapshot = await getAgentsChatTurnStatus(context, request.ownerId, repairSource.sessionKey,
			{ timeoutMs: WORKFLOW_AGENT_STATUS_DEADLINE_MS, includeStructuredOutputRepair: true });
		if (snapshot.activeTurn) {
			throw new Error("workflow_agent_repair_source_owner_changed");
		}
		if (snapshot.structuredOutputRepair) {
			// Physical retries share this exact durable session. A newer inactive
			// turn may own its latest draft; source and contract fences below bind
			// the candidate, not the scheduler's previous physical turn counter.
			retainedRepair = verifyWorkflowAgentRepairHandoff({ checkpoint: snapshot.structuredOutputRepair,
				sourceContext: structuredOutputSourceContext });
		} else if (!retainedRepair && !outputRepair) {
			console.info(JSON.stringify({
				message: "workflow_agent_repair_handoff_no_draft", executionId: request.executionId,
				nodeId: request.nodeId, sourceSessionKey: repairSource.sessionKey,
				receiptTurnId: repairSource.turnId, observedTurnId: snapshot.turn?.turnId ?? null,
				reason: "inactive_execution_checkpoint_has_no_structured_candidate",
			}));
		}
	}
	if (retainedRepair && typeof retainedRepair.sourceContext === "string") {
		// Storage may reorder JSON object keys. The handoff proved the source
		// facts equal; retain the original bytes for downstream checkpoint and
		// provider-recovery identity instead of rebinding the retained draft.
		if (structuredOutputSourceContext !== retainedRepair.sourceContext) {
			console.info(JSON.stringify({ message: "workflow_agent_repair_source_encoding_preserved",
				executionId: request.executionId, nodeId: request.nodeId, publicTurnId,
				identity: "equal_json_facts", candidateCharacters: String(retainedRepair.candidate).length,
				sourceHash: `sha256:${createHash("sha256").update(retainedRepair.sourceContext).digest("hex")}` }));
		}
		structuredOutputSourceContext = retainedRepair.sourceContext;
	}
	if (outputRepair) {
		// The host rejected this exact candidate after runtime schema acceptance.
		// Older runtime checkpoints may retain paid review state, but cannot replace
		// its current verifier correction or turn it back into a successful cache.
		const authorSelfCheck = retainedRepair?.authorSelfCheck;
		retainedRepair = {
			version: 1, candidate: outputRepair.candidate, correction: outputRepair.error,
			verifierCorrectionPending: true,
			sourceContext: structuredOutputSourceContext,
			...(isRecord(authorSelfCheck) ? { authorSelfCheck } : {}),
		};
		console.info(JSON.stringify({ message: "workflow_agent_host_verifier_correction_bound",
			executionId: request.executionId, nodeId: request.nodeId, sourceTurnId: outputRepair.sourceTurnId,
			candidateCharacters: outputRepair.candidate.length, verifierCorrectionPending: true,
			paidReviewStateRetained: isRecord(authorSelfCheck) }));
	}

	if (structuredOutput || contextReadProjections.length > 0 || unreferencedCandidateSets > 0) {
		console.info(JSON.stringify({
			message: "workflow_agent_context_volume", executionId: request.executionId, nodeId: request.nodeId,
			promptCharacters: requestInput.prompt.length,
			frozenSourceCharacters: structuredOutputSourceContext.length,
			candidateReferenceCount: candidateReadProjections.length,
			inputReferenceCount: inputReadProjection.projections.length,
			unreferencedCandidateSets,
			projectionOwner: "final_model_tool_surface",
			inputCharactersByPort: Object.fromEntries(Object.entries(projectedPromptInputs).map(([port, values]) => [port, JSON.stringify(values).length])),
			retainedCandidateCharacters: typeof retainedRepair?.candidate === "string" ? retainedRepair.candidate.length : 0,
		}));
	}
	Object.assign(taskRequest.extras as Record<string, unknown>, {
		publicTurnId,
		logicalTaskId: publicTurnId,
		workflowExecutionFamilyId: request.executionFamilyId,
		...(request.logicalTaskBudgetRootId ? { logicalTaskBudgetRootId: request.logicalTaskBudgetRootId } : {}),
		maxOutputTokens: attemptMaxOutputTokens,
		requestedMaxOutputTokens: request.maxOutputTokens,
		...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
		...(request.serviceTier ? { serviceTier: request.serviceTier } : {}),
		workflowKey: request.workflowKey ?? "agent-workflow/v1",
		retrievalUserRequest: workflowAgentRetrievalUserRequest(request),
		retrievalContext: workflowAgentRetrievalContext(request),
		disabledSkills: [],
		mountedKnowledgeCardIds: [...effectiveMountedKnowledgeCardIds],
		disabledKnowledgeCardIds: [],
		diagnosticsLabel: `workflow-node:${request.nodeId}`,
		structuredOutputSubmissionPolicy: request.failurePolicy === "single_submission"
			? WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY : WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY,
		contextReadProjections,
		...(structuredOutput ? { structuredOutputSourceContext } : {}),
		...(structuredOutput && workflowAgentPhysicalRetryOrdinal(request) !== null ? { resumeStructuredOutput: true } : {}),
		...(retainedRepair ? { structuredOutputRepair: retainedRepair } : {}),
		...(authorRepair ? { runtimeAuthorRevisionEvidence: authorRepair } : {}),
		...(providerRecoveryEvidence ? { providerResponseRejection: providerRecoveryEvidence } : {}),
		...(taskRepairEvidence ? { taskRepairEvidence } : {}),
		...(request.promptExampleRetrievalScope
			? { promptExampleRetrievalScope: request.promptExampleRetrievalScope }
			: {}),
		...(structuredOutput ?? {}),
		continuationExecutionContract: {
			contextReadProjections,
			...(structuredOutput ? { structuredOutputSourceContext, resumeStructuredOutput: true } : {}),
			...(retainedRepair ? { structuredOutputRepair: retainedRepair } : {}),
			...(authorRepair ? { runtimeAuthorRevisionEvidence: authorRepair } : {}),
			...(providerRecoveryEvidence ? { providerResponseRejection: providerRecoveryEvidence } : {}),
			...(taskRepairEvidence ? { taskRepairEvidence } : {}),
			workflowExecutionFamilyId: request.executionFamilyId,
			...(request.logicalTaskBudgetRootId ? { logicalTaskBudgetRootId: request.logicalTaskBudgetRootId } : {}),
			version: 1,
			directForcedAgentExecution: true,
			structuredOutputSubmissionPolicy: request.failurePolicy === "single_submission"
				? WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY : WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY,
			maxOutputTokens: attemptMaxOutputTokens,
			requestedMaxOutputTokens: request.maxOutputTokens,
			...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
			...(request.serviceTier ? { serviceTier: request.serviceTier } : {}),
			retrievalUserRequest: workflowAgentRetrievalUserRequest(request),
			retrievalContext: workflowAgentRetrievalContext(request),
			disabledSkills: [],
			mountedKnowledgeCardIds: [...effectiveMountedKnowledgeCardIds],
			disabledKnowledgeCardIds: [],
			...(structuredOutput ?? {}),
		},
	});
	const activityReporter = request.onAgentActivity
		? createWorkflowAgentActivityReporter({
			write: request.onAgentActivity,
			onWriteError: (error, activity) => {
				console.warn(JSON.stringify({
					message: "workflow_agent_activity_projection_write_failed",
					executionId: request.executionId,
					nodeId: request.nodeId,
					publicTurnId,
					eventType: activity.eventType,
					errorName: error instanceof Error ? error.name : "unknown",
				}));
			},
			onProjectionError: (error, event) => {
				console.warn(JSON.stringify({
					message: "workflow_agent_activity_projection_invalid_event",
					executionId: request.executionId,
					nodeId: request.nodeId,
					publicTurnId,
					eventType: event.event,
					errorName: error instanceof Error ? error.name : "unknown",
				}));
			},
			...(request.agentActivityContext ? { context: request.agentActivityContext } : {}),
		})
		: null;
	let persisted: Awaited<ReturnType<typeof runPersistedAgentsChatTask>>;
	try {
		persisted = await runPersistedAgentsChatTask({
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
			...(activityReporter ? { onStreamEvent: (event) => activityReporter.observe(event) } : {}),
		});
	} finally {
		// Best-effort telemetry is flushed after the Agent turn has settled. Its
		// writer absorbs failures and never changes the model/tool execution result.
		await activityReporter?.flush();
	}
	const transportResult = attachWorkflowTurnIdentity(
		unwrapWorkflowAgentTransportEnvelope(request, normalizeWorkflowAgentOutcome(persisted.result)),
		request,
		publicTurnId,
	);
	const requestTerminal = isRecord(transportResult.requestTerminal)
		? transportResult.requestTerminal
		: null;
	const freshProviderRecoveryEvidence = workflowAgentProviderRecoveryEvidenceFromResult(transportResult);
	if (request.failurePolicy !== "single_submission" &&
		freshProviderRecoveryEvidence
		&& (requestTerminal?.status === "failed" || requestTerminal?.status === "suspended")
	) {
		// A provider rejection closes only this physical response. Preserve its
		// structured receipt while handing the logical Workflow task back to the
		// durable recovery path; otherwise the bridge's failed transport state is
		// mistaken for a user-level terminal failure before the node executor sees it.
		return {
			...transportResult,
			deliveryEvidence: {
				...(isRecord(transportResult.deliveryEvidence) ? transportResult.deliveryEvidence : {}),
				recoveryMode: "agent_replan",
				providerResponseRejection: freshProviderRecoveryEvidence,
				retryablePhysicalFailure: false,
				physicalFailureReason: "workflow_agent_provider_replan_required",
			},
			requestTerminal: {
				version: 1,
				terminal: true,
				status: "suspended",
				reason: "provider_response_rejected",
			},
		};
	}
	const recoverablePhysicalFailure = requestTerminal?.status === "failed"
		&& resolveWorkflowAgentPhysicalContinuationReason(requestTerminal.reason) !== null;
	if (requestTerminal?.status !== "suspended" && !recoverablePhysicalFailure) return transportResult;

	// The HTTP result is only the transport projection of the physical Agent
	// window.  A suspended Workflow Agent is owned by its durable turn, whose
	// checkpoint may carry a more precise external boundary than the response
	// envelope (for example provider_balance_required).  Re-read that authority
	// before publishing node evidence so the queue cannot mistake an external
	// dependency wait for a retryable provider interruption and replay the same
	// model several times.
	const recovered = await recoverWorkflowAgentNodeFromDurableTurn(context, request, publicTurnId);
	return recoverablePhysicalFailure ? {
		...recovered,
		deliveryEvidence: {
			...(isRecord(recovered.deliveryEvidence) ? recovered.deliveryEvidence : {}),
			physicalFailureObservation: {
				requestTerminal: transportResult.requestTerminal,
				...(transportResult.structuredOutputFailure ? { structuredOutputFailure: transportResult.structuredOutputFailure } : {}),
			},
		},
	} : recovered;
}
