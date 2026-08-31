import type { PrismaClient } from "../../types";

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

export async function ensureTaskStatusesSchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;
	// DDL is handled by startup schema bootstrap for Postgres.
	schemaEnsured = true;
}

export async function upsertTaskStatus(
	db: PrismaClient,
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

	const prisma = db;
	const existing = await prisma.task_statuses.findUnique({
		where: {
			task_id_provider: { task_id: taskId, provider },
		},
		select: { completed_at: true },
	});
	await prisma.task_statuses.upsert({
		where: {
			task_id_provider: { task_id: taskId, provider },
		},
		create: {
			id: crypto.randomUUID(),
			task_id: taskId,
			provider,
			user_id: input.userId ?? null,
			status: input.status,
			data,
			created_at: input.nowIso,
			updated_at: input.nowIso,
			completed_at: input.completedAt ?? null,
		},
		update: {
			user_id: input.userId ?? null,
			status: input.status,
			data,
			updated_at: input.nowIso,
			completed_at: input.completedAt ?? existing?.completed_at ?? null,
		},
	});
}

/**
 * Creates a durable task contract once without resetting an existing lifecycle.
 * Duplicate callbacks must not turn a completed/failed/claimed continuation back
 * into a fresh waiting task.
 */
export async function createTaskStatusIfAbsent(
	db: PrismaClient,
	input: {
		taskId: string;
		provider: string;
		userId?: string | null;
		status: string;
		data?: unknown;
		nowIso: string;
	},
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	const data =
		typeof input.data === "undefined" ? null : JSON.stringify(input.data ?? null);

	try {
		await db.task_statuses.create({
			data: {
				id: crypto.randomUUID(),
				task_id: taskId,
				provider,
				user_id: input.userId ?? null,
				status: input.status,
				data,
				created_at: input.nowIso,
				updated_at: input.nowIso,
				completed_at: null,
			},
		});
		return true;
	} catch (error) {
		const code =
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			typeof error.code === "string"
				? error.code
				: "";
		if (code === "P2002") return false;
		throw error;
	}
}

/**
 * Reads durable auxiliary task records for one provider.  `task_statuses` is
 * deliberately reused for long lived execution contracts: unlike an in-memory
 * timer it survives a worker restart and does not require a second workflow
 * schema for each new asynchronous capability.
 */
export async function listTaskStatusesByProvider(
	db: PrismaClient,
	input: {
		provider: string;
		status: string;
		userId?: string;
		order?: "asc" | "desc";
		limit?: number;
		before?: { createdAt: string; id: string };
	},
): Promise<TaskStatusRow[]> {
	await ensureTaskStatusesSchema(db);
	const provider = input.provider.trim();
	const status = input.status.trim();
	if (!provider || !status) return [];
	const userId = input.userId?.trim();
	const order = input.order ?? "asc";
	const before = input.before;
	return db.task_statuses.findMany({
		where: {
			provider,
			status,
			...(userId ? { user_id: userId } : {}),
			...(before
				? {
					OR: order === "desc"
						? [
							{ created_at: { lt: before.createdAt } },
							{ created_at: before.createdAt, id: { lt: before.id } },
						]
						: [
							{ created_at: { gt: before.createdAt } },
							{ created_at: before.createdAt, id: { gt: before.id } },
						],
				}
				: {}),
		},
		orderBy: [{ created_at: order }, { id: order }],
		take: Math.max(1, Math.min(100, Math.trunc(input.limit ?? 30))),
	});
}

/**
 * Continuation-only fair scan order. Pending rows are touched after inspection,
 * so a fixed page cannot permanently hide later ready rows.
 */
export async function listWaitingTaskStatusesForFairSweep(
	db: PrismaClient,
	input: { provider: string; limit?: number },
): Promise<TaskStatusRow[]> {
	await ensureTaskStatusesSchema(db);
	const provider = input.provider.trim();
	if (!provider) return [];
	return db.task_statuses.findMany({
		where: { provider, status: "waiting" },
		orderBy: [
			{ updated_at: "asc" },
			{ created_at: "asc" },
			{ id: "asc" },
		],
		take: Math.max(1, Math.min(100, Math.trunc(input.limit ?? 30))),
	});
}

export async function getTaskStatusByIdentity(
	db: PrismaClient,
	input: { taskId: string; provider: string },
): Promise<TaskStatusRow | null> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return null;
	return db.task_statuses.findUnique({
		where: { task_id_provider: { task_id: taskId, provider } },
	});
}

/** Atomically claims a waiting record so concurrent reconcile callers resume it once. */
export async function tryClaimTaskStatus(
	db: PrismaClient,
	input: { taskId: string; provider: string; nowIso: string; claimedData?: unknown },
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	const updated = await db.task_statuses.updateMany({
		where: { task_id: taskId, provider, status: "waiting" },
		data: {
			status: "claimed",
			...(typeof input.claimedData === "undefined"
				? {}
				: { data: JSON.stringify(input.claimedData ?? null) }),
			updated_at: input.nowIso,
		},
	});
	return updated.count === 1;
}

/**
 * Completes, fails or defers only the exact active claim. A cancelled row or a
 * row already advanced by another owner is immutable to the stale runner.
 */
export async function transitionClaimedTaskStatus(
	db: PrismaClient,
	input: {
		taskId: string;
		provider: string;
		userId?: string | null;
		status: string;
		data?: unknown;
		completedAt?: string | null;
		claimToken?: string;
		nowIso: string;
	},
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	const serializedData = typeof input.data === "undefined"
		? undefined
		: JSON.stringify(input.data ?? null);
	let claimedDataFence: string | undefined;
	if (input.claimToken) {
		const current = await db.task_statuses.findUnique({
			where: { task_id_provider: { task_id: taskId, provider } },
			select: { status: true, data: true },
		});
		if (current?.status !== "claimed" || !current.data) return false;
		try {
			const parsed: unknown = JSON.parse(current.data);
			if (
				!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
				(parsed as Record<string, unknown>).claimToken !== input.claimToken
			) return false;
			claimedDataFence = current.data;
		} catch {
			return false;
		}
	}
	const updated = await db.task_statuses.updateMany({
		where: {
			task_id: taskId,
			provider,
			status: "claimed",
			...(claimedDataFence ? { data: claimedDataFence } : {}),
		},
		data: {
			...(input.userId !== undefined ? { user_id: input.userId } : {}),
			status: input.status,
			...(typeof serializedData === "string" ? { data: serializedData } : {}),
			updated_at: input.nowIso,
			...(input.completedAt !== undefined ? { completed_at: input.completedAt } : {}),
		},
	});
	return updated.count === 1;
}

/** User-authorized cancellation of one exact continuation, including an active claim. */
export async function tryCancelActiveTaskStatus(
	db: PrismaClient,
	input: { taskId: string; provider: string; nowIso: string },
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	const updated = await db.task_statuses.updateMany({
		where: { task_id: taskId, provider, status: { in: ["waiting", "claimed"] } },
		data: {
			status: "failed",
			updated_at: input.nowIso,
			completed_at: input.nowIso,
		},
	});
	return updated.count === 1;
}

/**
 * Terminalizes a malformed waiting contract without rewriting its raw payload.
 * The exact waiting-state CAS prevents a concurrent valid claimant from being
 * overwritten, while the preserved data remains available for diagnostics.
 */
export async function failWaitingTaskStatus(
	db: PrismaClient,
	input: { taskId: string; provider: string; nowIso: string; data?: unknown },
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	const serializedData = typeof input.data === "undefined"
		? undefined
		: JSON.stringify(input.data ?? null);
	const updated = await db.task_statuses.updateMany({
		where: { task_id: taskId, provider, status: "waiting" },
		data: {
			status: "failed",
			...(typeof serializedData === "string" ? { data: serializedData } : {}),
			updated_at: input.nowIso,
			completed_at: input.nowIso,
		},
	});
	return updated.count === 1;
}

/**
 * Explicitly reclaims one failed durable contract after the caller has proven
 * that its owning runtime turn is orphaned. This is intentionally separate
 * from the normal waiting-queue claim so background sweeps cannot replay an
 * ambiguous continuation without the exact session/turn recovery handshake.
 */
export async function tryClaimFailedTaskStatusForExplicitResume(
	db: PrismaClient,
	input: { taskId: string; provider: string; nowIso: string; claimedData?: unknown },
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	const updated = await db.task_statuses.updateMany({
		where: { task_id: taskId, provider, status: "failed" },
		data: {
			status: "claimed",
			...(typeof input.claimedData === "undefined"
				? {}
				: { data: JSON.stringify(input.claimedData ?? null) }),
			updated_at: input.nowIso,
			completed_at: null,
		},
	});
	return updated.count === 1;
}

/**
 * Reclaims an in-flight continuation only after the public status handshake
 * proved its physical runner is absent. `expectedUpdatedAtIso` is the lease
 * fence: a concurrent heartbeat changes the row and makes this CAS fail.
 */
export async function tryReclaimClaimedTaskStatusForExplicitResume(
	db: PrismaClient,
	input: {
		taskId: string;
		provider: string;
		expectedUpdatedAtIso: string;
		claimedData?: unknown;
		nowIso: string;
	},
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	const expectedUpdatedAtIso = input.expectedUpdatedAtIso.trim();
	if (!taskId || !provider || !expectedUpdatedAtIso) return false;
	const updated = await db.task_statuses.updateMany({
		where: {
			task_id: taskId,
			provider,
			status: "claimed",
			updated_at: expectedUpdatedAtIso,
		},
		data: {
			...(typeof input.claimedData === "undefined"
				? {}
				: { data: JSON.stringify(input.claimedData ?? null) }),
			updated_at: input.nowIso,
			completed_at: null,
		},
	});
	return updated.count === 1;
}

/** Keeps an actively executing claim leased so a concurrent sweep cannot recover it. */
export async function touchClaimedTaskStatus(
	db: PrismaClient,
	input: { taskId: string; provider: string; nowIso: string; claimToken?: string },
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	let claimedDataFence: string | undefined;
	if (input.claimToken) {
		const current = await db.task_statuses.findUnique({
			where: { task_id_provider: { task_id: taskId, provider } },
			select: { status: true, data: true },
		});
		if (current?.status !== "claimed" || !current.data) return false;
		try {
			const parsed: unknown = JSON.parse(current.data);
			if (
				!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
				(parsed as Record<string, unknown>).claimToken !== input.claimToken
			) return false;
			claimedDataFence = current.data;
		} catch {
			return false;
		}
	}
	const updated = await db.task_statuses.updateMany({
		where: {
			task_id: taskId,
			provider,
			status: "claimed",
			...(claimedDataFence ? { data: claimedDataFence } : {}),
		},
		data: { updated_at: input.nowIso },
	});
	return updated.count === 1;
}

/** Move one still-waiting inspected row to the back of the fair sweep order. */
export async function touchWaitingTaskStatus(
	db: PrismaClient,
	input: { taskId: string; provider: string; nowIso: string },
): Promise<boolean> {
	await ensureTaskStatusesSchema(db);
	const taskId = input.taskId.trim();
	const provider = input.provider.trim();
	if (!taskId || !provider) return false;
	const updated = await db.task_statuses.updateMany({
		where: { task_id: taskId, provider, status: "waiting" },
		data: { updated_at: input.nowIso },
	});
	return updated.count === 1;
}

/** Rotates a bounded inspected page in one statement instead of N row writes. */
export async function touchWaitingTaskStatuses(
	db: PrismaClient,
	input: { taskIds: readonly string[]; provider: string; nowIso: string },
): Promise<number> {
	await ensureTaskStatusesSchema(db);
	const taskIds = [...new Set(input.taskIds.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
	const provider = input.provider.trim();
	if (!provider || taskIds.length === 0) return 0;
	const updated = await db.task_statuses.updateMany({
		where: { task_id: { in: taskIds }, provider, status: "waiting" },
		data: { updated_at: input.nowIso },
	});
	return updated.count;
}

/**
 * Requeues claims whose worker lease expired. The continuation payload is kept
 * intact; the next durable sweep will revalidate its real canvas dependencies
 * before claiming it again.
 */
export async function requeueStaleClaimedTaskStatuses(
	db: PrismaClient,
	input: {
		provider: string;
		staleBeforeIso: string;
		nowIso: string;
	},
): Promise<number> {
	await ensureTaskStatusesSchema(db);
	const provider = input.provider.trim();
	if (!provider) return 0;
	const staleRows = await db.task_statuses.findMany({
		where: {
			provider,
			status: "claimed",
			updated_at: { lte: input.staleBeforeIso },
		},
		orderBy: [{ updated_at: "asc" }, { created_at: "asc" }, { id: "asc" }],
		take: 100,
		select: { task_id: true, data: true, updated_at: true },
	});
	let requeued = 0;
	for (const row of staleRows) {
		let waitingData = row.data;
		if (waitingData) {
			try {
				const parsed: unknown = JSON.parse(waitingData);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					const { claimToken: _expiredClaimToken, ...withoutClaim } = parsed as Record<string, unknown>;
					waitingData = JSON.stringify(withoutClaim);
				}
			} catch {
				// Keep malformed payload evidence intact; the bounded sweep will fail it explicitly.
			}
		}
		const updated = await db.task_statuses.updateMany({
			where: {
				task_id: row.task_id,
				provider,
				status: "claimed",
				updated_at: row.updated_at,
				data: row.data,
			},
			data: {
				status: "waiting",
				data: waitingData,
				updated_at: input.nowIso,
			},
		});
		requeued += updated.count;
	}
	return requeued;
}
