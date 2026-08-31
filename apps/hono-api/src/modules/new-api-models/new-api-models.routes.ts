import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	isNonSelectableCatalogModel,
	isSelectableNewApiModel,
	getNewApiGatewayReadiness,
	listNewApiModels,
	updateNewApiModelStatus,
} from "./new-api-models.service";

export const newApiModelsRouter = new Hono<AppEnv>();

const UpdateNewApiModelStatusSchema = z.object({
	id: z.number().int().positive(),
	enabled: z.boolean(),
});

newApiModelsRouter.use("*", authMiddleware);

newApiModelsRouter.get("/readiness", async (c) => {
	return c.json(await getNewApiGatewayReadiness(c.env));
});

newApiModelsRouter.get("/", async (c) => {
	const enabledRaw = c.req.query("enabled");
	const kindRaw = String(c.req.query("kind") || "").trim();
	const refreshRaw = String(c.req.query("refresh") || "").trim().toLowerCase();
	const selectableRaw = String(c.req.query("selectable") || "").trim().toLowerCase();
	const includeActionModelsRaw = String(c.req.query("include_action_models") || "").trim().toLowerCase();
	const cacheControl = String(c.req.header("Cache-Control") || "").trim().toLowerCase();
	const enabled =
		enabledRaw === "true"
			? true
			: enabledRaw === "false"
				? false
				: undefined;
	const kind =
		kindRaw === "text" || kindRaw === "image" || kindRaw === "video" || kindRaw === "audio"
			? kindRaw
			: undefined;
	const fresh = refreshRaw === "true" || cacheControl.includes("no-cache");
	const selectable = selectableRaw === "true";
	const includeActionModels = includeActionModelsRaw === "true";
	const items = await listNewApiModels(c.env, { enabled, kind, fresh });
	// Hide action-only models (MediaKit repair/matting and video enhancement)
	// from ordinary generation selectors. The dedicated video-tool selector
	// opts into these rows explicitly, while runtime validation and billing still
	// read the complete catalog through listNewApiModels directly.
	const visible = items.filter(
		(item) =>
			(includeActionModels || !isNonSelectableCatalogModel(item.modelName)) &&
			(!selectable || isSelectableNewApiModel(item)),
	);
	return c.json(visible);
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
