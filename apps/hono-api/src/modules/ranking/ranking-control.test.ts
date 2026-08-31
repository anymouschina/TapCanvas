import { describe, expect, it } from "vitest";
import {
	EMPTY_HOMEPAGE_VIDEO_MODERATION_CONFIG,
	HomepageVideoModerationConfigSchema,
	calculateRanking,
	countSkillPromptCharacters,
	filterHomepageModeratedAssets,
	parseSkillLicenseConfig,
} from "./ranking-control";

describe("Homepage video moderation", () => {
	it("uses a strict, independently versioned blacklist contract", () => {
		expect(HomepageVideoModerationConfigSchema.parse({
			kind: "homepageVideoModeration",
			version: 1,
			blockedAssetIds: ["asset-b", "asset-a"],
		})).toEqual({
			kind: "homepageVideoModeration",
			version: 1,
			blockedAssetIds: ["asset-b", "asset-a"],
		});
		expect(EMPTY_HOMEPAGE_VIDEO_MODERATION_CONFIG.blockedAssetIds).toEqual([]);
		expect(() => HomepageVideoModerationConfigSchema.parse({
			kind: "homepageVideoModeration",
			version: 1,
			blockedAssetIds: [],
			ignored: true,
		})).toThrow();
	});

	it("filters blocked works only from the public homepage surface", () => {
		const works = [{ id: "allowed" }, { id: "blocked" }];
		const blockedAssetIds = new Set(["blocked"]);

		expect(filterHomepageModeratedAssets(works, blockedAssetIds, true)).toEqual([{ id: "allowed" }]);
		expect(filterHomepageModeratedAssets(works, blockedAssetIds, false)).toEqual(works);
	});
});

describe("calculateRanking", () => {
	it("keeps factual metrics separate from manual operations", () => {
		const result = calculateRanking([
			{ id: "popular", metric: 100, createdAt: "2026-01-01T00:00:00.000Z" },
			{ id: "new", metric: 1, createdAt: "2026-07-01T00:00:00.000Z" },
		], {
			metricWeight: 70,
			freshnessWeight: 30,
			freshnessHalfLifeDays: 30,
			items: { new: { manualBoost: 500, recommended: false, pinned: false, displayOrder: 0 } },
			nowMs: Date.parse("2026-07-02T00:00:00.000Z"),
		});
		expect(result[0]?.id).toBe("new");
		expect(result[0]?.manualBoost).toBe(500);
		expect(result.find((item) => item.id === "popular")?.algorithmScore).toBeGreaterThan(60);
	});

	it("applies pinned, recommended and display order deterministically", () => {
		const result = calculateRanking([
			{ id: "b", metric: 0, createdAt: "2026-01-01T00:00:00.000Z" },
			{ id: "a", metric: 0, createdAt: "2026-01-01T00:00:00.000Z" },
			{ id: "pinned", metric: 0, createdAt: "2026-01-01T00:00:00.000Z" },
		], {
			metricWeight: 50,
			freshnessWeight: 50,
			freshnessHalfLifeDays: 30,
			items: {
				a: { manualBoost: 0, recommended: false, pinned: false, displayOrder: 2 },
				b: { manualBoost: 0, recommended: false, pinned: false, displayOrder: 1 },
				pinned: { manualBoost: 0, recommended: false, pinned: true, displayOrder: 99 },
			},
			nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
		});
		expect(result.map((item) => item.id)).toEqual(["pinned", "b", "a"]);
	});

	it("places recommended content above algorithm-only content", () => {
		const result = calculateRanking([
			{ id: "algorithm-winner", metric: 10_000, createdAt: "2026-07-01T00:00:00.000Z" },
			{ id: "recommended", metric: 0, createdAt: "2026-01-01T00:00:00.000Z" },
		], {
			metricWeight: 100,
			freshnessWeight: 0,
			freshnessHalfLifeDays: 30,
			items: {
				recommended: { manualBoost: 0, recommended: true, pinned: false, displayOrder: 0 },
			},
			nowMs: Date.parse("2026-07-02T00:00:00.000Z"),
		});
		expect(result.map((item) => item.id)).toEqual(["recommended", "algorithm-winner"]);
	});
});

describe("Skill marketplace facts", () => {
	it("counts Unicode prompt characters without splitting surrogate pairs", () => {
		expect(countSkillPromptCharacters("A你😀\n")).toBe(4);
	});

	it("rejects malformed Skill entitlement JSON explicitly", () => {
		expect(() => parseSkillLicenseConfig("{broken", "product-a")).toThrowError(
			expect.objectContaining({ code: "skill_license_config_json_invalid" }),
		);
	});

	it("rejects structurally invalid Skill entitlement configuration", () => {
		expect(() => parseSkillLicenseConfig(JSON.stringify({ sourceType: "official" }), "product-a")).toThrowError(
			expect.objectContaining({ code: "skill_license_config_schema_invalid" }),
		);
	});

	it("accepts a complete user-asset license configuration", () => {
		expect(parseSkillLicenseConfig(JSON.stringify({
			sourceType: "user_asset",
			skillId: "skill-a",
			skillName: "镜头设计",
			description: null,
			sellerUserId: "seller-a",
			sourceAssetId: "asset-a",
			createdAt: "2026-07-01T00:00:00.000Z",
			category: "视频创作",
		}), "product-a")).toMatchObject({ sourceType: "user_asset", sellerUserId: "seller-a" });
	});
});
