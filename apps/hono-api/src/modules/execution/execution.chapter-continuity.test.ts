import { describe, expect, it } from "vitest";
import { extractLastChapterSequenceExit } from "./execution.chapter-continuity";

describe("previous chapter exit evidence", () => {
	it("extracts only the final authored Clip state from a successful sequence artifact", () => {
		const output = { artifacts: [
			{ type: "unrelated", value: { clips: [{ clipId: "wrong" }] } },
			{ type: "tapcanvas.chapter-sequence-bound/v2", value: { clips: [
				{ clipId: "clip-0", endKeyframe: { state: "初始", visual: "前景" } },
				{ clipId: "clip-1", endKeyframe: { state: "坐在教室，等级 37", visual: "仍握控制器" } },
			] } },
		] };
		expect(extractLastChapterSequenceExit(output)).toEqual({
			clipId: "clip-1", state: "坐在教室，等级 37", visual: "仍握控制器",
		});
	});

	it("does not project an incomplete or unrelated output as continuity evidence", () => {
		expect(extractLastChapterSequenceExit({ artifacts: [{ type: "tapcanvas.chapter-sequence-bound/v2",
			value: { clips: [{ clipId: "clip-0", endKeyframe: { state: "状态" } }] } }] })).toBeNull();
		expect(extractLastChapterSequenceExit({ artifacts: [{ type: "unrelated", value: { clips: [] } }] })).toBeNull();
	});
});
