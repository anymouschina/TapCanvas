import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	HMAIGC_IMAGE_PROMPT_RELAY_HEADERS,
	InternalHmaigcImagePromptModelFailure,
	createInternalHmaigcImagePromptModelClient,
	type ImagePromptModelRelayRequestV1,
} from "./internal-hmaigc-model-client";

const now = new Date("2026-09-07T12:00:00.000Z");
const secret = "0123456789abcdef0123456789abcdef";

function request(): ImagePromptModelRelayRequestV1 {
	return {
		schemaVersion: "image-prompt-model-relay-request/v1",
		correlationId: "task-1",
		commercialContext: {
			generationTaskId: "task-1",
			billingOrderId: "order-1",
			quoteFingerprint: "a".repeat(64),
		},
		promptModel: {
			catalogRecordId: "record-1",
			modelKey: "gpt-5.5",
			configurationRevision: "2026-09-07T12:00:00.000Z",
			providerEndpointVersionId: "endpoint-1",
			providerCredentialVersionId: "credential-version-1",
		},
		messages: [
			{ role: "system", content: "Return strict JSON." },
			{ role: "user", content: "Create an image prompt." },
		],
		tools: [],
		stream: false,
	};
}

describe("internal HMaigc image prompt model client", () => {
	it("signs the exact body and parent binding once", async () => {
		const input = request();
		const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];
		const fetchImpl: typeof fetch = async (fetchInput, init) => {
			calls.push({ input: fetchInput, init });
			const body = String(init?.body);
			const headers = new Headers(init?.headers);
			const digest = createHash("sha256").update(body).digest("hex");
			const canonical = [
				"hmaigc-image-prompt-model-relay/v1",
				"hono-image-prompt",
				String(Math.floor(now.getTime() / 1000)),
				"nonce-1",
				"POST",
				"/internal/v1/model-relays/image-prompt/chat-completions",
				digest,
				"task-1",
				"task-1",
			].join("\n");
			expect(JSON.parse(body)).toEqual(input);
			expect(headers.get(HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.bodySha256)).toBe(digest);
			expect(headers.get(HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.signature)).toBe(
				`v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`,
			);
			return new Response(
				JSON.stringify({
					schemaVersion: "image-prompt-model-relay-response/v1",
					text: "prompt",
					effectiveModel: "gpt-5.5",
					providerRequestId: "provider-request-1",
					usage: { inputTokens: 10, cachedTokens: 2, outputTokens: 4, totalTokens: 14 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		};
		const client = createInternalHmaigcImagePromptModelClient({
			url: "http://hmaigc.internal/internal/v1/model-relays/image-prompt/chat-completions",
			serviceId: "hono-image-prompt",
			secret,
			fetchImpl,
			now: () => now,
			nonce: () => "nonce-1",
		});

		await expect(client.execute(input)).resolves.toMatchObject({
			effectiveModel: "gpt-5.5",
			providerRequestId: "provider-request-1",
		});
		expect(calls).toHaveLength(1);
	});

	it("rejects unknown response fields and never retries transport failures", async () => {
		const invalidClient = createInternalHmaigcImagePromptModelClient({
			url: "http://hmaigc.internal/internal/v1/model-relays/image-prompt/chat-completions",
			serviceId: "hono-image-prompt",
			secret,
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						schemaVersion: "image-prompt-model-relay-response/v1",
						text: "prompt",
						effectiveModel: "gpt-5.5",
						providerRequestId: "provider-request-1",
						usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, totalTokens: 2 },
						unexpected: true,
					}),
					{ status: 200 },
				),
		});
		await expect(invalidClient.execute(request())).rejects.toBeInstanceOf(
			InternalHmaigcImagePromptModelFailure,
		);

		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			throw new Error("secret transport detail");
		};
		const unavailableClient = createInternalHmaigcImagePromptModelClient({
			url: "http://hmaigc.internal/internal/v1/model-relays/image-prompt/chat-completions",
			serviceId: "hono-image-prompt",
			secret,
			fetchImpl,
		});
		await expect(unavailableClient.execute(request())).rejects.toMatchObject({
			code: "specialist_unavailable",
			message: "HMaigc image prompt relay request did not complete",
		});
		expect(calls).toBe(1);
	});
});
