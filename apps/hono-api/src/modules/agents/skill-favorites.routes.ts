import { Hono } from "hono";
import type { AppEnv } from "../../types";
import {
	SkillFavoriteMutationResponseSchema,
	SkillFavoritesResponseSchema,
} from "./skill-favorites.schemas";
import {
	favoriteSkill,
	listSkillFavoriteKeys,
	unfavoriteSkill,
} from "./skill-favorites.service";

export const skillFavoritesRouter = new Hono<AppEnv>();

skillFavoritesRouter.get("/skills/favorites", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skillKeys = await listSkillFavoriteKeys(userId);
	return c.json(SkillFavoritesResponseSchema.parse({ skillKeys }));
});

skillFavoritesRouter.post("/skills/:skillKey/favorite", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skillKey = await favoriteSkill(userId, c.req.param("skillKey"));
	return c.json(SkillFavoriteMutationResponseSchema.parse({ skillKey, favorited: true }));
});

skillFavoritesRouter.delete("/skills/:skillKey/favorite", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skillKey = await unfavoriteSkill(userId, c.req.param("skillKey"));
	return c.json(SkillFavoriteMutationResponseSchema.parse({ skillKey, favorited: false }));
});
