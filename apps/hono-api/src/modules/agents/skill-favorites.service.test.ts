import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaStub = vi.hoisted(() => ({
	skill_favorites: {
		findMany: vi.fn(),
		upsert: vi.fn(),
		deleteMany: vi.fn(),
	},
}));

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaStub }));

import { favoriteSkill, listSkillFavoriteKeys, unfavoriteSkill } from "./skill-favorites.service";

describe("Skill favorite service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("isolates list queries by user and preserves newest-first order", async () => {
		prismaStub.skill_favorites.findMany.mockResolvedValue([
			{ skill_key: "skill-new" },
			{ skill_key: "skill-old" },
		]);
		await expect(listSkillFavoriteKeys("user-a")).resolves.toEqual(["skill-new", "skill-old"]);
		expect(prismaStub.skill_favorites.findMany).toHaveBeenCalledWith({
			where: { user_id: "user-a" },
			orderBy: { created_at: "desc" },
			select: { skill_key: true },
		});
	});

	it("uses upsert so repeated favorite requests are idempotent", async () => {
		prismaStub.skill_favorites.upsert.mockResolvedValue({});
		await expect(favoriteSkill("user-a", " skill-a ")).resolves.toBe("skill-a");
		expect(prismaStub.skill_favorites.upsert).toHaveBeenCalledWith(expect.objectContaining({
			where: { user_id_skill_key: { user_id: "user-a", skill_key: "skill-a" } },
			update: {},
		}));
	});

	it("uses deleteMany so repeated unfavorite requests are idempotent", async () => {
		prismaStub.skill_favorites.deleteMany.mockResolvedValue({ count: 0 });
		await expect(unfavoriteSkill("user-b", "skill-a")).resolves.toBe("skill-a");
		expect(prismaStub.skill_favorites.deleteMany).toHaveBeenCalledWith({
			where: { user_id: "user-b", skill_key: "skill-a" },
		});
	});

	it("rejects empty and oversized skill keys before querying the database", async () => {
		await expect(favoriteSkill("user-a", "   ")).rejects.toThrow();
		await expect(unfavoriteSkill("user-a", "x".repeat(241))).rejects.toThrow();
		expect(prismaStub.skill_favorites.upsert).not.toHaveBeenCalled();
		expect(prismaStub.skill_favorites.deleteMany).not.toHaveBeenCalled();
	});
});
