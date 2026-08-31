export type VideoDurationPartitionPreference = "longest_first" | "shortest_first";

function normalizeDurationOptions(values: readonly number[]): number[] {
	return Array.from(
		new Set(
			values
				.map((value) => Math.trunc(Number(value)))
				.filter((value) => Number.isFinite(value) && value > 0),
		),
	).sort((left, right) => left - right);
}

function compareLexicographically(left: readonly number[], right: readonly number[]): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

function preferredPlan(input: Readonly<{
	candidate: readonly number[];
	current: readonly number[] | null;
	preference: VideoDurationPartitionPreference;
}>): boolean {
	if (!input.current) return true;
	if (input.candidate.length !== input.current.length) {
		return input.preference === "longest_first"
			? input.candidate.length < input.current.length
			: input.candidate.length > input.current.length;
	}
	const comparison = compareLexicographically(input.candidate, input.current);
	return input.preference === "longest_first" ? comparison > 0 : comparison < 0;
}

/**
 * Produces an exact provider-valid duration partition.
 *
 * `longest_first` minimizes provider submissions and, among equal-size plans,
 * fills the earliest clips with the longest legal durations. The function
 * never rounds, clamps or invents a duration: an unsupported exact total is a
 * deterministic error.
 */
export function partitionVideoDurationExact(input: Readonly<{
	targetDurationSeconds: number;
	durationOptions: readonly number[];
	preference?: VideoDurationPartitionPreference;
}>): number[] {
	const target = Math.trunc(Number(input.targetDurationSeconds));
	if (!Number.isFinite(target) || target <= 0 || target !== input.targetDurationSeconds) {
		throw new Error(`video_target_duration_invalid:${String(input.targetDurationSeconds)}`);
	}
	const options = normalizeDurationOptions(input.durationOptions);
	if (options.length === 0) throw new Error("video_generation_duration_options_missing");
	const preference = input.preference ?? "longest_first";
	const preferredOrder = preference === "longest_first"
		? [...options].sort((left, right) => right - left)
		: options;
	const plans: Array<readonly number[] | null> = Array.from({ length: target + 1 }, () => null);
	plans[0] = [];
	for (let total = 1; total <= target; total += 1) {
		let best: readonly number[] | null = null;
		for (const duration of preferredOrder) {
			if (duration > total) continue;
			const previous = plans[total - duration];
			if (!previous) continue;
			const candidate = [...previous, duration].sort((left, right) => (
				preference === "longest_first" ? right - left : left - right
			));
			if (preferredPlan({ candidate, current: best, preference })) best = candidate;
		}
		plans[total] = best;
	}
	const result = plans[target];
	if (!result) {
		throw new Error(
			`video_exact_duration_unsupported:target=${target}:allowed=${options.join(",")}`,
		);
	}
	return [...result];
}
