import { createHash } from "node:crypto";
import {
	probeMediaViaMediaWorker,
	type ProbeMediaResult,
} from "../../platform/media-worker/client";
import type { VideoFinishingContract } from "./video-orchestrator.finishing-contract";

export type VideoFinishingMediaFacts = {
	durationSeconds: number;
	width: number;
	height: number;
	videoCodec: string;
	audioCodec: string;
	fps: number;
	sizeBytes: number;
};

export type VideoFinishingClipInput = {
	clipIndex: number;
	expectedDurationSeconds: number;
	videoUrl: string;
	requiresAudio: boolean;
};

export type VideoFinishingClipVerification = {
	clipIndex: number;
	expectedDurationSeconds: number;
	expectedMinimumShortEdgePixels: number;
	requiresAudio: boolean;
	mediaUrlHash: string;
	media: VideoFinishingMediaFacts;
	checks: {
		videoStreamPresent: boolean;
		durationMatchesPlan: boolean;
		generationResolutionReached: boolean;
		fpsPresent: boolean;
		requiredAudioPresent: boolean;
	};
	missingCriteria: string[];
};

export type VideoFinishingTechnicalVerification = {
	version: 3;
	satisfied: boolean;
	expected: {
		sourceDurationSeconds: number;
		sourceResolution: string;
		sourceMinimumShortEdgePixels: number;
		resolution: string;
		minimumShortEdgePixels: number;
		fps?: number;
		preserveSourceDuration: true;
		preserveSourceAspect: true;
		preserveSourceAudio: true;
	};
	mediaIdentity: {
		sourceVideoUrlHash: string;
		masterVideoUrlHash: string;
	};
	clips: VideoFinishingClipVerification[];
	source: VideoFinishingMediaFacts;
	master: VideoFinishingMediaFacts;
	checks: {
		clipMediaComplete: boolean;
		sourceDurationMatchesPlan: boolean;
		sourceVideoStreamPresent: boolean;
		sourceResolutionReached: boolean;
		requiredSourceAudioPresent: boolean;
		masterVideoStreamPresent: boolean;
		targetResolutionReached: boolean;
		targetFpsReached: boolean;
		durationPreserved: boolean;
		aspectPreserved: boolean;
		sourceAudioPreserved: boolean;
	};
	missingCriteria: string[];
	failureReason?: string;
	verifiedAt: string;
};

export type VideoFinishingSourceInspectionResult =
	| {
			state: "pending";
			reason: "source_media_probe_unavailable";
	  }
	| {
			state: "complete";
			satisfied: boolean;
			expectedDurationSeconds: number;
			actualDurationSeconds: number;
			toleranceSeconds: number;
			failureReason?: string;
	  };

export type VideoFinishingPreSubmissionInspectionResult =
	| {
			state: "pending";
			reason: "source_media_probe_unavailable" | "clip_media_probe_unavailable";
			clipIndex?: number;
	  }
	| {
			state: "complete";
			satisfied: boolean;
			missingCriteria: string[];
			failureReason?: string;
	  };

export type VideoFinishingInspectionResult =
	| {
			state: "pending";
			reason:
				| "source_media_probe_unavailable"
				| "master_media_probe_unavailable"
				| "clip_media_probe_unavailable";
			clipIndex?: number;
	  }
	| {
			state: "complete";
			verification: VideoFinishingTechnicalVerification;
	  };

type ProbeMedia = (input: {
	url: string;
	timeoutMs?: number;
}) => Promise<ProbeMediaResult | null>;

function finiteNonNegative(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function positiveInteger(value: unknown): number {
	const numeric = Number(value);
	return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function trimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function hashMediaUrl(value: string): string {
	return createHash("sha256").update(value.trim()).digest("hex");
}

function normalizeProbeFacts(probe: ProbeMediaResult): VideoFinishingMediaFacts {
	return {
		durationSeconds: finiteNonNegative(probe.durationSeconds),
		width: positiveInteger(probe.width),
		height: positiveInteger(probe.height),
		videoCodec: trimmed(probe.videoCodec),
		audioCodec: trimmed(probe.audioCodec),
		fps: finiteNonNegative(probe.fps),
		sizeBytes: finiteNonNegative(probe.sizeBytes),
	};
}

export function resolveFinishingMinimumShortEdgePixels(resolution: string): number | null {
	const normalized = resolution.trim().toLowerCase();
	if (normalized === "4k") return 2160;
	if (normalized === "2k") return 1440;
	const dimensions = normalized.match(/^(\d+)x(\d+)$/);
	if (dimensions) {
		const width = Number(dimensions[1]);
		const height = Number(dimensions[2]);
		return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
			? Math.min(width, height)
			: null;
	}
	if (!normalized.endsWith("p")) return null;
	const pixels = Number(normalized.slice(0, -1));
	return Number.isInteger(pixels) && pixels > 0 ? pixels : null;
}

function aspectRatio(facts: VideoFinishingMediaFacts): number {
	return facts.width > 0 && facts.height > 0 ? facts.width / facts.height : 0;
}

function withinRelativeTolerance(left: number, right: number, tolerance: number): boolean {
	if (!(left > 0) || !(right > 0)) return false;
	return Math.abs(left - right) / left <= tolerance;
}

function sourceDurationToleranceSeconds(expectedDurationSeconds: number): number {
	return Math.max(0.5, expectedDurationSeconds * 0.005);
}

function verifyClipMedia(input: {
	clip: VideoFinishingClipInput;
	probe: ProbeMediaResult;
	expectedMinimumShortEdgePixels: number;
}): VideoFinishingClipVerification {
	const media = normalizeProbeFacts(input.probe);
	const durationToleranceSeconds = sourceDurationToleranceSeconds(
		input.clip.expectedDurationSeconds,
	);
	const checks = {
		videoStreamPresent: media.width > 0 && media.height > 0 && Boolean(media.videoCodec),
		durationMatchesPlan:
			media.durationSeconds > 0 &&
			Math.abs(media.durationSeconds - input.clip.expectedDurationSeconds) <=
				durationToleranceSeconds,
		generationResolutionReached:
			input.expectedMinimumShortEdgePixels > 0 &&
			Math.min(media.width, media.height) >= input.expectedMinimumShortEdgePixels,
		fpsPresent: media.fps > 0,
		requiredAudioPresent: !input.clip.requiresAudio || Boolean(media.audioCodec),
	};
	return {
		clipIndex: input.clip.clipIndex,
		expectedDurationSeconds: input.clip.expectedDurationSeconds,
		expectedMinimumShortEdgePixels: input.expectedMinimumShortEdgePixels,
		requiresAudio: input.clip.requiresAudio,
		mediaUrlHash: hashMediaUrl(input.clip.videoUrl),
		media,
		checks,
		missingCriteria: Object.entries(checks)
			.filter(([, satisfied]) => !satisfied)
			.map(([criterion]) => criterion),
	};
}

export function verifyVideoFinishingSourceDuration(input: {
	expectedDurationSeconds: number;
	probe: ProbeMediaResult;
}): Exclude<VideoFinishingSourceInspectionResult, { state: "pending" }> {
	const expectedDurationSeconds = finiteNonNegative(input.expectedDurationSeconds);
	const actualDurationSeconds = finiteNonNegative(input.probe.durationSeconds);
	const toleranceSeconds = sourceDurationToleranceSeconds(expectedDurationSeconds);
	const satisfied =
		expectedDurationSeconds > 0 &&
		actualDurationSeconds > 0 &&
		Math.abs(actualDurationSeconds - expectedDurationSeconds) <= toleranceSeconds;
	return {
		state: "complete",
		satisfied,
		expectedDurationSeconds,
		actualDurationSeconds,
		toleranceSeconds,
		...(!satisfied
			? {
					failureReason:
						`video_finishing_source_duration_mismatch:expected=${expectedDurationSeconds}:actual=${actualDurationSeconds}:tolerance=${toleranceSeconds}`,
			  }
			: {}),
	};
}

export function buildVideoFinishingTechnicalVerification(input: {
	contract: VideoFinishingContract;
	expectedSourceDurationSeconds: number;
	sourceResolution: string;
	sourceVideoUrl: string;
	masterVideoUrl: string;
	clips: Array<{ input: VideoFinishingClipInput; probe: ProbeMediaResult }>;
	source: ProbeMediaResult;
	master: ProbeMediaResult;
	verifiedAt: string;
}): VideoFinishingTechnicalVerification {
	const source = normalizeProbeFacts(input.source);
	const master = normalizeProbeFacts(input.master);
	const minimumShortEdgePixels =
		resolveFinishingMinimumShortEdgePixels(input.contract.resolution) ?? 0;
	const sourceMinimumShortEdgePixels =
		resolveFinishingMinimumShortEdgePixels(input.sourceResolution) ?? 0;
	const clips = input.clips
		.map(({ input: clip, probe }) => verifyClipMedia({
			clip,
			probe,
			expectedMinimumShortEdgePixels: sourceMinimumShortEdgePixels,
		}))
		.sort((left, right) => left.clipIndex - right.clipIndex);
	const sourceDuration = source.durationSeconds;
	const sourcePlanVerification = verifyVideoFinishingSourceDuration({
		expectedDurationSeconds: input.expectedSourceDurationSeconds,
		probe: input.source,
	});
	const durationToleranceSeconds = sourceDurationToleranceSeconds(sourceDuration);
	const requiresSourceAudio = clips.some((clip) => clip.requiresAudio);
	const checks = {
		clipMediaComplete: clips.length > 0 && clips.every((clip) => clip.missingCriteria.length === 0),
		sourceDurationMatchesPlan: sourcePlanVerification.satisfied,
		sourceVideoStreamPresent:
			source.width > 0 && source.height > 0 && Boolean(source.videoCodec),
		sourceResolutionReached:
			sourceMinimumShortEdgePixels > 0 &&
			Math.min(source.width, source.height) >= sourceMinimumShortEdgePixels,
		requiredSourceAudioPresent: !requiresSourceAudio || Boolean(source.audioCodec),
		masterVideoStreamPresent:
			master.width > 0 && master.height > 0 && Boolean(master.videoCodec),
		targetResolutionReached:
			minimumShortEdgePixels > 0 &&
			Math.min(master.width, master.height) >= minimumShortEdgePixels,
		targetFpsReached:
			typeof input.contract.fps === "number"
				? master.fps > 0 && Math.abs(master.fps - input.contract.fps) <= 0.5
				: master.fps > 0,
		durationPreserved:
			sourceDuration > 0 &&
			master.durationSeconds > 0 &&
			Math.abs(master.durationSeconds - sourceDuration) <= durationToleranceSeconds,
		aspectPreserved: withinRelativeTolerance(aspectRatio(source), aspectRatio(master), 0.01),
		sourceAudioPreserved: !requiresSourceAudio ||
			(Boolean(source.audioCodec) && Boolean(master.audioCodec)),
	};
	const missingCriteria = [
		...clips.flatMap((clip) =>
			clip.missingCriteria.map((criterion) => `clips[${clip.clipIndex}].${criterion}`),
		),
		...Object.entries(checks)
		.filter(([, satisfied]) => !satisfied)
		.map(([criterion]) => criterion),
	];
	return {
		version: 3,
		satisfied: missingCriteria.length === 0,
		expected: {
			sourceDurationSeconds: sourcePlanVerification.expectedDurationSeconds,
			sourceResolution: input.sourceResolution,
			sourceMinimumShortEdgePixels,
			resolution: input.contract.resolution,
			minimumShortEdgePixels,
			...(typeof input.contract.fps === "number" ? { fps: input.contract.fps } : {}),
			preserveSourceDuration: true,
			preserveSourceAspect: true,
			preserveSourceAudio: true,
		},
		mediaIdentity: {
			sourceVideoUrlHash: hashMediaUrl(input.sourceVideoUrl),
			masterVideoUrlHash: hashMediaUrl(input.masterVideoUrl),
		},
		clips,
		source,
		master,
		checks,
		missingCriteria,
		...(missingCriteria.length > 0
			? { failureReason: `video_finishing_technical_verification_failed:${missingCriteria.join(",")}` }
			: {}),
		verifiedAt: input.verifiedAt,
	};
}

export function parseVideoFinishingTechnicalVerification(
	value: unknown,
): VideoFinishingTechnicalVerification | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (record.version !== 3 || typeof record.satisfied !== "boolean") return null;
	const expected = record.expected;
	const mediaIdentity = record.mediaIdentity;
	const clips = record.clips;
	const source = record.source;
	const master = record.master;
	const checks = record.checks;
	if (
		!expected || typeof expected !== "object" || Array.isArray(expected) ||
		!mediaIdentity || typeof mediaIdentity !== "object" || Array.isArray(mediaIdentity) ||
		!Array.isArray(clips) || clips.length === 0 ||
		!source || typeof source !== "object" || Array.isArray(source) ||
		!master || typeof master !== "object" || Array.isArray(master) ||
		!checks || typeof checks !== "object" || Array.isArray(checks) ||
		!Array.isArray(record.missingCriteria) ||
		!record.missingCriteria.every((criterion) => typeof criterion === "string" && criterion.trim()) ||
		typeof record.verifiedAt !== "string" || !record.verifiedAt.trim()
	) return null;
	const expectedRecord = expected as Record<string, unknown>;
	const mediaIdentityRecord = mediaIdentity as Record<string, unknown>;
	const sourceRecord = source as Record<string, unknown>;
	const masterRecord = master as Record<string, unknown>;
	const checksRecord = checks as Record<string, unknown>;
	const factNumbers = ["durationSeconds", "width", "height", "fps", "sizeBytes"] as const;
	const factStrings = ["videoCodec", "audioCodec"] as const;
	const validFacts = (facts: Record<string, unknown>): boolean =>
		factNumbers.every((key) => typeof facts[key] === "number" && Number.isFinite(facts[key])) &&
		factStrings.every((key) => typeof facts[key] === "string");
	const checkKeys = [
		"clipMediaComplete",
		"sourceDurationMatchesPlan",
		"sourceVideoStreamPresent",
		"sourceResolutionReached",
		"requiredSourceAudioPresent",
		"masterVideoStreamPresent",
		"targetResolutionReached",
		"targetFpsReached",
		"durationPreserved",
		"aspectPreserved",
		"sourceAudioPreserved",
	] as const;
	if (
		typeof expectedRecord.sourceDurationSeconds !== "number" ||
		!Number.isFinite(expectedRecord.sourceDurationSeconds) ||
		expectedRecord.sourceDurationSeconds <= 0 ||
		typeof expectedRecord.sourceResolution !== "string" || !expectedRecord.sourceResolution.trim() ||
		typeof expectedRecord.sourceMinimumShortEdgePixels !== "number" ||
		!Number.isFinite(expectedRecord.sourceMinimumShortEdgePixels) ||
		typeof expectedRecord.resolution !== "string" || !expectedRecord.resolution.trim() ||
		typeof expectedRecord.minimumShortEdgePixels !== "number" ||
		!Number.isFinite(expectedRecord.minimumShortEdgePixels) ||
		(expectedRecord.fps !== undefined &&
			(typeof expectedRecord.fps !== "number" || !Number.isFinite(expectedRecord.fps))) ||
		expectedRecord.preserveSourceDuration !== true ||
		expectedRecord.preserveSourceAspect !== true ||
		expectedRecord.preserveSourceAudio !== true ||
		typeof mediaIdentityRecord.sourceVideoUrlHash !== "string" ||
		!mediaIdentityRecord.sourceVideoUrlHash.trim() ||
		typeof mediaIdentityRecord.masterVideoUrlHash !== "string" ||
		!mediaIdentityRecord.masterVideoUrlHash.trim() ||
		!validFacts(sourceRecord) ||
		!validFacts(masterRecord) ||
		!checkKeys.every((key) => typeof checksRecord[key] === "boolean")
	) return null;
	const clipIndexes = new Set<number>();
	for (const clip of clips) {
		if (!clip || typeof clip !== "object" || Array.isArray(clip)) return null;
		const clipRecord = clip as Record<string, unknown>;
		const clipMedia = clipRecord.media;
		const clipChecks = clipRecord.checks;
		if (
			typeof clipRecord.clipIndex !== "number" ||
			!Number.isInteger(clipRecord.clipIndex) || clipRecord.clipIndex < 0 ||
			clipIndexes.has(clipRecord.clipIndex) ||
			typeof clipRecord.expectedDurationSeconds !== "number" ||
			!Number.isFinite(clipRecord.expectedDurationSeconds) || clipRecord.expectedDurationSeconds <= 0 ||
			typeof clipRecord.expectedMinimumShortEdgePixels !== "number" ||
			!Number.isFinite(clipRecord.expectedMinimumShortEdgePixels) ||
			typeof clipRecord.requiresAudio !== "boolean" ||
			typeof clipRecord.mediaUrlHash !== "string" || !clipRecord.mediaUrlHash.trim() ||
			!clipMedia || typeof clipMedia !== "object" || Array.isArray(clipMedia) ||
			!clipChecks || typeof clipChecks !== "object" || Array.isArray(clipChecks) ||
			!validFacts(clipMedia as Record<string, unknown>) ||
			!["videoStreamPresent", "durationMatchesPlan", "generationResolutionReached", "fpsPresent", "requiredAudioPresent"]
				.every((key) => typeof (clipChecks as Record<string, unknown>)[key] === "boolean") ||
			!Array.isArray(clipRecord.missingCriteria) ||
			!clipRecord.missingCriteria.every((criterion) => typeof criterion === "string" && criterion.trim())
		) return null;
		clipIndexes.add(clipRecord.clipIndex);
	}
	return value as VideoFinishingTechnicalVerification;
}

export async function inspectVideoFinishingOutput(input: {
	contract: VideoFinishingContract;
	expectedSourceDurationSeconds: number;
	sourceResolution: string;
	sourceVideoUrl: string;
	masterVideoUrl: string;
	clips: VideoFinishingClipInput[];
	verifiedAt: string;
	probe?: ProbeMedia;
}): Promise<VideoFinishingInspectionResult> {
	const probe = input.probe ?? ((request) => probeMediaViaMediaWorker(request));
	const [source, master, ...clipProbes] = await Promise.all([
		probe({ url: input.sourceVideoUrl, timeoutMs: 30_000 }),
		probe({ url: input.masterVideoUrl, timeoutMs: 30_000 }),
		...input.clips.map((clip) => probe({ url: clip.videoUrl, timeoutMs: 30_000 })),
	]);
	if (!source) return { state: "pending", reason: "source_media_probe_unavailable" };
	if (!master) return { state: "pending", reason: "master_media_probe_unavailable" };
	const missingClipIndex = clipProbes.findIndex((clipProbe) => !clipProbe);
	if (missingClipIndex >= 0) {
		return {
			state: "pending",
			reason: "clip_media_probe_unavailable",
			clipIndex: input.clips[missingClipIndex]?.clipIndex,
		};
	}
	return {
		state: "complete",
		verification: buildVideoFinishingTechnicalVerification({
			contract: input.contract,
			expectedSourceDurationSeconds: input.expectedSourceDurationSeconds,
			sourceResolution: input.sourceResolution,
			sourceVideoUrl: input.sourceVideoUrl,
			masterVideoUrl: input.masterVideoUrl,
			clips: input.clips.map((clip, index) => ({
				input: clip,
				probe: clipProbes[index]!,
			})),
			source,
			master,
			verifiedAt: input.verifiedAt,
		}),
	};
}

export async function inspectVideoFinishingPreSubmission(input: {
	expectedSourceDurationSeconds: number;
	sourceResolution: string;
	sourceVideoUrl: string;
	clips: VideoFinishingClipInput[];
	probe?: ProbeMedia;
}): Promise<VideoFinishingPreSubmissionInspectionResult> {
	const probe = input.probe ?? ((request) => probeMediaViaMediaWorker(request));
	const [source, ...clipProbes] = await Promise.all([
		probe({ url: input.sourceVideoUrl, timeoutMs: 30_000 }),
		...input.clips.map((clip) => probe({ url: clip.videoUrl, timeoutMs: 30_000 })),
	]);
	if (!source) return { state: "pending", reason: "source_media_probe_unavailable" };
	const missingClipIndex = clipProbes.findIndex((clipProbe) => !clipProbe);
	if (missingClipIndex >= 0) {
		return {
			state: "pending",
			reason: "clip_media_probe_unavailable",
			clipIndex: input.clips[missingClipIndex]?.clipIndex,
		};
	}
	const sourceFacts = normalizeProbeFacts(source);
	const minimumShortEdgePixels =
		resolveFinishingMinimumShortEdgePixels(input.sourceResolution) ?? 0;
	const clipVerification = input.clips.map((clip, index) => verifyClipMedia({
		clip,
		probe: clipProbes[index]!,
		expectedMinimumShortEdgePixels: minimumShortEdgePixels,
	}));
	const sourceDuration = verifyVideoFinishingSourceDuration({
		expectedDurationSeconds: input.expectedSourceDurationSeconds,
		probe: source,
	});
	const requiresSourceAudio = input.clips.some((clip) => clip.requiresAudio);
	const sourceChecks = {
		durationMatchesPlan: sourceDuration.satisfied,
		videoStreamPresent:
			sourceFacts.width > 0 && sourceFacts.height > 0 && Boolean(sourceFacts.videoCodec),
		generationResolutionReached:
			minimumShortEdgePixels > 0 &&
			Math.min(sourceFacts.width, sourceFacts.height) >= minimumShortEdgePixels,
		requiredAudioPresent: !requiresSourceAudio || Boolean(sourceFacts.audioCodec),
	};
	const missingCriteria = [
		...clipVerification.flatMap((clip) =>
			clip.missingCriteria.map((criterion) => `clips[${clip.clipIndex}].${criterion}`),
		),
		...Object.entries(sourceChecks)
			.filter(([, satisfied]) => !satisfied)
			.map(([criterion]) => `source.${criterion}`),
	];
	return {
		state: "complete",
		satisfied: missingCriteria.length === 0,
		missingCriteria,
		...(missingCriteria.length > 0
			? {
					failureReason:
						`video_finishing_pre_submission_verification_failed:${missingCriteria.join(",")}`,
			  }
			: {}),
	};
}

export function videoFinishingVerificationMatchesMedia(input: {
	verification: VideoFinishingTechnicalVerification;
	contract: VideoFinishingContract;
	expectedSourceDurationSeconds: number;
	sourceResolution: string;
	sourceVideoUrl: string;
	masterVideoUrl: string;
	clips: VideoFinishingClipInput[];
}): boolean {
	if (
		input.verification.expected.sourceDurationSeconds !== input.expectedSourceDurationSeconds ||
		input.verification.expected.sourceResolution !== input.sourceResolution ||
		input.verification.expected.resolution !== input.contract.resolution ||
		input.verification.expected.fps !== input.contract.fps ||
		input.verification.mediaIdentity.sourceVideoUrlHash !== hashMediaUrl(input.sourceVideoUrl) ||
		input.verification.mediaIdentity.masterVideoUrlHash !== hashMediaUrl(input.masterVideoUrl) ||
		input.verification.clips.length !== input.clips.length
	) return false;
	const verificationByClip = new Map(
		input.verification.clips.map((clip) => [clip.clipIndex, clip]),
	);
	return input.clips.every((clip) => {
		const verification = verificationByClip.get(clip.clipIndex);
		return Boolean(
			verification &&
			verification.expectedDurationSeconds === clip.expectedDurationSeconds &&
			verification.requiresAudio === clip.requiresAudio &&
			verification.mediaUrlHash === hashMediaUrl(clip.videoUrl),
		);
	});
}

export async function inspectVideoFinishingSource(input: {
	sourceVideoUrl: string;
	expectedDurationSeconds: number;
	probe?: ProbeMedia;
}): Promise<VideoFinishingSourceInspectionResult> {
	const probe = input.probe ?? ((request) => probeMediaViaMediaWorker(request));
	const source = await probe({ url: input.sourceVideoUrl, timeoutMs: 30_000 });
	if (!source) return { state: "pending", reason: "source_media_probe_unavailable" };
	return verifyVideoFinishingSourceDuration({
		expectedDurationSeconds: input.expectedDurationSeconds,
		probe: source,
	});
}
