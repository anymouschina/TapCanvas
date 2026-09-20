import { describe, expect, it } from "vitest";
import { PublicAgentsImageGenerateToCanvasArgsSchema } from "../task/agents-tool-bridge.generate-image-to-canvas";
import { blockingBackgroundPlanCollection } from "./execution.blocking-backgrounds";
import { workflowImageAssetMetadata } from "./execution.node-executors";

import {
	workflowImageSemanticLabel,
	workflowVideoSemanticLabel,
} from "./execution.media-label";

describe("workflow media semantic labels", () => {
	it("uses frozen image identity facts instead of a workflow ordinal", () => {
		expect(workflowImageSemanticLabel({
			assetMetadata: {
				referenceType: "character",
				canonicalName: "body-liu-xiu-001",
				displayName: "刘秀",
			},
			itemIndex: 5,
		})).toBe("刘秀角色卡");
		expect(workflowImageSemanticLabel({
			assetMetadata: {
				referenceType: "scene",
				canonicalName: "五指巷小义庄",
				displayName: "五指巷小义庄",
			},
			itemIndex: 1,
		})).toBe("五指巷小义庄场景卡");
	});

	it("preserves authored background semantics through split and image metadata projection", () => {
		const plan = { assetId: "opaque-background-id", displayName: "嵩阳高中灵根租借办公室",
			prompt: "作者的场景底图提示词", negativePrompt: "作者的负面提示词", referenceAssetBindings: [] };
		const collection = blockingBackgroundPlanCollection([plan, plan], "execution", "background-split");
		expect(collection.items).toHaveLength(1);
		const metadata = workflowImageAssetMetadata(collection.items[0]?.value);
		expect(metadata).toMatchObject({ displayName: plan.displayName, referenceType: "scene",
			assetPurpose: "blocking_background", sourcePlanAssetId: plan.assetId });
		expect(workflowImageSemanticLabel({ assetMetadata: metadata, itemIndex: 0 }))
			.toBe("嵩阳高中灵根租借办公室场景底图");
		expect(plan).not.toHaveProperty("assetPurpose");
		const parsed = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({ node: {
			id: "background-node", type: "taskNode", position: { x: 0, y: 0 },
			data: { ...metadata, kind: "image", prompt: plan.prompt, negativePrompt: plan.negativePrompt },
		} });
		expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);

	});

	it("uses the structured clip logline for video output labels", () => {
		expect(workflowVideoSemanticLabel({
			structuredClip: { logline: "刘秀隔门回应突发求救" },
			itemIndex: 0,
		})).toBe("第 1 段｜刘秀隔门回应突发求救");
	});
});
