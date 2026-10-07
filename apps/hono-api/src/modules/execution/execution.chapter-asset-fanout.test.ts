import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { describe, expect, it } from "vitest";
import { bindChapterAssetPartSchema, chapterAssetOutlineSchema } from "../../../../../packages/schemas/video-authoring-stages/chapter-asset-fanout.mjs";
import {
	bindChapterAssetPartAuthoringContract,
	collectChapterAssetParts,
	projectChapterAssetSeeds,
} from "./execution.chapter-asset-fanout";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { parseWorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { parseChapterAssetPlan } from "./execution.video-authoring-stages";
import fixturePlan from "./testfixtures/chapter-asset-plan-valid.json";
import fixturePaletteEntry from "./testfixtures/chapter-asset-palette-entry.json";

type FixturePlan = typeof fixturePlan;
type FixturePart = Pick<FixturePlan, "objectRegistry" | "backgroundPlans">;
type FixtureSeed = { outlineId: string; objectId: string; kind: string; name: string; brief: string };

/** The synthetic chapter plan (a 9-object registry + 2 background plans) split into per-item parts. */
function fixtureSeedsAndParts(): Array<{ seed: FixtureSeed; part: FixturePart }> {
	const plan = fixturePlan;
	const objects = (plan.objectRegistry).map((entry) => ({
		seed: { outlineId: entry.objectId, objectId: entry.objectId, kind: entry.kind, name: entry.name, brief: "fixture" },
		part: { objectRegistry: [entry], backgroundPlans: [] },
	}));
	const backgrounds = (plan.backgroundPlans).map((entry) => ({
		seed: { outlineId: entry.objectId, objectId: entry.objectId, kind: "background", name: entry.plan.displayName, brief: "fixture" },
		part: { objectRegistry: [], backgroundPlans: [entry] },
	}));
	return [...objects, ...backgrounds];
}

function collection<T>(id: string, values: T[], itemIds: string[]) {
	return createWorkflowCollection({ collectionId: id, producerNodeId: "n", producerPortId: "p", values, itemIds });
}

describe("chapter asset fan-out against the synthetic chapter plan", () => {
	const items = fixtureSeedsAndParts();

	it("every synthetic per-item part validates against its own host-pinned schema", () => {
		expect(items.length).toBe(11);
		for (const { seed, part } of items) {
			const issues = validateWorkflowToolArguments(bindChapterAssetPartSchema(seed), part);
			expect(issues, `${seed.objectId}: ${JSON.stringify(issues).slice(0, 300)}`).toEqual([]);
		}
	});

	it("rejects a part that claims another object's identity, kind or name", () => {
		const { seed, part } = items.find((item) => item.seed.kind === "character")!;
		const schema = bindChapterAssetPartSchema(seed);
		const wrongId = structuredClone(part); wrongId.objectRegistry[0].objectId = "obj-other";
		const wrongKind = structuredClone(part); wrongKind.objectRegistry[0].kind = "prop"; wrongKind.objectRegistry[0].physicalIdentityKey = null;
		const wrongName = structuredClone(part); wrongName.objectRegistry[0].name = "someone else";
		for (const bad of [wrongId, wrongKind, wrongName]) {
			expect(validateWorkflowToolArguments(schema, bad).length).toBeGreaterThan(0);
		}
	});

	it("a background part may not smuggle registry entries and must keep its pinned identity", () => {
		const { seed, part } = items.find((item) => item.seed.kind === "background")!;
		const schema = bindChapterAssetPartSchema(seed);
		const withEntry = structuredClone(part); withEntry.objectRegistry = [(fixturePlan).objectRegistry[0]];
		const wrongAsset = structuredClone(part); wrongAsset.backgroundPlans[0].plan.assetId = "bg-other";
		expect(validateWorkflowToolArguments(schema, withEntry).length).toBeGreaterThan(0);
		expect(validateWorkflowToolArguments(schema, wrongAsset).length).toBeGreaterThan(0);
	});

	it("collect re-assembles a plan identical in content and valid under the original schema", () => {
		const seeds = collection("seeds", items.map((i) => i.seed), items.map((i) => i.seed.objectId));
		const parts = collection("parts", items.map((i) => ({ text: JSON.stringify(i.part) })), items.map((i) => i.seed.objectId));
		const collected = collectChapterAssetParts({ parts, seeds });
		const merged = JSON.parse(collected.chapterAssets.text) as FixturePlan;
		expect(collected.objectCount).toBe(9);
		expect(collected.backgroundPlanCount).toBe(2);
		expect(merged.objectRegistry).toEqual((fixturePlan).objectRegistry);
		expect(merged.backgroundPlans).toEqual((fixturePlan).backgroundPlans);
		expect(() => parseChapterAssetPlan(collected.chapterAssets)).not.toThrow();
	});

	it("collect rejects count drift and an item identity that differs from its seed", () => {
		const seeds = collection("seeds", items.map((i) => i.seed), items.map((i) => i.seed.objectId));
		const short = collection("parts", items.slice(1).map((i) => ({ text: JSON.stringify(i.part) })), items.slice(1).map((i) => i.seed.objectId));
		expect(() => collectChapterAssetParts({ parts: short, seeds })).toThrow(/part count must match seeds/);
		const swapped = items.map((i) => i.seed.objectId); swapped[0] = "obj-elsewhere";
		const parts = collection("parts", items.map((i) => ({ text: JSON.stringify(i.part) })), swapped);
		expect(() => collectChapterAssetParts({ parts, seeds })).toThrow(/differs from seed/);
		expect(() => collectChapterAssetParts({ parts: { not: "a collection" }, seeds })).toThrow(/WorkflowCollection/);
	});

	it("seeds projection yields one stable item per outline entry, palette first and backgrounds under their scene", () => {
		const outline = {
			palette: { name: "月夜色彩锚点", brief: "冷月与灯笼" },
			scenes: [{ name: "长街", brief: "场景", backgrounds: [{ name: "长街俯视", brief: "全景" }] }],
			objects: [{ name: "周禾", kind: "character", brief: "主角" }],
		};
		const { collection: seeds, objectCount } = projectChapterAssetSeeds({ executionId: "e", nodeId: "n", outline: { text: JSON.stringify(outline) } });
		expect(objectCount).toBe(4);
		expect(seeds.items.map((item) => item.itemId)).toEqual(["obj-01", "obj-02", "obj-03", "bg-01"]);
		expect(seeds.items.map((item) => item.value.kind)).toEqual(["palette", "scene", "character", "background"]);
		expect(seeds.items[3]!.value.sceneObjectId).toBe("obj-02");
	});

	// 2026-10-06 ch1：大纲 5 个地点共 7 张底图被宿主的 6 张上限拦下，整条工作流失败；数量交给上游供应商限制。
	it("seeds every location and base image the outline lists, with no host-side count cap", () => {
		const scenes = [["工坊工作间", 2], ["旧图纸回忆", 1], ["工坊后院与仓库", 2], ["小楼屋顶", 1], ["工具室", 1]] as const;
		const outline = {
			palette: { name: "午后暖光锚点", brief: "暖阳" },
			scenes: scenes.map(([name, count]) => ({ name, brief: "地点",
				backgrounds: Array.from({ length: count }, (_, index) => ({ name: `${name}·视角${index + 1}`, brief: "空场" })) })),
			objects: [{ name: "周禾", kind: "character", brief: "主角" }],
		};
		const { collection: seeds } = projectChapterAssetSeeds({ executionId: "e", nodeId: "n", outline });
		expect(seeds.items.filter((item) => item.value.kind === "background")).toHaveLength(7);
		expect((chapterAssetOutlineSchema.properties as Record<string, Record<string, unknown>>).scenes.maxItems).toBeUndefined();
	});

	// Palette parts must remain in the assembled chapter plan.
	it("the outline's palette slot flows through a part author into a valid chapter asset plan", () => {
		const outline = {
			palette: { name: fixturePaletteEntry.name, brief: "全章冷暖对比" },
			scenes: [{ name: "fixture-scene", brief: "场景", backgrounds: [{ name: "fixture-bg", brief: "全景" }] }],
			objects: [],
		};
		const { collection: seeds } = projectChapterAssetSeeds({ executionId: "e", nodeId: "n", outline });
		const paletteSeed = seeds.items[0]!.value;
		expect(paletteSeed).toMatchObject({ objectId: "obj-01", kind: "palette", name: fixturePaletteEntry.name });
		const palettePart = { objectRegistry: [fixturePaletteEntry], backgroundPlans: [] };
		expect(validateWorkflowToolArguments(bindChapterAssetPartSchema(paletteSeed), palettePart)).toEqual([]);
		const plan = fixturePlan;
		const scene = { ...(plan.objectRegistry).find((entry) => entry.kind === "scene"), objectId: "obj-02", name: "fixture-scene" };
		const background = { ...(plan.backgroundPlans)[0], objectId: "bg-01" };
		background.plan = { ...background.plan, assetId: "bg-01" };
		const parts = [palettePart, { objectRegistry: [scene], backgroundPlans: [] }, { objectRegistry: [], backgroundPlans: [background] }];
		const collected = collectChapterAssetParts({
			seeds,
			parts: collection("parts", parts.map((part) => ({ text: JSON.stringify(part) })), seeds.items.map((item) => item.itemId)),
		});
		expect((JSON.parse(collected.chapterAssets.text) as FixturePlan).objectRegistry.map((entry: FixturePlan["objectRegistry"][number]) => entry.kind)).toEqual(["palette", "scene"]);
	});

	it("binds the contract per item: only the two registry fields are allowed", () => {
		const { seed } = items[0]!;
		const contract = parseWorkflowAgentJsonObjectContract({ requiredArrayFields: ["x"], allowedFields: ["x"], jsonSchema: { type: "object" } });
		if (!contract) throw new Error("fixture contract missing");
		const bound = bindChapterAssetPartAuthoringContract(contract, seed);
		expect(bound.allowedFields).toEqual(["objectRegistry", "backgroundPlans"]);
		expect(() => bindChapterAssetPartAuthoringContract(contract, "nope")).toThrow(/frozen asset-seed/);
	});
});
