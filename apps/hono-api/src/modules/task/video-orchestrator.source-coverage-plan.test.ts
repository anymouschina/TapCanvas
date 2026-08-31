import { describe, expect, it } from "vitest";

import {
	compileBeatCoverageSpan,
	validateSourceCoveragePlan,
	validateSpeechLedgerAgainstBeats,
} from "./video-orchestrator.source-coverage-plan";
import {
	beatSheetDraftBeatSchema,
	sourceCoveragePlanSchema,
} from "./video-orchestrator.tool-schema";
import { buildSourceUnits, compileSourceCoverageSelection } from "./video-orchestrator.source-units";

const source = "第一段任意内容甲乙丙丁。第二段任意内容戊己庚辛。第三段任意内容壬癸子丑。";

function compilePlan(chapterText: string, expectedBeatCount: number, speechLedger: unknown[] = []) {
	const units = buildSourceUnits({ chapterText, expectedBeatCount });
	const selected = Array.from({ length: expectedBeatCount }, (_, index) => {
		const minimumIndex = index;
		const proportionalIndex = Math.floor(((index + 1) * units.length) / expectedBeatCount) - 1;
		return units[Math.max(minimumIndex, proportionalIndex)]!.unitId;
	});
	selected[selected.length - 1] = units.at(-1)!.unitId;
	return compileSourceCoverageSelection({
		chapterText,
		expectedBeatCount,
		deliveryScope: "full_chapter",
		selection: { endUnitIds: selected, speechLedger },
	}).plan;
}

describe("source coverage plan", () => {
	it("publishes runtime offsets and the durable speech ledger as one strict canonical contract", () => {
		expect(sourceCoveragePlanSchema.required).toEqual(["spans", "speechLedger"]);
		expect(sourceCoveragePlanSchema.properties).toHaveProperty("spans");
		expect(sourceCoveragePlanSchema.properties).toHaveProperty("speechLedger");
		expect(sourceCoveragePlanSchema.properties?.spans?.items?.required).toEqual([
			"clipIndex",
			"sourceStartMarker",
			"sourceEndMarker",
			"sourceStartOffset",
			"sourceEndOffset",
		]);
		expect(sourceCoveragePlanSchema.properties?.speechLedger?.items?.required).toEqual([
			"lineId",
			"speakerName",
			"text",
			"sourceMarker",
		]);
	});

	it("accepts arbitrary text when ordered spans cover the entire source", () => {
		const result = validateSourceCoveragePlan({
			plan: compilePlan(source, 2),
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			chapterText: source,
		});

		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it("rejects a runtime offset gap before any expensive beat authoring begins", () => {
		const plan = compilePlan(source, 2);
		plan.spans[1]!.sourceStartOffset += 1;
		const result = validateSourceCoveragePlan({
			plan,
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			chapterText: source,
		});

		expect(result.ok).toBe(false);
		expect(result.errors.join("|")).toContain("runtime offset 不连续");
	});

	it("rejects a clip boundary that cuts through a frozen verbatim speech line", () => {
		const prefix = "甲".repeat(40);
		const speech = "乙".repeat(80);
		const suffix = "丙".repeat(40);
		const chapterText = `${prefix}${speech}${suffix}`;
		const units = buildSourceUnits({ chapterText, expectedBeatCount: 2 });
		const splitUnit = units.find((unit) => unit.endOffset > 40 && unit.endOffset < 120);
		expect(splitUnit).toBeDefined();
		const plan = compileSourceCoverageSelection({
			chapterText,
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: [splitUnit!.unitId, units.at(-1)!.unitId],
				speechLedger: [{ lineId: "speech-long", speakerName: "角色", text: speech }],
			},
		}).plan;
		const result = validateSourceCoveragePlan({
			plan,
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			chapterText,
		});

		expect(result.ok).toBe(false);
		expect(result.errors.join("|")).toContain("切断 speechLedger lineId=speech-long");
	});

	it("reports exact required and received structural fields for an invalid span", () => {
		const result = validateSourceCoveragePlan({
			plan: {
				speechLedger: [],
				spans: [{ clipIndex: 0, arbitraryStart: "第一段", arbitraryEnd: "第三段" }],
			},
			expectedBeatCount: 1,
			deliveryScope: "full_chapter",
			chapterText: source,
		});

		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain("sourceStartOffset");
		expect(result.errors[0]).toContain("spans[0] received fields=arbitraryEnd,arbitraryStart,clipIndex");
	});

	it("projects the frozen verbatim span onto arbitrary agent-authored beat content", () => {
		const canonical = compilePlan(source, 1).spans[0]!;
		const compiled = compileBeatCoverageSpan({
			beat: {
				clipIndex: 0,
				sourceStartMarker: "另一段文本",
				sourceEndMarker: "第二段任意内容戊己庚辛",
				logline: "模型负责的任意语义内容",
			},
			spans: [canonical],
		});

		expect(compiled).toEqual({
			ok: true,
			beat: {
				clipIndex: 0,
				logline: "模型负责的任意语义内容",
				sourceStartMarker: canonical.sourceStartMarker,
				sourceEndMarker: canonical.sourceEndMarker,
			},
		});
		expect(beatSheetDraftBeatSchema.required).not.toContain("sourceStartMarker");
		expect(beatSheetDraftBeatSchema.required).not.toContain("sourceEndMarker");
		expect(beatSheetDraftBeatSchema.properties).not.toHaveProperty("sourceStartMarker");
		expect(beatSheetDraftBeatSchema.properties).not.toHaveProperty("sourceEndMarker");
		expect(beatSheetDraftBeatSchema.properties).not.toHaveProperty("propNames");
		expect(beatSheetDraftBeatSchema.required).toEqual([
			"clipIndex",
			"logline",
			"sceneName",
			"durationBudget",
			"dialogueScript",
			"videoReferenceNodeIds",
			"continuityMode",
			"continuityLedger",
			"assetObjectContracts",
		]);
		expect(beatSheetDraftBeatSchema.properties.videoReferenceNodeIds).not.toHaveProperty("maxItems");
		expect(beatSheetDraftBeatSchema.properties.videoReferenceNodeIds?.description).toContain(
			"generationContract.referenceImagePolicy.maximumBusinessImages",
		);
	});

	it("persists an ordered source-verbatim speech ledger without interpreting prose semantics", () => {
		const chapterText = "雨打窗。顾遥说：你迟到了。陈渡抬头。顾遥又说：先别开袋子。";
		const speechLedger = [
					{
						lineId: "speech-1",
						speakerName: "顾遥",
						text: "你迟到了。",
					},
					{
						lineId: "speech-2",
						speakerName: "顾遥",
						text: "先别开袋子。",
					},
				];
		const result = validateSourceCoveragePlan({
			plan: compilePlan(chapterText, 1, speechLedger),
			expectedBeatCount: 1,
			deliveryScope: "full_chapter",
			chapterText,
		});

		expect(result.ok).toBe(true);
		expect(result.speechLedger.map((line) => line.lineId)).toEqual(["speech-1", "speech-2"]);
	});

	it("rejects missing, invented, out-of-order, or duplicated speech ledger evidence", () => {
		const missingPlan = compilePlan(source, 1);
		delete (missingPlan as { speechLedger?: unknown }).speechLedger;
		const missing = validateSourceCoveragePlan({
			plan: missingPlan,
			expectedBeatCount: 1,
			deliveryScope: "full_chapter",
			chapterText: source,
		});
		expect(missing.errors.join("|")).toContain("speechLedger 必填");

		const invalidPlan = compilePlan(source, 1);
		invalidPlan.speechLedger = [
			{ lineId: "same", speakerName: "甲", text: "不存在的台词", sourceMarker: "第三段任意内容壬癸子丑" },
			{ lineId: "same", speakerName: "乙", text: "第二段任意内容", sourceMarker: "第二段任意内容戊己庚辛" },
		];
		const invalid = validateSourceCoveragePlan({
			plan: invalidPlan,
			expectedBeatCount: 1,
			deliveryScope: "full_chapter",
			chapterText: source,
		});
		expect(invalid.ok).toBe(false);
		expect(invalid.errors.join("|")).toMatch(/重复|按顺序|必须逐字包含/);
	});

	it("requires full-chapter beat dialogue to reconstruct the durable ledger exactly", () => {
		const speechLedger = [
			{ lineId: "speech-1", speakerName: "顾遥", text: "你迟到了。", sourceMarker: "顾遥说：你迟到了。" },
			{ lineId: "speech-2", speakerName: "陈渡", text: "先别开袋子。", sourceMarker: "陈渡说：先别开袋子。" },
		];
		const exact = validateSpeechLedgerAgainstBeats({
			speechLedger,
			beats: [
				{ dialogueScript: [{ lineId: "speech-1", speakerName: "顾遥", text: "你迟到了。", delivery: "on_screen" }] },
				{ dialogueScript: [{ lineId: "speech-2", speakerName: "陈渡", text: "先别开袋子。", delivery: "off_screen" }] },
			],
			deliveryScope: "full_chapter",
		});
		expect(exact).toEqual([]);

		const missingAndMutated = validateSpeechLedgerAgainstBeats({
			speechLedger,
			beats: [{ dialogueScript: [{ lineId: "speech-1", speakerName: "顾遥", text: "你来晚了。", delivery: "voice_over" }] }],
			deliveryScope: "full_chapter",
		});
		expect(missingAndMutated.join("|")).toContain("数量不一致");
		expect(missingAndMutated.join("|")).toContain("text 不一致");
	});

	it("also conserves the authorized speech ledger for bounded-duration delivery", () => {
		const errors = validateSpeechLedgerAgainstBeats({
			speechLedger: [{
				lineId: "speech-1",
				speakerName: "顾遥",
				text: "你迟到了。",
				sourceMarker: "顾遥说：你迟到了。",
			}],
			beats: [{ dialogueScript: [] }],
			deliveryScope: "bounded_duration",
		});
		expect(errors.join("|")).toContain("bounded_duration 发声台账回拼数量不一致");
	});
});
