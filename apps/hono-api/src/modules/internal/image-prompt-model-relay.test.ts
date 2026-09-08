import { describe, expect, it, vi } from "vitest";

import {
	InternalImagePromptRelayFailure,
	relayGrantedImagePromptModelCall,
} from "./image-prompt-model-relay";
import {
	issueImagePromptRelayGrant,
	type ImagePromptRelayGrantStore,
} from "./image-prompt-relay-grant";
import type {
	ImagePromptModelRelayRequestV1,
	ImagePromptModelRelayResponseV1,
	InternalHmaigcImagePromptModelClient,
} from "./internal-hmaigc-model-client";

class MemoryGrantStore implements ImagePromptRelayGrantStore {
	private readonly values = new Map<string, string>();
	async setIfAbsent(key: string, value: string): Promise<boolean> {
		if (this.values.has(key)) return false;
		this.values.set(key, value);
		return true;
	}
	async take(key: string): Promise<string | null> {
		const value = this.values.get(key) ?? null;
		this.values.delete(key);
		return value;
	}
}

const now = new Date("2026-09-07T12:00:00.000Z");
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
const chatRequest = {
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
const hmaigcResponse: ImagePromptModelRelayResponseV1 = {
	schemaVersion: "image-prompt-model-relay-response/v1",
	text: "{\"imagePrompt\":\"prompt\"}",
	effectiveModel: "gpt-5.5",
	providerRequestId: "provider-request-1",
	usage: { inputTokens: 10, cachedTokens: 2, outputTokens: 4, totalTokens: 14 },
};

async function issuedGrant(store: MemoryGrantStore): Promise<string> {
	return (
		await issueImagePromptRelayGrant(
			store,
			{
				correlationId: "task-1",
				generationTaskId: "task-1",
				commercialContext,
				promptModel,
			},
			now,
		)
	).grant;
}

describe("granted image prompt model relay", () => {
	it("consumes one grant, calls HMaigc once, and maps the strict response for agents", async () => {
		const store = new MemoryGrantStore();
		const grant = await issuedGrant(store);
		const execute = vi.fn(async (_request: ImagePromptModelRelayRequestV1) => hmaigcResponse);
		const hmaigcClient: InternalHmaigcImagePromptModelClient = { execute };
		const response = await relayGrantedImagePromptModelCall({
			authorization: `Bearer ${grant}`,
			chatRequestBody: JSON.stringify(chatRequest),
			grantStore: store,
			hmaigcClient,
			now,
		});
		expect(execute).toHaveBeenCalledOnce();
		expect(execute.mock.calls[0]?.[0]).toMatchObject({ commercialContext, promptModel });
		expect(response).toMatchObject({
			id: "provider-request-1",
			model: "gpt-5.5",
			choices: [{ message: { content: hmaigcResponse.text } }],
			usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
		});
		await expect(
			relayGrantedImagePromptModelCall({
				authorization: `Bearer ${grant}`,
				chatRequestBody: JSON.stringify(chatRequest),
				grantStore: store,
				hmaigcClient,
				now,
			}),
		).rejects.toMatchObject({ code: "specialist_replay_rejected" });
	});

	it("rejects missing and mismatched grants before HMaigc", async () => {
		const store = new MemoryGrantStore();
		const execute = vi.fn(async () => hmaigcResponse);
		const hmaigcClient: InternalHmaigcImagePromptModelClient = { execute };
		await expect(
			relayGrantedImagePromptModelCall({
				authorization: "Bearer missing",
				chatRequestBody: JSON.stringify(chatRequest),
				grantStore: store,
				hmaigcClient,
				now,
			}),
		).rejects.toBeInstanceOf(InternalImagePromptRelayFailure);

		const grant = await issuedGrant(store);
		await expect(
			relayGrantedImagePromptModelCall({
				authorization: `Bearer ${grant}`,
				chatRequestBody: JSON.stringify({
					...chatRequest,
					metadata: {
						...chatRequest.metadata,
						promptModel: { ...promptModel, providerEndpointVersionId: "other-endpoint" },
					},
				}),
				grantStore: store,
				hmaigcClient,
				now,
			}),
		).rejects.toMatchObject({ code: "specialist_model_inheritance_failed" });
		expect(execute).not.toHaveBeenCalled();
	});
});
