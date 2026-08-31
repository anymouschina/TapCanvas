import { describe, it, expect } from "vitest";
import { resolveWorldInfo, type WorldInfoLoader } from "./world-info.service";

function loaderOf(parts: { materials?: unknown; bibles?: unknown; style?: unknown }): WorldInfoLoader {
	return {
		loadMaterials: async () => (parts.materials as any) ?? [],
		loadCharacterBibles: async () => (parts.bibles as any) ?? [],
		loadStyleBible: async () => (parts.style as any) ?? null,
	};
}

describe("resolveWorldInfo（编排：加载→命中→拼装）", () => {
	it("无任何条目 → prompt 原样返回（no-op 安全，保障现有项目零影响）", async () => {
		const r = await resolveWorldInfo({ shotText: "李医生进客厅", loader: loaderOf({}) });
		expect(r.prompt).toBe("李医生进客厅");
		expect(r.hitCount).toBe(0);
		expect(r.referenceImages).toEqual([]);
		expect(r.negativePrompt).toBe("");
	});

	it("脚本命中某素材触发词 → 锁定文注入、脚本保留、参考图带出", async () => {
		const r = await resolveWorldInfo({
			shotText: "李医生进客厅",
			loader: loaderOf({
				materials: [
					{
						id: "m1",
						kind: "character",
						name: "李医生",
						imageUrl: "https://x/lyi.png",
						wi: { triggerKeys: ["李医生"], lockText: "白大褂·金丝眼镜", tailReinforce: true },
					},
				],
			}),
		});
		expect(r.hitCount).toBe(1);
		expect(r.prompt).toContain("白大褂"); // 锁定文进了 prompt
		expect(r.prompt).toContain("李医生进客厅"); // 原脚本保留
		expect(r.referenceImages.map((x) => x.url)).toContain("https://x/lyi.png");
	});

	it("命中角色 → 锁定文在 prompt 尾部 recency 重述（最后一次出现晚于脚本）", async () => {
		const r = await resolveWorldInfo({
			shotText: "李医生缓缓坐下",
			loader: loaderOf({
				bibles: [{ characterBibleId: "cb1", name: "李医生", outfit: "白大褂" }],
			}),
		});
		const iScript = r.prompt.indexOf("缓缓坐下");
		const iTail = r.prompt.lastIndexOf("白大褂");
		expect(iTail).toBeGreaterThan(iScript);
	});

	it("loader 未提供 bibles/style（可选）→ 不报错，正常工作", async () => {
		const loader: WorldInfoLoader = { loadMaterials: async () => [] };
		const r = await resolveWorldInfo({ shotText: "空镜", loader });
		expect(r.prompt).toBe("空镜");
	});
});
