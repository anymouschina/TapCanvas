import { computeClipDurations } from "./video-orchestrator.clip-plan";
import type { VideoGenerationContract } from "./video-orchestrator.generation-contract";

export type VideoProviderSubmissionTopology = {
	targetDurationSeconds: number;
	expectedClipCount: number;
	minimumClipDurations: number[];
	source: "user_clip_durations" | "user_clip_count" | "model_max_duration";
};

export type VideoPreflightSubmissionTopology = {
	expectedBeatCount: number;
	providerSubmissionTopology: VideoProviderSubmissionTopology | null;
};

export type VideoProviderDurationTopologyInput = {
	targetDurationSeconds: number;
	durationOptions: readonly number[];
	requestedClipCount?: number | null;
	explicitDurations?: readonly number[] | null;
};

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readPositiveInteger(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function partitionDurationWithExactCount(input: Readonly<{
	targetDurationSeconds: number;
	durationOptions: readonly number[];
	clipCount: number;
}>): number[] | null {
	const options = [...new Set(input.durationOptions)]
		.filter((duration) => Number.isInteger(duration) && duration > 0)
		.sort((left, right) => right - left);
	const memo = new Map<string, number[] | null>();
	const visit = (remainingSeconds: number, remainingClips: number): number[] | null => {
		if (remainingClips === 0) return remainingSeconds === 0 ? [] : null;
		const key = `${remainingSeconds}:${remainingClips}`;
		if (memo.has(key)) return memo.get(key) ?? null;
		for (const duration of options) {
			const nextSeconds = remainingSeconds - duration;
			if (nextSeconds < 0) continue;
			const tail = visit(nextSeconds, remainingClips - 1);
			if (tail) {
				const result = [duration, ...tail];
				memo.set(key, result);
				return result;
			}
		}
		memo.set(key, null);
		return null;
	};
	return visit(input.targetDurationSeconds, input.clipCount);
}

/**
 * Freezes provider submission count independently from creative beat density.
 * Several internal shots may live in one generated clip. Without an explicit
 * user clip count, the runtime fills the live model's longest legal duration
 * first and therefore makes the fewest provider submissions.
 */
export function resolveVideoProviderSubmissionTopology(input: {
	userIntentContract: unknown;
	generationContract: VideoGenerationContract;
}): VideoProviderSubmissionTopology {
	const contract = readRecord(input.userIntentContract);
	const delivery = readRecord(contract?.delivery);
	const targetDurationSeconds = readPositiveInteger(delivery?.durationSeconds);
	if (!targetDurationSeconds) {
		throw new Error("video_provider_topology_target_duration_required");
	}

	const requestedClipCount = readPositiveInteger(delivery?.clipCount);
	return resolveVideoProviderDurationTopology({
		targetDurationSeconds,
		durationOptions: input.generationContract.durationOptions,
		requestedClipCount,
	});
}

/**
 * Shared deterministic provider topology resolver for every video entrypoint.
 * Creative beat density never participates: only an explicit target duration,
 * the live model catalog and an optional user-authored provider clip count may
 * affect the physical submission plan.
 */
export function resolveVideoProviderDurationTopology(
	input: VideoProviderDurationTopologyInput,
): VideoProviderSubmissionTopology {
	const targetDurationSeconds = readPositiveInteger(input.targetDurationSeconds);
	if (!targetDurationSeconds) {
		throw new Error("video_provider_topology_target_duration_required");
	}
	const requestedClipCount = readPositiveInteger(input.requestedClipCount);
	let minimumClipDurations: number[];
	try {
		if (input.explicitDurations?.length) {
			minimumClipDurations = computeClipDurations({
				targetDurationSeconds,
				durationOptions: [...input.durationOptions],
				explicitDurations: [...input.explicitDurations],
			});
		} else if (requestedClipCount !== null) {
			minimumClipDurations = partitionDurationWithExactCount({
				targetDurationSeconds,
				durationOptions: input.durationOptions,
				clipCount: requestedClipCount,
			}) ?? [];
			if (minimumClipDurations.length === 0) {
				throw new Error(
					`video_provider_topology_exact_clip_count_unsupported:target=${targetDurationSeconds}:clips=${requestedClipCount}:allowed=${input.durationOptions.join(",")}`,
				);
			}
		} else {
			minimumClipDurations = computeClipDurations({
				targetDurationSeconds,
				durationOptions: [...input.durationOptions],
			});
		}
	} catch (error: unknown) {
		if (error instanceof Error && error.message.startsWith("video_exact_duration_unsupported:")) {
			throw new Error(
				`video_provider_topology_exact_duration_unsupported:target=${targetDurationSeconds}:allowed=${input.durationOptions.join(",")}`,
			);
		}
		throw error;
	}
	const realizedDurationSeconds = minimumClipDurations.reduce(
		(total, durationSeconds) => total + durationSeconds,
		0,
	);
	if (realizedDurationSeconds !== targetDurationSeconds) {
		throw new Error(
			`video_provider_topology_exact_duration_unsupported:target=${targetDurationSeconds}:realized=${realizedDurationSeconds}:allowed=${input.durationOptions.join(",")}`,
		);
	}

	if (input.explicitDurations?.length && requestedClipCount !== null
		&& requestedClipCount !== minimumClipDurations.length) {
		throw new Error(
			`video_provider_topology_clip_count_duration_mismatch:requested=${requestedClipCount}:durations=${minimumClipDurations.length}`,
		);
	}
	if (requestedClipCount !== null && requestedClipCount < minimumClipDurations.length) {
		throw new Error(
			`video_provider_topology_clip_count_below_minimum:requested=${requestedClipCount}:minimum=${minimumClipDurations.length}`,
		);
	}

	return {
		targetDurationSeconds,
		expectedClipCount: requestedClipCount ?? minimumClipDurations.length,
		minimumClipDurations,
		source: input.explicitDurations?.length
			? "user_clip_durations"
			: requestedClipCount === null
				? "model_max_duration"
				: "user_clip_count",
	};
}

/**
 * Full-chapter duration is an output of the complete authored beats, so the
 * provider topology cannot be frozen before those beats exist. Bounded-duration
 * delivery is different: its user-authorized duration is already a durable
 * input and may determine the minimum provider submission count up front.
 */
export function resolveVideoPreflightSubmissionTopology(input: {
	deliveryScope: unknown;
	requestedExpectedBeatCount: unknown;
	userIntentContract: unknown;
	generationContract: VideoGenerationContract;
}): VideoPreflightSubmissionTopology {
	const requestedExpectedBeatCount = readPositiveInteger(input.requestedExpectedBeatCount);
	if (!requestedExpectedBeatCount || requestedExpectedBeatCount > 64) {
		throw new Error("video_preflight_expected_beat_count_invalid");
	}
	if (input.deliveryScope === "full_chapter") {
		return {
			expectedBeatCount: requestedExpectedBeatCount,
			providerSubmissionTopology: null,
		};
	}
	if (input.deliveryScope !== "bounded_duration") {
		throw new Error("video_preflight_delivery_scope_invalid");
	}
	const providerSubmissionTopology = resolveVideoProviderSubmissionTopology({
		userIntentContract: input.userIntentContract,
		generationContract: input.generationContract,
	});
	return {
		expectedBeatCount: providerSubmissionTopology.expectedClipCount,
		providerSubmissionTopology,
	};
}
