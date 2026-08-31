import type { AppContext } from "./types";

type MaybeRecord = Record<string, unknown>;

const DISABLE_VALUES = new Set(["0", "false", "no", "off"]);

const DEFAULT_BODY_LIMIT_BYTES = 16_384;
const MAX_BODY_LIMIT_BYTES = 512_000;

const SENSITIVE_QUERY_KEYS = new Set([
	"apikey",
	"api_key",
	"key",
	"token",
	"access_token",
	"refresh_token",
	"secret",
	"password",
	"client_secret",
]);

const SENSITIVE_JSON_KEYS = new Set([
	"apikey",
	"api_key",
	"key",
	"token",
	"access_token",
	"refresh_token",
	"secret",
	"password",
	"client_secret",
	"authorization",
	"cookie",
	"set-cookie",
	"secrettoken",
	"pairingcode",
	"environment",
	"sealedspec",
	"uploadurl",
	"sourceurl",
	"downloadurl",
	"videourl",
	"video_url",
]);

const SENSITIVE_HEADER_KEYS = new Set([
	"cookie",
	"set-cookie",
	"x-api-key",
	"x-internal-token",
	"x-agent-token",
	"x-auth-token",
	"x-access-token",
	"x-refresh-token",
	"proxy-authorization",
]);

function isExplicitlyDisabled(val: unknown): boolean {
	return DISABLE_VALUES.has(String(val ?? "").trim().toLowerCase());
}

function readDebugEnv(
	c: AppContext | null | undefined,
	key: "DEBUG_HTTP_LOG" | "DEBUG_HTTP_LOG_UNSAFE" | "DEBUG_HTTP_LOG_BODY_LIMIT",
): unknown {
	if (c && typeof c === "object" && "env" in c) {
		const env = (c as { env?: Record<string, unknown> }).env;
		if (env && typeof env === "object" && key in env) {
			return env[key];
		}
	}
	if (
		typeof globalThis === "object" &&
		globalThis &&
		"process" in globalThis &&
		globalThis.process &&
		typeof globalThis.process === "object" &&
		"env" in globalThis.process
	) {
		const processEnv = (globalThis.process as { env?: Record<string, unknown> }).env;
		if (processEnv && typeof processEnv === "object" && key in processEnv) {
			return processEnv[key];
		}
	}
	return undefined;
}

// Enabled by default in all environments; set DEBUG_HTTP_LOG=0 to disable.
export function isHttpDebugLogEnabled(c: AppContext): boolean {
	return !isExplicitlyDisabled(readDebugEnv(c, "DEBUG_HTTP_LOG"));
}

// Unsafe mode (no redaction) must be explicitly opted in; never defaults on.
export function isHttpDebugLogUnsafeEnabled(c: AppContext): boolean {
	const ENABLE_VALUES = new Set(["1", "true", "yes", "on"]);
	return ENABLE_VALUES.has(String(readDebugEnv(c, "DEBUG_HTTP_LOG_UNSAFE") ?? "").trim().toLowerCase());
}

export function getHttpDebugLogBodyLimit(c: AppContext): number {
	const raw = Number(readDebugEnv(c, "DEBUG_HTTP_LOG_BODY_LIMIT"));
	if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BODY_LIMIT_BYTES;
	return Math.max(0, Math.min(Math.floor(raw), MAX_BODY_LIMIT_BYTES));
}

function redactAuthorization(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return trimmed;
	const parts = trimmed.split(/\s+/, 2);
	if (parts.length === 2) return `${parts[0]} ***`;
	return "***";
}

function safeUrlForLog(c: AppContext | null, input: string): string {
	if (!c || isHttpDebugLogUnsafeEnabled(c)) return input;
	try {
		const parsed = new URL(input);
		for (const [k] of parsed.searchParams) {
			if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) {
				parsed.searchParams.set(k, "***");
			}
		}
		return parsed.toString();
	} catch {
		return input;
	}
}

function safeJsonForLog(c: AppContext | null, value: unknown): unknown {
	if (!c || isHttpDebugLogUnsafeEnabled(c)) return value;
	const seen = new WeakSet<object>();
	const walk = (v: any): any => {
		if (!v || typeof v !== "object") return v;
		if (seen.has(v)) return "[Circular]";
		seen.add(v);
		if (Array.isArray(v)) return v.map(walk);
		const out: Record<string, any> = {};
		for (const [key, val] of Object.entries(v)) {
			if (SENSITIVE_JSON_KEYS.has(key.toLowerCase())) {
				out[key] = "***";
				continue;
			}
			out[key] = walk(val);
		}
		return out;
	};
	return walk(value);
}

export function safeHeadersForLog(c: AppContext | null, headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of headers.entries()) {
		const lower = k.toLowerCase();
		if (!c || isHttpDebugLogUnsafeEnabled(c)) {
			out[k] = v;
			continue;
		}
		if (lower === "authorization") {
			out[k] = redactAuthorization(v);
			continue;
		}
		if (SENSITIVE_HEADER_KEYS.has(lower)) {
			out[k] = "***";
			continue;
		}
		out[k] = v;
	}
	return out;
}

async function readStreamTextSnippet(
	stream: ReadableStream<Uint8Array> | null,
	limitBytes: number,
): Promise<{ text: string; truncated: boolean } | null> {
	if (!stream || limitBytes <= 0) return null;
	// reader.cancel() on a tee'd ReadableStream deadlocks in Node.js v22 — the cancel promise
	// never resolves when the sibling branch has unconsumed buffered data.
	// Use releaseLock() instead: it is synchronous and does not block.
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	try {
		reader = stream.getReader();
		const decoder = new TextDecoder();
		let truncated = false;
		let total = 0;
		let text = "";

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;

			const remaining = limitBytes - total;
			if (remaining <= 0) {
				truncated = true;
				break;
			}

			const slice =
				value.byteLength > remaining ? value.subarray(0, remaining) : value;
			text += decoder.decode(slice, { stream: true });
			total += slice.byteLength;

			if (value.byteLength > remaining) {
				truncated = true;
				break;
			}
		}
		text += decoder.decode();
		return { text, truncated };
	} catch {
		return null;
	} finally {
		try {
			reader?.releaseLock();
		} catch {}
	}
}

function shouldAttemptBodyLogging(contentType: string | null): boolean {
	if (!contentType) return true;
	const lower = contentType.toLowerCase();
	if (lower.includes("text/event-stream")) return false;
	if (lower.startsWith("application/octet-stream")) return false;
	if (lower.startsWith("video/")) return false;
	if (lower.startsWith("image/")) return false;
	if (lower.startsWith("audio/")) return false;
	return true;
}

export async function readBodySnippetForLog(
	c: AppContext | null,
	message: Request | Response,
	limitBytes: number,
): Promise<
	| { body: unknown; truncated: boolean; contentType: string | null }
	| null
> {
	const ct = message.headers.get("content-type");
	if (!shouldAttemptBodyLogging(ct)) return null;
	let cloned: Request | Response;
	try {
		cloned = message.clone();
	} catch {
		return null;
	}
	const snippet = await readStreamTextSnippet(cloned.body, limitBytes);
	if (!snippet) return null;

	const text = snippet.text.trim();
	if (!text) {
		return { body: "", truncated: snippet.truncated, contentType: ct };
	}

	const looksJson =
		(ct && ct.toLowerCase().includes("application/json")) ||
		(text.startsWith("{") && text.endsWith("}")) ||
		(text.startsWith("[") && text.endsWith("]"));
	if (looksJson) {
		try {
			const parsed = JSON.parse(text);
			return {
				body: safeJsonForLog(c, parsed),
				truncated: snippet.truncated,
				contentType: ct,
			};
		} catch {
			// fallthrough to plain text
		}
	}

	return {
		body: !c || isHttpDebugLogUnsafeEnabled(c) ? text : safeJsonForLog(c, text),
		truncated: snippet.truncated,
		contentType: ct,
	};
}

function getOrCreateRequestId(c: AppContext): string {
	// Some callers pass a synthetic context ({ env } as never) that lacks .get/.set
	try {
		const existing = typeof c.get === "function"
			? (c.get("requestId") as string | undefined)
			: undefined;
		if (existing && existing.trim()) return existing.trim();
		const id = crypto.randomUUID
			? crypto.randomUUID()
			: `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
		if (typeof c.set === "function") c.set("requestId", id);
		return id;
	} catch {
		return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
	}
}

function emitLog(line: unknown) {
	try {
		console.log(JSON.stringify(line));
	} catch {
		console.log(String(line));
	}
}

export async function logDownstreamHttpTransaction(options: {
	c: AppContext;
	startedAt: number;
	requestBody?: { body: unknown; truncated: boolean; contentType: string | null } | null;
}) {
	const { c, startedAt } = options;
	if (!isHttpDebugLogEnabled(c)) return;

	const requestId = getOrCreateRequestId(c);
	const durationMs = Date.now() - startedAt;
	const req = c.req.raw;
	const res = c.res;

	// Do NOT read c.res.body here. In @hono/node-server the node HTTP adapter owns that
	// ReadableStream and is already piping it to the socket. Calling clone() tee()s the stream,
	// which blocks both sides until both readers drain — deadlocking the request.
	// Response status + headers are sufficient for downstream logging.
	emitLog({
		ts: new Date().toISOString(),
		type: "http_debug",
		scope: "downstream",
		requestId,
		method: req.method,
		url: safeUrlForLog(c, req.url),
		status: res?.status ?? null,
		durationMs,
		request: {
			headers: safeHeadersForLog(c, req.headers),
			body: options.requestBody?.body ?? null,
			bodyTruncated: options.requestBody?.truncated ?? false,
			contentType: options.requestBody?.contentType ?? req.headers.get("content-type"),
		},
		response: {
			headers: res ? safeHeadersForLog(c, res.headers) : {},
			body: null,
			bodyTruncated: false,
			contentType: res ? res.headers.get("content-type") : null,
		},
	});
}

export async function fetchWithHttpDebugLog(
	c: AppContext,
	input: RequestInfo | URL,
	init?: RequestInit,
	meta?: { tag?: string },
): Promise<Response> {
	if (!isHttpDebugLogEnabled(c)) {
		return fetch(input as any, init as any);
	}

	const requestId = getOrCreateRequestId(c);
	const startedAt = Date.now();
	const limit = getHttpDebugLogBodyLimit(c);

	let req: Request;
	try {
		req = input instanceof Request ? new Request(input, init) : new Request(input, init);
	} catch {
		req = input instanceof Request ? input : new Request(String(input), init);
	}

	const requestBody = await readBodySnippetForLog(c, req, limit).catch(() => null);

	let res: Response;
	let error: any = null;
	try {
		res = await fetch(req);
	} catch (err: any) {
		error = err;
		// status: 0 is rejected by Node.js (must be 200-599); use 502 as a placeholder for logging.
		// The real error is re-thrown at the bottom of this function.
		res = new Response(null, { status: 502 });
	}

	const durationMs = Date.now() - startedAt;
	const responseBody = res
		? await readBodySnippetForLog(c, res, limit).catch(() => null)
		: null;

	emitLog({
		ts: new Date().toISOString(),
		type: "http_debug",
		scope: "upstream",
		tag: meta?.tag || null,
		requestId,
		method: req.method,
		url: safeUrlForLog(c, req.url),
		status: res.status,
		durationMs,
		request: {
			headers: safeHeadersForLog(c, req.headers),
			body: requestBody?.body ?? null,
			bodyTruncated: requestBody?.truncated ?? false,
			contentType: requestBody?.contentType ?? req.headers.get("content-type"),
		},
		response: {
			headers: safeHeadersForLog(c, res.headers),
			body: responseBody?.body ?? null,
			bodyTruncated: responseBody?.truncated ?? false,
			contentType: responseBody?.contentType ?? res.headers.get("content-type"),
		},
		error: error
			? {
					message:
						typeof error?.message === "string"
							? error.message
							: String(error),
					stack:
						typeof error?.stack === "string" ? error.stack : undefined,
				}
			: null,
	});

	if (error) {
		throw error;
	}

	return res;
}
