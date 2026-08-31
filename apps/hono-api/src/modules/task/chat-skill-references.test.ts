import { describe, expect, it } from "vitest";
import { AgentsChatRequestSchema } from "../apiKey/apiKey.schemas";
import type { UserContextAssetDto } from "../agents/agents.schemas";
import { toExternalSkillReference } from "./chat-skill-references";

const asset: UserContextAssetDto = {
	id: "asset-1",
	kind: "skill",
	fileName: "wanwusheng.md",
	name: "万物生3prompt skill",
	description: "Seedance prompt 写作",
	logoUrl: "https://assets.example.com/wanwusheng.png",
	sizeBytes: 128,
	sha256: "a".repeat(64),
	marketplaceListing: null,
	sourceMarketplaceProductId: "marketplace-product-1",
	createdAt: "2026-08-01T00:00:00.000Z",
	updatedAt: "2026-08-02T00:00:00.000Z",
};

describe("chat Skill references", () => {
	it("maps an installed marketplace Skill to a body-free canonical reference", () => {
		expect(toExternalSkillReference(asset)).toEqual({
			id: asset.id,
			key: `user-skill:${asset.id}`,
			name: asset.name,
			description: asset.description,
			logoUrl: asset.logoUrl,
			source: "marketplace",
			version: asset.updatedAt,
			contentHash: asset.sha256,
			sizeBytes: asset.sizeBytes,
		});
	});

	it("accepts only id plus source at the public chat boundary", () => {
		const valid = AgentsChatRequestSchema.safeParse({
			prompt: "用这个技能帮我写 prompt",
			chatContext: {
				skill: { id: asset.id, source: "marketplace" },
			},
		});
		expect(valid.success).toBe(true);

		const leakedBody = AgentsChatRequestSchema.safeParse({
			prompt: "用这个技能帮我写 prompt",
			chatContext: {
				skill: {
					id: asset.id,
					source: "marketplace",
					content: "private Skill body",
				},
			},
		});
		expect(leakedBody.success).toBe(false);
	});
});
