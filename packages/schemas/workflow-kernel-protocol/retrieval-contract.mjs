/** Shared wire validation, used by Agent runtime and Workflow IR consumers. */
function record(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Workflow knowledge ${field} must be an object`);
  return value;
}
function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Workflow knowledge ${field} must be a non-empty string`);
  return value;
}
function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Workflow knowledge ${field} must be a non-negative safe integer`);
  return value;
}
export function normalizeKnowledgeCandidateLimit(value) {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Workflow knowledge limit must be a positive safe integer when specified");
  return value;
};
export function parseWorkflowKnowledgeDiagnostics(value) {
  const input = record(value, "diagnostics");
  const output = {
    vectorCandidates: count(input.vectorCandidates, "diagnostics.vectorCandidates"),
    indexedCards: count(input.indexedCards, "diagnostics.indexedCards"),
    availableCards: count(input.availableCards, "diagnostics.availableCards"),
    embeddingModel: text(input.embeddingModel, "diagnostics.embeddingModel"),
  };
  const counts = ["vectorHits", "requestedQueryViews", "queryViews", "omittedQueryViews", "vectorSearches", "lexicalCandidates", "lexicalHits", "lexicalSearches", "deduplicatedResults", "graphHits", "graphExcludedItems", "scopedBodyBytes"];
  for (const key of counts) if (input[key] !== undefined) output[key] = count(input[key], `diagnostics.${key}`);
  for (const key of ["lexicalSearchAvailable", "graphTruncated"]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new Error(`Workflow knowledge diagnostics.${key} must be boolean`);
    output[key] = input[key];
  }
  if (input.mode !== undefined) {
    if (input.mode !== "vector") throw new Error("Workflow knowledge diagnostics.mode must be vector");
    output.mode = input.mode;
  }
  if (input.searchBodyAccess !== undefined) {
    if (input.searchBodyAccess !== "metadata_only") throw new Error("Workflow knowledge search must return metadata only");
    output.searchBodyAccess = input.searchBodyAccess;
  }
  if (input.channels !== undefined) {
    const channels = record(input.channels, "diagnostics.channels");
    output.channels = Object.fromEntries(["vector", "lexical", "graph"].map((key) => [key, text(channels[key], `diagnostics.channels.${key}`)]));
  }
  if (input.failures !== undefined) {
    if (!Array.isArray(input.failures)) throw new Error("Workflow knowledge diagnostics.failures must be an array");
    output.failures = input.failures.map((value) => {
      const failure = record(value, "diagnostics.failure");
      if (failure.blocking !== false) throw new Error("Workflow knowledge diagnostics cannot terminate a creative task");
      return { channel: text(failure.channel, "failure.channel"), reason: text(failure.reason, "failure.reason"), blocking: false,
        ...(failure.queryId === undefined ? {} : { queryId: text(failure.queryId, "failure.queryId") }) };
    });
  }
  if (input.phases !== undefined) {
    if (!Array.isArray(input.phases)) throw new Error("Workflow knowledge diagnostics.phases must be an array");
    output.phases = input.phases.map((value) => {
      const phase = record(value, "diagnostics.phase");
      if (phase.status !== "succeeded" && phase.status !== "failed") throw new Error("Workflow knowledge phase status invalid");
      return { phase: text(phase.phase, "phase.phase"), durationMs: count(phase.durationMs, "phase.durationMs"), status: phase.status,
        ...(phase.error === undefined ? {} : { error: text(phase.error, "phase.error") }) };
    });
  }
  return output;
};
