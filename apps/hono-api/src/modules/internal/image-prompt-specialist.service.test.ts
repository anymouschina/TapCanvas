import { describe, expect, it, vi } from "vitest";

import {
	ImagePromptSpecialistGatewayFailure,
	executeImagePromptSpecialistGateway,
} from "./image-prompt-specialist.service";
import {
	imagePromptEvidenceDigest,
	type ImagePromptSpecialistRequestV1,
	type ImagePromptSpecialistResponseV1,
} from "./image-prompt-contract";
import type { ImagePromptIdempotencyStore } from "./image-prompt-idempotency";
import type { ImagePromptRelayGrantStore } from "./image-prompt-relay-grant";

class MemoryIdempotencyStore implements ImagePromptIdempotencyStore {
	private readonly records = new Map<string, string>();
	async get(key: string): Promise<string | null> {
		return this.records.get(key) ?? null;
	}
	async setIfAbsent(key: string, value: string): Promise<boolean> {
		if (this.records.has(key)) return false;
		this.records.set(key, value);
		return true;
	}
	async compareAndSet(key: string, expected: string, next: string): Promise<boolean> {
		if (this.records.get(key) !== expected) return false;
		this.records.set(key, next);
		return true;
	}
}

class MemoryRelayGrantStore implements ImagePromptRelayGrantStore {
	private readonly records = new Map<string, string>();
	async setIfAbsent(key: string, value: string): Promise<boolean> {
		if (this.records.has(key)) return false;
		this.records.set(key, value);
		return true;
	}
	async take(key: string): Promise<string | null> {
		const value = this.records.get(key) ?? null;
		this.records.delete(key);
		return value;
	}
}

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
			catalogRecordId: "hmaigc-model-record-1",
			modelKey: "gpt-5.6",
			configurationRevision: "2026-09-07T10:00:00.000Z",
			providerEndpointVersionId: "endpoint-version-1",
			providerCredentialVersionId: "credential-version-1",
		},
	};
}

function specialistResponse(input: ImagePromptSpecialistRequestV1): ImagePromptSpecialistResponseV1 {
	return {
		schemaVersion: "image-prompt/v1",
		imagePrompt: "严格参考图1，仅增强真实皮肤、发丝与材质细节。",
		trace: {
			requestId: input.requestId,
			correlationId: input.correlationId,
			specialist: "image_prompt_specialist",
			evidenceDigest: imagePromptEvidenceDigest(input.evidence),
			model: { ...input.promptModel, effectiveModel: input.promptModel.modelKey },
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			startedAt: "2026-09-07T10:00:00.000Z",
			completedAt: "2026-09-07T10:00:01.000Z",
		},
	};
}

function dependencies(input: ImagePromptSpecialistRequestV1) {
	return {
		idempotencyStore: new MemoryIdempotencyStore(),
		relayGrantStore: new MemoryRelayGrantStore(),
		executeAgentsSpecialist: vi.fn(async () => specialistResponse(input)),
		now: () => new Date("2026-09-07T10:00:00.000Z"),
	};
}

describe("image prompt specialist gateway", () => {
	it("executes once and replays the verified response for an identical request", async () => {
		const input = request();
		const deps = dependencies(input);
		const first = await executeImagePromptSpecialistGateway(input, deps);
		const replay = await executeImagePromptSpecialistGateway(input, deps);

		expect(first.replayed).toBe(false);
		expect(replay.replayed).toBe(true);
		expect(replay.response).toEqual(first.response);
		expect(deps.executeAgentsSpecialist).toHaveBeenCalledOnce();
	});

	it("passes one request-bound relay grant to agents", async () => {
		const input = request();
		const deps = dependencies(input);
		await executeImagePromptSpecialistGateway(input, deps);
		expect(deps.executeAgentsSpecialist).toHaveBeenCalledWith(
			input,
			expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
			undefined,
		);
	});

	it("replays the frozen response when only signed reference URLs rotate", async () => {
		const input = request();
		const deps = dependencies(input);
		const first = await executeImagePromptSpecialistGateway(input, deps);
		const rotatedRequest: ImagePromptSpecialistRequestV1 = {
			...input,
			evidence: {
				...input.evidence,
				references: input.evidence.references.map((reference) => ({
					...reference,
					accessUrl: "https://media.example/source.png?expires=1788790000&signature=rotated",
				})),
			},
		};
		const replay = await executeImagePromptSpecialistGateway(rotatedRequest, deps);

		expect(replay.replayed).toBe(true);
		expect(replay.response).toEqual(first.response);
		expect(deps.executeAgentsSpecialist).toHaveBeenCalledOnce();
	});

	it("rejects evidence or effective-model drift and freezes the failure", async () => {
		const input = request();
		const deps = dependencies(input);
		deps.executeAgentsSpecialist.mockResolvedValue({
			...specialistResponse(input),
			trace: { ...specialistResponse(input).trace, evidenceDigest: "f".repeat(64) },
		});

		await expect(executeImagePromptSpecialistGateway(input, deps)).rejects.toMatchObject({
			code: "specialist_evidence_invalid",
		});
		await expect(executeImagePromptSpecialistGateway(input, deps)).rejects.toMatchObject({
			code: "specialist_evidence_invalid",
		});
		expect(deps.executeAgentsSpecialist).toHaveBeenCalledOnce();
	});

	it("preserves an agents timeout and never converts it to a prompt fallback", async () => {
		const input = request();
		const deps = dependencies(input);
		deps.executeAgentsSpecialist.mockRejectedValue(
			new ImagePromptSpecialistGatewayFailure("specialist_timeout", "agents timed out"),
		);

		await expect(executeImagePromptSpecialistGateway(input, deps)).rejects.toMatchObject({
			code: "specialist_timeout",
		});
		expect(deps.executeAgentsSpecialist).toHaveBeenCalledOnce();
	});
});
