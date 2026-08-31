export type VideoExecutionSpecs = {
  aspect: string;
  resolution: string;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string {
  return typeof record?.[key] === "string" ? record[key].trim() : "";
}

/**
 * Resolve execution dimensions from two persisted first-party facts only:
 * explicit BeatSheet meta, or the current user-intent delivery contract.
 * Missing values and conflicts are errors; there is no default ratio/resolution.
 */
export function resolveVideoExecutionSpecs(metaValue: unknown): VideoExecutionSpecs {
  const meta = readRecord(metaValue);
  const intent = readRecord(meta?.userIntentContract);
  const delivery = readRecord(intent?.delivery);
  const metaAspect = readString(meta, "aspect");
  const metaResolution = readString(meta, "resolution");
  const deliveryAspect = readString(delivery, "aspect");
  const deliveryResolution = readString(delivery, "resolution");
  if (metaAspect && deliveryAspect && metaAspect !== deliveryAspect) {
    throw new Error(`video_execution_spec_conflict:aspect:${metaAspect}:${deliveryAspect}`);
  }
  if (metaResolution && deliveryResolution && metaResolution !== deliveryResolution) {
    throw new Error(
      `video_execution_spec_conflict:resolution:${metaResolution}:${deliveryResolution}`,
    );
  }
  const aspect = metaAspect || deliveryAspect;
  const resolution = metaResolution || deliveryResolution;
  if (!aspect) throw new Error("video_execution_spec_missing:aspect");
  if (!resolution) throw new Error("video_execution_spec_missing:resolution");
  return { aspect, resolution };
}
