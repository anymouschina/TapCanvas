import { describe, expect, it } from "vitest";
import {
	computeOrphanedMaterialAssetIds,
	isMaterialCanvasDeleteSyncEnabled,
	type ReconcileMaterialAsset,
} from "./chapter.material-reconcile";

const CH43 = "book-______-1781618782973-ch43";
const CH40 = "book-______-1781618782973-ch40";

const assets: ReconcileMaterialAsset[] = [
	{ id: "a-xue", kind: "character", name: "薛大家", sourceChapterId: CH43 },
	{ id: "a-wangqi", kind: "character", name: "王齐", sourceChapterId: CH43 },
	{ id: "a-scene-fire", kind: "scene", name: "云萝山火海", sourceChapterId: CH43 },
	// 跨章复用：牛秀才 建于 ch40，被复用进 ch43。绑定章节仍是 ch40。
	{ id: "a-niuxiucai", kind: "character", name: "牛秀才", sourceChapterId: CH40 },
];

describe("computeOrphanedMaterialAssetIds", () => {
	it("删除：本章资产在本章画布已无任何引用 → 判孤儿", () => {
		// ch43 画布只剩种子文本节点，三张 ch43 卡都没了
		const flow = { nodes: [{ data: { kind: "text", label: "第四十三章" } }] };
		const orphans = computeOrphanedMaterialAssetIds({ chapterId: CH43, flow, assets });
		expect(orphans.sort()).toEqual(["a-scene-fire", "a-wangqi", "a-xue"]);
	});

	it("保留：跨章复用卡按绑定章节核对，保存 ch43 不动 ch40 的牛秀才", () => {
		const flow = { nodes: [{ data: { kind: "text" } }] };
		const orphans = computeOrphanedMaterialAssetIds({ chapterId: CH43, flow, assets });
		expect(orphans).not.toContain("a-niuxiucai");
	});

	it("保留：节点 materialAssetId 命中 → 还在用", () => {
		const flow = {
			nodes: [
				{ data: { kind: "image", materialAssetId: "a-xue", roleName: "薛大家" } },
			],
		};
		const orphans = computeOrphanedMaterialAssetIds({ chapterId: CH43, flow, assets });
		expect(orphans).not.toContain("a-xue");
		expect(orphans.sort()).toEqual(["a-scene-fire", "a-wangqi"]);
	});

	it("保留：仅在 anchorBindings 里按名引用（故事板/关键帧用）也算还在用", () => {
		const flow = {
			nodes: [
				{
					data: {
						kind: "storyboardImage",
						label: "ch43 关键帧01",
						anchorBindings: [
							{ kind: "character", entityId: "王齐", label: "王齐" },
							{ kind: "scene", entityId: "云萝山火海" },
						],
					},
				},
			],
		};
		const orphans = computeOrphanedMaterialAssetIds({ chapterId: CH43, flow, assets });
		// 王齐 + 云萝山火海 被锚点引用 → 保留；只剩薛大家是孤儿
		expect(orphans).toEqual(["a-xue"]);
	});

	it("空 chapterId 不删任何东西", () => {
		const flow = { nodes: [] };
		expect(computeOrphanedMaterialAssetIds({ chapterId: "", flow, assets })).toEqual([]);
	});

	it("绑定章节为空的资产不参与（不误删未绑定章节的库存）", () => {
		const unbound: ReconcileMaterialAsset[] = [
			{ id: "a-floating", kind: "style", name: "全局画风", sourceChapterId: null },
		];
		const flow = { nodes: [{ data: { kind: "text" } }] };
		expect(computeOrphanedMaterialAssetIds({ chapterId: CH43, flow, assets: unbound })).toEqual([]);
	});
});

describe("isMaterialCanvasDeleteSyncEnabled", () => {
	it("默认 OFF（opt-in，防瞬时画布状态误删库资产）", () => {
		expect(isMaterialCanvasDeleteSyncEnabled({})).toBe(false);
	});
	it("须显式 1/true/on 才开", () => {
		expect(isMaterialCanvasDeleteSyncEnabled({ MATERIAL_CANVAS_DELETE_SYNC: "1" })).toBe(true);
		expect(isMaterialCanvasDeleteSyncEnabled({ MATERIAL_CANVAS_DELETE_SYNC: "true" })).toBe(true);
		expect(isMaterialCanvasDeleteSyncEnabled({ MATERIAL_CANVAS_DELETE_SYNC: "on" })).toBe(true);
	});
	it("0/false/off/未设 → 关", () => {
		expect(isMaterialCanvasDeleteSyncEnabled({ MATERIAL_CANVAS_DELETE_SYNC: "0" })).toBe(false);
		expect(isMaterialCanvasDeleteSyncEnabled({ MATERIAL_CANVAS_DELETE_SYNC: "false" })).toBe(false);
		expect(isMaterialCanvasDeleteSyncEnabled({ MATERIAL_CANVAS_DELETE_SYNC: "off" })).toBe(false);
	});
});
