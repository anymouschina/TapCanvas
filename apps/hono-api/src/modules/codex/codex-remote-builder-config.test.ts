import { describe, expect, it } from "vitest";
import {
	codexRemoteBuilderConfigFingerprint,
	resolveCodexRemoteBuilderConfig,
	resolveCodexVercelCredentials,
	type CodexRemoteBuilderEnvironment,
} from "./codex-remote-builder-config";

function environment(
	overrides: Partial<CodexRemoteBuilderEnvironment> = {},
): CodexRemoteBuilderEnvironment {
	return {
		REDIS_URL: "redis://127.0.0.1:6379",
		CODEX_REMOTE_BUILD_PROVIDER: "vercel-sandbox",
		VERCEL_TOKEN: "vercel-token",
		VERCEL_TEAM_ID: "team-id",
		VERCEL_PROJECT_ID: "project-id",
		CODEX_SOURCE_S3_ACCESS_KEY_ID: "source-access-key",
		CODEX_SOURCE_S3_SECRET_ACCESS_KEY: "source-secret-key",
		CODEX_SOURCE_S3_ENDPOINT_URL: "https://s3.example.com",
		CODEX_SOURCE_S3_REGION: "auto",
		CODEX_SOURCE_S3_BUCKET: "private-source-bucket",
		CODEX_REMOTE_BUILD_ENVELOPE_KEY: Buffer.alloc(32, 7).toString(
			"base64",
		),
		...overrides,
	};
}

describe("Codex remote builder configuration", () => {
	it("resolves a complete access-token credential mode", () => {
		const config = resolveCodexRemoteBuilderConfig(environment());
		expect(config.credentialMode).toBe("access-token");
		expect(config.credentials).toEqual({
			token: "vercel-token",
			teamId: "team-id",
			projectId: "project-id",
		});
		expect(config.redisUrl).toBe("redis://127.0.0.1:6379");
	});

	it("resolves OIDC only when the access-token mode is entirely absent", () => {
		const env = environment({
			VERCEL_OIDC_TOKEN: "oidc-token",
			VERCEL_TOKEN: undefined,
			VERCEL_TEAM_ID: undefined,
			VERCEL_PROJECT_ID: undefined,
		});
		expect(resolveCodexVercelCredentials(env)).toEqual({});
		expect(resolveCodexRemoteBuilderConfig(env).credentialMode).toBe("oidc");
	});

	it("rejects mixed Vercel credential modes", () => {
		expect(() =>
			resolveCodexRemoteBuilderConfig(
				environment({ VERCEL_OIDC_TOKEN: "oidc-token" }),
			),
		).toThrow(/exactly one mode/u);
	});

	it("reports every missing access-token credential field", () => {
		expect(() =>
			resolveCodexRemoteBuilderConfig(
				environment({
					VERCEL_TEAM_ID: undefined,
					VERCEL_PROJECT_ID: undefined,
				}),
			),
		).toThrow(/VERCEL_TEAM_ID, VERCEL_PROJECT_ID/u);
	});

	it("rejects non-canonical envelope keys and non-Redis queue URLs", () => {
		expect(() =>
			resolveCodexRemoteBuilderConfig(
				environment({ CODEX_REMOTE_BUILD_ENVELOPE_KEY: "not-base64" }),
			),
		).toThrow(/canonical base64-encoded 32-byte key/u);
		expect(() =>
			resolveCodexRemoteBuilderConfig(
				environment({ REDIS_URL: "https://redis.example.com" }),
			),
		).toThrow(/must use redis:\/\/ or rediss:\/\//u);
	});

	it("creates a deterministic secret-safe fingerprint over the complete config", () => {
		const first = codexRemoteBuilderConfigFingerprint(environment());
		const second = codexRemoteBuilderConfigFingerprint(environment());
		const changedStorage = codexRemoteBuilderConfigFingerprint(
			environment({ CODEX_SOURCE_S3_BUCKET: "another-private-bucket" }),
		);
		const changedCredential = codexRemoteBuilderConfigFingerprint(
			environment({ VERCEL_TOKEN: "another-token" }),
		);

		expect(first).toMatch(/^[a-f0-9]{64}$/u);
		expect(second).toBe(first);
		expect(changedStorage).not.toBe(first);
		expect(changedCredential).not.toBe(first);
		expect(first).not.toContain("vercel-token");
		expect(first).not.toContain("source-secret-key");
	});
});
