export const MAX_AUTOMATIC_WRITER_REPLAN_GENERATIONS = 1;

export type VideoReplanLineageV1 = {
  version: 1;
  rootRunId: string;
  sourceRunId: string;
  generation: number;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readVideoReplanLineage(
  beatSheet: Record<string, unknown> | null | undefined,
): VideoReplanLineageV1 | null {
  const meta = readRecord(beatSheet?.meta);
  const lineage = readRecord(meta?.replanLineage);
  const rootRunId = readTrimmed(lineage?.rootRunId);
  const sourceRunId = readTrimmed(lineage?.sourceRunId);
  const generation = Number(lineage?.generation);
  if (
    lineage?.version !== 1 ||
    !rootRunId ||
    !sourceRunId ||
    !Number.isInteger(generation) ||
    generation < 1
  ) {
    return null;
  }
  return { version: 1, rootRunId, sourceRunId, generation };
}

/**
 * Adds structural replan provenance after agents have selected replan_beats.
 * This does not alter creative facts; it only bounds automatic physical-run
 * recovery and keeps the original logical production lineage auditable.
 */
export function stampVideoReplanLineage(input: {
  beatSheet: Record<string, unknown>;
  sourceRunId: string;
}): Record<string, unknown> {
  const prior = readVideoReplanLineage(input.beatSheet);
  const meta = readRecord(input.beatSheet.meta) ?? {};
  return {
    ...input.beatSheet,
    meta: {
      ...meta,
      replanLineage: {
        version: 1,
        rootRunId: prior?.rootRunId ?? input.sourceRunId,
        sourceRunId: input.sourceRunId,
        generation: (prior?.generation ?? 0) + 1,
      } satisfies VideoReplanLineageV1,
    },
  };
}
