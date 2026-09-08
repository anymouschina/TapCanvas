import type { WorkerEnv } from "../../types";
import { ImagePromptSpecialistGatewayFailure } from "./image-prompt-specialist.service";

const DEFAULT_AGENTS_TIMEOUT_MS = 90_000;
const MIN_PRIVATE_SECRET_BYTES = 32;
const MAX_PRIVATE_SECRET_BYTES = 512;
const encoder = new TextEncoder();

export type ImagePromptRuntimeConfig = {
	inbound: {
		serviceId: string;
		hmacSecret: string;
	};
	agents: {
		baseUrl: string;
		token: string;
		timeoutMs: number;
	};
	hmaigcRelay: {
		url: string;
		serviceId: string;
		hmacSecret: string;
	};
};

function readEnv(env: WorkerEnv, key: keyof WorkerEnv): string {
	const value = env[key];
	return typeof value === "string" ? value.trim() : "";
}

function requireEnv(env: WorkerEnv, key: keyof WorkerEnv): string {
	const value = readEnv(env, key);
	if (!value) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_unavailable",
			`${String(key)} is required`,
		);
	}
	return value;
}

function requirePrivateSecret(env: WorkerEnv, key: keyof WorkerEnv): string {
	const value = requireEnv(env, key);
	const byteLength = encoder.encode(value).byteLength;
	if (byteLength < MIN_PRIVATE_SECRET_BYTES || byteLength > MAX_PRIVATE_SECRET_BYTES) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_unavailable",
			`${String(key)} must contain ${MIN_PRIVATE_SECRET_BYTES}-${MAX_PRIVATE_SECRET_BYTES} UTF-8 bytes`,
		);
	}
	return value;
}

function parseTimeout(raw: string): number {
	if (!raw) return DEFAULT_AGENTS_TIMEOUT_MS;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1_000 || value > 120_000) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_unavailable",
			"IMAGE_PROMPT_AGENTS_TIMEOUT_MS must be an integer from 1000 to 120000",
		);
	}
	return value;
}

function requireDistinctSecrets(entries: ReadonlyArray<readonly [string, string]>): void {
	for (let left = 0; left < entries.length; left += 1) {
		for (let right = left + 1; right < entries.length; right += 1) {
			if (entries[left]?.[1] === entries[right]?.[1]) {
				throw new ImagePromptSpecialistGatewayFailure(
					"specialist_unavailable",
					`${entries[left]?.[0]} and ${entries[right]?.[0]} must use distinct secrets`,
				);
			}
		}
	}
}

export function requireImagePromptRuntimeConfig(env: WorkerEnv): ImagePromptRuntimeConfig {
	const inboundHmacSecret = requirePrivateSecret(env, "IMAGE_PROMPT_HMAC_SECRET");
	const agentsToken = requirePrivateSecret(env, "IMAGE_PROMPT_AGENTS_TOKEN");
	const hmaigcRelayHmacSecret = requirePrivateSecret(
		env,
		"IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET",
	);
	requireDistinctSecrets([
		["IMAGE_PROMPT_HMAC_SECRET", inboundHmacSecret],
		["IMAGE_PROMPT_AGENTS_TOKEN", agentsToken],
		["IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET", hmaigcRelayHmacSecret],
	]);
	return {
		inbound: {
			serviceId: requireEnv(env, "IMAGE_PROMPT_HMAC_SERVICE_ID"),
			hmacSecret: inboundHmacSecret,
		},
		agents: {
			baseUrl: requireEnv(env, "IMAGE_PROMPT_AGENTS_BASE_URL"),
			token: agentsToken,
			timeoutMs: parseTimeout(readEnv(env, "IMAGE_PROMPT_AGENTS_TIMEOUT_MS")),
		},
		hmaigcRelay: {
			url: requireEnv(env, "IMAGE_PROMPT_HMAIGC_RELAY_URL"),
			serviceId: requireEnv(env, "IMAGE_PROMPT_HMAIGC_RELAY_SERVICE_ID"),
			hmacSecret: hmaigcRelayHmacSecret,
		},
	};
}
