import type { AppContext } from "../../types";
import {
	createTaskStatusIfAbsent,
	listWaitingTaskStatusesForFairSweep,
	requeueStaleClaimedTaskStatuses,
	tryClaimTaskStatus,
} from "./task-status.repo";
import { parseAsyncAgentContinuation, type AsyncAgentContinuation } from "./async-agent-continuation";
import {
	isTerminalContinuationSettlementRecoveryError,
	isContinuationSettlementRecoveryFailureCode,
	type ContinuationSettlementRecoveryFailureCode,
} from "./continuation-settlement-recovery-error";

export const AGENTS_CONTINUATION_SETTLEMENT_PROVIDER = "agents_continuation_settlement";
export const CONTINUATION_SETTLEMENT_PROTOCOL_VERSION = 1 as const;

export type ContinuationSettlementRecoveryCapsuleV1 = {
	version: typeof CONTINUATION_SETTLEMENT_PROTOCOL_VERSION;
	continuation: AsyncAgentContinuation;
};

export type ContinuationSettlementPhase =
	| "validation"
	| "durable_writeback"
	| "quota_spend"
	| "settled"
	| "reconcile_required"
	| "failed";

export type ContinuationSettlementTerminalBoundaryV1 = Readonly<{
	version: 1;
	code: ContinuationSettlementRecoveryFailureCode;
	safePathsExhausted: true;
	failedAt: string;
}>;

export type ContinuationSettlementRecordV1 = {
	version: typeof CONTINUATION_SETTLEMENT_PROTOCOL_VERSION;
	effectId: string;
	userId: string;
	logicalTaskId: string;
	publicTurnId: string;
	physicalRunId: string | null;
	phase: ContinuationSettlementPhase;
	attempt: number;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
	recoveryCapsule?: ContinuationSettlementRecoveryCapsuleV1;
	terminalBoundary?: ContinuationSettlementTerminalBoundaryV1;
};

const CONTINUATION_SETTLEMENT_PHASE_ORDER: readonly ContinuationSettlementPhase[] = [
	"validation",
	"durable_writeback",
	"quota_spend",
	"settled",
	"reconcile_required",
	"failed",
];

function readRequired(value: string, name: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${name} is required`);
	return normalized;
}

/** Stable cross-layer identity for one logical continuation settlement effect. */
export function buildContinuationSettlementEffectId(input: {
	rootRequestId: string;
	settlementIdentity: string;
}): string {
	return [
		"continuation-registration",
		readRequired(input.rootRequestId, "rootRequestId"),
		readRequired(input.settlementIdentity, "settlementIdentity"),
	].join(":");
}

export function createContinuationSettlementRecord(input: {
	effectId: string;
	userId: string;
	logicalTaskId: string;
	publicTurnId: string;
	physicalRunId?: string | null;
	nowIso: string;
	phase?: ContinuationSettlementPhase;
	lastError?: string | null;
	recoveryCapsule?: ContinuationSettlementRecoveryCapsuleV1;
}): ContinuationSettlementRecordV1 {
	const nowIso = readRequired(input.nowIso, "nowIso");
	return {
		version: CONTINUATION_SETTLEMENT_PROTOCOL_VERSION,
		effectId: readRequired(input.effectId, "effectId"),
		userId: readRequired(input.userId, "userId"),
		logicalTaskId: readRequired(input.logicalTaskId, "logicalTaskId"),
		publicTurnId: readRequired(input.publicTurnId, "publicTurnId"),
		physicalRunId: input.physicalRunId?.trim() || null,
		phase: input.phase ?? "validation",
		attempt: 0,
		lastError: input.lastError?.trim() || null,
		createdAt: nowIso,
		updatedAt: nowIso,
		...(input.recoveryCapsule ? { recoveryCapsule: structuredClone(input.recoveryCapsule) } : {}),
	};
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseSettlementPhase(value: unknown): ContinuationSettlementPhase | null {
	return CONTINUATION_SETTLEMENT_PHASE_ORDER.includes(value as ContinuationSettlementPhase)
		? value as ContinuationSettlementPhase
		: null;
}

function parseRecoveryCapsule(value: unknown): ContinuationSettlementRecoveryCapsuleV1 | null {
	const source = readRecord(value);
	if (!source || source.version !== CONTINUATION_SETTLEMENT_PROTOCOL_VERSION) return null;
	const continuation = parseAsyncAgentContinuation(source.continuation);
	return continuation ? { version: 1, continuation } : null;
}

function parseTerminalBoundary(value: unknown): ContinuationSettlementTerminalBoundaryV1 | null {
	const source = readRecord(value);
	if (
		!source ||
		source.version !== 1 ||
		source.safePathsExhausted !== true ||
		!isContinuationSettlementRecoveryFailureCode(source.code) ||
		typeof source.failedAt !== "string" ||
		!source.failedAt.trim()
	) return null;
	return {
		version: 1,
		code: source.code,
		safePathsExhausted: true,
		failedAt: source.failedAt.trim(),
	};
}

export function parseContinuationSettlementRecord(value: unknown): ContinuationSettlementRecordV1 | null {
	const source = readRecord(value);
	if (!source || source.version !== CONTINUATION_SETTLEMENT_PROTOCOL_VERSION) return null;
	const phase = parseSettlementPhase(source.phase);
	const readString = (candidate: unknown): string | null =>
		typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
	const effectId = readString(source.effectId);
	const logicalTaskId = readString(source.logicalTaskId);
	const userId = readString(source.userId);
	const publicTurnId = readString(source.publicTurnId);
	const createdAt = readString(source.createdAt);
	const updatedAt = readString(source.updatedAt);
	const physicalRunId = source.physicalRunId === null ? null : readString(source.physicalRunId);
	const attempt = source.attempt;
	if (!phase || !effectId || !userId || !logicalTaskId || !publicTurnId || !createdAt || !updatedAt ||
		(source.physicalRunId !== null && physicalRunId === null) ||
		typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) return null;
	const recoveryCapsule = parseRecoveryCapsule(source.recoveryCapsule);
	if (source.recoveryCapsule !== undefined && !recoveryCapsule) return null;
	const terminalBoundary = parseTerminalBoundary(source.terminalBoundary);
	if (source.terminalBoundary !== undefined && !terminalBoundary) return null;
	if (phase === "failed" && !terminalBoundary) return null;
	if (phase !== "failed" && terminalBoundary) return null;
	return {
		version: CONTINUATION_SETTLEMENT_PROTOCOL_VERSION,
		effectId,
		userId,
		logicalTaskId,
		publicTurnId,
		physicalRunId,
		phase,
		attempt,
		lastError: source.lastError === null ? null : readString(source.lastError),
		createdAt,
		updatedAt,
		...(recoveryCapsule ? { recoveryCapsule } : {}),
		...(terminalBoundary ? { terminalBoundary } : {}),
	};
}

export function advanceContinuationSettlement(
	record: ContinuationSettlementRecordV1,
	phase: ContinuationSettlementPhase,
	input: { nowIso: string; error?: string | null },
): ContinuationSettlementRecordV1 {
	const currentIndex = CONTINUATION_SETTLEMENT_PHASE_ORDER.indexOf(record.phase);
	const nextIndex = CONTINUATION_SETTLEMENT_PHASE_ORDER.indexOf(phase);
	if (currentIndex < 0 || nextIndex < 0) throw new Error("invalid settlement phase");
	const isRecoverySuccess = record.phase === "reconcile_required" && phase === "settled";
	if ((record.phase === "settled" || record.phase === "failed") && phase !== record.phase) {
		throw new Error("terminal settlement phase cannot change");
	}
	if (phase !== "reconcile_required" && nextIndex < currentIndex && !isRecoverySuccess) {
		throw new Error("settlement phase cannot move backwards");
	}
	return {
		...record,
		phase,
		attempt: record.attempt + 1,
		lastError: input.error?.trim() || null,
		updatedAt: readRequired(input.nowIso, "nowIso"),
	};
}

async function commitContinuationSettlementTerminalFailure(input: {
	c: AppContext;
	record: ContinuationSettlementRecordV1;
	boundary: ContinuationSettlementTerminalBoundaryV1;
	errorMessage: string;
}): Promise<boolean> {
	const failedRecord: ContinuationSettlementRecordV1 = {
		...advanceContinuationSettlement(input.record, "failed", {
			nowIso: input.boundary.failedAt,
			error: input.errorMessage,
		}),
		terminalBoundary: input.boundary,
	};
	return input.c.env.DB.$transaction(async (tx) => {
		const trace = await tx.execution_traces.findUnique({
			where: { id: input.record.publicTurnId },
			select: { user_id: true, status: true },
		});
		if (trace && trace.user_id !== input.record.userId) {
			throw new Error("continuation_settlement_trace_user_identity_drift");
		}
		if (trace && (trace.status === "running" || trace.status === "waiting_async")) {
			const projected = await tx.execution_traces.updateMany({
				where: {
					id: input.record.publicTurnId,
					user_id: input.record.userId,
					status: { in: ["running", "waiting_async"] },
				},
				data: {
					status: "failed",
					error_code: input.boundary.code,
					error_detail: input.errorMessage,
					updated_at: input.boundary.failedAt,
					finished_at: input.boundary.failedAt,
				},
			});
			if (projected.count !== 1) throw new Error("continuation_settlement_trace_projection_lost");
		}
		const committed = await tx.task_statuses.updateMany({
			where: {
				task_id: failedRecord.effectId,
				provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				status: "claimed",
				data: JSON.stringify(input.record),
				updated_at: input.record.updatedAt,
			},
			data: {
				user_id: input.record.userId,
				status: "failed",
				data: JSON.stringify(failedRecord),
				updated_at: failedRecord.updatedAt,
				completed_at: failedRecord.updatedAt,
			},
		});
		return committed.count === 1;
	});
}

export async function findTerminalContinuationSettlementForPublicTurn(input: {
	c: AppContext;
	userId: string;
	publicTurnId: string;
}): Promise<ContinuationSettlementRecordV1 | null> {
	const prefix = `continuation-registration:${input.publicTurnId.trim()}:`;
	if (!input.userId.trim() || !input.publicTurnId.trim()) return null;
	const rows = await input.c.env.DB.task_statuses.findMany({
		where: {
			provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
			status: "failed",
			user_id: input.userId.trim(),
			task_id: { startsWith: prefix },
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		take: 20,
	});
	for (const row of rows) {
		let record: ContinuationSettlementRecordV1 | null = null;
		try {
			record = parseContinuationSettlementRecord(JSON.parse(row.data ?? "null") as unknown);
		} catch {
			throw new Error(`continuation_settlement_terminal_record_invalid:${row.task_id}`);
		}
		if (!record) throw new Error(`continuation_settlement_terminal_record_invalid:${row.task_id}`);
		if (
			record.phase !== "failed" ||
			record.userId !== input.userId.trim() ||
			record.publicTurnId !== input.publicTurnId.trim() ||
			record.terminalBoundary?.safePathsExhausted !== true
		) throw new Error(`continuation_settlement_terminal_record_identity_drift:${row.task_id}`);
		return record;
	}
	return null;
}

export async function persistContinuationSettlementFailure(input: {
	c: AppContext;
	userId: string;
	record: ContinuationSettlementRecordV1;
}): Promise<void> {
	const nowIso = new Date().toISOString();
	const reconcile = advanceContinuationSettlement(input.record, "reconcile_required", {
		nowIso,
		error: input.record.lastError,
	});
	await createTaskStatusIfAbsent(input.c.env.DB, {
		taskId: reconcile.effectId,
		provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
		userId: input.userId,
		status: "waiting",
		data: reconcile,
		nowIso,
	});
}

export async function claimContinuationSettlementReconciliation(
	c: AppContext,
	limit = 20,
): Promise<ContinuationSettlementRecordV1[]> {
	const nowMs = Date.now();
	await requeueStaleClaimedTaskStatuses(c.env.DB, {
		provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
		staleBeforeIso: new Date(nowMs - 5 * 60_000).toISOString(),
		nowIso: new Date(nowMs).toISOString(),
	});
	const rows = await listWaitingTaskStatusesForFairSweep(c.env.DB, {
		provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
		limit,
	});
	const claimed: ContinuationSettlementRecordV1[] = [];
	for (const row of rows) {
		if (!(await tryClaimTaskStatus(c.env.DB, {
			taskId: row.task_id,
			provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
			nowIso: new Date().toISOString(),
		}))) continue;
		try {
			const parsed: unknown = row.data ? JSON.parse(row.data) : null;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				const failedAt = new Date().toISOString();
				await c.env.DB.task_statuses.updateMany({
					where: {
						task_id: row.task_id,
						provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
						status: "claimed",
					},
					data: {
						status: "failed",
						data: JSON.stringify({
							version: 1,
							effectId: row.task_id,
							phase: "failed",
							parseError: true,
							terminalBoundary: {
								version: 1,
								code: "continuation_settlement_contract_invalid",
								safePathsExhausted: true,
								failedAt,
							},
						}),
						updated_at: failedAt,
						completed_at: failedAt,
					},
				});
				continue;
			}
			const record = parseContinuationSettlementRecord(parsed);
			if (!record) {
				await c.env.DB.task_statuses.updateMany({
					where: {
						task_id: row.task_id,
						provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
						status: "claimed",
					},
					data: {
						status: "failed",
						data: JSON.stringify({ version: 1, effectId: row.task_id, phase: "failed", parseError: true }),
						updated_at: new Date().toISOString(),
						completed_at: new Date().toISOString(),
					},
				});
				continue;
			}
			if (!record.recoveryCapsule) {
				const claimedRecord = advanceContinuationSettlement(record, "reconcile_required", {
					nowIso: new Date().toISOString(),
					error: record.lastError ?? "continuation_settlement_recovery_capsule_missing",
				});
				const persisted = await c.env.DB.task_statuses.updateMany({
					where: {
						task_id: row.task_id,
						provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
						status: "claimed",
					},
					data: {
						data: JSON.stringify(claimedRecord),
						updated_at: claimedRecord.updatedAt,
					},
				});
				if (persisted.count === 1) claimed.push(claimedRecord);
				continue;
			}
			const claimedRecord = advanceContinuationSettlement(record, "reconcile_required", {
				nowIso: new Date().toISOString(),
				error: record.lastError,
			});
			const persisted = await c.env.DB.task_statuses.updateMany({
				where: {
					task_id: row.task_id,
					provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
					status: "claimed",
				},
				data: {
					data: JSON.stringify(claimedRecord),
					updated_at: claimedRecord.updatedAt,
				},
			});
			if (persisted.count === 1) claimed.push(claimedRecord);
		} catch {
			const failedAt = new Date().toISOString();
			await c.env.DB.task_statuses.updateMany({
				where: {
					task_id: row.task_id,
					provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
					status: "claimed",
				},
				data: {
					status: "failed",
					data: JSON.stringify({
						version: 1,
						effectId: row.task_id,
						phase: "failed",
						parseError: true,
						terminalBoundary: {
							version: 1,
							code: "continuation_settlement_contract_invalid",
							safePathsExhausted: true,
							failedAt,
						},
					}),
					updated_at: failedAt,
					completed_at: failedAt,
				},
			});
		}
	}
	return claimed;
}

/**
 * Executes the recovery capsule after a durable claim. The executor is
 * deliberately injected by the owning workflow so this marker module never
 * invents a new task route or semantic prompt. A successful callback advances
 * the same effect marker to settled; a failed callback keeps the evidence in
 * reconcile_required for the next bounded sweep.
 */
export async function executeContinuationSettlementRecoveryCapsule(input: {
	c: AppContext;
	record: ContinuationSettlementRecordV1;
	execute: (capsule: ContinuationSettlementRecoveryCapsuleV1) => Promise<void>;
}): Promise<"settled" | "reconcile_required" | "failed" | "not_executable"> {
	const capsule = input.record.recoveryCapsule;
	const authoritative = await input.c.env.DB.task_statuses.findUnique({
		where: {
			task_id_provider: {
				task_id: input.record.effectId,
				provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
			},
		},
		select: { status: true, data: true, updated_at: true },
	});
	if (
		authoritative?.status !== "claimed" ||
		authoritative.data !== JSON.stringify(input.record) ||
		authoritative.updated_at !== input.record.updatedAt
	) return "not_executable";
	if (!capsule) {
		const failedAt = new Date().toISOString();
		const committed = await commitContinuationSettlementTerminalFailure({
			c: input.c,
			record: input.record,
			boundary: {
				version: 1,
				code: "continuation_settlement_contract_invalid",
				safePathsExhausted: true,
				failedAt,
			},
			errorMessage: "continuation_settlement_recovery_capsule_missing",
		});
		return committed ? "failed" : "not_executable";
	}
	try {
		await input.execute(capsule);
		const settled = advanceContinuationSettlement(input.record, "settled", {
			nowIso: new Date().toISOString(),
		});
		const committed = await input.c.env.DB.task_statuses.updateMany({
			where: {
				task_id: settled.effectId,
				provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				status: "claimed",
				data: authoritative.data,
				updated_at: authoritative.updated_at,
			},
			data: {
				user_id: input.record.userId,
				status: "settled",
				data: JSON.stringify(settled),
				updated_at: settled.updatedAt,
				completed_at: settled.updatedAt,
			},
		});
		return committed.count === 1 ? "settled" : "not_executable";
	} catch (error: unknown) {
		if (isTerminalContinuationSettlementRecoveryError(error)) {
			const failedAt = new Date().toISOString();
			const committed = await commitContinuationSettlementTerminalFailure({
				c: input.c,
				record: input.record,
				boundary: {
					version: 1,
					code: error.code,
					safePathsExhausted: true,
					failedAt,
				},
				errorMessage: error.message,
			});
			return committed ? "failed" : "not_executable";
		}
		const failed = advanceContinuationSettlement(input.record, "reconcile_required", {
			nowIso: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error),
		});
		await input.c.env.DB.task_statuses.updateMany({
			where: {
				task_id: failed.effectId,
				provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				status: "claimed",
				data: authoritative.data,
				updated_at: authoritative.updated_at,
			},
			data: {
				user_id: input.record.userId,
				status: "waiting",
				data: JSON.stringify(failed),
				updated_at: failed.updatedAt,
				completed_at: null,
			},
		});
		return "reconcile_required";
	}
}

/** Re-exposes a claimed recovery marker when durable queue publication fails. */
export async function deferContinuationSettlementRecovery(input: {
	c: AppContext;
	record: ContinuationSettlementRecordV1;
	error: unknown;
}): Promise<void> {
	const deferred = advanceContinuationSettlement(input.record, "reconcile_required", {
		nowIso: new Date().toISOString(),
		error: input.error instanceof Error ? input.error.message : String(input.error),
	});
	await input.c.env.DB.task_statuses.updateMany({
		where: {
			task_id: deferred.effectId,
			provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
			status: "claimed",
			data: JSON.stringify(input.record),
			updated_at: input.record.updatedAt,
		},
		data: {
			user_id: deferred.userId,
			status: "waiting",
			data: JSON.stringify(deferred),
			updated_at: deferred.updatedAt,
			completed_at: null,
		},
	});
}
