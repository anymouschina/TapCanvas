import { describe, expect, it } from "vitest";
import type { AppContext } from "../../types";
import {
	advanceContinuationSettlement,
	buildContinuationSettlementEffectId,
	createContinuationSettlementRecord,
	executeContinuationSettlementRecoveryCapsule,
	findTerminalContinuationSettlementForPublicTurn,
	parseContinuationSettlementRecord,
	type ContinuationSettlementRecordV1,
} from "./agents-continuation-settlement";
import { ContinuationSettlementRecoveryError } from "./continuation-settlement-recovery-error";

function createExecutableSettlementRecord(): ContinuationSettlementRecordV1 {
	return createContinuationSettlementRecord({
		effectId: "continuation-registration:turn-replay:continuation-replay",
		userId: "user-replay",
		logicalTaskId: "logical-replay",
		publicTurnId: "turn-replay",
		nowIso: "2026-08-20T00:00:00.000Z",
		phase: "reconcile_required",
		recoveryCapsule: {
			version: 1,
			continuation: {
				id: "continuation-replay",
				rootRequestId: "turn-replay",
				stage: 1,
				resumeTrigger: "physical_budget",
				parentContinuationId: null,
				userId: "user-replay",
				projectId: "project-replay",
				flowId: "flow-replay",
				chapterId: null,
				bookId: null,
				canvasNodeId: null,
				executionToolPolicy: null,
				sessionKey: "session-replay",
				modelKey: null,
				modelAlias: null,
				requiredSkills: [],
				dependencyNodeIds: [],
				dependencyTaskIds: [],
				dependencyRunIds: [],
				handledArtifactIds: ["root_physical_run:run-replay:1"],
				progressFingerprint: "fingerprint-replay",
				expectedDelivery: { active: true },
				createdAt: "2026-08-20T00:00:00.000Z",
				attempt: 0,
				nextAttemptAt: null,
				lastFailure: null,
			},
		},
	});
}

describe("continuation settlement", () => {
	it("derives one stable effect identity for the settlement and billing boundary", () => {
		expect(buildContinuationSettlementEffectId({ rootRequestId: "turn-1", settlementIdentity: "run-1" }))
			.toBe("continuation-registration:turn-1:run-1");
		expect(buildContinuationSettlementEffectId({ rootRequestId: "turn-1", settlementIdentity: "none" }))
			.toBe("continuation-registration:turn-1:none");
	});
	it("preserves ordered validation/writeback/quota settlement", () => {
		const initial = createContinuationSettlementRecord({
			effectId: "effect-1",
			userId: "user-1",
			logicalTaskId: "logical-1",
			publicTurnId: "turn-1",
			nowIso: "2026-08-20T00:00:00.000Z",
		});
		const writeback = advanceContinuationSettlement(initial, "durable_writeback", {
			nowIso: "2026-08-20T00:00:01.000Z",
		});
		const quota = advanceContinuationSettlement(writeback, "quota_spend", {
			nowIso: "2026-08-20T00:00:02.000Z",
		});
		expect(advanceContinuationSettlement(quota, "settled", {
			nowIso: "2026-08-20T00:00:03.000Z",
		}).phase).toBe("settled");
	});

	it("round-trips a versioned executable recovery capsule and rejects drift", () => {
		const initial = createContinuationSettlementRecord({
			effectId: "effect-3",
			userId: "user-3",
			logicalTaskId: "logical-3",
			publicTurnId: "turn-3",
			nowIso: "2026-08-20T00:00:00.000Z",
			recoveryCapsule: {
				version: 1,
				continuation: {
					id: "continuation-3",
					rootRequestId: "turn-3",
					stage: 1,
					resumeTrigger: "physical_budget",
					parentContinuationId: null,
					userId: "user-3",
					projectId: "project-3",
					flowId: "flow-3",
					chapterId: null,
					bookId: null,
					canvasNodeId: null,
					executionToolPolicy: null,
					sessionKey: "session-3",
					modelKey: null,
					modelAlias: null,
					requiredSkills: [],
					dependencyNodeIds: [],
					dependencyTaskIds: [],
					dependencyRunIds: [],
					handledArtifactIds: ["artifact-3"],
					progressFingerprint: "fingerprint-3",
					expectedDelivery: { active: true },
					createdAt: "2026-08-20T00:00:00.000Z",
					attempt: 0,
					nextAttemptAt: null,
					lastFailure: null,
				},
			},
		});
		const parsed = parseContinuationSettlementRecord(JSON.parse(JSON.stringify(initial)));
		expect(parsed?.recoveryCapsule).toMatchObject({ version: 1, continuation: { id: "continuation-3" } });
		expect(parseContinuationSettlementRecord({ ...initial, version: 2 })).toBeNull();
		expect(parseContinuationSettlementRecord({ ...initial, recoveryCapsule: { version: 2 } })).toBeNull();
	});

	it("moves failed post-result work to reconciliation without terminalizing the result", () => {
		const initial = createContinuationSettlementRecord({
			effectId: "effect-2",
			userId: "user-2",
			logicalTaskId: "logical-2",
			publicTurnId: "turn-2",
			nowIso: "2026-08-20T00:00:00.000Z",
			lastError: "db unavailable",
		});
		const reconciled = advanceContinuationSettlement(initial, "reconcile_required", {
			nowIso: "2026-08-20T00:00:01.000Z",
			error: initial.lastError,
		});
		expect(reconciled.phase).toBe("reconcile_required");
		expect(reconciled.lastError).toBe("db unavailable");
	});

	it("replays one failed recovery and then settles the same effect without duplicating successful work", async () => {
		const initial = createExecutableSettlementRecord();
		const row: {
			status: string;
			data: string;
			updated_at: string;
			completed_at: string | null;
		} = {
			status: "claimed",
			data: JSON.stringify(initial),
			updated_at: initial.updatedAt,
			completed_at: null,
		};
		const db = {
			task_statuses: {
				findUnique: async () => ({
					status: row.status,
					data: row.data,
					updated_at: row.updated_at,
				}),
				updateMany: async (input: {
					where: { status?: string; data?: string; updated_at?: string };
					data: { status?: string; data?: string; updated_at?: string; completed_at?: string | null };
				}) => {
					if (
						(input.where.status && input.where.status !== row.status) ||
						(input.where.data && input.where.data !== row.data) ||
						(input.where.updated_at && input.where.updated_at !== row.updated_at)
					) return { count: 0 };
					if (input.data.status) row.status = input.data.status;
					if (input.data.data) row.data = input.data.data;
					if (input.data.updated_at) row.updated_at = input.data.updated_at;
					if (input.data.completed_at !== undefined) row.completed_at = input.data.completed_at;
					return { count: 1 };
				},
			},
		};
		const c = { env: { DB: db } } as unknown as AppContext;
		let recoveryAttempts = 0;
		let successfulEffects = 0;
		const execute = async (): Promise<void> => {
			recoveryAttempts += 1;
			if (recoveryAttempts === 1) throw new Error("queue temporarily unavailable");
			successfulEffects += 1;
		};

		await expect(executeContinuationSettlementRecoveryCapsule({
			c,
			record: initial,
			execute,
		})).resolves.toBe("reconcile_required");
		expect(row.status).toBe("waiting");
		const failedRecord = parseContinuationSettlementRecord(JSON.parse(row.data) as unknown);
		expect(failedRecord?.effectId).toBe(initial.effectId);
		expect(failedRecord?.lastError).toBe("queue temporarily unavailable");
		if (!failedRecord) throw new Error("failed settlement record was not persisted");

		const claimedAgain = advanceContinuationSettlement(failedRecord, "reconcile_required", {
			nowIso: "2026-08-20T00:00:02.000Z",
			error: failedRecord?.lastError,
		});
		row.status = "claimed";
		row.data = JSON.stringify(claimedAgain);
		row.updated_at = claimedAgain.updatedAt;
		await expect(executeContinuationSettlementRecoveryCapsule({
			c,
			record: claimedAgain,
			execute,
		})).resolves.toBe("settled");
		expect(row.status).toBe("settled");
		expect(recoveryAttempts).toBe(2);
		expect(successfulEffects).toBe(1);

		await expect(executeContinuationSettlementRecoveryCapsule({
			c,
			record: claimedAgain,
			execute,
		})).resolves.toBe("not_executable");
		expect(successfulEffects).toBe(1);
	});

	it("terminalizes deterministic identity drift once and atomically projects the public trace", async () => {
		const initial = createExecutableSettlementRecord();
		const settlementRow = {
			status: "claimed",
			data: JSON.stringify(initial),
			updated_at: initial.updatedAt,
			completed_at: null as string | null,
		};
		const traceRow = { user_id: initial.userId, status: "waiting_async" };
		const tx = {
			task_statuses: {
				findUnique: async () => ({
					status: settlementRow.status,
					data: settlementRow.data,
					updated_at: settlementRow.updated_at,
				}),
				updateMany: async (request: {
					where: { status?: string; data?: string; updated_at?: string };
					data: { status?: string; data?: string; updated_at?: string; completed_at?: string | null };
				}) => {
					if (
						(request.where.status && request.where.status !== settlementRow.status) ||
						(request.where.data && request.where.data !== settlementRow.data) ||
						(request.where.updated_at && request.where.updated_at !== settlementRow.updated_at)
					) return { count: 0 };
					if (request.data.status) settlementRow.status = request.data.status;
					if (request.data.data) settlementRow.data = request.data.data;
					if (request.data.updated_at) settlementRow.updated_at = request.data.updated_at;
					if (request.data.completed_at !== undefined) settlementRow.completed_at = request.data.completed_at;
					return { count: 1 };
				},
			},
			execution_traces: {
				findUnique: async () => ({ ...traceRow }),
				updateMany: async () => {
					traceRow.status = "failed";
					return { count: 1 };
				},
			},
		};
		const db = {
			...tx,
			$transaction: async <T>(operation: (transaction: typeof tx) => Promise<T>): Promise<T> => operation(tx),
		};
		const c = { env: { DB: db } } as unknown as AppContext;
		let attempts = 0;
		const execute = async (): Promise<void> => {
			attempts += 1;
			throw new ContinuationSettlementRecoveryError({
				code: "continuation_settlement_registration_identity_drift",
				retryable: false,
			});
		};

		await expect(executeContinuationSettlementRecoveryCapsule({
			c,
			record: initial,
			execute,
		})).resolves.toBe("failed");
		expect(settlementRow.status).toBe("failed");
		expect(traceRow.status).toBe("failed");
		const failed = parseContinuationSettlementRecord(JSON.parse(settlementRow.data) as unknown);
		expect(failed).toMatchObject({
			phase: "failed",
			terminalBoundary: {
				code: "continuation_settlement_registration_identity_drift",
				safePathsExhausted: true,
			},
		});

		await expect(executeContinuationSettlementRecoveryCapsule({
			c,
			record: initial,
			execute,
		})).resolves.toBe("not_executable");
		expect(attempts).toBe(1);
	});

	it("finds only a terminal settlement owned by the exact user and public turn", async () => {
		const initial = createExecutableSettlementRecord();
		const failedAt = "2026-08-20T00:00:03.000Z";
		const failed: ContinuationSettlementRecordV1 = {
			...advanceContinuationSettlement(initial, "failed", {
				nowIso: failedAt,
				error: "identity drift",
			}),
			terminalBoundary: {
				version: 1,
				code: "continuation_settlement_registration_identity_drift",
				safePathsExhausted: true,
				failedAt,
			},
		};
		const findMany = async (request: { where: { user_id: string } }) =>
			request.where.user_id === failed.userId
				? [{ task_id: failed.effectId, data: JSON.stringify(failed) }]
				: [];
		const c = { env: { DB: { task_statuses: { findMany } } } } as unknown as AppContext;

		await expect(findTerminalContinuationSettlementForPublicTurn({
			c,
			userId: initial.userId,
			publicTurnId: initial.publicTurnId,
		})).resolves.toMatchObject({ effectId: initial.effectId, phase: "failed" });
		await expect(findTerminalContinuationSettlementForPublicTurn({
			c,
			userId: "another-user",
			publicTurnId: initial.publicTurnId,
		})).resolves.toBeNull();
	});
});
