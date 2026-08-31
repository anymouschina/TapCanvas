export type InvalidDraftRecoveryMode =
	| "preflight_get_header"
	| "preflight_get_beat"
	| "preflight_put_beat"
	| "preflight_patch_header"
	| "preflight_patch_beat"
	| "preflight_repair_continuity"
	| "preflight_commit";

export function buildInvalidDraftRestartRecovery(input: Readonly<{
	mode: InvalidDraftRecoveryMode;
	runId: string;
	draftRevision?: string;
	message: string;
}>): Readonly<Record<string, unknown>> {
	const runId = input.runId.trim();
	const draftRevision = input.draftRevision?.trim() ?? "";
	return {
		ok: false,
		severity: "warning",
		terminal: false,
		mode: input.mode,
		code: "beat_sheet_draft_invalid",
		runId,
		message: input.message,
		recovery: {
			version: 1,
			kind: "restart_preflight",
			reasonCode: "beat_sheet_draft_invalid",
			abandonedRunId: runId,
			preservePriorRun: true,
			mediaSideEffectsObserved: false,
			instruction:
				"当前损坏 draft 无法迁移或继续。保留旧 run 审计记录，在同一逻辑任务、同一模型与同一 session 中重新执行 preflight_begin；不得携带旧 runId/draftRevision，不得重放或覆盖旧 run。",
		},
		progressCursor: {
			version: 1,
			graph: "video_authoring",
			phase: "preflight_restart_required",
			revision: draftRevision || runId,
			completedUnitIds: [],
			pendingUnitIds: ["preflight:begin"],
			allowedNextActions: ["preflight_begin"],
			requiredReadActions: [],
		},
		nextAction: "preflight_begin",
	};
}
