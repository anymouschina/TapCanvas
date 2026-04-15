import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

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

export async function ensureTaskResultsSchema(db: PrismaClient): Promise<void> {
	void db;
	if (schemaEnsured) return;
	// DDL is handled by startup schema bootstrap for Postgres.
	schemaEnsured = true;
}

export async function upsertTaskResult(
	db: PrismaClient,
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

	const prisma = getPrismaClient();
	const existing = await prisma.task_results.findUnique({
		where: { user_id_task_id: { user_id: userId, task_id: taskId } },
		select: { completed_at: true },
	});
	await prisma.task_results.upsert({
		where: { user_id_task_id: { user_id: userId, task_id: taskId } },
		create: {
			user_id: userId,
			task_id: taskId,
			vendor,
			kind,
			status: input.status,
			result: resultJson,
			created_at: input.nowIso,
			updated_at: input.nowIso,
			completed_at: input.completedAt ?? null,
		},
		update: {
			vendor,
			kind,
			status: input.status,
			result: resultJson,
			updated_at: input.nowIso,
			completed_at: input.completedAt ?? existing?.completed_at ?? null,
		},
	});
}

export async function getTaskResultByTaskId(
	db: PrismaClient,
	userId: string,
	taskId: string,
): Promise<TaskResultRow | null> {
	await ensureTaskResultsSchema(db);
	const uid = (userId || "").trim();
	const tid = (taskId || "").trim();
	if (!uid || !tid) return null;
	return getPrismaClient().task_results.findUnique({
		where: { user_id_task_id: { user_id: uid, task_id: tid } },
	});
}
