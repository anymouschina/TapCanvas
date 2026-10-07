import { describe, expect, it, vi } from "vitest";
import { projectChapterSequence } from "./execution.chapter-sequence";
import { compileChapterScript } from "./execution.chapter-script";
import { globalSequenceFixture } from "./execution.chapter-sequence.fixture";
import { clipSegmentStaging, clipStagingPlan, stagingCharacterDiagramFacts } from "./execution.chapter-staging";

function clips() {
	const { deliveryContract } = globalSequenceFixture();
	const sequence = compileChapterScript({ wholeFilmIntent: "两段连续事件", sourceKind: "brief", characters: ["主角", "对手"],
		adaptation: [{ spanId: "A", until: "有具形招式", decision: "dramatize", note: "整场" }],
		clips: [{ clipId: "first", durationSeconds: 30 }, { clipId: "second", durationSeconds: 30 }],
		scenes: [{ sceneId: "hall", setting: "厅内", place: "厅内", adapts: ["A"], cast: ["主角", "对手"], entryState: "两人分立", exitState: "站定",
			layout: { landmarks: [{ kind: "area", label: "厅内", at: [0.5, 0.5] }], marks: [{ mark: "left", where: "厅内左侧", at: [0.2, 0.5] }, { mark: "right", where: "厅内右侧", at: [0.8, 0.5] }] },
			positions: [{ who: "主角", mark: "left", posture: "stand" }, { who: "对手", mark: "right", posture: "stand" }],
			beats: [{ clipId: "first", performance: "action", picture: "双方对峙", visible: ["主角", "对手"] },
				{ clipId: "first", performance: "action", picture: "主角推进到右侧站定", visible: ["主角", "对手"], moves: [{ who: "主角", mark: "right", posture: "stand" }] },
				{ clipId: "second", performance: "action", picture: "主角与对手交手", visible: ["主角", "对手"] }] }],
	}, deliveryContract);
	return projectChapterSequence({ executionId: "staging", nodeId: "sequence", sequence, deliveryContract }).clipCollection.items.map((item) => item.value);
}

describe("ordered staging facts", () => {
	it("carries declared event results to the next clip without movement clocks", () => {
		const [first, second] = clips();
		expect(first!.staging!.opening).toContainEqual({ who: "主角", mark: "left", posture: "stand" });
		expect(second!.staging!.opening).toContainEqual({ who: "主角", mark: "right", posture: "stand" });
		expect(second!.staging).not.toHaveProperty("openingTransitions");
		const stage = clipStagingPlan(first)!.stages[0]!;
		expect(stage.transitions![0]).toMatchObject({ eventId: "hall-b2", eventIndex: 1, name: "主角", from: { mark: "left" }, to: { mark: "right" } });
		expect(stage.transitions![0]).not.toHaveProperty("startSeconds");
		expect(stagingCharacterDiagramFacts(stage.characters[0]!, stage.transitions).name).not.toContain("走位未完成");
	});
	it("projects positions and moves through explicit shot event references", () => {
		const [first] = clips();
		const rows = clipSegmentStaging(first, [{ storyEventIds: ["hall-b1"] }, { storyEventIds: ["hall-b2"] }])!;
		expect(rows[0]!.positions).toContain("主角站在厅内左侧");
		expect(rows[0]!.moves).toEqual([]);
		expect(rows[1]!.moves).toEqual(["主角走到厅内右侧"]);
	});
	it("reports unknown optional spatial facts without blocking content delivery", () => {
		const [first] = clips();
		const unknown = { ...first, storyEvents: first!.storyEvents.map((event) => event.moves?.length ? { ...event, moves: [{ who: "主角", mark: "unknown", posture: "stand" }], staging: [{ who: "主角", mark: "unknown", posture: "stand" }] } : event) };
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try { expect(clipStagingPlan(unknown)!.stages[0]!.transitions).toBeUndefined(); expect(warn).toHaveBeenCalledWith(expect.stringContaining('"reason":"unknown_mark"')); }
		finally { warn.mockRestore(); }
	});
	it("does not invent repeated moves or require a floor plan", () => {
		const [first] = clips();
		const same = { ...first, storyEvents: first!.storyEvents.map((event) => event.moves?.length ? { ...event, moves: [{ who: "主角", mark: "left", posture: "stand" }] } : event) };
		expect(clipStagingPlan(same)!.stages[0]!.transitions).toBeUndefined();
		expect(clipStagingPlan({ ...first, staging: undefined })).toBeNull();
	});
});
