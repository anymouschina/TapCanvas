import * as bullmq from "bullmq";
import IORedis from "ioredis";

// 历史版本曾把长时视频编排塞进 finalizer；现已硬切到 Workflow IR，finalizer 只处理结算。
// undici(Node 内置 fetch) 的 headersTimeout/bodyTimeout 默认各 300s，且**独立于 AbortSignal**——
// 路由 340s 才回头，headersTimeout 在 300s 就先触发 `fetch failed`，把"慢但正常"的 tick 误判失败、
// 写回丢失、run 永不前进。这里禁用 headers/body 超时(像 call.mjs 那样)，让长连撑过整段同步生成；
// 保留 connectTimeout 防真断连。找不到 undici 则静默降级(AbortSignal 仍兜超时)。
try {
	const { setGlobalDispatcher, Agent } = await import("undici");
	setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));
} catch {
	// ignore — 降级为默认 fetch 行为
}

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
// BullMQ v5 禁止队列名含 ':'（旧默认 "tapcanvas:credit-finalizer" 会抛
// "Queue name cannot contain :" 直接崩——这是该 worker 一直跑不起来的原因之一）。改用连字符。
const queueName = readEnv(
	"CREDIT_FINALIZER_QUEUE",
	"tapcanvas-credit-finalizer",
);
const mediaRecoveryQueueName = readEnv(
	"MEDIA_RECOVERY_QUEUE",
	"tapcanvas-media-recovery",
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
const mediaRecoveryEveryMs = Math.max(5_000, readIntEnv("MEDIA_RECOVERY_EVERY_MS", 60_000));
const mediaRecoveryHttpTimeoutMs = Math.max(60_000, readIntEnv("MEDIA_RECOVERY_HTTP_TIMEOUT_MS", 300_000));
const connection = new IORedis(redisUrl, {
	maxRetriesPerRequest: null,
});

const queue = new Queue(queueName, { connection });
const mediaRecoveryQueue = new Queue(mediaRecoveryQueueName, { connection });

// BullMQ v4 needs a QueueScheduler for delayed/repeatable jobs.
const scheduler = QueueScheduler ? new QueueScheduler(queueName, { connection }) : null;
const mediaRecoveryScheduler = QueueScheduler ? new QueueScheduler(mediaRecoveryQueueName, { connection }) : null;

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

async function ensureSingleMediaRecoveryTick() {
	const existing = await mediaRecoveryQueue.getRepeatableJobs().catch(() => []);
	for (const job of existing) {
		if (job?.name === "media-recovery:tick") {
			try {
				await mediaRecoveryQueue.removeRepeatableByKey(job.key);
			} catch {
				// ignore
			}
		}
	}

	await mediaRecoveryQueue.add(
		"media-recovery:tick",
		{},
		{
			repeat: { every: mediaRecoveryEveryMs },
		},
	);
}

async function runMediaRecoveryOnce() {
	const res = await fetch(`${apiBase}/internal/media-recovery/run`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${internalToken}`,
		},
		body: JSON.stringify({}),
		signal: AbortSignal.timeout(mediaRecoveryHttpTimeoutMs),
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`[media-recovery] HTTP ${res.status}: ${text}`);
	}

	try {
		const json = JSON.parse(text);
		console.log("[media-recovery] ok", JSON.stringify(json));
	} catch {
		console.log("[media-recovery] ok", text);
	}
}

async function runFinalizerOnce() {
	const limit = readIntEnv("TASK_CREDIT_FINALIZER_LIMIT", null);
	const orphanReleaseMs = readIntEnv("TASK_CREDIT_FINALIZER_ORPHAN_RELEASE_MS", null);
	const body = {
		...(Number.isFinite(limit) ? { limit } : {}),
		...(Number.isFinite(orphanReleaseMs) ? { orphanReleaseMs } : {}),
	};

	// finalizer 路由不再推进创作工作流；这里只保留足够的结算请求超时预算。
	// 整条 HTTP 合法地需要数分钟。fetch 默认 undici headers/body 超时 ~300s，会把"慢但正常的 tick"误判成
	// `fetch failed` → job failed → 整 tick 作废、run 永不前进。给一个比路由侧驱动预算(默认 7min)更宽的
	// 超时(默认 9min)：正常慢 tick 撑得过，真卡死(超 9min)才失败。env CREDIT_FINALIZER_HTTP_TIMEOUT_MS 可调。
	const httpTimeoutMs = Math.max(
		60_000,
		readIntEnv("CREDIT_FINALIZER_HTTP_TIMEOUT_MS", 540_000) || 540_000,
	);
	const res = await fetch(`${apiBase}/internal/credit-finalizer/run`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${internalToken}`,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(httpTimeoutMs),
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

const mediaRecoveryWorker = new Worker(
	mediaRecoveryQueueName,
	async (job) => {
		if (job.name !== "media-recovery:tick") return;
		await runMediaRecoveryOnce();
	},
	{ connection, concurrency: 1 },
);

mediaRecoveryWorker.on("failed", (job, err) => {
	console.warn("[media-recovery] job failed", job?.id, err?.message || err);
});

mediaRecoveryWorker.on("error", (err) => {
	console.warn("[media-recovery] worker error", err?.message || err);
});

let shutdownStarted = false;

async function closeResource(label, close) {
	try {
		await close();
		return true;
	} catch (error) {
		console.error(`[credit-finalizer] failed to close ${label}`, error);
		return false;
	}
}

const shutdown = async (signal) => {
	if (shutdownStarted) return;
	shutdownStarted = true;
	console.log(`[credit-finalizer] ${signal} received; stopping new claims and draining active jobs...`);
	const closed = await Promise.all([
		closeResource("credit finalizer worker", () => worker.close()),
		closeResource("media recovery worker", () => mediaRecoveryWorker.close()),
		closeResource("credit finalizer queue", () => queue.close()),
		closeResource("media recovery queue", () => mediaRecoveryQueue.close()),
		closeResource("credit finalizer scheduler", () => scheduler?.close?.()),
		closeResource("media recovery scheduler", () => mediaRecoveryScheduler?.close?.()),
		closeResource("redis connection", () => connection.quit()),
	]);
	process.exit(closed.every(Boolean) ? 0 : 1);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await ensureSingleRepeatableTick();
await ensureSingleMediaRecoveryTick();
console.log(
	`[credit-finalizer] worker started queue=${queueName} everyMs=${everyMs} api=${apiBase}`,
);
console.log(
	`[media-recovery] worker started queue=${mediaRecoveryQueueName} everyMs=${mediaRecoveryEveryMs} api=${apiBase}`,
);
