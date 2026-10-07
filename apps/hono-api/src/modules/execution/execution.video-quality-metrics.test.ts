import { describe, expect, it } from "vitest";

import { measureVideoQuality } from "./execution.video-quality-metrics";

describe("measureVideoQuality", () => {
	it("counts prompt length, copied host wording, quote ratio and speech pace", () => {
		const report = measureVideoQuality({
			clips: [
				{ clipIndex: 1, videoPrompt: "收束画面必须等于冻结结束画面：甲。" },
				{ clipIndex: 0, videoPrompt: "0～5 s：张羽进门" },
			],
			speechEvents: [
				{ textOrigin: "source_quote", text: "到了吗？", startSeconds: 0, endSeconds: 2 },
				{ textOrigin: "authored", text: "一二三四五六七八九十", startSeconds: 2, endSeconds: 3 },
			],
		});
		expect(report.clipCount).toBe(2);
		expect(report.prompt.minChars).toBe(10);
		expect(report.leakedInstructionClips).toEqual([1]);
		expect(report.speech).toEqual({ eventCount: 2, sourceQuoteRatio: 0.5, fasterThanComfortable: 1, maxCharsPerSecond: 10 });
	});

	it("reports an empty run without dividing by zero", () => {
		expect(measureVideoQuality({ clips: [], speechEvents: [] })).toMatchObject({ clipCount: 0, speech: { sourceQuoteRatio: 0 } });
	});
});
