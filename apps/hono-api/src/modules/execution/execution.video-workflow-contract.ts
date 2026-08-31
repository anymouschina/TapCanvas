import {
	createWorkflowCollection,
	isWorkflowCollection,
	type WorkflowCollectionV1,
} from "@tapcanvas/workflow-kernel-protocol";
import {
	compileStructuredClipForExecution,
	type StructuredClip,
} from "../task/video-orchestrator.clip-shots";
import {
	compileShotSpeechEventReferences,
	materializeWriterSpeechEvents,
	projectWriterSpeechStructure,
} from "../task/video-orchestrator.dialogue-materialization";
import { validateShotDialogueConservation } from "../task/video-orchestrator.dialogue-conservation";
import {
	collectSpokenSpeakerNames,
	combineSpokenScript,
	parseNarrativeAudioPlan,
	validateNarrativeAudioPlacement,
	type SpokenScriptLine,
} from "../task/video-orchestrator.spoken-script";
import { readClipSpeakerBindings } from "../task/video-orchestrator.speaker-contract";
import {
	compileTemporalFrameContract,
	parseTemporalFrameTrack,
	validateTemporalFrameCoverage,
} from "../task/video-orchestrator.temporal-frame-track";
import {
	ASSET_OBJECT_KINDS,
	ASSET_REFERENCE_ROLES,
	parseAssetObjectContracts,
	requiresAuthoringVisualReference,
	type AssetObjectContract,
	type AssetObjectKind,
	type AssetReferenceRole,
} from "../task/video-orchestrator.asset-object-contract";
import { resolveVideoProviderDurationTopology } from "../task/video-orchestrator.provider-submission-topology";
import { parseVideoGenerationContract } from "../task/video-orchestrator.generation-contract";
import {
	assertExactWorkflowClipAssetObjectContracts,
	bindWorkflowClipAssetObjectContracts,
	parseWorkflowClipAssetObjectContracts,
	workflowVisualAssetRole,
	validateWorkflowBeatObjectContinuity,
	validateWorkflowSourceEventCoverage,
	type WorkflowClipAssetObjectContract,
} from "./execution.video-workflow-continuity";
import {
	createWorkflowArtifactContract,
	WorkflowInputContractError,
} from "./execution.input-contract";

type JsonRecord = Record<string, unknown>;

export const WORKFLOW_VIDEO_REFERENCE_POLICY = "forbidden" as const;

/**
 * The equipped workflow is image-reference-only. This deterministic provider
 * boundary inspects declared protocol fields, never prompt prose or story
 * semantics.
 */
export function assertWorkflowVideoReferencePolicy(value: unknown, field: string): void {
	if (!isRecord(value)) throw new Error(`${field} must be an object`);
	if (value.videoReferencePolicy !== WORKFLOW_VIDEO_REFERENCE_POLICY) {
		throw new Error(`${field}.videoReferencePolicy must equal ${WORKFLOW_VIDEO_REFERENCE_POLICY}`);
	}
	for (const forbiddenField of [
		"referenceVideoUrl",
		"sourceVideoUrl",
		"upstreamVideoUrl",
		"referenceVideoDurationSeconds",
	] as const) {
		if (Object.prototype.hasOwnProperty.call(value, forbiddenField)) {
			throw new Error(`${field}.${forbiddenField} is forbidden by the workflow video-reference policy`);
		}
	}
}

export function assertWorkflowVideoProductionPlanReferencePolicy(
	value: WorkflowCollectionV1,
	field: string,
): void {
	for (const [index, item] of value.items.entries()) {
		assertWorkflowVideoReferencePolicy(item.value, `${field}.items[${index}].value`);
	}
}

export type WorkflowCanvasGroupFacts = Readonly<{
	flowId: string;
	groupId: string;
	group: JsonRecord;
	children: readonly JsonRecord[];
}>;

export type WorkflowCanvasProjectContextFacts = Readonly<{
	sourceMode: "project_context";
	flowId: string;
	sourceNodeIds: readonly string[];
	nodes: readonly JsonRecord[];
	authoritativeSources?: readonly JsonRecord[];
	userRequest?: Readonly<{
		kind: "public_chat_turn";
		requestId: string;
		content: string;
		requestFingerprint: string;
	}>;
}>;

export type WorkflowVideoDurationPlan = Readonly<{
	targetDurationSeconds: number | null;
	modelKey: string;
	durationOptions: readonly number[];
	maxDurationSeconds: number;
	providerSubmissionTopology?: Readonly<{
		targetDurationSeconds: number;
		expectedClipCount: number;
		minimumClipDurations: readonly number[];
		source: "user_clip_durations" | "user_clip_count" | "model_max_duration";
	}>;
}>;

export const WORKFLOW_VIDEO_DURATION_PLAN_TRIGGER_FIELD = "workflowVideoDurationPlan";

export type FrozenWorkflowVideoDurationPlan = Omit<WorkflowVideoDurationPlan, "targetDurationSeconds"> & Readonly<{
	targetDurationSeconds: number;
	protocolVersion: "tapcanvas.workflow-video-duration-plan/v2";
	policy: "agent_semantic_duration_budget";
}>;

export type WorkflowVideoAssetPlan = Readonly<{
	assetId: string;
	role: string;
	/** User-facing object name projected from the frozen BeatSheet contract. */
	displayName?: string;
	prompt?: string;
	negativePrompt?: string;
	consumerClipIds: readonly string[];
	referenceType?: "character";
	roleName?: string;
	characterAssetRole?: "identity_anchor";
	characterProfileVersion?: "character-card/v3";
	identityAnchors?: readonly string[];
	prohibitedDrift?: readonly string[];
	/**
	 * 调用者项目已就绪资产的复用声明（系统级共享工作流跨项目调用时由
	 * asset-coverage 依据冻结 ProjectContext 填写）。新合同只要求稳定的
	 * existingAssetId + existingProjectId，执行节点再通过 Asset Resolver 解析资源。
	 * existingImageUrl 仅保留为旧快照兼容字段，不再要求 Agent 生成。
	 */
	existingImageUrl?: string;
	existingNodeId?: string;
	existingAssetId?: string;
	existingProjectId?: string;
}>;

type WorkflowReusableAssetContext = Readonly<{
	projectId: string;
	assetSnapshot: readonly Readonly<{
		assetId: string;
		projectId: string;
		canonicalName: string;
		mediaKind: string;
		state: string;
		productionEligible: boolean;
	}>[];
}>;

export type WorkflowPromptPackage = Readonly<{
	protocolVersion: "2";
	artifactType: "tapcanvas.prompt-package/v2";
	executionId: string;
	workflowKey: string;
	clips: readonly Readonly<{
		itemId: string;
		index: number;
		prompt: string;
		durationSeconds: number;
		declaredAssetIds: readonly string[];
		structuredClip: Readonly<Record<string, unknown>>;
		assetBindings: readonly WorkflowPromptAssetBinding[];
		authoringEvidence: Readonly<{
			selfQaNote?: string;
			creativeReview?: Readonly<{
				mode: "embedded_authoring";
				iterations: number;
				summary: string;
				narrativeAudioAssessment?: string;
			}>;
			sourceDialogueLineIds: readonly string[];
			spokenLineIds: readonly string[];
		}>;
		promptMetrics: Readonly<{
			writerEnvelopeCharacters: number;
			providerPromptCharacters: number;
			providerToEnvelopeRatio: number;
		}>;
		lineage: WorkflowCollectionV1["items"][number]["lineage"];
	}>[];
	deliveryEvidence: Readonly<{
		version: 2;
		source: "workflow_prompt_package";
		clipCount: number;
		totalDurationSeconds: number;
		sourceSpeechLineCount: number;
		narrativeSpeechLineCount: number;
		executableSpeechLineCount: number;
		assetBindingCount: number;
		embeddedAuthoringReviewCount: number;
		writerEnvelopeCharacters: number;
		providerPromptCharacters: number;
		providerToEnvelopeRatio: number;
	}>;
	deliveryVerification: Readonly<{
		version: 2;
		status: "satisfied";
		verifiedBy: "workflow_prompt_package_contract";
	}>;
}>;

export type WorkflowPromptAssetBinding = Readonly<{
	assetId: string;
	kind: AssetObjectKind;
	name: string;
	referenceRole: AssetReferenceRole;
}>;

export type WorkflowVoiceManifest = Readonly<{
	protocolVersion: "tapcanvas.voice-manifest/v1";
	entries: readonly Readonly<{
		speakerName: string;
		voiceId: string;
		voiceLabel: string;
		nodeId: string;
		audioUrl: string;
		audioDurationSec: number;
	}>[];
}>;

export function parseWorkflowVoiceManifest(value: unknown): WorkflowVoiceManifest {
	if (!isRecord(value) || value.protocolVersion !== "tapcanvas.voice-manifest/v1" || !Array.isArray(value.entries)) {
		throw new Error("voiceManifest must use tapcanvas.voice-manifest/v1 with an entries array");
	}
	const entries = value.entries.map((rawEntry, index) => {
		if (!isRecord(rawEntry)) throw new Error(`voiceManifest.entries[${index}] must be an object`);
		const speakerName = readString(rawEntry.speakerName);
		const voiceId = readString(rawEntry.voiceId);
		const voiceLabel = readString(rawEntry.voiceLabel);
		const nodeId = readString(rawEntry.nodeId);
		const audioUrl = readString(rawEntry.audioUrl);
		const audioDurationSec = rawEntry.audioDurationSec;
		if (!speakerName || !voiceId || !nodeId || !audioUrl || typeof audioDurationSec !== "number" || !Number.isFinite(audioDurationSec)) {
			throw new Error(`voiceManifest.entries[${index}] is incomplete`);
		}
		return { speakerName, voiceId, voiceLabel, nodeId, audioUrl, audioDurationSec };
	});
	if (new Set(entries.map((entry) => entry.speakerName)).size !== entries.length) {
		throw new Error("voiceManifest speaker names must be unique");
	}
	return { protocolVersion: "tapcanvas.voice-manifest/v1", entries };
}

export type WorkflowVoicePlan = Readonly<{
	protocolVersion: "tapcanvas.voice-plan/v1";
	entries: readonly Readonly<{
		speakerName: string;
		voiceId: string;
		rationale: string;
	}>[];
}>;

export type WorkflowVoiceCatalog = Readonly<{
	protocolVersion: "tapcanvas.voice-catalog/v1";
	speakers: readonly string[];
	existingBindings: readonly Readonly<{
		speakerName: string;
		voiceId: string;
		voiceLabel: string;
		nodeId: string;
		audioUrl: string;
		audioDurationSec: number;
	}>[];
	catalog: readonly Readonly<{
		id: string;
		name: string;
		gender: string;
		age: string;
		scene: string;
		description: string;
		emotions: readonly string[];
	}>[];
}>;

function parseJsonObjectArtifact(value: unknown, field: string): JsonRecord {
	const candidate = isRecord(value) && typeof value.text === "string" ? value.text : value;
	if (isRecord(candidate)) return candidate;
	if (typeof candidate !== "string") throw new Error(`${field} must be a JSON object artifact`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate) as unknown;
	} catch (error: unknown) {
		throw new Error(`${field} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed)) throw new Error(`${field} must decode to an object`);
	return parsed;
}

export function parseAndValidateWorkflowVoicePlan(input: Readonly<{
	voicePlan: unknown;
	voiceCatalog: WorkflowVoiceCatalog;
}>): WorkflowVoicePlan {
	const parsed = parseJsonObjectArtifact(input.voicePlan, "voicePlan");
	if (readString(parsed.protocolVersion) !== "tapcanvas.voice-plan/v1" || !Array.isArray(parsed.entries)) {
		throw new Error("voicePlan must use tapcanvas.voice-plan/v1 with an entries array");
	}
	const entries = parsed.entries.map((rawEntry, index) => {
		if (!isRecord(rawEntry)) throw new Error(`voicePlan.entries[${index}] must be an object`);
		const speakerName = readString(rawEntry.speakerName);
		const voiceId = readString(rawEntry.voiceId);
		const rationale = readString(rawEntry.rationale);
		if (!speakerName || !voiceId || !rationale) {
			throw new Error(`voicePlan.entries[${index}] requires speakerName, voiceId and rationale`);
		}
		return { speakerName, voiceId, rationale };
	});
	const expectedSpeakers = new Set(input.voiceCatalog.speakers);
	const actualSpeakers = new Set(entries.map((entry) => entry.speakerName));
	if (
		actualSpeakers.size !== entries.length
		|| actualSpeakers.size !== expectedSpeakers.size
		|| [...expectedSpeakers].some((speakerName) => !actualSpeakers.has(speakerName))
	) {
		throw new Error("voicePlan entries must correspond one-to-one with the frozen speaker set");
	}
	const catalogIds = new Set(input.voiceCatalog.catalog.map((voice) => voice.id));
	const existingBySpeaker = new Map(input.voiceCatalog.existingBindings.map((binding) => [binding.speakerName, binding] as const));
	for (const entry of entries) {
		const existing = existingBySpeaker.get(entry.speakerName);
		if (existing && entry.voiceId !== existing.voiceId) {
			throw new Error(`voicePlan must preserve existing voiceId for ${entry.speakerName}`);
		}
		if (!existing && !catalogIds.has(entry.voiceId)) {
			throw new Error(`voicePlan voiceId ${entry.voiceId} for ${entry.speakerName} is absent from the live catalog`);
		}
	}
	return { protocolVersion: "tapcanvas.voice-plan/v1", entries };
}

export function parseWorkflowVoiceCatalog(value: unknown): WorkflowVoiceCatalog {
	if (!isRecord(value) || value.protocolVersion !== "tapcanvas.voice-catalog/v1") {
		throw new Error("voiceCatalog must use tapcanvas.voice-catalog/v1");
	}
	if (!Array.isArray(value.speakers) || !Array.isArray(value.existingBindings) || !Array.isArray(value.catalog)) {
		throw new Error("voiceCatalog requires speakers, existingBindings and catalog arrays");
	}
	const speakers = value.speakers.map((speaker, index) => {
		const name = typeof speaker === "string" ? speaker.trim() : "";
		if (!name) throw new Error(`voiceCatalog.speakers[${index}] must be non-empty`);
		return name;
	});
	const existingBindings = value.existingBindings.map((rawBinding, index) => {
		if (!isRecord(rawBinding)) throw new Error(`voiceCatalog.existingBindings[${index}] must be an object`);
		const speakerName = readString(rawBinding.speakerName);
		const voiceId = readString(rawBinding.voiceId);
		const voiceLabel = readString(rawBinding.voiceLabel);
		const nodeId = readString(rawBinding.nodeId);
		const audioUrl = readString(rawBinding.audioUrl);
		const audioDurationSec = rawBinding.audioDurationSec;
		if (!speakerName || !voiceId || !nodeId || !audioUrl || typeof audioDurationSec !== "number" || !Number.isFinite(audioDurationSec)) {
			throw new Error(`voiceCatalog.existingBindings[${index}] is incomplete`);
		}
		return { speakerName, voiceId, voiceLabel, nodeId, audioUrl, audioDurationSec };
	});
	const catalog = value.catalog.map((rawVoice, index) => {
		if (!isRecord(rawVoice)) throw new Error(`voiceCatalog.catalog[${index}] must be an object`);
		const id = readString(rawVoice.id);
		const name = readString(rawVoice.name);
		if (!id || !name) throw new Error(`voiceCatalog.catalog[${index}] requires id and name`);
		return {
			id,
			name,
			gender: readString(rawVoice.gender),
			age: readString(rawVoice.age),
			scene: readString(rawVoice.scene),
			description: readString(rawVoice.description),
			emotions: Array.isArray(rawVoice.emotions)
				? rawVoice.emotions.filter((emotion): emotion is string => typeof emotion === "string" && emotion.trim().length > 0)
				: [],
		};
	});
	if (new Set(speakers).size !== speakers.length) throw new Error("voiceCatalog speakers must be unique");
	return { protocolVersion: "tapcanvas.voice-catalog/v1", speakers, existingBindings, catalog };
}

export type WorkflowPromptPackageAdmission = Readonly<{
	structurallyValid: boolean;
	issues: readonly string[];
	diagnostics: Readonly<{
		clipCount: number;
		deliveryVerificationStatus: string | null;
		embeddedAuthoringReviewCount: number | null;
		embeddedAuthoringReviewComplete: boolean | null;
	}>;
}>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Paid execution admits prompt packages by deterministic provenance and count
 * conservation only. Creative review coverage and its semantic verdict remain
 * observable diagnostics; they never gate generation, persistence or delivery.
 */
export function inspectWorkflowPromptPackageAdmission(value: unknown): WorkflowPromptPackageAdmission {
	const issues: string[] = [];
	if (!isRecord(value)) {
		return {
			structurallyValid: false,
			issues: ["prompt package must be an object"],
			diagnostics: {
				clipCount: 0,
				deliveryVerificationStatus: null,
				embeddedAuthoringReviewCount: null,
				embeddedAuthoringReviewComplete: null,
			},
		};
	}
	const clips = Array.isArray(value.clips) ? value.clips : [];
	if (value.protocolVersion !== "2") issues.push("protocolVersion must be 2");
	if (value.artifactType !== "tapcanvas.prompt-package/v2") issues.push("artifactType must be tapcanvas.prompt-package/v2");
	if (!Array.isArray(value.clips) || clips.length === 0) issues.push("clips must be a non-empty array");

	const evidence = isRecord(value.deliveryEvidence) ? value.deliveryEvidence : null;
	if (!evidence) {
		issues.push("deliveryEvidence must be an object");
	} else {
		if (evidence.version !== 2) issues.push("deliveryEvidence.version must be 2");
		if (evidence.source !== "workflow_prompt_package") {
			issues.push("deliveryEvidence.source must be workflow_prompt_package");
		}
		if (evidence.clipCount !== clips.length) issues.push("deliveryEvidence.clipCount must match clips.length");
		const totalDurationSeconds = typeof evidence.totalDurationSeconds === "number"
			&& Number.isFinite(evidence.totalDurationSeconds)
			&& evidence.totalDurationSeconds > 0
			? evidence.totalDurationSeconds
			: null;
		const clipDurationSeconds = clips.flatMap((clip) => (
			isRecord(clip)
			&& typeof clip.durationSeconds === "number"
			&& Number.isFinite(clip.durationSeconds)
			&& clip.durationSeconds > 0
				? [clip.durationSeconds]
				: []
		));
		if (
			totalDurationSeconds === null
			|| clipDurationSeconds.length !== clips.length
			|| Math.abs(clipDurationSeconds.reduce((sum, duration) => sum + duration, 0) - totalDurationSeconds) > 1e-6
		) {
			issues.push("deliveryEvidence.totalDurationSeconds must equal the positive clip duration sum");
		}
		const sourceSpeechLineCount = readNonNegativeInteger(evidence.sourceSpeechLineCount);
		const narrativeSpeechLineCount = readNonNegativeInteger(evidence.narrativeSpeechLineCount);
		const executableSpeechLineCount = readNonNegativeInteger(evidence.executableSpeechLineCount);
		if (
			sourceSpeechLineCount === null
			|| narrativeSpeechLineCount === null
			|| executableSpeechLineCount === null
			|| sourceSpeechLineCount + narrativeSpeechLineCount !== executableSpeechLineCount
		) {
			issues.push("deliveryEvidence speech counts must be non-negative integers and conserve their total");
		}
		const assetBindingCount = readNonNegativeInteger(evidence.assetBindingCount);
		const actualAssetBindingCount = clips.reduce((sum, clip) => (
			sum + (isRecord(clip) && Array.isArray(clip.assetBindings) ? clip.assetBindings.length : 0)
		), 0);
		if (assetBindingCount === null || assetBindingCount !== actualAssetBindingCount) {
			issues.push("deliveryEvidence.assetBindingCount must match clip asset bindings");
		}
		const embeddedAuthoringReviewCount = readNonNegativeInteger(evidence.embeddedAuthoringReviewCount);
		if (embeddedAuthoringReviewCount === null || embeddedAuthoringReviewCount > clips.length) {
			issues.push("deliveryEvidence.embeddedAuthoringReviewCount must be within the clip count");
		}
	}

	const verification = isRecord(value.deliveryVerification) ? value.deliveryVerification : null;
	if (!verification || verification.version !== 2) {
		issues.push("deliveryVerification.version must be 2");
	}
	const embeddedAuthoringReviewCount = evidence
		? readNonNegativeInteger(evidence.embeddedAuthoringReviewCount)
		: null;
	return {
		structurallyValid: issues.length === 0,
		issues,
		diagnostics: {
			clipCount: clips.length,
			deliveryVerificationStatus: verification ? readString(verification.status) || null : null,
			embeddedAuthoringReviewCount,
			embeddedAuthoringReviewComplete: embeddedAuthoringReviewCount === null
				? null
				: embeddedAuthoringReviewCount === clips.length,
		},
	};
}

function projectCanvasFactsForDeliveryContract(canvasFacts: JsonRecord): JsonRecord {
	const authoritativeSources = Array.isArray(canvasFacts.authoritativeSources)
		? canvasFacts.authoritativeSources.filter(isRecord)
		: [];
	if (authoritativeSources.length === 0 || !Array.isArray(canvasFacts.nodes)) return canvasFacts;
	const authoritativeSourceIds = new Set(authoritativeSources.flatMap((source) => {
		const sourceId = readString(source.sourceId) || readString(source.nodeId);
		return sourceId ? [sourceId] : [];
	}));
	if (authoritativeSourceIds.size === 0) return canvasFacts;
	const nodes = canvasFacts.nodes.map((node) => {
		if (!isRecord(node) || !authoritativeSourceIds.has(readString(node.nodeId))) return node;
		const {
			content: _duplicateContent,
			chapterText: _duplicateChapterText,
			prompt: _duplicatePrompt,
			...structuralFacts
		} = node;
		return structuralFacts;
	});
	return { ...canvasFacts, nodes };
}

function positiveIntegerList(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item): item is number => (
		typeof item === "number" && Number.isInteger(item) && item > 0
	)))].sort((left, right) => left - right);
}

/**
 * Freezes only the user-authorized total duration and the live provider window.
 * The BeatSheet agent owns semantic clip boundaries; admission must not turn a
 * provider maximum into a story structure or a fixed clip count.
 */
export function freezeWorkflowVideoDurationPlan(input: Readonly<{
	targetDurationSeconds: number;
	modelKey: string;
	durationOptions: readonly number[];
	explicitDurations?: readonly number[];
}>): FrozenWorkflowVideoDurationPlan {
	const modelKey = readString(input.modelKey);
	const durationOptions = positiveIntegerList(input.durationOptions);
	if (!modelKey || durationOptions.length === 0) {
		throw new Error("workflow_video_duration_plan_catalog_invalid");
	}
	const feasibility = resolveVideoProviderDurationTopology({
		targetDurationSeconds: input.targetDurationSeconds,
		durationOptions,
		...(input.explicitDurations?.length
			? {
				explicitDurations: input.explicitDurations,
				requestedClipCount: input.explicitDurations.length,
			}
			: {}),
	});
	return {
		protocolVersion: "tapcanvas.workflow-video-duration-plan/v2",
		targetDurationSeconds: feasibility.targetDurationSeconds,
		modelKey,
		durationOptions,
		maxDurationSeconds: Math.max(...durationOptions),
		policy: "agent_semantic_duration_budget",
		...(input.explicitDurations?.length ? { providerSubmissionTopology: feasibility } : {}),
	};
}

export function parseFrozenWorkflowVideoDurationPlan(
	value: unknown,
): FrozenWorkflowVideoDurationPlan | null {
	if (!isRecord(value)) return null;
	const targetDurationSeconds = value.targetDurationSeconds;
	const modelKey = readString(value.modelKey);
	const durationOptions = positiveIntegerList(value.durationOptions);
	const maxDurationSeconds = value.maxDurationSeconds;
	if (
		value.protocolVersion !== "tapcanvas.workflow-video-duration-plan/v2"
		|| value.policy !== "agent_semantic_duration_budget"
		|| typeof targetDurationSeconds !== "number"
		|| !Number.isInteger(targetDurationSeconds)
		|| targetDurationSeconds <= 0
		|| !modelKey
		|| durationOptions.length === 0
		|| typeof maxDurationSeconds !== "number"
		|| maxDurationSeconds !== Math.max(...durationOptions)
	) return null;
	const rawTopology = isRecord(value.providerSubmissionTopology)
		? value.providerSubmissionTopology
		: null;
	const explicitDurations = rawTopology && Array.isArray(rawTopology.minimumClipDurations)
		? rawTopology.minimumClipDurations.filter((duration): duration is number => (
			typeof duration === "number" && Number.isInteger(duration) && duration > 0
		))
		: [];
	if (rawTopology && (
		rawTopology.targetDurationSeconds !== targetDurationSeconds
		|| rawTopology.expectedClipCount !== explicitDurations.length
		|| rawTopology.source !== "user_clip_durations"
		|| explicitDurations.length === 0
	)) return null;
	const canonical = freezeWorkflowVideoDurationPlan({
		targetDurationSeconds,
		modelKey,
		durationOptions,
		...(explicitDurations.length ? { explicitDurations } : {}),
	});
	if (canonical.maxDurationSeconds !== maxDurationSeconds) return null;
	return canonical;
}

function parseJsonText(value: unknown, field: string): unknown {
	const text = readString(value);
	if (!text) throw new Error(`${field} must be a non-empty JSON string`);
	try {
		return JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new Error(`${field} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Compile caller-frozen Clip facts into an already complete Agent-authored writer
 * artifact. These values already crossed the authoritative clip-context
 * boundary and are compiler inputs, not creative decisions: the Agent still
 * owns shots, actions, camera language, performance and review evidence.
 *
 * The compiler never rescales shot durations, remaps event references, edits
 * audit text or fills model-authored parameters. Invalid/incomplete authored
 * data returns its exact deterministic path and is recorded as a
 * single-submission contract failure.
 */
export type WorkflowClipWriterFrozenEnvelopeCompilation =
	| Readonly<{ ok: true; text: string }>
	| Readonly<{ ok: false; errorMessage: string }>;

function clipWriterCompilationFailure(errorMessage: string): WorkflowClipWriterFrozenEnvelopeCompilation {
	return { ok: false, errorMessage };
}

export function compileWorkflowClipWriterFrozenEnvelope(input: Readonly<{
	text: string;
	contextItem: unknown;
}>): WorkflowClipWriterFrozenEnvelopeCompilation {
	try {
		const parsed = parseJsonText(input.text, "clipWriter");
		if (!isRecord(parsed) || !Array.isArray(parsed.clips) || parsed.clips.length !== 1) {
			return clipWriterCompilationFailure("clipWriter.clips must contain exactly one object");
		}
		const rawClip = parsed.clips[0];
		if (!isRecord(rawClip)) return clipWriterCompilationFailure("clipWriter.clips[0] must be an object");
		if (!isRecord(input.contextItem) || !isRecord(input.contextItem.beat)) {
			return clipWriterCompilationFailure("clipWriter frozen context must contain a beat object");
		}
		const beat = input.contextItem.beat;
		const clipId = readString(beat.clipId);
		const clipIndex = input.contextItem.clipIndex;
		const durationSeconds = beat.durationSeconds;
		const characterRoleNames = Array.isArray(beat.characters)
			? beat.characters.map(readString).filter(Boolean)
			: [];
		const exitState = readString(beat.exitState);
		if (!clipId) return clipWriterCompilationFailure("clipWriter frozen beat.clipId must be non-empty");
		if (!Number.isInteger(clipIndex) || Number(clipIndex) < 0) {
			return clipWriterCompilationFailure("clipWriter frozen clipIndex must be a non-negative integer");
		}
		if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
			return clipWriterCompilationFailure("clipWriter frozen beat.durationSeconds must be positive");
		}
		if (!Array.isArray(beat.characters) || characterRoleNames.length !== beat.characters.length) {
			return clipWriterCompilationFailure("clipWriter frozen beat.characters must contain only non-empty names");
		}
		if (!exitState) return clipWriterCompilationFailure("clipWriter frozen beat.exitState must be non-empty");
		if (!Array.isArray(input.contextItem.assetObjectContracts)) {
			return clipWriterCompilationFailure("clipWriter frozen assetObjectContracts must be an array");
		}
		const storyEvents = Array.isArray(beat.storyEvents) ? beat.storyEvents : [];
		if (storyEvents.length === 0) {
			return clipWriterCompilationFailure("clipWriter frozen beat.storyEvents must be non-empty");
		}
		const authoredShots = rawClip.shots;
		const frozenEnvelope = {
			...parsed,
			clips: [{
				...rawClip,
				shots: authoredShots,
				clipId,
				clipIndex,
				durationSeconds,
				characterRoleNames,
				exitState,
				assetObjectContracts: input.contextItem.assetObjectContracts,
			}],
		};
		try {
			const compiledFrameContract = compileTemporalFrameContract({
				durationSeconds,
				storyEvents,
				exitState,
				shots: authoredShots,
				field: "clipWriter.clips[0]",
			});
			return {
				ok: true,
				text: JSON.stringify({
					...frozenEnvelope,
					clips: [{
						...frozenEnvelope.clips[0],
						sourceEventCoverage: compiledFrameContract.sourceEventCoverage,
						temporalFrameTrack: compiledFrameContract.temporalFrameTrack,
						temporalFrameCoverage: compiledFrameContract.temporalFrameCoverage,
					}],
				}),
			};
		} catch (error: unknown) {
			return clipWriterCompilationFailure(
				error instanceof Error ? error.message : String(error),
			);
		}
	} catch (error: unknown) {
		return clipWriterCompilationFailure(error instanceof Error ? error.message : String(error));
	}
}

export function compileWorkflowClipWriterFrozenEnvelopeText(input: Readonly<{
	text: string;
	contextItem: unknown;
}>): string | null {
	const result = compileWorkflowClipWriterFrozenEnvelope(input);
	return result.ok ? result.text : null;
}

function agentText(value: unknown, field: string): string {
	if (!isRecord(value)) throw new Error(`${field} must be an Agent result object`);
	const text = readString(value.text);
	if (!text) throw new Error(`${field}.text must be non-empty`);
	return text;
}

/**
 * Validate an Agent-authored exact project-asset decision structurally. Asset
 * semantics belong to the Agent's one-shot planning phase; this boundary only
 * verifies that a declared ID is a ready production image in the frozen project
 * and that the declared project identity is exact.
 */
export function validateWorkflowAssetPlanProjectReuse(input: Readonly<{
	assetAgentResult: unknown;
	projectContext: WorkflowReusableAssetContext | null;
}>): string | null {
	if (!input.projectContext) return null;
	const parsed = parseJsonText(agentText(input.assetAgentResult, "assetPlans"), "assetPlans.text");
	if (!Array.isArray(parsed)) return null;
	const readyProjectImages = input.projectContext.assetSnapshot.filter((asset) => (
		asset.projectId === input.projectContext?.projectId
		&& asset.mediaKind === "image"
		&& asset.state === "ready"
		&& asset.productionEligible
	));
	for (const [index, rawPlan] of parsed.entries()) {
		if (!isRecord(rawPlan)) continue;
		const role = readString(rawPlan.role);
		const existingAssetId = readString(rawPlan.existingAssetId);
		const existingProjectId = readString(rawPlan.existingProjectId);
		if (existingAssetId) {
			const declaredAsset = readyProjectImages.find((asset) => asset.assetId === existingAssetId);
			if (!declaredAsset) {
				return `assetPlans[${index}] role ${role} declares existingAssetId=${existingAssetId} outside the ready production-eligible frozen project image set; allowedAssetIds=${JSON.stringify(readyProjectImages.map((asset) => asset.assetId))}`;
			}
			if (existingProjectId !== input.projectContext.projectId) {
				return `assetPlans[${index}] role ${role} must bind existingProjectId=${input.projectContext.projectId}`;
			}
		}
	}
	return null;
}

function uniqueNonEmptyStrings(values: readonly unknown[]): string[] {
	return [...new Set(values.map(readString).filter(Boolean))];
}

const REFERENCE_ROLE_BY_OBJECT_KIND: Readonly<Record<AssetObjectKind, AssetReferenceRole>> = {
	character: "identity",
	scene: "environment",
	prop: "prop",
	vfx: "vfx",
	palette: "palette",
	composition: "composition",
};

export function parseWorkflowAssetRole(value: unknown, field: string): Readonly<{
	kind: AssetObjectKind;
	name: string;
	referenceRole: AssetReferenceRole;
}> {
	const role = readString(value);
	const separatorIndex = role.indexOf("://");
	if (separatorIndex <= 0 || separatorIndex + 3 >= role.length) {
		throw new Error(`${field} must use kind://canonical-name`);
	}
	const kind = role.slice(0, separatorIndex) as AssetObjectKind;
	const name = role.slice(separatorIndex + 3).trim();
	if (!ASSET_OBJECT_KINDS.includes(kind) || !name) {
		throw new Error(`${field} must use a supported asset kind and non-empty canonical name`);
	}
	return { kind, name, referenceRole: REFERENCE_ROLE_BY_OBJECT_KIND[kind] };
}

function plannedAssetBindingsForClip(contextItem: unknown, field: string): WorkflowPromptAssetBinding[] {
	if (!isRecord(contextItem)) throw new Error(`${field} has no Clip context`);
	if (contextItem.assetPlans === undefined) return [];
	if (!Array.isArray(contextItem.assetPlans)) throw new Error(`${field}.assetPlans must be an array`);
	const bindings = contextItem.assetPlans.map((value, index) => {
		if (!isRecord(value)) throw new Error(`${field}.assetPlans[${index}] must be an object`);
		const assetId = readString(value.assetId);
		if (!assetId) throw new Error(`${field}.assetPlans[${index}] requires a stable assetId`);
		return {
			assetId,
			...parseWorkflowAssetRole(value.role, `${field}.assetPlans[${index}].role`),
		};
	});
	if (new Set(bindings.map((binding) => binding.assetId)).size !== bindings.length) {
		throw new Error(`${field}.assetPlans contains duplicate assetId values`);
	}
	return bindings;
}

const ASSET_CONTRACT_COPY_FIELDS = [
	"kind",
	"name",
	"physicalIdentityKey",
	"referenceImageNodeIds",
	"referenceAssetIds",
	"referenceRole",
	"forbiddenTransfer",
	"identityInvariant",
	"startState",
	"spatialRelation",
	"scale",
	"driver",
	"stateChange",
	"endState",
] as const;

function canonicalAssetContracts(value: unknown, field: string): AssetObjectContract[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
	const sanitized = value.map((raw) => {
		if (!isRecord(raw)) return raw;
		return Object.fromEntries(
			ASSET_CONTRACT_COPY_FIELDS.flatMap((key) => (
				Object.prototype.hasOwnProperty.call(raw, key) ? [[key, raw[key]]] : []
			)),
		);
	});
	const parsed = parseAssetObjectContracts(sanitized, field, {
		allowEmpty: true,
		allowMissingReferenceImageNodeIds: true,
	});
	if (parsed.errors.length > 0) throw new Error(parsed.errors.join("; "));
	return parsed.contracts;
}

function structuredClipFromWriter(input: Readonly<{
	text: string;
	itemId: string;
	clipIndex: number;
	durationSeconds: number;
	assetBindings: readonly WorkflowPromptAssetBinding[];
	expectedAssetObjectContracts: readonly WorkflowClipAssetObjectContract[];
	outputAssetObjectContracts?: readonly WorkflowClipAssetObjectContract[];
	storyEvents: readonly unknown[];
	characterRoleNames: readonly string[];
	exitState: string;
	spokenScript: readonly SpokenScriptLine[];
	sourceDialogueLineIds: readonly string[];
	dialoguePaceRate: number;
	field: string;
}>): Readonly<{
	structuredClip: Record<string, unknown>;
	prompt: string;
	authoringEvidence: WorkflowPromptPackage["clips"][number]["authoringEvidence"];
}> {
	const parsed = parseJsonText(input.text, input.field);
	if (!isRecord(parsed) || !Array.isArray(parsed.clips) || parsed.clips.length !== 1) {
		throw new Error(`${input.field} must contain exactly one clip object`);
	}
	const selfQaNote = readString(parsed.selfQaNote);
	const creativeReview = isRecord(parsed.creativeReview) ? parsed.creativeReview : null;
	const reviewMode = readString(creativeReview?.mode);
	const reviewIterations = creativeReview?.iterations;
	const reviewSummary = readString(creativeReview?.summary);
	const narrativeAudioAssessment = readString(creativeReview?.narrativeAudioAssessment);
	const hasAuthoringReview = Boolean(
		creativeReview
		&& reviewMode === "embedded_authoring"
		&& typeof reviewIterations === "number"
		&& Number.isInteger(reviewIterations)
		&& reviewIterations > 0
		&& reviewSummary,
	);
	const rawClip = parsed.clips[0];
	if (!isRecord(rawClip)) throw new Error(`${input.field}.clips[0] must be an object`);
	const declaredClipId = readString(rawClip.clipId);
	if (!declaredClipId || declaredClipId !== input.itemId) {
		throw new Error(`${input.field}.clips[0].clipId must equal collection itemId ${input.itemId}`);
	}
	if (rawClip.clipIndex !== input.clipIndex) {
		throw new Error(`${input.field}.clips[0].clipIndex must equal frozen physical order ${input.clipIndex}`);
	}
	if (rawClip.durationSeconds !== input.durationSeconds) {
		throw new Error(
			`${input.field}.clips[0].durationSeconds must equal frozen Clip duration ${input.durationSeconds}`,
		);
	}
	if (JSON.stringify(rawClip.characterRoleNames) !== JSON.stringify(input.characterRoleNames)) {
		throw new Error(`${input.field}.clips[0].characterRoleNames must exactly equal frozen BeatSheet characters`);
	}
	if (readString(rawClip.exitState) !== input.exitState) {
		throw new Error(`${input.field}.clips[0].exitState must exactly equal the frozen BeatSheet exitState`);
	}
	const assetObjectContracts = assertExactWorkflowClipAssetObjectContracts({
		actual: rawClip.assetObjectContracts,
		expected: input.expectedAssetObjectContracts,
		field: `${input.field}.clips[0].assetObjectContracts`,
	});
	validateWorkflowSourceEventCoverage({
		coverage: rawClip.sourceEventCoverage,
		storyEvents: input.storyEvents,
		shots: rawClip.shots,
		field: `${input.field}.clips[0].sourceEventCoverage`,
	});
	const temporalFrameTrack = parseTemporalFrameTrack({
		value: rawClip.temporalFrameTrack,
		durationSeconds: input.durationSeconds,
		storyEvents: input.storyEvents,
		exitState: input.exitState,
		field: `${input.field}.clips[0].temporalFrameTrack`,
	});
	validateTemporalFrameCoverage({
		coverage: rawClip.temporalFrameCoverage,
		track: temporalFrameTrack,
		shots: rawClip.shots,
		field: `${input.field}.clips[0].temporalFrameCoverage`,
	});
	const writerClip: Record<string, unknown> = {
		...rawClip,
		assetObjectContracts,
		temporalFrameTrack,
	};
	const projectedSpeechStructure = projectWriterSpeechStructure({
		clip: writerClip,
		dialogueScript: input.spokenScript,
		characterRoleNames: input.characterRoleNames,
	});
	const materialized = materializeWriterSpeechEvents({
		clip: projectedSpeechStructure,
		dialogueScript: input.spokenScript,
		clipDurationSeconds: input.durationSeconds,
	});
	if (!materialized.ok) {
		throw new Error(
			`${input.field}.clips[0] dialogue coordinates are invalid: ${materialized.issues
				.map((issue) => `${issue.path}: ${issue.problem}`)
				.join("; ")}. `
			+ "首次提交合同：clips[0].speechEvents 必须为每条冻结 lineId 提交一个完整事件，包含完整 Unicode 半开区间、独立起止秒、说话人、delivery 与表演控制；禁止提交对白正文、按镜头切字或手填 shots[].speechEventIds。",
		);
	}
	const structuredClip = {
		...(compileShotSpeechEventReferences(materialized.clip) as StructuredClip & Record<string, unknown>),
		assetObjectContracts: input.outputAssetObjectContracts ?? assetObjectContracts,
	};
	const dialogueIssues = validateShotDialogueConservation({
		clip: structuredClip,
		dialogueScript: input.spokenScript,
	});
	if (dialogueIssues.length > 0) {
		throw new Error(`${input.field}.clips[0] violates the frozen speech contract: ${dialogueIssues.join("; ")}`);
	}
	const speakerContract = readClipSpeakerBindings(structuredClip);
	if (speakerContract.issues.length > 0) {
		throw new Error(
			`${input.field}.clips[0] speakerBindings are invalid: ${speakerContract.issues
				.map((issue) => `${issue.path}: ${issue.problem}`)
				.join("; ")}`,
		);
	}
	const expectedSpeakerNames = collectSpokenSpeakerNames(input.spokenScript);
	const actualSpeakerNames = speakerContract.bindings.map((binding) => binding.name);
	if (JSON.stringify(actualSpeakerNames) !== JSON.stringify(expectedSpeakerNames)) {
		throw new Error(
			`${input.field}.clips[0].speakerBindings must exactly equal the ordered frozen speakers; expected=${JSON.stringify(expectedSpeakerNames)}:actual=${JSON.stringify(actualSpeakerNames)}`,
		);
	}
	const compiled = compileStructuredClipForExecution(structuredClip);
	const prompt = readString(compiled.clipPrompt);
	if (!prompt) throw new Error(`${input.field}.clips[0] compiled to an empty execution prompt`);
	return {
		structuredClip,
		prompt,
		authoringEvidence: {
			...(selfQaNote ? { selfQaNote } : {}),
			...(hasAuthoringReview ? { creativeReview: {
				mode: "embedded_authoring",
				iterations: reviewIterations as number,
				summary: reviewSummary as string,
				...(narrativeAudioAssessment ? { narrativeAudioAssessment } : {}),
			} } : {}),
			sourceDialogueLineIds: [...input.sourceDialogueLineIds],
			spokenLineIds: input.spokenScript.map((line) => line.lineId),
		},
	};
}

/**
 * Validate a single Clip writer result against its already-frozen Clip context.
 *
 * The writer node must fail and re-enter the bounded structured-output repair
 * loop when it omits a frozen dialogue range. Waiting until prompt-package
 * assembly made the writer look successful while leaving the durable workflow
 * with an unusable prompt artifact.
 */
export function validateWorkflowClipWriterForContext(input: Readonly<{
	text: string;
	itemId: string;
	contextItem: unknown;
}>): string | null {
	if (!isRecord(input.contextItem)) return "Clip writer context must be an object";
	// Older/custom workflow tests may invoke a writer without the video Clip
	// context contract. Leave those nodes on their own configured contract; a
	// real video clip-context always carries this field, including [] for silence.
	if (!Object.prototype.hasOwnProperty.call(input.contextItem, "spokenScript")) return null;
	const beat = isRecord(input.contextItem.beat) ? input.contextItem.beat : null;
	const durationSeconds = beat?.durationSeconds;
	if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return "Clip writer context requires a positive beat.durationSeconds";
	}
	if (!Array.isArray(input.contextItem.spokenScript)) {
		return "Clip writer context requires a frozen spokenScript array";
	}
	let spokenScript: SpokenScriptLine[];
	try {
		spokenScript = parseWorkflowDialogueScript(input.contextItem.spokenScript, "clipContext.spokenScript", false);
	} catch (error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}
	const dialoguePaceRate = typeof input.contextItem.dialoguePaceRate === "number"
		&& Number.isFinite(input.contextItem.dialoguePaceRate)
		&& input.contextItem.dialoguePaceRate > 0
		? input.contextItem.dialoguePaceRate
		: 4;
	const sourceDialogueLineIds = Array.isArray(input.contextItem.sourceDialogueLineIds)
		? uniqueNonEmptyStrings(input.contextItem.sourceDialogueLineIds)
		: [];
	try {
		const clipIndex = input.contextItem.clipIndex;
		if (!Number.isInteger(clipIndex) || Number(clipIndex) < 0) {
			throw new Error("clipContext.clipIndex must be a non-negative integer");
		}
		const beatClipId = readString(beat?.clipId);
		if (!beatClipId || beatClipId !== input.itemId) {
			throw new Error(`clipContext.beat.clipId must equal collection itemId ${input.itemId}`);
		}
		if (!Array.isArray(beat?.characters)) throw new Error("clipContext.beat.characters must be an array");
		const characterRoleNames = Array.isArray(beat.characters)
			? beat.characters.map(readString).filter(Boolean)
			: [];
		if (characterRoleNames.length !== beat.characters.length) {
			throw new Error("clipContext.beat.characters must contain only non-empty strings");
		}
		const exitState = readString(beat?.exitState);
		if (!exitState) throw new Error("clipContext.beat.exitState must be non-empty");
		const storyEvents = Array.isArray(beat?.storyEvents) ? beat.storyEvents : [];
		if (storyEvents.length === 0) throw new Error("clipContext.beat.storyEvents must be non-empty");
		const expectedAssetObjectContracts = parseWorkflowClipAssetObjectContracts(
			input.contextItem.assetObjectContracts,
			"clipContext.assetObjectContracts",
		);
		const assetBindings = plannedAssetBindingsForClip(input.contextItem, "clipContext");
		structuredClipFromWriter({
			text: input.text,
			itemId: input.itemId,
			clipIndex: Number(clipIndex),
			durationSeconds,
			assetBindings,
			expectedAssetObjectContracts,
			storyEvents,
			characterRoleNames,
			exitState,
			spokenScript,
			sourceDialogueLineIds,
			dialoguePaceRate,
			field: "clipWriter",
		});
		return null;
	} catch (error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}
}

function assertExactAssetIds(input: Readonly<{
	actual: readonly string[];
	expected: readonly string[];
	field: string;
}>): void {
	const actual = new Set(input.actual);
	const expected = new Set(input.expected);
	const missing = input.expected.filter((assetId) => !actual.has(assetId));
	const extra = input.actual.filter((assetId) => !expected.has(assetId));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(
			`${input.field} asset consumption must exactly match its validated plan; missing=[${missing.join(",")}]:extra=[${extra.join(",")}]`,
		);
	}
}

export function buildVideoDeliveryContract(input: Readonly<{
	executionId: string;
	workflowKey: string | null;
	executionScope: unknown;
	canvasFacts: unknown;
	durationPlan: WorkflowVideoDurationPlan;
	requestedClipCount?: number | null;
}>): JsonRecord {
	if (!isRecord(input.canvasFacts)) throw new Error("Video delivery contract requires canvas facts");
	if (input.executionScope !== "prompt_only" && input.executionScope !== "media_delivery") {
		throw new Error("Video delivery contract requires an explicit immutable execution scope");
	}
	const scope = input.executionScope;
	if (
		input.durationPlan.targetDurationSeconds !== null
		&& (!Number.isInteger(input.durationPlan.targetDurationSeconds) || input.durationPlan.targetDurationSeconds <= 0)
	) {
		throw new Error("Video delivery contract requires a positive integer target duration");
	}
	if (
		input.requestedClipCount !== undefined
		&& input.requestedClipCount !== null
		&& (!Number.isInteger(input.requestedClipCount) || input.requestedClipCount <= 0)
	) {
		throw new Error("Video delivery contract requires requestedClipCount to be a positive integer when present");
	}
	if (!readString(input.durationPlan.modelKey) || input.durationPlan.durationOptions.length === 0) {
		throw new Error("Video delivery contract requires a frozen model duration window");
	}
	const providerSubmissionTopology = input.durationPlan.targetDurationSeconds === null
		? null
		: input.durationPlan.providerSubmissionTopology
			?? resolveVideoProviderDurationTopology({
				targetDurationSeconds: input.durationPlan.targetDurationSeconds,
				durationOptions: input.durationPlan.durationOptions,
				requestedClipCount: input.requestedClipCount ?? null,
			});
	const canvasFacts = projectCanvasFactsForDeliveryContract(input.canvasFacts);
	return {
		protocolVersion: "2",
		executionId: input.executionId,
		workflowKey: input.workflowKey ?? "tapcanvas.video-production",
		executionScope: scope,
		canvasFacts,
		...(input.durationPlan.targetDurationSeconds === null
			? {}
			: { targetDurationSeconds: input.durationPlan.targetDurationSeconds }),
		generationContract: {
			videoModel: input.durationPlan.modelKey,
			durationOptions: input.durationPlan.durationOptions,
			maxDurationSeconds: input.durationPlan.maxDurationSeconds,
			clipPlanningPolicy: "agent_semantic_duration_budget",
			...(input.requestedClipCount === undefined || input.requestedClipCount === null
				? {}
				: { requestedClipCount: input.requestedClipCount }),
			...(providerSubmissionTopology ? { providerSubmissionTopology } : {}),
		},
		expectedDelivery: scope === "prompt_only"
			? {
				artifactType: "tapcanvas.prompt-package/v2",
				requiresMediaSideEffects: false,
				requirements: ["semantic_clip_plan", "dialogue_conservation", "dynamic_clip_prompts", "stable_item_lineage", "durable_workflow_output"],
			}
			: {
				artifactType: "tapcanvas.master-video/v1",
				requiresMediaSideEffects: true,
				requirements: ["semantic_clip_plan", "dialogue_conservation", "approved_asset_snapshot", "all_clip_video_urls", "concat_video_url", "durable_workflow_output"],
			},
	};
}

export function parseWorkflowVideoDeliveryDurationPlan(deliveryContract: unknown): WorkflowVideoDurationPlan {
	if (!isRecord(deliveryContract)) throw new Error("Clip expansion requires the frozen delivery contract");
	const rawTargetDurationSeconds = deliveryContract.targetDurationSeconds;
	const targetDurationSeconds = rawTargetDurationSeconds === undefined || rawTargetDurationSeconds === null
		? null
		: rawTargetDurationSeconds;
	const generationContract = isRecord(deliveryContract.generationContract)
		? deliveryContract.generationContract
		: null;
	const modelKey = readString(generationContract?.videoModel);
	const durationOptions = Array.isArray(generationContract?.durationOptions)
		? generationContract.durationOptions.filter((value): value is number => Number.isInteger(value) && Number(value) > 0)
		: [];
	const maxDurationSeconds = generationContract?.maxDurationSeconds;
	const clipPlanningPolicy = readString(generationContract?.clipPlanningPolicy);
	const providerSubmissionTopology = isRecord(generationContract?.providerSubmissionTopology)
		? generationContract.providerSubmissionTopology
		: null;
	if (
		(targetDurationSeconds !== null && (
			typeof targetDurationSeconds !== "number"
			|| !Number.isInteger(targetDurationSeconds)
			|| targetDurationSeconds <= 0
		))
		|| !modelKey
		|| durationOptions.length === 0
		|| typeof maxDurationSeconds !== "number"
		|| !Number.isInteger(maxDurationSeconds)
		|| maxDurationSeconds <= 0
		|| clipPlanningPolicy !== "agent_semantic_duration_budget"
	) {
		throw new Error("Frozen delivery contract has an invalid semantic video duration window");
	}
	if (providerSubmissionTopology) {
		if (targetDurationSeconds === null) {
			throw new Error("Frozen delivery contract cannot declare provider topology without an authorized total duration");
		}
		const expectedClipCount = providerSubmissionTopology.expectedClipCount;
		const minimumClipDurations = providerSubmissionTopology.minimumClipDurations;
		const source = providerSubmissionTopology.source;
		if (
			typeof expectedClipCount !== "number"
			|| !Number.isInteger(expectedClipCount)
			|| expectedClipCount <= 0
			|| !Array.isArray(minimumClipDurations)
			|| minimumClipDurations.length !== expectedClipCount
			|| minimumClipDurations.some((value) => typeof value !== "number" || !Number.isInteger(value) || value <= 0)
			|| (source !== "user_clip_durations" && source !== "user_clip_count" && source !== "model_max_duration")
		) {
			throw new Error("Frozen delivery contract has an invalid provider submission topology");
		}
	}
	const normalizedTargetDurationSeconds = typeof targetDurationSeconds === "number"
		? targetDurationSeconds
		: null;
	return {
		targetDurationSeconds: normalizedTargetDurationSeconds,
		modelKey,
		durationOptions,
		maxDurationSeconds,
		...(providerSubmissionTopology && normalizedTargetDurationSeconds !== null ? { providerSubmissionTopology: {
			targetDurationSeconds: normalizedTargetDurationSeconds,
			expectedClipCount: providerSubmissionTopology.expectedClipCount as number,
			minimumClipDurations: providerSubmissionTopology.minimumClipDurations as number[],
			source: providerSubmissionTopology.source as "user_clip_durations" | "user_clip_count" | "model_max_duration",
		} } : {}),
	};
}

function workflowVideoExecutionScope(deliveryContract: unknown): "prompt_only" | "media_delivery" {
	if (!isRecord(deliveryContract)) throw new Error("Clip expansion requires the frozen delivery contract");
	if (deliveryContract.executionScope !== "prompt_only" && deliveryContract.executionScope !== "media_delivery") {
		throw new Error("Clip expansion requires an explicit immutable execution scope");
	}
	return deliveryContract.executionScope;
}

function beatSheetFacts(beatSheetAgentResult: unknown): Readonly<{
	beats: readonly unknown[];
	context: JsonRecord;
	durationCoverage: "complete" | "prefix";
}> {
	if (!isRecord(beatSheetAgentResult)) {
		throw new Error("beatSheet must be an Agent result object");
	}
	const projection = isRecord(beatSheetAgentResult.beatSheetProjection)
		? beatSheetAgentResult.beatSheetProjection
		: null;
	const durationCoverage = projection?.protocolVersion === "tapcanvas.beat-sheet-projection/v1"
		&& projection.selection === "prefix"
		? "prefix"
		: "complete";
	const parsed = parseJsonText(agentText(beatSheetAgentResult, "beatSheet"), "beatSheet.text");
	if (!isRecord(parsed) || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
		throw new Error("BeatSheet Agent must deliver one object with a non-empty beats array");
	}
	const context = Object.fromEntries(Object.entries(parsed).filter(([field]) => field !== "beats"));
	const sourceCoveragePlan = isRecord(context.sourceCoveragePlan) ? context.sourceCoveragePlan : null;
	const speechLedger = sourceCoveragePlan && Array.isArray(sourceCoveragePlan.speechLedger)
		? sourceCoveragePlan.speechLedger
		: null;
	const beats = parsed.beats.map((rawBeat, beatIndex) => {
		if (!isRecord(rawBeat)) return rawBeat;
		if (Array.isArray(rawBeat.dialogueScript)) {
			const spokenScript = workflowBeatSpokenScript(rawBeat, `beats[${beatIndex}]`);
			return {
				...rawBeat,
				speakers: collectSpokenSpeakerNames(spokenScript),
			};
		}
		if (speechLedger?.length !== 0) return rawBeat;
		// The accepted authoritative ledger is explicitly empty, so [] is the
		// only possible dialogue value. Canonicalize at the single BeatSheet read
		// boundary; a non-empty or missing ledger never receives this projection.
		const normalizedBeat = { ...rawBeat, dialogueScript: [] };
		const spokenScript = workflowBeatSpokenScript(normalizedBeat, `beats[${beatIndex}]`);
		return {
			...normalizedBeat,
			speakers: collectSpokenSpeakerNames(spokenScript),
		};
	});
	return { beats, context, durationCoverage };
}

const CHAPTER_ARC_FIELDS = ["storyPromise", "protagonistThroughline", "primaryPayoff", "endingHook"] as const;
const SEQUENCE_BEAT_FIELDS = ["dominantFunction", "causalEntry", "irreversibleResult", "handoffToNext"] as const;

function workflowChapterArc(context: JsonRecord): JsonRecord {
	if (!isRecord(context.chapterArc)) throw new Error("BeatSheet chapterArc must be an object");
	const chapterArc: JsonRecord = {};
	for (const field of CHAPTER_ARC_FIELDS) {
		const value = readString(context.chapterArc[field]);
		if (!value) throw new Error(`BeatSheet chapterArc.${field} must be non-empty`);
		chapterArc[field] = value;
	}
	return chapterArc;
}

function workflowSourceReceipt(context: JsonRecord): JsonRecord {
	const protocolVersion = readString(context.protocolVersion);
	const sourceId = readString(context.sourceId);
	const sourceFingerprint = readString(context.sourceFingerprint);
	if (!protocolVersion || !sourceId || !sourceFingerprint) {
		throw new Error("BeatSheet source receipt requires protocolVersion, sourceId and sourceFingerprint");
	}
	return { protocolVersion, sourceId, sourceFingerprint };
}

function workflowSequenceBeat(beat: unknown, index: number): JsonRecord {
	if (!isRecord(beat)) throw new Error(`BeatSheet clip ${index + 1} must be an object`);
	const sequenceBeat: JsonRecord = {
		clipId: readString(beat.clipId),
		clipIndex: index,
	};
	if (!sequenceBeat.clipId) throw new Error(`BeatSheet clip ${index + 1} requires a stable clipId`);
	for (const field of SEQUENCE_BEAT_FIELDS) {
		const value = readString(beat[field]);
		if (!value) throw new Error(`BeatSheet clip ${index + 1}.${field} must be non-empty`);
		sequenceBeat[field] = value;
	}
	return sequenceBeat;
}

function isSpokenDelivery(value: unknown): value is NonNullable<SpokenScriptLine["delivery"]> {
	return value === "on_screen" || value === "off_screen" || value === "voice_over";
}

function parseWorkflowDialogueScript(
	value: unknown,
	field: string,
	requireDelivery = true,
): SpokenScriptLine[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array; use [] when the source span has no speech`);
	const seenLineIds = new Set<string>();
	return value.map((raw, index) => {
		if (!isRecord(raw)) throw new Error(`${field}[${index}] must be an object`);
		const lineId = readString(raw.lineId);
		const speakerName = readString(raw.speakerName);
		const text = readString(raw.text);
		const delivery = raw.delivery;
		if (!lineId || !speakerName || !text) {
			throw new Error(`${field}[${index}] requires lineId, speakerName and verbatim text`);
		}
		if (seenLineIds.has(lineId)) throw new Error(`${field}[${index}].lineId=${lineId} is duplicated`);
		seenLineIds.add(lineId);
		if ((requireDelivery || delivery !== undefined) && !isSpokenDelivery(delivery)) {
			throw new Error(`${field}[${index}].delivery must be on_screen/off_screen/voice_over`);
		}
		return {
			lineId,
			speakerName,
			text,
			...(isSpokenDelivery(delivery) ? { delivery } : {}),
		};
	});
}

function workflowBeatSpokenScript(beat: JsonRecord, field: string): SpokenScriptLine[] {
	const dialogueScript = parseWorkflowDialogueScript(beat.dialogueScript, `${field}.dialogueScript`);
	const errors: string[] = [];
	const narrativeAudioPlan = parseNarrativeAudioPlan(beat.narrativeAudioPlan, `${field}.narrativeAudioPlan`, errors);
	validateNarrativeAudioPlacement(dialogueScript, narrativeAudioPlan, `${field}.narrativeAudioPlan`, errors);
	if (errors.length > 0) throw new Error(errors.join("; "));
	return combineSpokenScript(dialogueScript, narrativeAudioPlan);
}

function assertWorkflowSpeechLedgerConservation(input: Readonly<{
	context: JsonRecord;
	beats: readonly unknown[];
}>): void {
	const sourceCoveragePlan = isRecord(input.context.sourceCoveragePlan)
		? input.context.sourceCoveragePlan
		: null;
	if (!sourceCoveragePlan || !Array.isArray(sourceCoveragePlan.speechLedger)) {
		throw new Error("BeatSheet sourceCoveragePlan.speechLedger must be an array; use [] only when the authoritative source has no speech");
	}
	const expected = sourceCoveragePlan.speechLedger.map((raw, index) => {
		if (!isRecord(raw)) throw new Error(`sourceCoveragePlan.speechLedger[${index}] must be an object`);
		const lineId = readString(raw.lineId);
		const speakerName = readString(raw.speakerName);
		const text = readString(raw.text);
		if (!lineId || !speakerName || !text) {
			throw new Error(`sourceCoveragePlan.speechLedger[${index}] requires lineId, speakerName and verbatim text`);
		}
		return { lineId, speakerName, text };
	});
	const actual = input.beats.flatMap((rawBeat, beatIndex) => {
		if (!isRecord(rawBeat)) throw new Error(`BeatSheet clip ${beatIndex + 1} must be an object`);
		return parseWorkflowDialogueScript(rawBeat.dialogueScript, `beats[${beatIndex}].dialogueScript`)
			.map(({ lineId, speakerName, text }) => ({ lineId, speakerName, text }));
	});
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`BeatSheet dialogueScript must reconstruct sourceCoveragePlan.speechLedger exactly; expected=${JSON.stringify(expected)}:actual=${JSON.stringify(actual)}`,
		);
	}
}

function clipIdsFromBeatSheet(beatSheetAgentResult: unknown): readonly string[] {
	const beatSheet = beatSheetFacts(beatSheetAgentResult);
	const clipIds = beatSheet.beats.map((beat, index) => {
		if (!isRecord(beat)) throw new Error(`BeatSheet clip ${index + 1} must be an object`);
		const clipId = readString(beat.clipId);
		if (!clipId) throw new Error(`BeatSheet clip ${index + 1} requires a stable clipId`);
		return clipId;
	});
	if (new Set(clipIds).size !== clipIds.length) throw new Error("BeatSheet clipId values must be unique");
	return clipIds;
}

/**
 * BeatSheet v20 owns the creative image-reference brief. This projection adds
 * only machine identities and a provisional consumer set; the existing asset
 * collection compiler replaces that set with the exact per-Clip object usage
 * and overlays frozen project-asset reuse facts.
 */
export function projectVideoAssetPlansFromBeatSheet(
	beatSheetAgentResult: unknown,
): Readonly<{ text: string; assets: readonly unknown[] }> {
	const beatSheet = beatSheetFacts(beatSheetAgentResult);
	const clipIds = clipIdsFromBeatSheet(beatSheetAgentResult);
	const authoringRoles = new Set(resolveVideoAssetRoleAllowlist(beatSheetAgentResult));
	if (!Array.isArray(beatSheet.context.assetPlans)) {
		throw new Error("BeatSheet v20 requires an assetPlans array");
	}
	const seenRoles = new Set<string>();
	const assetPlans = beatSheet.context.assetPlans.map((value, index) => {
		if (!isRecord(value)) throw new Error(`BeatSheet assetPlans[${index}] must be an object`);
		const role = readString(value.role);
		const prompt = readString(value.prompt);
		const negativePrompt = readString(value.negativePrompt);
		if (!role || !prompt || !negativePrompt) {
			throw new Error(`BeatSheet assetPlans[${index}] requires role, prompt and negativePrompt`);
		}
		if (seenRoles.has(role)) throw new Error(`BeatSheet assetPlans contains duplicate role ${role}`);
		seenRoles.add(role);
		const parsedRole = parseWorkflowAssetRole(role, `BeatSheet assetPlans[${index}].role`);
		const identityAnchors = Array.isArray(value.identityAnchors)
			? uniqueNonEmptyStrings(value.identityAnchors)
			: [];
		const prohibitedDrift = Array.isArray(value.prohibitedDrift)
			? uniqueNonEmptyStrings(value.prohibitedDrift)
			: [];
		if (identityAnchors.length === 0 || prohibitedDrift.length === 0) {
			throw new Error(`BeatSheet assetPlans[${index}] requires identityAnchors and prohibitedDrift`);
		}
		return {
			assetId: `asset-plan:${role}`,
			role,
			prompt,
			negativePrompt,
			consumerClipIds: clipIds,
			...(parsedRole.kind === "character" ? {
				referenceType: "character" as const,
				roleName: parsedRole.name,
				characterAssetRole: "identity_anchor" as const,
				characterProfileVersion: "character-card/v3" as const,
				identityAnchors,
				prohibitedDrift,
			} : {}),
		};
	});
	const missingAuthoringRoles = [...authoringRoles].filter((role) => !seenRoles.has(role));
	if (missingAuthoringRoles.length > 0) {
		throw new Error(`BeatSheet assetPlans is missing frozen authoring roles ${JSON.stringify(missingAuthoringRoles)}`);
	}
	// The frozen object contract, not the presence of a creative brief, decides
	// whether a paid reference image is executable. A prop/VFX/palette may stay
	// in the motion ledger without becoming an image dependency. Materializing
	// only the exact authoring allowlist keeps that structural decision aligned
	// with buildVideoAssetPlanCollection and prevents an upstream creative
	// superset from failing the downstream fan-out contract.
	return {
		text: JSON.stringify(assetPlans.filter((plan) => authoringRoles.has(plan.role))),
		assets: [],
	};
}

function parseAssetPlan(value: unknown, index: number, knownClipIds: ReadonlySet<string>): WorkflowVideoAssetPlan {
	if (!isRecord(value)) throw new Error(`Asset plan ${index + 1} must be an object`);
	const assetId = readString(value.assetId);
	const role = readString(value.role);
	const prompt = readString(value.prompt);
	const negativePrompt = readString(value.negativePrompt);
	const consumerClipIds = Array.isArray(value.consumerClipIds)
		? uniqueNonEmptyStrings(value.consumerClipIds)
		: [];
	if (!assetId || !role || !prompt || !negativePrompt) {
		throw new Error(`Asset plan ${index + 1} requires assetId, role, prompt and negativePrompt`);
	}
	const parsedRole = parseWorkflowAssetRole(role, `Asset plan ${index + 1}.role`);
	if (consumerClipIds.length === 0) {
		throw new Error(`Asset plan ${assetId} has no declared Clip consumer; refusing an orphan paid asset`);
	}
	const unknownClipId = consumerClipIds.find((clipId) => !knownClipIds.has(clipId));
	if (unknownClipId) {
		throw new Error(`Asset plan ${assetId} declares unknown consumer Clip ${unknownClipId}`);
	}
	const existingImageUrl = readString(value.existingImageUrl);
	const existingNodeId = readString(value.existingNodeId);
	const existingAssetId = readString(value.existingAssetId);
	const existingProjectId = readString(value.existingProjectId);
	const referenceType = readString(value.referenceType);
	const roleName = readString(value.roleName);
	const characterAssetRole = readString(value.characterAssetRole);
	const characterProfileVersion = readString(value.characterProfileVersion);
	const identityAnchors = Array.isArray(value.identityAnchors)
		? uniqueNonEmptyStrings(value.identityAnchors)
		: [];
	const prohibitedDrift = Array.isArray(value.prohibitedDrift)
		? uniqueNonEmptyStrings(value.prohibitedDrift)
		: [];
	if (parsedRole.kind === "character" && !existingAssetId) {
		if (
			referenceType !== "character"
			|| roleName !== parsedRole.name
			|| characterAssetRole !== "identity_anchor"
			|| characterProfileVersion !== "character-card/v3"
			|| identityAnchors.length === 0
			|| prohibitedDrift.length === 0
		) {
			throw new Error(
				`Asset plan ${assetId} must author one normalized character-card/v3 identity anchor for ${parsedRole.name}`,
			);
		}
	}
	if (existingImageUrl || existingNodeId || existingAssetId) {
		if (!existingAssetId && (!existingImageUrl || !existingNodeId)) {
			throw new Error(`Asset plan ${assetId} reuse declaration requires existingImageUrl and existingNodeId together, or existingAssetId`);
		}
		if (existingImageUrl) try {
			const parsed = new URL(existingImageUrl);
			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
		} catch {
			throw new Error(`Asset plan ${assetId} existingImageUrl is not persistent HTTP(S)`);
		}
	}
	return {
		assetId,
		role,
		prompt,
		negativePrompt,
		consumerClipIds,
		...(parsedRole.kind === "character" && !existingAssetId ? {
			referenceType: "character" as const,
			roleName,
			characterAssetRole: "identity_anchor" as const,
			characterProfileVersion: "character-card/v3" as const,
			identityAnchors,
			prohibitedDrift,
		} : {}),
		...(existingAssetId ? { existingAssetId, ...(existingProjectId ? { existingProjectId } : {}), ...(existingNodeId ? { existingNodeId } : {}) } : {}),
		...(existingImageUrl ? { existingImageUrl, existingNodeId } : {}),
	};
}

export function buildVideoAssetPlanCollection(input: Readonly<{
	executionId: string;
	nodeId: string;
	beatSheetAgentResult: unknown;
	assetAgentResult: unknown;
	reusableAssetFacts?: Readonly<Record<string, Readonly<{
		planAssetId?: string;
		existingAssetId?: string;
		existingProjectId?: string;
		existingNodeId?: string;
		existingImageUrl?: string;
	}>>>;
}>): WorkflowCollectionV1 {
	const clipIds = clipIdsFromBeatSheet(input.beatSheetAgentResult);
	const knownClipIds = new Set(clipIds);
	const requiredAssetRoles = resolveVideoAssetRoleAllowlist(input.beatSheetAgentResult);
	const parsed = parseJsonText(agentText(input.assetAgentResult, "assetPlans"), "assetPlans.text");
	if (!Array.isArray(parsed)) {
		throw new Error("Asset coverage must deliver one asset plan array");
	}
	const reusableAssetFacts = input.reusableAssetFacts ?? {};
	const reusableRoles = new Set(requiredAssetRoles.filter((role) => {
		const fact = reusableAssetFacts[role];
		return Boolean(
			(fact?.existingAssetId && fact.existingProjectId)
			|| (fact?.planAssetId && fact.existingNodeId && fact.existingImageUrl),
		);
	}));
	const unresolvedAssetRoles = requiredAssetRoles.filter((role) => !reusableRoles.has(role));
	if (parsed.length === 0 && unresolvedAssetRoles.length > 0) {
		throw new Error("Asset coverage must deliver plans for the frozen visual-reference roles");
	}
	const submittedPlans = parsed
		.map((value, index) => parseAssetPlan(value, index, knownClipIds))
		.filter((plan) => !reusableRoles.has(plan.role));
	if (new Set(submittedPlans.map((plan) => plan.assetId)).size !== submittedPlans.length) {
		throw new Error("Asset plan assetId values must be unique");
	}
	const beatRecords = beatSheetFacts(input.beatSheetAgentResult).beats.map((beat, index) => {
		if (!isRecord(beat)) throw new Error(`BeatSheet clip ${index + 1} must be an object`);
		return beat;
	});
	const objectContractsByBeat = validateWorkflowBeatObjectContinuity(beatRecords);
	const deterministicReusePlans = requiredAssetRoles.flatMap<WorkflowVideoAssetPlan>((role): WorkflowVideoAssetPlan[] => {
		const fact = reusableAssetFacts[role];
		if (!fact) return [];
		if (fact.existingAssetId && fact.existingProjectId) {
			return [{
				assetId: fact.planAssetId || fact.existingAssetId,
				role,
				consumerClipIds: [],
				existingAssetId: fact.existingAssetId,
				existingProjectId: fact.existingProjectId,
				...(fact.existingNodeId ? { existingNodeId: fact.existingNodeId } : {}),
			}];
		}
		if (!fact.planAssetId || !fact.existingNodeId || !fact.existingImageUrl) return [];
		return [{
			assetId: fact.planAssetId,
			role,
			consumerClipIds: [],
			existingImageUrl: fact.existingImageUrl,
			existingNodeId: fact.existingNodeId,
		}];
	});
	const allPlans = [...deterministicReusePlans, ...submittedPlans];
	if (new Set(allPlans.map((plan) => plan.assetId)).size !== allPlans.length) {
		throw new Error("Asset plan assetId values must be unique across reused and generated plans");
	}
	const submittedRoleCounts = new Map<string, number>();
	for (const plan of allPlans) {
		submittedRoleCounts.set(plan.role, (submittedRoleCounts.get(plan.role) ?? 0) + 1);
	}
	const roleCoverageErrors = [
		...[...submittedRoleCounts.entries()]
			.filter(([role]) => !requiredAssetRoles.includes(role))
			.map(([role]) => `visual asset role ${role} has no frozen object requiring an authoring reference`),
		...[...submittedRoleCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([role, count]) => `visual asset role ${role} has ${String(count)} plans; expected exactly one`),
		...requiredAssetRoles
			.filter((role) => !submittedRoleCounts.has(role))
			.map((role) => `frozen visual asset role ${role} requires exactly one plan`),
	];
	if (roleCoverageErrors.length > 0) {
		throw new Error(roleCoverageErrors.join("; "));
	}
	// consumerClipIds is a projection of the frozen BeatSheet object contract,
	// not a creative choice. Rebuild it mechanically so a model cannot bind a
	// valid global asset to a text-only occurrence, omit a required occurrence,
	// or spend one physical correction window per Clip repairing the same role.
	const plans = allPlans.map((plan) => {
		const displayName = objectContractsByBeat
			.flat()
			.find((contract) => workflowVisualAssetRole(contract) === plan.role)
			?.name.trim();
		if (!displayName) {
			throw new Error(`Visual asset role ${plan.role} has no frozen display name`);
		}
		return {
			...plan,
			displayName,
			consumerClipIds: clipIds.filter((_clipId, index) => (
				(objectContractsByBeat[index] ?? []).some((contract) => (
					requiresAuthoringVisualReference(contract)
						&& workflowVisualAssetRole(contract) === plan.role
				))
			)),
		};
	});
	clipIds.forEach((clipId, index) => {
		const assetBindings = plans
			.filter((plan) => plan.consumerClipIds.includes(clipId))
			.map((plan) => ({
				assetId: plan.assetId,
				...parseWorkflowAssetRole(plan.role, `Clip ${clipId} asset ${plan.assetId}.role`),
			}));
		bindWorkflowClipAssetObjectContracts({
			contracts: objectContractsByBeat[index] ?? [],
			assetBindings,
			field: `beats[${index}].assetObjectContracts`,
		});
	});
	return createWorkflowCollection({
		collectionId: `${input.executionId}:${input.nodeId}:asset-plans`,
		producerNodeId: input.nodeId,
		producerPortId: "asset-items",
		itemIds: plans.map((plan) => plan.assetId),
		values: plans,
	});
}

export function resolveVideoAssetRoleAllowlist(beatSheetAgentResult: unknown): readonly string[] {
	const beatRecords = beatSheetFacts(beatSheetAgentResult).beats.map((beat, index) => {
		if (!isRecord(beat)) throw new Error(`BeatSheet clip ${index + 1} must be an object`);
		return beat;
	});
	const contractsByBeat = validateWorkflowBeatObjectContinuity(beatRecords);
	return [...new Set(contractsByBeat.flatMap((contracts) => contracts
		.filter(requiresAuthoringVisualReference)
		.map(workflowVisualAssetRole)))];
}

function optionalAssetPlans(assetPlanCollection: unknown): readonly WorkflowVideoAssetPlan[] {
	if (assetPlanCollection === undefined || assetPlanCollection === null) return [];
	if (!isWorkflowCollection(assetPlanCollection)) {
		throw new Error("Clip expansion requires the validated visual asset plan collection");
	}
	return assetPlanCollection.items.map((item, index) => {
		if (!isRecord(item.value)) throw new Error(`Asset plan item ${index + 1} must be an object`);
		const consumerClipIds = Array.isArray(item.value.consumerClipIds)
			? uniqueNonEmptyStrings(item.value.consumerClipIds)
			: [];
		const assetId = readString(item.value.assetId);
		const role = readString(item.value.role);
		const prompt = readString(item.value.prompt);
		const negativePrompt = readString(item.value.negativePrompt);
		const existingAssetId = readString(item.value.existingAssetId);
		const existingImageUrl = readString(item.value.existingImageUrl);
		const existingNodeId = readString(item.value.existingNodeId);
		const hasLegacyReuseBinding = Boolean(existingImageUrl && existingNodeId);
		if (!assetId || !role || consumerClipIds.length === 0 || (!existingAssetId && !hasLegacyReuseBinding && (!prompt || !negativePrompt))) {
			throw new Error(`Validated asset plan item ${index + 1} is incomplete`);
		}
		parseWorkflowAssetRole(role, `Validated asset plan item ${index + 1}.role`);
		const existingProjectId = readString(item.value.existingProjectId);
		const referenceType = readString(item.value.referenceType);
		const roleName = readString(item.value.roleName);
		const characterAssetRole = readString(item.value.characterAssetRole);
		const characterProfileVersion = readString(item.value.characterProfileVersion);
		const identityAnchors = Array.isArray(item.value.identityAnchors)
			? uniqueNonEmptyStrings(item.value.identityAnchors)
			: [];
		const prohibitedDrift = Array.isArray(item.value.prohibitedDrift)
			? uniqueNonEmptyStrings(item.value.prohibitedDrift)
			: [];
		if (existingImageUrl || existingNodeId || existingAssetId) {
			if (!existingAssetId && (!existingImageUrl || !existingNodeId)) {
				throw new Error(`Validated asset plan item ${assetId} reuse declaration requires existingAssetId or the legacy URL pair`);
			}
			if (existingImageUrl) try {
				const parsed = new URL(existingImageUrl);
				if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
			} catch {
				throw new Error(`Validated asset plan item ${assetId} existingImageUrl is not persistent HTTP(S)`);
			}
		}
		return {
			assetId,
			role,
			...(prompt ? { prompt } : {}),
			...(negativePrompt ? { negativePrompt } : {}),
			consumerClipIds,
			...(referenceType === "character" ? {
				referenceType: "character" as const,
				roleName,
				characterAssetRole: characterAssetRole === "identity_anchor" ? "identity_anchor" as const : undefined,
				characterProfileVersion: characterProfileVersion === "character-card/v3" ? "character-card/v3" as const : undefined,
				identityAnchors,
				prohibitedDrift,
			} : {}),
			...(existingAssetId ? { existingAssetId, ...(existingProjectId ? { existingProjectId } : {}), ...(existingNodeId ? { existingNodeId } : {}) } : {}),
			...(existingImageUrl ? { existingImageUrl, existingNodeId } : {}),
		};
	});
}

export function buildVideoClipContexts(input: Readonly<{
	executionId: string;
	nodeId: string;
	deliveryContract: unknown;
	beatSheetAgentResult: unknown;
}>): WorkflowCollectionV1 {
	const deliveryContractExpectation = createWorkflowArtifactContract({
		artifactType: "tapcanvas.delivery-contract/v2",
		schemaVersion: "2",
		constraints: {
			requiresFrozenExecutionScope: true,
			requiresLiveVideoGenerationContract: true,
		},
	});
	let durationPlan: WorkflowVideoDurationPlan;
	let executionScope: "prompt_only" | "media_delivery";
	try {
		durationPlan = parseWorkflowVideoDeliveryDurationPlan(input.deliveryContract);
		executionScope = workflowVideoExecutionScope(input.deliveryContract);
	} catch (error: unknown) {
		throw new WorkflowInputContractError({
			targetPortId: "delivery-contract",
			expectedContract: deliveryContractExpectation,
			cause: error,
		});
	}
	const beatSheetExpectation = createWorkflowArtifactContract({
		artifactType: "tapcanvas.beat-sheet/v2",
		schemaVersion: "2",
		constraints: {
			durationOptions: durationPlan.durationOptions,
			targetDurationSeconds: durationPlan.targetDurationSeconds,
			maximumClipCount: 64,
			requiresStableClipIds: true,
			requiresSpeechLedgerConservation: true,
			requiresObjectContinuity: true,
		},
	});
	try {
	const beatSheet = beatSheetFacts(input.beatSheetAgentResult);
	const beats = beatSheet.beats;
	if (beats.length === 0 || beats.length > 64) {
		throw new Error(`BeatSheet must contain 1..64 semantic clips; actual=${beats.length}`);
	}
	assertWorkflowSpeechLedgerConservation({ context: beatSheet.context, beats });
	const chapterArc = workflowChapterArc(beatSheet.context);
	const sourceReceipt = workflowSourceReceipt(beatSheet.context);
	const sequenceBeats = beats.map(workflowSequenceBeat);
	let totalDurationSeconds = 0;
	const beatRecords: JsonRecord[] = [];
	const actualClipDurations: number[] = [];
	const itemIds = beats.map((beat, index) => {
		if (!isRecord(beat)) throw new Error(`BeatSheet clip ${index + 1} must be an object`);
		beatRecords.push(beat);
		const clipId = readString(beat.clipId);
		if (!clipId) throw new Error(`BeatSheet clip ${index + 1} requires a stable clipId`);
		const durationSeconds = beat.durationSeconds;
		if (
			typeof durationSeconds !== "number"
			|| !Number.isInteger(durationSeconds)
			|| !durationPlan.durationOptions.includes(durationSeconds)
		) {
			throw new Error(
				`BeatSheet clip ${index + 1} duration must use one live model option ${JSON.stringify(durationPlan.durationOptions)}; actual=${String(durationSeconds)}`,
			);
		}
		actualClipDurations.push(durationSeconds);
		totalDurationSeconds += durationSeconds;
		return clipId;
	});
	if (new Set(itemIds).size !== itemIds.length) throw new Error("BeatSheet clipId values must be unique");
	const frozenProviderTopology = durationPlan.providerSubmissionTopology ?? null;
	const frozenProviderDurations = frozenProviderTopology?.minimumClipDurations ?? null;
	if (frozenProviderDurations && frozenProviderTopology?.source === "user_clip_durations") {
		if (
			actualClipDurations.length > frozenProviderDurations.length
			|| actualClipDurations.some((duration, index) => duration !== frozenProviderDurations[index])
		) {
			throw new Error(
				`BeatSheet clip durations must preserve the frozen provider topology: expected=${JSON.stringify(frozenProviderDurations)}:actual=${JSON.stringify(actualClipDurations)}`,
			);
		}
	}
	if (
		frozenProviderTopology
		&& beatSheet.durationCoverage === "complete"
		&& (frozenProviderTopology.source === "user_clip_count" || frozenProviderTopology.source === "user_clip_durations")
		&& actualClipDurations.length !== frozenProviderTopology.expectedClipCount
	) {
		throw new Error(
			`Complete BeatSheet clip count must preserve the user-authorized provider count: expected=${frozenProviderTopology.expectedClipCount}:actual=${actualClipDurations.length}`,
		);
	}
	if (
		durationPlan.targetDurationSeconds !== null
		&& beatSheet.durationCoverage === "complete"
		&& totalDurationSeconds !== durationPlan.targetDurationSeconds
	) {
		throw new Error(
			`BeatSheet semantic clip durations must exactly equal the authorized total: expected=${durationPlan.targetDurationSeconds}:actual=${totalDurationSeconds}`,
		);
	}
	if (
		durationPlan.targetDurationSeconds !== null
		&& beatSheet.durationCoverage === "prefix"
		&& totalDurationSeconds > durationPlan.targetDurationSeconds
	) {
		throw new Error(
			`BeatSheet prefix clip durations must not exceed the authorized total: expectedAtMost=${durationPlan.targetDurationSeconds}:actual=${totalDurationSeconds}`,
		);
	}
	const objectContractsByBeat = validateWorkflowBeatObjectContinuity(beatRecords);
	return createWorkflowCollection({
		collectionId: `${input.executionId}:${input.nodeId}:clip-contexts`,
		producerNodeId: input.nodeId,
		producerPortId: "clip-contexts",
		itemIds,
		values: beats.map((beat, index) => {
			if (!isRecord(beat)) throw new Error(`BeatSheet clip ${index + 1} must be an object`);
			const frozenObjectContracts = objectContractsByBeat[index] ?? [];
			const assetObjectContracts = frozenObjectContracts.map((contract) => ({ ...contract }));
			const sourceDialogue = parseWorkflowDialogueScript(beat.dialogueScript, `beats[${index}].dialogueScript`);
			const spokenScript = workflowBeatSpokenScript(beat, `beats[${index}]`);
			const canonicalBeat = {
				...beat,
				speakers: collectSpokenSpeakerNames(spokenScript),
			};
			const dialoguePaceRate = typeof beat.dialoguePaceRate === "number" && Number.isFinite(beat.dialoguePaceRate) && beat.dialoguePaceRate > 0
				? beat.dialoguePaceRate
				: 4;
			const storyEvents = Array.isArray(beat.storyEvents) ? beat.storyEvents : [];
			const exitState = readString(beat.exitState);
			const durationSeconds = Number(beat.durationSeconds);
			return {
				executionScope,
				clipIndex: index,
				beat: canonicalBeat,
				sourceReceipt,
				sequenceContext: {
					chapterArc,
					previous: sequenceBeats[index - 1] ?? null,
					current: sequenceBeats[index],
					next: sequenceBeats[index + 1] ?? null,
				},
				spokenScript,
				sourceDialogueLineIds: sourceDialogue.map((line) => line.lineId),
				dialoguePaceRate,
				assetPlans: [],
				// Writer receives the exact canonical object grammar it must preserve.
				// The stable assetId remains alongside the structural object identity so
				// generation-time exact-set validation and Prompt Package compilation share
				// one declaration instead of asking the model to translate assetPlans.
				assetObjectContracts,
			};
		}),
	});
	} catch (error: unknown) {
		if (error instanceof WorkflowInputContractError) throw error;
		throw new WorkflowInputContractError({
			targetPortId: "beat-sheet",
			expectedContract: beatSheetExpectation,
			cause: error,
		});
	}
}

export function buildWorkflowPromptPackage(input: Readonly<{
	executionId: string;
	workflowKey: string | null;
	clipPromptCollection: unknown;
	clipContextCollection: unknown;
	assetPlanCollection?: unknown;
}>): WorkflowPromptPackage {
	if (!isWorkflowCollection(input.clipPromptCollection)) {
		throw new Error("Prompt package requires a WorkflowCollection of clip prompt results");
	}
	if (input.clipPromptCollection.items.length === 0) {
		throw new Error("Prompt package cannot persist an empty clip collection");
	}
	const clipContextCollection = input.clipContextCollection;
	if (!isWorkflowCollection(clipContextCollection)) {
		throw new Error("Prompt package requires the original WorkflowCollection of clip contexts");
	}
	if (
		input.clipPromptCollection.items.length !== clipContextCollection.items.length
		|| input.clipPromptCollection.items.some((item, index) => item.itemId !== clipContextCollection.items[index]?.itemId)
	) {
		throw new Error("Prompt and clip-context collections must have identical item identities and order");
	}
	const assetPlans = optionalAssetPlans(input.assetPlanCollection);
	const hasAssetPlanContract = input.assetPlanCollection !== undefined
		&& input.assetPlanCollection !== null;
	const clips = input.clipPromptCollection.items.map((item) => {
		const field = `clipPrompts[${item.index}]`;
		const writerText = agentText(item.value, field);
		const contextItem = clipContextCollection.items[item.index]?.value;
		const executionScope = isRecord(contextItem) ? readString(contextItem.executionScope) : "";
		if (executionScope !== "prompt_only" && executionScope !== "media_delivery") {
			throw new Error(`clipContexts[${item.index}] requires an immutable executionScope`);
		}
		if (executionScope === "prompt_only" && assetPlans.length > 0) {
			throw new Error("Prompt-only package must not receive visual asset plans");
		}
		const clipAssetPlans = executionScope === "media_delivery"
			? assetPlans.filter((plan) => plan.consumerClipIds.includes(item.itemId))
			: [];
		const assetBindings = clipAssetPlans.map((plan) => ({
			assetId: plan.assetId,
			...parseWorkflowAssetRole(plan.role, `Clip ${item.itemId} asset ${plan.assetId}.role`),
		}));
		const declaredAssetIds = assetBindings.map((binding) => binding.assetId);
		const durationSeconds = (() => {
			const beat = isRecord(contextItem) && isRecord(contextItem.beat) ? contextItem.beat : null;
			const duration = beat?.durationSeconds;
			if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
				throw new Error(`clipContexts[${item.index}] requires a positive durationSeconds`);
			}
			return duration;
		})();
		const spokenScript = (() => {
			if (!isRecord(contextItem) || !Array.isArray(contextItem.spokenScript)) {
				throw new Error(`clipContexts[${item.index}].spokenScript must be a frozen array`);
			}
			return parseWorkflowDialogueScript(contextItem.spokenScript, `clipContexts[${item.index}].spokenScript`, false);
		})();
		const dialoguePaceRate = isRecord(contextItem) && typeof contextItem.dialoguePaceRate === "number"
			? contextItem.dialoguePaceRate
			: 4;
		const sourceDialogueLineIds = isRecord(contextItem) && Array.isArray(contextItem.sourceDialogueLineIds)
			? uniqueNonEmptyStrings(contextItem.sourceDialogueLineIds)
			: [];
		if (sourceDialogueLineIds.some((lineId) => !spokenScript.some((line) => line.lineId === lineId))) {
			throw new Error(`clipContexts[${item.index}].sourceDialogueLineIds must be a subset of spokenScript line ids`);
		}
		if (!isRecord(contextItem) || !isRecord(contextItem.beat)) {
			throw new Error(`clipContexts[${item.index}] requires a frozen beat object`);
		}
		const clipIndex = contextItem.clipIndex;
		if (!Number.isInteger(clipIndex) || clipIndex !== item.index) {
			throw new Error(`clipContexts[${item.index}].clipIndex must equal physical order ${item.index}`);
		}
		if (!Array.isArray(contextItem.beat.characters)) {
			throw new Error(`clipContexts[${item.index}].characters must be a frozen array`);
		}
		const characterRoleNames = Array.isArray(contextItem.beat.characters)
			? contextItem.beat.characters.map(readString).filter(Boolean)
			: [];
		const exitState = readString(contextItem.beat.exitState);
		const storyEvents = Array.isArray(contextItem.beat.storyEvents) ? contextItem.beat.storyEvents : [];
		if (characterRoleNames.length !== contextItem.beat.characters.length || !exitState || storyEvents.length === 0) {
			throw new Error(`clipContexts[${item.index}] requires a valid frozen characters array, exitState and storyEvents`);
		}
		const expectedAssetObjectContracts = parseWorkflowClipAssetObjectContracts(
			contextItem.assetObjectContracts,
			`clipContexts[${item.index}].assetObjectContracts`,
		);
		// A media-delivery prompt package may deliberately be compiled before the
		// visual-asset branch exists (for example, a fast T2V submission). Omission
		// of the asset-plan input is the structural contract for that mode: preserve
		// the frozen object ledger without inventing asset IDs. Once an asset-plan
		// collection is actually connected, coverage remains strict — including an
		// explicitly empty collection, which cannot masquerade as an omitted input.
		const outputAssetObjectContracts = executionScope === "media_delivery" && hasAssetPlanContract
			? bindWorkflowClipAssetObjectContracts({
				contracts: expectedAssetObjectContracts,
				assetBindings,
				field: `clipContexts[${item.index}].assetObjectContracts`,
			})
			: expectedAssetObjectContracts;
		const compiled = structuredClipFromWriter({
			text: writerText,
			itemId: item.itemId,
			clipIndex: item.index,
			durationSeconds,
			assetBindings,
			expectedAssetObjectContracts,
			outputAssetObjectContracts,
			storyEvents,
			characterRoleNames,
			exitState,
			spokenScript,
			sourceDialogueLineIds,
			dialoguePaceRate,
			field: `${field}.text`,
		});
		const writerEnvelopeCharacters = Array.from(writerText).length;
		const providerPromptCharacters = Array.from(compiled.prompt).length;
		const providerToEnvelopeRatio = writerEnvelopeCharacters > 0
			? Math.round((providerPromptCharacters / writerEnvelopeCharacters) * 10_000) / 10_000
			: 0;
		return {
			itemId: item.itemId,
			index: item.index,
			prompt: compiled.prompt,
			durationSeconds,
			declaredAssetIds,
			structuredClip: compiled.structuredClip,
			assetBindings,
			authoringEvidence: compiled.authoringEvidence,
			promptMetrics: {
				writerEnvelopeCharacters,
				providerPromptCharacters,
				providerToEnvelopeRatio,
			},
			lineage: item.lineage,
		};
	});
	const writerEnvelopeCharacters = clips.reduce(
		(total, clip) => total + clip.promptMetrics.writerEnvelopeCharacters,
		0,
	);
	const providerPromptCharacters = clips.reduce(
		(total, clip) => total + clip.promptMetrics.providerPromptCharacters,
		0,
	);
	return {
		protocolVersion: "2",
		artifactType: "tapcanvas.prompt-package/v2",
		executionId: input.executionId,
		workflowKey: input.workflowKey ?? "tapcanvas.video-production",
		clips,
		deliveryEvidence: {
			version: 2,
			source: "workflow_prompt_package",
			clipCount: clips.length,
			totalDurationSeconds: clips.reduce((total, clip) => total + clip.durationSeconds, 0),
			sourceSpeechLineCount: clips.reduce((total, clip) => total + clip.authoringEvidence.sourceDialogueLineIds.length, 0),
			narrativeSpeechLineCount: clips.reduce(
				(total, clip) => total + clip.authoringEvidence.spokenLineIds.length - clip.authoringEvidence.sourceDialogueLineIds.length,
				0,
			),
			executableSpeechLineCount: clips.reduce((total, clip) => total + clip.authoringEvidence.spokenLineIds.length, 0),
			assetBindingCount: clips.reduce((total, clip) => total + clip.assetBindings.length, 0),
			embeddedAuthoringReviewCount: clips.filter((clip) => (clip.authoringEvidence.creativeReview?.iterations ?? 0) > 0).length,
			writerEnvelopeCharacters,
			providerPromptCharacters,
			providerToEnvelopeRatio: writerEnvelopeCharacters > 0
				? Math.round((providerPromptCharacters / writerEnvelopeCharacters) * 10_000) / 10_000
				: 0,
		},
		deliveryVerification: {
			version: 2,
			status: "satisfied",
			verifiedBy: "workflow_prompt_package_contract",
		},
	};
}

export function buildVideoProductionPlan(input: Readonly<{
	executionId: string;
	nodeId: string;
	promptPackage: unknown;
	estimate: unknown;
	generationContract?: unknown;
	assetBindings: unknown;
	voiceManifest: WorkflowVoiceManifest;
	referenceAudioPolicy?: "required" | "optional";
}>): WorkflowCollectionV1 {
	if (!isRecord(input.promptPackage) || !Array.isArray(input.promptPackage.clips)) {
		throw new Error("Production handoff requires a persisted prompt package");
	}
	const promptPackageAdmission = inspectWorkflowPromptPackageAdmission(input.promptPackage);
	if (!promptPackageAdmission.structurallyValid) {
		throw new Error(`Production handoff requires structurally valid prompt package provenance: ${promptPackageAdmission.issues.join("; ")}`);
	}
	if (!isRecord(input.estimate)) throw new Error("Production handoff requires a fresh video estimate");
	const estimateIdentity = readString(input.estimate.estimateIdentity);
	const modelKey = readString(input.estimate.modelKey);
	const resolution = readString(input.estimate.resolution);
	const aspectRatio = readString(input.estimate.aspectRatio);
	const estimateGenerationContract = parseVideoGenerationContract(input.estimate.generationContract);
	const configuredGenerationContract = parseVideoGenerationContract(input.generationContract);
	if (input.generationContract !== undefined && !configuredGenerationContract) {
		throw new Error("Production handoff configured generationContract is invalid");
	}
	if (
		estimateGenerationContract
		&& configuredGenerationContract
		&& JSON.stringify(estimateGenerationContract) !== JSON.stringify(configuredGenerationContract)
	) {
		throw new Error("Production handoff estimate and configured generationContract disagree");
	}
	const generationContract = estimateGenerationContract ?? configuredGenerationContract;
	if (!estimateIdentity || !modelKey || !resolution || !aspectRatio) {
		throw new Error("Video estimate is missing its identity or frozen provider parameters");
	}
	if (generationContract && generationContract.videoModel !== modelKey) {
		throw new Error("Production handoff generationContract model does not match the estimate model");
	}
	if (!isWorkflowCollection(input.assetBindings)) {
		throw new Error("Production handoff requires the completed generated asset binding collection");
	}
	if (input.voiceManifest.protocolVersion !== "tapcanvas.voice-manifest/v1") {
		throw new Error("Production handoff requires a frozen voice manifest");
	}
	const voiceBySpeaker = new Map(input.voiceManifest.entries.map((entry) => [entry.speakerName, entry] as const));
	if (voiceBySpeaker.size !== input.voiceManifest.entries.length) {
		throw new Error("Production handoff voice manifest contains duplicate speakers");
	}
	type ResolvedAssetReference = Readonly<{
		nodeId: string | null;
		assetId: string | null;
	}>;
	const referenceByAssetId = new Map<string, ResolvedAssetReference>();
	for (const [index, item] of input.assetBindings.items.entries()) {
		if (!isRecord(item.value) || !isRecord(item.value.assetPlan)) {
			throw new Error(`Generated asset binding ${index + 1} must contain its validated assetPlan`);
		}
		const assetId = readString(item.value.assetPlan.assetId);
		const nodeId = readString(item.value.nodeId);
		const generatedAssetId = readString(item.value.generatedAssetId);
		const imageUrl = readString(item.value.imageUrl);
		if (!assetId || !nodeId || !imageUrl) {
			throw new Error(`Generated asset binding ${index + 1} requires assetId, nodeId and persistent imageUrl`);
		}
		try {
			const parsed = new URL(imageUrl);
			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
		} catch {
			throw new Error(`Generated asset binding ${assetId} imageUrl is not persistent HTTP(S)`);
		}
		if (referenceByAssetId.has(assetId)) throw new Error(`Generated asset binding ${assetId} is duplicated`);
		referenceByAssetId.set(assetId, {
			nodeId: generatedAssetId ? null : nodeId,
			assetId: generatedAssetId || null,
		});
	}
	const clips = input.promptPackage.clips.map((value, index) => {
		if (!isRecord(value)) throw new Error(`Prompt package clip ${index + 1} must be an object`);
		const itemId = readString(value.itemId);
		const durationSeconds = value.durationSeconds;
		const structuredClip = isRecord(value.structuredClip) ? value.structuredClip : null;
		const promptAssetBindings = Array.isArray(value.assetBindings)
			? value.assetBindings.map((binding, bindingIndex) => {
				if (!isRecord(binding)) throw new Error(`Prompt package clip ${index + 1} assetBindings[${bindingIndex}] must be an object`);
				const assetId = readString(binding.assetId);
				const kind = readString(binding.kind) as AssetObjectKind;
				const name = readString(binding.name);
				const referenceRole = readString(binding.referenceRole) as AssetReferenceRole;
				if (!assetId || !ASSET_OBJECT_KINDS.includes(kind) || !name || !ASSET_REFERENCE_ROLES.includes(referenceRole)) {
					throw new Error(`Prompt package clip ${index + 1} assetBindings[${bindingIndex}] is invalid`);
				}
				return { assetId, kind, name, referenceRole };
			})
			: [];
		const declaredAssetIds = Array.isArray(value.declaredAssetIds)
			? uniqueNonEmptyStrings(value.declaredAssetIds)
			: [];
		if (!itemId || !structuredClip || typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
			throw new Error(`Prompt package clip ${index + 1} has an invalid identity, structured clip or duration`);
		}
		const declaredReferences = declaredAssetIds.map((assetId) => {
			const reference = referenceByAssetId.get(assetId);
			if (!reference) throw new Error(`Prompt package clip ${index + 1} declares ungenerated asset ${assetId}`);
			return reference;
		});
		const referenceImageNodeIds = uniqueNonEmptyStrings(declaredReferences.flatMap((reference) => reference.nodeId ? [reference.nodeId] : []));
		const referenceAssetIds = uniqueNonEmptyStrings(declaredReferences.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
		assertExactAssetIds({
			actual: promptAssetBindings.map((binding) => binding.assetId),
			expected: declaredAssetIds,
			field: `Prompt package clip ${index + 1}`,
		});
		const contracts = canonicalAssetContracts(
			structuredClip.assetObjectContracts,
			`Prompt package clip ${index + 1}.structuredClip.assetObjectContracts`,
		).map((contract) => ({
			...contract,
			referenceImageNodeIds: promptAssetBindings
				.filter((binding) => (
					binding.kind === contract.kind
					&& binding.name === (contract.kind === "character" ? contract.physicalIdentityKey : contract.name)
				))
				.flatMap((binding) => {
					const reference = referenceByAssetId.get(binding.assetId);
					if (!reference) throw new Error(`Prompt package clip ${index + 1} declares ungenerated asset ${binding.assetId}`);
					return reference.nodeId ? [reference.nodeId] : [];
				}),
			referenceAssetIds: promptAssetBindings
				.filter((binding) => (
					binding.kind === contract.kind
					&& binding.name === (contract.kind === "character" ? contract.physicalIdentityKey : contract.name)
				))
				.flatMap((binding) => {
					const reference = referenceByAssetId.get(binding.assetId);
					if (!reference) throw new Error(`Prompt package clip ${index + 1} declares ungenerated asset ${binding.assetId}`);
					return reference.assetId ? [reference.assetId] : [];
				}),
		}));
		const speakerNames = Array.isArray(structuredClip.speakerBindings)
			? structuredClip.speakerBindings.flatMap((binding) => (
				isRecord(binding) && readString(binding.name) ? [readString(binding.name)] : []
			))
			: [];
		const voiceEntries = speakerNames.flatMap((speakerName) => {
			const entry = voiceBySpeaker.get(speakerName);
			if (!entry && input.referenceAudioPolicy === "optional") return [];
			if (!entry) throw new Error(`Production handoff voice manifest is missing speaker ${speakerName}`);
			return [entry];
		});
		const executableClip: StructuredClip & Record<string, unknown> = {
			...structuredClip,
			assetObjectContracts: contracts,
			voiceBinding: voiceEntries.map((entry) => ({
				character: entry.speakerName,
				voiceId: entry.voiceId,
				voiceLabel: entry.voiceLabel,
				nodeId: entry.nodeId,
				audioUrl: entry.audioUrl,
				audioDurationSec: entry.audioDurationSec,
				referenceSamplePurpose: "frozen_voice_card",
			})),
			referenceAudioUrls: voiceEntries.map((entry) => entry.audioUrl),
			referenceAudioRequired: voiceEntries.length > 0 && input.referenceAudioPolicy !== "optional",
		} as StructuredClip & Record<string, unknown>;
		const compiled = compileStructuredClipForExecution(executableClip);
		const prompt = readString(compiled.clipPrompt);
		if (!prompt) throw new Error(`Prompt package clip ${index + 1} compiled to an empty execution prompt`);
		return {
			itemId,
			prompt,
			durationSeconds,
			declaredAssetIds,
			referenceImageNodeIds,
			referenceAssetIds,
			structuredClip: executableClip,
		};
	});
	if (new Set(clips.map((clip) => clip.itemId)).size !== clips.length) {
		throw new Error("Production plan clip identities must be unique");
	}
	const consumedAssetIds = new Set(clips.flatMap((clip) => clip.declaredAssetIds));
	const orphanAssetIds = [...referenceByAssetId.keys()].filter((assetId) => !consumedAssetIds.has(assetId));
	if (orphanAssetIds.length > 0) {
		throw new Error(`Generated assets have no Clip consumer: ${orphanAssetIds.join(",")}`);
	}
	const missingAssetIds = [...consumedAssetIds].filter((assetId) => !referenceByAssetId.has(assetId));
	if (missingAssetIds.length > 0) {
		throw new Error(`Clip asset declarations were not generated: ${missingAssetIds.join(",")}`);
	}
	const consumedSpeakerNames = new Set(clips.flatMap((clip) => (
		Array.isArray(clip.structuredClip.speakerBindings)
			? clip.structuredClip.speakerBindings.flatMap((binding) => (
				isRecord(binding) && readString(binding.name) ? [readString(binding.name)] : []
			))
			: []
	)));
	const orphanVoiceSpeakers = [...voiceBySpeaker.keys()].filter((speakerName) => !consumedSpeakerNames.has(speakerName));
	if (orphanVoiceSpeakers.length > 0) {
		throw new Error(`Voice manifest contains speakers with no Clip consumer: ${orphanVoiceSpeakers.join(",")}`);
	}
	return createWorkflowCollection({
		collectionId: `${input.executionId}:${input.nodeId}:production-plan`,
		producerNodeId: input.nodeId,
		producerPortId: "production-plan",
		itemIds: clips.map((clip) => clip.itemId),
		values: clips.map((clip) => ({
			...clip,
			videoReferencePolicy: WORKFLOW_VIDEO_REFERENCE_POLICY,
			modelKey,
			resolution,
			aspectRatio,
			estimateIdentity,
			...(generationContract ? { generationContract } : {}),
		})),
	});
}
