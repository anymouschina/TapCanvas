import { describe, expect, it } from "vitest";
import {
	BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND,
	deriveBeatSheetSourceProfile,
	validateBeatSheetSourceCoverage,
	diagnoseBeatSheetSpeechCapacity,
} from "./execution.beat-sheet-source-coverage";

const CHAPTER = [
	"第1章面试",
	"“到了吗？”",
	"“不要紧张，你成绩这么好，一定能过的。”",
	"看着屏幕上母亲发来的消息，张羽默默收起手机。",
	"“989号考生，张羽。”",
	"“三位好，我是东阳初级中学的张羽。”",
].join("\n");

function deliveryContract(input?: Readonly<{ targetDurationSeconds?: number; content?: string }>): unknown {
	return {
		protocolVersion: "2",
		executionScope: "media_delivery",
		...(input?.targetDurationSeconds === undefined ? {} : { targetDurationSeconds: input.targetDurationSeconds }),
		canvasFacts: {
			authoritativeSources: [{
				nodeId: "chapter-seed-1",
				sourceId: "chapter-seed-1",
				content: input?.content ?? CHAPTER,
			}],
		},
		generationContract: { videoModel: "seedance20", durationOptions: [5, 10, 15], maxDurationSeconds: 15 },
	};
}

function beatSheet(input: Readonly<{ speech: readonly string[]; beatSeconds: readonly number[] }>): string {
	return JSON.stringify({
		protocolVersion: "tapcanvas.beat-sheet/v2",
		beats: input.beatSeconds.map((durationSeconds, index) => ({ clipIndex: index, durationSeconds })),
		sourceCoveragePlan: {
			speechLedger: input.speech.map((text, index) => ({
				lineId: `line-${index + 1}`,
				speakerName: "张羽",
				text,
				clipIndex: 0,
				delivery: "on_screen",
			})),
		},
		sequenceControlPlan: { totalDurationSeconds: input.beatSeconds.reduce((total, value) => total + value, 0) },
	});
}

const FULL_SPEECH = [
	"到了吗？",
	"不要紧张，你成绩这么好，一定能过的。",
	"989号考生，张羽。",
	"三位好，我是东阳初级中学的张羽。",
];

describe("deriveBeatSheetSourceProfile", () => {
	it("counts canonical source speech spans and derives a deterministic duration budget", () => {
		const profile = deriveBeatSheetSourceProfile(deliveryContract(), { maxDurationSeconds: 15 });
		expect(profile).not.toBeNull();
		expect(profile?.sourceSpeechUnits.map((unit) => unit.verbatim)).toEqual(FULL_SPEECH);
		const speechChars = FULL_SPEECH.join("").length;
		expect(profile?.sourceSpeechChars).toBe(speechChars);
		expect(profile?.minimumPlannedSeconds).toBe(Math.ceil(speechChars / BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND));
		expect(profile?.minimumClipCount).toBe(Math.ceil((profile?.minimumPlannedSeconds ?? 0) / 15));
	});

	it("returns null when the delivery contract carries no authoritative source", () => {
		expect(deriveBeatSheetSourceProfile({ canvasFacts: { authoritativeSources: [] } })).toBeNull();
	});

	it("states the natural delivery rate for window arithmetic without inflating the chapter plan", () => {
		/*
		 * 自然语速只用来把"冻结的交付时长"换算成该窗口能承载的人声字数（作者据此选择内容，
		 * 而不是把整章压进窗口）。它不得被当成整章计划时长的换算基准：那样产物会增大约 45%，
		 * 越过本次执行的生产片段预算，并让单次生成耗时越过上游渠道的请求超时。
		 */
		const profile = deriveBeatSheetSourceProfile(deliveryContract(), { maxDurationSeconds: 15 });
		expect(profile?.speechPlanningCharsPerSecond).toBeLessThan(
			profile?.speechMaxCharsPerSecond ?? Number.POSITIVE_INFINITY,
		);
		expect(profile?.minimumPlannedSeconds).toBe(
			Math.ceil((profile?.sourceSpeechChars ?? 0) / BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND),
		);
		expect(profile).not.toHaveProperty("plannedSecondsAtNaturalPace");
		expect(profile).not.toHaveProperty("plannedClipCountAtNaturalPace");
	});
});

describe("validateBeatSheetSourceCoverage", () => {
	it("rejects source dialogue that was rewritten instead of preserved verbatim", () => {
		const reason = validateBeatSheetSourceCoverage({
			beatSheetText: beatSheet({ speech: ["你为什么要报考我们学校？"], beatSeconds: [15] }),
			deliveryContract: deliveryContract(),
		});
		expect(reason).toContain("verbatim");
		expect(reason).toContain("narrativeAudioPlan");
	});

	it("records speech-capacity concerns without rejecting complete source coverage", () => {
		const longSpeech = Array.from({ length: 40 }, (_, index) => `“第${index}句台词，长度足够构成真实的人声容量压力。”`).join("\n");
		const content = `第1章\n${longSpeech}`;
		const speech = Array.from({ length: 40 }, (_, index) => `第${index}句台词，长度足够构成真实的人声容量压力。`);
		const input = {
			beatSheetText: beatSheet({ speech, beatSeconds: [15, 15, 15, 15] }),
			deliveryContract: deliveryContract({ content }),
		};
		expect(validateBeatSheetSourceCoverage(input)).toBeNull();
		const observation = diagnoseBeatSheetSpeechCapacity(input);
		expect(observation).toContain("non-blocking");
		expect(observation).toContain("not a provider limit");
	});

	it("rejects silently dropped source speech spans", () => {
		const reason = validateBeatSheetSourceCoverage({
			beatSheetText: beatSheet({ speech: FULL_SPEECH.slice(0, 2), beatSeconds: [15, 15, 15, 15, 15] }),
			deliveryContract: deliveryContract(),
		});
		expect(reason).toContain("does not cover the canonical source's speech");
		expect(reason).toContain("989号考生，张羽。");
	});

	it("accepts a beat sheet that preserves every source speech span with enough duration", () => {
		const reason = validateBeatSheetSourceCoverage({
			beatSheetText: beatSheet({ speech: FULL_SPEECH, beatSeconds: [15, 15, 15, 15, 15, 15, 15, 15] }),
			deliveryContract: deliveryContract(),
		});
		expect(reason).toBeNull();
	});

	it("allows an authorized total duration to drop coverage but still forbids invented source dialogue", () => {
		const authorized = deliveryContract({ targetDurationSeconds: 15 });
		expect(validateBeatSheetSourceCoverage({
			beatSheetText: beatSheet({ speech: FULL_SPEECH.slice(0, 1), beatSeconds: [15] }),
			deliveryContract: authorized,
		})).toBeNull();
		expect(validateBeatSheetSourceCoverage({
			beatSheetText: beatSheet({ speech: ["这是一句原文里根本没有的对白。"], beatSeconds: [15] }),
			deliveryContract: authorized,
		})).toContain("verbatim");
	});

	it("tolerates source line breaks inside one quoted speech span", () => {
		const content = "第1章\n“同学，你算是来对地方了，\n我们这就是最适合你的高中。”\n";
		const reason = validateBeatSheetSourceCoverage({
			beatSheetText: beatSheet({ speech: ["同学，你算是来对地方了，我们这就是最适合你的高中。"], beatSeconds: [15, 15] }),
			deliveryContract: deliveryContract({ content }),
		});
		expect(reason).toBeNull();
	});
});
