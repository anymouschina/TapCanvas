import { describe, it, expect } from "vitest";
import { materialDtoToSource } from "./world-info.loader";

// 仅测纯映射：MaterialAssetDto(含已解析 latestVersion.data) → 引擎的 MaterialLike。
// DB 取数胶水(createProjectWorldInfoLoader)是薄封装，靠 material.repo 自身覆盖。

const baseDto = {
	id: "m1",
	projectId: "p1",
	teamId: null,
	folderId: null,
	kind: "character" as const,
	name: "李医生",
	currentVersion: 1,
	createdAt: "t",
	updatedAt: "t",
};

describe("materialDtoToSource", () => {
	it("data 含 imageUrl + wi → 透传到 MaterialLike", () => {
		const src = materialDtoToSource({
			...baseDto,
			latestVersion: {
				id: "v1",
				assetId: "m1",
				projectId: "p1",
				version: 1,
				data: { imageUrl: "https://x/lyi.png", wi: { triggerKeys: ["老李"], lockText: "白大褂" } },
				note: null,
				createdAt: "t",
			},
		});
		expect(src).toMatchObject({
			id: "m1",
			kind: "character",
			name: "李医生",
			imageUrl: "https://x/lyi.png",
		});
		expect(src.wi?.triggerKeys).toEqual(["老李"]);
		expect(src.wi?.lockText).toBe("白大褂");
	});

	it("旧数据 data 只有 imageUrl → wi 为 undefined，imageUrl 保留", () => {
		const src = materialDtoToSource({
			...baseDto,
			latestVersion: {
				id: "v1",
				assetId: "m1",
				projectId: "p1",
				version: 1,
				data: { imageUrl: "https://x/lyi.png" },
				note: null,
				createdAt: "t",
			},
		});
		expect(src.imageUrl).toBe("https://x/lyi.png");
		expect(src.wi).toBeUndefined();
	});

	it("latestVersion 为 null → 无 imageUrl/wi，但 kind/name 保留", () => {
		const src = materialDtoToSource({ ...baseDto, latestVersion: null });
		expect(src.kind).toBe("character");
		expect(src.name).toBe("李医生");
		expect(src.imageUrl).toBeUndefined();
		expect(src.wi).toBeUndefined();
	});

	it("wi 非对象(脏数据) → wi 安全置 undefined", () => {
		const src = materialDtoToSource({
			...baseDto,
			latestVersion: {
				id: "v1",
				assetId: "m1",
				projectId: "p1",
				version: 1,
				data: { imageUrl: "https://x/a.png", wi: "garbage" },
				note: null,
				createdAt: "t",
			},
		});
		expect(src.wi).toBeUndefined();
	});
});
