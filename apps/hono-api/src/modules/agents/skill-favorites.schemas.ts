import { z } from "zod";

export const SkillKeySchema = z.string().trim().min(1).max(240);

export const SkillFavoritesResponseSchema = z.object({
	skillKeys: z.array(SkillKeySchema),
}).strict();

export const SkillFavoriteMutationResponseSchema = z.object({
	skillKey: SkillKeySchema,
	favorited: z.boolean(),
}).strict();
