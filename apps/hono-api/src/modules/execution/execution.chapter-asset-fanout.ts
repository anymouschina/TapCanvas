import { createWorkflowCollection, isWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	bindChapterAssetPartSchema,
	mergeChapterAssetParts,
	seedsFromOutline,
	type ChapterAssetSeed,
} from "../../../../../packages/schemas/video-authoring-stages/chapter-asset-fanout.mjs";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { parseChapterAssetPlan } from "./execution.video-authoring-stages";

/**
 * 章节资产扇出：大纲 → 逐对象作者（并行）→ 汇总。契约与动机见
 * packages/schemas/video-authoring-stages/chapter-asset-fanout.mjs。
 * 本模块只做身份与结构的确定性搬运，不改写任何创作内容。
 */

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 大纲（单个代理结果）→ 稳定身份的种子集合，每个种子驱动一个逐对象作者。 */
export function projectChapterAssetSeeds(input: Readonly<{
	executionId: string;
	nodeId: string;
	outline: unknown;
}>): Readonly<{ collection: WorkflowCollectionV1<ChapterAssetSeed>; objectCount: number }> {
	const seeds = seedsFromOutline(input.outline) as ChapterAssetSeed[];
	return {
		collection: createWorkflowCollection({
			collectionId: `${input.executionId}:${input.nodeId}:asset-seeds`,
			producerNodeId: input.nodeId,
			producerPortId: "asset-seeds",
			values: seeds,
			itemIds: seeds.map((seed) => seed.objectId),
		}),
		objectCount: seeds.length,
	};
}

/** 逐对象作者的契约：把冻结种子的 objectId/kind/name 钉进 schema，作者无法写到别的对象上。 */
export function bindChapterAssetPartAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	seed: unknown,
): WorkflowAgentJsonObjectContract {
	if (!record(seed)) throw new Error("Chapter asset part requires one frozen asset-seed item");
	return {
		...contract,
		allowedFields: ["objectRegistry", "backgroundPlans"],
		jsonSchema: bindChapterAssetPartSchema(seed),
	};
}

/**
 * 各对象结果 + 冻结种子 → 完整的 chapter-asset-plan/v3。
 * 先按种子逐项核对身份与归属，再用原 chapterAssetPlanSchema 对合并结果做完整校验，
 * 下游消费者拿到的与单作者时期完全同形（{text: <plan JSON>}）。
 */
export function collectChapterAssetParts(input: Readonly<{ parts: unknown; seeds: unknown }>): Readonly<{
	chapterAssets: Readonly<{ text: string }>;
	objectCount: number;
	backgroundPlanCount: number;
}> {
	if (!isWorkflowCollection(input.parts)) throw new Error("chapter-assets collector requires the per-object Agent results as a WorkflowCollection on asset-parts");
	if (!isWorkflowCollection(input.seeds)) throw new Error("chapter-assets collector requires the frozen seeds as a WorkflowCollection on asset-seeds");
	const seeds = input.seeds.items.map((item, index) => {
		if (!record(item.value)) throw new Error(`asset-seeds[${index}] must be a seed record`);
		return item.value as unknown as ChapterAssetSeed;
	});
	if (input.parts.items.length !== seeds.length) {
		throw new Error(`chapter-assets part count must match seeds: expected=${seeds.length}:actual=${input.parts.items.length}`);
	}
	input.parts.items.forEach((item, index) => {
		if (item.itemId !== seeds[index]!.objectId) {
			throw new Error(`asset-parts[${index}] Agent result item identity ${item.itemId} differs from seed ${seeds[index]!.objectId}`);
		}
	});
	const merged = mergeChapterAssetParts(seeds, input.parts.items.map((item) => item.value));
	const text = JSON.stringify(merged);
	// 完整校验：整份产物必须仍满足原 chapter-asset-plan/v3（含批次引用约束）。
	parseChapterAssetPlan({ text });
	return { chapterAssets: { text }, objectCount: merged.objectRegistry.length, backgroundPlanCount: merged.backgroundPlans.length };
}
