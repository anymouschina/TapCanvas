import { describe, expect, it } from "vitest";

import {
	ImagePromptIdempotencyFailure,
	IMAGE_PROMPT_PENDING_TTL_SECONDS,
	claimImagePromptIdempotency,
	completeImagePromptIdempotencyFailure,
	completeImagePromptIdempotencySuccess,
	requireImagePromptRedisUrl,
	type ImagePromptIdempotencyStore,
} from "./image-prompt-idempotency";
import type { ImagePromptSpecialistResponseV1 } from "./image-prompt-contract";

class MemoryIdempotencyStore implements ImagePromptIdempotencyStore {
	private readonly records = new Map<string, string>();
	lastSetIfAbsentTtlSeconds: number | null = null;

	async get(key: string): Promise<string | null> {
		return this.records.get(key) ?? null;
	}

	async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
		if (this.records.has(key)) return false;
		this.lastSetIfAbsentTtlSeconds = ttlSeconds;
		this.records.set(key, value);
		return true;
	}

	async compareAndSet(key: string, expected: string, next: string): Promise<boolean> {
		if (this.records.get(key) !== expected) return false;
		this.records.set(key, next);
		return true;
	}
}

function response(): ImagePromptSpecialistResponseV1 {
	return {
		schemaVersion: "image-prompt/v1",
		imagePrompt: "严格参考图1，仅增强真实人像材质。",
		trace: {
			requestId: "request-1",
			correlationId: "correlation-1",
			specialist: "image_prompt_specialist",
			evidenceDigest: "a".repeat(64),
			model: {
				catalogRecordId: "record-1",
				modelKey: "gpt-5.6",
				configurationRevision: "revision-1",
				providerEndpointVersionId: "endpoint-version-1",
				providerCredentialVersionId: "credential-version-1",
				effectiveModel: "gpt-5.6",
			},
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			startedAt: "2026-09-07T10:00:00.000Z",
			completedAt: "2026-09-07T10:00:01.000Z",
		},
	};
}

const claimInput = {
	idempotencyKey: "image-prompt:task-1",
	bodyDigest: "b".repeat(64),
	nowIso: "2026-09-07T10:00:00.000Z",
} as const;

describe("image prompt specialist idempotency", () => {
	it("claims once, reports pending, and replays the completed response", async () => {
		const store = new MemoryIdempotencyStore();
		const claimed = await claimImagePromptIdempotency(store, claimInput);
		expect(claimed.kind).toBe("claimed");
		expect(store.lastSetIfAbsentTtlSeconds).toBe(IMAGE_PROMPT_PENDING_TTL_SECONDS);

		const pending = await claimImagePromptIdempotency(store, claimInput);
		expect(pending.kind).toBe("pending");

		await completeImagePromptIdempotencySuccess(store, {
			claim: claimed.kind === "claimed" ? claimed.claim : neverClaim(),
			response: response(),
			responseDigest: "c".repeat(64),
			completedAt: "2026-09-07T10:00:01.000Z",
		});

		const replay = await claimImagePromptIdempotency(store, claimInput);
		expect(replay.kind).toBe("succeeded");
		if (replay.kind === "succeeded") {
			expect(replay.response.imagePrompt).toContain("真实人像材质");
			expect(replay.responseDigest).toBe("c".repeat(64));
		}
	});

	it("rejects the same key with a different body digest", async () => {
		const store = new MemoryIdempotencyStore();
		await claimImagePromptIdempotency(store, claimInput);
		const conflict = await claimImagePromptIdempotency(store, {
			...claimInput,
			bodyDigest: "d".repeat(64),
		});
		expect(conflict.kind).toBe("conflict");
	});

	it("freezes failures and requires a new key for an explicit retry", async () => {
		const store = new MemoryIdempotencyStore();
		const claimed = await claimImagePromptIdempotency(store, claimInput);
		await completeImagePromptIdempotencyFailure(store, {
			claim: claimed.kind === "claimed" ? claimed.claim : neverClaim(),
			errorCode: "specialist_timeout",
			completedAt: "2026-09-07T10:00:02.000Z",
		});

		const failed = await claimImagePromptIdempotency(store, claimInput);
		expect(failed).toMatchObject({ kind: "failed", errorCode: "specialist_timeout" });
	});

	it("surfaces Redis outages instead of using an in-process fallback", async () => {
		const unavailable: ImagePromptIdempotencyStore = {
			get: async () => {
				throw new Error("redis unavailable");
			},
			setIfAbsent: async () => false,
			compareAndSet: async () => false,
		};

		await expect(claimImagePromptIdempotency(unavailable, claimInput)).rejects.toBeInstanceOf(
			ImagePromptIdempotencyFailure,
		);
		expect(() => requireImagePromptRedisUrl({})).toThrow("IMAGE_PROMPT_REDIS_URL is required");
	});
});

function neverClaim(): never {
	throw new Error("expected a newly claimed idempotency record");
}
