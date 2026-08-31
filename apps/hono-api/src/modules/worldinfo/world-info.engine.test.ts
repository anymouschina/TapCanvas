import { describe, it, expect } from "vitest";
import {
	buildWorldEntries,
	inject,
	assemblePrompt,
	type WorldEntry,
} from "./world-info.engine";

// —— buildWorldEntries：四源(P0 取 bible/material/style)归一成 WorldEntry —————————

describe("buildWorldEntries", () => {
	it("角色圣经 → charLock 条目：lockText 含 outfit+distinctiveFeatures，触发词默认取角色名", () => {
		const entries = buildWorldEntries({
			characterBibles: [
				{
					characterBibleId: "cb1",
					name: "李医生",
					outfit: "白大褂",
					distinctiveFeatures: "金丝眼镜·微卷短发",
				},
			],
		});
		expect(entries).toHaveLength(1);
		const e = entries[0];
		expect(e.kind).toBe("character");
		expect(e.slot).toBe("charLock");
		expect(e.triggerKeys).toContain("李医生");
		expect(e.lockText).toContain("白大褂");
		expect(e.lockText).toContain("金丝眼镜");
	});

	it("画布素材(带 data_json.wi) → 条目读 wi 的触发词/锁定文，参考图取 imageUrl", () => {
		const entries = buildWorldEntries({
			materials: [
				{
					id: "m1",
					kind: "character",
					name: "李医生",
					imageUrl: "https://x/lyi.png",
					wi: { triggerKeys: ["老李", "李医生"], lockText: "白大褂·38岁" },
				},
			],
		});
		const e = entries[0];
		expect(e.triggerKeys).toEqual(["老李", "李医生"]);
		expect(e.lockText).toBe("白大褂·38岁");
		expect(e.referenceImages.map((r) => r.url)).toEqual(["https://x/lyi.png"]);
		expect(e.referenceImages[0].role).toBe("character");
	});

	it("旧素材(只有 imageUrl，无 wi) → 向后兼容：触发词默认取 name，参考图仍取 imageUrl", () => {
		const entries = buildWorldEntries({
			materials: [{ id: "m2", kind: "scene", name: "民国客厅", imageUrl: "https://x/room.png" }],
		});
		const e = entries[0];
		expect(e.triggerKeys).toEqual(["民国客厅"]);
		expect(e.referenceImages.map((r) => r.url)).toEqual(["https://x/room.png"]);
		expect(e.lockText).toBe("");
	});

	it("风格圣经 → constant 画风条目：slot=styleConstant，负面词进 negativeText", () => {
		const entries = buildWorldEntries({
			styleBible: {
				styleName: "胶片暖调",
				styleVisualDirectives: ["柔和暖光", "颗粒感"],
				styleConsistencyRules: ["统一色温"],
				styleNegativeDirectives: ["过曝", "塑料感"],
			},
		});
		const e = entries[0];
		expect(e.kind).toBe("style");
		expect(e.slot).toBe("styleConstant");
		expect(e.constant).toBe(true);
		expect(e.lockText).toContain("柔和暖光");
		expect(e.lockText).toContain("统一色温");
		expect(e.negativeText).toContain("过曝");
	});
});

// —— inject：扫脚本 → 命中 → 归位成 blocks ——————————————————————————————

const sample: WorldEntry[] = [
	{
		id: "lyi",
		source: "bible",
		kind: "character",
		slot: "charLock",
		triggerKeys: ["李医生", "老李"],
		lockText: "白大褂·金丝眼镜",
		referenceImages: [{ url: "https://x/lyi.png", role: "character", label: "李医生" }],
		tailReinforce: true,
		priority: 100,
	},
	{
		id: "su",
		source: "bible",
		kind: "character",
		slot: "charLock",
		triggerKeys: ["苏护士", "小苏"],
		lockText: "粉色护士服",
		referenceImages: [],
		priority: 100,
	},
	{
		id: "style",
		source: "bible",
		kind: "style",
		slot: "styleConstant",
		triggerKeys: [],
		lockText: "胶片暖调",
		negativeText: "过曝",
		constant: true,
		referenceImages: [],
		priority: 200,
	},
];

describe("inject", () => {
	it("脚本提到触发词 → 该条目命中并带 hitKey", () => {
		const out = inject({ shotText: "李医生站在客厅盯着对面", entries: sample });
		const hit = out.injectedEntries.find((x) => x.entry.id === "lyi");
		expect(hit).toBeTruthy();
		expect(hit?.hitKey).toBe("李医生");
	});

	it("脚本没提到 → 不命中", () => {
		const out = inject({ shotText: "李医生独自在房间", entries: sample });
		expect(out.injectedEntries.find((x) => x.entry.id === "su")).toBeFalsy();
	});

	it("constant 画风条目 → 无论脚本是否命中都注入", () => {
		const out = inject({ shotText: "空镜，没有人", entries: sample });
		expect(out.injectedEntries.find((x) => x.entry.id === "style")).toBeTruthy();
	});

	it("命中条目按 slot 归位成 blocks；参考图去重带标签输出", () => {
		const out = inject({ shotText: "李医生进来了", entries: sample });
		expect(out.blocks.some((b) => b.slot === "charLock")).toBe(true);
		expect(out.blocks.some((b) => b.slot === "styleConstant")).toBe(true);
		expect(out.referenceImages.map((r) => r.url)).toContain("https://x/lyi.png");
		expect(out.negativeBlock).toContain("过曝");
	});

	it("tailReinforce 条目 → 额外产出 tailReinforce 槽的浓缩重述", () => {
		const out = inject({ shotText: "李医生", entries: sample });
		const tail = out.blocks.filter((b) => b.slot === "tailReinforce");
		expect(tail.length).toBeGreaterThan(0);
		expect(tail.some((b) => b.text.includes("白大褂"))).toBe(true);
	});
});

// —— assemblePrompt：块状有序拼装 + recency(锁定压尾) ————————————————————

describe("assemblePrompt", () => {
	it("固定顺序：画风→场景→用户脚本(居中)→角色锁→尾部重述", () => {
		const out = inject({ shotText: "李医生进客厅", entries: sample });
		const { prompt } = assemblePrompt(out, "李医生进客厅，缓缓坐下");
		const iStyle = prompt.indexOf("胶片暖调");
		const iScript = prompt.indexOf("缓缓坐下");
		const iCharLockFirst = prompt.indexOf("白大褂");
		const iTail = prompt.lastIndexOf("白大褂");
		expect(iStyle).toBeGreaterThanOrEqual(0);
		expect(iScript).toBeGreaterThan(iStyle); // 画风在脚本前
		expect(iCharLockFirst).toBeGreaterThan(iScript); // 角色锁在脚本后
		expect(iTail).toBeGreaterThan(iScript); // 尾部重述在脚本之后（recency）
	});

	it("负面词单独返回，不混进正向 prompt", () => {
		const out = inject({ shotText: "李医生", entries: sample });
		const { prompt, negative } = assemblePrompt(out, "脚本");
		expect(negative).toContain("过曝");
		expect(prompt).not.toContain("过曝");
	});
});
