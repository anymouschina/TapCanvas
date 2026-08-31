import { describe, expect, it } from "vitest";
import { SkillMarketplaceResponseSchema } from "../ranking/ranking-control";
import { AgentSkillMetadataSchema } from "./agents.schemas";

const internalSkill = {
	id: "skill-storyboard",
	key: "storyboard-director",
	name: "分镜导演",
	description: "设计连续分镜",
	content: "# Private system skill body\n\nThis must never reach the browser.",
	logoUrl: null,
	category: "系统技能",
	enabled: true,
	visible: true,
	sortOrder: 1,
	createdAt: "2026-07-22T00:00:00.000Z",
	updatedAt: "2026-07-22T00:00:00.000Z",
};

describe("public Skill contracts", () => {
	it("strips the system Skill body from public catalog metadata", () => {
		const publicSkill = AgentSkillMetadataSchema.parse(internalSkill);

		expect(publicSkill).not.toHaveProperty("content");
		expect(publicSkill).toMatchObject({ id: internalSkill.id, key: internalSkill.key });
	});

	it("strips Skill bodies from marketplace items", () => {
		const response = SkillMarketplaceResponseSchema.parse({
			configured: false,
			config: {
				purchaseWeight: 70,
				freshnessWeight: 30,
				freshnessHalfLifeDays: 90,
				items: {},
			},
			creditBalance: 1200,
			canListSkills: false,
			items: [{
				skill: internalSkill,
				productId: null,
				priceCredits: null,
				purchasable: false,
				owned: true,
				sourceType: "official",
				sellerUserId: null,
				sellerName: "TapCanvas",
				sizeBytes: null,
				promptCharacterCount: internalSkill.content.length,
				listedAt: null,
				realPurchaseCount: 0,
				algorithmScore: 0,
				manualBoost: 0,
				effectiveScore: 0,
				recommended: false,
				pinned: false,
				displayOrder: 0,
				rank: 1,
			}],
		});

		expect(response.items[0]?.skill).not.toHaveProperty("content");
	});
});
