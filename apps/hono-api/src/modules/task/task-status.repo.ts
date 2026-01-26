import type { D1Database } from "../../types";
import { execute } from "../../db/db";

export type TaskStatusRow = {
	id: string;
	task_id: string;
	provider: string;
	user_id: string | null;
	status: string;
	data: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
};

let schemaEnsured = false;

export async function ensureTaskStatusesSchema(db: D1Database): Promise<void> {
	if (schemaEnsured) return;
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS task_statuses (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      user_id TEXT,
      status TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE (task_id, provider)
    )`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_task_statuses_status
     ON task_statuses(status)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_task_statuses_created_at
     ON task_statuses(created_at)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_task_statuses_user_provider
     ON task_statuses(user_id, provider)`,
	);
	schemaEnsured = true;
}

export async function upsertTaskStatus(
	db: D1Database,
	input: {
		taskId: string;
		provider: string;
		userId?: string | null;
		status: string;
		data?: unknown;
		completedAt?: string | null;
		nowIso: string;
	},
): Promise<void> {
	await ensureTaskStatusesSchema(db);
	const taskId = (input.taskId || "").trim();
	const provider = (input.provider || "").trim();
	if (!taskId || !provider) return;

	const data =
		typeof input.data === "undefined" ? null : JSON.stringify(input.data ?? null);

	await db
		.prepare(
			`INSERT INTO task_statuses
       (id, task_id, provider, user_id, status, data, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id, provider) DO UPDATE SET
         user_id = excluded.user_id,
         status = excluded.status,
         data = excluded.data,
         updated_at = excluded.updated_at,
         completed_at = CASE
           WHEN excluded.completed_at IS NOT NULL THEN excluded.completed_at
           ELSE task_statuses.completed_at
         END`,
		)
		.bind(
			crypto.randomUUID(),
			taskId,
			provider,
			input.userId ?? null,
			input.status,
			data,
			input.nowIso,
			input.nowIso,
			input.completedAt ?? null,
		)
		.run();
}

