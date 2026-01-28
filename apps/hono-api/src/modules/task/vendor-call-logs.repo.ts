import type { D1Database } from "../../types";
import { execute, queryAll } from "../../db/db";

export type VendorCallLogStatus = "running" | "succeeded" | "failed";

const SENSITIVE_JSON_KEYS = new Set([
	"apikey",
	"api_key",
	"key",
	"token",
	"access_token",
	"refresh_token",
	"secret",
	"password",
	"client_secret",
	"authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"secretToken",
]);

const LOG_MAX_DEPTH = 7;
const LOG_MAX_KEYS = 60;
const LOG_MAX_ARRAY = 40;
const LOG_MAX_STRING = 1800;
const LOG_MAX_JSON_CHARS = 14_000;

export type VendorCallLogUpsertInput = {
	userId: string;
	vendor: string;
	taskId: string;
	taskKind?: string | null;
	status: VendorCallLogStatus;
	errorMessage?: string | null;
	durationMs?: number | null;
	nowIso: string;
};

export type VendorCallLogRow = {
	user_id: string;
	vendor: string;
	task_id: string;
	task_kind: string | null;
	status: string;
	started_at: string | null;
	finished_at: string | null;
	duration_ms: number | null;
	error_message: string | null;
	request_json: string | null;
	response_json: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

async function vendorCallLogsHasColumn(
	db: D1Database,
	column: string,
): Promise<boolean> {
	try {
		const rows = await queryAll<any>(db, `PRAGMA table_info(vendor_api_call_logs)`);
		return rows.some((r: any) => r?.name === column);
	} catch {
		return false;
	}
}

export async function ensureVendorCallLogsSchema(
	db: D1Database,
): Promise<void> {
	if (schemaEnsured) return;
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS vendor_api_call_logs (
      user_id TEXT NOT NULL,
      vendor TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_kind TEXT,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      request_json TEXT,
      response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, vendor, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
	);

	// Backward-compatible add columns for existing deployments.
	if (!(await vendorCallLogsHasColumn(db, "request_json"))) {
		await execute(db, `ALTER TABLE vendor_api_call_logs ADD COLUMN request_json TEXT`);
	}
	if (!(await vendorCallLogsHasColumn(db, "response_json"))) {
		await execute(db, `ALTER TABLE vendor_api_call_logs ADD COLUMN response_json TEXT`);
	}

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_vendor_finished_at
     ON vendor_api_call_logs(vendor, finished_at)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_finished_at
     ON vendor_api_call_logs(finished_at)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_status
     ON vendor_api_call_logs(status)`,
	);
	schemaEnsured = true;
}

function normalizeVendorKey(vendor: string): string {
	return (vendor || "").trim().toLowerCase();
}

function normalizeTaskKind(kind?: string | null): string | null {
	if (typeof kind !== "string") return null;
	const trimmed = kind.trim();
	return trimmed ? trimmed : null;
}

function normalizeTaskId(taskId: string): string {
	return (taskId || "").trim();
}

function normalizeErrorMessage(message?: string | null): string | null {
	if (typeof message !== "string") return null;
	const trimmed = message.trim();
	return trimmed ? trimmed : null;
}

function looksLikeImageDataUrl(value: string): boolean {
	return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value.trim());
}

function sanitizeValueForLog(value: unknown): unknown {
	const seen = new WeakSet<object>();

	const sanitizeString = (str: string): string => {
		const raw = str || "";
		const trimmed = raw.trim();
		if (looksLikeImageDataUrl(trimmed)) {
			return `[data:image;base64 omitted len=${trimmed.length}]`;
		}
		if (trimmed.length > LOG_MAX_STRING) {
			return `${trimmed.slice(0, LOG_MAX_STRING)}…(truncated, len=${trimmed.length})`;
		}
		return trimmed;
	};

	const walk = (v: any, depth: number): any => {
		if (v === null || v === undefined) return v;
		const t = typeof v;
		if (t === "string") return sanitizeString(v);
		if (t === "number" || t === "boolean") return v;
		if (t === "bigint") return String(v);
		if (t === "function") return `[Function]`;
		if (t !== "object") return String(v);

		if (seen.has(v)) return "[Circular]";
		seen.add(v);

		if (depth >= LOG_MAX_DEPTH) return `[MaxDepth:${LOG_MAX_DEPTH}]`;

		if (Array.isArray(v)) {
			const out = v.slice(0, LOG_MAX_ARRAY).map((item) => walk(item, depth + 1));
			if (v.length > LOG_MAX_ARRAY) {
				out.push(`[...omitted ${v.length - LOG_MAX_ARRAY} items]`);
			}
			return out;
		}

		const entries = Object.entries(v);
		const out: Record<string, any> = {};
		let kept = 0;
		for (const [key, val] of entries) {
			if (kept >= LOG_MAX_KEYS) break;
			const lower = key.toLowerCase();
			if (SENSITIVE_JSON_KEYS.has(lower)) {
				out[key] = "***";
				kept += 1;
				continue;
			}
			out[key] = walk(val, depth + 1);
			kept += 1;
		}
		if (entries.length > kept) {
			out.__omittedKeys = entries.length - kept;
		}
		return out;
	};

	return walk(value, 0);
}

function stringifyLogJson(value: unknown): string | null {
	if (value === undefined) return null;
	const sanitized = sanitizeValueForLog(value);
	let json = "";
	try {
		json = JSON.stringify(sanitized);
	} catch {
		try {
			json = JSON.stringify(String(sanitized));
		} catch {
			json = "";
		}
	}
	if (!json) return null;
	if (json.length <= LOG_MAX_JSON_CHARS) return json;
	const preview = json.slice(0, LOG_MAX_JSON_CHARS);
	return JSON.stringify({
		truncated: true,
		originalLength: json.length,
		preview,
	});
}

export async function upsertVendorCallLogStarted(
	db: D1Database,
	input: Omit<VendorCallLogUpsertInput, "status">,
): Promise<void> {
	await ensureVendorCallLogsSchema(db);
	const vendor = normalizeVendorKey(input.vendor);
	const taskId = normalizeTaskId(input.taskId);
	if (!input.userId || !vendor || !taskId) return;
	const nowIso = input.nowIso;
	const taskKind = normalizeTaskKind(input.taskKind);

	await execute(
		db,
		`INSERT INTO vendor_api_call_logs
       (user_id, vendor, task_id, task_kind, status, started_at, finished_at, duration_ms, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(user_id, vendor, task_id) DO UPDATE SET
         task_kind = excluded.task_kind,
         status = CASE
           WHEN vendor_api_call_logs.status IN ('succeeded','failed') THEN vendor_api_call_logs.status
           ELSE excluded.status
         END,
         started_at = COALESCE(vendor_api_call_logs.started_at, excluded.started_at),
         updated_at = excluded.updated_at`,
		[input.userId, vendor, taskId, taskKind, nowIso, nowIso, nowIso],
	);
}

export async function upsertVendorCallLogFinal(
	db: D1Database,
	input: VendorCallLogUpsertInput,
): Promise<void> {
	await ensureVendorCallLogsSchema(db);
	const vendor = normalizeVendorKey(input.vendor);
	const taskId = normalizeTaskId(input.taskId);
	if (!input.userId || !vendor || !taskId) return;
	const nowIso = input.nowIso;
	const taskKind = normalizeTaskKind(input.taskKind);
	const status: VendorCallLogStatus =
		input.status === "succeeded"
			? "succeeded"
			: input.status === "failed"
				? "failed"
				: "running";
	const finishedAt = status === "running" ? null : nowIso;
	const errorMessage = normalizeErrorMessage(input.errorMessage);
	const durationMs =
		status === "running"
			? null
			: typeof input.durationMs === "number" &&
					Number.isFinite(input.durationMs) &&
					input.durationMs >= 0
				? Math.round(input.durationMs)
				: 0;

	await execute(
		db,
		`INSERT INTO vendor_api_call_logs
       (user_id, vendor, task_id, task_kind, status, started_at, finished_at, duration_ms, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, vendor, task_id) DO UPDATE SET
         task_kind = excluded.task_kind,
         status = excluded.status,
         started_at = COALESCE(vendor_api_call_logs.started_at, excluded.started_at),
         finished_at = excluded.finished_at,
         duration_ms = CASE
           WHEN excluded.finished_at IS NOT NULL AND vendor_api_call_logs.started_at IS NOT NULL
             THEN CAST((julianday(excluded.finished_at) - julianday(vendor_api_call_logs.started_at)) * 86400000 AS INTEGER)
           ELSE excluded.duration_ms
         END,
         error_message = excluded.error_message,
         updated_at = excluded.updated_at`,
		[
			input.userId,
			vendor,
			taskId,
			taskKind,
			status,
			nowIso,
			finishedAt,
			durationMs,
			errorMessage,
			nowIso,
			nowIso,
		],
	);
}

export async function upsertVendorCallLogPayloads(
	db: D1Database,
	input: {
		userId: string;
		vendor: string;
		taskId: string;
		taskKind?: string | null;
		request?: unknown;
		upstreamResponse?: unknown;
		nowIso: string;
	},
): Promise<void> {
	await ensureVendorCallLogsSchema(db);
	const vendor = normalizeVendorKey(input.vendor);
	const taskId = normalizeTaskId(input.taskId);
	if (!input.userId || !vendor || !taskId) return;
	const nowIso = input.nowIso;
	const taskKind = normalizeTaskKind(input.taskKind);
	const requestJson = stringifyLogJson(input.request);
	const responseJson = stringifyLogJson(input.upstreamResponse);

	if (!requestJson && !responseJson) return;

	await execute(
		db,
		`INSERT INTO vendor_api_call_logs
       (user_id, vendor, task_id, task_kind, status, started_at, finished_at, duration_ms, error_message, request_json, response_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, ?, ?, ?, ?)
       ON CONFLICT(user_id, vendor, task_id) DO UPDATE SET
         task_kind = COALESCE(excluded.task_kind, vendor_api_call_logs.task_kind),
         request_json = COALESCE(vendor_api_call_logs.request_json, excluded.request_json),
         response_json = COALESCE(vendor_api_call_logs.response_json, excluded.response_json),
         updated_at = excluded.updated_at`,
		[
			input.userId,
			vendor,
			taskId,
			taskKind,
			nowIso,
			requestJson,
			responseJson,
			nowIso,
			nowIso,
		],
	);
}

export async function listVendorCallLogsForUser(
	db: D1Database,
	userId: string,
	opts?: {
		limit?: number;
		before?: string | null;
		vendor?: string | null;
		status?: VendorCallLogStatus | null;
		taskKind?: string | null;
	},
): Promise<VendorCallLogRow[]> {
	await ensureVendorCallLogsSchema(db);
	const limit = Math.max(1, Math.min(201, Math.floor(opts?.limit ?? 50)));
	const before =
		typeof opts?.before === "string" && opts.before.trim()
			? opts.before.trim()
			: null;
	const vendor =
		typeof opts?.vendor === "string" && opts.vendor.trim()
			? normalizeVendorKey(opts.vendor)
			: null;
	const status =
		opts?.status === "running" ||
		opts?.status === "succeeded" ||
		opts?.status === "failed"
			? opts.status
			: null;
	const taskKind = normalizeTaskKind(opts?.taskKind ?? null);

	const where: string[] = ["user_id = ?"];
	const bindings: unknown[] = [userId];

	if (vendor) {
		where.push("vendor = ?");
		bindings.push(vendor);
	}
	if (status) {
		where.push("status = ?");
		bindings.push(status);
	}
	if (taskKind) {
		where.push("task_kind = ?");
		bindings.push(taskKind);
	}
	if (before) {
		where.push("created_at < ?");
		bindings.push(before);
	}

	const sql = `
    SELECT user_id, vendor, task_id, task_kind, status,
           started_at, finished_at, duration_ms, error_message,
           request_json, response_json,
           created_at, updated_at
    FROM vendor_api_call_logs
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ?
  `;

	return queryAll<VendorCallLogRow>(db, sql, [...bindings, limit]);
}
