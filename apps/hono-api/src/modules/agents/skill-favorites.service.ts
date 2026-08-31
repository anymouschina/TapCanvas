import { getPrismaClient } from "../../platform/node/prisma";
import { SkillKeySchema } from "./skill-favorites.schemas";

export async function listSkillFavoriteKeys(userId: string): Promise<string[]> {
	const rows = await getPrismaClient().skill_favorites.findMany({
		where: { user_id: userId },
		orderBy: { created_at: "desc" },
		select: { skill_key: true },
	});
	return rows.map((row) => row.skill_key);
}

export async function favoriteSkill(userId: string, rawSkillKey: string): Promise<string> {
	const skillKey = SkillKeySchema.parse(rawSkillKey);
	await getPrismaClient().skill_favorites.upsert({
		where: { user_id_skill_key: { user_id: userId, skill_key: skillKey } },
		create: {
			id: crypto.randomUUID(),
			user_id: userId,
			skill_key: skillKey,
			created_at: new Date().toISOString(),
		},
		update: {},
	});
	return skillKey;
}

export async function unfavoriteSkill(userId: string, rawSkillKey: string): Promise<string> {
	const skillKey = SkillKeySchema.parse(rawSkillKey);
	await getPrismaClient().skill_favorites.deleteMany({
		where: { user_id: userId, skill_key: skillKey },
	});
	return skillKey;
}
