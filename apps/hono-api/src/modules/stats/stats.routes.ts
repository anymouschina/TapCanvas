import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { ensureVendorCallLogsSchema } from "../task/vendor-call-logs.repo";

export const statsRouter = new Hono<AppEnv>();

statsRouter.use("*", authMiddleware);

function isAdmin(c: any): boolean {
	const auth = c.get("auth") as any;
	return auth?.role === "admin";
}

async function hasUserColumn(c: any, column: string): Promise<boolean> {
	try {
		const res = await c.env.DB.prepare(`PRAGMA table_info(users)`).all<any>();
		const rows = Array.isArray(res?.results) ? res.results : [];
		return rows.some((r: any) => r?.name === column);
	} catch {
		return false;
	}
}

async function ensureStatsSchema(c: any): Promise<Response | null> {
	const hasLastSeen = await hasUserColumn(c, "last_seen_at");
	if (!hasLastSeen) {
		return c.json(
			{
				error: "Stats schema not migrated",
				message:
					"Missing users.last_seen_at in D1. Run the local/remote migration to add last_seen_at and user_activity_days.",
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
	await c.env.DB.prepare(
		`UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?`,
	)
		.bind(nowIso, nowIso, userId)
		.run();

	try {
		await c.env.DB.prepare(
			`
        INSERT INTO user_activity_days (day, user_id, last_seen_at)
        VALUES (?, ?, ?)
        ON CONFLICT(day, user_id) DO UPDATE SET
          last_seen_at = excluded.last_seen_at
      `,
		)
			.bind(day, userId, nowIso)
			.run();
	} catch {
		// If user_activity_days isn't migrated yet, keep ping working for "online" stats.
	}

	return c.json({ ok: true });
});

statsRouter.get("/", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);

	const schemaErr = await ensureStatsSchema(c);
	if (schemaErr) return schemaErr;

	const totalRow = await c.env.DB.prepare(
		`SELECT COUNT(1) AS cnt FROM users`,
	).first<any>();

	const onlineRow = await c.env.DB.prepare(
		`SELECT COUNT(1) AS cnt FROM users WHERE last_seen_at IS NOT NULL AND datetime(last_seen_at) >= datetime('now', '-2 minutes')`,
	).first<any>();

	const newTodayRow = await c.env.DB.prepare(
		`SELECT COUNT(1) AS cnt FROM users WHERE created_at IS NOT NULL AND date(created_at) = date('now')`,
	).first<any>();

	const totalUsers = Number(totalRow?.cnt ?? 0) || 0;
	const onlineUsers = Number(onlineRow?.cnt ?? 0) || 0;
	const newUsersToday = Number(newTodayRow?.cnt ?? 0) || 0;
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

	const rows = await c.env.DB.prepare(
		`
      SELECT day, COUNT(1) AS cnt
      FROM user_activity_days
      WHERE day >= ? AND day <= ?
      GROUP BY day
      ORDER BY day ASC
    `,
	)
		.bind(since, todayUtc)
		.all<any>();

	const map = new Map<string, number>();
	for (const r of rows?.results || []) {
		const day = typeof r?.day === "string" ? r.day : null;
		if (!day) continue;
		map.set(day, Number(r?.cnt ?? 0) || 0);
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

	const rows = await c.env.DB.prepare(
		`
      SELECT vendor,
             COUNT(1) AS total,
             SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS success,
             AVG(duration_ms) AS avg_duration_ms
      FROM vendor_api_call_logs
      WHERE status IN ('succeeded','failed')
        AND finished_at IS NOT NULL
        AND finished_at >= ?
      GROUP BY vendor
      ORDER BY total DESC
    `,
	)
		.bind(sinceIso)
		.all<any>();

	const vendors = (rows.results ?? []).map((r: any) => ({
		vendor: typeof r?.vendor === "string" ? r.vendor : "",
		total: Number(r?.total ?? 0) || 0,
		success: Number(r?.success ?? 0) || 0,
		avgDurationMs:
			typeof r?.avg_duration_ms === "number" && Number.isFinite(r.avg_duration_ms)
				? Math.round(r.avg_duration_ms)
				: null,
	}));

	const extras = await Promise.all(
		vendors.map(async (v) => {
			const last = await c.env.DB.prepare(
				`
          SELECT status, finished_at, duration_ms
          FROM vendor_api_call_logs
          WHERE vendor = ?
            AND status IN ('succeeded','failed')
            AND finished_at IS NOT NULL
          ORDER BY finished_at DESC
          LIMIT 1
        `,
			)
				.bind(v.vendor)
				.first<any>();

			const historyRows = await c.env.DB.prepare(
				`
          SELECT status, finished_at
          FROM vendor_api_call_logs
          WHERE vendor = ?
            AND status IN ('succeeded','failed')
            AND finished_at IS NOT NULL
            AND finished_at >= ?
          ORDER BY finished_at DESC
          LIMIT ?
        `,
			)
				.bind(v.vendor, sinceIso, points)
				.all<any>();

			const history = (historyRows.results ?? [])
				.map((h: any) => ({
					status: h?.status === "succeeded" ? "succeeded" : "failed",
					finishedAt:
						typeof h?.finished_at === "string" ? h.finished_at : null,
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
