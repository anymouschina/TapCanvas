import IORedis from "ioredis";
import { Hono } from "hono";

import type { AppEnv, WorkerEnv } from "../../types";
import {
	InternalImagePromptRelayFailure,
	relayGrantedImagePromptModelCall,
} from "./image-prompt-model-relay";
import {
	INTERNAL_SPECIALIST_AUTH_HEADERS,
	InternalRequestAuthFailure,
	createRedisInternalNonceStore,
	verifyInternalSpecialistRequest,
} from "./internal-request-auth";
import { createRedisImagePromptRelayGrantStore } from "./image-prompt-relay-grant";
import {
	createRedisImagePromptIdempotencyStore,
	requireImagePromptRedisUrl,
} from "./image-prompt-idempotency";
import {
	ImagePromptSpecialistGatewayFailure,
	executeImagePromptSpecialistGateway,
} from "./image-prompt-specialist.service";
import { createInternalAgentsImagePromptClient } from "./internal-agents-client";
import { createInternalHmaigcImagePromptModelClient } from "./internal-hmaigc-model-client";
import { requireImagePromptRuntimeConfig } from "./image-prompt-runtime-config";
import {
	parseImagePromptSpecialistRequest,
	type ImagePromptSpecialistErrorCode,
} from "./image-prompt-contract";

const MAX_INTERNAL_BODY_BYTES = 1_000_000;

let redisClient: IORedis | null = null;
let redisClientUrl = "";
let redisConnectionPromise: Promise<IORedis> | null = null;

async function requireReadyRedis(env: WorkerEnv): Promise<IORedis> {
	const url = requireImagePromptRedisUrl(env);
	if (redisClient && redisClientUrl === url && redisClient.status === "ready") {
		return redisClient;
	}
	if (redisConnectionPromise && redisClientUrl === url) {
		return redisConnectionPromise;
	}
	if (redisClient) void redisClient.quit().catch(() => undefined);
	const nextClient = new IORedis(url, {
			lazyConnect: true,
			enableAutoPipelining: true,
			enableOfflineQueue: false,
			maxRetriesPerRequest: 1,
			retryStrategy: () => null,
	});
	redisClient = nextClient;
	redisClientUrl = url;
	nextClient.on("error", (error) => {
			console.error("[internal/image-prompt] redis error", {
				reason: error instanceof Error ? error.message : String(error),
			});
	});
	const connection = (async () => {
		if (nextClient.status === "wait") await nextClient.connect();
		if (nextClient.status !== "ready") {
			throw new ImagePromptSpecialistGatewayFailure(
				"specialist_unavailable",
				"image prompt Redis is not ready",
			);
		}
		return nextClient;
	})();
	redisConnectionPromise = connection;
	try {
		return await connection;
	} catch (error) {
		if (redisClient === nextClient) {
			redisClient = null;
			redisClientUrl = "";
		}
		void nextClient.quit().catch(() => undefined);
		throw error;
	} finally {
		if (redisConnectionPromise === connection) redisConnectionPromise = null;
	}
}

function redisAdapters(client: IORedis) {
	const commands = {
		get: (key: string) => client.get(key),
		set: (
			key: string,
			value: string,
			expiryMode: "EX",
			ttlSeconds: number,
			condition: "NX",
		) => client.set(key, value, expiryMode, ttlSeconds, condition),
		eval: (script: string, numberOfKeys: number, ...args: string[]) =>
			client.eval(script, numberOfKeys, ...args),
	};
	return {
		nonceStore: createRedisInternalNonceStore(commands),
		idempotencyStore: createRedisImagePromptIdempotencyStore(commands),
		grantStore: createRedisImagePromptRelayGrantStore(commands),
	};
}

async function readBoundedBody(request: Request): Promise<string> {
	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > MAX_INTERNAL_BODY_BYTES) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_request_invalid",
			"internal request body is too large",
		);
	}
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		totalBytes += next.value.byteLength;
		if (totalBytes > MAX_INTERNAL_BODY_BYTES) {
			await reader.cancel("internal request body is too large").catch(() => undefined);
			throw new ImagePromptSpecialistGatewayFailure(
				"specialist_request_invalid",
				"internal request body is too large",
			);
		}
		chunks.push(next.value);
	}
	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseJson(body: string): unknown {
	try {
		return JSON.parse(body) as unknown;
	} catch {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_request_invalid",
			"internal request body is not valid JSON",
		);
	}
}

function statusForFailure(code: ImagePromptSpecialistErrorCode): 400 | 401 | 409 | 502 | 503 | 504 {
	if (code === "specialist_request_invalid" || code === "specialist_evidence_invalid") return 400;
	if (code === "specialist_auth_invalid") return 401;
	if (code === "specialist_replay_rejected" || code === "specialist_idempotency_conflict") return 409;
	if (code === "specialist_timeout") return 504;
	if (code === "specialist_unavailable") return 503;
	return 502;
}

function asGatewayFailure(error: unknown): ImagePromptSpecialistGatewayFailure {
	if (error instanceof ImagePromptSpecialistGatewayFailure) return error;
	if (error instanceof InternalRequestAuthFailure) {
		return new ImagePromptSpecialistGatewayFailure(error.code, error.message);
	}
	if (error instanceof InternalImagePromptRelayFailure) {
		return new ImagePromptSpecialistGatewayFailure(error.code, error.message);
	}
	return new ImagePromptSpecialistGatewayFailure(
		"specialist_unavailable",
		error instanceof Error ? error.message : String(error),
	);
}

function requestIdentity(value: unknown): { requestId?: string; correlationId?: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	return {
		...(typeof record.requestId === "string" ? { requestId: record.requestId.slice(0, 160) } : {}),
		...(typeof record.correlationId === "string"
			? { correlationId: record.correlationId.slice(0, 160) }
			: {}),
	};
}

export const imagePromptInternalRouter = new Hono<AppEnv>();

imagePromptInternalRouter.post("/specialists/image-prompt", async (c) => {
	let parsedBody: unknown = null;
	const startedAt = Date.now();
	try {
		const body = await readBoundedBody(c.req.raw);
		const runtimeConfig = requireImagePromptRuntimeConfig(c.env);
		const client = await requireReadyRedis(c.env);
		const adapters = redisAdapters(client);
		const headers: Record<string, string | undefined> = {};
		for (const name of Object.values(INTERNAL_SPECIALIST_AUTH_HEADERS)) {
			headers[name] = c.req.header(name);
		}
		const verifiedRequest = await verifyInternalSpecialistRequest({
			serviceId: runtimeConfig.inbound.serviceId,
			secret: runtimeConfig.inbound.hmacSecret,
			method: c.req.method,
			path: "/internal/v1/specialists/image-prompt",
			body,
			idempotencyKey:
				headers[INTERNAL_SPECIALIST_AUTH_HEADERS.idempotencyKey] ?? "",
			headers,
			nonceStore: adapters.nonceStore,
		});
		parsedBody = parseJson(body);
		const parsedRequest = parseImagePromptSpecialistRequest(parsedBody);
		if (!parsedRequest.ok) {
			throw new ImagePromptSpecialistGatewayFailure(
				"specialist_request_invalid",
				parsedRequest.error,
			);
		}
		const request = parsedRequest.value;
		if (request.idempotencyKey !== verifiedRequest.idempotencyKey) {
			throw new ImagePromptSpecialistGatewayFailure(
				"specialist_auth_invalid",
				"signed idempotency key does not match the request body",
			);
		}
		const agentsClient = createInternalAgentsImagePromptClient({
			baseUrl: runtimeConfig.agents.baseUrl,
			token: runtimeConfig.agents.token,
			timeoutMs: runtimeConfig.agents.timeoutMs,
		});
		const result = await executeImagePromptSpecialistGateway(
			request,
			{
				idempotencyStore: adapters.idempotencyStore,
				relayGrantStore: adapters.grantStore,
				executeAgentsSpecialist: (specialistRequest, relayGrant, signal) =>
					agentsClient.execute(specialistRequest, relayGrant, signal),
			},
			c.req.raw.signal,
		);
		console.log("[internal/image-prompt] completed", {
			requestId: request.requestId,
			correlationId: request.correlationId,
			model: result.response.trace.model.effectiveModel,
			totalTokens: result.response.trace.usage.totalTokens,
			replayed: result.replayed,
			elapsedMs: Date.now() - startedAt,
		});
		return c.json(result.response, 200, {
			"Cache-Control": "no-store",
			"X-TapCanvas-Response-Digest": result.responseDigest,
			"X-TapCanvas-Idempotency-Replayed": result.replayed ? "1" : "0",
		});
	} catch (error) {
		const failure = asGatewayFailure(error);
		const identity = requestIdentity(parsedBody);
		console.error("[internal/image-prompt] failed", {
			...identity,
			code: failure.code,
			elapsedMs: Date.now() - startedAt,
		});
		return c.json(
			{ code: failure.code, ...identity, reason: failure.message.slice(0, 500) },
			statusForFailure(failure.code),
			{ "Cache-Control": "no-store" },
		);
	}
});

imagePromptInternalRouter.post("/agents/image-prompt-llm/chat/completions", async (c) => {
	try {
		const runtimeConfig = requireImagePromptRuntimeConfig(c.env);
		const client = await requireReadyRedis(c.env);
		const adapters = redisAdapters(client);
		const body = await readBoundedBody(c.req.raw);
		const response = await relayGrantedImagePromptModelCall({
			authorization: c.req.header("authorization") ?? "",
			chatRequestBody: body,
			grantStore: adapters.grantStore,
			hmaigcClient: createInternalHmaigcImagePromptModelClient({
				url: runtimeConfig.hmaigcRelay.url,
				serviceId: runtimeConfig.hmaigcRelay.serviceId,
				secret: runtimeConfig.hmaigcRelay.hmacSecret,
			}),
			now: new Date(),
			abortSignal: c.req.raw.signal,
		});
		return c.json(response, 200, { "Cache-Control": "no-store" });
	} catch (error) {
		const failure = asGatewayFailure(error);
		return c.json(
			{ code: failure.code, reason: failure.message.slice(0, 500) },
			statusForFailure(failure.code),
			{ "Cache-Control": "no-store" },
		);
	}
});
