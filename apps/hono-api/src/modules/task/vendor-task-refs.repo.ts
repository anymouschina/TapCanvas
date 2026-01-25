import type { D1Database } from "../../types";
import { execute, queryOne } from "../../db/db";

export type VendorTaskRefKind = "video" | "character";

export type VendorTaskRefRow = {
	user_id: string;
	kind: VendorTaskRefKind;
	task_id: string;
	vendor: string;
	pid: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

export async function ensureVendorTaskRefsSchema(
	db: D1Database,
): Promise<void> {
	if (schemaEnsured) return;
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS vendor_task_refs (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      task_id TEXT NOT NULL,
      vendor TEXT NOT NULL,
      pid TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, kind, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_vendor_task_refs_user_kind_pid
     ON vendor_task_refs(user_id, kind, pid)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_vendor_task_refs_user_kind_vendor
     ON vendor_task_refs(user_id, kind, vendor)`,
	);
	schemaEnsured = true;
}

function normalizeKind(kind: VendorTaskRefKind): VendorTaskRefKind {
	return kind === "character" ? "character" : "video";
}

function normalizePid(pid?: string | null): string | null {
	if (typeof pid !== "string") return null;
	const trimmed = pid.trim();
	return trimmed ? trimmed : null;
}

export async function upsertVendorTaskRef(
	db: D1Database,
	userId: string,
	input: {
		kind: VendorTaskRefKind;
		taskId: string;
		vendor: string;
		pid?: string | null;
	},
	nowIso: string,
): Promise<void> {
	await ensureVendorTaskRefsSchema(db);
	const kind = normalizeKind(input.kind);
	const taskId = (input.taskId || "").trim();
	const vendor = (input.vendor || "").trim();
	const pid = normalizePid(input.pid);
	if (!taskId || !vendor) return;

	await execute(
		db,
		`INSERT INTO vendor_task_refs
       (user_id, kind, task_id, vendor, pid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, kind, task_id) DO UPDATE SET
         vendor = excluded.vendor,
         pid = CASE
           WHEN excluded.pid IS NOT NULL AND excluded.pid != '' THEN excluded.pid
           ELSE vendor_task_refs.pid
         END,
         updated_at = excluded.updated_at`,
		[userId, kind, taskId, vendor, pid, nowIso, nowIso],
	);
}

export async function getVendorTaskRefByTaskId(
	db: D1Database,
	userId: string,
	kind: VendorTaskRefKind,
	taskId: string,
): Promise<VendorTaskRefRow | null> {
	await ensureVendorTaskRefsSchema(db);
	const normalizedTaskId = (taskId || "").trim();
	if (!normalizedTaskId) return null;
	return queryOne<VendorTaskRefRow>(
		db,
		`SELECT *
     FROM vendor_task_refs
     WHERE user_id = ? AND kind = ? AND task_id = ?
     LIMIT 1`,
		[userId, normalizeKind(kind), normalizedTaskId],
	);
}

export async function getVendorTaskRefByPid(
	db: D1Database,
	userId: string,
	kind: VendorTaskRefKind,
	pid: string,
): Promise<VendorTaskRefRow | null> {
	await ensureVendorTaskRefsSchema(db);
	const normalizedPid = (pid || "").trim();
	if (!normalizedPid) return null;
	return queryOne<VendorTaskRefRow>(
		db,
		`SELECT *
     FROM vendor_task_refs
     WHERE user_id = ? AND kind = ? AND pid = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
		[userId, normalizeKind(kind), normalizedPid],
	);
}

