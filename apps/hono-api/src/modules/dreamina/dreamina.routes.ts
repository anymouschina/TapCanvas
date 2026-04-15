import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	DreaminaAccountProbeSchema,
	DreaminaAccountSchema,
	DreaminaImportLoginSchema,
	DreaminaProjectBindingSchema,
	UpsertDreaminaAccountSchema,
	UpsertDreaminaProjectBindingSchema,
} from "./dreamina.schemas";
import {
	deleteDreaminaAccount,
	deleteDreaminaProjectBinding,
	getDreaminaProjectBinding,
	importDreaminaLoginResponse,
	listDreaminaAccounts,
	probeDreaminaAccount,
	upsertDreaminaAccount,
	upsertDreaminaProjectBinding,
} from "./dreamina.service";

export const dreaminaRouter = new Hono<AppEnv>();

dreaminaRouter.use("*", authMiddleware);

dreaminaRouter.get("/accounts", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const accounts = await listDreaminaAccounts(c, userId);
	return c.json(DreaminaAccountSchema.array().parse(accounts));
});

dreaminaRouter.post("/accounts", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertDreaminaAccountSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const account = await upsertDreaminaAccount(c, userId, parsed.data);
	return c.json(DreaminaAccountSchema.parse(account));
});

dreaminaRouter.delete("/accounts/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	await deleteDreaminaAccount(c, userId, c.req.param("id"));
	return c.body(null, 204);
});

dreaminaRouter.post("/accounts/:id/probe", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const result = await probeDreaminaAccount(c, userId, c.req.param("id"));
	return c.json(DreaminaAccountProbeSchema.parse(result));
});

dreaminaRouter.post("/accounts/:id/import-login", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = DreaminaImportLoginSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await importDreaminaLoginResponse(
		c,
		userId,
		c.req.param("id"),
		parsed.data.loginResponseJson,
	);
	return c.json(DreaminaAccountProbeSchema.parse(result));
});

dreaminaRouter.get("/projects/:projectId/binding", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const binding = await getDreaminaProjectBinding(c, userId, c.req.param("projectId"));
	if (!binding) return c.json(null);
	return c.json(DreaminaProjectBindingSchema.parse(binding));
});

dreaminaRouter.put("/projects/:projectId/binding", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertDreaminaProjectBindingSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const binding = await upsertDreaminaProjectBinding(
		c,
		userId,
		c.req.param("projectId"),
		parsed.data,
	);
	return c.json(DreaminaProjectBindingSchema.parse(binding));
});

dreaminaRouter.delete("/projects/:projectId/binding", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	await deleteDreaminaProjectBinding(c, userId, c.req.param("projectId"));
	return c.body(null, 204);
});
