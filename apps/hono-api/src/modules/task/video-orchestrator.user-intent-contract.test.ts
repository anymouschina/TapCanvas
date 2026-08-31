import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { verifyUserIntentContract } from "./video-orchestrator.user-intent-contract";

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.filter((key) => (
				key !== "contractHash" &&
				!(key === "promptMediaType" && record[key] === null)
			))
			.sort()
			.map((key) => [key, canonicalize(record[key])]),
	);
}

function withHash(contract: Record<string, unknown>): Record<string, unknown> {
	return {
		...contract,
		contractHash: createHash("sha256")
			.update(JSON.stringify(canonicalize(contract)))
			.digest("hex"),
	};
}

function validContract(): Record<string, unknown> {
	return withHash({
		version: 2,
		referenceResolution: { mode: "new_task" },
		must: [{ id: "m1", statement: "交付成片", source: "user", evidence: ["本轮请求"] }],
		forbid: [],
		prefer: [],
		confirmedFacts: [],
		unresolved: [],
		precedence: ["provider_protocol_limits", "user_must"],
		delivery: {
			mode: "async_artifact",
			mediaType: "video",
			kind: "final_film",
			output: "真实成片",
		},
	});
}

describe("verifyUserIntentContract", () => {
	it("preserves an already canonical frozen contract", () => {
		const contract = validContract();
		const result = verifyUserIntentContract(contract);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.contract).toEqual(contract);
		expect(result.value.repairedEmptyCollectionPaths).toEqual([]);
	});

	it("accepts agents-cli contracts whose nullable prompt media discriminator is explicit", () => {
		const contract = validContract();
		contract.delivery = {
			...(contract.delivery as Record<string, unknown>),
			promptMediaType: null,
		};
		const rehashed = withHash(
			Object.fromEntries(Object.entries(contract).filter(([key]) => key !== "contractHash")),
		);

		const result = verifyUserIntentContract(rehashed);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.contract).toEqual(rehashed);
	});

	it("repairs empty collection shapes only when the frozen hash proves the projection", () => {
		const canonical = validContract();
		const transported = structuredClone(canonical);
		transported.forbid = {};
		transported.prefer = {};
		transported.confirmedFacts = {};
		transported.unresolved = {};
		const result = verifyUserIntentContract(transported);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.contract).toEqual(canonical);
		expect(result.value.repairedEmptyCollectionPaths).toEqual([
			"forbid",
			"prefer",
			"confirmedFacts",
			"unresolved",
		]);
	});

	it("rejects content changes instead of hiding them as transport repair", () => {
		const contract = validContract();
		contract.delivery = {
			...(contract.delivery as Record<string, unknown>),
			output: "被篡改的成片",
		};
		const result = verifyUserIntentContract(contract);
		expect(result).toMatchObject({ ok: false, code: "user_intent_contract_hash_mismatch" });
	});

	it("requires explicit mediaType and never infers it from free-form kind", () => {
		const missingMediaType = validContract();
		delete (missingMediaType.delivery as Record<string, unknown>).mediaType;
		const rehashedMissing = withHash(
			Object.fromEntries(Object.entries(missingMediaType).filter(([key]) => key !== "contractHash")),
		);
		expect(verifyUserIntentContract(rehashedMissing)).toMatchObject({
			ok: false,
			code: "user_intent_contract_invalid",
		});

		const nonMedia = validContract();
		nonMedia.delivery = {
			mode: "response",
			mediaType: null,
			kind: "video_analysis",
			output: "视频分析正文",
		};
		const rehashedNonMedia = withHash(
			Object.fromEntries(Object.entries(nonMedia).filter(([key]) => key !== "contractHash")),
		);
		expect(verifyUserIntentContract(rehashedNonMedia).ok).toBe(true);

		const invalidMode = validContract();
		invalidMode.delivery = {
			mode: "response",
			mediaType: "video",
			kind: "answer",
			output: "正文",
		};
		const rehashedInvalidMode = withHash(
			Object.fromEntries(Object.entries(invalidMode).filter(([key]) => key !== "contractHash")),
		);
		expect(verifyUserIntentContract(rehashedInvalidMode)).toMatchObject({
			ok: false,
			code: "user_intent_contract_invalid",
		});
	});
});
