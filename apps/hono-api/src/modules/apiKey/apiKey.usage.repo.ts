import { getPrismaClient } from "../../platform/node/prisma";

export type RequestLogRow = {
	id: string;
	path: string;
	method: string;
	status: number | null;
	duration_ms: number | null;
	started_at: string;
};

// 构造 ISO 字符串时间字段的范围过滤（ISO 8601 字典序=时间序）。before=游标(上一页末条),lt。
function buildTimeRangeFilter(opts: {
	before?: string;
	since?: string;
	until?: string;
}): { gte?: string; lte?: string; lt?: string } | undefined {
	const f: { gte?: string; lte?: string; lt?: string } = {};
	if (opts.since) f.gte = opts.since;
	if (opts.until) f.lte = opts.until;
	if (opts.before) f.lt = opts.before;
	return Object.keys(f).length ? f : undefined;
}

export async function listRequestLogsByApiKey(
	apiKeyId: string,
	opts: { limit?: number; before?: string; since?: string; until?: string },
): Promise<RequestLogRow[]> {
	const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const range = buildTimeRangeFilter(opts);
	return getPrismaClient().api_request_logs.findMany({
		where: {
			api_key_id: apiKeyId,
			...(range ? { started_at: range } : {}),
		},
		orderBy: { started_at: "desc" },
		take,
		select: {
			id: true,
			path: true,
			method: true,
			status: true,
			duration_ms: true,
			started_at: true,
		},
	}) as Promise<RequestLogRow[]>;
}

export async function getApiKeyPrefixById(
	apiKeyId: string,
): Promise<string | null> {
	const row = (await getPrismaClient().api_keys.findUnique({
		where: { id: apiKeyId },
		select: { key_prefix: true },
	})) as { key_prefix?: string | null } | null;
	return row?.key_prefix ?? null;
}

export async function sumCreditsByApiKey(
	apiKeyId: string,
): Promise<{ personalSpent: number; teamSpent: number }> {
	const db = getPrismaClient();
	const [p, t] = await Promise.all([
		db.points_ledger.aggregate({
			where: { api_key_id: apiKeyId, change_amount: { lt: 0 } },
			_sum: { change_amount: true },
		}),
		db.team_credit_ledger.aggregate({
			where: { api_key_id: apiKeyId, entry_type: "deduct" },
			_sum: { amount: true },
		}),
	]);
	return {
		personalSpent: Math.abs(p._sum.change_amount ?? 0),
		teamSpent: t._sum.amount ?? 0,
	};
}

export async function listCreditLedgerByApiKey(
	apiKeyId: string,
	opts: { limit?: number; before?: string; since?: string; until?: string },
): Promise<
	Array<{
		source: "personal" | "team";
		amount: number;
		note: string | null;
		createdAt: string;
		kind: string | null;
	}>
> {
	const db = getPrismaClient();
	const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const range = buildTimeRangeFilter(opts);
	const createdFilter = range ? { created_at: range } : {};
	const [pers, team] = await Promise.all([
		db.points_ledger.findMany({
			where: { api_key_id: apiKeyId, change_amount: { lt: 0 }, ...createdFilter },
			orderBy: { created_at: "desc" },
			take,
			select: {
				change_amount: true,
				note: true,
				created_at: true,
				source_type: true,
			},
		}),
		db.team_credit_ledger.findMany({
			where: { api_key_id: apiKeyId, entry_type: "deduct", ...createdFilter },
			orderBy: { created_at: "desc" },
			take,
			select: {
				amount: true,
				note: true,
				created_at: true,
				task_kind: true,
			},
		}),
	]);
	const rows = [
		...pers.map((r) => ({
			source: "personal" as const,
			amount: Math.abs(r.change_amount),
			note: r.note,
			createdAt: r.created_at,
			kind: r.source_type,
		})),
		...team.map((r) => ({
			source: "team" as const,
			amount: r.amount,
			note: r.note,
			createdAt: r.created_at,
			kind: r.task_kind,
		})),
	];
	return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, take);
}
