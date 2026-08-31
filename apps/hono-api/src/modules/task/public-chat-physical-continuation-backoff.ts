const PROVIDER_INTERRUPTION_DELAYS_MS = [15_000, 30_000, 60_000, 120_000] as const;

/**
 * Provider/host transport loss is durable waiting work, not a reason to replay
 * the same model request in a tight loop. Productive budget continuations stay
 * immediate; only interruption-only windows receive bounded backoff.
 */
export function resolvePhysicalContinuationNextAttemptAt(input: Readonly<{
	reasonCode: string;
	stage: number;
	nowMs: number;
}>): string | null {
	if (input.reasonCode !== "provider_stream_interrupted") return null;
	const stage = Number.isInteger(input.stage) && input.stage > 0 ? input.stage : 1;
	const delayIndex = Math.min(stage - 1, PROVIDER_INTERRUPTION_DELAYS_MS.length - 1);
	return new Date(input.nowMs + PROVIDER_INTERRUPTION_DELAYS_MS[delayIndex]!).toISOString();
}
