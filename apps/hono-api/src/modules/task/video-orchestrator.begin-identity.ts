export function assertPreflightBeginIdentityAbsent(input: Readonly<{
  topLevelRunId: unknown;
  draftRevision: unknown;
  headerRunId: unknown;
}>): void {
  const topLevelRunId = String(input.topLevelRunId ?? "").trim();
  const draftRevision = String(input.draftRevision ?? "").trim();
  const headerRunId = String(input.headerRunId ?? "").trim();

  if (topLevelRunId || draftRevision) {
    throw new Error(
      "preflight_begin_identity_forbidden: begin always allocates a new logical run; " +
      "resume an existing run with preflight_get_header and its runId",
    );
  }
  if (headerRunId) {
    throw new Error(
      "preflight_begin_identity_forbidden: beatSheetHeader.runId is server allocated; " +
      "resume an existing run with preflight_get_header and its top-level runId",
    );
  }
}
