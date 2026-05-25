import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { listNewApiModels, updateNewApiModelStatus } from "./new-api-models.service";

export const newApiModelsRouter = new Hono<AppEnv>();

const UpdateNewApiModelStatusSchema = z.object({
	id: z.number().int().positive(),
	enabled: z.boolean(),
});

newApiModelsRouter.use("*", authMiddleware);

newApiModelsRouter.get("/", async (c) => {
	const enabledRaw = c.req.query("enabled");
	const kindRaw = String(c.req.query("kind") || "").trim();
	const refreshRaw = String(c.req.query("refresh") || "").trim().toLowerCase();
	const cacheControl = String(c.req.header("Cache-Control") || "").trim().toLowerCase();
	const enabled =
		enabledRaw === "true"
			? true
			: enabledRaw === "false"
				? false
				: undefined;
	const kind =
		kindRaw === "text" || kindRaw === "image" || kindRaw === "video"
			? kindRaw
			: undefined;
	const fresh = refreshRaw === "true" || cacheControl.includes("no-cache");
	const items = await listNewApiModels(c.env, { enabled, kind, fresh });
	return c.json(items);
});

newApiModelsRouter.put("/status", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateNewApiModelStatusSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: "Invalid request body",
				issues: parsed.error.issues,
			},
			400,
		);
	}
	const updated = await updateNewApiModelStatus(c.env, parsed.data);
	return c.json(updated);
});
