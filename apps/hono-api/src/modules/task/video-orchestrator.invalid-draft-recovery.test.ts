import { describe, expect, it } from "vitest";
import { buildInvalidDraftRestartRecovery } from "./video-orchestrator.invalid-draft-recovery";

describe("invalid BeatSheet draft recovery", () => {
	it("offers a fresh bound preflight without mutating or resuming the damaged run", () => {
		const recovery = buildInvalidDraftRestartRecovery({
			mode: "preflight_commit",
			runId: "video-old",
			draftRevision: "revision-old",
			message: "BeatSheet draft 记录字段不完整。",
		});

		expect(recovery).toMatchObject({
			ok: false,
			terminal: false,
			code: "beat_sheet_draft_invalid",
			runId: "video-old",
			recovery: {
				kind: "restart_preflight",
				abandonedRunId: "video-old",
				preservePriorRun: true,
				mediaSideEffectsObserved: false,
			},
			progressCursor: {
				phase: "preflight_restart_required",
				revision: "revision-old",
				allowedNextActions: ["preflight_begin"],
			},
			nextAction: "preflight_begin",
		});
	});

	it("uses the abandoned run identity when a never-created draft has no revision", () => {
		const recovery = buildInvalidDraftRestartRecovery({
			mode: "preflight_put_beat",
			runId: "video-never-started",
			message: "BeatSheet draft does not exist.",
		});

		expect(recovery).toMatchObject({
			code: "beat_sheet_draft_invalid",
			progressCursor: {
				revision: "video-never-started",
				allowedNextActions: ["preflight_begin"],
			},
			nextAction: "preflight_begin",
		});
	});
});
