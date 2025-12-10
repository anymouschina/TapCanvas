import { convertToModelMessages, streamText, tool } from "ai";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import {
	createGoogleGenerativeAI,
	google,
} from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	ChatStreamRequestSchema,
	type ChatStreamRequest,
} from "./ai.schemas";
import { SYSTEM_PROMPT } from "../../../../api/src/ai/constants";
import {
	formatPromptSample,
	matchPromptSamples,
} from "../../../../api/src/ai/prompt-samples";
import { canvasToolSchemas } from "../../../../api/src/ai/tool-schemas";

type Provider = "openai" | "anthropic" | "google";
type ProviderVendor = "openai" | "anthropic" | "gemini";

type VendorContext = {
	baseUrl: string;
	apiKey: string;
};

type ProviderRow = {
	id: string;
	name: string;
	vendor: string;
	base_url: string | null;
	shared_base_url: number;
	owner_id: string;
	created_at: string;
	updated_at: string;
};

type TokenRow = {
	id: string;
	provider_id: string;
	label: string;
	secret_token: string;
	user_agent: string | null;
	user_id: string;
	enabled: number;
	shared: number;
	shared_failure_count: number;
	shared_last_failure_at: string | null;
	shared_disabled_until: string | null;
	created_at: string;
	updated_at: string;
};

type ProxyProviderRow = {
	id: string;
	owner_id: string;
	name: string;
	vendor: string;
	base_url: string | null;
	api_key: string | null;
	enabled: number;
	enabled_vendors: string | null;
	settings: string | null;
	created_at: string;
	updated_at: string;
};

type ChatProvider = "openai" | "anthropic" | "google";

type ChatRole = "system" | "user" | "assistant";

type ChatMessageDto = {
	role: ChatRole;
	content?: string;
	parts?: Array<any>;
	metadata?: Record<string, any>;
};

function normalizePart(part: any) {
	if (!part) return null;
	if (part.type === "item_reference") {
		return null;
	}
	if (part.type === "function_call_output") {
		const textPayload =
			typeof part.output === "string"
				? part.output
				: (() => {
						try {
							return JSON.stringify(part.output);
						} catch {
							return "";
						}
					})();
		return textPayload ? { type: "text", text: textPayload } : null;
	}
	if (part.type === "text" || part.type === "reasoning") {
		return {
			type: part.type,
			text: typeof part.text === "string" ? part.text : "",
		};
	}
	if (part.type === "step-start" || part.type === "step-end") {
		return { type: part.type };
	}
	if (part.type?.startsWith("tool-")) {
		const { providerMetadata, callProviderMetadata, ...rest } = part;
		return rest;
	}
	if (typeof part === "object") {
		const { providerMetadata, callProviderMetadata, ...rest } = part;
		return rest;
	}
	return null;
}

function mapToUiMessage(
	message: ChatMessageDto,
): { role: ChatRole; parts: any[]; metadata?: Record<string, any> } | null {
	const hasParts =
		Array.isArray((message as any)?.parts) &&
		(message as any).parts.length > 0;
	const fallbackText =
		typeof message.content === "string" ? message.content : "";
	const parts = hasParts
		? (message.parts as any[])
				.map((part) => normalizePart(part))
				.filter(Boolean)
		: [{ type: "text", text: fallbackText }];
	const metadata = (message as any)?.metadata;
	if (!parts.length) return null;
	return {
		role: (message.role || "user") as ChatRole,
		parts,
		...(metadata ? { metadata } : {}),
	};
}

function normalizeMessagesForModel(messages: any[]): any[] {
	if (!Array.isArray(messages) || !messages.length) return [];
	const filtered = (messages as ChatMessageDto[]).filter(
		(message): message is ChatMessageDto => {
			return !!message && typeof message.role === "string";
		},
	);
	if (!filtered.length) return [];
	const uiMessages = filtered
		.map((message) => mapToUiMessage(message))
		.filter(
			(msg): msg is NonNullable<ReturnType<typeof mapToUiMessage>> =>
				!!msg && msg.parts.length > 0,
		);
	return uiMessages;
}

function normalizeProvidedTools(tools: unknown): Record<string, any> | null {
	if (!tools) return null;
	if (
		typeof tools === "object" &&
		!Array.isArray(tools) &&
		Object.keys(tools as Record<string, any>).length > 0
	) {
		return tools as Record<string, any>;
	}
	return null;
}

const canvasToolsForClient: Record<string, any> = Object.fromEntries(
	Object.entries(canvasToolSchemas).map(([name, def]) => [
		name,
		tool({
			description: def.description,
			// 直接复用 apps/api 中定义的 Zod schema，
			// 让 AI SDK 自行转换为 JSON Schema，保持与 Nest 实现一致。
			inputSchema: def.inputSchema as any,
		}),
	]),
);

function resolveToolsForChat(input: ChatStreamRequest): Record<string, any> | undefined {
	const provided = normalizeProvidedTools((input as any).tools);
	if (provided) return provided;

	// 客户端执行：仅提供 schema，实际执行交给前端 functionHandlers
	if (input.clientToolExecution) {
		return canvasToolsForClient;
	}

	// 兜底：暂不在 Worker 上执行画布工具，只暴露 schema
	return canvasToolsForClient;
}

function composeSystemPromptFromContext(
	context?: any,
	latestUserText?: string,
): string {
	const pieces: string[] = [SYSTEM_PROMPT];

	if (context) {
		const summary = context.summary ? JSON.stringify(context.summary) : "";

		if (summary) {
			pieces.push(`当前画布概要：${summary}`);
		}
		pieces.push(
			"⚠️你已经获得上面的画布概要/节点列表，它们视为真实可见的画布状态；不要再声称自己无法看到画布或无法访问屏幕。",
		);

		if (Array.isArray(context.nodes) && context.nodes.length) {
			const preview = context.nodes.slice(0, 8).map((node: any, index: number) => {
				const label = node.label || node.data?.label || node.id;
				const kind = node.kind || node.data?.kind;
				return `${index + 1}. ${label} (${kind || node.type || "unknown"})`;
			});
			pieces.push(`节点示例：\n${preview.join("\n")}`);
		}

		if (Array.isArray(context.edges) && context.edges.length) {
			const preview = context.edges
				.slice(0, 6)
				.map((edge: any) => `${edge.source} -> ${edge.target}`);
			pieces.push(`连接示例：${preview.join(", ")}`);
		}

		if (Array.isArray(context.characters) && context.characters.length) {
			const preview = context.characters
				.slice(0, 6)
				.map((character: any, index: number) => {
					const name =
						character.label || character.username || character.nodeId;
					const username = character.username ? ` (@${character.username})` : "";
					const desc = character.description ? ` - ${character.description}` : "";
					return `${index + 1}. ${name}${username}${desc}`;
				});
			pieces.push(`角色资料：\n${preview.join("\n")}`);
		}

		if (Array.isArray(context.videoBindings) && context.videoBindings.length) {
			const preview = context.videoBindings
				.slice(0, 4)
				.map((binding: any, index: number) => {
					const chars =
						binding.characters
							?.map(
								(char: any) =>
									char.label || char.username || char.nodeId,
							)
							.join(", ") || "无角色引用";
					const promptSnippet = binding.promptPreview
						? ` | prompt: ${binding.promptPreview}`
						: "";
					const remix = binding.remixSourceLabel
						? ` | remix自: ${binding.remixSourceLabel}`
						: "";
					return `${index + 1}. ${
						binding.label || binding.nodeId
					} -> 角色: ${chars}${remix}${promptSnippet}`;
				});
			pieces.push(`镜头延续上下文：\n${preview.join("\n")}`);
		}

		if (
			(!context.videoBindings ||
				!Array.isArray(context.videoBindings) ||
				!context.videoBindings.length) &&
			Array.isArray(context.nodes) &&
			context.nodes.some((node: any) => node.kind === "image")
		) {
			pieces.push(
				"提示：当前仅存在图像节点供画风参考，除非用户要求剧情延续，否则不要强行复用图像中的人物或故事。",
			);
		}

		if (Array.isArray(context.timeline) && context.timeline.length) {
			const summaryTimeline = context.timeline
				.slice(0, 5)
				.map((entry: any, index: number) => {
					const chars = entry.characters
						?.map(
							(c: any) =>
								c.label || c.username,
						)
						?.join(", ");
					const charText = chars ? ` | 角色: ${chars}` : "";
					return `${index + 1}. ${
						entry.label || entry.nodeId
					} (${entry.kind || "node"} - ${
						entry.status || "unknown"
					})${charText}`;
				});
			if (summaryTimeline.length) {
				pieces.push(`镜头时间线：\n${summaryTimeline.join("\n")}`);
			}
		}

		if (Array.isArray(context.pendingNodes) && context.pendingNodes.length) {
			const pendings = context.pendingNodes
				.map(
					(node: any) =>
						`${node.label || node.nodeId}(${node.kind || "node"}) -> ${
							node.status
						}`,
				)
				.join("；");
			pieces.push(`待处理节点：${pendings}`);
		}

		if (context.currentRun) {
			pieces.push(
				`当前有节点正在运行：${
					context.currentRun.label || context.currentRun.nodeId
				}（状态 ${context.currentRun.status}，进度 ${
					context.currentRun.progress ?? 0
				}%）。请优先关注其结果或异常，再决定是否继续新的生成。`,
			);
		}

		const existingVideos = context.nodes
			?.filter(
				(node: any) =>
					node.kind === "composeVideo" || node.kind === "video",
			)
			?.slice(0, 3)
			?.map(
				(node: any) =>
					`${node.label || node.id} (${node.status || "unknown"})`,
			);
		if (existingVideos && existingVideos.length) {
			pieces.push(
				`已有视频节点：${existingVideos.join(
					"、",
				)}。若用户要求续写，请读取这些节点的 prompt 与角色后再创作下一镜。`,
			);
		}

		const existingImages = context.nodes
			?.filter(
				(node: any) =>
					node.kind === "image" || node.kind === "textToImage",
			)
			?.slice(0, 3)
			?.map((node: any) => node.label || node.id);
		if (existingImages && existingImages.length) {
			pieces.push(
				`参考图像：${existingImages.join(
					"、",
				)}。若无特别说明，请沿用这些节点的画风/色彩。`,
			);
		}
	}

	if (latestUserText && typeof latestUserText === "string" && latestUserText.trim()) {
		const samples = matchPromptSamples(latestUserText, 3);
		if (samples.length) {
			const formatted = samples.map(formatPromptSample).join("\n\n");
			pieces.push(
				`提示词案例匹配（根据用户意图自动挑选）：\n${formatted}`,
			);
		}
	}

	return pieces.join("\n\n");
}

function inferProvider(input: ChatStreamRequest): ChatProvider {
	const raw = (input.provider || "").toLowerCase();
	if (raw === "openai" || raw === "anthropic" || raw === "google") {
		return raw as ChatProvider;
	}
	const model = (input.model || "").toLowerCase();
	if (model.includes("claude") || model.includes("glm")) return "anthropic";
	if (
		model.includes("gemini") ||
		model.includes("google") ||
		model.includes("nano-banana")
	) {
		return "google";
	}
	return "openai";
}

function normalizeOpenAIBaseUrl(
	input?: string | null,
): string | undefined {
	const envBase = input?.trim();
	if (!envBase) return undefined;
	let normalized = envBase.replace(/\/+$/, "");
	if (!/\/v\d+(?:\/|$)/i.test(normalized)) {
		normalized = `${normalized}/v1`;
	}
	return normalized;
}

function normalizeBaseUrl(raw: string | null | undefined): string {
	const val = (raw || "").trim();
	if (!val) return "";
	return val.replace(/\/+$/, "");
}

function normalizeChatBaseUrl(
	provider: ChatProvider,
	baseUrl?: string | null,
): string | undefined {
	const trimmed = baseUrl?.trim();
	if (!trimmed || trimmed.length === 0) {
		if (provider === "google") {
			return "https://generativelanguage.googleapis.com/v1beta";
		}
		return undefined;
	}

	let normalized = trimmed.replace(/\/+$/, "");

	if (provider === "anthropic" || provider === "openai") {
		const hasVersion = /\/v\d+($|\/)/i.test(normalized);
		if (!hasVersion) normalized = `${normalized}/v1`;
	}

	return normalized;
}

function buildChatModel(
	provider: ChatProvider,
	model: string,
	apiKey: string,
	baseUrl?: string | null,
) {
	const normalizedModel = model;
	const normalizedBaseUrl = normalizeChatBaseUrl(provider, baseUrl);

	const extraHeaders =
		provider === "anthropic"
			? {
					Authorization: `Bearer ${apiKey}`,
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
				}
			: undefined;

	const options = normalizedBaseUrl
		? ({
				apiKey,
				baseURL: normalizedBaseUrl,
				...(extraHeaders ? { headers: extraHeaders } : {}),
			} satisfies Parameters<typeof createOpenAI>[0])
		: ({
				apiKey,
				...(extraHeaders ? { headers: extraHeaders } : {}),
			} satisfies Parameters<typeof createOpenAI>[0]);

	switch (provider) {
		case "openai": {
			const client = createOpenAI(options);
			return client(normalizedModel);
		}
		case "anthropic": {
			const client = createAnthropic(options);
			return client(normalizedModel);
		}
		case "google":
		default: {
			const client = createGoogleGenerativeAI(options);
			return client(normalizedModel);
		}
	}
}

async function resolveProxyForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
): Promise<ProxyProviderRow | null> {
	const v = vendor.toLowerCase();

	// 1) Direct match on vendor (legacy)
	const directRes = await c.env.DB.prepare(
		`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND vendor = ? AND enabled = 1`,
	)
		.bind(userId, v)
		.all<ProxyProviderRow>();
	const direct = directRes.results || [];

	// 2) Match via enabled_vendors JSON (recommended)
	const viaEnabledRes = await c.env.DB.prepare(
		`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND enabled = 1
       AND enabled_vendors IS NOT NULL
       AND enabled_vendors LIKE ?`,
	)
		.bind(userId, `%"${v}"%`)
		.all<ProxyProviderRow>();
	const viaEnabled = viaEnabledRes.results || [];

	const all: ProxyProviderRow[] = [];
	for (const row of direct) {
		all.push(row);
	}
	for (const row of viaEnabled) {
		if (!all.find((r) => r.id === row.id)) {
			all.push(row);
		}
	}
	if (!all.length) return null;

	// Prefer GRSAI proxy when available
	const preferred =
		all.find((row) => row.vendor === "grsai") ||
		all[0];
	return preferred;
}

async function resolveVendorContextForChat(
	c: AppContext,
	userId: string,
	vendor: ProviderVendor,
): Promise<VendorContext> {
	const v = vendor.toLowerCase();

	const proxy = await resolveProxyForVendor(c, userId, v);

	if (proxy && proxy.enabled === 1) {
		const baseUrl = normalizeBaseUrl(proxy.base_url);
		const apiKey = (proxy.api_key || "").trim();
		if (!baseUrl || !apiKey) {
			throw new AppError("Proxy for vendor is misconfigured", {
				status: 400,
				code: "proxy_misconfigured",
			});
		}
		return { baseUrl, apiKey };
	}

	const providersRes = await c.env.DB.prepare(
		`SELECT * FROM model_providers WHERE owner_id = ? AND vendor = ? ORDER BY created_at ASC`,
	)
		.bind(userId, v)
		.all<ProviderRow>();
	const providers = providersRes.results || [];

	if (!providers.length) {
		throw new AppError(`No provider configured for vendor ${v}`, {
			status: 400,
			code: "provider_not_configured",
		});
	}

	const provider = providers[0];

	const ownedRows = await c.env.DB.prepare(
		`SELECT * FROM model_tokens
     WHERE provider_id = ? AND user_id = ? AND enabled = 1
     ORDER BY created_at ASC LIMIT 1`,
	)
		.bind(provider.id, userId)
		.all<TokenRow>();
	let token: TokenRow | null = (ownedRows.results || [])[0] ?? null;

	if (!token) {
		const nowIso = new Date().toISOString();
		const sharedRows = await c.env.DB.prepare(
			`SELECT * FROM model_tokens
       WHERE provider_id = ? AND shared = 1 AND enabled = 1
         AND (shared_disabled_until IS NULL OR shared_disabled_until < ?)
       ORDER BY updated_at ASC LIMIT 1`,
		)
			.bind(provider.id, nowIso)
			.all<TokenRow>();
		token = (sharedRows.results || [])[0] ?? null;
	}

	const apiKey = (token?.secret_token || "").trim();
	if (!apiKey) {
		throw new AppError(`No API key configured for vendor ${v}`, {
			status: 400,
			code: "api_key_missing",
		});
	}

	const baseUrl = normalizeBaseUrl(
		provider.base_url ||
			(await (async () => {
				const row = await c.env.DB.prepare(
					`SELECT base_url FROM model_providers
           WHERE vendor = ? AND shared_base_url = 1 AND base_url IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1`,
				)
					.bind(v)
					.first<{ base_url: string | null }>();
				return row?.base_url ?? null;
			})()) ||
			"",
	);

	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}

	return { baseUrl, apiKey };
}

export async function handleChatStream(
	c: AppContext,
	userId: string,
): Promise<Response> {
	const raw = (await c.req.json().catch(() => null)) as unknown;
	if (!raw || typeof raw !== "object") {
		throw new AppError("Invalid chat request body", {
			status: 400,
			code: "invalid_chat_request",
		});
	}

	const parsed = ChatStreamRequestSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("Invalid chat request body", {
			status: 400,
			code: "invalid_chat_request",
			details: parsed.error.issues,
		});
	}

	const input = parsed.data;

	const provider = inferProvider(input);
	const vendorForDb: ProviderVendor =
		provider === "google" ? "gemini" : provider;

	const explicitApiKey = (input.apiKey || "").trim();
	const explicitBaseUrl = (input.baseUrl || "").trim();

	let baseUrl = explicitBaseUrl;
	let apiKey = explicitApiKey;

	if (!apiKey) {
		const ctx = await resolveVendorContextForChat(
			c,
			userId,
			vendorForDb,
		);
		baseUrl = baseUrl || ctx.baseUrl;
		apiKey = ctx.apiKey.trim();
	}

	if (!apiKey) {
		throw new AppError("API key missing for provider", {
			status: 400,
			code: "api_key_missing",
		});
	}

	const modelName = input.model;

	// --- Minimal chat session persistence: chat_sessions (no messages yet) ---
	const nowIso = new Date().toISOString();
	const sessionIdRaw =
		(typeof input.sessionId === "string" && input.sessionId.trim()) ||
		null;
	const sessionKey = sessionIdRaw || "default";

	try {
		const existing = await c.env.DB.prepare(
			`SELECT id FROM chat_sessions WHERE user_id = ? AND session_id = ? LIMIT 1`,
		)
			.bind(userId, sessionKey)
			.first<{ id: string }>();

		if (existing?.id) {
			await c.env.DB.prepare(
				`UPDATE chat_sessions
         SET model = ?, provider = ?, updated_at = ?
         WHERE id = ?`,
			)
				.bind(modelName, vendorForDb, nowIso, existing.id)
				.run();
		} else {
			const id = crypto.randomUUID();
			await c.env.DB.prepare(
				`INSERT INTO chat_sessions
         (id, user_id, session_id, title, model, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
				.bind(
					id,
					userId,
					sessionKey,
					null,
					modelName,
					vendorForDb,
					nowIso,
					nowIso,
				)
				.run();
		}
	} catch (err) {
		console.warn("[ai/chat] persist session failed", {
			userId,
			sessionKey,
			error:
				err && typeof err === "object" && "message" in err
					? (err as any).message
					: String(err),
		});
	}

	const toolsValue = resolveToolsForChat(input) || undefined;

	if (!Array.isArray(input.messages) || input.messages.length === 0) {
		throw new AppError("Invalid chat request body: messages is empty", {
			status: 400,
			code: "invalid_chat_request",
		});
	}

	const uiMessages = normalizeMessagesForModel(input.messages);
	// Convert cleaned UIMessage[] → ModelMessage[] as required by streamText
	const modelMessages = convertToModelMessages(uiMessages as any, {
		tools: toolsValue,
	});

	const providerOptions =
		provider === "openai"
			? {
					openai: {
						store: true,
					},
				}
			: undefined;

	const lastUserText =
		(Array.isArray(input.messages) && input.messages.length
			? (() => {
					const reversed = [...input.messages].reverse();
					const lastUser = reversed.find(
						(msg: any) => msg && msg.role === "user",
					);
					const target = (lastUser || input.messages[input.messages.length - 1]) as any;
					if (typeof target?.content === "string" && target.content.trim()) {
						return target.content.trim();
					}
					if (Array.isArray(target?.parts)) {
						const texts = (target.parts as any[])
							.map((part) =>
								typeof part?.text === "string" ? part.text : "",
							)
							.filter(Boolean);
						if (texts.length) return texts.join("\n");
					}
					return undefined;
				})()
			: undefined);

	const systemPrompt = composeSystemPromptFromContext(
		input.context,
		lastUserText,
	);

	const result = await streamText({
		model: buildChatModel(provider, modelName, apiKey, baseUrl || undefined),
		system: systemPrompt,
		messages: modelMessages,
		tools: toolsValue,
		providerOptions,
		maxToolRoundtrips: input.maxToolRoundtrips ?? 3,
		temperature:
			typeof input.temperature === "number" ? input.temperature : 0.7,
	});

	// Vercel AI SDK v5: emit UI message SSE stream compatible with DefaultChatTransport
	return result.toUIMessageStreamResponse();
}
