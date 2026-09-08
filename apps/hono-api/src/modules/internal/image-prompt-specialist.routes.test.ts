import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv, WorkerEnv } from "../../types";
import { imagePromptInternalRouter } from "./image-prompt-specialist.routes";

const redisState = vi.hoisted(() => ({
	takeValue: "",
	clientBehaviors: [] as Array<"ready" | "fail-connect" | "wait-then-ready">,
}));

vi.mock("ioredis", () => ({
	default: class MemoryRedis {
		private readonly behavior = redisState.clientBehaviors.shift() ?? "ready";
		status = this.behavior === "ready" ? "ready" : "wait";
		on(): void {}
		async connect(): Promise<void> {
			if (this.behavior === "fail-connect") {
				this.status = "end";
				throw new Error("redis unavailable");
			}
			this.status = "ready";
		}
		async quit(): Promise<void> { this.status = "end"; }
		async get(): Promise<string | null> { return null; }
		async set(): Promise<"OK"> { return "OK"; }
		async eval(): Promise<string> { return redisState.takeValue; }
	},
}));

const RELAY_GRANT = "r".repeat(43);
const promptModel = {
	catalogRecordId: "record-1",
	modelKey: "gpt-5.5",
	configurationRevision: "2026-09-07T12:00:00.000Z",
	providerEndpointVersionId: "endpoint-1",
	providerCredentialVersionId: "credential-version-1",
};
const commercialContext = {
	generationTaskId: "task-1",
	billingOrderId: "order-1",
	quoteFingerprint: "a".repeat(64),
};
const requestBody = {
	model: promptModel.modelKey,
	messages: [
		{ role: "system", content: "Return strict JSON." },
		{ role: "user", content: "Create an image prompt." },
	],
	tools: [],
	stream: false,
	metadata: {
		schemaVersion: "image-prompt-relay-binding/v1",
		correlationId: "task-1",
		generationTaskId: "task-1",
		promptModel,
	},
};

function createApp() {
	const app = new Hono<AppEnv>();
	app.route("/internal/v1", imagePromptInternalRouter);
	return app;
}

function createEnvironment(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
	return {
		IMAGE_PROMPT_REDIS_URL: "redis://redis.internal:6379",
		IMAGE_PROMPT_HMAC_SERVICE_ID: "hmaigc-production",
		IMAGE_PROMPT_HMAC_SECRET: `inbound-${"a".repeat(32)}`,
		IMAGE_PROMPT_AGENTS_BASE_URL: "http://agents.internal:8799",
		IMAGE_PROMPT_AGENTS_TOKEN: `agents-${"b".repeat(32)}`,
		IMAGE_PROMPT_HMAIGC_RELAY_URL:
			"http://hmaigc.internal/internal/v1/model-relays/image-prompt/chat-completions",
		IMAGE_PROMPT_HMAIGC_RELAY_SERVICE_ID: "hono-image-prompt",
		IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET: `relay-${"c".repeat(32)}`,
		DB: {} as WorkerEnv["DB"],
		JWT_SECRET: "test-secret",
		...overrides,
	};
}

function relayRequest(body: unknown = requestBody, token = RELAY_GRANT): RequestInit {
	return {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("image prompt internal model relay route", () => {
	it("rejects an unauthenticated malformed body before exposing relay schema validation", async () => {
		const response = await createApp().request(
			"/internal/v1/agents/image-prompt-llm/chat/completions",
			{ method: "POST", headers: { "content-type": "application/json" }, body: "{" },
			createEnvironment(),
		);
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "specialist_auth_invalid" });
	});

	it("consumes the grant and signs exactly one HMaigc request", async () => {
		redisState.takeValue = JSON.stringify({
			schemaVersion: "image-prompt-relay-grant/v1",
			correlationId: "task-1",
			generationTaskId: "task-1",
			commercialContext,
			promptModel,
			expiresAt: new Date(Date.now() + 120_000).toISOString(),
		});
		const fetchCalls: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];
		const fetchMock: typeof fetch = async (url, init) => {
			fetchCalls.push({ input: url, init });
			expect(String(url)).toBe(
				"http://hmaigc.internal/internal/v1/model-relays/image-prompt/chat-completions",
			);
			expect(new Headers(init?.headers).get("x-tapcanvas-signature")).toMatch(/^v1=[a-f0-9]{64}$/);
			expect(JSON.parse(String(init?.body))).toMatchObject({ commercialContext, promptModel });
			return new Response(
				JSON.stringify({
					schemaVersion: "image-prompt-model-relay-response/v1",
					text: "{\"imagePrompt\":\"prompt\"}",
					effectiveModel: promptModel.modelKey,
					providerRequestId: "provider-request-1",
					usage: { inputTokens: 10, cachedTokens: 2, outputTokens: 4, totalTokens: 14 },
				}),
				{ status: 200 },
			);
		};
		vi.stubGlobal("fetch", fetchMock);

		const response = await createApp().request(
			"/internal/v1/agents/image-prompt-llm/chat/completions",
			relayRequest(),
			createEnvironment(),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: "provider-request-1",
			model: promptModel.modelKey,
			choices: [{ message: { content: "{\"imagePrompt\":\"prompt\"}" } }],
		});
		expect(fetchCalls).toHaveLength(1);
	});

	it("rejects invalid grants before HMaigc", async () => {
		let fetchWasCalled = false;
		const fetchMock: typeof fetch = async () => {
			fetchWasCalled = true;
			return new Response(null, { status: 500 });
		};
		vi.stubGlobal("fetch", fetchMock);
		const response = await createApp().request(
			"/internal/v1/agents/image-prompt-llm/chat/completions",
			relayRequest(requestBody, "invalid"),
			createEnvironment(),
		);
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "specialist_auth_invalid" });
		expect(fetchWasCalled).toBe(false);
	});

	it("rejects chunked oversized bodies before grant consumption", async () => {
		const response = await createApp().request(
			"/internal/v1/agents/image-prompt-llm/chat/completions",
			{ method: "POST", headers: { authorization: `Bearer ${RELAY_GRANT}` }, body: "x".repeat(1_000_001) },
			createEnvironment(),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			code: "specialist_request_invalid",
			reason: "internal request body is too large",
		});
	});
});

describe("image prompt specialist route authentication order", () => {
	it("recovers after Redis becomes available without restarting the Specialist", async () => {
		redisState.clientBehaviors.push("fail-connect", "wait-then-ready");
		const environment = createEnvironment({
			IMAGE_PROMPT_REDIS_URL: "redis://redis-recovery.internal:6379",
		});
		const request = {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		};

		const unavailable = await createApp().request(
			"/internal/v1/specialists/image-prompt",
			request,
			environment,
		);
		expect(unavailable.status).toBe(503);

		const recovered = await createApp().request(
			"/internal/v1/specialists/image-prompt",
			request,
			environment,
		);
		expect(recovered.status).toBe(401);
		expect(await recovered.json()).toMatchObject({ code: "specialist_auth_invalid" });
	});

	it("rejects an unauthenticated malformed body before exposing JSON validation", async () => {
		const response = await createApp().request(
			"/internal/v1/specialists/image-prompt",
			{ method: "POST", headers: { "content-type": "application/json" }, body: "{" },
			createEnvironment(),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			code: "specialist_auth_invalid",
		});
	});
});
