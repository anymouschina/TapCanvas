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
	createPromptSample,
	deletePromptSample,
	listPromptSamples,
	parsePromptSample,
} from "./ai.service";
import { handleChatStream } from "./ai.chat";

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

// ---- Tool events SSE + tool result reporting ----

type ToolEventSubscriber = {
	push: (event: ToolEventMessageDto) => void;
};

const toolEventSubscribers = new Map<string, Set<ToolEventSubscriber>>();

function addToolEventSubscriber(
	userId: string,
	subscriber: ToolEventSubscriber,
) {
	const existing = toolEventSubscribers.get(userId);
	if (existing) {
		existing.add(subscriber);
	} else {
		toolEventSubscribers.set(userId, new Set([subscriber]));
	}
}

function removeToolEventSubscriber(
	userId: string,
	subscriber: ToolEventSubscriber,
) {
	const existing = toolEventSubscribers.get(userId);
	if (!existing) return;
	existing.delete(subscriber);
	if (existing.size === 0) {
		toolEventSubscribers.delete(userId);
	}
}

function publishToolEvent(userId: string, event: ToolEventMessageDto) {
	const subscribers = toolEventSubscribers.get(userId);
	if (!subscribers || subscribers.size === 0) return;
	for (const sub of subscribers) {
		try {
			sub.push(event);
		} catch (err) {
			console.warn("[tool-events] subscriber push failed", err);
		}
	}
}

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
