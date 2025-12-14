import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	PromptSampleSchema,
	PromptSampleInputSchema,
	PromptSampleParseRequestSchema,
	ToolResultSchema,
	type ToolEventMessageDto,
} from "./ai.schemas";
import {
	addToolEventSubscriber,
	removeToolEventSubscriber,
	publishToolEvent,
	type ToolEventSubscriber,
} from "./tool-events.bus";
import {
	createPromptSample,
	deletePromptSample,
	listPromptSamples,
	parsePromptSample,
} from "./ai.service";
import {
	handleChatStream,
	listChatSessions,
	getChatHistory,
	updateChatSessionTitle,
	deleteChatSession,
} from "./ai.chat";
import { runOrchestrator, type OrchestratorRequest } from "./agent.orchestrator";

export const aiRouter = new Hono<AppEnv>();

aiRouter.use("*", authMiddleware);

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

// ---- Chat streaming (AI assistant) ----

aiRouter.post("/chat/stream", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	return handleChatStream(c, userId);
});

aiRouter.get("/chat/sessions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const result = await listChatSessions(c, userId);
	return c.json(result);
});

aiRouter.get("/chat/history", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const sessionId = (c.req.query("sessionId") || "").trim();
	if (!sessionId) {
		return c.json(
			{ error: "sessionId is required", code: "session_id_required" },
			400,
		);
	}
	const result = await getChatHistory(c, userId, sessionId);
	return c.json(result);
});

aiRouter.patch("/chat/sessions/:sessionId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const sessionId = c.req.param("sessionId") || "";
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const title =
		typeof (body as any).title === "string"
			? ((body as any).title as string)
			: "";
	const result = await updateChatSessionTitle(
		c,
		userId,
		sessionId,
		title,
	);
	return c.json(result);
});

aiRouter.delete("/chat/sessions/:sessionId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const sessionId = c.req.param("sessionId") || "";
	const result = await deleteChatSession(c, userId, sessionId);
	return c.json(result);
});

// ---- Tool events SSE + tool result reporting ----

aiRouter.get("/tool-events", (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	return streamSSE(c, async (stream) => {
		const queue: ToolEventMessageDto[] = [];
		let closed = false;

		const drainQueue = async () => {
			while (queue.length && !closed) {
				const event = queue.shift()!;
				await stream.writeSSE({
					data: JSON.stringify(event),
				});
			}
		};

		let notify: (() => void) | null = null;
		const waitForEvent = () =>
			new Promise<void>((resolve) => {
				notify = resolve;
			});

		const subscriber: ToolEventSubscriber = {
			push(event) {
				if (closed) return;
				queue.push(event);
				if (notify) {
					notify();
					notify = null;
				}
			},
		};

		addToolEventSubscriber(userId, subscriber);

		const abortSignal = c.req.raw.signal as AbortSignal;
		abortSignal.addEventListener("abort", () => {
			closed = true;
			if (notify) {
				notify();
				notify = null;
			}
		});

		try {
			// Initial comment to establish the stream
			await stream.writeSSE({ data: JSON.stringify({ type: "init" }) });

			while (!closed) {
				if (!queue.length) {
					await waitForEvent();
				}
				await drainQueue();
			}
		} finally {
			closed = true;
			removeToolEventSubscriber(userId, subscriber);
		}
	});
});

aiRouter.post("/tools/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ToolResultSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const payload = parsed.data;

	const event: ToolEventMessageDto = {
		type: "tool-result",
		toolCallId: payload.toolCallId,
		toolName: payload.toolName,
		output: payload.output,
		errorText: payload.errorText,
	};

	publishToolEvent(userId, event);

	return c.json({ success: true });
});

// ---- Lightweight QA/返工 orchestrator ----
aiRouter.post("/agent/continue", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	let parsed: OrchestratorRequest;
	try {
		parsed = (body || {}) as OrchestratorRequest;
		// Zod 校验在 runOrchestrator 内部
	} catch {
		return c.json({ error: "Invalid request body" }, 400);
	}

	const model =
		(typeof (body as any)?.model === "string" && (body as any).model.trim()) ||
		"gpt-5.2";
	const providerRaw =
		(typeof (body as any)?.provider === "string" && (body as any).provider) ||
		"openai";
	const provider =
		providerRaw === "anthropic"
			? "anthropic"
			: providerRaw === "google"
				? "google"
				: "openai";

	const apiKey =
		(typeof (body as any)?.apiKey === "string" && (body as any).apiKey.trim()) ||
		(c.env as any)?.OPENAI_API_KEY ||
		"";
	const baseUrl =
		typeof (body as any)?.baseUrl === "string" ? (body as any).baseUrl : null;

	if (!apiKey) {
		return c.json({ error: "API key missing" }, 400);
	}

	try {
		const result = await runOrchestrator(
			c,
			model,
			provider,
			apiKey,
			baseUrl,
			parsed,
		);
		return c.json(result);
	} catch (error) {
		console.error("[agent/continue] failed", error);
		return c.json({ error: "orchestrator_failed" }, 500);
	}
});
