import {
	VIDEO_PRODUCTION_WORKFLOW_DEFINITION,
	VIDEO_PRODUCTION_WORKFLOW_KEY,
	VIDEO_PRODUCTION_WORKFLOW_NODE_IDS,
	VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
	type VideoProductionWorkflowNodeId,
	type VideoProductionWorkflowNodeProjection,
	type VideoProductionWorkflowNodeStatus,
	type VideoProductionWorkflowSnapshot,
} from "@tapcanvas/video-orchestrator-protocol";

export type VideoProductionWorkflowRunFact = Readonly<{
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

export type VideoProductionWorkflowArtifactFact = Readonly<{
	artifact_key: string;
	status: string;
	payload: string | null;
	error: string | null;
	created_at: string;
	updated_at: string;
}>;

export type VideoProductionWorkflowEffectFact = Readonly<{
	id: string;
	workflow_node_id: string;
	status: string;
	error_message: string | null;
	created_at: string;
	updated_at: string;
}>;

type NodeFacts = Readonly<{
	workflowNodeId: VideoProductionWorkflowNodeId;
	status: VideoProductionWorkflowNodeStatus;
	completedUnits: number;
	totalUnits: number | null;
	inputArtifactIds: readonly string[];
	outputArtifactIds: readonly string[];
	effectIds: readonly string[];
	errorCount: number;
	startedAt: string | null;
	updatedAt: string | null;
}>;

function countBeatSheetBeats(raw: string | null): number {
	if (!raw) return 0;
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
		const beats = (value as Record<string, unknown>).beats;
		return Array.isArray(beats) ? beats.length : 0;
	} catch {
		return 0;
	}
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

function isFinishedNodeStatus(status: VideoProductionWorkflowNodeStatus): boolean {
	return status === "succeeded" || status === "failed" || status === "cancelled";
}

function nodeTiming(facts: NodeFacts): VideoProductionWorkflowNodeProjection["timing"] {
	const finishedAt = facts.startedAt && isFinishedNodeStatus(facts.status) ? facts.updatedAt : null;
	const startedMs = facts.startedAt ? Date.parse(facts.startedAt) : Number.NaN;
	const finishedMs = finishedAt ? Date.parse(finishedAt) : Number.NaN;
	return {
		startedAt: facts.startedAt,
		updatedAt: facts.updatedAt,
		finishedAt,
		durationMs: Number.isFinite(startedMs) && Number.isFinite(finishedMs)
			? Math.max(0, Math.trunc(finishedMs - startedMs))
			: null,
	};
}

function groupStatus(input: {
	runState: string;
	statuses: readonly string[];
	hasExpectedWork: boolean;
	completedUnits: number;
	totalUnits: number | null;
}): VideoProductionWorkflowNodeStatus {
	if (input.runState === "cancelled") return "cancelled";
	if (input.statuses.includes("running")) return "running";
	if (input.statuses.includes("waiting_external")) return "waiting_external";
	if (input.statuses.includes("failed")) {
		return input.completedUnits > 0 ? "partial" : "failed";
	}
	if (input.statuses.includes("stale")) return "partial";
	if (
		input.hasExpectedWork &&
		input.totalUnits !== null &&
		input.totalUnits > 0 &&
		input.completedUnits >= input.totalUnits
	) return "succeeded";
	if (input.completedUnits > 0) return "partial";
	return "queued";
}

function artifactErrors(artifacts: readonly VideoProductionWorkflowArtifactFact[]): number {
	return artifacts.filter((artifact) => artifact.status === "failed" || Boolean(artifact.error)).length;
}

function artifactKeys(artifacts: readonly VideoProductionWorkflowArtifactFact[]): string[] {
	return artifacts.map((artifact) => artifact.artifact_key).sort();
}

function effectProjectionStatus(status: string): string {
	if (status === "materialized") return "ready";
	if (status === "accepted") return "waiting_external";
	if (status === "submitting") return "running";
	if (status === "reserved") return "pending";
	if (status === "uncertain") return "waiting_external";
	return status === "rejected_pre_upstream" ? "failed" : status;
}

function projection(input: {
	runId: string;
	latestEventSeq: number;
	facts: NodeFacts;
}): VideoProductionWorkflowNodeProjection {
	return {
		workflowRunId: input.runId,
		workflowNodeId: input.facts.workflowNodeId,
		status: input.facts.status,
		completedUnits: input.facts.completedUnits,
		totalUnits: input.facts.totalUnits,
		inputArtifactIds: input.facts.inputArtifactIds,
		outputArtifactIds: input.facts.outputArtifactIds,
		effectIds: input.facts.effectIds,
		errorCount: input.facts.errorCount,
		timing: nodeTiming(input.facts),
		latestEventSeq: input.latestEventSeq,
	};
}

export function buildVideoProductionWorkflowSnapshot(input: {
	run: VideoProductionWorkflowRunFact;
	artifacts: readonly VideoProductionWorkflowArtifactFact[];
	effects?: readonly VideoProductionWorkflowEffectFact[];
	latestEventSeq?: number;
	generatedAt: string;
}): VideoProductionWorkflowSnapshot {
	const runId = input.run.id.trim();
	if (!runId) throw new Error("video_production_workflow_run_id_required");
	const latestEventSeq = Math.max(0, Math.trunc(input.latestEventSeq ?? 0));
	const byKey = new Map(input.artifacts.map((artifact) => [artifact.artifact_key, artifact]));
	const beatSheetArtifacts = input.artifacts.filter((artifact) => artifact.artifact_key === "beat_sheet");
	const clipArtifacts = input.artifacts.filter((artifact) => /^clip:\d+$/.test(artifact.artifact_key));
	const assetArtifacts = input.artifacts.filter((artifact) => artifact.artifact_key.startsWith("asset:"));
	const submissionArtifacts = input.artifacts.filter((artifact) => /^video-submission:\d+$/.test(artifact.artifact_key));
	const videoResultArtifacts = input.artifacts.filter((artifact) => /^video-result:\d+$/.test(artifact.artifact_key));
	const mediaEffects = (input.effects ?? []).filter((effect) => effect.workflow_node_id === "media-production");
	const concatArtifacts = input.artifacts.filter((artifact) => artifact.artifact_key === "concat:auto");
	const deliveryArtifacts = input.artifacts.filter((artifact) => artifact.artifact_key === "delivery:verify");
	const beatCount = countBeatSheetBeats(input.run.beat_sheet);
	const completedClips = clipArtifacts.filter((artifact) => artifact.status === "ready").length;
	const completedAssets = assetArtifacts.filter((artifact) => artifact.status === "ready").length;
	const completedVideos = videoResultArtifacts.filter((artifact) => artifact.status === "ready").length;
	const graphManifest = byKey.get("graph:manifest");
	const runFailed = input.run.state === "failed" || input.run.authoring_state === "authoring_failed";
	const storyAdaptationStatus: VideoProductionWorkflowNodeStatus = input.run.beat_sheet
		? "succeeded"
		: runFailed ? "failed" : input.run.authoring_state ? "running" : "queued";

	const nodeFacts: readonly NodeFacts[] = [
		{
			workflowNodeId: "production-contract",
			status: graphManifest?.status === "failed" || runFailed ? "failed" : graphManifest?.status === "ready" ? "succeeded" : "running",
			completedUnits: graphManifest?.status === "ready" ? 1 : 0,
			totalUnits: 1,
			inputArtifactIds: [],
			outputArtifactIds: graphManifest ? [graphManifest.artifact_key] : [],
			effectIds: [],
			errorCount: graphManifest?.status === "failed" || runFailed ? 1 : 0,
			startedAt: input.run.created_at,
			updatedAt: latestTimestamp([graphManifest?.updated_at, input.run.created_at]),
		},
		{
			workflowNodeId: "story-adaptation",
			status: storyAdaptationStatus,
			completedUnits: beatCount,
			totalUnits: beatCount > 0 ? beatCount : null,
			inputArtifactIds: graphManifest ? [graphManifest.artifact_key] : [],
			outputArtifactIds: beatSheetArtifacts.length > 0 ? artifactKeys(beatSheetArtifacts) : input.run.beat_sheet ? ["beat_sheet"] : [],
			effectIds: [],
			errorCount: input.run.authoring_state === "authoring_failed" ? 1 : artifactErrors(beatSheetArtifacts),
			startedAt: storyAdaptationStatus === "queued"
				? null
				: earliestTimestamp([...beatSheetArtifacts.map((artifact) => artifact.created_at), input.run.created_at]),
			updatedAt: storyAdaptationStatus === "queued"
				? null
				: latestTimestamp([...beatSheetArtifacts.map((artifact) => artifact.updated_at), input.run.updated_at]),
		},
		{
			workflowNodeId: "clip-contracts",
			status: groupStatus({
				runState: input.run.state,
				statuses: clipArtifacts.map((artifact) => artifact.status),
				hasExpectedWork: beatCount > 0,
				completedUnits: completedClips,
				totalUnits: beatCount > 0 ? beatCount : null,
			}),
			completedUnits: completedClips,
			totalUnits: beatCount > 0 ? beatCount : null,
			inputArtifactIds: input.run.beat_sheet ? ["beat_sheet"] : [],
			outputArtifactIds: artifactKeys(clipArtifacts),
			effectIds: [],
			errorCount: artifactErrors(clipArtifacts),
			startedAt: earliestTimestamp(clipArtifacts.map((artifact) => artifact.created_at)),
			updatedAt: latestTimestamp(clipArtifacts.map((artifact) => artifact.updated_at)),
		},
		{
			workflowNodeId: "asset-preparation",
			status: groupStatus({
				runState: input.run.state,
				statuses: assetArtifacts.map((artifact) => artifact.status),
				hasExpectedWork: assetArtifacts.length > 0,
				completedUnits: completedAssets,
				totalUnits: assetArtifacts.length > 0 ? assetArtifacts.length : null,
			}),
			completedUnits: completedAssets,
			totalUnits: assetArtifacts.length > 0 ? assetArtifacts.length : null,
			inputArtifactIds: artifactKeys(clipArtifacts),
			outputArtifactIds: artifactKeys(assetArtifacts),
			effectIds: [],
			errorCount: artifactErrors(assetArtifacts),
			startedAt: earliestTimestamp(assetArtifacts.map((artifact) => artifact.created_at)),
			updatedAt: latestTimestamp(assetArtifacts.map((artifact) => artifact.updated_at)),
		},
		{
			workflowNodeId: "media-production",
			status: groupStatus({
				runState: input.run.state,
				statuses: [
					...mediaEffects.map((effect) => effectProjectionStatus(effect.status)),
					...videoResultArtifacts.map((artifact) => artifact.status),
				],
				hasExpectedWork: input.run.total_clips > 0,
				completedUnits: completedVideos,
				totalUnits: input.run.total_clips > 0 ? input.run.total_clips : null,
			}),
			completedUnits: completedVideos,
			totalUnits: input.run.total_clips > 0 ? input.run.total_clips : null,
			inputArtifactIds: artifactKeys(assetArtifacts),
			outputArtifactIds: artifactKeys(videoResultArtifacts),
			effectIds: mediaEffects.map((effect) => effect.id).sort(),
			errorCount: artifactErrors(videoResultArtifacts) + mediaEffects.filter((effect) =>
				effect.status === "failed" || effect.status === "rejected_pre_upstream" || Boolean(effect.error_message)
			).length,
			startedAt: earliestTimestamp([
				...mediaEffects.map((effect) => effect.created_at),
				...submissionArtifacts.map((artifact) => artifact.created_at),
				...videoResultArtifacts.map((artifact) => artifact.created_at),
			]),
			updatedAt: latestTimestamp([
				...mediaEffects.map((effect) => effect.updated_at),
				...submissionArtifacts.map((artifact) => artifact.updated_at),
				...videoResultArtifacts.map((artifact) => artifact.updated_at),
			]),
		},
		{
			workflowNodeId: "composition",
			status: input.run.state === "concatenated"
				? "succeeded"
				: input.run.state === "concatenating"
					? "running"
					: groupStatus({
						runState: input.run.state,
						statuses: concatArtifacts.map((artifact) => artifact.status),
						hasExpectedWork: concatArtifacts.length > 0,
						completedUnits: concatArtifacts.filter((artifact) => artifact.status === "ready").length,
						totalUnits: 1,
					}),
			completedUnits: input.run.state === "concatenated" || concatArtifacts.some((artifact) => artifact.status === "ready") ? 1 : 0,
			totalUnits: 1,
			inputArtifactIds: artifactKeys(videoResultArtifacts),
			outputArtifactIds: artifactKeys(concatArtifacts),
			effectIds: [],
			errorCount: artifactErrors(concatArtifacts),
			startedAt: earliestTimestamp(concatArtifacts.map((artifact) => artifact.created_at)),
			updatedAt: latestTimestamp([...concatArtifacts.map((artifact) => artifact.updated_at), input.run.completed_at]),
		},
		{
			workflowNodeId: "delivery",
			status: deliveryArtifacts.some((artifact) => artifact.status === "ready")
				? "succeeded"
				: groupStatus({
					runState: input.run.state,
					statuses: deliveryArtifacts.map((artifact) => artifact.status),
					hasExpectedWork: deliveryArtifacts.length > 0,
					completedUnits: 0,
					totalUnits: 1,
				}),
			completedUnits: deliveryArtifacts.some((artifact) => artifact.status === "ready") ? 1 : 0,
			totalUnits: 1,
			inputArtifactIds: artifactKeys(concatArtifacts),
			outputArtifactIds: artifactKeys(deliveryArtifacts),
			effectIds: [],
			errorCount: artifactErrors(deliveryArtifacts),
			startedAt: earliestTimestamp(deliveryArtifacts.map((artifact) => artifact.created_at)),
			updatedAt: latestTimestamp([...deliveryArtifacts.map((artifact) => artifact.updated_at), input.run.completed_at]),
		},
	];

	const nodes = nodeFacts.map((facts) => projection({ runId, latestEventSeq, facts }));
	const actualNodeIds = nodes.map((node) => node.workflowNodeId);
	if (actualNodeIds.join(",") !== VIDEO_PRODUCTION_WORKFLOW_NODE_IDS.join(",")) {
		throw new Error("video_production_workflow_projection_topology_drift");
	}
	return {
		protocolVersion: VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
		workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
		definitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
		workflowRunId: runId,
		generatedAt: input.generatedAt,
		latestEventSeq,
		nodes,
	};
}
