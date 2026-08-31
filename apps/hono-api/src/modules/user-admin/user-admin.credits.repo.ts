import { getPrismaClient } from "../../platform/node/prisma";
import type {
	LedgerEntryDto,
	LedgerListResponseDto,
	UserCreditsOverviewDto,
} from "./user-admin.schemas";

function startOfDayIso(now: Date): string {
	const d = new Date(now);
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString();
}

function startOfMonthIso(now: Date): string {
	const d = new Date(now);
	d.setUTCDate(1);
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString();
}

function clampNonNeg(n: number): number {
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export async function fetchUserCreditsOverview(
	userId: string,
	opts?: { now?: Date },
): Promise<UserCreditsOverviewDto> {
	const uid = (userId || "").trim();
	if (!uid) {
		return {
			userId: "",
			teamId: null,
			totals: {
				deductTotal: 0,
				deductMonth: 0,
				deductToday: 0,
				frozenNow: 0,
				countTotal: 0,
			},
			byTaskKind: [],
		};
	}

	const prisma = getPrismaClient();
	const now = opts?.now ?? new Date();
	const monthStart = startOfMonthIso(now);
	const dayStart = startOfDayIso(now);

	const totalAgg = await prisma.team_credit_ledger.aggregate({
		where: { actor_user_id: uid, entry_type: "deduct" },
		_sum: { amount: true },
		_count: { _all: true },
	});

	const monthAgg = await prisma.team_credit_ledger.aggregate({
		where: {
			actor_user_id: uid,
			entry_type: "deduct",
			created_at: { gte: monthStart },
		},
		_sum: { amount: true },
	});

	const todayAgg = await prisma.team_credit_ledger.aggregate({
		where: {
			actor_user_id: uid,
			entry_type: "deduct",
			created_at: { gte: dayStart },
		},
		_sum: { amount: true },
	});

	const reserves = await prisma.team_credit_ledger.findMany({
		where: {
			actor_user_id: uid,
			entry_type: "reserve",
			task_id: { not: null },
		},
		select: { task_id: true, amount: true },
	});
	const taskIds = Array.from(
		new Set(
			reserves
				.map((r: { task_id: string | null; amount: number }) => r.task_id ?? "")
				.filter((s: string) => Boolean(s)),
		),
	);

	const deducts = taskIds.length
		? await prisma.team_credit_ledger.groupBy({
				by: ["task_id"],
				where: { entry_type: "deduct", task_id: { in: taskIds } },
				_sum: { amount: true },
			})
		: [];
	const releases = taskIds.length
		? await prisma.team_credit_ledger.groupBy({
				by: ["task_id"],
				where: { entry_type: "release", task_id: { in: taskIds } },
				_sum: { amount: true },
			})
		: [];

	const deductMap = new Map<string, number>(
		(deducts as Array<{ task_id: string | null; _sum: { amount: number | null } }>).map((r) => [
			String(r.task_id ?? ""),
			Number(r._sum?.amount ?? 0),
		]),
	);
	const releaseMap = new Map<string, number>(
		(releases as Array<{ task_id: string | null; _sum: { amount: number | null } }>).map((r) => [
			String(r.task_id ?? ""),
			Number(r._sum?.amount ?? 0),
		]),
	);
	const reservedMap = new Map<string, number>();
	for (const r of reserves) {
		const tid = String(r.task_id ?? "");
		if (!tid) continue;
		reservedMap.set(tid, (reservedMap.get(tid) ?? 0) + Number(r.amount ?? 0));
	}

	let frozenNow = 0;
	for (const [tid, reserved] of reservedMap) {
		const remaining =
			reserved - (deductMap.get(tid) ?? 0) - (releaseMap.get(tid) ?? 0);
		if (remaining > 0) frozenNow += remaining;
	}

	const byKindRows = await prisma.team_credit_ledger.groupBy({
		by: ["task_kind"],
		where: { actor_user_id: uid, entry_type: "deduct" },
		_sum: { amount: true },
		_count: { _all: true },
		orderBy: { _sum: { amount: "desc" } },
	});

	const latest = await prisma.team_credit_ledger.findFirst({
		where: { actor_user_id: uid },
		orderBy: { created_at: "desc" },
		select: { team_id: true },
	});

	return {
		userId: uid,
		teamId: latest?.team_id ?? null,
		totals: {
			deductTotal: clampNonNeg(Number(totalAgg._sum?.amount ?? 0)),
			deductMonth: clampNonNeg(Number(monthAgg._sum?.amount ?? 0)),
			deductToday: clampNonNeg(Number(todayAgg._sum?.amount ?? 0)),
			frozenNow: clampNonNeg(frozenNow),
			countTotal: clampNonNeg(Number(totalAgg._count?._all ?? 0)),
		},
		byTaskKind: (
			byKindRows as Array<{
				task_kind: string | null;
				_sum: { amount: number | null };
				_count: { _all: number };
			}>
		).map((r) => ({
			taskKind: typeof r.task_kind === "string" ? r.task_kind : "",
			count: clampNonNeg(Number(r._count?._all ?? 0)),
			amount: clampNonNeg(Number(r._sum?.amount ?? 0)),
		})),
	};
}

export async function listUserCreditsLedger(
	userId: string,
	opts: {
		entryTypes?: string[] | null;
		taskIdLike?: string | null;
		since?: string | null;
		until?: string | null;
		cursor?: string | null;
		cursorAt?: string | null;
		limit?: number;
	},
): Promise<LedgerListResponseDto> {
	const uid = (userId || "").trim();
	if (!uid) return { items: [], nextCursor: null };

	const prisma = getPrismaClient();
	const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)));
	const entryTypes = (opts.entryTypes || [])
		.map((s) => s.trim())
		.filter(Boolean);
	const taskIdLike = (opts.taskIdLike || "").trim();
	const since = (opts.since || "").trim();
	const until = (opts.until || "").trim();
	const cursor = (opts.cursor || "").trim();
	const cursorAt = (opts.cursorAt || "").trim();

	const createdAtFilter: Record<string, string> = {};
	if (since) createdAtFilter.gte = since;
	if (until) createdAtFilter.lte = until;

	const where: any = {
		actor_user_id: uid,
		...(entryTypes.length ? { entry_type: { in: entryTypes } } : {}),
		...(taskIdLike ? { task_id: { contains: taskIdLike } } : {}),
		...(Object.keys(createdAtFilter).length ? { created_at: createdAtFilter } : {}),
	};
	if (cursor && cursorAt) {
		where.AND = [
			...(where.AND || []),
			{
				OR: [
					{ created_at: { lt: cursorAt } },
					{ AND: [{ created_at: cursorAt }, { id: { lt: cursor } }] },
				],
			},
		];
	}

	const rows = await prisma.team_credit_ledger.findMany({
		where,
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
		take: limit + 1,
	});

	const hasMore = rows.length > limit;
	const slice = rows.slice(0, limit);
	const items: LedgerEntryDto[] = slice.map((r: any) => ({
		id: String(r.id),
		entryType: String(r.entry_type),
		amount: clampNonNeg(Number(r.amount ?? 0)),
		taskId: typeof r.task_id === "string" ? r.task_id : null,
		taskKind: typeof r.task_kind === "string" ? r.task_kind : null,
		actorUserId: typeof r.actor_user_id === "string" ? r.actor_user_id : null,
		note: typeof r.note === "string" ? r.note : null,
		createdAt: String(r.created_at),
	}));
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last ? { id: last.id, createdAt: last.createdAt } : null;
	return { items, nextCursor };
}
