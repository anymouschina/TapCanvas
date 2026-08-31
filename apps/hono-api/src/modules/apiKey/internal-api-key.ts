import { createHmac, timingSafeEqual } from "node:crypto";

export type InternalApiKeyIdentity = Readonly<{
	userId: string;
	apiKeyId: string | null;
}>;

export type BuildInternalApiKeyInput = Readonly<{
	internalWorkerToken: string;
	userId: string;
	apiKeyId?: string | null;
}>;

const INTERNAL_API_KEY_PREFIX = "tc_internal:";
const INTERNAL_API_KEY_VERSION_PREFIX = `${INTERNAL_API_KEY_PREFIX}v2:`;
const INTERNAL_API_KEY_TTL_MS = 60 * 60 * 1000;
const INTERNAL_API_KEY_CLOCK_SKEW_MS = 60 * 1000;

function normalizeIdentityPart(value: string | null | undefined): string {
	return typeof value === "string" ? value.trim() : "";
}

function encodePart(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string): string | null {
	if (!value) return null;
	try {
		return Buffer.from(value, "base64url").toString("utf8");
	} catch {
		return null;
	}
}

function signPart(value: string, secret: string): string {
	return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function signaturesMatch(provided: string, expected: string): boolean {
	try {
		const providedBytes = Buffer.from(provided, "base64url");
		const expectedBytes = Buffer.from(expected, "base64url");
		return providedBytes.byteLength === expectedBytes.byteLength
			&& timingSafeEqual(providedBytes, expectedBytes);
	} catch {
		return false;
	}
}

/**
 * Builds the server-to-server credential used by trusted workers to execute as
 * an already authenticated user. apiKeyId is attribution and revocation
 * evidence. The worker secret signs the short-lived payload but is never
 * embedded in the credential, persisted, or exposed to the delegated process.
 */
export function buildInternalApiKey(input: BuildInternalApiKeyInput): string | null {
	const internalWorkerToken = normalizeIdentityPart(input.internalWorkerToken);
	const userId = normalizeIdentityPart(input.userId);
	const apiKeyId = normalizeIdentityPart(input.apiKeyId);
	if (!internalWorkerToken || !userId) return null;
	const issuedAt = Date.now();
	const identity = JSON.stringify({
		version: 2,
		userId,
		...(apiKeyId ? { apiKeyId } : {}),
		issuedAt,
		expiresAt: issuedAt + INTERNAL_API_KEY_TTL_MS,
	});
	const payload = encodePart(identity);
	return `${INTERNAL_API_KEY_VERSION_PREFIX}${payload}:${signPart(payload, internalWorkerToken)}`;
}

/**
 * Verifies an internal credential against the process-local worker token and
 * returns only its delegated identity. The worker token itself is never
 * returned or logged.
 */
export function parseInternalApiKey(
	apiKey: string,
	expectedInternalWorkerToken: string,
): InternalApiKeyIdentity | null {
	const expectedToken = normalizeIdentityPart(expectedInternalWorkerToken);
	const candidate = normalizeIdentityPart(apiKey);
	if (!expectedToken || !candidate.startsWith(INTERNAL_API_KEY_VERSION_PREFIX)) return null;
	const encodedParts = candidate.slice(INTERNAL_API_KEY_VERSION_PREFIX.length).split(":");
	if (encodedParts.length !== 2) return null;
	const payload = encodedParts[0] ?? "";
	const providedSignature = encodedParts[1] ?? "";
	if (!payload || !providedSignature) return null;
	const expectedSignature = signPart(payload, expectedToken);
	if (!signaturesMatch(providedSignature, expectedSignature)) return null;
	const identityJson = decodePart(payload);
	if (!identityJson) return null;
	let identity: unknown;
	try {
		identity = JSON.parse(identityJson) as unknown;
	} catch {
		return null;
	}
	if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
	const record = identity as Record<string, unknown>;
	const version = typeof record.version === "number" ? record.version : null;
	const issuedAt = typeof record.issuedAt === "number" ? record.issuedAt : null;
	const expiresAt = typeof record.expiresAt === "number" ? record.expiresAt : null;
	const now = Date.now();
	if (
		version !== 2
		|| issuedAt === null
		|| expiresAt === null
		|| !Number.isFinite(issuedAt)
		|| !Number.isFinite(expiresAt)
		|| issuedAt > now + INTERNAL_API_KEY_CLOCK_SKEW_MS
		|| expiresAt <= now
		|| expiresAt - issuedAt !== INTERNAL_API_KEY_TTL_MS
	) return null;
	const userId = normalizeIdentityPart(
		typeof record.userId === "string" ? record.userId : null,
	);
	const apiKeyId = normalizeIdentityPart(
		typeof record.apiKeyId === "string" ? record.apiKeyId : null,
	);
	if (!userId) return null;
	return { userId, apiKeyId: apiKeyId || null };
}

export function isInternalApiKey(value: string | null | undefined): boolean {
	return typeof value === "string" && value.trim().startsWith(INTERNAL_API_KEY_PREFIX);
}
