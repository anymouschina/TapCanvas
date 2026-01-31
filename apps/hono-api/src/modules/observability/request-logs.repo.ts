import type { D1Database } from "../../types";
import { execute, queryAll } from "../../db/db";

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

let schemaEnsured = false;

async function hasTable(db: D1Database, table: string): Promise<boolean> {
	try {
		const res = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(table).all<any>();
		return Array.isArray(res?.results) && res.results.length > 0;
	} catch {
		return false;
	}
}

export async function ensureApiRequestLogsSchema(db: D1Database): Promise<void> {
	if (schemaEnsured) return;

	// D1 can be created lazily in local dev; guard for weird states.
	const exists = await hasTable(db, "api_request_logs");
	if (!exists) {
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS api_request_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        api_key_id TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER,
        stage TEXT,
        aborted INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        trace_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
		);
	}

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_api_request_logs_started_at
     ON api_request_logs(started_at)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_api_request_logs_path_started_at
     ON api_request_logs(path, started_at)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_api_request_logs_user_started_at
     ON api_request_logs(user_id, started_at)`,
	);

	schemaEnsured = true;
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
	db: D1Database,
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
	await ensureApiRequestLogsSchema(db);
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

	await execute(
		db,
		`INSERT INTO api_request_logs
       (id, user_id, api_key_id, method, path, status, stage, aborted, started_at, finished_at, duration_ms, trace_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			userId,
			apiKeyId,
			method,
			path,
			status,
			stage,
			aborted,
			startedAt,
			finishedAt,
			durationMs,
			traceJson,
			nowIso,
			nowIso,
		],
	);
}

export async function listApiRequestLogs(
	db: D1Database,
	input: {
		sinceIso: string;
		limit: number;
		pathPrefix?: string | null;
	},
): Promise<ApiRequestLogRow[]> {
	await ensureApiRequestLogsSchema(db);
	const limit = Math.max(1, Math.min(500, Math.floor(input.limit)));
	const sinceIso = normalizeString(input.sinceIso) || new Date(0).toISOString();
	const pathPrefix = normalizeString(input.pathPrefix ?? null);

	const where: string[] = ["started_at >= ?"];
	const bindings: unknown[] = [sinceIso];
	if (pathPrefix) {
		where.push("path LIKE ?");
		bindings.push(`${pathPrefix}%`);
	}

	const sql = `
    SELECT id, user_id, api_key_id, method, path, status, stage, aborted,
           started_at, finished_at, duration_ms, trace_json, created_at, updated_at
    FROM api_request_logs
    WHERE ${where.join(" AND ")}
    ORDER BY started_at DESC
    LIMIT ?
  `;

	return queryAll<ApiRequestLogRow>(db, sql, [...bindings, limit]);
}

