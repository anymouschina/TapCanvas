import { describe, expect, it } from "vitest";

import {
	selectAnchorReferenceImages,
	mergeAnchorReferences,
} from "./chapter-anchor-autobind";

const U = (s: string) => `https://file.beqlee.icu/gen/${s}.png`;

function imgNode(label: string, imageUrl: string, productionLayer?: string) {
	return { data: { kind: "image", label, imageUrl, ...(productionLayer ? { productionLayer } : {}) } };
}

describe("selectAnchorReferenceImages", () => {
	const nodes = [
		imgNode("风格锚｜万妖图录传｜V3.3正式版", U("wanyao")),
		imgNode("风格锚｜复用项目现有", U("oldstyle")),
		imgNode("道具卡｜铜铃", U("bell")),
		imgNode("ch38 设计板01", U("board1"), "design_board"),
	];

	it("只解析风格锚与道具锚，不再按名称补绑角色或场景 URL", () => {
		const sel = selectAnchorReferenceImages(nodes, {
			prop: ["铜铃"],
		});
		expect(sel.styleAnchorUrl).toBe(U("wanyao")); // 偏好万妖/正式，而非复用现有
		expect(sel.propUrls).toEqual([U("bell")]);
		expect(sel).not.toHaveProperty("characterUrls");
		expect(sel).not.toHaveProperty("sceneUrls");
	});

	it("风格锚同分取最新(后出现覆盖)；万妖优先于复用现有", () => {
		const reordered = [
			imgNode("风格锚｜复用项目现有", U("oldstyle")),
			imgNode("风格锚｜万妖图录传", U("wanyao")),
		];
		expect(selectAnchorReferenceImages(reordered, {}).styleAnchorUrl).toBe(U("wanyao"));
	});

	it("无 imageUrl / 非 image kind 节点跳过", () => {
		const sel = selectAnchorReferenceImages(
			[{ data: { kind: "image", label: "道具卡｜铜铃", imageUrl: "" } }, { data: { kind: "text", label: "道具卡｜铜铃" } }],
			{ prop: ["铜铃"] },
		);
		expect(sel.propUrls).toEqual([]);
	});
});

describe("mergeAnchorReferences", () => {
	it("把风格锚与道具卡补进现有 ref，去重保序(现有在前)", () => {
		const { merged, injected } = mergeAnchorReferences([U("board1")], {
			styleAnchorUrl: U("wanyao"),
			propUrls: [U("bell")],
		});
		expect(merged).toEqual([U("board1"), U("wanyao"), U("bell")]);
		expect(injected).toEqual([U("wanyao"), U("bell")]);
	});

	it("已存在的不重复注入", () => {
		const { injected } = mergeAnchorReferences([U("wanyao"), U("lichangan")], {
			styleAnchorUrl: U("wanyao"),
			propUrls: [U("lichangan"), U("spider")],
		});
		expect(injected).toEqual([U("spider")]);
	});

	it("按 maxRefs 截断(现有靠前保留)", () => {
		const { merged } = mergeAnchorReferences([U("a"), U("b")], {
			styleAnchorUrl: U("wanyao"),
			propUrls: [U("c"), U("d"), U("e"), U("f"), U("g")],
		}, { maxRefs: 4 });
		expect(merged.length).toBe(4);
		expect(merged.slice(0, 2)).toEqual([U("a"), U("b")]);
	});

	it("无锚可补 → 原样返回", () => {
		const { merged, injected } = mergeAnchorReferences([U("a")], {
			styleAnchorUrl: null,
			propUrls: [],
		});
		expect(merged).toEqual([U("a")]);
		expect(injected).toEqual([]);
	});

	it("lockedAnchors.prop 命中道具卡/法宝卡并注入（2026-07-10 混元金斗实测补齐）", () => {
		const nodes = [
			{ data: { kind: "image", label: "道具卡｜混元金斗", imageUrl: U("jindou") } },
			{ data: { kind: "image", label: "法宝卡·弑神枪残体", imageUrl: U("spear") } },
		];
		const sel = selectAnchorReferenceImages(nodes, {
			prop: ["混元金斗", "弑神枪残体"],
		});
		expect(sel.propUrls).toEqual([U("jindou"), U("spear")]);
		const { injected } = mergeAnchorReferences([], sel);
		expect(injected).toEqual([U("jindou"), U("spear")]);
	});
});
