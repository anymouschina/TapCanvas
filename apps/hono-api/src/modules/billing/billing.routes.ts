import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	BillingModelOptionSchema,
	ModelCreditCostSchema,
	UpsertModelCreditCostRequestSchema,
} from "./billing.schemas";
import {
	deleteModelCreditCostForAdmin,
	listBillingModelCatalog,
	listModelCreditCostsForAdmin,
	upsertModelCreditCostForAdmin,
} from "./billing.service";

export const billingRouter = new Hono<AppEnv>();

billingRouter.use("*", authMiddleware);

// Model dropdown options (admin only)
billingRouter.get("/models", async (c) => {
	const items = await listBillingModelCatalog(c);
	return c.json(items.map((it) => BillingModelOptionSchema.parse(it)));
});

// List current model credit costs (admin only)
billingRouter.get("/model-costs", async (c) => {
	const rows = await listModelCreditCostsForAdmin(c);
	return c.json(
		rows.map((r: any) =>
			ModelCreditCostSchema.parse({
				modelKey: r.model_key,
				...(typeof r.spec_key === "string" && r.spec_key.trim() ? { specKey: r.spec_key.trim() } : {}),
				cost: Number(r.cost ?? 0) || 0,
				enabled: Number(r.enabled ?? 1) !== 0,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
			}),
		),
	);
});

// Upsert a model credit cost (admin only)
billingRouter.post("/model-costs", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelCreditCostRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const row = await upsertModelCreditCostForAdmin(c, parsed.data);
	return c.json(
		ModelCreditCostSchema.parse({
			modelKey: row.model_key,
			...(typeof row.spec_key === "string" && row.spec_key.trim() ? { specKey: row.spec_key.trim() } : {}),
			cost: Number(row.cost ?? 0) || 0,
			enabled: Number(row.enabled ?? 1) !== 0,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}),
	);
});

// Delete a model credit cost (admin only)
billingRouter.delete("/model-costs/:modelKey", async (c) => {
	const modelKey = c.req.param("modelKey");
	const specKey = c.req.query("specKey") || undefined;
	await deleteModelCreditCostForAdmin(c, modelKey, specKey);
	return c.body(null, 204);
});
