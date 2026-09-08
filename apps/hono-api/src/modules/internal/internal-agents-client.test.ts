import { describe, expect, it, vi } from "vitest";

import {
	InternalAgentsClientFailure,
	createInternalAgentsImagePromptClient,
} from "./internal-agents-client";
import type {
	ImagePromptSpecialistRequestV1,
	ImagePromptSpecialistResponseV1,
} from "./image-prompt-contract";

const SPECIALIST_TOKEN = "s".repeat(32);
const RELAY_GRANT = "g".repeat(43);

function request(): ImagePromptSpecialistRequestV1 {
	return {
		schemaVersion: "image-prompt-request/v1",
		requestId: "request-1",
		correlationId: "correlation-1",
		idempotencyKey: "image-prompt:task-1",
		actor: { tenantId: "tenant-1", userId: "user-1" },
		scope: { projectId: "project-1", canvasId: "canvas-1", nodeId: "node-1", nodeRevision: 1 },
		commercialContext: {
			generationTaskId: "task-1",
			billingOrderId: "order-1",
			quoteFingerprint: "b".repeat(64),
		},
		operation: { command: "portraitTexture", objective: "增强真实人像材质", parameters: {} },
		evidence: {
			references: [
				{
					resourceId: "resource-1",
					mediaType: "image",
					semanticRole: "source",
					ordinal: 1,
					contentDigest: "a".repeat(64),
					accessUrl: "https://media.example/source.png",
				},
			],
		},
		promptModel: {
			catalogRecordId: "new_api:gpt-5.6",
			modelKey: "gpt-5.6",
			configurationRevision: "2026-09-07T10:00:00.000Z",
			providerEndpointVersionId: "endpoint-version-1",
			providerCredentialVersionId: "credential-version-1",
		},
	};
}

function response(): ImagePromptSpecialistResponseV1 {
	const input = request();
	return {
		schemaVersion: "image-prompt/v1",
		imagePrompt: "严格参考图1，仅增强真实皮肤、发丝与材质细节。",
		trace: {
			requestId: input.requestId,
			correlationId: input.correlationId,
			specialist: "image_prompt_specialist",
			evidenceDigest: "b".repeat(64),
			model: { ...input.promptModel, effectiveModel: input.promptModel.modelKey },
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			startedAt: "2026-09-07T10:00:00.000Z",
			completedAt: "2026-09-07T10:00:01.000Z",
		},
	};
}

describe("internal agents image prompt client", () => {
	it("rejects a weak dedicated token before any request", () => {
		expect(() => createInternalAgentsImagePromptClient({
			baseUrl: "http://agents.internal:8799",
			token: "short-token",
			timeoutMs: 5_000,
		})).toThrow("at least 32 UTF-8 bytes");
	});

	it("uses the private endpoint and dedicated token", async () => {
		const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
			new Response(JSON.stringify(response()), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const client = createInternalAgentsImagePromptClient({
			baseUrl: "http://agents.internal:8799",
			token: SPECIALIST_TOKEN,
			timeoutMs: 5_000,
			fetchImpl,
		});

		await expect(client.execute(request(), RELAY_GRANT)).resolves.toEqual(response());
		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("http://agents.internal:8799/specialists/image-prompt");
		expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${SPECIALIST_TOKEN}`);
		expect(JSON.parse(String(init?.body))).toEqual({
			schemaVersion: "image-prompt-execution/v1",
			request: request(),
			relayGrant: RELAY_GRANT,
		});
	});

	it("rejects unknown response fields and preserves stable upstream codes", async () => {
		const invalidClient = createInternalAgentsImagePromptClient({
			baseUrl: "http://agents.internal:8799",
			token: SPECIALIST_TOKEN,
			timeoutMs: 5_000,
			fetchImpl: async () =>
				new Response(JSON.stringify({ ...response(), unexpected: true }), { status: 200 }),
		});
		await expect(invalidClient.execute(request(), RELAY_GRANT)).rejects.toMatchObject({
			code: "specialist_output_invalid",
		});

		const failedClient = createInternalAgentsImagePromptClient({
			baseUrl: "http://agents.internal:8799",
			token: SPECIALIST_TOKEN,
			timeoutMs: 5_000,
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						code: "specialist_model_inheritance_failed",
						reason: "effective model mismatch",
					}),
					{ status: 502 },
				),
		});
		await expect(failedClient.execute(request(), RELAY_GRANT)).rejects.toMatchObject({
			code: "specialist_model_inheritance_failed",
		});
	});

	it("maps an internal timeout without retrying or falling back", async () => {
		const client = createInternalAgentsImagePromptClient({
			baseUrl: "http://agents.internal:8799",
			token: SPECIALIST_TOKEN,
			timeoutMs: 5,
			fetchImpl: async (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				}),
		});
		await expect(client.execute(request(), RELAY_GRANT)).rejects.toBeInstanceOf(InternalAgentsClientFailure);
		await expect(client.execute(request(), RELAY_GRANT)).rejects.toMatchObject({ code: "specialist_timeout" });
	});

	it("rejects an invalid relay grant before transport", async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response()), { status: 200 }));
		const client = createInternalAgentsImagePromptClient({
			baseUrl: "http://agents.internal:8799",
			token: SPECIALIST_TOKEN,
			timeoutMs: 5_000,
			fetchImpl,
		});

		await expect(client.execute(request(), "")).rejects.toMatchObject({
			code: "specialist_request_invalid",
		});
		await expect(client.execute(request(), "g".repeat(513))).rejects.toMatchObject({
			code: "specialist_request_invalid",
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
