import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	ModelEndpointSchema,
	ModelProviderSchema,
	ModelTokenSchema,
	ProxyConfigSchema,
	UpsertEndpointSchema,
	UpsertProviderSchema,
	UpsertProxySchema,
	UpsertTokenSchema,
	ModelProfileSchema,
	UpsertProfileSchema,
	AvailableModelSchema,
	ModelExportDataSchema,
} from "./model.schemas";
import {
	deleteModelTokenForUser,
	getProxyConfigForUser,
	listModelEndpoints,
	listModelProviders,
	listModelTokens,
	upsertModelEndpoint,
	upsertModelProvider,
	upsertModelToken,
	upsertProxyConfigForUser,
	listProfiles,
	upsertProfile,
	deleteProfile,
	listAvailableModels,
	fetchProxyCredits,
	fetchProxyModelStatus,
	exportModelConfig,
	importModelConfig,
} from "./model.service";

export const modelRouter = new Hono<AppEnv>();

modelRouter.use("*", authMiddleware);

modelRouter.get("/providers", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const providers = await listModelProviders(c, userId);
	return c.json(ModelProviderSchema.array().parse(providers));
});

modelRouter.post("/providers", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProviderSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const provider = await upsertModelProvider(c, userId, parsed.data);
	return c.json(ModelProviderSchema.parse(provider));
});

modelRouter.get("/providers/:id/tokens", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const tokens = await listModelTokens(c, id, userId);
	return c.json(ModelTokenSchema.array().parse(tokens));
});

modelRouter.post("/tokens", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertTokenSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const token = await upsertModelToken(c, userId, parsed.data);
	return c.json(ModelTokenSchema.parse(token));
});

modelRouter.delete("/tokens/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteModelTokenForUser(c, id, userId);
	return c.body(null, 204);
});

modelRouter.get("/providers/:id/endpoints", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const endpoints = await listModelEndpoints(c, id, userId);
	return c.json(ModelEndpointSchema.array().parse(endpoints));
});

modelRouter.post("/endpoints", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertEndpointSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const endpoint = await upsertModelEndpoint(c, userId, parsed.data);
	return c.json(ModelEndpointSchema.parse(endpoint));
});

modelRouter.get("/proxy/:vendor", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const vendor = c.req.param("vendor");
	const cfg = await getProxyConfigForUser(c, userId, vendor);
	if (!cfg) return c.json({ error: "Not found" }, 404);
	return c.json(ProxyConfigSchema.parse(cfg));
});

modelRouter.post("/proxy/:vendor", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const vendor = c.req.param("vendor");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProxySchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const cfg = await upsertProxyConfigForUser(c, userId, {
		vendor,
		...parsed.data,
	});
	return c.json(ProxyConfigSchema.parse(cfg));
});

modelRouter.get("/proxy/:vendor/credits", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const vendor = c.req.param("vendor");
	const result = await fetchProxyCredits(c, userId, vendor);
	return c.json(result);
});

modelRouter.get("/proxy/:vendor/model-status", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const vendor = c.req.param("vendor");
	const model = c.req.query("model") || "";
	if (!model || !model.trim()) {
		return c.json({ error: "model is required" }, 400);
	}
	const result = await fetchProxyModelStatus(c, userId, vendor, model);
	return c.json(result);
});

modelRouter.get("/profiles", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const providerId = c.req.query("providerId") || undefined;
	const kindsQuery = c.req.queries("kind") || [];
	const kinds = kindsQuery.filter(
		(k): k is string => typeof k === "string" && !!k.trim(),
	);
	const profiles = await listProfiles(c, userId, {
		providerId,
		kinds: kinds.length ? kinds : undefined,
	});
	return c.json(ModelProfileSchema.array().parse(profiles));
});

modelRouter.post("/profiles", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProfileSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const profile = await upsertProfile(c, userId, parsed.data);
	return c.json(ModelProfileSchema.parse(profile));
});

modelRouter.delete("/profiles/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteProfile(c, userId, id);
	return c.body(null, 204);
});

modelRouter.get("/available", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const vendor = c.req.query("vendor") || undefined;
	const result = await listAvailableModels(c, userId, {
		vendor: vendor || undefined,
	});
	const models = Array.isArray(result?.models) ? result.models : [];
	return c.json(models.map((m) => AvailableModelSchema.parse(m)));
});

// Export / Import model config (for backup & migration)

modelRouter.get("/export", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const data = await exportModelConfig(c, userId);
	const filename = `model-config-${new Date()
		.toISOString()
		.split("T")[0]}.json`;
	return c.newResponse(JSON.stringify(ModelExportDataSchema.parse(data)), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	});
});

modelRouter.post("/import", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};

	let parsed: any;
	try {
		parsed = ModelExportDataSchema.parse(body);
	} catch (error: any) {
		return c.json(
			{
				success: false,
				error: "Invalid configuration format",
				message: error?.message ?? "Invalid payload",
			},
			400,
		);
	}

	try {
		const importResult = await importModelConfig(c, userId, parsed);
		return c.json({
			success: true,
			message: "Import completed",
			result: importResult,
		});
	} catch (error: any) {
		return c.json(
			{
				success: false,
				error: "Import failed",
				message: error?.message ?? String(error),
			},
			500,
		);
	}
});
