/**
 * Resolve a positive-integer limit from an env value, falling back to a FINITE
 * default. This replaces the previous `999999` fail-open fallbacks: with the env
 * var unset, heavy work is now bounded (→ backpressure / 429) instead of admitted
 * without limit until the process OOMs at peak.
 */
export function resolvePositiveIntEnv(
  raw: string | undefined | null,
  fallback: number,
  opts: { allowZero?: boolean } = {},
): number {
  const n = Number(String(raw ?? "").trim());
  const min = opts.allowZero ? 0 : 1;
  if (Number.isFinite(n) && n >= min) return Math.trunc(n);
  return fallback;
}

/**
 * Finite, memory-budget-derived fallbacks for the heavy-op admission limits.
 * All are overridable via their env vars; these values only apply when unset.
 * Sized so a single api/bridge process bounds concurrent heavy work rather than
 * accepting unbounded load (the root cause of peak-time OOM). Tune against the
 * post-streaming per-op memory cost.
 */
export const CONCURRENCY_DEFAULTS = {
  imageGlobal: 4,
  bridgeMaxConcurrency: 24,
  bridgeMaxQueueDepth: 256,
  bridgeMaxPerUser: 100,
} as const satisfies Record<string, number>;
