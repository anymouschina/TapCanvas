import { describe, expect, it } from "vitest";
import {
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
	it("extracts canonical quoted spans without classifying speech or deriving a duration budget", () => {
		const profile = deriveBeatSheetSourceProfile(deliveryContract());
		expect(profile).not.toBeNull();
		expect(profile?.sourceQuotedUnits.map((unit) => unit.verbatim)).toEqual(FULL_SPEECH);
		const speechChars = FULL_SPEECH.join("").length;
		expect(profile?.sourceQuotedChars).toBe(speechChars);
		expect(profile?.protocolVersion).toBe("tapcanvas.beat-sheet-source-profile/v2");
		expect(profile).not.toHaveProperty("sourceSpeechUnits");
		expect(profile).not.toHaveProperty("minimumPlannedSeconds");
		expect(profile).not.toHaveProperty("minimumClipCount");
	});

	it("preserves exact UTF-16 spans and original source indexes after filtering unusable sources", () => {
		const content = "标题\n“🌟同一句。”\n“🌟同一句。”";
		const profile = deriveBeatSheetSourceProfile({
			canvasFacts: {
				authoritativeSources: [
					null,
					{ sourceId: "empty-source", content: " \n " },
					{ sourceId: "chapter-source", content },
				],
			},
		});

		const firstOpen = content.indexOf("“");
		const firstStart = firstOpen + 1;
		const firstEnd = content.indexOf("”", firstStart);
		const secondOpen = content.indexOf("“", firstEnd + 1);
		const secondStart = secondOpen + 1;
		const secondEnd = content.indexOf("”", secondStart);
		const units = profile?.sourceQuotedUnits ?? [];

		expect(units).toHaveLength(2);
		expect(units.map(({ sourceIndex }) => sourceIndex)).toEqual([2, 2]);
		expect(units.map(({ sourceId }) => sourceId)).toEqual(["chapter-source", "chapter-source"]);
		expect(units.map(({ startOffset, endOffset }) => [startOffset, endOffset])).toEqual([
			[firstStart, firstEnd],
			[secondStart, secondEnd],
		]);
		expect(units[0]?.startOffset).not.toBe(units[1]?.startOffset);
		expect(units.map(({ verbatim }) => verbatim)).toEqual(["🌟同一句。", "🌟同一句。"]);
		for (const unit of units) {
			expect(content.slice(unit.startOffset, unit.endOffset)).toBe(unit.verbatim);
		}
		// The emoji occupies two UTF-16 code units, so its inclusion is observable in the exact end offset.
		expect(firstEnd - firstStart).toBe("🌟同一句。".length);
	});

	it("returns null when the delivery contract carries no authoritative source", () => {
		expect(deriveBeatSheetSourceProfile({ canvasFacts: { authoritativeSources: [] } })).toBeNull();
	});

	it("preserves sound, written text and dialogue alike as unclassified quote addresses", () => {
		const content = '她说“你好。”，纸上写着「安静」，屋外传来“沙沙~”的摩擦声。';
		const profile = deriveBeatSheetSourceProfile(deliveryContract({ content }));
		expect(profile?.sourceQuotedUnits.map(({ verbatim }) => verbatim)).toEqual(["你好。", "安静", "沙沙~"]);
		for (const unit of profile?.sourceQuotedUnits ?? []) {
			expect(content.slice(unit.startOffset, unit.endOffset)).toBe(unit.verbatim);
			expect(unit).not.toHaveProperty("speaker");
			expect(unit).not.toHaveProperty("delivery");
		}
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

	it("accepts author-selected speech without requiring every quoted source span to be spoken", () => {
		const content = '她说“你好。”，纸上写着「安静」，屋外传来“沙沙~”的摩擦声。';
		expect(validateBeatSheetSourceCoverage({
			beatSheetText: beatSheet({ speech: ["你好。"], beatSeconds: [15] }),
			deliveryContract: deliveryContract({ content }),
		})).toBeNull();
	});

	it("does not turn unspoken quoted prose into speech capacity pressure", () => {
		const input = {
			beatSheetText: beatSheet({ speech: ["你好。"], beatSeconds: [15] }),
			deliveryContract: deliveryContract({ content: `她说“你好。”，纸上写着“${"刻纹".repeat(200)}”。` }),
		};
		expect(diagnoseBeatSheetSpeechCapacity(input)).toBeNull();
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
