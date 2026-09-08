import type { ImagePromptSpecialistErrorCode } from "./image-prompt-contract";

const encoder = new TextEncoder();

export const INTERNAL_SPECIALIST_AUTH_HEADERS = {
	serviceId: "x-tapcanvas-service-id",
	timestamp: "x-tapcanvas-timestamp",
	nonce: "x-tapcanvas-nonce",
	bodyDigest: "x-tapcanvas-body-sha256",
	idempotencyKey: "x-tapcanvas-idempotency-key",
	signature: "x-tapcanvas-signature",
} as const;

const SIGNATURE_VERSION = "tapcanvas-internal-request/v1";
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_NONCE_TTL_SECONDS = 120;

export type InternalSpecialistAuthHeaders = Record<string, string>;

export interface InternalNonceStore {
	claim(key: string, ttlSeconds: number): Promise<boolean>;
}

type InternalSpecialistSignatureInput = {
	serviceId: string;
	secret: string;
	method: string;
	path: string;
	body: string;
	idempotencyKey: string;
	timestampSeconds: number;
	nonce: string;
};

type InternalSpecialistVerificationInput = {
	serviceId: string;
	secret: string;
	method: string;
	path: string;
	body: string;
	idempotencyKey: string;
	headers: Record<string, string | undefined>;
	nonceStore: InternalNonceStore;
	nowMs?: number;
	maxClockSkewSeconds?: number;
	nonceTtlSeconds?: number;
};

export class InternalRequestAuthFailure extends Error {
	readonly code: ImagePromptSpecialistErrorCode;

	constructor(code: ImagePromptSpecialistErrorCode, message: string) {
		super(message);
		this.name = "InternalRequestAuthFailure";
		this.code = code;
	}
}

function requireBoundedText(value: string, name: string, maxLength: number): string {
	const normalized = value.trim();
	if (!normalized || normalized.length > maxLength) {
		throw new InternalRequestAuthFailure(
			"specialist_auth_invalid",
			`${name} is missing or invalid`,
		);
	}
	return normalized;
}

function requireHmacSecret(value: string): string {
	const secret = requireBoundedText(value, "HMAC secret", 512);
	if (encoder.encode(secret).byteLength < 32) {
		throw new InternalRequestAuthFailure(
			"specialist_auth_invalid",
			"HMAC secret must contain at least 32 UTF-8 bytes",
		);
	}
	return secret;
}

function bytesToHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
	return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function constantTimeSecretEqual(left: string, right: string): boolean {
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	let difference = leftBytes.length ^ rightBytes.length;
	const length = Math.max(leftBytes.length, rightBytes.length);
	for (let index = 0; index < length; index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return difference === 0;
}

function canonicalPayload(input: {
	serviceId: string;
	timestampSeconds: number;
	nonce: string;
	method: string;
	path: string;
	bodyDigest: string;
	idempotencyKey: string;
}): string {
	return [
		SIGNATURE_VERSION,
		input.serviceId,
		String(input.timestampSeconds),
		input.nonce,
		input.method.toUpperCase(),
		input.path,
		input.bodyDigest,
		input.idempotencyKey,
	].join("\n");
}

function readHeader(headers: Record<string, string | undefined>, name: string): string {
	const direct = headers[name];
	if (typeof direct === "string") return direct.trim();
	const matchedKey = Object.keys(headers).find((key) => key.toLowerCase() === name);
	return matchedKey && typeof headers[matchedKey] === "string" ? headers[matchedKey]?.trim() ?? "" : "";
}

function parseTimestampSeconds(raw: string): number {
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0 || String(value) !== raw) {
		throw new InternalRequestAuthFailure(
			"specialist_auth_invalid",
			"request timestamp is invalid",
		);
	}
	return value;
}

export async function signInternalSpecialistRequest(
	input: InternalSpecialistSignatureInput,
): Promise<InternalSpecialistAuthHeaders> {
	const serviceId = requireBoundedText(input.serviceId, "service id", 128);
	const secret = requireHmacSecret(input.secret);
	const nonce = requireBoundedText(input.nonce, "nonce", 192);
	const idempotencyKey = requireBoundedText(input.idempotencyKey, "idempotency key", 256);
	const method = requireBoundedText(input.method, "method", 16).toUpperCase();
	const path = requireBoundedText(input.path, "path", 512);
	if (!Number.isSafeInteger(input.timestampSeconds) || input.timestampSeconds <= 0) {
		throw new InternalRequestAuthFailure("specialist_auth_invalid", "request timestamp is invalid");
	}
	const bodyDigest = await sha256Hex(input.body);
	const signature = await hmacSha256Hex(
		secret,
		canonicalPayload({
			serviceId,
			timestampSeconds: input.timestampSeconds,
			nonce,
			method,
			path,
			bodyDigest,
			idempotencyKey,
		}),
	);
	return {
		[INTERNAL_SPECIALIST_AUTH_HEADERS.serviceId]: serviceId,
		[INTERNAL_SPECIALIST_AUTH_HEADERS.timestamp]: String(input.timestampSeconds),
		[INTERNAL_SPECIALIST_AUTH_HEADERS.nonce]: nonce,
		[INTERNAL_SPECIALIST_AUTH_HEADERS.bodyDigest]: bodyDigest,
		[INTERNAL_SPECIALIST_AUTH_HEADERS.idempotencyKey]: idempotencyKey,
		[INTERNAL_SPECIALIST_AUTH_HEADERS.signature]: `v1=${signature}`,
	};
}

export async function verifyInternalSpecialistRequest(
	input: InternalSpecialistVerificationInput,
): Promise<{
	serviceId: string;
	idempotencyKey: string;
	bodyDigest: string;
	timestampSeconds: number;
	nonce: string;
}> {
	const expectedServiceId = requireBoundedText(input.serviceId, "service id", 128);
	const secret = requireHmacSecret(input.secret);
	const expectedIdempotencyKey = requireBoundedText(
		input.idempotencyKey,
		"idempotency key",
		256,
	);
	const serviceId = readHeader(input.headers, INTERNAL_SPECIALIST_AUTH_HEADERS.serviceId);
	const nonce = readHeader(input.headers, INTERNAL_SPECIALIST_AUTH_HEADERS.nonce);
	const bodyDigest = readHeader(input.headers, INTERNAL_SPECIALIST_AUTH_HEADERS.bodyDigest);
	const headerIdempotencyKey = readHeader(
		input.headers,
		INTERNAL_SPECIALIST_AUTH_HEADERS.idempotencyKey,
	);
	const timestampSeconds = parseTimestampSeconds(
		readHeader(input.headers, INTERNAL_SPECIALIST_AUTH_HEADERS.timestamp),
	);
	const signature = readHeader(input.headers, INTERNAL_SPECIALIST_AUTH_HEADERS.signature);

	if (
		!constantTimeSecretEqual(serviceId, expectedServiceId) ||
		!constantTimeSecretEqual(headerIdempotencyKey, expectedIdempotencyKey) ||
		!nonce ||
		nonce.length > 192 ||
		!bodyDigest ||
		!signature.startsWith("v1=")
	) {
		throw new InternalRequestAuthFailure("specialist_auth_invalid", "request authentication failed");
	}

	const nowMs = input.nowMs ?? Date.now();
	const maxSkewSeconds = input.maxClockSkewSeconds ?? DEFAULT_MAX_CLOCK_SKEW_SECONDS;
	if (Math.abs(Math.trunc(nowMs / 1_000) - timestampSeconds) > maxSkewSeconds) {
		throw new InternalRequestAuthFailure("specialist_auth_invalid", "request timestamp expired");
	}

	const actualBodyDigest = await sha256Hex(input.body);
	if (!constantTimeSecretEqual(bodyDigest, actualBodyDigest)) {
		throw new InternalRequestAuthFailure("specialist_auth_invalid", "request body digest mismatch");
	}
	const expectedSignature = await hmacSha256Hex(
		secret,
		canonicalPayload({
			serviceId,
			timestampSeconds,
			nonce,
			method: requireBoundedText(input.method, "method", 16),
			path: requireBoundedText(input.path, "path", 512),
			bodyDigest,
			idempotencyKey: headerIdempotencyKey,
		}),
	);
	if (!constantTimeSecretEqual(signature, `v1=${expectedSignature}`)) {
		throw new InternalRequestAuthFailure("specialist_auth_invalid", "request authentication failed");
	}

	let claimed = false;
	try {
		claimed = await input.nonceStore.claim(
			`image-prompt-specialist:nonce:${serviceId}:${nonce}`,
			input.nonceTtlSeconds ?? DEFAULT_NONCE_TTL_SECONDS,
		);
	} catch {
		throw new InternalRequestAuthFailure(
			"specialist_unavailable",
			"nonce store unavailable",
		);
	}
	if (!claimed) {
		throw new InternalRequestAuthFailure(
			"specialist_replay_rejected",
			"request nonce was already used",
		);
	}

	return {
		serviceId,
		idempotencyKey: headerIdempotencyKey,
		bodyDigest,
		timestampSeconds,
		nonce,
	};
}

export type InternalRedisSetCommands = {
	set(
		key: string,
		value: string,
		expiryMode: "EX",
		ttlSeconds: number,
		condition: "NX",
	): Promise<unknown>;
};

export function createRedisInternalNonceStore(redis: InternalRedisSetCommands): InternalNonceStore {
	return {
		claim: async (key, ttlSeconds) =>
			(await redis.set(key, "1", "EX", ttlSeconds, "NX")) === "OK",
	};
}
