import type { VideoAuthoringGraphNodeState } from "@tapcanvas/video-orchestrator-protocol";
import {
	AUTHORING_CONCAT_NODE_KEY,
	AUTHORING_DELIVERY_VERIFY_NODE_KEY,
	videoResultArtifactKey,
	videoSubmissionGraphNodeKey,
} from "./video-orchestrator.authoring-graph";
import {
	parseVideoFinishingTechnicalVerification,
} from "./video-orchestrator.finishing-verification";
import { parseVideoNarrativeDeliveryVerification } from "./video-orchestrator.narrative-delivery-verification";

export type ProductionGraphEvidenceWrite = Readonly<{
	artifactKey: string;
	derivedFrom: readonly string[];
	status: VideoAuthoringGraphNodeState;
	payload: Readonly<Record<string, unknown>>;
	error?: string | null;
}>;

const FINAL_MEDIA_PROBE_MIN_TIMEOUT_MS = 2 * 60_000;
const FINAL_MEDIA_PROBE_MAX_TIMEOUT_MS = 15 * 60_000;

/**
 * Final-film probing downloads the durable media before ffprobe. Give that
 * acquisition a budget proportional to the frozen film duration instead of a
 * short request-style timeout, while keeping the worker occupation bounded.
 */
export function resolveFinalMediaProbeTimeoutMs(durationSeconds: unknown): number {
	const duration = Number(durationSeconds);
	const durationBudgetMs = Number.isFinite(duration) && duration > 0
		? Math.ceil(duration * 2_000)
		: FINAL_MEDIA_PROBE_MIN_TIMEOUT_MS;
	return Math.min(
		FINAL_MEDIA_PROBE_MAX_TIMEOUT_MS,
		Math.max(FINAL_MEDIA_PROBE_MIN_TIMEOUT_MS, durationBudgetMs),
	);
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readClipIndex(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readDurableHttpUrl(value: unknown): string {
	const text = readText(value);
	if (!text) return "";
	try {
		const parsed = new URL(text);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
	} catch {
		return "";
	}
}

export function buildProductionGraphEvidenceWrites(input: {
	runId: string;
	state: unknown;
	clips: unknown;
	concatVideoUrl?: unknown;
	masterVideoUrl?: unknown;
	deliveryEvidence?: unknown;
	finishingVerification?: unknown;
}): ProductionGraphEvidenceWrite[] {
	const runId = input.runId.trim();
	if (!runId) throw new Error("production_graph_run_id_required");
	const writes: ProductionGraphEvidenceWrite[] = [];
	if (Array.isArray(input.clips)) {
		for (const rawClip of input.clips) {
			const clip = readRecord(rawClip);
			const clipIndex = readClipIndex(clip?.clipIndex);
			if (!clip || clipIndex === null) continue;
			const status = readText(clip.status);
			const videoUrl = readDurableHttpUrl(clip.videoUrl);
			const error = readText(clip.error);
			if (status === "running") {
				writes.push({
					artifactKey: videoResultArtifactKey(clipIndex),
					derivedFrom: [videoSubmissionGraphNodeKey(clipIndex)],
					status: "waiting_external",
					payload: { runId, clipIndex, providerState: "running" },
				});
				continue;
			}
			if (status === "success" && videoUrl) {
				writes.push({
					artifactKey: videoResultArtifactKey(clipIndex),
					derivedFrom: [videoSubmissionGraphNodeKey(clipIndex)],
					status: "ready",
					payload: { runId, clipIndex, videoUrl },
					error: null,
				});
				continue;
			}
			if (status === "failed" || status === "submit_failed") {
				writes.push({
					artifactKey: videoResultArtifactKey(clipIndex),
					derivedFrom: [videoSubmissionGraphNodeKey(clipIndex)],
					status: "failed",
					payload: { runId, clipIndex, providerState: status, ...(error ? { error } : {}) },
					error: error || `video_clip_${status}`,
				});
			}
		}
	}
	const state = readText(input.state);
	const concatVideoUrl = readDurableHttpUrl(input.concatVideoUrl);
	const masterVideoUrl = readDurableHttpUrl(input.masterVideoUrl);
	const finishingVerification = parseVideoFinishingTechnicalVerification(
		input.finishingVerification,
	);
	const deliveryEvidenceRecord = readRecord(input.deliveryEvidence);
	const narrativeVerification = parseVideoNarrativeDeliveryVerification(
		deliveryEvidenceRecord?.narrativeVerification,
	);
	const finalMediaProbe = readRecord(deliveryEvidenceRecord?.finalMediaProbe);
	if (state === "concatenating" && Array.isArray(input.clips)) {
		const durableClipIndexes = input.clips.flatMap((rawClip) => {
			const clip = readRecord(rawClip);
			const clipIndex = readClipIndex(clip?.clipIndex);
			return clipIndex !== null && readText(clip?.status) === "success" && readDurableHttpUrl(clip?.videoUrl)
				? [clipIndex]
				: [];
		});
		if (durableClipIndexes.length === input.clips.length && durableClipIndexes.length > 0) {
			writes.push({
				artifactKey: AUTHORING_CONCAT_NODE_KEY,
				derivedFrom: durableClipIndexes.map(videoResultArtifactKey),
				status: "running",
				payload: {
					runId,
					phase: "concatenating",
					completedClips: durableClipIndexes.length,
					totalClips: durableClipIndexes.length,
				},
				error: null,
			});
		}
	}
	if ((state === "concatenated" || state === "finished") && concatVideoUrl) {
		const finalVideoUrl = state === "finished" ? masterVideoUrl : concatVideoUrl;
		if (!finalVideoUrl) return writes;
		writes.push({
			artifactKey: AUTHORING_CONCAT_NODE_KEY,
			derivedFrom: Array.isArray(input.clips)
				? input.clips.flatMap((rawClip) => {
					const clipIndex = readClipIndex(readRecord(rawClip)?.clipIndex);
					return clipIndex === null ? [] : [videoResultArtifactKey(clipIndex)];
				})
				: [],
			status: "ready",
			payload: { runId, videoUrl: concatVideoUrl },
			error: null,
		});
		const isFinishingDelivery = state === "finished";
		const finishingMissingCriteria = isFinishingDelivery
			? finishingVerification
				? finishingVerification.missingCriteria.map(
					(criterion) => `finishingVerification.${criterion}`,
				)
				: ["finishingVerification"]
			: [];
		const clipEvidenceMissing = Array.isArray(input.clips)
			? input.clips.flatMap((rawClip) => {
				const clip = readRecord(rawClip);
				const clipIndex = readClipIndex(clip?.clipIndex);
				return clipIndex === null || readText(clip?.status) !== "success" || !readDurableHttpUrl(clip?.videoUrl)
					? [`clips[${clipIndex ?? "unknown"}].durableVideoUrl`]
					: [];
			})
			: ["clips"];
		const mediaProbeMissing = finalMediaProbe &&
			Number(finalMediaProbe.width) > 0 &&
			Number(finalMediaProbe.height) > 0 &&
			Number(finalMediaProbe.durationSeconds) > 0 &&
			readText(finalMediaProbe.videoCodec)
				? []
				: ["finalMediaProbe"];
		const narrativeDiagnosticCriteria = !narrativeVerification
			? ["narrativeVerification"]
			: narrativeVerification.satisfied
				? []
				: narrativeVerification.missingCriteria.map(
					(criterion) => `narrativeVerification.${criterion}`,
				);
		const missingCriteria = [...clipEvidenceMissing];
		const diagnosticCriteria = [
			...mediaProbeMissing,
			...narrativeDiagnosticCriteria,
			...finishingMissingCriteria,
		];
		const deliverySatisfied = missingCriteria.length === 0;
		const verificationFailure = deliverySatisfied
			? null
			: "final_video_delivery_evidence_incomplete";
		writes.push({
			artifactKey: AUTHORING_DELIVERY_VERIFY_NODE_KEY,
			derivedFrom: [AUTHORING_CONCAT_NODE_KEY],
			// Once a durable hosted final URL and every durable clip URL exist, the
			// generated asset is deliverable. Probe, narrative, and finishing review
			// remain append-only diagnostics and cannot hold back or discard output.
			status: "ready",
			payload: {
				runId,
				expectedDelivery: {
					kind: "video",
					requiredFacts: [
						"durableHttpFinalVideoUrl",
						"durableClipVideoUrls",
					],
				},
				deliveryEvidence: {
					kind: "video",
					runId,
					videoUrl: finalVideoUrl,
					...(isFinishingDelivery ? { sourceConcatVideoUrl: concatVideoUrl } : {}),
					...(narrativeVerification ? { narrativeVerification } : {}),
					...(finishingVerification ? { finishingVerification } : {}),
					...(finalMediaProbe ? { finalMediaProbe } : {}),
					...(narrativeVerification ? { narrativeDiagnostic: narrativeVerification } : {}),
				},
				deliveryVerification: {
					satisfied: deliverySatisfied,
					outcome: deliverySatisfied ? "satisfied" : "partial",
					missingCriteria,
					diagnosticCriteria,
					...(verificationFailure ? { failureReason: verificationFailure } : {}),
				},
			},
			error: verificationFailure,
		});
	}
	return writes;
}
