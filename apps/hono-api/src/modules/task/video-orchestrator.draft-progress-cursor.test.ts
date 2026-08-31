import { describe, expect, it } from "vitest";

import {
	buildCommittedPreflightProgressCursor,
	buildDraftProgressCursor,
	resolveDraftProgressNextAction,
	resolveDraftProgressNextActionAfterRead,
} from "./video-orchestrator.draft-progress-cursor";

describe("BeatSheet draft progress cursor", () => {
	it("persists server-authored repair edges even when every beat is present", () => {
		expect(buildDraftProgressCursor({
			revision: "draft-1",
			expectedBeatCount: 3,
			missingClipIndexes: [],
			repairActions: [
				"preflight_get_header",
				"preflight_begin",
				"preflight_get_beat",
				"preflight_put_beat",
				"preflight_commit",
			],
			repairIssues: [
				"beats[1].sceneName 必填",
				"beats[2].assetObjectContracts 结构无效",
			],
			repairClipIndexes: [2, 1, 2],
			beatRevisions: ["beat-0", "beat-1", "beat-2"],
		})).toMatchObject({
			allowedNextActions: [
				"preflight_get_header",
				"preflight_begin",
				"preflight_get_beat",
				"preflight_put_beat",
				"preflight_commit",
			],
			requiredReadActions: [],
			repair: {
				header: false,
				clipIndexes: [1, 2],
				targets: [
					{ clipIndex: 1, beatRevision: "beat-1" },
					{ clipIndex: 2, beatRevision: "beat-2" },
				],
				continuityClipIndexes: [],
				issues: [
					"beats[1].sceneName 必填",
					"beats[2].assetObjectContracts 结构无效",
				],
			},
		});
	});

	it("includes only exact persisted beat fences in repair targets", () => {
		expect(buildDraftProgressCursor({
			revision: "draft-fenced-repair",
			expectedBeatCount: 3,
			missingClipIndexes: [2],
			repairActions: ["preflight_get_beat", "preflight_patch_beat"],
			repairIssues: ["beats[1] needs repair"],
			repairClipIndexes: [1, 2],
			beatRevisions: ["beat-0", "beat-1", null],
		})).toMatchObject({
			repair: {
				targets: [{ clipIndex: 1, beatRevision: "beat-1" }],
			},
		});
	});

	it("keeps deterministic continuity projection discoverable for stale repair frontiers", () => {
		expect(buildDraftProgressCursor({
			revision: "draft-stale-repair",
			expectedBeatCount: 2,
			missingClipIndexes: [],
			repairActions: ["preflight_get_beat", "preflight_patch_beat"],
			repairIssues: ["durable validator issue"],
			repairClipIndexes: [1],
			repairContinuityClipIndexes: [1],
		})).toMatchObject({
			allowedNextActions: [
				"preflight_get_beat",
				"preflight_patch_beat",
				"preflight_repair_continuity",
			],
			requiredReadActions: [],
		});
	});

	it("does not make branch-specific repair reads global prerequisites", () => {
		expect(buildDraftProgressCursor({
			revision: "draft-branch-repair",
			expectedBeatCount: 2,
			missingClipIndexes: [],
			repairActions: [
				"preflight_get_header",
				"preflight_get_beat",
				"preflight_patch_header",
				"preflight_patch_beat",
			],
			repairIssues: ["header and beat paths require independent fences"],
			repairClipIndexes: [1],
			repairHeader: true,
		})).toMatchObject({
			requiredReadActions: [],
			allowedNextActions: [
				"preflight_get_header",
				"preflight_get_beat",
				"preflight_patch_header",
				"preflight_patch_beat",
			],
		});
	});

	it("advertises the repair edge before commit and projects the same next action", () => {
		const cursor = buildDraftProgressCursor({
			revision: "draft-repair-first",
			expectedBeatCount: 2,
			missingClipIndexes: [],
			repairActions: ["preflight_get_beat", "preflight_patch_beat", "preflight_commit"],
			repairIssues: ["beats[1].characterStateVersions.角色甲 invalid"],
			repairClipIndexes: [1],
		});
		expect(resolveDraftProgressNextAction(cursor)).toBe("preflight_get_beat");
	});

	it("projects the adjacent patch after a successful repair read without changing durable actions", () => {
		const cursor = buildDraftProgressCursor({
			revision: "draft-read-frontier",
			expectedBeatCount: 3,
			missingClipIndexes: [],
			repairActions: [
				"preflight_get_header",
				"preflight_patch_header",
				"preflight_get_beat",
				"preflight_patch_beat",
				"preflight_commit",
			],
			repairIssues: ["header and beat sequences disagree"],
			repairClipIndexes: [0, 1, 2],
			repairHeader: true,
		});
		expect(resolveDraftProgressNextActionAfterRead(cursor, "header")).toBe("preflight_patch_header");
		expect(resolveDraftProgressNextActionAfterRead(cursor, "beat")).toBe("preflight_patch_beat");
		expect(cursor).toMatchObject({
			allowedNextActions: [
				"preflight_get_header",
				"preflight_patch_header",
				"preflight_get_beat",
				"preflight_patch_beat",
				"preflight_commit",
			],
		});
	});

	it("keeps the ordinary frontier when the adjacent repair mutation is unavailable", () => {
		const cursor = buildDraftProgressCursor({
			revision: "draft-ordinary-read",
			expectedBeatCount: 2,
			missingClipIndexes: [1],
		});
		expect(resolveDraftProgressNextActionAfterRead(cursor, "header")).toBe("preflight_put_beat");
		expect(resolveDraftProgressNextActionAfterRead(cursor, "beat")).toBe("preflight_put_beat");
	});

	it("keeps the ordinary frontier minimal outside recovery", () => {
		expect(buildDraftProgressCursor({
			revision: "draft-2",
			expectedBeatCount: 3,
			missingClipIndexes: [1, 2],
		})).toMatchObject({
			completedUnitIds: ["preflight:header", "beat:0"],
			pendingUnitIds: ["beat:1", "beat:2"],
			allowedNextActions: ["preflight_put_beat"],
			requiredReadActions: ["preflight_get_header"],
		});
	});

	it("routes an incomplete chapter header to one incremental patch before beats", () => {
		expect(buildDraftProgressCursor({
			revision: "draft-header",
			expectedBeatCount: 3,
			missingHeaderFields: ["sourceCoveragePlan", "filmBible", "meta.aspect"],
			missingClipIndexes: [0, 1, 2],
		})).toMatchObject({
			completedUnitIds: [],
			pendingUnitIds: [
				"header:sourceCoveragePlan",
				"header:filmBible",
				"header:meta.aspect",
				"beat:0",
				"beat:1",
				"beat:2",
			],
			missingHeaderFields: ["sourceCoveragePlan", "filmBible", "meta.aspect"],
			nextHeaderPatchField: "sourceCoveragePlan",
			allowedNextActions: ["preflight_patch_header"],
			requiredReadActions: [],
		});
	});

	it("advances a successful commit receipt to the production loop frontier", () => {
		expect(buildCommittedPreflightProgressCursor({
			preflightRevision: "preflight-3",
			beatCount: 3,
		})).toEqual({
			version: 1,
			graph: "video_authoring",
			phase: "preflight_committed",
			revision: "preflight-3",
			completedUnitIds: [
				"preflight:header",
				"beat:0",
				"beat:1",
				"beat:2",
				"preflight:commit",
			],
			pendingUnitIds: ["production:loop"],
			allowedNextActions: ["loop"],
			requiredReadActions: [],
		});
	});
});
