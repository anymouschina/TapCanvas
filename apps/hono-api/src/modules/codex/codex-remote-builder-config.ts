import { createHmac } from "node:crypto";
import type { WorkerEnv } from "../../types";
import {
	resolveCodexSourceStorageConfig,
	type CodexSourceStorageConfig,
	type CodexSourceStorageEnvironment,
} from "./codex-source-storage";

const CONFIG_FINGERPRINT_VERSION = "codex-remote-builder-config-v1";

export type CodexRemoteBuilderEnvironment = CodexSourceStorageEnvironment &
	Pick<
		WorkerEnv,
		| "REDIS_URL"
		| "CODEX_REMOTE_BUILD_ENVELOPE_KEY"
		| "CODEX_REMOTE_BUILD_PROVIDER"
		| "VERCEL_OIDC_TOKEN"
		| "VERCEL_TOKEN"
		| "VERCEL_TEAM_ID"
		| "VERCEL_PROJECT_ID"
	>;

export type CodexVercelCredentials = {
	token?: string;
	teamId?: string;
	projectId?: string;
};

export type CodexVercelCredentialMode = "oidc" | "access-token";

export type CodexRemoteBuilderConfig = {
	provider: "vercel-sandbox";
	redisUrl: string;
	credentials: CodexVercelCredentials;
	credentialMode: CodexVercelCredentialMode;
	storage: CodexSourceStorageConfig;
	envelopeKey: Buffer;
};

export function codexRemoteBuilderEnvironmentFromProcess(
	source: NodeJS.ProcessEnv = process.env,
): CodexRemoteBuilderEnvironment {
	return {
		REDIS_URL: source.REDIS_URL,
		CODEX_REMOTE_BUILD_ENVELOPE_KEY:
			source.CODEX_REMOTE_BUILD_ENVELOPE_KEY,
		CODEX_REMOTE_BUILD_PROVIDER: source.CODEX_REMOTE_BUILD_PROVIDER,
		VERCEL_OIDC_TOKEN: source.VERCEL_OIDC_TOKEN,
		VERCEL_TOKEN: source.VERCEL_TOKEN,
		VERCEL_TEAM_ID: source.VERCEL_TEAM_ID,
		VERCEL_PROJECT_ID: source.VERCEL_PROJECT_ID,
		CODEX_SOURCE_S3_ACCESS_KEY_ID:
			source.CODEX_SOURCE_S3_ACCESS_KEY_ID,
		CODEX_SOURCE_S3_SECRET_ACCESS_KEY:
			source.CODEX_SOURCE_S3_SECRET_ACCESS_KEY,
		CODEX_SOURCE_S3_SESSION_TOKEN:
			source.CODEX_SOURCE_S3_SESSION_TOKEN,
		CODEX_SOURCE_S3_ENDPOINT_URL:
			source.CODEX_SOURCE_S3_ENDPOINT_URL,
		CODEX_SOURCE_S3_REGION: source.CODEX_SOURCE_S3_REGION,
		CODEX_SOURCE_S3_BUCKET: source.CODEX_SOURCE_S3_BUCKET,
	};
}

function read(
	env: CodexRemoteBuilderEnvironment,
	name: keyof CodexRemoteBuilderEnvironment,
): string {
	const value = env[name];
	return typeof value === "string" ? value.trim() : "";
}

function resolveRedisUrl(env: CodexRemoteBuilderEnvironment): string {
	const value = read(env, "REDIS_URL");
	if (!value) {
		throw new Error("REDIS_URL is required for the Codex remote build queue");
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("REDIS_URL must be an absolute redis:// or rediss:// URL");
	}
	if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
		throw new Error("REDIS_URL must use redis:// or rediss://");
	}
	return value;
}

function resolveEnvelopeKey(env: CodexRemoteBuilderEnvironment): Buffer {
	const value = read(env, "CODEX_REMOTE_BUILD_ENVELOPE_KEY");
	const decoded = Buffer.from(value, "base64");
	if (
		!value ||
		decoded.length !== 32 ||
		decoded.toString("base64") !== value
	) {
		throw new Error(
			"CODEX_REMOTE_BUILD_ENVELOPE_KEY must be a canonical base64-encoded 32-byte key",
		);
	}
	return decoded;
}

export function resolveCodexVercelCredentials(
	env: CodexRemoteBuilderEnvironment,
): CodexVercelCredentials {
	const oidcToken = read(env, "VERCEL_OIDC_TOKEN");
	const token = read(env, "VERCEL_TOKEN");
	const teamId = read(env, "VERCEL_TEAM_ID");
	const projectId = read(env, "VERCEL_PROJECT_ID");
	const accessTokenValues = [token, teamId, projectId];

	if (oidcToken && accessTokenValues.some(Boolean)) {
		throw new Error(
			"Vercel credentials must use exactly one mode: VERCEL_OIDC_TOKEN, or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID",
		);
	}
	if (oidcToken) return {};

	const missing = [
		["VERCEL_TOKEN", token],
		["VERCEL_TEAM_ID", teamId],
		["VERCEL_PROJECT_ID", projectId],
	]
		.filter((entry) => !entry[1])
		.map((entry) => entry[0]);
	if (missing.length > 0) {
		throw new Error(
			`Vercel access-token credentials are incomplete: missing ${missing.join(", ")}`,
		);
	}
	return { token, teamId, projectId };
}

export function resolveCodexRemoteBuilderConfig(
	env: CodexRemoteBuilderEnvironment,
): CodexRemoteBuilderConfig {
	const provider = read(env, "CODEX_REMOTE_BUILD_PROVIDER");
	if (provider !== "vercel-sandbox") {
		throw new Error(
			"CODEX_REMOTE_BUILD_PROVIDER must be explicitly set to vercel-sandbox",
		);
	}
	const credentials = resolveCodexVercelCredentials(env);
	return {
		provider,
		redisUrl: resolveRedisUrl(env),
		credentials,
		credentialMode: read(env, "VERCEL_OIDC_TOKEN")
			? "oidc"
			: "access-token",
		storage: resolveCodexSourceStorageConfig(env),
		envelopeKey: resolveEnvelopeKey(env),
	};
}

export function codexRemoteBuilderConfigFingerprint(
	env: CodexRemoteBuilderEnvironment,
): string {
	const config = resolveCodexRemoteBuilderConfig(env);
	const credentialMaterial =
		config.credentialMode === "oidc"
			? { oidcToken: read(env, "VERCEL_OIDC_TOKEN") }
			: config.credentials;
	const canonicalFacts = JSON.stringify({
		version: CONFIG_FINGERPRINT_VERSION,
		provider: config.provider,
		redisUrl: config.redisUrl,
		credentialMode: config.credentialMode,
		credentialMaterial,
		storage: config.storage,
	});
	return createHmac("sha256", config.envelopeKey)
		.update(canonicalFacts)
		.digest("hex");
}

export function assertCodexRemoteBuilderConfigured(
	env: CodexRemoteBuilderEnvironment,
): void {
	resolveCodexRemoteBuilderConfig(env);
}
