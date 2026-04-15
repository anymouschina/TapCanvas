import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateLlmNodePresetRequestSchema,
	LlmNodePresetSchema,
	PromptSampleInputSchema,
	PromptSampleParseRequestSchema,
	PromptSampleSchema,
	UpsertAdminLlmNodePresetRequestSchema,
} from "./ai.schemas";
import {
	createLlmNodePreset,
	createPromptSample,
	deleteAdminLlmNodePreset,
	deleteLlmNodePreset,
	deletePromptSample,
	listAdminLlmNodePresets,
	listLlmNodePresets,
	listPromptSamples,
	parsePromptSample,
	upsertAdminLlmNodePreset,
} from "./ai.service";

export const aiRouter = new Hono<AppEnv>();
export const adminAiRouter = new Hono<AppEnv>();

aiRouter.use("*", authMiddleware);
adminAiRouter.use("*", authMiddleware);

aiRouter.get("/prompt-samples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const q = c.req.query("q") || undefined;
	const nodeKind = c.req.query("nodeKind") || undefined;
	const source = c.req.query("source") || undefined;
	const result = await listPromptSamples(c, userId, { q, nodeKind, source });
	return c.json({
		samples: result.samples.map((s) => PromptSampleSchema.parse(s)),
	});
});

aiRouter.post("/prompt-samples/parse", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PromptSampleParseRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await parsePromptSample(c, userId, parsed.data);
	return c.json(PromptSampleInputSchema.parse(result));
});

aiRouter.post("/prompt-samples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const sample = await createPromptSample(c, userId, body);
	return c.json(PromptSampleSchema.parse(sample));
});

aiRouter.delete("/prompt-samples/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deletePromptSample(c, userId, id);
	return c.body(null, 204);
});

aiRouter.get("/node-presets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const q = c.req.query("q") || undefined;
	const type = c.req.query("type") || undefined;
	const items = await listLlmNodePresets(c, userId, { q, type });
	return c.json(items.map((item) => LlmNodePresetSchema.parse(item)));
});

aiRouter.post("/node-presets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateLlmNodePresetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const item = await createLlmNodePreset(c, userId, parsed.data);
	return c.json(LlmNodePresetSchema.parse(item));
});

aiRouter.delete("/node-presets/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteLlmNodePreset(c, userId, id);
	return c.body(null, 204);
});

adminAiRouter.get("/node-presets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const type = c.req.query("type") || undefined;
	const items = await listAdminLlmNodePresets(c, { type });
	return c.json(items.map((item) => LlmNodePresetSchema.parse(item)));
});

adminAiRouter.post("/node-presets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertAdminLlmNodePresetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const item = await upsertAdminLlmNodePreset(c, parsed.data);
	return c.json(LlmNodePresetSchema.parse(item));
});

adminAiRouter.delete("/node-presets/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteAdminLlmNodePreset(c, id);
	return c.body(null, 204);
});
