import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { apiKeyAuthMiddleware } from "./apiKey.middleware";
import {
	ApiKeySchema,
	CreateApiKeyRequestSchema,
	CreateApiKeyResponseSchema,
	UpdateApiKeyRequestSchema,
	PublicChatRequestSchema,
	PublicChatResponseSchema,
} from "./apiKey.schemas";
import { createApiKey, deleteApiKey, listApiKeys, updateApiKey } from "./apiKey.service";
import { runGenericTaskForVendor } from "../task/task.service";

export const apiKeyRouter = new Hono<AppEnv>();
export const publicApiRouter = new Hono<AppEnv>();

// ---- Management (dashboard) ----

apiKeyRouter.use("*", authMiddleware);

apiKeyRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const keys = await listApiKeys(c, userId);
	return c.json(ApiKeySchema.array().parse(keys));
});

apiKeyRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateApiKeyRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await createApiKey(c, userId, parsed.data);
	return c.json(CreateApiKeyResponseSchema.parse(result));
});

apiKeyRouter.patch("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateApiKeyRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await updateApiKey(c, userId, id, parsed.data);
	return c.json(ApiKeySchema.parse(result));
});

apiKeyRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteApiKey(c, userId, id);
	return c.body(null, 204);
});

// ---- Public (API key + Origin allowlist) ----

publicApiRouter.use("*", apiKeyAuthMiddleware);

publicApiRouter.post("/chat", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PublicChatRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const vendor = (parsed.data.vendor || "openai").trim().toLowerCase();
	const prompt = parsed.data.prompt;
	const systemPrompt =
		(typeof parsed.data.systemPrompt === "string" &&
			parsed.data.systemPrompt.trim()) ||
		"请用中文回答。";

	const req = {
		kind: "chat" as const,
		prompt,
		extras: {
			systemPrompt,
			...(typeof parsed.data.modelKey === "string" &&
			parsed.data.modelKey.trim()
				? { modelKey: parsed.data.modelKey.trim() }
				: {}),
			...(typeof parsed.data.temperature === "number"
				? { temperature: parsed.data.temperature }
				: {}),
		},
	};

	const result = await runGenericTaskForVendor(c, userId, vendor, req);
	const raw: any = result?.raw as any;
	const text = typeof raw?.text === "string" ? raw.text : "";

	return c.json(
		PublicChatResponseSchema.parse({
			id: result.id,
			vendor,
			text,
		}),
	);
});

