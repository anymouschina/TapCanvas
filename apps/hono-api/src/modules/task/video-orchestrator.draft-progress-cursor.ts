export type DraftProgressCursorInput = {
	revision: string;
	expectedBeatCount: number;
	missingClipIndexes: number[];
	missingHeaderFields?: readonly string[];
	repairActions?: readonly string[];
  repairIssues?: readonly string[];
	repairClipIndexes?: readonly number[];
  beatRevisions?: readonly (string | null)[];
  repairContinuityClipIndexes?: readonly number[];
  repairHeader?: boolean;
};

export type CommittedPreflightProgressCursorInput = {
	preflightRevision: string;
	beatCount: number;
};

/** Build the durable, structure-only ready frontier for BeatSheet authoring. */
export function buildDraftProgressCursor(input: DraftProgressCursorInput): Record<string, unknown> {
	const pending = new Set(input.missingClipIndexes);
	const missingHeaderFields = Array.from(
		new Set((input.missingHeaderFields ?? []).map((field) => field.trim()).filter(Boolean)),
	);
	const repairActions = Array.from(
		new Set((input.repairActions ?? []).map((action) => action.trim()).filter(Boolean)),
	);
  const repairIssues = Array.from(new Set((input.repairIssues ?? []).map((issue) => issue.trim()).filter(Boolean)));
	const baseActions = repairIssues.length > 0
		? []
		: missingHeaderFields.length > 0
			? ["preflight_patch_header"]
			: input.missingClipIndexes.length > 0
				? ["preflight_put_beat"]
				: ["preflight_commit"];
	const repairClipIndexes = Array.from(
		new Set((input.repairClipIndexes ?? []).filter((index) => Number.isInteger(index) && index >= 0)),
	).sort((left, right) => left - right);
	const repairContinuityClipIndexes = Array.from(
		new Set((input.repairContinuityClipIndexes ?? []).filter((index) => Number.isInteger(index) && index > 0)),
	).sort((left, right) => left - right);
	const repairTargets = repairClipIndexes.flatMap((clipIndex) => {
		const beatRevision = input.beatRevisions?.[clipIndex]?.trim() ?? "";
		return beatRevision ? [{ clipIndex, beatRevision }] : [];
	});
	const deterministicRepairActions = repairIssues.length > 0 && repairContinuityClipIndexes.length > 0
		? ["preflight_repair_continuity"]
		: [];
	return {
		version: 1,
		graph: "video_authoring",
		phase: "preflight_draft",
		revision: input.revision,
		completedUnitIds: [
			...(missingHeaderFields.length === 0 ? ["preflight:header"] : []),
			...Array.from(
			{ length: input.expectedBeatCount },
			(_, index) => index,
		).filter((index) => !pending.has(index)).map((index) => `beat:${index}`),
		],
		pendingUnitIds: [
			...missingHeaderFields.map((field) => `header:${field}`),
			...input.missingClipIndexes.map((index) => `beat:${index}`),
		],
		missingHeaderFields,
		nextHeaderPatchField: missingHeaderFields[0]?.startsWith("meta.")
			? "meta"
			: missingHeaderFields[0] ?? null,
		allowedNextActions: Array.from(new Set([
			...repairActions,
			...deterministicRepairActions,
			...baseActions,
		])),
		repair: repairIssues.length > 0
      ? {
          header: input.repairHeader === true,
          clipIndexes: repairClipIndexes,
		  targets: repairTargets,
          continuityClipIndexes: repairContinuityClipIndexes,
          issues: repairIssues,
        }
      : null,
		// Ordinary authoring needs the frozen header. Recovery exposes a real
		// branch: continuity projection needs no reads, a header patch consumes
		// the header fence, and a beat patch consumes only its target beat fence.
		// Making either read global would force every branch (and every resumed
		// physical window) to replay unrelated nodes. Each mutation's exact schema
		// therefore owns its own revision prerequisite during repair.
		requiredReadActions: repairIssues.length > 0
      ? []
			: missingHeaderFields.length > 0
				? []
				: input.missingClipIndexes.length > 0
				? ["preflight_get_header"]
				: [],
	};
}

/** Project the single advertised next edge from the same cursor returned to agents. */
export function resolveDraftProgressNextAction(cursor: Record<string, unknown>): string {
	const allowed = Array.isArray(cursor.allowedNextActions)
		? cursor.allowedNextActions.filter((action): action is string => typeof action === "string" && action.length > 0)
		: [];
	return allowed[0] ?? "preflight_commit";
}

export type DraftProgressReadTarget = "header" | "beat";

/**
 * Project the structurally adjacent mutation after a successful fenced read.
 * This is receipt-local guidance only: it never mutates the durable repair
 * snapshot or decides which authored value is semantically correct.
 */
export function resolveDraftProgressNextActionAfterRead(
	cursor: Record<string, unknown>,
	target: DraftProgressReadTarget,
): string {
	const allowed = Array.isArray(cursor.allowedNextActions)
		? cursor.allowedNextActions.filter((action): action is string => typeof action === "string" && action.length > 0)
		: [];
	const adjacentMutation = target === "header" ? "preflight_patch_header" : "preflight_patch_beat";
	return allowed.includes(adjacentMutation)
		? adjacentMutation
		: resolveDraftProgressNextAction(cursor);
}

/**
 * Advance the authoritative durable frontier after a successful preflight
 * commit. A successful mutation receipt must describe the next graph state;
 * returning the previous draft cursor would make a valid `loop` call appear
 * out of order to every continuation runtime.
 */
export function buildCommittedPreflightProgressCursor(
	input: CommittedPreflightProgressCursorInput,
): Record<string, unknown> {
	return {
		version: 1,
		graph: "video_authoring",
		phase: "preflight_committed",
		revision: input.preflightRevision,
		completedUnitIds: [
			"preflight:header",
			...Array.from({ length: input.beatCount }, (_, index) => `beat:${index}`),
			"preflight:commit",
		],
		pendingUnitIds: ["production:loop"],
		allowedNextActions: ["loop"],
		requiredReadActions: [],
	};
}
