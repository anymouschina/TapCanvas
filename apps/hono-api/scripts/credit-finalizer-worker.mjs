import * as bullmq from "bullmq";
import IORedis from "ioredis";

const {
	Queue,
	Worker,
	QueueScheduler,
} = bullmq;

function readEnv(name, fallback = "") {
	const value = process.env[name];
	return typeof value === "string" ? value : fallback;
}

function readIntEnv(name, fallback) {
	const raw = readEnv(name, "");
	if (!raw.trim()) return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeBaseUrl(raw) {
	const v = String(raw || "").trim();
	return v ? v.replace(/\/+$/, "") : "";
}

const redisUrl = readEnv("REDIS_URL", "redis://127.0.0.1:6379");
const queueName = readEnv(
	"CREDIT_FINALIZER_QUEUE",
	"tapcanvas:credit-finalizer",
);

const apiBase =
	normalizeBaseUrl(readEnv("TAPCANVAS_API_INTERNAL_BASE", "")) ||
	normalizeBaseUrl(readEnv("TAPCANVAS_API_BASE", "")) ||
	"http://127.0.0.1:8788";

const internalToken = readEnv("INTERNAL_WORKER_TOKEN", "").trim();
if (!internalToken) {
	throw new Error("Missing INTERNAL_WORKER_TOKEN (must match API env)");
}

const everyMs = Math.max(5_000, readIntEnv("CREDIT_FINALIZER_EVERY_MS", 60_000));
const concurrency = Math.max(1, readIntEnv("CREDIT_FINALIZER_CONCURRENCY", 1));

const connection = new IORedis(redisUrl, {
	maxRetriesPerRequest: null,
});

const queue = new Queue(queueName, { connection });

// BullMQ v4 needs a QueueScheduler for delayed/repeatable jobs.
const scheduler = QueueScheduler ? new QueueScheduler(queueName, { connection }) : null;

async function ensureSingleRepeatableTick() {
	const existing = await queue.getRepeatableJobs().catch(() => []);
	for (const job of existing) {
		if (job?.name === "credit-finalizer:tick") {
			try {
				await queue.removeRepeatableByKey(job.key);
			} catch {
				// ignore
			}
		}
	}

	await queue.add(
		"credit-finalizer:tick",
		{},
		{
			repeat: { every: everyMs },
		},
	);
}

async function runFinalizerOnce() {
	const limit = readIntEnv("TASK_CREDIT_FINALIZER_LIMIT", null);
	const orphanReleaseMs = readIntEnv("TASK_CREDIT_FINALIZER_ORPHAN_RELEASE_MS", null);
	const body = {
		...(Number.isFinite(limit) ? { limit } : {}),
		...(Number.isFinite(orphanReleaseMs) ? { orphanReleaseMs } : {}),
	};

	const res = await fetch(`${apiBase}/internal/credit-finalizer/run`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${internalToken}`,
		},
		body: JSON.stringify(body),
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`[credit-finalizer] HTTP ${res.status}: ${text}`);
	}

	try {
		const json = JSON.parse(text);
		console.log("[credit-finalizer] ok", json);
	} catch {
		console.log("[credit-finalizer] ok", text);
	}
}

const worker = new Worker(
	queueName,
	async (job) => {
		if (job.name !== "credit-finalizer:tick") return;
		await runFinalizerOnce();
	},
	{ connection, concurrency },
);

worker.on("failed", (job, err) => {
	console.warn("[credit-finalizer] job failed", job?.id, err?.message || err);
});

worker.on("error", (err) => {
	console.warn("[credit-finalizer] worker error", err?.message || err);
});

const shutdown = async () => {
	console.log("[credit-finalizer] shutting down...");
	try {
		await worker.close();
	} catch {
		// ignore
	}
	try {
		await queue.close();
	} catch {
		// ignore
	}
	try {
		await scheduler?.close?.();
	} catch {
		// ignore
	}
	try {
		await connection.quit();
	} catch {
		// ignore
	}
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await ensureSingleRepeatableTick();
console.log(
	`[credit-finalizer] worker started queue=${queueName} everyMs=${everyMs} api=${apiBase}`,
);

