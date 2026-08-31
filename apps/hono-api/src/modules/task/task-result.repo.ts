import type { PrismaClient } from "../../types";

const TERMINAL_TASK_STATUSES = new Set(["succeeded", "failed"]);
export const TASK_RESULT_NOTIFICATION_TYPE = "task_result";

type TaskNotificationInput = Readonly<{
	userId: string;
	taskId: string;
	vendor: string;
	kind: string;
	status: "succeeded" | "failed";
	nodeId: string | null;
	chapterId: string | null;
	completedAt: string;
}>;

export function taskResultNotificationId(userId: string, taskId: string): string {
	return `task-result:${userId}:${taskId}`;
}

export function buildTaskResultNotification(input: TaskNotificationInput) {
	const succeeded = input.status === "succeeded";
	return {
		id: taskResultNotificationId(input.userId, input.taskId),
		user_id: input.userId,
		type: TASK_RESULT_NOTIFICATION_TYPE,
		title: succeeded ? "任务已完成" : "任务执行失败",
		body: `${input.kind} · ${input.vendor}`,
		action_url: null,
		metadata_json: JSON.stringify({
			protocolVersion: "tapcanvas.task-notification.v1",
			taskId: input.taskId,
			vendor: input.vendor,
			kind: input.kind,
			status: input.status,
			nodeId: input.nodeId,
			chapterId: input.chapterId,
			completedAt: input.completedAt,
		}),
		created_at: input.completedAt,
	};
}

async function upsertTerminalTaskNotification(
	db: Pick<PrismaClient, "user_notifications">,
	input: TaskNotificationInput,
): Promise<void> {
	const notification = buildTaskResultNotification(input);
	await db.user_notifications.upsert({
		where: { id: notification.id },
		create: { ...notification, read_at: null },
		update: {
			title: notification.title,
			body: notification.body,
			metadata_json: notification.metadata_json,
		},
	});
}

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
	chapter_id: string | null;
	node_id: string | null;
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
		chapterId?: string | null;
		nodeId?: string | null;
		nowIso: string;
	},
): Promise<void> {
	await ensureTaskResultsSchema(db);
	const userId = (input.userId || "").trim();
	const taskId = (input.taskId || "").trim();
	const vendor = (input.vendor || "").trim();
	const kind = (input.kind || "").trim();
	if (!userId || !taskId || !vendor || !kind) {
		throw new Error("task result identity is incomplete");
	}

	const resultJson = JSON.stringify(input.result ?? null);

	await db.$transaction(async (transaction) => {
		const existing = await transaction.task_results.findUnique({
			where: { user_id_task_id: { user_id: userId, task_id: taskId } },
			select: { status: true, completed_at: true, chapter_id: true, node_id: true },
		});
		if (existing?.status === "succeeded" && input.status !== "succeeded") {
			throw new Error(`task_result_terminal_conflict: succeeded -> ${input.status}`);
		}
		if (existing?.status === "failed" && input.status !== "failed" && input.status !== "succeeded") {
			throw new Error(`task_result_terminal_conflict: failed -> ${input.status}`);
		}
		const sameTerminalStatus = TERMINAL_TASK_STATUSES.has(input.status) && existing?.status === input.status;
		const completedAt = sameTerminalStatus
			? existing.completed_at ?? input.completedAt ?? null
			: input.completedAt ?? existing?.completed_at ?? null;
		const chapterId = input.chapterId ?? existing?.chapter_id ?? null;
		const nodeId = input.nodeId ?? existing?.node_id ?? null;
		await transaction.task_results.upsert({
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
				completed_at: completedAt,
				chapter_id: chapterId,
				node_id: nodeId,
			},
			update: {
				vendor,
				kind,
				status: input.status,
				result: resultJson,
				updated_at: input.nowIso,
				completed_at: completedAt,
				chapter_id: chapterId,
				node_id: nodeId,
			},
		});
		if (TERMINAL_TASK_STATUSES.has(input.status)) {
			if (!completedAt) throw new Error("terminal task result is missing completedAt");
			await upsertTerminalTaskNotification(transaction, {
				userId,
				taskId,
				vendor,
				kind,
				status: input.status as "succeeded" | "failed",
				nodeId,
				chapterId,
				completedAt,
			});
		}
	});
}

/**
 * Atomically records a client-visible task and its durable dispatch contract.
 * Redis/BullMQ is transport only: a process may exit immediately after this
 * transaction and the existing worker can still recover the waiting dispatch
 * from task_statuses without inventing a second task identity.
 */
export async function createTaskResultWithDurableDispatch(
	db: PrismaClient,
	input: {
		result: {
			userId: string;
			taskId: string;
			vendor: string;
			kind: string;
			status: string;
			result: unknown;
			nowIso: string;
		};
		dispatch: {
			provider: string;
			status: "waiting";
			data: unknown;
		};
	},
): Promise<void> {
	await ensureTaskResultsSchema(db);
	const userId = input.result.userId.trim();
	const taskId = input.result.taskId.trim();
	const vendor = input.result.vendor.trim();
	const kind = input.result.kind.trim();
	const provider = input.dispatch.provider.trim();
	if (!userId || !taskId || !vendor || !kind || !provider) {
		throw new Error("durable task dispatch identity is incomplete");
	}
	const resultJson = JSON.stringify(input.result.result ?? null);
	const dispatchJson = JSON.stringify(input.dispatch.data ?? null);
	await db.$transaction(async (transaction) => {
		await transaction.task_results.create({
			data: {
				user_id: userId,
				task_id: taskId,
				vendor,
				kind,
				status: input.result.status,
				result: resultJson,
				created_at: input.result.nowIso,
				updated_at: input.result.nowIso,
				completed_at: null,
				chapter_id: null,
				node_id: null,
			},
		});
		await transaction.task_statuses.create({
			data: {
				id: crypto.randomUUID(),
				task_id: taskId,
				provider,
				user_id: userId,
				status: input.dispatch.status,
				data: dispatchJson,
				created_at: input.result.nowIso,
				updated_at: input.result.nowIso,
				completed_at: null,
			},
		});
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
	return db.task_results.findUnique({
		where: { user_id_task_id: { user_id: uid, task_id: tid } },
	});
}

// 在原 result JSON 上盖 failed 终态 + stale 标注，保留原始字段便于追溯。纯函数，便于单测。
export function buildStaleFailResult(rawResult: string | null, reason: string): string {
	let base: Record<string, unknown> = {};
	try {
		const parsed = rawResult ? JSON.parse(rawResult) : null;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			base = parsed as Record<string, unknown>;
		}
	} catch {
		// 原 result 非法 JSON → 丢弃，只写终态
	}
	return JSON.stringify({
		...base,
		status: "failed",
		staleTimeout: true,
		failReason: reason,
	});
}

// 视频类任务（合法出片可达 15-16min，实测 seedance）用更宽阈值，避免误杀压线的合法慢渲染；
// 图片等其它任务用基础阈值。判定靠 kind 关键字（image_to_video / text_to_video / video / film / concat）。
function isVideoKind(kind: string): boolean {
	const k = (kind || "").toLowerCase();
	return /video|film|concat|i2v|t2v/.test(k);
}

/**
 * 坏死任务清扫：把 running/queued/claimed 且超龄的 task_results 标 failed。
 * 根治「legacy 直生 clip / 历史孤儿任务积压成永久 running」——它们不在 credit-finalizer 的
 * 「有未结算积分预留」扫描集里（pendingAmount<=0 被跳过），故此前永不被终结，画布节点永卡生成中。
 * 分级阈值：视频类用 videoStaleMs（默认更宽），其它用 staleMs。updated_at 是 ISO-Z 字符串，
 * 字典序=时间序，可直接 lt 比较：先按「较宽阈值」粗筛候选，再在代码里按 kind 精确判定，避免漏筛视频。
 */
export async function sweepStaleTaskResults(
	db: PrismaClient,
	input: { staleMs: number; videoStaleMs?: number; nowMs: number; limit?: number; reason?: string },
): Promise<{ scanned: number; failed: number }> {
	await ensureTaskResultsSchema(db);
	const staleMs = Math.max(60_000, Math.floor(input.staleMs));
	const videoStaleMs = Math.max(
		staleMs,
		Math.floor(input.videoStaleMs ?? Math.max(staleMs, 25 * 60_000)),
	);
	const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 200)));
	const reason = input.reason || "stale_timeout";
	const nowIso = new Date(input.nowMs).toISOString();
	// 粗筛用较短阈值（保证视频/非视频候选都进来），精判在代码里按 kind 用各自 cutoff。
	const coarseCutoffIso = new Date(input.nowMs - Math.min(staleMs, videoStaleMs)).toISOString();
	const videoCutoff = input.nowMs - videoStaleMs;
	const otherCutoff = input.nowMs - staleMs;
	const prisma = db;
	const candidates = await prisma.task_results.findMany({
		where: {
			status: { in: ["running", "queued", "claimed"] },
			updated_at: { lt: coarseCutoffIso },
		},
		select: { user_id: true, task_id: true, kind: true, result: true, updated_at: true },
		take: limit,
	});
	let failed = 0;
	let scanned = 0;
	for (const row of candidates) {
		const updatedMs = Date.parse(row.updated_at);
		if (!Number.isFinite(updatedMs)) continue;
		const cutoff = isVideoKind(row.kind) ? videoCutoff : otherCutoff;
		if (updatedMs >= cutoff) continue; // 未达该 kind 的阈值（如 16min 的视频未到 25min）→ 跳过
		scanned += 1;
		const failedResult = JSON.parse(buildStaleFailResult(row.result, reason)) as unknown;
		const updated = await failTaskResultIfNonTerminal(db, {
			userId: row.user_id,
			taskId: row.task_id,
			result: failedResult,
			nowIso,
		});
		failed += updated ? 1 : 0;
	}
	return { scanned, failed };
}

/**
 * 原子 claim：仅当当前 status='queued' 时改为 'claimed'。
 * 用 updateMany + where status 保证多 tab 竞态只一胜（Postgres 行锁串行化同一行的 UPDATE）。
 * 返回 true 表示本次 claim 成功。
 */
export async function tryClaimTaskResult(
	db: PrismaClient,
	input: { userId: string; taskId: string; result: unknown; nowIso: string },
): Promise<boolean> {
	await ensureTaskResultsSchema(db);
	const userId = (input.userId || "").trim();
	const taskId = (input.taskId || "").trim();
	if (!userId || !taskId) return false;
	const res = await db.task_results.updateMany({
		where: { user_id: userId, task_id: taskId, status: "queued" },
		data: { status: "claimed", result: JSON.stringify(input.result ?? null), updated_at: input.nowIso },
	});
	return res.count === 1;
}

export async function failTaskResultIfNonTerminal(
	db: PrismaClient,
	input: {
		userId: string;
		taskId: string;
		result: unknown;
		nowIso: string;
	},
): Promise<boolean> {
	await ensureTaskResultsSchema(db);
	const userId = input.userId.trim();
	const taskId = input.taskId.trim();
	if (!userId || !taskId) return false;
	return db.$transaction(async (transaction) => {
		const row = await transaction.task_results.findUnique({
			where: { user_id_task_id: { user_id: userId, task_id: taskId } },
			select: { vendor: true, kind: true, node_id: true, chapter_id: true },
		});
		if (!row) return false;
		const res = await transaction.task_results.updateMany({
			where: {
				user_id: userId,
				task_id: taskId,
				status: { in: ["queued", "claimed", "running"] },
			},
			data: {
				status: "failed",
				result: JSON.stringify(input.result ?? null),
				updated_at: input.nowIso,
				completed_at: input.nowIso,
			},
		});
		if (res.count !== 1) return false;
		await upsertTerminalTaskNotification(transaction, {
			userId,
			taskId,
			vendor: row.vendor,
			kind: row.kind,
			status: "failed",
			nodeId: row.node_id,
			chapterId: row.chapter_id,
			completedAt: input.nowIso,
		});
		return true;
	});
}
