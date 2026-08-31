const REQUIRED_HEADER_FIELDS = [
  "sourceCoveragePlan",
] as const;

const REQUIRED_META_FIELDS = [
  "aspect",
  "resolution",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns only deterministic schema addresses that are not present yet.
 * It deliberately does not judge creative quality; the assembled BeatSheet
 * still goes through the canonical commit validator before production.
 */
export function readMissingDraftHeaderFields(header: Record<string, unknown>): string[] {
  const missing = REQUIRED_HEADER_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(header, field),
  );
  const meta = isRecord(header.meta) ? header.meta : {};
  const missingMeta = REQUIRED_META_FIELDS
    .filter((field) => !Object.prototype.hasOwnProperty.call(meta, field))
    .map((field) => `meta.${field}`);
  return [...missing, ...missingMeta];
}

export function readNextDraftHeaderPatchField(header: Record<string, unknown>): string | null {
  const [next] = readMissingDraftHeaderFields(header);
  return next?.startsWith("meta.") ? "meta" : next ?? null;
}

const PATCHABLE_HEADER_FIELDS = new Set([
  "storyFactsContext",
  "sourceCoveragePlan",
  "visualStateTimeline",
  "filmBible",
  "adaptationStrategy",
  "castManifest",
  "meta",
]);

/**
 * Header mutations are revision-fenced but no longer serialized by creative
 * section. A model may submit every section it already authored in one call;
 * the runtime only rejects empty or unknown structural addresses.
 */
export function assertDraftHeaderPatch(patch: Record<string, unknown>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) {
    throw new Error("beat_sheet_header_patch_empty");
  }
  const unknownFields = fields.filter((field) => !PATCHABLE_HEADER_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw new Error(
      `beat_sheet_header_patch_unknown_fields: ${JSON.stringify(unknownFields)}`,
    );
  }
}

/**
 * A revision is durable workflow progress only when it clears the current
 * execution-critical frontier. Optional creative metadata may travel in the
 * same patch, but changing it alone must not mint a new revision while the
 * required field at the head of the cursor is still missing.
 */
export function assertDraftHeaderRequiredFrontierAdvanced(input: {
  current: Record<string, unknown>;
  next: Record<string, unknown>;
}): void {
  const [requiredField] = readMissingDraftHeaderFields(input.current);
  if (!requiredField) return;
  const nextMissingFields = readMissingDraftHeaderFields(input.next);
  if (!nextMissingFields.includes(requiredField)) return;
  throw new Error(
    `beat_sheet_header_required_frontier_not_advanced: required=${requiredField}`,
  );
}
