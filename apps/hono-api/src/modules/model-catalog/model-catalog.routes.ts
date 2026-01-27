import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	ModelCatalogImportPackageSchema,
	ModelCatalogVendorApiKeyStatusSchema,
	ModelCatalogMappingSchema,
	ModelCatalogModelSchema,
	ModelCatalogVendorSchema,
	UpsertModelCatalogVendorApiKeySchema,
	UpsertModelCatalogMappingSchema,
	UpsertModelCatalogModelSchema,
	UpsertModelCatalogVendorSchema,
} from "./model-catalog.schemas";
import {
	deleteModelCatalogMapping,
	deleteModelCatalogModel,
	deleteModelCatalogVendor,
	clearModelCatalogVendorApiKey,
	importModelCatalogPackage,
	listModelCatalogMappings,
	listModelCatalogModels,
	listModelCatalogVendors,
	exportModelCatalogPackage,
	upsertModelCatalogVendorApiKey,
	upsertModelCatalogMapping,
	upsertModelCatalogModel,
	upsertModelCatalogVendor,
} from "./model-catalog.service";

export const modelCatalogRouter = new Hono<AppEnv>();

modelCatalogRouter.use("*", authMiddleware);

modelCatalogRouter.get("/export", async (c) => {
	const includeApiKeysRaw = c.req.query("includeApiKeys");
	const includeApiKeys =
		includeApiKeysRaw === "true" || includeApiKeysRaw === "1";
	const pkg = await exportModelCatalogPackage(c, { includeApiKeys });
	return c.json(pkg);
});

modelCatalogRouter.get("/vendors", async (c) => {
	const vendors = await listModelCatalogVendors(c);
	return c.json(vendors.map((v) => ModelCatalogVendorSchema.parse(v)));
});

modelCatalogRouter.post("/vendors", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelCatalogVendorSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const vendor = await upsertModelCatalogVendor(c, parsed.data);
	return c.json(ModelCatalogVendorSchema.parse(vendor));
});

modelCatalogRouter.delete("/vendors/:key", async (c) => {
	const key = c.req.param("key");
	await deleteModelCatalogVendor(c, key);
	return c.body(null, 204);
});

modelCatalogRouter.post("/vendors/:key/api-key", async (c) => {
	const vendorKey = c.req.param("key");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelCatalogVendorApiKeySchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const status = await upsertModelCatalogVendorApiKey(c, {
		vendorKey,
		...parsed.data,
	});
	return c.json(ModelCatalogVendorApiKeyStatusSchema.parse(status));
});

modelCatalogRouter.delete("/vendors/:key/api-key", async (c) => {
	const vendorKey = c.req.param("key");
	const status = await clearModelCatalogVendorApiKey(c, vendorKey);
	return c.json(
		ModelCatalogVendorApiKeyStatusSchema.parse({
			vendorKey: status.vendorKey || vendorKey,
			hasApiKey: false,
			enabled: false,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
	);
});

modelCatalogRouter.get("/models", async (c) => {
	const vendorKey = c.req.query("vendorKey") || undefined;
	const kind = c.req.query("kind") || undefined;
	const enabledRaw = c.req.query("enabled");
	const enabled =
		enabledRaw === "true"
			? true
			: enabledRaw === "false"
				? false
				: undefined;

	const items = await listModelCatalogModels(c, { vendorKey, kind, enabled });
	return c.json(items.map((m) => ModelCatalogModelSchema.parse(m)));
});

modelCatalogRouter.post("/models", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelCatalogModelSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const model = await upsertModelCatalogModel(c, parsed.data);
	return c.json(ModelCatalogModelSchema.parse(model));
});

modelCatalogRouter.delete("/models/:modelKey", async (c) => {
	const modelKey = c.req.param("modelKey");
	await deleteModelCatalogModel(c, modelKey);
	return c.body(null, 204);
});

modelCatalogRouter.get("/mappings", async (c) => {
	const vendorKey = c.req.query("vendorKey") || undefined;
	const taskKind = c.req.query("taskKind") || undefined;
	const enabledRaw = c.req.query("enabled");
	const enabled =
		enabledRaw === "true"
			? true
			: enabledRaw === "false"
				? false
				: undefined;

	const items = await listModelCatalogMappings(c, {
		vendorKey,
		taskKind,
		enabled,
	});
	return c.json(items.map((m) => ModelCatalogMappingSchema.parse(m)));
});

modelCatalogRouter.post("/mappings", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertModelCatalogMappingSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const mapping = await upsertModelCatalogMapping(c, parsed.data);
	return c.json(ModelCatalogMappingSchema.parse(mapping));
});

modelCatalogRouter.delete("/mappings/:id", async (c) => {
	const id = c.req.param("id");
	await deleteModelCatalogMapping(c, id);
	return c.body(null, 204);
});

modelCatalogRouter.post("/import", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ModelCatalogImportPackageSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await importModelCatalogPackage(c, parsed.data);
	return c.json(result);
});
