import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	ChatStreamRequestSchema,
	type ChatStreamRequest,
} from "./ai.schemas";

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

function inferProvider(input: ChatStreamRequest): Provider {
	const raw = (input.provider || "").toLowerCase();
	if (raw === "openai" || raw === "anthropic" || raw === "google") {
		return raw as Provider;
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

	let selectedModel;
	if (provider === "anthropic") {
		selectedModel = anthropic(modelName, {
			apiKey,
			baseURL: baseUrl || undefined,
		});
	} else if (provider === "google") {
		selectedModel = google(modelName, {
			apiKey,
			baseURL: baseUrl || undefined,
		});
	} else {
		selectedModel = openai(modelName, {
			apiKey,
			baseURL: normalizeOpenAIBaseUrl(baseUrl),
		});
	}

	const preparedMessages: any[] = [];

	// Allow optional top-level system prompt
	const system = (raw as any).system;
	if (typeof system === "string" && system.trim()) {
		preparedMessages.push({
			role: "system" as const,
			content: system.trim(),
		});
	}

	preparedMessages.push(...input.messages);

	const tools = (input as any).tools;
	const toolsValue =
		Array.isArray(tools) && tools.length > 0 ? tools : undefined;

	const result = await streamText({
		model: selectedModel,
		messages: preparedMessages,
		tools: toolsValue,
		maxToolRoundtrips: input.maxToolRoundtrips ?? 3,
		temperature:
			typeof input.temperature === "number" ? input.temperature : 0.7,
	});

	// Vercel AI SDK response compatible with DefaultChatTransport (SSE)
	return result.toAIStreamResponse();
}
