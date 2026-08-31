import { describe, expect, it } from "vitest";
import {
	applyBeatSheetDraftNodePatch,
	BeatSheetDraftPatchError,
	findInheritedContinuityRepairClipIndexes,
	projectInheritedContinuityEntry,
} from "./video-orchestrator.draft-patch";

describe("applyBeatSheetDraftNodePatch", () => {
	it("replaces only supplied top-level fields without mutating the source", () => {
		const current = {
			clipIndex: 1,
			storyFactLocks: { effectiveAt: null, bindings: [], revealGuards: [] },
			logline: "before",
		};
		const next = applyBeatSheetDraftNodePatch({
			current,
			patch: {
				storyFactLocks: {
					effectiveAt: null,
					bindings: [{ source: "task_context", contextKey: "content" }],
					revealGuards: [],
				},
			},
			immutableKeys: ["clipIndex"],
		});

		expect(next.logline).toBe("before");
		expect(next.storyFactLocks).not.toBe(current.storyFactLocks);
		expect(current.storyFactLocks).toEqual({ effectiveAt: null, bindings: [], revealGuards: [] });
	});

	it("rejects immutable, unknown, and empty patches", () => {
		const current = { clipIndex: 1, logline: "before" };
		expect(() => applyBeatSheetDraftNodePatch({
			current,
			patch: { clipIndex: 2 },
			immutableKeys: ["clipIndex"],
		})).toThrow(BeatSheetDraftPatchError);
		expect(() => applyBeatSheetDraftNodePatch({
			current,
			patch: { invented: true },
			immutableKeys: ["clipIndex"],
		})).toThrow("不属于当前持久节点");
		expect(() => applyBeatSheetDraftNodePatch({
			current,
			patch: {},
			immutableKeys: ["clipIndex"],
		})).toThrow("至少包含一个");
	});

	it("allows declared incremental fields and structurally merges runtime-owned records", () => {
		const next = applyBeatSheetDraftNodePatch({
			current: {
				version: 2,
				meta: { videoModel: "model-a", generationContract: { videoModel: "model-a" } },
			},
			patch: { meta: { aspect: "16:9", resolution: "480p" } },
			immutableKeys: ["version"],
			allowedNewKeys: ["filmBible"],
			mergeRecordKeys: ["meta"],
		});
		expect(next).toEqual({
			version: 2,
			meta: {
				videoModel: "model-a",
				generationContract: { videoModel: "model-a" },
				aspect: "16:9",
				resolution: "480p",
			},
		});
	});

	it("adds only current-schema fields during verifier repair", () => {
		const next = applyBeatSheetDraftNodePatch({
			current: { clipIndex: 7, logline: "existing" },
			patch: { pacingDecision: { sourceTreatment: "retain" } },
			immutableKeys: ["clipIndex"],
			allowedNewKeys: ["pacingDecision"],
		});

		expect(next).toEqual({
			clipIndex: 7,
			logline: "existing",
			pacingDecision: { sourceTreatment: "retain" },
		});
		expect(() => applyBeatSheetDraftNodePatch({
			current: { clipIndex: 7, logline: "existing" },
			patch: { inventedField: true },
			immutableKeys: ["clipIndex"],
			allowedNewKeys: ["pacingDecision"],
		})).toThrow("不属于当前持久节点");
	});

	it("deep-merges an exact nested repair while preserving sibling contract fields", () => {
		const next = applyBeatSheetDraftNodePatch({
			current: {
				clipIndex: 1,
				continuityLedger: {
					inheritsPreviousExit: true,
					entry: {
						stateScope: "old-entry",
						facts: [{ key: "pose", value: "standing" }],
					},
					exit: {
						stateScope: "exit",
						facts: [{ key: "pose", value: "seated" }],
					},
				},
			},
			patch: {
				continuityLedger: {
					entry: { stateScope: "previous-exit" },
				},
			},
			immutableKeys: ["clipIndex"],
			deepMergeRecordKeys: ["continuityLedger"],
		});

		expect(next.continuityLedger).toEqual({
			inheritsPreviousExit: true,
			entry: {
				stateScope: "previous-exit",
				facts: [{ key: "pose", value: "standing" }],
			},
			exit: {
				stateScope: "exit",
				facts: [{ key: "pose", value: "seated" }],
			},
		});
	});

	it("projects an explicitly inherited entry from the exact previous exit", () => {
		const previousExit = {
			stateScope: "previous-exit",
			facts: [{ key: "pose", value: "standing" }],
		};
		const next = projectInheritedContinuityEntry({
			previous: {
				clipIndex: 0,
				continuityLedger: {
					inheritsPreviousExit: false,
					entry: { stateScope: "opening", facts: [] },
					exit: previousExit,
				},
			},
			current: {
				clipIndex: 1,
				continuityLedger: {
					inheritsPreviousExit: true,
					entry: { stateScope: "wrong", facts: [] },
					exit: { stateScope: "current-exit", facts: [] },
				},
			},
		});

		expect((next.continuityLedger as Record<string, unknown>).entry).toEqual(previousExit);
		expect((next.continuityLedger as Record<string, unknown>).entry).not.toBe(previousExit);
		expect((next.continuityLedger as Record<string, unknown>).exit).toEqual({
			stateScope: "current-exit",
			facts: [],
		});
	});

	it("refuses deterministic inheritance when the agent did not select it", () => {
		expect(() => projectInheritedContinuityEntry({
			previous: {
				continuityLedger: {
					inheritsPreviousExit: false,
					entry: { stateScope: "opening", facts: [] },
					exit: { stateScope: "previous-exit", facts: [] },
				},
			},
			current: {
				continuityLedger: {
					inheritsPreviousExit: false,
					entry: { stateScope: "new-time", facts: [] },
					exit: { stateScope: "current-exit", facts: [] },
				},
			},
		})).toThrow("inheritsPreviousExit=true");
	});

	it("finds every agent-declared inherited boundary mismatch without interpreting prose", () => {
		const boundary = (stateScope: string, pose: string) => ({
			stateScope,
			facts: [{ key: "pose", value: pose }],
		});
		expect(findInheritedContinuityRepairClipIndexes([
			{
				clipIndex: 0,
				continuityLedger: {
					inheritsPreviousExit: false,
					entry: boundary("opening", "lying"),
					exit: boundary("present", "standing"),
				},
			},
			{
				clipIndex: 1,
				continuityLedger: {
					inheritsPreviousExit: true,
					entry: boundary("wrong", "standing"),
					exit: boundary("present", "seated"),
				},
			},
			{
				clipIndex: 2,
				continuityLedger: {
					inheritsPreviousExit: true,
					entry: boundary("present", "seated"),
					exit: boundary("present", "walking"),
				},
			},
			{
				clipIndex: 3,
				continuityLedger: {
					inheritsPreviousExit: false,
					entry: boundary("flashback", "standing"),
					exit: boundary("flashback", "standing"),
				},
			},
		])).toEqual([1]);
	});
});
