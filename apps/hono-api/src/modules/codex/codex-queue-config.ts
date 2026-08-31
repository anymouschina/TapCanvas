export type CodexQueueConfig = {
	enqueueQps: number;
	maxQueueDepthPerUser: number;
	maxQueueDepthGlobal: number;
	bridgeOnlineTtlSeconds: number;
	taskTtlSeconds: number;
	leaseTtlMs: number;
	recentTaskLimit: number;
};

function readPositiveInteger(
	name: string,
	defaultValue: number,
	input: NodeJS.ProcessEnv = process.env,
): number {
	const raw = input[name];
	if (raw === undefined || raw.trim() === "") return defaultValue;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

export function resolveCodexQueueConfig(
	input: NodeJS.ProcessEnv = process.env,
): CodexQueueConfig {
	const leaseTtlMs = readPositiveInteger(
		"CODEX_QUEUE_LEASE_TTL_MS",
		30_000,
		input,
	);
	if (leaseTtlMs < 10_000) {
		throw new Error("CODEX_QUEUE_LEASE_TTL_MS must be at least 10000");
	}

	return {
		enqueueQps: readPositiveInteger("CODEX_ENQUEUE_QPS", 1, input),
		maxQueueDepthPerUser: readPositiveInteger(
			"CODEX_MAX_QUEUE_DEPTH_PER_USER",
			10,
			input,
		),
		maxQueueDepthGlobal: readPositiveInteger(
			"CODEX_MAX_QUEUE_DEPTH_GLOBAL",
			100,
			input,
		),
		bridgeOnlineTtlSeconds: readPositiveInteger(
			"CODEX_BRIDGE_ONLINE_TTL_SECONDS",
			45,
			input,
		),
		taskTtlSeconds: readPositiveInteger(
			"CODEX_TASK_TTL_SECONDS",
			7 * 24 * 60 * 60,
			input,
		),
		leaseTtlMs,
		recentTaskLimit: readPositiveInteger(
			"CODEX_RECENT_TASK_LIMIT",
			50,
			input,
		),
	};
}

