import type IORedis from "ioredis";
import { QUEUE_NAMES } from "../task/queues";
import {
	codexRemoteBuilderConfigFingerprint,
	type CodexRemoteBuilderEnvironment,
} from "./codex-remote-builder-config";

export const CODEX_REMOTE_BUILDER_HEARTBEAT_INTERVAL_MS = 5_000;
export const CODEX_REMOTE_BUILDER_HEARTBEAT_TTL_MS = 15_000;

const HEARTBEAT_PROTOCOL_VERSION = 1;
const HEARTBEAT_CLOCK_SKEW_MS = 1_000;
const REGISTRY_TTL_MS = CODEX_REMOTE_BUILDER_HEARTBEAT_TTL_MS * 2;

export type CodexRemoteBuilderReadinessRedis = Pick<
	IORedis,
	| "del"
	| "get"
	| "pexpire"
	| "set"
	| "zadd"
	| "zrangebyscore"
	| "zrem"
	| "zremrangebyscore"
>;

export type CodexRemoteBuilderHeartbeat = {
	protocolVersion: typeof HEARTBEAT_PROTOCOL_VERSION;
	instanceId: string;
	configFingerprint: string;
	queueName: typeof QUEUE_NAMES.codexRemoteBuild;
	startedAtMs: number;
	lastHeartbeatAtMs: number;
	expiresAtMs: number;
};

export type CodexRemoteBuilderReadiness =
	| { ready: true; heartbeat: CodexRemoteBuilderHeartbeat }
	| { ready: false; reason: "no_live_heartbeat" };

export class CodexRemoteBuilderOfflineError extends Error {
	constructor() {
		super(
			"Codex remote builder has no live worker heartbeat for the active configuration",
		);
		this.name = "CodexRemoteBuilderOfflineError";
	}
}

function registryKey(configFingerprint: string): string {
	return `tapcanvas:codex:remote-builder:ready:${configFingerprint}`;
}

function instanceKey(configFingerprint: string, instanceId: string): string {
	return `${registryKey(configFingerprint)}:instance:${instanceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function parseHeartbeat(
	raw: string | null,
	expected: {
		configFingerprint: string;
		instanceId: string;
		nowMs: number;
	},
): CodexRemoteBuilderHeartbeat | null {
	if (!raw) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
	if (!isRecord(value)) return null;
	if (
		value.protocolVersion !== HEARTBEAT_PROTOCOL_VERSION ||
		value.instanceId !== expected.instanceId ||
		value.configFingerprint !== expected.configFingerprint ||
		value.queueName !== QUEUE_NAMES.codexRemoteBuild ||
		!isFiniteInteger(value.startedAtMs) ||
		!isFiniteInteger(value.lastHeartbeatAtMs) ||
		!isFiniteInteger(value.expiresAtMs)
	) {
		return null;
	}
	if (
		value.startedAtMs > value.lastHeartbeatAtMs ||
		value.lastHeartbeatAtMs > expected.nowMs + HEARTBEAT_CLOCK_SKEW_MS ||
		value.lastHeartbeatAtMs <
			expected.nowMs - CODEX_REMOTE_BUILDER_HEARTBEAT_TTL_MS ||
		value.expiresAtMs <= expected.nowMs
	) {
		return null;
	}
	return {
		protocolVersion: HEARTBEAT_PROTOCOL_VERSION,
		instanceId: value.instanceId,
		configFingerprint: value.configFingerprint,
		queueName: QUEUE_NAMES.codexRemoteBuild,
		startedAtMs: value.startedAtMs,
		lastHeartbeatAtMs: value.lastHeartbeatAtMs,
		expiresAtMs: value.expiresAtMs,
	};
}

export async function publishCodexRemoteBuilderHeartbeat(input: {
	redis: CodexRemoteBuilderReadinessRedis;
	env: CodexRemoteBuilderEnvironment;
	instanceId: string;
	startedAtMs: number;
	nowMs?: number;
}): Promise<CodexRemoteBuilderHeartbeat> {
	const nowMs = input.nowMs ?? Date.now();
	const configFingerprint = codexRemoteBuilderConfigFingerprint(input.env);
	const heartbeat: CodexRemoteBuilderHeartbeat = {
		protocolVersion: HEARTBEAT_PROTOCOL_VERSION,
		instanceId: input.instanceId,
		configFingerprint,
		queueName: QUEUE_NAMES.codexRemoteBuild,
		startedAtMs: input.startedAtMs,
		lastHeartbeatAtMs: nowMs,
		expiresAtMs: nowMs + CODEX_REMOTE_BUILDER_HEARTBEAT_TTL_MS,
	};
	const key = registryKey(configFingerprint);
	await input.redis.set(
		instanceKey(configFingerprint, input.instanceId),
		JSON.stringify(heartbeat),
		"PX",
		CODEX_REMOTE_BUILDER_HEARTBEAT_TTL_MS,
	);
	await input.redis.zadd(key, heartbeat.expiresAtMs, input.instanceId);
	await input.redis.pexpire(key, REGISTRY_TTL_MS);
	return heartbeat;
}

export async function clearCodexRemoteBuilderHeartbeat(input: {
	redis: CodexRemoteBuilderReadinessRedis;
	env: CodexRemoteBuilderEnvironment;
	instanceId: string;
}): Promise<void> {
	const configFingerprint = codexRemoteBuilderConfigFingerprint(input.env);
	await input.redis.del(instanceKey(configFingerprint, input.instanceId));
	await input.redis.zrem(registryKey(configFingerprint), input.instanceId);
}

export async function readCodexRemoteBuilderReadiness(input: {
	redis: CodexRemoteBuilderReadinessRedis;
	env: CodexRemoteBuilderEnvironment;
	nowMs?: number;
}): Promise<CodexRemoteBuilderReadiness> {
	const nowMs = input.nowMs ?? Date.now();
	const configFingerprint = codexRemoteBuilderConfigFingerprint(input.env);
	const key = registryKey(configFingerprint);
	await input.redis.zremrangebyscore(key, "-inf", nowMs);
	const instanceIds = await input.redis.zrangebyscore(key, `(${nowMs}`, "+inf");
	for (const instanceId of instanceIds) {
		const raw = await input.redis.get(
			instanceKey(configFingerprint, instanceId),
		);
		const heartbeat = parseHeartbeat(raw, {
			configFingerprint,
			instanceId,
			nowMs,
		});
		if (heartbeat) return { ready: true, heartbeat };
		await input.redis.zrem(key, instanceId);
	}
	return { ready: false, reason: "no_live_heartbeat" };
}

export async function assertCodexRemoteBuilderReady(input: {
	redis: CodexRemoteBuilderReadinessRedis;
	env: CodexRemoteBuilderEnvironment;
	nowMs?: number;
}): Promise<CodexRemoteBuilderHeartbeat> {
	const readiness = await readCodexRemoteBuilderReadiness(input);
	if (!readiness.ready) throw new CodexRemoteBuilderOfflineError();
	return readiness.heartbeat;
}
