import {
	VIDEO_ATOMIC_WORKFLOW_NODE_IDS,
	VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION,
	VIDEO_PRODUCTION_WORKFLOW_KEY,
	type VideoAtomicWorkflowNodeId,
	type VideoAtomicWorkflowNodeProjection,
	type VideoAtomicWorkflowOutputRefs,
	type VideoAtomicWorkflowSnapshot,
	type VideoAuthoringExecutionScope,
	type VideoProductionWorkflowNodeStatus,
} from "@tapcanvas/video-orchestrator-protocol";

export type VideoAtomicWorkflowRunFact = Readonly<{
	id: string;
	state: string;
	authoring_state: string | null;
	beat_sheet: string | null;
	total_clips: number;
	clips_done: number;
	error_message: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
}>;

export type VideoAtomicWorkflowArtifactFact = Readonly<{
	artifact_key: string;
	status: string;
	payload: string | null;
	error: string | null;
	created_at: string;
	updated_at: string;
}>;

export type VideoAtomicWorkflowEffectFact = Readonly<{
	id: string;
	effect_key: string;
	operation: string;
	status: string;
	provider: string | null;
	provider_task_id: string | null;
	asset_url: string | null;
	error_code: string | null;
	error_message: string | null;
	created_at: string;
	updated_at: string;
	accepted_at: string | null;
	materialized_at: string | null;
	finished_at: string | null;
}>;

type ParsedPayload = Readonly<{
	value: unknown;
	error: string | null;
}>;

type NodeBuildInput = Readonly<{
	atomicNodeId: VideoAtomicWorkflowNodeId;
	artifacts: readonly VideoAtomicWorkflowArtifactFact[];
	effects?: readonly VideoAtomicWorkflowEffectFact[];
	inputArtifactIds: readonly string[];
	outputArtifactIds?: readonly string[];
	totalUnits?: number | null;
	completedUnits?: number;
	status?: VideoProductionWorkflowNodeStatus;
	startedAt?: string | null;
	updatedAt?: string | null;
	outputRefs?: VideoAtomicWorkflowOutputRefs;
	extraErrors?: readonly string[];
}>;

const OUTPUT_PORT_BY_NODE: Readonly<Record<VideoAtomicWorkflowNodeId, string>> = {
	"canvas-source": "canvas-facts",
	"delivery-contract": "delivery-contract",
	"beat-sheet-agent": "beat-sheet-draft",
	"beat-sheet-format": "beat-sheet",
	"asset-coverage": "asset-plans",
	"asset-fan-out": "asset-items",
	"asset-image-generate": "asset-bindings",
	"clip-fan-out": "clip-contexts",
	"clip-writer-agent": "clip-prompts",
	"prompt-package": "prompt-package",
	"voice-catalog": "voice-catalog",
	"voice-plan-agent": "voice-plan",
	"voice-materialize": "voice-manifest",
	"cost-estimate": "estimate",
	"production-handoff": "production-plan",
	"video-submit": "provider-receipts",
	"video-results": "video-assets",
	concat: "master-video",
	"delivery-verify": "delivery-evidence",
};

const ARTIFACT_TYPE_BY_NODE: Readonly<Record<VideoAtomicWorkflowNodeId, string>> = {
	"canvas-source": "tapcanvas.canvas-facts/v1",
	"delivery-contract": "tapcanvas.delivery-contract/v2",
	"beat-sheet-agent": "tapcanvas.beat-sheet-draft/v1",
	"beat-sheet-format": "tapcanvas.beat-sheet/v2",
	"asset-coverage": "tapcanvas.asset-plans/v1",
	"asset-fan-out": "tapcanvas.asset-plan-items/v2",
	"asset-image-generate": "tapcanvas.asset-bindings/v1",
	"clip-fan-out": "tapcanvas.clip-contracts/v1",
	"clip-writer-agent": "tapcanvas.clip-prompt/v2",
	"prompt-package": "tapcanvas.prompt-package/v2",
	"voice-catalog": "tapcanvas.voice-catalog/v1",
	"voice-plan-agent": "tapcanvas.voice-plan/v1",
	"voice-materialize": "tapcanvas.voice-manifest/v1",
	"cost-estimate": "tapcanvas.video-estimate/v1",
	"production-handoff": "tapcanvas.production-plan/v1",
	"video-submit": "tapcanvas.provider-receipt/v1",
	"video-results": "tapcanvas.video/v1",
	concat: "tapcanvas.video/v1",
	"delivery-verify": "tapcanvas.delivery-evidence/v2",
};

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readNonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parsePayload(artifact: VideoAtomicWorkflowArtifactFact): ParsedPayload {
	if (artifact.payload === null) return { value: null, error: null };
	try {
		return { value: JSON.parse(artifact.payload) as unknown, error: null };
	} catch {
		return {
			value: artifact.payload,
			error: `artifact_payload_invalid_json:${artifact.artifact_key}`,
		};
	}
}

function exactClipIndex(key: string, prefix: string): number | null {
	if (!key.startsWith(prefix)) return null;
	const suffix = key.slice(prefix.length);
	if (!suffix || [...suffix].some((character) => character < "0" || character > "9")) return null;
	const index = Number(suffix);
	return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function latestTimestamp(values: readonly (string | null | undefined)[]): string | null {
	let latest: string | null = null;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const value of values) {
		if (!value) continue;
		const timestamp = Date.parse(value);
		if (!Number.isFinite(timestamp) || timestamp <= latestMs) continue;
		latest = value;
		latestMs = timestamp;
	}
	return latest;
}

function earliestTimestamp(values: readonly (string | null | undefined)[]): string | null {
	let earliest: string | null = null;
	let earliestMs = Number.POSITIVE_INFINITY;
	for (const value of values) {
		if (!value) continue;
		const timestamp = Date.parse(value);
		if (!Number.isFinite(timestamp) || timestamp >= earliestMs) continue;
		earliest = value;
		earliestMs = timestamp;
	}
	return earliest;
}

function artifactStatus(status: string): VideoProductionWorkflowNodeStatus {
	if (status === "ready") return "succeeded";
	if (status === "running") return "running";
	if (status === "waiting_external") return "waiting_external";
	if (status === "failed") return "failed";
	if (status === "stale") return "partial";
	return "queued";
}

function effectStatus(status: string): VideoProductionWorkflowNodeStatus {
	if (status === "materialized") return "succeeded";
	if (status === "accepted" || status === "uncertain") return "waiting_external";
	if (status === "submitting") return "running";
	if (status === "failed" || status === "rejected_pre_upstream") return "failed";
	return "queued";
}

function aggregateStatus(
	statuses: readonly VideoProductionWorkflowNodeStatus[],
	totalUnits: number | null,
): VideoProductionWorkflowNodeStatus {
	if (statuses.includes("running")) return "running";
	if (statuses.includes("waiting_external")) return "waiting_external";
	const succeeded = statuses.filter((status) => status === "succeeded").length;
	if (statuses.includes("failed")) return succeeded > 0 ? "partial" : "failed";
	if (statuses.includes("partial")) return "partial";
	if (totalUnits !== null && totalUnits > 0 && succeeded >= totalUnits) return "succeeded";
	if (succeeded > 0) return "partial";
	return "queued";
}

function isFinished(status: VideoProductionWorkflowNodeStatus): boolean {
	return status === "succeeded" || status === "failed" || status === "cancelled";
}

function timing(
	status: VideoProductionWorkflowNodeStatus,
	startedAt: string | null,
	updatedAt: string | null,
): VideoAtomicWorkflowNodeProjection["timing"] {
	const finishedAt = isFinished(status) ? updatedAt : null;
	const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
	const finishedMs = finishedAt ? Date.parse(finishedAt) : Number.NaN;
	return {
		startedAt,
		updatedAt,
		finishedAt,
		durationMs: Number.isFinite(startedMs) && Number.isFinite(finishedMs)
			? Math.max(0, Math.trunc(finishedMs - startedMs))
			: null,
	};
}

function itemStatus(status: VideoProductionWorkflowNodeStatus): string {
	if (status === "succeeded") return "success";
	if (status === "partial") return "failed";
	if (status === "cancelled") return "failed";
	return status;
}

function promptFromPayload(value: unknown): string | null {
	const payload = readRecord(value);
	const clip = readRecord(payload?.clip);
	return readNonEmptyString(clip?.clipPrompt) ?? readNonEmptyString(payload?.clipPrompt);
}

function videoUrlFromPayload(value: unknown): string | null {
	const payload = readRecord(value);
	const deliveryEvidence = readRecord(payload?.deliveryEvidence);
	return readNonEmptyString(payload?.videoUrl) ?? readNonEmptyString(deliveryEvidence?.videoUrl);
}

type AssetCoverageProjection = Readonly<{
	required: readonly Record<string, unknown>[];
	available: readonly Record<string, unknown>[];
	missing: readonly Record<string, unknown>[];
	requiredCount: number;
	availableCount: number;
	complete: boolean;
}>;

function assetIdentity(value: Record<string, unknown>, index: number): string {
	const kind = readNonEmptyString(value.kind) ?? "asset";
	const name = readNonEmptyString(value.name) ?? `item-${index}`;
	const stateVersionId = readNonEmptyString(value.stateVersionId);
	const stateKey = readNonEmptyString(value.stateKey);
	return [kind, name, stateVersionId, stateKey].filter((part): part is string => Boolean(part)).join(":");
}

function assetCoverageProjection(artifact: VideoAtomicWorkflowArtifactFact | undefined): AssetCoverageProjection | null {
	if (!artifact) return null;
	const payload = readRecord(parsePayload(artifact).value);
	if (!payload) return null;
	const required = Array.isArray(payload.required) ? payload.required.flatMap((value) => {
		const record = readRecord(value);
		return record ? [record] : [];
	}) : [];
	const available = Array.isArray(payload.available) ? payload.available.flatMap((value) => {
		const record = readRecord(value);
		return record ? [record] : [];
	}) : [];
	const missing = Array.isArray(payload.missing) ? payload.missing.flatMap((value) => {
		const record = readRecord(value);
		return record ? [record] : [];
	}) : [];
	const requiredCount = typeof payload.requiredCount === "number" && Number.isInteger(payload.requiredCount) && payload.requiredCount >= 0
		? payload.requiredCount
		: required.length;
	const availableCount = typeof payload.availableCount === "number" && Number.isInteger(payload.availableCount) && payload.availableCount >= 0
		? payload.availableCount
		: available.length;
	return {
		required,
		available,
		missing,
		requiredCount,
		availableCount,
		complete: payload.complete === true,
	};
}

function virtualAssetOutput(input: Readonly<{
	runId: string;
	nodeId: "asset-fan-out" | "asset-image-generate";
	coverage: AssetCoverageProjection;
}>): VideoAtomicWorkflowOutputRefs {
	const availableIdentities = new Set(input.coverage.available.map(assetIdentity));
	const portId = OUTPUT_PORT_BY_NODE[input.nodeId];
	const itemRuns = input.coverage.required.map((asset, index) => {
		const itemId = assetIdentity(asset, index);
		const available = availableIdentities.has(itemId);
		return {
			itemId,
			index,
			status: input.nodeId === "asset-fan-out" ? "success" : available ? "success" : "waiting_external",
			runtimeNodeId: `${input.nodeId}::item::${encodeURIComponent(itemId)}`,
			errorMessage: null,
			ports: { [portId]: asset },
			artifacts: [],
			evidence: { identity: itemId, available },
		};
	});
	return {
		ports: { [portId]: input.coverage.required },
		artifacts: [],
		evidence: {
			sourceArtifactId: "asset:coverage",
			requiredCount: input.coverage.requiredCount,
			availableCount: input.coverage.availableCount,
			missingCount: input.coverage.missing.length,
			complete: input.coverage.complete,
			runId: input.runId,
		},
		itemRuns,
	};
}

function defaultOutputRefs(
	atomicNodeId: VideoAtomicWorkflowNodeId,
	artifacts: readonly VideoAtomicWorkflowArtifactFact[],
): VideoAtomicWorkflowOutputRefs {
	const parsed = artifacts.map((artifact) => ({ artifact, payload: parsePayload(artifact) }));
	const port = OUTPUT_PORT_BY_NODE[atomicNodeId];
	const values = parsed.map((entry) => entry.payload.value);
	return {
		ports: values.length === 0 ? {} : { [port]: values.length === 1 ? values[0] : values },
		artifacts: parsed.map((entry) => ({
			identity: entry.artifact.artifact_key,
			type: ARTIFACT_TYPE_BY_NODE[atomicNodeId],
			value: entry.payload.value,
		})),
		evidence: { artifactCount: artifacts.length },
		itemRuns: [],
	};
}

function artifactItemRuns(
	atomicNodeId: VideoAtomicWorkflowNodeId,
	artifacts: readonly VideoAtomicWorkflowArtifactFact[],
): readonly Readonly<Record<string, unknown>>[] {
	return artifacts.flatMap((artifact) => {
		const clipIndex = exactClipIndex(artifact.artifact_key, atomicNodeId === "clip-writer-agent"
			? "clip:"
			: atomicNodeId === "video-submit" ? "video-submission:" : "video-result:");
		if (clipIndex === null) return [];
		const parsed = parsePayload(artifact);
		const status = artifactStatus(artifact.status);
		const videoUrl = atomicNodeId === "video-results" ? videoUrlFromPayload(parsed.value) : null;
		const text = atomicNodeId === "clip-writer-agent" ? promptFromPayload(parsed.value) : null;
		return [{
			itemId: `clip-${clipIndex}`,
			index: clipIndex,
			status: itemStatus(status),
			runtimeNodeId: artifact.artifact_key,
			errorMessage: artifact.error,
			ports: text ? { [OUTPUT_PORT_BY_NODE[atomicNodeId]]: { text, clipIndex } }
				: videoUrl ? { [OUTPUT_PORT_BY_NODE[atomicNodeId]]: { videoUrl, clipIndex } }
				: { [OUTPUT_PORT_BY_NODE[atomicNodeId]]: parsed.value },
			artifacts: videoUrl ? [{
				identity: artifact.artifact_key,
				type: "tapcanvas.video/v1",
				value: videoUrl,
			}] : [{
				identity: artifact.artifact_key,
				type: ARTIFACT_TYPE_BY_NODE[atomicNodeId],
				value: text ?? parsed.value,
			}],
			evidence: { clipIndex, artifactStatus: artifact.status },
		}];
	});
}

function effectItemRuns(
	effects: readonly VideoAtomicWorkflowEffectFact[],
): readonly Readonly<Record<string, unknown>>[] {
	return effects.flatMap((effect) => {
		const clipIndex = exactClipIndex(effect.effect_key, "video-clip:");
		if (clipIndex === null) return [];
		return [{
			itemId: `clip-${clipIndex}`,
			index: clipIndex,
			status: itemStatus(effectStatus(effect.status)),
			runtimeNodeId: effect.effect_key,
			errorMessage: effect.error_message,
			ports: {
				"provider-receipts": {
					clipIndex,
					provider: effect.provider,
					providerTaskId: effect.provider_task_id,
					status: effect.status,
				},
			},
			artifacts: [],
			evidence: {
				clipIndex,
				effectId: effect.id,
				provider: effect.provider,
				providerTaskId: effect.provider_task_id,
			},
		}];
	});
}

function buildNode(input: NodeBuildInput & Readonly<{
	runId: string;
	latestEventSeq: number;
}>): VideoAtomicWorkflowNodeProjection {
	const effects = input.effects ?? [];
	const statuses = [
		...input.artifacts.map((artifact) => artifactStatus(artifact.status)),
		...effects.map((effect) => effectStatus(effect.status)),
	];
	const totalUnits = input.totalUnits === undefined
		? (statuses.length > 0 ? statuses.length : null)
		: input.totalUnits;
	const projectedStatus = input.status ?? aggregateStatus(statuses, totalUnits);
	const completedUnits = statuses.filter((entry) => entry === "succeeded").length;
	const parsedPayloadErrors = input.artifacts.flatMap((artifact) => {
		const error = parsePayload(artifact).error;
		return error ? [error] : [];
	});
	const errors = [...new Set([
		...input.artifacts.flatMap((artifact) => artifact.error ? [artifact.error] : []),
		...effects.flatMap((effect) => effect.error_message ? [effect.error_message] : []),
		...parsedPayloadErrors,
		...(input.extraErrors ?? []),
	])];
	const status = errors.length > 0 && projectedStatus === "succeeded" ? "partial" : projectedStatus;
	const startedAt = input.startedAt === undefined
		? earliestTimestamp([
			...input.artifacts.map((artifact) => artifact.created_at),
			...effects.map((effect) => effect.created_at),
		])
		: input.startedAt;
	const updatedAt = input.updatedAt === undefined
		? latestTimestamp([
			...input.artifacts.map((artifact) => artifact.updated_at),
			...effects.map((effect) => effect.updated_at),
		])
		: input.updatedAt;
	return {
		workflowRunId: input.runId,
		atomicNodeId: input.atomicNodeId,
		status,
		completedUnits: input.completedUnits ?? (input.status === "succeeded" && statuses.length === 0
			? Math.max(1, totalUnits ?? 1)
			: completedUnits),
		totalUnits,
		inputArtifactIds: [...new Set(input.inputArtifactIds)].sort(),
		outputArtifactIds: [...new Set(input.outputArtifactIds ?? input.artifacts.map((artifact) => artifact.artifact_key))].sort(),
		effectIds: effects.map((effect) => effect.id).sort(),
		errorCount: errors.length,
		errorMessages: errors,
		timing: timing(status, startedAt ?? null, updatedAt ?? null),
		outputRefs: input.outputRefs ?? defaultOutputRefs(input.atomicNodeId, input.artifacts),
		latestEventSeq: input.latestEventSeq,
	};
}

function manifestScope(artifact: VideoAtomicWorkflowArtifactFact | undefined): VideoAuthoringExecutionScope | null {
	if (!artifact) return null;
	const payload = readRecord(parsePayload(artifact).value);
	return payload?.executionScope === "prompt_only" || payload?.executionScope === "media_delivery"
		? payload.executionScope
		: null;
}

function manifestClipIndexes(artifact: VideoAtomicWorkflowArtifactFact | undefined): number[] {
	if (!artifact) return [];
	const payload = readRecord(parsePayload(artifact).value);
	const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
	return [...new Set(nodes.flatMap((node) => {
		const record = readRecord(node);
		return record?.kind === "clip_writer" && typeof record.clipIndex === "number" && Number.isInteger(record.clipIndex) && record.clipIndex >= 0
			? [record.clipIndex]
			: [];
	}))].sort((left, right) => left - right);
}

export function buildVideoAtomicWorkflowSnapshot(input: Readonly<{
	run: VideoAtomicWorkflowRunFact;
	artifacts: readonly VideoAtomicWorkflowArtifactFact[];
	effects?: readonly VideoAtomicWorkflowEffectFact[];
	latestEventSeq?: number;
	generatedAt: string;
}>): VideoAtomicWorkflowSnapshot {
	const runId = input.run.id.trim();
	if (!runId) throw new Error("video_atomic_workflow_run_id_required");
	const latestEventSeq = Math.max(0, Math.trunc(input.latestEventSeq ?? 0));
	const effects = input.effects ?? [];
	const byKey = new Map(input.artifacts.map((artifact) => [artifact.artifact_key, artifact] as const));
	const exact = (key: string): VideoAtomicWorkflowArtifactFact[] => {
		const artifact = byKey.get(key);
		return artifact ? [artifact] : [];
	};
	const indexed = (prefix: string): VideoAtomicWorkflowArtifactFact[] => input.artifacts
		.filter((artifact) => exactClipIndex(artifact.artifact_key, prefix) !== null)
		.sort((left, right) => (exactClipIndex(left.artifact_key, prefix) ?? 0) - (exactClipIndex(right.artifact_key, prefix) ?? 0));
	const manifest = byKey.get("graph:manifest");
	const executionScope = manifestScope(manifest);
	const clipIndexes = manifestClipIndexes(manifest);
	const beatSheetDraft = exact("beat_sheet:draft");
	const beatSheet = exact("beat_sheet");
	const assetCoverage = exact("asset:coverage");
	const coverageProjection = assetCoverageProjection(assetCoverage[0]);
	const clips = indexed("clip:");
	const assembly = exact("assembly:verification");
	const promptPackage = exact("prompt:package");
	const estimate = exact("estimate:auto");
	const handoff = exact("production:handoff");
	const submissions = indexed("video-submission:");
	const results = indexed("video-result:");
	const concat = exact("concat:auto");
	const delivery = exact("delivery:verify");
	const videoEffects = effects.filter((effect) => exactClipIndex(effect.effect_key, "video-clip:") !== null);
	const sourceIdentity = `run:${runId}:canvas-source`;
	const sourceValue = {
		runId,
		state: input.run.state,
		authoringState: input.run.authoring_state,
		totalClips: input.run.total_clips,
	};
	const sourceOutput: VideoAtomicWorkflowOutputRefs = {
		ports: { "canvas-facts": sourceValue },
		artifacts: [{ identity: sourceIdentity, type: ARTIFACT_TYPE_BY_NODE["canvas-source"], value: sourceValue }],
		evidence: { runId, sourcePersisted: true },
		itemRuns: [],
	};
	const graphOutput = manifest ? defaultOutputRefs("delivery-contract", [manifest]) : defaultOutputRefs("delivery-contract", []);
	const fanOutItems = clipIndexes.map((clipIndex) => ({
		itemId: `clip-${clipIndex}`,
		index: clipIndex,
		status: "success",
		runtimeNodeId: `clip:${clipIndex}`,
		errorMessage: null,
		ports: { "clip-contexts": { clipIndex } },
		artifacts: [{ identity: `clip-context:${clipIndex}`, type: ARTIFACT_TYPE_BY_NODE["clip-fan-out"], value: { clipIndex } }],
		evidence: { clipIndex, graphManifest: "graph:manifest" },
	}));
	const fanOutOutput: VideoAtomicWorkflowOutputRefs = {
		ports: { "clip-contexts": clipIndexes.map((clipIndex) => ({ clipIndex })) },
		artifacts: fanOutItems.flatMap((item) => item.artifacts),
		evidence: { totalItems: clipIndexes.length, graphManifest: "graph:manifest" },
		itemRuns: fanOutItems,
	};
	const writerOutput: VideoAtomicWorkflowOutputRefs = {
		...defaultOutputRefs("clip-writer-agent", clips),
		evidence: { totalItems: clipIndexes.length, completedItems: clips.filter((artifact) => artifact.status === "ready").length },
		itemRuns: artifactItemRuns("clip-writer-agent", clips),
	};
	const submitOutput: VideoAtomicWorkflowOutputRefs = {
		ports: {
			"provider-receipts": videoEffects.map((effect) => ({
				effectId: effect.id,
				effectKey: effect.effect_key,
				provider: effect.provider,
				providerTaskId: effect.provider_task_id,
				status: effect.status,
			})),
		},
		artifacts: submissions.map((artifact) => ({
			identity: artifact.artifact_key,
			type: ARTIFACT_TYPE_BY_NODE["video-submit"],
			value: parsePayload(artifact).value,
		})),
		evidence: { totalItems: clipIndexes.length, effectCount: videoEffects.length },
		itemRuns: effectItemRuns(videoEffects),
	};
	const resultOutput: VideoAtomicWorkflowOutputRefs = {
		...defaultOutputRefs("video-results", results),
		evidence: { totalItems: clipIndexes.length, completedItems: results.filter((artifact) => artifact.status === "ready").length },
		itemRuns: artifactItemRuns("video-results", results),
	};
	const runFailed = input.run.state === "failed" || input.run.authoring_state === "authoring_failed";
	const parsedRunBeatSheet = input.run.beat_sheet
		? (() => {
			try {
				return { value: JSON.parse(input.run.beat_sheet) as unknown, error: null };
			} catch {
				return { value: input.run.beat_sheet, error: "video_run_beat_sheet_invalid_json" };
			}
		})()
		: null;
	const promptPackageExpectedUnits = assembly.length > 0 || promptPackage.length > 0
		? (promptPackage.length > 0 ? 2 : 1)
		: executionScope === "prompt_only" ? 2 : executionScope === "media_delivery" ? 1 : null;
	const submissionStatuses = videoEffects.map((effect): VideoProductionWorkflowNodeStatus => {
		if (effect.status === "accepted" || effect.status === "materialized") return "succeeded";
		return effectStatus(effect.status);
	});
	const submissionCompleted = submissionStatuses.filter((status) => status === "succeeded").length;
	const submissionStatus = aggregateStatus(submissionStatuses, executionScope === "media_delivery" ? clipIndexes.length || null : null);
	const nodes: VideoAtomicWorkflowNodeProjection[] = [
		buildNode({ runId, latestEventSeq, atomicNodeId: "canvas-source", artifacts: [], inputArtifactIds: [], outputArtifactIds: [sourceIdentity], totalUnits: 1, status: "succeeded", startedAt: input.run.created_at, updatedAt: input.run.created_at, outputRefs: sourceOutput }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "delivery-contract", artifacts: manifest ? [manifest] : [], inputArtifactIds: [sourceIdentity], totalUnits: 1, status: manifest?.status === "ready" ? "succeeded" : runFailed ? "failed" : undefined, startedAt: input.run.created_at, updatedAt: manifest?.updated_at ?? input.run.updated_at, outputRefs: graphOutput, extraErrors: runFailed && input.run.error_message ? [input.run.error_message] : [] }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "beat-sheet-agent", artifacts: beatSheetDraft, inputArtifactIds: manifest ? [manifest.artifact_key] : [], totalUnits: 1 }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "beat-sheet-format", artifacts: beatSheet, inputArtifactIds: beatSheetDraft.map((artifact) => artifact.artifact_key), outputArtifactIds: beatSheet.length > 0 || parsedRunBeatSheet ? ["beat_sheet"] : [], totalUnits: 1, status: beatSheet.length === 0 && parsedRunBeatSheet ? "succeeded" : undefined, startedAt: beatSheet.length > 0 || parsedRunBeatSheet ? input.run.created_at : null, updatedAt: beatSheet[0]?.updated_at ?? (parsedRunBeatSheet ? input.run.updated_at : null), outputRefs: beatSheet.length > 0 ? undefined : parsedRunBeatSheet ? { ports: { "beat-sheet": parsedRunBeatSheet.value }, artifacts: [{ identity: "beat_sheet", type: ARTIFACT_TYPE_BY_NODE["beat-sheet-format"], value: parsedRunBeatSheet.value }], evidence: { persistedOnRun: true }, itemRuns: [] } : undefined, extraErrors: parsedRunBeatSheet?.error ? [parsedRunBeatSheet.error] : [] }),
		buildNode({
			runId,
			latestEventSeq,
			atomicNodeId: "asset-coverage",
			artifacts: assetCoverage,
			inputArtifactIds: beatSheet.length > 0 || input.run.beat_sheet ? ["beat_sheet"] : [],
			totalUnits: executionScope === "media_delivery" ? 1 : null,
			status: coverageProjection
				? coverageProjection.complete ? "succeeded" : "waiting_external"
				: assetCoverage[0]?.status === "failed" ? "failed" : undefined,
		}),
		buildNode({
			runId,
			latestEventSeq,
			atomicNodeId: "asset-fan-out",
			artifacts: [],
			inputArtifactIds: assetCoverage.map((artifact) => artifact.artifact_key),
			outputArtifactIds: coverageProjection ? coverageProjection.required.map(assetIdentity) : [],
			totalUnits: executionScope === "media_delivery" ? coverageProjection?.requiredCount ?? null : null,
			status: coverageProjection ? "succeeded" : undefined,
			startedAt: assetCoverage[0]?.created_at ?? null,
			updatedAt: assetCoverage[0]?.updated_at ?? null,
			outputRefs: coverageProjection ? virtualAssetOutput({ runId, nodeId: "asset-fan-out", coverage: coverageProjection }) : undefined,
		}),
		buildNode({
			runId,
			latestEventSeq,
			atomicNodeId: "asset-image-generate",
			artifacts: [],
			inputArtifactIds: coverageProjection ? coverageProjection.required.map(assetIdentity) : [],
			outputArtifactIds: coverageProjection ? coverageProjection.available.map(assetIdentity) : [],
			totalUnits: executionScope === "media_delivery" ? coverageProjection?.requiredCount ?? null : null,
			completedUnits: coverageProjection?.availableCount ?? 0,
			status: coverageProjection
				? coverageProjection.complete ? "succeeded" : "waiting_external"
				: undefined,
			startedAt: assetCoverage[0]?.created_at ?? null,
			updatedAt: assetCoverage[0]?.updated_at ?? null,
			outputRefs: coverageProjection ? virtualAssetOutput({ runId, nodeId: "asset-image-generate", coverage: coverageProjection }) : undefined,
		}),
		buildNode({ runId, latestEventSeq, atomicNodeId: "clip-fan-out", artifacts: [], inputArtifactIds: ["beat_sheet", ...(executionScope === "media_delivery" ? assetCoverage.map((artifact) => artifact.artifact_key) : [])], outputArtifactIds: clipIndexes.map((clipIndex) => `clip-context:${clipIndex}`), totalUnits: clipIndexes.length || null, status: clipIndexes.length > 0 ? "succeeded" : undefined, startedAt: manifest?.created_at ?? null, updatedAt: manifest?.updated_at ?? null, outputRefs: fanOutOutput }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "clip-writer-agent", artifacts: clips, inputArtifactIds: clipIndexes.map((clipIndex) => `clip-context:${clipIndex}`), totalUnits: clipIndexes.length || null, outputRefs: writerOutput }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "prompt-package", artifacts: [...assembly, ...promptPackage], inputArtifactIds: clips.map((artifact) => artifact.artifact_key), totalUnits: promptPackageExpectedUnits }),
		// Legacy authoring journals do not persist the newer voice subgraph as
		// independently addressable artifacts. Keep those operations visible and
		// unresolved instead of fabricating successful voice evidence from the
		// downstream handoff or final video state.
		buildNode({ runId, latestEventSeq, atomicNodeId: "voice-catalog", artifacts: [], inputArtifactIds: [...assembly, ...promptPackage].map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? 1 : null }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "voice-plan-agent", artifacts: [], inputArtifactIds: [...assembly, ...promptPackage].map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? 1 : null }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "voice-materialize", artifacts: [], inputArtifactIds: estimate.map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? 1 : null }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "cost-estimate", artifacts: estimate, inputArtifactIds: [...assembly, ...assetCoverage].map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? 1 : null }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "production-handoff", artifacts: handoff, inputArtifactIds: estimate.map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? 1 : null }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "video-submit", artifacts: submissions, effects: videoEffects, inputArtifactIds: handoff.map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? clipIndexes.length || null : null, completedUnits: submissionCompleted, status: submissionStatuses.length > 0 ? submissionStatus : undefined, outputRefs: submitOutput }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "video-results", artifacts: results, inputArtifactIds: submissions.map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? clipIndexes.length || null : null, outputRefs: resultOutput }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "concat", artifacts: concat, inputArtifactIds: results.map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? 1 : null }),
		buildNode({ runId, latestEventSeq, atomicNodeId: "delivery-verify", artifacts: delivery, inputArtifactIds: concat.map((artifact) => artifact.artifact_key), totalUnits: executionScope === "media_delivery" ? 1 : null }),
	];
	if (nodes.map((node) => node.atomicNodeId).join(",") !== VIDEO_ATOMIC_WORKFLOW_NODE_IDS.join(",")) {
		throw new Error("video_atomic_workflow_projection_topology_drift");
	}
	return {
		protocolVersion: VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION,
		workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
		definitionVersion: 2,
		workflowRunId: runId,
		executionScope,
		generatedAt: input.generatedAt,
		latestEventSeq,
		nodes,
	};
}
