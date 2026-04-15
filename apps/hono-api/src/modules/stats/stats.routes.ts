import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { ensureVendorCallLogsSchema } from "../task/vendor-call-logs.repo";
import { listApiRequestLogs } from "../observability/request-logs.repo";
import { getPrismaClient } from "../../platform/node/prisma";

export const statsRouter = new Hono<AppEnv>();

statsRouter.use("*", authMiddleware);

const PromptEvolutionRunRequestSchema = z
	.object({
		sinceHours: z.number().int().min(1).max(24 * 30).optional(),
		minSamples: z.number().int().min(1).max(10_000).optional(),
		dryRun: z.boolean().optional(),
	})
	.strict();

const PromptEvolutionPublishRequestSchema = z
	.object({
		runId: z.string().min(1),
		canaryPercent: z.number().int().min(1).max(100),
	})
	.strict();

const PromptEvolutionRollbackRequestSchema = z
	.object({
		toRunId: z.string().min(1).optional(),
		reason: z.string().max(500).optional(),
	})
	.strict();

type PromptEvolutionMetrics = {
	total: number;
	succeeded: number;
	failed: number;
	successRate: number;
	avgDurationMs: number;
};

let promptEvolutionSchemaEnsured = false;

async function ensurePromptEvolutionSchema(c: any): Promise<void> {
	void c;
	if (promptEvolutionSchemaEnsured) return;
	const nowIso = new Date().toISOString();
	await getPrismaClient().prompt_evolution_runtime.upsert({
		where: { id: 1 },
		create: {
			id: 1,
			active_run_id: null,
			canary_percent: 5,
			status: "idle",
			last_action: "init",
			note: null,
			updated_at: nowIso,
			updated_by: null,
		},
		update: {},
	});

	promptEvolutionSchemaEnsured = true;
}

function normalizePromptEvolutionMetrics(raw: any): PromptEvolutionMetrics {
	return {
		total: Number(raw?.total ?? 0) || 0,
		succeeded: Number(raw?.succeeded ?? 0) || 0,
		failed: Number(raw?.failed ?? 0) || 0,
		successRate: Number(raw?.successRate ?? 0) || 0,
		avgDurationMs: Number(raw?.avgDurationMs ?? 0) || 0,
	};
}

async function computePromptEvolutionMetrics(
	c: any,
	sinceIso: string,
): Promise<PromptEvolutionMetrics> {
	void c;
	const prisma = getPrismaClient();
	const where = {
		task_kind: { in: ["chat", "prompt_refine"] },
		created_at: { gte: sinceIso },
	};
	const [total, succeeded, failed, agg] = await Promise.all([
		prisma.vendor_api_call_logs.count({ where }),
		prisma.vendor_api_call_logs.count({ where: { ...where, status: "succeeded" } }),
		prisma.vendor_api_call_logs.count({ where: { ...where, status: "failed" } }),
		prisma.vendor_api_call_logs.aggregate({
			where,
			_avg: { duration_ms: true },
		}),
	]);
	const avgDurationMs = Math.max(0, Math.round(Number(agg._avg.duration_ms ?? 0) || 0));
	const successRate = total > 0 ? succeeded / total : 0;
	return { total, succeeded, failed, successRate, avgDurationMs };
}

function isLocalDevRequest(c: any): boolean {
	try {
		const url = new URL(c.req.url);
		const host = url.hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1"
		);
	} catch {
		return false;
	}
}

function isAdmin(c: any): boolean {
	if (isLocalDevRequest(c)) return true;
	const auth = c.get("auth") as any;
	return auth?.role === "admin";
}

function normalizeRevenueItemLabel(raw: string): string {
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : "未命名商品";
}

async function hasUserColumn(c: any, column: string): Promise<boolean> {
	void c;
	void column;
	return true;
}

async function ensureStatsSchema(c: any): Promise<Response | null> {
	const hasLastSeen = await hasUserColumn(c, "last_seen_at");
	if (!hasLastSeen) {
		return c.json(
			{
				error: "Stats schema not migrated",
				message:
					"Missing users.last_seen_at in database. Run the local/remote migration to add last_seen_at and user_activity_days.",
			},
			503,
		);
	}
	return null;
}

statsRouter.post("/ping", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const schemaErr = await ensureStatsSchema(c);
	if (schemaErr) return schemaErr;

	const nowIso = new Date().toISOString();
	const day = nowIso.slice(0, 10);
	const prisma = getPrismaClient();
	await prisma.users.updateMany({
		where: { id: userId },
		data: { last_seen_at: nowIso, updated_at: nowIso },
	});
	await prisma.user_activity_days.upsert({
		where: { day_user_id: { day, user_id: userId } },
		create: { day, user_id: userId, last_seen_at: nowIso },
		update: { last_seen_at: nowIso },
	});

	return c.json({ ok: true });
});

statsRouter.get("/", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);

	const schemaErr = await ensureStatsSchema(c);
	if (schemaErr) return schemaErr;

	const prisma = getPrismaClient();
	const now = Date.now();
	const twoMinAgoIso = new Date(now - 2 * 60 * 1000).toISOString();
	const today = new Date().toISOString().slice(0, 10);
	const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
	const [totalUsers, onlineUsers, newUsersToday] = await Promise.all([
		prisma.users.count(),
		prisma.users.count({
			where: { last_seen_at: { not: null, gte: twoMinAgoIso } },
		}),
		prisma.users.count({
			where: { created_at: { gte: today, lt: tomorrow } },
		}),
	]);
	return c.json({ onlineUsers, totalUsers, newUsersToday });
});

statsRouter.get("/dau", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);

	const schemaErr = await ensureStatsSchema(c);
	if (schemaErr) return schemaErr;

	const rawDays = c.req.query("days");
	const parsedDays = Number(rawDays ?? 30);
	const days = Number.isFinite(parsedDays)
		? Math.max(1, Math.min(365, Math.floor(parsedDays)))
		: 30;

	// Use UTC day strings (YYYY-MM-DD) for consistency with ping storage.
	const todayUtc = new Date().toISOString().slice(0, 10);
	const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);

	const rows = await getPrismaClient().user_activity_days.groupBy({
		by: ["day"],
		where: { day: { gte: since, lte: todayUtc } },
		_count: { _all: true },
		orderBy: { day: "asc" },
	});

	const map = new Map<string, number>();
	for (const r of rows) {
		const day = typeof r.day === "string" ? r.day : null;
		if (!day) continue;
		map.set(day, Number(r._count?._all ?? 0) || 0);
	}

	const out: Array<{ day: string; activeUsers: number }> = [];
	for (let i = days - 1; i >= 0; i -= 1) {
		const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10);
		out.push({ day: d, activeUsers: map.get(d) ?? 0 });
	}

	return c.json({ days, series: out });
});

statsRouter.get("/vendors", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);

	await ensureVendorCallLogsSchema(c.env.DB);

	const rawDays = c.req.query("days");
	const parsedDays = Number(rawDays ?? 7);
	const days = Number.isFinite(parsedDays)
		? Math.max(1, Math.min(365, Math.floor(parsedDays)))
		: 7;

	const rawPoints = c.req.query("points");
	const parsedPoints = Number(rawPoints ?? 60);
	const points = Number.isFinite(parsedPoints)
		? Math.max(1, Math.min(180, Math.floor(parsedPoints)))
		: 60;

	const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
	const prisma = getPrismaClient();
	const baseWhere = {
		status: { in: ["succeeded", "failed"] as string[] },
		finished_at: { not: null, gte: sinceIso },
	};
	const [totals, successes] = await Promise.all([
		prisma.vendor_api_call_logs.groupBy({
			by: ["vendor"],
			where: baseWhere,
			_count: { _all: true },
			_avg: { duration_ms: true },
			orderBy: { _count: { vendor: "desc" } },
		}),
		prisma.vendor_api_call_logs.groupBy({
			by: ["vendor"],
			where: { ...baseWhere, status: "succeeded" },
			_count: { _all: true },
		}),
	]);
	const successMap = new Map<string, number>();
	for (const row of successes) {
		successMap.set(row.vendor, Number(typeof row._count === "object" && row._count ? row._count._all ?? 0 : 0) || 0);
	}
	const vendors = totals.map((r) => ({
		vendor: r.vendor,
		total: Number(typeof r._count === "object" && r._count ? r._count._all ?? 0 : 0) || 0,
		success: successMap.get(r.vendor) ?? 0,
		avgDurationMs:
			typeof r._avg?.duration_ms === "number" && Number.isFinite(r._avg.duration_ms)
				? Math.round(r._avg.duration_ms)
				: null,
	}));

	const extras = await Promise.all(
		vendors.map(async (v) => {
			const [last, historyRows] = await Promise.all([
				prisma.vendor_api_call_logs.findFirst({
					where: {
						vendor: v.vendor,
						status: { in: ["succeeded", "failed"] },
						finished_at: { not: null },
					},
					orderBy: { finished_at: "desc" },
					select: { status: true, finished_at: true, duration_ms: true },
				}),
				prisma.vendor_api_call_logs.findMany({
					where: {
						vendor: v.vendor,
						status: { in: ["succeeded", "failed"] },
						finished_at: { not: null, gte: sinceIso },
					},
					orderBy: { finished_at: "desc" },
					take: points,
					select: { status: true, finished_at: true },
				}),
			]);
			const history = historyRows
				.map((h) => ({
					status: h.status === "succeeded" ? "succeeded" : "failed",
					finishedAt: typeof h.finished_at === "string" ? h.finished_at : null,
				}))
				.filter((x) => !!x.finishedAt)
				.reverse();

			const lastStatus =
				last?.status === "succeeded"
					? ("succeeded" as const)
					: last?.status === "failed"
						? ("failed" as const)
						: null;

			const lastAt =
				typeof last?.finished_at === "string" ? last.finished_at : null;
			const lastDurationMs =
				typeof last?.duration_ms === "number" && Number.isFinite(last.duration_ms)
					? Math.round(last.duration_ms)
					: null;

			return {
				...v,
				successRate: v.total > 0 ? v.success / v.total : 0,
				lastStatus,
				lastAt,
				lastDurationMs,
				history,
			};
		}),
	);

	return c.json({ days, points, vendors: extras });
});

statsRouter.get("/revenue", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);

	const rawDays = c.req.query("days");
	const parsedDays = Number(rawDays ?? 30);
	const days = Number.isFinite(parsedDays)
		? Math.max(1, Math.min(365, Math.floor(parsedDays)))
		: 30;

	const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
	const prisma = getPrismaClient();
	const orders = await prisma.orders.findMany({
		where: {
			payment_status: "paid",
			paid_at: { not: null, gte: sinceIso },
		},
		orderBy: { paid_at: "desc" },
		select: {
			id: true,
			currency: true,
			total_amount_cents: true,
			paid_amount_cents: true,
			refund_amount_cents: true,
			order_items: {
				orderBy: { created_at: "asc" },
				select: {
					title_snapshot: true,
					total_price_cents: true,
					quantity: true,
				},
			},
		},
	});

	const currencies = new Set<string>();
	const sliceMap = new Map<
		string,
		{ amountCents: number; quantity: number; orderIds: Set<string> }
	>();
	let totalAmountCents = 0;
	let paidOrderCount = 0;

	for (const order of orders) {
		const netPaidAmountCents = Math.max(
			0,
			(Number(order.paid_amount_cents ?? 0) || 0) -
				(Number(order.refund_amount_cents ?? 0) || 0),
		);
		if (netPaidAmountCents <= 0) continue;

		const validItems = order.order_items.filter(
			(item) => (Number(item.total_price_cents ?? 0) || 0) > 0,
		);
		if (validItems.length === 0) continue;

		const itemGrossTotalCents = validItems.reduce(
			(sum, item) => sum + (Number(item.total_price_cents ?? 0) || 0),
			0,
		);
		if (itemGrossTotalCents <= 0) continue;

		const currency = String(order.currency || "").trim().toUpperCase();
		if (currency) currencies.add(currency);

		totalAmountCents += netPaidAmountCents;
		paidOrderCount += 1;

		let allocatedAmountCents = 0;
		for (let index = 0; index < validItems.length; index += 1) {
			const item = validItems[index];
			const itemTotalPriceCents = Number(item.total_price_cents ?? 0) || 0;
			const amountCents =
				index === validItems.length - 1
					? Math.max(0, netPaidAmountCents - allocatedAmountCents)
					: Math.floor(
							(netPaidAmountCents * itemTotalPriceCents) / itemGrossTotalCents,
						);
			allocatedAmountCents += amountCents;
			if (amountCents <= 0) continue;

			const label = normalizeRevenueItemLabel(String(item.title_snapshot || ""));
			const existing = sliceMap.get(label) ?? {
				amountCents: 0,
				quantity: 0,
				orderIds: new Set<string>(),
			};
			existing.amountCents += amountCents;
			existing.quantity += Math.max(0, Number(item.quantity ?? 0) || 0);
			existing.orderIds.add(order.id);
			sliceMap.set(label, existing);
		}
	}

	if (currencies.size > 1) {
		return c.json(
			{
				error: "Mixed currencies are not supported",
				message: "近30日收入存在多币种订单，当前概览饼图仅支持单币种展示。",
				code: "mixed_revenue_currencies",
				currencies: Array.from(currencies),
			},
			409,
		);
	}

	const slices = Array.from(sliceMap.entries())
		.map(([label, value]) => ({
			label,
			amountCents: value.amountCents,
			orderCount: value.orderIds.size,
			quantity: value.quantity,
			share: totalAmountCents > 0 ? value.amountCents / totalAmountCents : 0,
		}))
		.sort((left, right) => right.amountCents - left.amountCents);

	return c.json({
		days,
		currency: currencies.size === 1 ? Array.from(currencies)[0] : null,
		totalAmountCents,
		paidOrderCount,
		slices,
	});
});

statsRouter.get("/requests", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);

	const rawDays = c.req.query("days");
	const parsedDays = Number(rawDays ?? 7);
	const days = Number.isFinite(parsedDays)
		? Math.max(1, Math.min(90, Math.floor(parsedDays)))
		: 7;

	const rawLimit = c.req.query("limit");
	const parsedLimit = Number(rawLimit ?? 200);
	const limit = Number.isFinite(parsedLimit)
		? Math.max(1, Math.min(500, Math.floor(parsedLimit)))
		: 200;

	const pathPrefixRaw = c.req.query("pathPrefix");
	const pathPrefix =
		typeof pathPrefixRaw === "string" && pathPrefixRaw.trim()
			? pathPrefixRaw.trim()
			: null;

	const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

	const rows = await listApiRequestLogs(c.env.DB, { sinceIso, limit, pathPrefix });

	const items = rows.map((r) => {
		let trace: any = null;
		if (typeof r.trace_json === "string" && r.trace_json.trim()) {
			try {
				trace = JSON.parse(r.trace_json);
			} catch {
				trace = null;
			}
		}
		return {
			id: r.id,
			userId: r.user_id,
			apiKeyId: r.api_key_id,
			method: r.method,
			path: r.path,
			status: r.status,
			stage: r.stage,
			aborted: !!r.aborted,
			startedAt: r.started_at,
			finishedAt: r.finished_at,
			durationMs: r.duration_ms,
			trace,
		};
	});

	return c.json({ days, limit, sinceIso, items });
});

statsRouter.post("/prompt-evolution/run", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	await ensurePromptEvolutionSchema(c);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PromptEvolutionRunRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: "Invalid request body",
				issues: parsed.error.issues,
			},
			400,
		);
	}

	const sinceHours =
		typeof parsed.data.sinceHours === "number" ? parsed.data.sinceHours : 24;
	const minSamples =
		typeof parsed.data.minSamples === "number" ? parsed.data.minSamples : 30;
	const dryRun = parsed.data.dryRun !== false;
	const sinceIso = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
	const metrics = await computePromptEvolutionMetrics(c, sinceIso);
	const hasEnoughSamples = metrics.total >= minSamples;
	const action = hasEnoughSamples && !dryRun ? "ready_for_optimizer" : "skip";
	const runId = crypto.randomUUID();
	const nowIso = new Date().toISOString();
	const actorUserId = c.get("userId") || null;

	await getPrismaClient().prompt_evolution_runs.create({
		data: {
			id: runId,
			actor_user_id: actorUserId,
			since_hours: sinceHours,
			min_samples: minSamples,
			dry_run: dryRun ? 1 : 0,
			action,
			metrics_json: JSON.stringify(metrics),
			created_at: nowIso,
		},
	});

	return c.json({
		ok: true,
		runId,
		job: "prompt-evolution",
		sinceHours,
		sinceIso,
		dryRun,
		guardrail: {
			minSamples,
			hasEnoughSamples,
		},
		metrics,
		action,
	});
});

statsRouter.get("/prompt-evolution/runs", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	await ensurePromptEvolutionSchema(c);

	const rawLimit = Number(c.req.query("limit") || 20);
	const limit = Number.isFinite(rawLimit)
		? Math.max(1, Math.min(200, Math.floor(rawLimit)))
		: 20;
	const rows = await getPrismaClient().prompt_evolution_runs.findMany({
		orderBy: { created_at: "desc" },
		take: limit,
	});

	const items = rows.map((row) => {
		let metrics = normalizePromptEvolutionMetrics({});
		try {
			metrics = normalizePromptEvolutionMetrics(
				typeof row.metrics_json === "string" ? JSON.parse(row.metrics_json) : {},
			);
		} catch {
			metrics = normalizePromptEvolutionMetrics({});
		}
		return {
			id: String(row.id || ""),
			actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
			sinceHours: Number(row.since_hours ?? 0) || 0,
			minSamples: Number(row.min_samples ?? 0) || 0,
			dryRun: Number(row.dry_run ?? 0) === 1,
			action: row.action === "ready_for_optimizer" ? "ready_for_optimizer" : "skip",
			metrics,
			createdAt: String(row.created_at || ""),
		};
	});

	return c.json({ items });
});

statsRouter.get("/prompt-evolution/runtime", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	await ensurePromptEvolutionSchema(c);

	const row = await getPrismaClient().prompt_evolution_runtime.findUnique({
		where: { id: 1 },
	});

	return c.json({
		activeRunId: typeof row?.active_run_id === "string" ? row.active_run_id : null,
		canaryPercent: Number(row?.canary_percent ?? 5) || 5,
		status: typeof row?.status === "string" ? row.status : "idle",
		lastAction: typeof row?.last_action === "string" ? row.last_action : null,
		note: typeof row?.note === "string" ? row.note : null,
		updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
		updatedBy: typeof row?.updated_by === "string" ? row.updated_by : null,
	});
});

statsRouter.post("/prompt-evolution/publish", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	await ensurePromptEvolutionSchema(c);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PromptEvolutionPublishRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const run = await getPrismaClient().prompt_evolution_runs.findUnique({
		where: { id: parsed.data.runId },
		select: { id: true, action: true, dry_run: true },
	});
	if (!run) {
		return c.json({ error: "Run not found" }, 404);
	}
	if (run.action !== "ready_for_optimizer" || Number(run.dry_run ?? 1) === 1) {
		return c.json(
			{
				error:
					"Run is not publishable (must be ready_for_optimizer and dryRun=false)",
			},
			409,
		);
	}

	const nowIso = new Date().toISOString();
	const userId = c.get("userId") || null;
	await getPrismaClient().prompt_evolution_runtime.update({
		where: { id: 1 },
		data: {
			active_run_id: parsed.data.runId,
			canary_percent: parsed.data.canaryPercent,
			status: "active",
			last_action: "publish",
			note: null,
			updated_at: nowIso,
			updated_by: userId,
		},
	});

	return c.json({
		ok: true,
		activeRunId: parsed.data.runId,
		canaryPercent: parsed.data.canaryPercent,
		status: "active",
		updatedAt: nowIso,
	});
});

statsRouter.post("/prompt-evolution/rollback", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	await ensurePromptEvolutionSchema(c);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PromptEvolutionRollbackRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	let targetRunId: string | null = null;
	if (parsed.data.toRunId) {
		const exists = await getPrismaClient().prompt_evolution_runs.findUnique({
			where: { id: parsed.data.toRunId },
			select: { id: true },
		});
		if (!exists) return c.json({ error: "Target run not found" }, 404);
		targetRunId = parsed.data.toRunId;
	}

	const nowIso = new Date().toISOString();
	const userId = c.get("userId") || null;
	const note = parsed.data.reason ? parsed.data.reason.trim() : null;
	await getPrismaClient().prompt_evolution_runtime.update({
		where: { id: 1 },
		data: {
			active_run_id: targetRunId,
			status: "rolled_back",
			last_action: "rollback",
			note,
			updated_at: nowIso,
			updated_by: userId,
		},
	});

	return c.json({
		ok: true,
		activeRunId: targetRunId,
		status: "rolled_back",
		updatedAt: nowIso,
	});
});
