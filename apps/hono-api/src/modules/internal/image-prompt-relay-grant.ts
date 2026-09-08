import type {
	ImagePromptSpecialistErrorCode,
	ImagePromptSpecialistModelBindingV1,
} from "./image-prompt-contract";
import {
	takeRedisValueOnce,
	type InternalRedisIdempotencyCommands,
} from "./image-prompt-idempotency";

const encoder = new TextEncoder();
const GRANT_VERSION = "image-prompt-relay-grant/v1";
const GRANT_KEY_PREFIX = "image-prompt-specialist:relay-grant:v1:";
const MAX_IDENTITY_LENGTH = 160;
export const IMAGE_PROMPT_RELAY_GRANT_TTL_SECONDS = 120;

export interface ImagePromptRelayGrantStore {
	setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
	take(key: string): Promise<string | null>;
}

export type ImagePromptRelayGrantBindingV1 = {
	schemaVersion: typeof GRANT_VERSION;
	correlationId: string;
	generationTaskId: string;
	commercialContext: {
		generationTaskId: string;
		billingOrderId: string;
		quoteFingerprint: string;
	};
	promptModel: ImagePromptSpecialistModelBindingV1;
	expiresAt: string;
};

export type ImagePromptRelayGrantExpectedBindingV1 = Pick<
	ImagePromptRelayGrantBindingV1,
	"correlationId" | "generationTaskId" | "promptModel"
>;

export type ImagePromptRelayGrantInputV1 = ImagePromptRelayGrantExpectedBindingV1 &
	Pick<ImagePromptRelayGrantBindingV1, "commercialContext">;

export class ImagePromptRelayGrantFailure extends Error {
	readonly code: ImagePromptSpecialistErrorCode;

	constructor(code: ImagePromptSpecialistErrorCode, message: string) {
		super(message);
		this.name = "ImagePromptRelayGrantFailure";
		this.code = code;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function isIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_IDENTITY_LENGTH &&
		value.trim() === value
	);
}

function parsePromptModel(value: unknown): ImagePromptSpecialistModelBindingV1 | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"catalogRecordId",
			"modelKey",
			"configurationRevision",
			"providerEndpointVersionId",
			"providerCredentialVersionId",
		]) ||
		!isIdentity(value.catalogRecordId) ||
		!isIdentity(value.modelKey) ||
		!isIdentity(value.configurationRevision) ||
		!isIdentity(value.providerEndpointVersionId) ||
		!isIdentity(value.providerCredentialVersionId)
	) {
		return null;
	}
	return {
		catalogRecordId: value.catalogRecordId,
		modelKey: value.modelKey,
		configurationRevision: value.configurationRevision,
		providerEndpointVersionId: value.providerEndpointVersionId,
		providerCredentialVersionId: value.providerCredentialVersionId,
	};
}

function validateInput(input: ImagePromptRelayGrantInputV1): void {
	if (
		!isIdentity(input.correlationId) ||
		!isIdentity(input.generationTaskId) ||
		!isRecord(input.commercialContext) ||
		!isIdentity(input.commercialContext.generationTaskId) ||
		input.commercialContext.generationTaskId !== input.generationTaskId ||
		!isIdentity(input.commercialContext.billingOrderId) ||
		!isIdentity(input.commercialContext.quoteFingerprint) ||
		parsePromptModel(input.promptModel) === null
	) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_model_binding_invalid",
			"relay grant binding is invalid",
		);
	}
}

function parseStoredBinding(raw: string): ImagePromptRelayGrantBindingV1 {
	let value: unknown;
	try {
		value = JSON.parse(raw) as unknown;
	} catch {
		throw new ImagePromptRelayGrantFailure(
			"specialist_auth_invalid",
			"relay grant record is not valid JSON",
		);
	}
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"schemaVersion",
			"correlationId",
			"generationTaskId",
			"commercialContext",
			"promptModel",
			"expiresAt",
		]) ||
		value.schemaVersion !== GRANT_VERSION ||
		!isIdentity(value.correlationId) ||
		!isIdentity(value.generationTaskId) ||
		typeof value.expiresAt !== "string" ||
		!Number.isFinite(Date.parse(value.expiresAt))
	) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_auth_invalid",
			"relay grant record is invalid",
		);
	}
	if (
		!isRecord(value.commercialContext) ||
		!hasExactKeys(value.commercialContext, [
			"generationTaskId",
			"billingOrderId",
			"quoteFingerprint",
		]) ||
		!isIdentity(value.commercialContext.generationTaskId) ||
		value.commercialContext.generationTaskId !== value.generationTaskId ||
		!isIdentity(value.commercialContext.billingOrderId) ||
		!isIdentity(value.commercialContext.quoteFingerprint)
	) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_auth_invalid",
			"relay grant commercial binding is invalid",
		);
	}
	const promptModel = parsePromptModel(value.promptModel);
	if (promptModel === null) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_auth_invalid",
			"relay grant model binding is invalid",
		);
	}
	return {
		schemaVersion: GRANT_VERSION,
		correlationId: value.correlationId,
		generationTaskId: value.generationTaskId,
		commercialContext: {
			generationTaskId: value.commercialContext.generationTaskId,
			billingOrderId: value.commercialContext.billingOrderId,
			quoteFingerprint: value.commercialContext.quoteFingerprint,
		},
		promptModel,
		expiresAt: value.expiresAt,
	};
}

function modelBindingsEqual(
	expected: ImagePromptSpecialistModelBindingV1,
	actual: ImagePromptSpecialistModelBindingV1,
): boolean {
	return (
		expected.catalogRecordId === actual.catalogRecordId &&
		expected.modelKey === actual.modelKey &&
		expected.configurationRevision === actual.configurationRevision &&
		expected.providerEndpointVersionId === actual.providerEndpointVersionId &&
		expected.providerCredentialVersionId === actual.providerCredentialVersionId
	);
}

function isValidDate(value: Date): boolean {
	return Number.isFinite(value.getTime());
}

function createGrant(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storageKey(grant: string): Promise<string> {
	if (!/^[A-Za-z0-9_-]{43}$/u.test(grant)) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_auth_invalid",
			"relay grant token is invalid",
		);
	}
	return `${GRANT_KEY_PREFIX}${await sha256Hex(grant)}`;
}

async function storeOperation<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof ImagePromptRelayGrantFailure) throw error;
		throw new ImagePromptRelayGrantFailure(
			"specialist_unavailable",
			`relay grant store unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function issueImagePromptRelayGrant(
	store: ImagePromptRelayGrantStore,
	binding: ImagePromptRelayGrantInputV1,
	now: Date,
): Promise<{ grant: string; expiresAt: string }> {
	validateInput(binding);
	if (!isValidDate(now)) {
		throw new ImagePromptRelayGrantFailure("specialist_request_invalid", "grant time is invalid");
	}
	const grant = createGrant();
	const expiresAt = new Date(
		now.getTime() + IMAGE_PROMPT_RELAY_GRANT_TTL_SECONDS * 1000,
	).toISOString();
	const record: ImagePromptRelayGrantBindingV1 = {
		schemaVersion: GRANT_VERSION,
		...binding,
		expiresAt,
	};
	const key = await storageKey(grant);
	const stored = await storeOperation(() =>
		store.setIfAbsent(key, JSON.stringify(record), IMAGE_PROMPT_RELAY_GRANT_TTL_SECONDS),
	);
	if (!stored) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_unavailable",
			"relay grant token collision was rejected",
		);
	}
	return { grant, expiresAt };
}

export async function consumeImagePromptRelayGrant(
	store: ImagePromptRelayGrantStore,
	grant: string,
	now: Date,
): Promise<ImagePromptRelayGrantBindingV1> {
	if (!isValidDate(now)) {
		throw new ImagePromptRelayGrantFailure("specialist_request_invalid", "grant time is invalid");
	}
	const key = await storageKey(grant);
	const raw = await storeOperation(() => store.take(key));
	if (raw === null) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_replay_rejected",
			"relay grant is missing, expired, or already consumed",
		);
	}
	const record = parseStoredBinding(raw);
	if (Date.parse(record.expiresAt) <= now.getTime()) {
		throw new ImagePromptRelayGrantFailure("specialist_auth_invalid", "relay grant has expired");
	}
	return record;
}

export function verifyImagePromptRelayGrantBinding(
	record: ImagePromptRelayGrantBindingV1,
	expected: ImagePromptRelayGrantExpectedBindingV1,
): void {
	if (
		!isIdentity(expected.correlationId) ||
		!isIdentity(expected.generationTaskId) ||
		parsePromptModel(expected.promptModel) === null
	) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_model_binding_invalid",
			"relay grant expected binding is invalid",
		);
	}
	if (
		record.correlationId !== expected.correlationId ||
		record.generationTaskId !== expected.generationTaskId
	) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_auth_invalid",
			"relay grant request binding does not match",
		);
	}
	if (!modelBindingsEqual(record.promptModel, expected.promptModel)) {
		throw new ImagePromptRelayGrantFailure(
			"specialist_model_inheritance_failed",
			"relay grant model binding does not match",
		);
	}
}

export function createRedisImagePromptRelayGrantStore(
	redis: InternalRedisIdempotencyCommands,
): ImagePromptRelayGrantStore {
	return {
		setIfAbsent: async (key, value, ttlSeconds) =>
			(await redis.set(key, value, "EX", ttlSeconds, "NX")) === "OK",
		take: (key) => takeRedisValueOnce(redis, key),
	};
}
