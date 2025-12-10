import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	FlowSchema,
	FlowVersionSchema,
	UpsertFlowSchema,
} from "./flow.schemas";
import {
	deleteUserFlow,
	getUserFlow,
	listUserFlows,
	listUserFlowVersions,
	rollbackUserFlow,
	upsertUserFlow,
} from "./flow.service";

export const flowRouter = new Hono<AppEnv>();

flowRouter.use("*", authMiddleware);

flowRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.query("projectId") || undefined;
	const flows = await listUserFlows(c, userId, projectId);
	return c.json(FlowSchema.array().parse(flows));
});

flowRouter.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const flow = await getUserFlow(c, id, userId);
	return c.json(FlowSchema.parse(flow));
});

flowRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertFlowSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const flow = await upsertUserFlow(c, userId, parsed.data);
	return c.json(FlowSchema.parse(flow));
});

flowRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteUserFlow(c, id, userId);
	return c.body(null, 204);
});

flowRouter.get("/:id/versions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const versions = await listUserFlowVersions(c, id, userId);
	return c.json(FlowVersionSchema.array().parse(versions));
});

flowRouter.post("/:id/rollback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const versionId = typeof body.versionId === "string" ? body.versionId : "";
	if (!versionId) {
		return c.json(
			{ error: "Invalid request body", issues: ["versionId is required"] },
			400,
		);
	}
	const flow = await rollbackUserFlow(c, id, versionId, userId);
	return c.json(FlowSchema.parse(flow));
});

