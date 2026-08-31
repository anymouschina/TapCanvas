import { createHash } from "node:crypto";

export type VerifiedUserIntentContract = {
	contract: Record<string, unknown>;
	repairedEmptyCollectionPaths: string[];
};

export type UserIntentContractVerification =
	| { ok: true; value: VerifiedUserIntentContract }
	| { ok: false; code: "user_intent_contract_invalid" | "user_intent_contract_hash_mismatch"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
	return isRecord(value) && Object.keys(value).length === 0;
}

function repairEmptyArrayField(
	record: Record<string, unknown>,
	field: string,
	path: string,
	repairedPaths: string[],
): void {
	if (!isEmptyRecord(record[field])) return;
	record[field] = [];
	repairedPaths.push(path);
}

function repairRequirementCollections(
	value: unknown,
	path: string,
	repairedPaths: string[],
): void {
	if (!Array.isArray(value)) return;
	value.forEach((item, index) => {
		if (!isRecord(item)) return;
		repairEmptyArrayField(item, "evidence", `${path}[${index}].evidence`, repairedPaths);
	});
}

/**
 * Repairs only the JSON shape of schema-declared collection fields. Some tool
 * transports have represented an empty array as an empty object while leaving
 * non-empty arrays intact. No content is invented: the repaired projection is
 * accepted only when its canonical SHA-256 exactly matches contractHash.
 */
function repairEmptyCollectionShapes(
	input: Record<string, unknown>,
): VerifiedUserIntentContract {
	const contract = structuredClone(input);
	const repairedEmptyCollectionPaths: string[] = [];
	for (const field of ["must", "forbid", "prefer", "confirmedFacts", "unresolved", "precedence"] as const) {
		repairEmptyArrayField(contract, field, field, repairedEmptyCollectionPaths);
	}
	for (const field of ["must", "forbid", "prefer", "confirmedFacts"] as const) {
		repairRequirementCollections(contract[field], field, repairedEmptyCollectionPaths);
	}
	return { contract, repairedEmptyCollectionPaths };
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.filter((key) => (
				key !== "contractHash" &&
				// Keep this byte-for-byte aligned with agents-cli's frozen
				// UserIntentContract identity. `promptMediaType` is an optional
				// nullable discriminator: null and omission both mean that the
				// response is not a directly executable media prompt.
				!(key === "promptMediaType" && value[key] === null)
			))
			.sort()
			.map((key) => [key, canonicalize(value[key])]),
	);
}

function computeContractHash(contract: Record<string, unknown>): string {
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(contract)))
		.digest("hex");
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRequirementArray(value: unknown): boolean {
	return Array.isArray(value) && value.every((item) => {
		if (!isRecord(item)) return false;
		return (
			typeof item.id === "string" &&
			typeof item.statement === "string" &&
			typeof item.source === "string" &&
			isStringArray(item.evidence)
		);
	});
}

function hasValidCollectionShape(contract: Record<string, unknown>): boolean {
	if (contract.version !== 2) return false;
	if (
		!isRequirementArray(contract.must) ||
		!isRequirementArray(contract.forbid) ||
		!isRequirementArray(contract.prefer) ||
		!isRequirementArray(contract.confirmedFacts) ||
		!isStringArray(contract.unresolved) ||
		!isStringArray(contract.precedence)
	) {
		return false;
	}
	if (!isRecord(contract.delivery)) return false;
	const delivery = contract.delivery;
	const mode = delivery.mode;
	const mediaType = delivery.mediaType === null ||
			delivery.mediaType === "image" ||
			delivery.mediaType === "video" ||
			delivery.mediaType === "audio"
		? delivery.mediaType
		: undefined;
	const kind = typeof delivery.kind === "string" ? delivery.kind.trim() : "";
	const output = typeof delivery.output === "string" ? delivery.output.trim() : "";
	if (
		(mode !== "response" && mode !== "state_change" && mode !== "async_artifact") ||
		mediaType === undefined ||
		!kind ||
		!output ||
		!Array.isArray(contract.must) ||
		contract.must.length === 0
	) {
		return false;
	}
	return mediaType === null || mode === "async_artifact";
}

/**
 * Hono treats the contract as an opaque semantic payload, but it verifies the
 * exact structural hand-off before durable storage or child-agent delegation.
 */
export function verifyUserIntentContract(value: unknown): UserIntentContractVerification {
	if (!isRecord(value)) {
		return {
			ok: false,
			code: "user_intent_contract_invalid",
			message: "userIntentContract 必须是结构化对象。",
		};
	}
	const expectedHash = typeof value.contractHash === "string" ? value.contractHash.trim() : "";
	if (!expectedHash) {
		return {
			ok: false,
			code: "user_intent_contract_invalid",
			message: "userIntentContract.contractHash 缺失。",
		};
	}
	const repaired = repairEmptyCollectionShapes(value);
	if (!hasValidCollectionShape(repaired.contract)) {
		return {
			ok: false,
			code: "user_intent_contract_invalid",
			message: "userIntentContract 的集合字段不符合冻结合同 schema。",
		};
	}
	const actualHash = computeContractHash(repaired.contract);
	if (actualHash !== expectedHash) {
		return {
			ok: false,
			code: "user_intent_contract_hash_mismatch",
			message: `userIntentContract 完整性校验失败：expected=${expectedHash} actual=${actualHash}。`,
		};
	}
	return { ok: true, value: repaired };
}
