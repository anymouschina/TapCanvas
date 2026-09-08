import type {
	ImagePromptSpecialistErrorCode,
	ImagePromptSpecialistModelBindingV1,
	ImagePromptSpecialistRequestV1,
} from "./image-prompt-contract";
import { isImagePromptSpecialistErrorCode } from "./image-prompt-contract";

const encoder = new TextEncoder();
const HMAIGC_RELAY_PATH = "/internal/v1/model-relays/image-prompt/chat-completions";
const HMAIGC_RELAY_SIGNATURE_VERSION = "hmaigc-image-prompt-model-relay/v1";
const HMAIGC_RELAY_TIMEOUT_MS = 90_000;
const MAX_PRIVATE_SECRET_BYTES = 512;

export const HMAIGC_IMAGE_PROMPT_RELAY_HEADERS = {
	serviceId: "x-tapcanvas-service-id",
	timestamp: "x-tapcanvas-timestamp",
	nonce: "x-tapcanvas-nonce",
	bodySha256: "x-tapcanvas-body-sha256",
	generationTaskId: "x-tapcanvas-generation-task-id",
	correlationId: "x-tapcanvas-correlation-id",
	signature: "x-tapcanvas-signature",
} as const;

export type ImagePromptModelRelayMessageV1 = {
	role: "system" | "user";
	content: string;
};

export type ImagePromptModelRelayRequestV1 = {
	schemaVersion: "image-prompt-model-relay-request/v1";
	correlationId: string;
	commercialContext: ImagePromptSpecialistRequestV1["commercialContext"];
	promptModel: ImagePromptSpecialistModelBindingV1;
	messages: [ImagePromptModelRelayMessageV1, ImagePromptModelRelayMessageV1];
	tools: [];
	stream: false;
};

export type ImagePromptModelRelayResponseV1 = {
	schemaVersion: "image-prompt-model-relay-response/v1";
	text: string;
	effectiveModel: string;
	providerRequestId: string;
	usage: {
		inputTokens: number;
		cachedTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
};

export interface InternalHmaigcImagePromptModelClient {
	execute(
		request: ImagePromptModelRelayRequestV1,
		abortSignal?: AbortSignal,
	): Promise<ImagePromptModelRelayResponseV1>;
}

export class InternalHmaigcImagePromptModelFailure extends Error {
	readonly code: ImagePromptSpecialistErrorCode;

	constructor(code: ImagePromptSpecialistErrorCode, message: string) {
		super(message);
		this.name = "InternalHmaigcImagePromptModelFailure";
		this.code = code;
	}
}

type ClientInput = {
	url: string;
	serviceId: string;
	secret: string;
	fetchImpl?: typeof fetch;
	now?: () => Date;
	nonce?: () => string;
};

function requireRelayUrl(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value.trim());
	} catch {
		throw new InternalHmaigcImagePromptModelFailure(
			"specialist_unavailable",
			"HMaigc image prompt relay URL is invalid",
		);
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		parsed.pathname !== HMAIGC_RELAY_PATH
	) {
		throw new InternalHmaigcImagePromptModelFailure(
			"specialist_unavailable",
			"HMaigc image prompt relay URL must be the exact private endpoint",
		);
	}
	return parsed.toString();
}

function requireIdentity(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized || normalized.length > 160 || normalized !== value) {
		throw new InternalHmaigcImagePromptModelFailure(
			"specialist_unavailable",
			`${label} is invalid`,
		);
	}
	return normalized;
}

function requireSecret(value: string): Uint8Array {
	const bytes = encoder.encode(value.trim());
	if (bytes.byteLength < 32 || bytes.byteLength > MAX_PRIVATE_SECRET_BYTES) {
		throw new InternalHmaigcImagePromptModelFailure(
			"specialist_unavailable",
			"HMaigc image prompt relay secret length is invalid",
		);
	}
	return bytes;
}

function randomNonce(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

async function sha256Hex(value: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: Uint8Array, value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new Uint8Array(secret).buffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
	return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseRelayResponse(value: unknown): ImagePromptModelRelayResponseV1 {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"schemaVersion",
			"text",
			"effectiveModel",
			"providerRequestId",
			"usage",
		]) ||
		value.schemaVersion !== "image-prompt-model-relay-response/v1" ||
		typeof value.text !== "string" ||
		!value.text.trim() ||
		value.text.length > 131_072 ||
		typeof value.effectiveModel !== "string" ||
		!value.effectiveModel.trim() ||
		typeof value.providerRequestId !== "string" ||
		!value.providerRequestId.trim() ||
		!isRecord(value.usage) ||
		!hasExactKeys(value.usage, ["inputTokens", "cachedTokens", "outputTokens", "totalTokens"]) ||
		!isNonNegativeInteger(value.usage.inputTokens) ||
		!isNonNegativeInteger(value.usage.cachedTokens) ||
		value.usage.cachedTokens > value.usage.inputTokens ||
		!isNonNegativeInteger(value.usage.outputTokens) ||
		!isNonNegativeInteger(value.usage.totalTokens) ||
		value.usage.totalTokens !== value.usage.inputTokens + value.usage.outputTokens
	) {
		throw new InternalHmaigcImagePromptModelFailure(
			"specialist_output_invalid",
			"HMaigc image prompt relay response is invalid",
		);
	}
	return {
		schemaVersion: "image-prompt-model-relay-response/v1",
		text: value.text,
		effectiveModel: value.effectiveModel,
		providerRequestId: value.providerRequestId,
		usage: {
			inputTokens: value.usage.inputTokens,
			cachedTokens: value.usage.cachedTokens,
			outputTokens: value.usage.outputTokens,
			totalTokens: value.usage.totalTokens,
		},
	};
}

function parseFailure(value: unknown): InternalHmaigcImagePromptModelFailure | null {
	if (!isRecord(value) || typeof value.code !== "string") return null;
	if (!isImagePromptSpecialistErrorCode(value.code)) return null;
	const reason = typeof value.reason === "string" ? value.reason.trim().slice(0, 500) : "";
	return new InternalHmaigcImagePromptModelFailure(
		value.code,
		reason || "HMaigc image prompt relay failed",
	);
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

export function createInternalHmaigcImagePromptModelClient(
	input: ClientInput,
): InternalHmaigcImagePromptModelClient {
	const url = requireRelayUrl(input.url);
	const serviceId = requireIdentity(input.serviceId, "HMaigc relay service ID");
	const secret = requireSecret(input.secret);
	const fetchImpl = input.fetchImpl ?? fetch;
	const now = input.now ?? (() => new Date());
	const nonce = input.nonce ?? randomNonce;

	return {
		async execute(request, abortSignal) {
			const body = JSON.stringify(request);
			const bodyBytes = encoder.encode(body);
			const bodyDigest = await sha256Hex(bodyBytes);
			const timestamp = Math.floor(now().getTime() / 1000);
			const requestNonce = requireIdentity(nonce(), "HMaigc relay nonce");
			const canonical = [
				HMAIGC_RELAY_SIGNATURE_VERSION,
				serviceId,
				String(timestamp),
				requestNonce,
				"POST",
				HMAIGC_RELAY_PATH,
				bodyDigest,
				request.commercialContext.generationTaskId,
				request.correlationId,
			].join("\n");
			const hardTimeout = AbortSignal.timeout(HMAIGC_RELAY_TIMEOUT_MS);
			const signal = abortSignal ? AbortSignal.any([abortSignal, hardTimeout]) : hardTimeout;
			let response: Response;
			try {
				response = await fetchImpl(url, {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
						[HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.serviceId]: serviceId,
						[HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.timestamp]: String(timestamp),
						[HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.nonce]: requestNonce,
						[HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.bodySha256]: bodyDigest,
						[HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.generationTaskId]:
							request.commercialContext.generationTaskId,
						[HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.correlationId]: request.correlationId,
						[HMAIGC_IMAGE_PROMPT_RELAY_HEADERS.signature]:
							`v1=${await hmacHex(secret, canonical)}`,
					},
					body,
					signal,
				});
			} catch {
				throw new InternalHmaigcImagePromptModelFailure(
					hardTimeout.aborted ? "specialist_timeout" : "specialist_unavailable",
					"HMaigc image prompt relay request did not complete",
				);
			}
			const decoded = await readJson(response);
			if (!response.ok) {
				throw (
					parseFailure(decoded) ??
					new InternalHmaigcImagePromptModelFailure(
						"specialist_unavailable",
						`HMaigc image prompt relay returned HTTP ${response.status}`,
					)
				);
			}
			return parseRelayResponse(decoded);
		},
	};
}
