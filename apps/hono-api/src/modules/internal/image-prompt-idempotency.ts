import type {
	ImagePromptSpecialistErrorCode,
	ImagePromptSpecialistResponseV1,
} from "./image-prompt-contract";
import { parseImagePromptSpecialistResponse } from "./image-prompt-contract";
import { loadImagePromptSpecialistContractModule } from "../../platform/node/shared-schema-loader";

const encoder = new TextEncoder();
const RECORD_VERSION = "image-prompt-idempotency/v1";
export const IMAGE_PROMPT_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;
export const IMAGE_PROMPT_PENDING_TTL_SECONDS = 5 * 60;

export interface ImagePromptIdempotencyStore {
	get(key: string): Promise<string | null>;
	setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
	compareAndSet(
		key: string,
		expected: string,
		next: string,
		ttlSeconds: number,
	): Promise<boolean>;
}

type PendingRecord = {
	schemaVersion: typeof RECORD_VERSION;
	state: "pending";
	bodyDigest: string;
	startedAt: string;
};

type SucceededRecord = {
	schemaVersion: typeof RECORD_VERSION;
	state: "succeeded";
	bodyDigest: string;
	responseDigest: string;
	effectiveModel: string;
	startedAt: string;
	completedAt: string;
	response: ImagePromptSpecialistResponseV1;
};

type FailedRecord = {
	schemaVersion: typeof RECORD_VERSION;
	state: "failed";
	bodyDigest: string;
	errorCode: ImagePromptSpecialistErrorCode;
	startedAt: string;
	completedAt: string;
};

type IdempotencyRecord = PendingRecord | SucceededRecord | FailedRecord;

export type ImagePromptIdempotencyClaim = {
	storageKey: string;
	bodyDigest: string;
	startedAt: string;
	pendingValue: string;
};

export type ImagePromptIdempotencyClaimResult =
	| { kind: "claimed"; claim: ImagePromptIdempotencyClaim }
	| { kind: "pending"; startedAt: string }
	| {
			kind: "succeeded";
			response: ImagePromptSpecialistResponseV1;
			responseDigest: string;
			effectiveModel: string;
		}
	| { kind: "failed"; errorCode: ImagePromptSpecialistErrorCode; completedAt: string }
	| { kind: "conflict" };

export class ImagePromptIdempotencyFailure extends Error {
	readonly code: ImagePromptSpecialistErrorCode;

	constructor(message: string) {
		super(message);
		this.name = "ImagePromptIdempotencyFailure";
		this.code = "specialist_unavailable";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDigest(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length === 64 &&
		Array.from(value).every((character) => "0123456789abcdef".includes(character))
	);
}

function isIsoTimestamp(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isSpecialistErrorCode(value: unknown): value is ImagePromptSpecialistErrorCode {
	return (
		typeof value === "string" &&
		loadImagePromptSpecialistContractModule().IMAGE_PROMPT_SPECIALIST_ERROR_CODES.includes(value)
	);
}

function parseRecord(raw: string): IdempotencyRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		throw new ImagePromptIdempotencyFailure("idempotency record is not valid JSON");
	}
	if (
		!isRecord(parsed) ||
		parsed.schemaVersion !== RECORD_VERSION ||
		!isDigest(parsed.bodyDigest) ||
		!isIsoTimestamp(parsed.startedAt)
	) {
		throw new ImagePromptIdempotencyFailure("idempotency record is invalid");
	}
	if (parsed.state === "pending") {
		return {
			schemaVersion: RECORD_VERSION,
			state: "pending",
			bodyDigest: parsed.bodyDigest,
			startedAt: parsed.startedAt,
		};
	}
	if (
		parsed.state === "succeeded" &&
		isDigest(parsed.responseDigest) &&
		typeof parsed.effectiveModel === "string" &&
		parsed.effectiveModel.length > 0 &&
		isIsoTimestamp(parsed.completedAt)
	) {
		const response = parseImagePromptSpecialistResponse(parsed.response);
		if (!response.ok) {
			throw new ImagePromptIdempotencyFailure(`cached specialist response is invalid: ${response.error}`);
		}
		return {
			schemaVersion: RECORD_VERSION,
			state: "succeeded",
			bodyDigest: parsed.bodyDigest,
			responseDigest: parsed.responseDigest,
			effectiveModel: parsed.effectiveModel,
			startedAt: parsed.startedAt,
			completedAt: parsed.completedAt,
			response: response.value,
		};
	}
	if (
		parsed.state === "failed" &&
		isSpecialistErrorCode(parsed.errorCode) &&
		isIsoTimestamp(parsed.completedAt)
	) {
		return {
			schemaVersion: RECORD_VERSION,
			state: "failed",
			bodyDigest: parsed.bodyDigest,
			errorCode: parsed.errorCode,
			startedAt: parsed.startedAt,
			completedAt: parsed.completedAt,
		};
	}
	throw new ImagePromptIdempotencyFailure("idempotency record state is invalid");
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storageKey(idempotencyKey: string): Promise<string> {
	const normalized = idempotencyKey.trim();
	if (!normalized || normalized.length > 256) {
		throw new ImagePromptIdempotencyFailure("idempotency key is invalid");
	}
	return `image-prompt-specialist:idempotency:v1:${await sha256Hex(normalized)}`;
}

function classifyRecord(record: IdempotencyRecord, bodyDigest: string): ImagePromptIdempotencyClaimResult {
	if (record.bodyDigest !== bodyDigest) return { kind: "conflict" };
	if (record.state === "pending") return { kind: "pending", startedAt: record.startedAt };
	if (record.state === "failed") {
		return { kind: "failed", errorCode: record.errorCode, completedAt: record.completedAt };
	}
	return {
		kind: "succeeded",
		response: record.response,
		responseDigest: record.responseDigest,
		effectiveModel: record.effectiveModel,
	};
}

async function storeOperation<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof ImagePromptIdempotencyFailure) throw error;
		throw new ImagePromptIdempotencyFailure(
			`idempotency store unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function claimImagePromptIdempotency(
	store: ImagePromptIdempotencyStore,
	input: {
		idempotencyKey: string;
		bodyDigest: string;
		nowIso: string;
		ttlSeconds?: number;
	},
): Promise<ImagePromptIdempotencyClaimResult> {
	if (!isDigest(input.bodyDigest) || !isIsoTimestamp(input.nowIso)) {
		throw new ImagePromptIdempotencyFailure("idempotency claim input is invalid");
	}
	const key = await storageKey(input.idempotencyKey);
	const pending: PendingRecord = {
		schemaVersion: RECORD_VERSION,
		state: "pending",
		bodyDigest: input.bodyDigest,
		startedAt: input.nowIso,
	};
	const pendingValue = JSON.stringify(pending);
	const ttlSeconds = input.ttlSeconds ?? IMAGE_PROMPT_PENDING_TTL_SECONDS;
	const existing = await storeOperation(() => store.get(key));
	if (existing) return classifyRecord(parseRecord(existing), input.bodyDigest);
	const claimed = await storeOperation(() => store.setIfAbsent(key, pendingValue, ttlSeconds));
	if (claimed) {
		return {
			kind: "claimed",
			claim: { storageKey: key, bodyDigest: input.bodyDigest, startedAt: input.nowIso, pendingValue },
		};
	}
	const raced = await storeOperation(() => store.get(key));
	if (!raced) throw new ImagePromptIdempotencyFailure("idempotency claim race lost without a record");
	return classifyRecord(parseRecord(raced), input.bodyDigest);
}

export async function completeImagePromptIdempotencySuccess(
	store: ImagePromptIdempotencyStore,
	input: {
		claim: ImagePromptIdempotencyClaim;
		response: ImagePromptSpecialistResponseV1;
		responseDigest: string;
		completedAt: string;
		ttlSeconds?: number;
	},
): Promise<void> {
	const parsedResponse = parseImagePromptSpecialistResponse(input.response);
	if (!parsedResponse.ok || !isDigest(input.responseDigest) || !isIsoTimestamp(input.completedAt)) {
		throw new ImagePromptIdempotencyFailure("successful idempotency completion is invalid");
	}
	const next: SucceededRecord = {
		schemaVersion: RECORD_VERSION,
		state: "succeeded",
		bodyDigest: input.claim.bodyDigest,
		responseDigest: input.responseDigest,
		effectiveModel: parsedResponse.value.trace.model.effectiveModel,
		startedAt: input.claim.startedAt,
		completedAt: input.completedAt,
		response: parsedResponse.value,
	};
	const changed = await storeOperation(() =>
		store.compareAndSet(
			input.claim.storageKey,
			input.claim.pendingValue,
			JSON.stringify(next),
			input.ttlSeconds ?? IMAGE_PROMPT_IDEMPOTENCY_TTL_SECONDS,
		),
	);
	if (!changed) throw new ImagePromptIdempotencyFailure("idempotency success transition was rejected");
}

export async function completeImagePromptIdempotencyFailure(
	store: ImagePromptIdempotencyStore,
	input: {
		claim: ImagePromptIdempotencyClaim;
		errorCode: ImagePromptSpecialistErrorCode;
		completedAt: string;
		ttlSeconds?: number;
	},
): Promise<void> {
	if (!isSpecialistErrorCode(input.errorCode) || !isIsoTimestamp(input.completedAt)) {
		throw new ImagePromptIdempotencyFailure("failed idempotency completion is invalid");
	}
	const next: FailedRecord = {
		schemaVersion: RECORD_VERSION,
		state: "failed",
		bodyDigest: input.claim.bodyDigest,
		errorCode: input.errorCode,
		startedAt: input.claim.startedAt,
		completedAt: input.completedAt,
	};
	const changed = await storeOperation(() =>
		store.compareAndSet(
			input.claim.storageKey,
			input.claim.pendingValue,
			JSON.stringify(next),
			input.ttlSeconds ?? IMAGE_PROMPT_IDEMPOTENCY_TTL_SECONDS,
		),
	);
	if (!changed) throw new ImagePromptIdempotencyFailure("idempotency failure transition was rejected");
}

export type InternalRedisIdempotencyCommands = {
	get(key: string): Promise<string | null>;
	set(
		key: string,
		value: string,
		expiryMode: "EX",
		ttlSeconds: number,
		condition: "NX",
	): Promise<unknown>;
	eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
};

const COMPARE_AND_SET_SCRIPT = [
	"if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
	"redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])",
	"return 1",
].join("\n");

const TAKE_ONCE_SCRIPT = [
	"local value = redis.call('GET', KEYS[1])",
	"if not value then return false end",
	"redis.call('DEL', KEYS[1])",
	"return value",
].join("\n");

export async function takeRedisValueOnce(
	redis: Pick<InternalRedisIdempotencyCommands, "eval">,
	key: string,
): Promise<string | null> {
	const result = await redis.eval(TAKE_ONCE_SCRIPT, 1, key);
	if (result === null || result === false) return null;
	if (typeof result !== "string") {
		throw new ImagePromptIdempotencyFailure("atomic Redis take returned an invalid value");
	}
	return result;
}

export function createRedisImagePromptIdempotencyStore(
	redis: InternalRedisIdempotencyCommands,
): ImagePromptIdempotencyStore {
	return {
		get: (key) => redis.get(key),
		setIfAbsent: async (key, value, ttlSeconds) =>
			(await redis.set(key, value, "EX", ttlSeconds, "NX")) === "OK",
		compareAndSet: async (key, expected, next, ttlSeconds) =>
			(await redis.eval(
				COMPARE_AND_SET_SCRIPT,
				1,
				key,
				expected,
				next,
				String(ttlSeconds),
			)) === 1,
	};
}

export function requireImagePromptRedisUrl(env: { IMAGE_PROMPT_REDIS_URL?: unknown }): string {
	const value = typeof env.IMAGE_PROMPT_REDIS_URL === "string" ? env.IMAGE_PROMPT_REDIS_URL.trim() : "";
	if (!value) throw new ImagePromptIdempotencyFailure("IMAGE_PROMPT_REDIS_URL is required");
	return value;
}
