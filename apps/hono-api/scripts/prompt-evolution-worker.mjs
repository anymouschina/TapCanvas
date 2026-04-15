import * as bullmq from "bullmq";
import IORedis from "ioredis";

const { Queue, Worker, QueueScheduler } = bullmq;

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
	"PROMPT_EVOLUTION_QUEUE",
	"tapcanvas:prompt-evolution",
);
const cronPattern = readEnv("PROMPT_EVOLUTION_CRON", "0 0 * * *");
const cronTz = readEnv("PROMPT_EVOLUTION_TZ", "America/Los_Angeles");

const apiBase =
	normalizeBaseUrl(readEnv("TAPCANVAS_API_INTERNAL_BASE", "")) ||
	normalizeBaseUrl(readEnv("TAPCANVAS_API_BASE", "")) ||
	"http://127.0.0.1:8788";

const internalToken = readEnv("INTERNAL_WORKER_TOKEN", "").trim();
if (!internalToken) {
	throw new Error("Missing INTERNAL_WORKER_TOKEN (must match API env)");
}

const sinceHours = Math.max(1, readIntEnv("PROMPT_EVOLUTION_SINCE_HOURS", 24));
const minSamples = Math.max(1, readIntEnv("PROMPT_EVOLUTION_MIN_SAMPLES", 30));
const dryRunRaw = readEnv("PROMPT_EVOLUTION_DRY_RUN", "0").trim().toLowerCase();
const dryRun = ["1", "true", "yes", "on"].includes(dryRunRaw);
const concurrency = Math.max(1, readIntEnv("PROMPT_EVOLUTION_CONCURRENCY", 1));

const connection = new IORedis(redisUrl, {
	maxRetriesPerRequest: null,
});

const queue = new Queue(queueName, { connection });
const scheduler = QueueScheduler ? new QueueScheduler(queueName, { connection }) : null;

async function ensureSingleRepeatableTick() {
	const existing = await queue.getRepeatableJobs().catch(() => []);
	for (const job of existing) {
		if (job?.name === "prompt-evolution:tick") {
			try {
				await queue.removeRepeatableByKey(job.key);
			} catch {
				// ignore
			}
		}
	}

	await queue.add(
		"prompt-evolution:tick",
		{},
		{
			repeat: { pattern: cronPattern, tz: cronTz },
		},
	);
}

async function runPromptEvolutionOnce() {
	const body = {
		sinceHours,
		minSamples,
		dryRun,
	};

	const res = await fetch(`${apiBase}/internal/prompt-evolution/run`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${internalToken}`,
		},
		body: JSON.stringify(body),
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`[prompt-evolution] HTTP ${res.status}: ${text}`);
	}

	try {
		const json = JSON.parse(text);
		console.log("[prompt-evolution] ok", json);
	} catch {
		console.log("[prompt-evolution] ok", text);
	}
}

const worker = new Worker(
	queueName,
	async (job) => {
		if (job.name !== "prompt-evolution:tick") return;
		await runPromptEvolutionOnce();
	},
	{ connection, concurrency },
);

worker.on("failed", (job, err) => {
	console.warn("[prompt-evolution] job failed", job?.id, err?.message || err);
});

worker.on("error", (err) => {
	console.warn("[prompt-evolution] worker error", err?.message || err);
});

const shutdown = async () => {
	console.log("[prompt-evolution] shutting down...");
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
	`[prompt-evolution] worker started queue=${queueName} cron="${cronPattern}" tz=${cronTz} api=${apiBase}`,
);
