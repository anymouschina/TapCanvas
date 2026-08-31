import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	ExecutionTraceWriteRequestSchema,
	MemoryContextRequestSchema,
	MemoryProjectChatArtifactSessionsRequestSchema,
	MemoryProjectSessionsRequestSchema,
	MemorySearchRequestSchema,
	MemoryWriteRequestSchema,
} from "./memory.schemas";
import {
	buildUserMemoryContext,
	formatMemoryContextForPrompt,
	formatMemoryContextSummary,
	listUserProjectChatArtifactSessions,
	listUserProjectChatSessions,
	searchUserMemoryEntries,
	writeUserExecutionTrace,
	writeUserMemoryEntries,
} from "./memory.service";

export const memoryRouter = new Hono<AppEnv>();

memoryRouter.use("*", authMiddleware);

memoryRouter.post("/context", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryContextRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const context = await buildUserMemoryContext(c, userId, parsed.data);
	return c.json({
		context,
		summaryText: formatMemoryContextSummary(context),
		promptText: formatMemoryContextForPrompt(context),
	});
});

memoryRouter.post("/write", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryWriteRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const ids = await writeUserMemoryEntries(c, userId, parsed.data);
	return c.json({ success: true, items: ids.map((id) => ({ id })) });
});

memoryRouter.post("/search", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemorySearchRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const items = await searchUserMemoryEntries(c, userId, parsed.data);
	return c.json({ items });
});

memoryRouter.post("/project-chat-artifacts", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryProjectChatArtifactSessionsRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const items = await listUserProjectChatArtifactSessions(c, userId, parsed.data);
	return c.json({ items });
});

memoryRouter.post("/project-sessions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MemoryProjectSessionsRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const items = await listUserProjectChatSessions(c, userId, parsed.data);
	return c.json({ items });
});

memoryRouter.post("/trace", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ExecutionTraceWriteRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await writeUserExecutionTrace(c, userId, parsed.data);
	if (result.status === "degraded") {
		return c.json({ success: false, item: result, error: "execution trace persistence failed" }, 503);
	}
	return c.json({ success: true, item: result });
});
