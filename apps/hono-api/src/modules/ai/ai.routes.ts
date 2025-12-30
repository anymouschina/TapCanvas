import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../types";
import { authMiddleware, resolveAuth } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import {
	PromptSampleSchema,
	PromptSampleInputSchema,
	PromptSampleParseRequestSchema,
} from "./ai.schemas";
import {
	createPromptSample,
	deletePromptSample,
	listPromptSamples,
	parsePromptSample,
} from "./ai.service";
import {
	ChatSubmitMessagesRequestSchema,
	ChatUpdateMessageRequestSchema,
} from "./chat.schemas";
import {
	deleteChatSessionByExternalId,
	getChatSessionByExternalId,
	insertChatMessage,
	listChatMessagesForSession,
	listChatSessionsForUser,
	renameChatSessionByExternalId,
	upsertChatMessageRaw,
	upsertChatSessionByExternalId,
} from "./chat.repo";
import {
	clearLangGraphThreadForProject,
	getLangGraphThreadIdForProject,
	clearLangGraphSnapshotForProject,
	getLangGraphSnapshotForProject,
	getLangGraphSnapshotForPublicProject,
	setLangGraphThreadIdForProject,
	upsertLangGraphSnapshotForProject,
} from "./ai.langgraph";

export const aiRouter = new Hono<AppEnv>();

function parseContinuePayloadFromMessage(text: string): any | null {
	const input = typeof text === "string" ? text : String(text ?? "");
	if (!input) return null;

	const fenceStart = input.indexOf("```hide");
	if (fenceStart === -1) return null;
	const payloadStart = input.indexOf("\n", fenceStart);
	if (payloadStart === -1) return null;
	const fenceEnd = input.indexOf("```", payloadStart + 1);
	if (fenceEnd === -1) return null;

	const body = input.slice(payloadStart + 1, fenceEnd).replace(/\r/g, "");
	const lines = body.split("\n").map((l) => l.trimEnd());
	const idx = lines.findIndex((l) => l.trim() === "CONTINUE");
	if (idx === -1) return null;
	const jsonText = lines.slice(idx + 1).join("\n").trim();
	if (!jsonText) return {};
	try {
		return JSON.parse(jsonText);
	} catch {
		return null;
	}
}

function buildSelectFilmMetaPrompt(): string {
	return (
		"请填写影片的基础信息，这将帮助我们更好地理解你的需求。\n" +
		"```selectFilmMeta\n" +
		JSON.stringify({
			options: [
				{ intention: "CONTINUE", title: "影片时长类型", value: "filmDurationType" },
				{ intention: "CONTINUE", title: "影片宽高比", value: "filmAspectRatio" },
			],
		}) +
		"\n```\n" +
		"没找到合适的选项？你如果有其他想法，可以直接在下方输入框中输入。"
	);
}

function buildSelectFilmEmotionPrompt(options: string[]): string {
	const cleaned = Array.from(
		new Set((options || []).map((x) => String(x || "").trim()).filter(Boolean)),
	).slice(0, 12);
	const opts = cleaned.map((o) => ({ title: o, value: o }));
	return (
		"请选择一种情绪关键词：\n" +
		"```selectFilmEmotionKeyword\n" +
		JSON.stringify({ options: opts }) +
		"\n```\n" +
		"没找到合适的选项？你如果有其他想法，可以直接在下方输入框中输入。"
	);
}

function decideNextAssistantMessage(input: {
	humanMessages: string[];
}): { content: string; done?: boolean } {
	const lastHuman = input.humanMessages.length
		? input.humanMessages[input.humanMessages.length - 1]
		: "";
	const continuePayload = parseContinuePayloadFromMessage(lastHuman);

	const collected: {
		filmMeta?: { aspectRatio?: string; duration?: string };
		emotionKeyword?: string;
	} = {};

	for (const msg of input.humanMessages) {
		const payload = parseContinuePayloadFromMessage(msg);
		if (!payload || typeof payload !== "object") continue;
		if (payload.questionType === "selectFilmMeta") {
			const fm = (payload as any).filmMeta;
			if (fm && typeof fm === "object") {
				collected.filmMeta = {
					aspectRatio:
						typeof fm.aspectRatio === "string" ? fm.aspectRatio : undefined,
					duration:
						typeof fm.duration === "string" ? fm.duration : undefined,
				};
			}
		}
		if (payload.questionType === "selectFilmEmotionKeyword") {
			const v = (payload as any).value;
			if (typeof v === "string" && v.trim()) {
				collected.emotionKeyword = v.trim();
			}
		}
	}

	const hasFilmMeta =
		!!collected.filmMeta?.aspectRatio && !!collected.filmMeta?.duration;
	if (!hasFilmMeta) {
		return { content: buildSelectFilmMetaPrompt() };
	}

	if (!collected.emotionKeyword) {
		// Minimal built-in candidate list (can be replaced by a model call later).
		const defaultOptions = ["诡秘", "压迫感", "力量", "次元", "青春"];
		return { content: buildSelectFilmEmotionPrompt(defaultOptions) };
	}

	return {
		content:
			`已收到：\n- 宽高比：${collected.filmMeta?.aspectRatio}\n- 时长：${collected.filmMeta?.duration}\n- 情绪：${collected.emotionKeyword}\n\n下一步：我会基于这些信息帮你搭建故事短片的大纲与分镜方向。`,
		done: true,
	};
}

// ---- LangGraph durable chat snapshot (per project) ----
// Public read: allow unauthenticated access for public projects.
aiRouter.get("/langgraph/projects/:projectId/snapshot", async (c) => {
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}

	const auth = await resolveAuth(c);
	const userId = auth?.payload?.sub || null;

	if (userId) {
		try {
			const snapshot = await getLangGraphSnapshotForProject(c, userId, projectId);
			return c.json({ snapshot });
		} catch (err) {
			if (!(err instanceof AppError) || err.code !== "project_not_found") {
				throw err;
			}
		}
	}

	const snapshot = await getLangGraphSnapshotForPublicProject(c, projectId);
	return c.json({ snapshot });
});

aiRouter.use("*", authMiddleware);

// ---- SmallT chat (server-side orchestration; SSE) ----

aiRouter.post("/chat/submit_messages", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ChatSubmitMessagesRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const nowIso = new Date().toISOString();
	const conversationId = parsed.data.conversation.data.id.trim();
	const session = await upsertChatSessionByExternalId(c.env.DB, userId, conversationId, {
		nowIso,
		title: typeof parsed.data.workspace?.name === "string" ? parsed.data.workspace.name : null,
	});

	// Persist incoming human messages.
	for (const m of parsed.data.messages || []) {
		const content =
			typeof (m as any)?.data?.content === "string"
				? ((m as any).data.content as string)
				: null;
		const id =
			typeof (m as any)?.data?.id === "string" && (m as any).data.id.trim()
				? (m as any).data.id.trim()
				: crypto.randomUUID();
		const role = m.type === "ai" ? "assistant" : "user";
		await insertChatMessage(c.env.DB, session.id, {
			id,
			role,
			content,
			raw: m,
			nowIso,
		});
	}

	// Decide next assistant message based on all human messages so far.
	const history = await listChatMessagesForSession(c.env.DB, session.id, 400);
	const humanMessages = history
		.filter((x) => x.role === "user" && typeof x.content === "string")
		.map((x) => x.content || "");
	const next = decideNextAssistantMessage({ humanMessages });
	const assistantMessageId = crypto.randomUUID();
	await insertChatMessage(c.env.DB, session.id, {
		id: assistantMessageId,
		role: "assistant",
		content: next.content,
		raw: {
			type: "ai",
			data: {
				id: assistantMessageId,
				content: next.content,
				additional_kwargs: { agentName: "小T" },
			},
		},
		nowIso,
	});

	let seq = 0;
	const nextId = () => `${Date.now()}-${seq++}`;

	return streamSSE(c, async (stream) => {
		const abortSignal = c.req.raw.signal as AbortSignal;
		let closed = false;
		abortSignal.addEventListener("abort", () => {
			closed = true;
		});

		const write = async (event: string, data: any) => {
			if (closed) return;
			await stream.writeSSE({
				event,
				data: JSON.stringify(data),
				id: nextId(),
			});
		};

		await write("workspace_operation", {
			id: crypto.randomUUID(),
			name: "submit_chat_messages_operation",
			params: {
				conversationId,
				messages: parsed.data.messages,
			},
		});

		await write("workspace_operation", {
			id: crypto.randomUUID(),
			name: "update_workspace_operation",
			params: { changes: { workspace: parsed.data.workspace ? [parsed.data.workspace] : [] } },
		});

		await write("message", { type: "conversation", data: { id: conversationId } });
		await write("message", {
			type: "ai",
			data: {
				id: assistantMessageId,
				content: "",
				additional_kwargs: { agentName: "小T" },
				tool_calls: [],
				invalid_tool_calls: [],
				response_metadata: {},
			},
		});

		// Mimic the "delta append args" style by streaming content chunks.
		const chunks = next.content.split(/\n{2,}/);
		for (const chunk of chunks) {
			await write("delta", {
				op: "append",
				path: "/data/content",
				value: chunk + "\n\n",
			});
		}

		await write("message", {
			type: "ai",
			data: {
				id: assistantMessageId,
				content: next.content,
				additional_kwargs: { agentName: "小T" },
				tool_calls: [],
				invalid_tool_calls: [],
				response_metadata: {},
			},
		});

		await write("message", {
			type: "conversation",
			data: { id: conversationId, status: "completed", completeReason: "stop" },
		});
	});
});

aiRouter.post("/chat/update_message", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ChatUpdateMessageRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const conversationId = parsed.data.conversation.data.id.trim();
	const session = await getChatSessionByExternalId(c.env.DB, userId, conversationId);
	if (!session) return c.json({ error: "Session not found" }, 404);

	await upsertChatMessageRaw(
		c.env.DB,
		session.id,
		parsed.data.messageId,
		parsed.data.kwargsUpdates,
	);
	return c.json({ ok: true });
});

// ---- Chat session management (used by apps/web) ----

aiRouter.get("/chat/sessions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const limit = Number(c.req.query("limit") || 50) || 50;
	const rows = await listChatSessionsForUser(c.env.DB, userId, limit);
	return c.json({
		sessions: rows.map((r) => ({
			id: r.session_id,
			title: r.title,
			model: r.model,
			provider: r.provider,
			lastMessage: (r as any).last_message ?? null,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		})),
	});
});

aiRouter.get("/chat/history", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const sessionId = (c.req.query("sessionId") || "").trim();
	if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
	const session = await getChatSessionByExternalId(c.env.DB, userId, sessionId);
	if (!session) return c.json({ session: null, messages: [] });
	const messages = await listChatMessagesForSession(c.env.DB, session.id, 400);
	return c.json({
		session: {
			id: session.session_id,
			title: session.title,
			model: session.model,
			provider: session.provider,
			createdAt: session.created_at,
			updatedAt: session.updated_at,
		},
		messages: messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			metadata: m.raw ? (() => {
				try {
					return JSON.parse(m.raw);
				} catch {
					return null;
				}
			})() : null,
			createdAt: m.created_at,
		})),
	});
});

aiRouter.patch("/chat/sessions/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const sessionId = (c.req.param("id") || "").trim();
	if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const title = typeof (body as any).title === "string" ? (body as any).title.trim() : "";
	if (!title) return c.json({ error: "title is required" }, 400);
	const nowIso = new Date().toISOString();
	const updated = await renameChatSessionByExternalId(c.env.DB, userId, sessionId, title, nowIso);
	if (!updated) return c.json({ error: "Session not found" }, 404);
	return c.json({
		id: updated.session_id,
		title: updated.title,
		model: updated.model,
		provider: updated.provider,
		lastMessage: null,
		createdAt: updated.created_at,
		updatedAt: updated.updated_at,
	});
});

aiRouter.delete("/chat/sessions/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const sessionId = (c.req.param("id") || "").trim();
	if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
	await deleteChatSessionByExternalId(c.env.DB, userId, sessionId);
	return c.body(null, 204);
});

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

// ---- LangGraph research assistant (single thread per project) ----

aiRouter.get("/langgraph/projects/:projectId/thread", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	const threadId = await getLangGraphThreadIdForProject(c, userId, projectId);
	return c.json({ threadId });
});

aiRouter.put("/langgraph/projects/:projectId/thread", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const threadId =
		typeof (body as any).threadId === "string" ? (body as any).threadId : "";
	const result = await setLangGraphThreadIdForProject(
		c,
		userId,
		projectId,
		threadId,
	);
	return c.json(result);
});

aiRouter.delete("/langgraph/projects/:projectId/thread", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	await clearLangGraphThreadForProject(c, userId, projectId);
	return c.body(null, 204);
});

aiRouter.put("/langgraph/projects/:projectId/snapshot", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const messagesJson =
		typeof (body as any).messagesJson === "string"
			? (body as any).messagesJson
			: "";
	const threadId =
		typeof (body as any).threadId === "string" ? (body as any).threadId : null;
	const result = await upsertLangGraphSnapshotForProject(c, userId, projectId, {
		threadId,
		messagesJson,
	});
	return c.json({ snapshot: result });
});

aiRouter.delete("/langgraph/projects/:projectId/snapshot", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	await clearLangGraphSnapshotForProject(c, userId, projectId);
	return c.body(null, 204);
});
