import type { D1Database } from "../../types";
import { execute, queryAll } from "../../db/db";

export type VendorCallLogStatus = "running" | "succeeded" | "failed";

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
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, vendor, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
	);
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
           created_at, updated_at
    FROM vendor_api_call_logs
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ?
  `;

	return queryAll<VendorCallLogRow>(db, sql, [...bindings, limit]);
}
