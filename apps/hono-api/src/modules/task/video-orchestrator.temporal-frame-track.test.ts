import { describe, expect, it } from "vitest";
import {
	compileTemporalFrameContract,
	parseTemporalFrameTrack,
	validateTemporalFrameCoverage,
} from "./video-orchestrator.temporal-frame-track";

const storyEvents = [
	{
		startSeconds: 0,
		endSeconds: 1,
		entryState: "人物持枪站在门外",
		exitState: "枪口越过门框",
	},
	{
		startSeconds: 1,
		endSeconds: 2,
		entryState: "枪口越过门框",
		exitState: "人物贴墙完成制动",
	},
];

const window = (input: Readonly<{
	windowIndex: number;
	startSeconds: number;
	endSeconds: number;
	startState: string;
	carryState: string;
	storyEventIndices: readonly number[];
}>) => ({
	...input,
	startFrame: `${input.startSeconds}s 起帧：${input.startState}`,
	transition: `${input.startSeconds}-${input.endSeconds}s 主体沿可见路径完成动作并产生反作用`,
	carryFrame: `${input.endSeconds}s 承帧：${input.carryState}`,
});

describe("temporal frame track", () => {
	it("compiles event and temporal coverage from frozen events plus authored shots", () => {
		const compiled = compileTemporalFrameContract({
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			shots: [
				{ shotNo: 1, durationSeconds: 0.5, visualTask: "门外全身与枪口关系", action: "人物跨步让枪口越过门框", depictedStoryEventIndices: [0] },
				{ shotNo: 2, durationSeconds: 1.5, visualTask: "贴墙制动的中近景", action: "人物转肩贴墙并完成制动", depictedStoryEventIndices: [1] },
			],
			field: "clip",
		});

		expect(compiled.sourceEventCoverage).toEqual([
			{ storyEventIndex: 0, shotNos: [1] },
			{ storyEventIndex: 1, shotNos: [2] },
		]);
		expect(compiled.temporalFrameTrack.map((item) => [item.startSeconds, item.endSeconds])).toEqual([
			[0, 0.5],
			[0.5, 1],
			[1, 2],
		]);
		expect(compiled.temporalFrameTrack[0]?.startFrame).toBe("门外全身与枪口关系");
		expect(compiled.temporalFrameTrack[1]?.transition).toBe("人物转肩贴墙并完成制动");
		expect(compiled.temporalFrameTrack.at(-1)?.carryState).toBe("人物贴墙完成制动");
		expect(compiled.temporalFrameCoverage).toEqual([
			{ windowIndex: 0, shotNos: [1] },
			{ windowIndex: 1, shotNos: [2] },
			{ windowIndex: 2, shotNos: [2] },
		]);
	});

	it("reuses visualTask verbatim as the transition for a static shot without action", () => {
		const compiled = compileTemporalFrameContract({
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			shots: [
				{ shotNo: 1, durationSeconds: 1, visualTask: "门外空间关系保持稳定", action: "", depictedStoryEventIndices: [0] },
				{ shotNo: 2, durationSeconds: 1, visualTask: "人物贴墙后的稳定构图", depictedStoryEventIndices: [1] },
			],
			field: "clip",
		});
		expect(compiled.temporalFrameTrack.map((item) => item.transition)).toEqual([
			"门外空间关系保持稳定",
			"人物贴墙后的稳定构图",
		]);
	});

	it("rejects missing, out-of-clock and out-of-order writer event evidence", () => {
		const base = {
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			field: "clip",
		};
		expect(() => compileTemporalFrameContract({
			...base,
			shots: [
				{ shotNo: 1, durationSeconds: 1, visualTask: "第一事件", depictedStoryEventIndices: [0] },
				{ shotNo: 2, durationSeconds: 1, visualTask: "第二事件", depictedStoryEventIndices: [0] },
			],
		})).toThrow("outside the shot clock interval");
		expect(() => compileTemporalFrameContract({
			...base,
			shots: [
				{ shotNo: 1, durationSeconds: 1, visualTask: "第一事件", depictedStoryEventIndices: [0] },
				{ shotNo: 2, durationSeconds: 1, visualTask: "第二事件", depictedStoryEventIndices: [] },
			],
		})).toThrow("must be a non-empty array");
		expect(() => compileTemporalFrameContract({
			...base,
			storyEvents: [
				{ startSeconds: 0, endSeconds: 2, entryState: "同一时段的第一事件入口", exitState: "同一时段的第一事件出口" },
				{ startSeconds: 0, endSeconds: 2, entryState: "同一时段的第二事件入口", exitState: "同一时段的第二事件出口" },
			],
			shots: [
				{ shotNo: 1, durationSeconds: 1, visualTask: "先声明第二事件", depictedStoryEventIndices: [1] },
				{ shotNo: 2, durationSeconds: 1, visualTask: "再回写第一事件", depictedStoryEventIndices: [0] },
			],
		})).toThrow("must preserve frozen storyEvent order");
	});

	it("accepts the two-state-per-second baseline", () => {
		const track = [
			window({
				windowIndex: 0,
				startSeconds: 0,
				endSeconds: 1,
				startState: "人物持枪站在门外",
				carryState: "枪口越过门框",
				storyEventIndices: [0],
			}),
			window({
				windowIndex: 1,
				startSeconds: 1,
				endSeconds: 2,
				startState: "枪口越过门框",
				carryState: "人物贴墙完成制动",
				storyEventIndices: [1],
			}),
		];

		expect(parseTemporalFrameTrack({
			value: track,
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			field: "beat.temporalFrameTrack",
		})).toEqual(track);
	});

	it("allows high-intensity action to add contiguous sub-second state pairs", () => {
		const track = [
			window({
				windowIndex: 0,
				startSeconds: 0,
				endSeconds: 0.5,
				startState: "人物持枪站在门外",
				carryState: "前脚跨入门内",
				storyEventIndices: [0],
			}),
			window({
				windowIndex: 1,
				startSeconds: 0.5,
				endSeconds: 1,
				startState: "前脚跨入门内",
				carryState: "枪口越过门框",
				storyEventIndices: [0],
			}),
			window({
				windowIndex: 2,
				startSeconds: 1,
				endSeconds: 1.5,
				startState: "枪口越过门框",
				carryState: "肩部接触墙面",
				storyEventIndices: [1],
			}),
			window({
				windowIndex: 3,
				startSeconds: 1.5,
				endSeconds: 2,
				startState: "肩部接触墙面",
				carryState: "人物贴墙完成制动",
				storyEventIndices: [1],
			}),
		];

		expect(parseTemporalFrameTrack({
			value: track,
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			field: "beat.temporalFrameTrack",
		})).toHaveLength(4);
	});

	it("rejects a sparse window, a broken state relay and a skipped story-event boundary", () => {
		const sparseTrack = [window({
			windowIndex: 0,
			startSeconds: 0,
			endSeconds: 2,
			startState: "人物持枪站在门外",
			carryState: "人物贴墙完成制动",
			storyEventIndices: [0, 1],
		})];
		expect(() => parseTemporalFrameTrack({
			value: sparseTrack,
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			field: "beat.temporalFrameTrack",
		})).toThrow("at least 2");

		const brokenRelay = [
			window({ windowIndex: 0, startSeconds: 0, endSeconds: 1, startState: "人物持枪站在门外", carryState: "枪口越过门框", storyEventIndices: [0] }),
			window({ windowIndex: 1, startSeconds: 1, endSeconds: 2, startState: "人物突然重置在走廊", carryState: "人物贴墙完成制动", storyEventIndices: [1] }),
		];
		expect(() => parseTemporalFrameTrack({
			value: brokenRelay,
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			field: "beat.temporalFrameTrack",
		})).toThrow("previous carryState");

		const fractionalEvents = [
			{ startSeconds: 0, endSeconds: 0.5, entryState: "人物持枪站在门外", exitState: "前脚跨入门内" },
			{ startSeconds: 0.5, endSeconds: 2, entryState: "前脚跨入门内", exitState: "人物贴墙完成制动" },
		];
		const missingBoundary = [
			window({ windowIndex: 0, startSeconds: 0, endSeconds: 1, startState: "人物持枪站在门外", carryState: "中间状态", storyEventIndices: [0, 1] }),
			window({ windowIndex: 1, startSeconds: 1, endSeconds: 2, startState: "中间状态", carryState: "人物贴墙完成制动", storyEventIndices: [1] }),
		];
		expect(() => parseTemporalFrameTrack({
			value: missingBoundary,
			durationSeconds: 2,
			storyEvents: fractionalEvents,
			exitState: "人物贴墙完成制动",
			field: "beat.temporalFrameTrack",
		})).toThrow("storyEvent boundary at 0.5s");
	});

	it("requires every temporal window to map to real intersecting shots", () => {
		const track = parseTemporalFrameTrack({
			value: [
				window({ windowIndex: 0, startSeconds: 0, endSeconds: 1, startState: "人物持枪站在门外", carryState: "枪口越过门框", storyEventIndices: [0] }),
				window({ windowIndex: 1, startSeconds: 1, endSeconds: 2, startState: "枪口越过门框", carryState: "人物贴墙完成制动", storyEventIndices: [1] }),
			],
			durationSeconds: 2,
			storyEvents,
			exitState: "人物贴墙完成制动",
			field: "beat.temporalFrameTrack",
		});
		const shots = [
			{ shotNo: 1, durationSeconds: 1 },
			{ shotNo: 2, durationSeconds: 1 },
		];

		expect(validateTemporalFrameCoverage({
			coverage: [{ windowIndex: 0, shotNos: [1] }, { windowIndex: 1, shotNos: [2] }],
			track,
			shots,
			field: "clip.temporalFrameCoverage",
		})).toHaveLength(2);
		expect(() => validateTemporalFrameCoverage({
			coverage: [{ windowIndex: 0, shotNos: [2] }, { windowIndex: 1, shotNos: [2] }],
			track,
			shots,
			field: "clip.temporalFrameCoverage",
		})).toThrow("intersecting this time window");
	});
});
