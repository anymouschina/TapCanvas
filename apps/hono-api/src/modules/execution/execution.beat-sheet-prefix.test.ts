import { describe, expect, it } from "vitest";
import { validateAcceptedLaunchBeatPrefix } from "./execution.beat-sheet-prefix";

describe("accepted launch Beat prefix", () => {
	it("accepts a complete chapter that preserves the submitted first Beat exactly", () => {
		const firstBeat = { clipId: "clip-0", clipIndex: 0, durationSeconds: 10, exitState: "门被推开" };
		expect(validateAcceptedLaunchBeatPrefix({
			launchBeat: { text: JSON.stringify({ beats: [firstBeat] }) },
			fullBeatSheetText: JSON.stringify({
				beats: [firstBeat, { clipId: "clip-1", clipIndex: 1, durationSeconds: 15 }],
			}),
		})).toBeNull();
	});

	it("rejects a chapter planner that rewrites an already submitted first Beat", () => {
		expect(validateAcceptedLaunchBeatPrefix({
			launchBeat: { text: JSON.stringify({ beats: [{ clipId: "clip-0", clipIndex: 0, exitState: "门被推开" }] }) },
			fullBeatSheetText: JSON.stringify({
				beats: [{ clipId: "clip-0", clipIndex: 0, exitState: "门仍关闭" }],
			}),
		})).toContain("must exactly preserve");
	});

	it("never rewrites a mismatched full plan to preserve the accepted launch Beat", () => {
		const accepted = { clipId: "clip-0", clipIndex: 0, exitState: "门被推开" };
		const submittedFullPlan = JSON.stringify({
			protocolVersion: "tapcanvas.beat-sheet/v2",
			beats: [
				{ clipId: "clip-0", clipIndex: 0, exitState: "模型改写了已受理首段" },
				{ clipId: "clip-1", clipIndex: 1, exitState: "抵达秦家" },
			],
		});
		expect(validateAcceptedLaunchBeatPrefix({
			launchBeat: { text: JSON.stringify({ beats: [accepted] }) },
			fullBeatSheetText: submittedFullPlan,
		})).toContain("must exactly preserve");
		expect(JSON.parse(submittedFullPlan).beats[0].exitState).toBe("模型改写了已受理首段");
	});
});
