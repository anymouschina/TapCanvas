import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type ApiRequestLogRow = {
	id: string;
	user_id: string | null;
	api_key_id: string | null;
	method: string;
	path: string;
	status: number | null;
	stage: string | null;
	aborted: number;
	started_at: string;
	finished_at: string | null;
	duration_ms: number | null;
	trace_json: string | null;
	created_at: string;
	updated_at: string;
};

export async function ensureApiRequestLogsSchema(db: PrismaClient): Promise<void> {
	void db;
}

function normalizeString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeStatus(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return null;
	const status = Math.trunc(n);
	if (status < 0 || status > 999) return null;
	return status;
}

const MAX_TRACE_CHARS = 18_000;

export function stringifyTraceJson(value: unknown): string | null {
	if (value === undefined) return null;
	let json = "";
	try {
		json = JSON.stringify(value);
	} catch {
		try {
			json = JSON.stringify(String(value));
		} catch {
			json = "";
		}
	}
	if (!json) return null;
	if (json.length <= MAX_TRACE_CHARS) return json;
	const preview = json.slice(0, MAX_TRACE_CHARS);
	return JSON.stringify({
		truncated: true,
		originalLength: json.length,
		preview,
	});
}

export async function insertApiRequestLog(
	db: PrismaClient,
	input: {
		id: string;
		userId?: string | null;
		apiKeyId?: string | null;
		method: string;
		path: string;
		status?: number | null;
		stage?: string | null;
		aborted?: boolean;
		startedAt: string;
		finishedAt: string;
		durationMs: number;
		traceJson?: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const id = normalizeString(input.id);
	if (!id) return;

	const userId = normalizeString(input.userId ?? null);
	const apiKeyId = normalizeString(input.apiKeyId ?? null);
	const method = normalizeString(input.method) || "UNKNOWN";
	const path = normalizeString(input.path) || "/";
	const status = normalizeStatus(input.status ?? null);
	const stage = normalizeString(input.stage ?? null);
	const aborted = input.aborted ? 1 : 0;
	const startedAt = normalizeString(input.startedAt) || input.nowIso;
	const finishedAt = normalizeString(input.finishedAt) || input.nowIso;
	const durationMs =
		typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
			? Math.max(0, Math.round(input.durationMs))
			: null;
	const traceJson = normalizeString(input.traceJson ?? null);
	const nowIso = input.nowIso;

	await getPrismaClient().api_request_logs.create({
		data: {
			id,
			user_id: userId,
			api_key_id: apiKeyId,
			method,
			path,
			status,
			stage,
			aborted,
			started_at: startedAt,
			finished_at: finishedAt,
			duration_ms: durationMs,
			trace_json: traceJson,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
}

export async function listApiRequestLogs(
	db: PrismaClient,
	input: {
		sinceIso: string;
		limit: number;
		pathPrefix?: string | null;
	},
): Promise<ApiRequestLogRow[]> {
	void db;
	const limit = Math.max(1, Math.min(500, Math.floor(input.limit)));
	const sinceIso = normalizeString(input.sinceIso) || new Date(0).toISOString();
	const pathPrefix = normalizeString(input.pathPrefix ?? null);

	return getPrismaClient().api_request_logs.findMany({
		where: {
			started_at: { gte: sinceIso },
			...(pathPrefix ? { path: { startsWith: pathPrefix } } : {}),
		},
		orderBy: { started_at: "desc" },
		take: limit,
	});
}
