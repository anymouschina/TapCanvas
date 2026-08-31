import { describe, expect, it } from "vitest";
import type { CodexRemoteBuilderEnvironment } from "./codex-remote-builder-config";
import {
	assertCodexRemoteBuilderReady,
	clearCodexRemoteBuilderHeartbeat,
	CODEX_REMOTE_BUILDER_HEARTBEAT_TTL_MS,
	publishCodexRemoteBuilderHeartbeat,
	readCodexRemoteBuilderReadiness,
	type CodexRemoteBuilderReadinessRedis,
} from "./codex-remote-builder-readiness";

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
		CODEX_REMOTE_BUILD_ENVELOPE_KEY: Buffer.alloc(32, 9).toString(
			"base64",
		),
		...overrides,
	};
}

function createRedisDouble(): {
	redis: CodexRemoteBuilderReadinessRedis;
	strings: Map<string, string>;
	sortedSets: Map<string, Map<string, number>>;
} {
	const strings = new Map<string, string>();
	const sortedSets = new Map<string, Map<string, number>>();
	const members = (key: string): Map<string, number> => {
		const current = sortedSets.get(key);
		if (current) return current;
		const created = new Map<string, number>();
		sortedSets.set(key, created);
		return created;
	};
	const implementation = {
		del: async (key: string): Promise<number> =>
			strings.delete(key) ? 1 : 0,
		get: async (key: string): Promise<string | null> => strings.get(key) ?? null,
		pexpire: async (): Promise<number> => 1,
		set: async (
			key: string,
			value: string,
			_mode: "PX",
			_ttlMs: number,
		): Promise<"OK"> => {
			strings.set(key, value);
			return "OK";
		},
		zadd: async (
			key: string,
			score: number,
			member: string,
		): Promise<number> => {
			const current = members(key);
			const created = current.has(member) ? 0 : 1;
			current.set(member, score);
			return created;
		},
		zrangebyscore: async (
			key: string,
			minimum: string,
			_maximum: "+inf",
		): Promise<string[]> => {
			const exclusiveMinimum = Number(minimum.slice(1));
			return [...members(key).entries()]
				.filter((entry) => entry[1] > exclusiveMinimum)
				.sort((left, right) => left[1] - right[1])
				.map((entry) => entry[0]);
		},
		zrem: async (key: string, member: string): Promise<number> =>
			members(key).delete(member) ? 1 : 0,
		zremrangebyscore: async (
			key: string,
			_minimum: "-inf",
			maximum: number,
		): Promise<number> => {
			let removed = 0;
			for (const [member, score] of members(key)) {
				if (score > maximum) continue;
				members(key).delete(member);
				removed += 1;
			}
			return removed;
		},
	};
	return {
		redis: implementation as unknown as CodexRemoteBuilderReadinessRedis,
		strings,
		sortedSets,
	};
}

describe("Codex remote builder readiness", () => {
	it("stays offline until a worker publishes a live heartbeat", async () => {
		const { redis } = createRedisDouble();
		const env = environment();

		await expect(
			assertCodexRemoteBuilderReady({ redis, env, nowMs: 10_000 }),
		).rejects.toMatchObject({ name: "CodexRemoteBuilderOfflineError" });

		await publishCodexRemoteBuilderHeartbeat({
			redis,
			env,
			instanceId: "worker-a",
			startedAtMs: 9_000,
			nowMs: 10_000,
		});
		await expect(
			assertCodexRemoteBuilderReady({ redis, env, nowMs: 10_001 }),
		).resolves.toMatchObject({ instanceId: "worker-a" });
	});

	it("does not accept a heartbeat from a different active configuration", async () => {
		const { redis } = createRedisDouble();
		await publishCodexRemoteBuilderHeartbeat({
			redis,
			env: environment(),
			instanceId: "worker-a",
			startedAtMs: 9_000,
			nowMs: 10_000,
		});

		await expect(
			readCodexRemoteBuilderReadiness({
				redis,
				env: environment({
					CODEX_SOURCE_S3_BUCKET: "different-private-bucket",
				}),
				nowMs: 10_001,
			}),
		).resolves.toEqual({ ready: false, reason: "no_live_heartbeat" });
	});

	it("expires a silent worker at the exact TTL boundary", async () => {
		const { redis } = createRedisDouble();
		const env = environment();
		await publishCodexRemoteBuilderHeartbeat({
			redis,
			env,
			instanceId: "worker-a",
			startedAtMs: 9_000,
			nowMs: 10_000,
		});

		await expect(
			readCodexRemoteBuilderReadiness({
				redis,
				env,
				nowMs: 10_000 + CODEX_REMOTE_BUILDER_HEARTBEAT_TTL_MS,
			}),
		).resolves.toEqual({ ready: false, reason: "no_live_heartbeat" });
	});

	it("rejects corrupt heartbeat payloads instead of trusting registry membership", async () => {
		const { redis, strings, sortedSets } = createRedisDouble();
		const env = environment();
		await publishCodexRemoteBuilderHeartbeat({
			redis,
			env,
			instanceId: "worker-a",
			startedAtMs: 9_000,
			nowMs: 10_000,
		});
		const payloadKey = [...strings.keys()].find((key) =>
			key.endsWith(":instance:worker-a"),
		);
		expect(payloadKey).toBeDefined();
		strings.set(String(payloadKey), "not-json");

		await expect(
			readCodexRemoteBuilderReadiness({ redis, env, nowMs: 10_001 }),
		).resolves.toEqual({ ready: false, reason: "no_live_heartbeat" });
		expect(
			[...sortedSets.values()].every((entries) => entries.size === 0),
		).toBe(true);
	});

	it("clears only the stopping instance when another worker is still live", async () => {
		const { redis } = createRedisDouble();
		const env = environment();
		for (const instanceId of ["worker-a", "worker-b"]) {
			await publishCodexRemoteBuilderHeartbeat({
				redis,
				env,
				instanceId,
				startedAtMs: 9_000,
				nowMs: 10_000,
			});
		}
		await clearCodexRemoteBuilderHeartbeat({
			redis,
			env,
			instanceId: "worker-a",
		});

		await expect(
			assertCodexRemoteBuilderReady({ redis, env, nowMs: 10_001 }),
		).resolves.toMatchObject({ instanceId: "worker-b" });
	});
});
