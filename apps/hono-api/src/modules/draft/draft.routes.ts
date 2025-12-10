import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { suggestPrompts, markPromptUsed } from "./draft.service";

export const draftRouter = new Hono<AppEnv>();

draftRouter.use("*", authMiddleware);

draftRouter.get("/suggest", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const q = c.req.query("q") || "";
	const provider = c.req.query("provider") || "sora";
	const limitParam = c.req.query("limit");
	const mode = c.req.query("mode") || undefined;
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam) || 6
			: 6;
	const result = await suggestPrompts(c, userId, {
		query: q,
		provider,
		limit,
		mode,
	});
	return c.json(result);
});

draftRouter.get("/mark-used", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const prompt = c.req.query("prompt") || "";
	const provider = c.req.query("provider") || "sora";
	const result = await markPromptUsed(c, userId, { prompt, provider });
	return c.json(result);
});

