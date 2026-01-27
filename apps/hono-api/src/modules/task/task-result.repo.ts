import type { D1Database } from "../../types";
import { execute, queryOne } from "../../db/db";

export type TaskResultRow = {
	user_id: string;
	task_id: string;
	vendor: string;
	kind: string;
	status: string;
	result: string;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
};

let schemaEnsured = false;

export async function ensureTaskResultsSchema(db: D1Database): Promise<void> {
	if (schemaEnsured) return;
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS task_results (
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      vendor TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (user_id, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_task_results_user_updated_at
     ON task_results(user_id, updated_at)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_task_results_user_status
     ON task_results(user_id, status)`,
	);
	schemaEnsured = true;
}

export async function upsertTaskResult(
	db: D1Database,
	input: {
		userId: string;
		taskId: string;
		vendor: string;
		kind: string;
		status: string;
		result: unknown;
		completedAt?: string | null;
		nowIso: string;
	},
): Promise<void> {
	await ensureTaskResultsSchema(db);
	const userId = (input.userId || "").trim();
	const taskId = (input.taskId || "").trim();
	const vendor = (input.vendor || "").trim();
	const kind = (input.kind || "").trim();
	if (!userId || !taskId || !vendor || !kind) return;

	const resultJson = JSON.stringify(input.result ?? null);

	await execute(
		db,
		`INSERT INTO task_results
       (user_id, task_id, vendor, kind, status, result, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, task_id) DO UPDATE SET
         vendor = excluded.vendor,
         kind = excluded.kind,
         status = excluded.status,
         result = excluded.result,
         updated_at = excluded.updated_at,
         completed_at = CASE
           WHEN excluded.completed_at IS NOT NULL THEN excluded.completed_at
           ELSE task_results.completed_at
         END`,
		[
			userId,
			taskId,
			vendor,
			kind,
			input.status,
			resultJson,
			input.nowIso,
			input.nowIso,
			input.completedAt ?? null,
		],
	);
}

export async function getTaskResultByTaskId(
	db: D1Database,
	userId: string,
	taskId: string,
): Promise<TaskResultRow | null> {
	await ensureTaskResultsSchema(db);
	const uid = (userId || "").trim();
	const tid = (taskId || "").trim();
	if (!uid || !tid) return null;
	return queryOne<TaskResultRow>(
		db,
		`SELECT *
     FROM task_results
     WHERE user_id = ? AND task_id = ?
     LIMIT 1`,
		[uid, tid],
	);
}

