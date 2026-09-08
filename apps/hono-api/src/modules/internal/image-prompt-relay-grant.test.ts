import { describe, expect, it } from "vitest";

import type { ImagePromptSpecialistModelBindingV1 } from "./image-prompt-contract";
import {
	IMAGE_PROMPT_RELAY_GRANT_TTL_SECONDS,
	ImagePromptRelayGrantFailure,
	consumeImagePromptRelayGrant,
	createRedisImagePromptRelayGrantStore,
	issueImagePromptRelayGrant,
	verifyImagePromptRelayGrantBinding,
	type ImagePromptRelayGrantStore,
} from "./image-prompt-relay-grant";

class MemoryGrantStore implements ImagePromptRelayGrantStore {
	readonly records = new Map<string, string>();
	lastKey: string | null = null;
	lastValue: string | null = null;
	lastTtlSeconds: number | null = null;
	forcedTakeValue: string | null | undefined;

	async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
		this.lastKey = key;
		this.lastValue = value;
		this.lastTtlSeconds = ttlSeconds;
		if (this.records.has(key)) return false;
		this.records.set(key, value);
		return true;
	}

	async take(key: string): Promise<string | null> {
		if (this.forcedTakeValue !== undefined) {
			const value = this.forcedTakeValue;
			this.forcedTakeValue = undefined;
			return value;
		}
		const value = this.records.get(key) ?? null;
		this.records.delete(key);
		return value;
	}
}

const promptModel: ImagePromptSpecialistModelBindingV1 = {
	catalogRecordId: "catalog-record-1",
	modelKey: "deepseek-chat",
	configurationRevision: "2026-09-07T12:00:00.000Z",
	providerEndpointVersionId: "endpoint-version-1",
	providerCredentialVersionId: "credential-version-1",
};

const binding = {
	correlationId: "correlation-1",
	generationTaskId: "generation-task-1",
	commercialContext: {
		generationTaskId: "generation-task-1",
		billingOrderId: "billing-order-1",
		quoteFingerprint: "a".repeat(64),
	},
	promptModel,
};

const expectedBinding = {
	correlationId: binding.correlationId,
	generationTaskId: binding.generationTaskId,
	promptModel,
};

const now = new Date("2026-09-07T12:00:00.000Z");

describe("image prompt relay grants", () => {
	it("stores a digest-keyed grant and consumes the bound grant exactly once", async () => {
		const store = new MemoryGrantStore();
		const issued = await issueImagePromptRelayGrant(store, binding, now);

		expect(issued.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(store.lastKey).toMatch(/^image-prompt-specialist:relay-grant:v1:[a-f0-9]{64}$/);
		expect(store.lastKey).not.toContain(issued.grant);
		expect(store.lastValue).not.toContain(issued.grant);
		expect(store.lastTtlSeconds).toBe(IMAGE_PROMPT_RELAY_GRANT_TTL_SECONDS);

		const consumed = await consumeImagePromptRelayGrant(store, issued.grant, now);
		expect(consumed).toMatchObject(binding);
		expect(() => verifyImagePromptRelayGrantBinding(consumed, expectedBinding)).not.toThrow();
		await expect(
			consumeImagePromptRelayGrant(store, issued.grant, now),
		).rejects.toMatchObject({ code: "specialist_replay_rejected" });
	});

	it("rejects expired grants after consuming them", async () => {
		const store = new MemoryGrantStore();
		const issued = await issueImagePromptRelayGrant(store, binding, now);
		const expiredAt = new Date(now.getTime() + IMAGE_PROMPT_RELAY_GRANT_TTL_SECONDS * 1000);

		await expect(
			consumeImagePromptRelayGrant(store, issued.grant, expiredAt),
		).rejects.toMatchObject({ code: "specialist_auth_invalid" });
		await expect(
			consumeImagePromptRelayGrant(store, issued.grant, now),
		).rejects.toMatchObject({ code: "specialist_replay_rejected" });
	});

	it("uses one Redis script to take and delete the record atomically", async () => {
		let evaluatedScript = "";
		let evaluatedKey = "";
		const redisStore = createRedisImagePromptRelayGrantStore({
			get: async () => null,
			set: async () => "OK",
			eval: async (script, numberOfKeys, key) => {
				evaluatedScript = script;
				evaluatedKey = key;
				expect(numberOfKeys).toBe(1);
				return "stored-record";
			},
		});

		await expect(redisStore.take("grant-key")).resolves.toBe("stored-record");
		expect(evaluatedKey).toBe("grant-key");
		expect(evaluatedScript).toContain("redis.call('GET', KEYS[1])");
		expect(evaluatedScript).toContain("redis.call('DEL', KEYS[1])");
	});

	it("rejects correlation, task, and every model identity mismatch", async () => {
		const mismatches = [
			{ ...expectedBinding, correlationId: "other-correlation" },
			{ ...expectedBinding, generationTaskId: "other-task" },
			{ ...expectedBinding, promptModel: { ...promptModel, catalogRecordId: "other-record" } },
			{ ...expectedBinding, promptModel: { ...promptModel, modelKey: "other-model" } },
			{ ...expectedBinding, promptModel: { ...promptModel, configurationRevision: "other-revision" } },
			{ ...expectedBinding, promptModel: { ...promptModel, providerEndpointVersionId: "other-endpoint" } },
			{ ...expectedBinding, promptModel: { ...promptModel, providerCredentialVersionId: "other-credential" } },
		];

		for (const mismatch of mismatches) {
			const store = new MemoryGrantStore();
			const issued = await issueImagePromptRelayGrant(store, binding, now);
			const consumed = await consumeImagePromptRelayGrant(store, issued.grant, now);
			expect(() => verifyImagePromptRelayGrantBinding(consumed, mismatch)).toThrow(
				ImagePromptRelayGrantFailure,
			);
			await expect(
				consumeImagePromptRelayGrant(store, issued.grant, now),
			).rejects.toMatchObject({ code: "specialist_replay_rejected" });
		}
	});

	it("fails closed for duplicate tokens, corrupt records, and Redis failures", async () => {
		const duplicateStore: ImagePromptRelayGrantStore = {
			setIfAbsent: async () => false,
			take: async () => null,
		};
		await expect(issueImagePromptRelayGrant(duplicateStore, binding, now)).rejects.toMatchObject({
			code: "specialist_unavailable",
		});

		const corruptStore = new MemoryGrantStore();
		const corrupt = await issueImagePromptRelayGrant(corruptStore, binding, now);
		corruptStore.forcedTakeValue = "not-json";
		await expect(
			consumeImagePromptRelayGrant(corruptStore, corrupt.grant, now),
		).rejects.toMatchObject({ code: "specialist_auth_invalid" });

		const unavailableStore: ImagePromptRelayGrantStore = {
			setIfAbsent: async () => {
				throw new Error("redis unavailable");
			},
			take: async () => {
				throw new Error("redis unavailable");
			},
		};
		await expect(issueImagePromptRelayGrant(unavailableStore, binding, now)).rejects.toMatchObject({
			code: "specialist_unavailable",
		});
		await expect(
			consumeImagePromptRelayGrant(unavailableStore, "a".repeat(43), now),
		).rejects.toMatchObject({ code: "specialist_unavailable" });
	});
});
