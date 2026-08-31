import { describe, expect, it } from "vitest";

import { validateSourceCoveragePlan } from "./video-orchestrator.source-coverage-plan";
import {
	buildSourceUnits,
	compileSourceCoverageSelection,
} from "./video-orchestrator.source-units";
import { normalizeWithMap } from "./video-orchestrator.source-coverage";

const arbitrarySource = [
	"标题：任意输入。",
	"第一段有“引号”、空 格，以及\n换行；这些结构都不应由模型手抄游标。",
	"第二段重复一句：风从门缝进来。风从门缝进来。随后人物继续行动。",
	"第三段收束全部原文，不允许留下尾部。",
].join("\n\n").repeat(8);

describe("deterministic source units", () => {
	it("builds a bounded stable address catalog over arbitrary text", () => {
		const first = buildSourceUnits({ chapterText: arbitrarySource, expectedBeatCount: 5 });
		const second = buildSourceUnits({ chapterText: arbitrarySource, expectedBeatCount: 5 });
		expect(second).toEqual(first);
		expect(first.length).toBeGreaterThanOrEqual(5);
		expect(first[0]?.unitId).toBe("source-unit-0000");
		expect(first.map((unit) => unit.text).join("")).toContain("第三段收束全部原文");
		expect(first.every((unit) => unit.endOffset > unit.startOffset)).toBe(true);
		expect(first.at(-1)?.endOffset).toBe(normalizeWithMap(arbitrarySource).norm.length);
	});

	it("lets the model choose semantic end units while the runtime derives every exact start", () => {
		const units = buildSourceUnits({ chapterText: arbitrarySource, expectedBeatCount: 4 });
		const selected = [
			units[Math.floor(units.length * 0.25)]!,
			units[Math.floor(units.length * 0.5)]!,
			units[Math.floor(units.length * 0.75)]!,
			units.at(-1)!,
		];
		const compiled = compileSourceCoverageSelection({
			chapterText: arbitrarySource,
			expectedBeatCount: 4,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: selected.map((unit) => unit.unitId),
				speechLedger: [],
			},
		});

		expect(compiled.plan.spans[0]?.sourceStartOffset).toBe(0);
		for (let index = 1; index < compiled.plan.spans.length; index += 1) {
			expect(compiled.plan.spans[index]?.sourceStartOffset).toBe(
				compiled.plan.spans[index - 1]?.sourceEndOffset,
			);
		}
		expect(compiled.plan.spans.at(-1)?.sourceEndOffset).toBe(
			units.at(-1)?.endOffset,
		);
		const validated = validateSourceCoveragePlan({
			plan: compiled.plan,
			expectedBeatCount: 4,
			deliveryScope: "full_chapter",
			chapterText: arbitrarySource,
		});
		expect(validated.errors).toEqual([]);
	});

	it("derives canonical speech markers from arbitrary punctuation instead of model-authored coordinates", () => {
		const chapterText = "甲说：“你 来了！”随后停顿。乙答：‘我来了。’";
		const units = buildSourceUnits({ chapterText, expectedBeatCount: 1 });
		const compiled = compileSourceCoverageSelection({
			chapterText,
			expectedBeatCount: 1,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: [units.at(-1)!.unitId],
				speechLedger: [
					{ lineId: "L1", speakerName: "甲", text: "你来了!" },
					{ lineId: "L2", speakerName: "乙", text: "我来了。" },
				],
			},
		});

		expect(compiled.plan.speechLedger).toEqual([
			{ lineId: "L1", speakerName: "甲", text: "你 来了", sourceMarker: "你 来了" },
			{ lineId: "L2", speakerName: "乙", text: "我来了。", sourceMarker: "我来了。" },
		]);
		expect(validateSourceCoveragePlan({
			plan: compiled.plan,
			expectedBeatCount: 1,
			deliveryScope: "full_chapter",
			chapterText,
		}).errors).toEqual([]);
	});

	it("exposes author-provided sentence boundaries so adjacent speech lines have legal clip coordinates", () => {
		const firstLine = "这是第一条足够长且必须完整保留的对白内容。";
		const secondLine = "这是第二条同样必须完整保留的对白内容。";
		const chapterText = [
			"开场先交代人物站位与当前环境状态，确保来源长度满足两个片段。",
			`甲说：“${firstLine}”`,
			"他停住动作，另一人随后作出回应。",
			`乙答：“${secondLine}”`,
			"结尾继续保留人物和道具的客观状态。",
		].join("\n\n");
		const firstLineRawEnd = chapterText.indexOf(firstLine) + firstLine.length;
		const firstLineNormalizedEnd = normalizeWithMap(
			chapterText.slice(0, firstLineRawEnd),
		).norm.length;
		const secondLineNormalizedStart = normalizeWithMap(
			chapterText.slice(0, chapterText.indexOf(secondLine)),
		).norm.length;
		const units = buildSourceUnits({ chapterText, expectedBeatCount: 2 });
		const firstLineEndUnit = units.find((unit) =>
			unit.endOffset >= firstLineNormalizedEnd &&
			unit.endOffset <= secondLineNormalizedStart
		);
		expect(
			firstLineEndUnit,
			`expectedRange=${firstLineNormalizedEnd}..${secondLineNormalizedStart} units=${units.map((unit) => unit.endOffset).join(",")}`,
		).toBeDefined();

		const compiled = compileSourceCoverageSelection({
			chapterText,
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: [firstLineEndUnit!.unitId, units.at(-1)!.unitId],
				speechLedger: [
					{ lineId: "L1", speakerName: "甲", text: firstLine },
					{ lineId: "L2", speakerName: "乙", text: secondLine },
				],
			},
		});
		expect(validateSourceCoveragePlan({
			plan: compiled.plan,
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			chapterText,
		}).errors).toEqual([]);
	});

	it("keeps a legal unit between dialogue lines when the next quote is introduced by a comma", () => {
		const firstLine = "我认真的。";
		const secondLine = "之前是我不懂事，可现在我想重新开始。";
		const chapterText = [
			"开场动作持续推进，人物仍在同一间屋内等待回应。",
			`甲说：“${firstLine}”`,
			`她迎上对方的目光，深吸一口气，“${secondLine}”`,
			"对方保持原位，桌上的纸笔也没有移动。",
		].join("\n\n");
		const firstStart = normalizeWithMap(
			chapterText.slice(0, chapterText.indexOf(firstLine)),
		).norm.length;
		const firstEnd = firstStart + normalizeWithMap(firstLine).norm.length;
		const secondStart = normalizeWithMap(
			chapterText.slice(0, chapterText.indexOf(secondLine)),
		).norm.length;
		const units = buildSourceUnits({ chapterText, expectedBeatCount: 2 });
		const legalBoundary = units.find((unit) =>
			unit.endOffset >= firstEnd && unit.endOffset <= secondStart
		);
		expect(legalBoundary).toBeDefined();
		const compiled = compileSourceCoverageSelection({
			chapterText,
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: [legalBoundary!.unitId, units.at(-1)!.unitId],
				speechLedger: [
					{ lineId: "L1", speakerName: "甲", text: firstLine },
					{ lineId: "L2", speakerName: "甲", text: secondLine },
				],
			},
		});
		expect(validateSourceCoveragePlan({
			plan: compiled.plan,
			expectedBeatCount: 2,
			deliveryScope: "full_chapter",
			chapterText,
		}).errors).toEqual([]);
	});

	it("rejects skipped graph addresses and a final span that does not consume the source", () => {
		const units = buildSourceUnits({ chapterText: arbitrarySource, expectedBeatCount: 3 });
		expect(() => compileSourceCoverageSelection({
			chapterText: arbitrarySource,
			expectedBeatCount: 3,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: [units[2]?.unitId, units[1]?.unitId, units.at(-1)?.unitId],
				speechLedger: [],
			},
		})).toThrow("must_increase");
		expect(() => compileSourceCoverageSelection({
			chapterText: arbitrarySource,
			expectedBeatCount: 3,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: [units[1]?.unitId, units[3]?.unitId, units[5]?.unitId],
				speechLedger: [],
			},
		})).toThrow("last_source_unit_required");
	});

	it("requires an explicit bounded source start and does not expand it to the whole chapter", () => {
		const units = buildSourceUnits({ chapterText: arbitrarySource, expectedBeatCount: 2 });
		const startUnit = units[Math.floor(units.length * 0.4)]!;
		const firstEnd = units[Math.floor(units.length * 0.6)]!;
		const finalEnd = units[Math.floor(units.length * 0.8)]!;
		const compiled = compileSourceCoverageSelection({
			chapterText: arbitrarySource,
			expectedBeatCount: 2,
			deliveryScope: "bounded_duration",
			selection: {
				startUnitId: startUnit.unitId,
				endUnitIds: [firstEnd.unitId, finalEnd.unitId],
				speechLedger: [],
			},
		});
		expect(compiled.plan.spans[0]?.sourceStartOffset).toBe(startUnit.startOffset);
		expect(compiled.plan.spans.at(-1)?.sourceEndOffset).toBe(finalEnd.endOffset);
		expect(compiled.plan.spans.at(-1)?.sourceEndOffset).toBeLessThan(units.at(-1)!.endOffset);
		expect(validateSourceCoveragePlan({
			plan: compiled.plan,
			expectedBeatCount: 2,
			deliveryScope: "bounded_duration",
			chapterText: arbitrarySource,
		}).errors).toEqual([]);
		expect(() => compileSourceCoverageSelection({
			chapterText: arbitrarySource,
			expectedBeatCount: 2,
			deliveryScope: "bounded_duration",
			selection: { endUnitIds: [firstEnd.unitId, finalEnd.unitId], speechLedger: [] },
		})).toThrow("bounded_duration_start_unit_required");
	});
});
