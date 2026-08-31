import type { Prisma, PrismaClient } from "@prisma/client";
import { planCreditBatchAllocations, type SpendableCreditBatch } from "./team-credit-allocation";

type CreditTransaction = Prisma.TransactionClient;

type LockedTeam = {
	id: string;
	credits: number;
	credits_frozen: number;
};

type LockedCreditBatch = {
	id: string;
	team_id: string;
	source_type: string;
	source_key: string;
	original_amount: number;
	remaining_amount: number;
	reserved_amount: number;
	expires_at: string | null;
	granted_at: string;
};

type CreditLedgerInput = {
	teamId: string;
	entryType: string;
	amount: number;
	taskId?: string | null;
	taskKind?: string | null;
	actorUserId?: string | null;
	note?: string | null;
	nowIso: string;
	apiKeyId?: string | null;
};

export type CreditGrantInput = CreditLedgerInput & {
	sourceType: string;
	sourceKey?: string;
	expiresAt?: string | null;
};

type ReservationInput = Omit<CreditLedgerInput, "entryType"> & {
	taskId: string;
	/**
	 * A stale physical worker may retry the exact same machine-owned effect after
	 * the first worker atomically reserved credits but disappeared before it
	 * returned the handle. Only those fenced recovery paths may adopt that still
	 * pending reservation. Interactive duplicate requests must leave this false.
	 */
	allowExistingReservation?: boolean;
};

export type CreditReservationAttempt =
	| { status: "reserved"; amount: number }
	| { status: "existing_reservation"; amount: number }
	| {
			status: "insufficient";
			credits: number;
			creditsFrozen: number;
			available: number;
	  }
	| {
			status: "idempotency_conflict";
			credits: number;
			creditsFrozen: number;
			available: number;
	  };

function positiveInteger(value: number, field: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${field} must be a positive safe integer`);
	}
	return value;
}

function requiredText(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${field} is required`);
	return normalized;
}

function nullableText(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized || null;
}

function validateIsoTimestamp(value: string, field: string): string {
	if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
	return value;
}

function batchToSpendable(batch: LockedCreditBatch): SpendableCreditBatch {
	return {
		id: batch.id,
		remainingAmount: batch.remaining_amount,
		reservedAmount: batch.reserved_amount,
		expiresAt: batch.expires_at,
		grantedAt: batch.granted_at,
	};
}

function summarizeCreditBatchBalance(batches: LockedCreditBatch[]): {
	credits: number;
	creditsFrozen: number;
	available: number;
} {
	const credits = batches.reduce((total, batch) => total + batch.remaining_amount, 0);
	const creditsFrozen = batches.reduce(
		(total, batch) => total + batch.reserved_amount,
		0,
	);
	return {
		credits,
		creditsFrozen,
		available: Math.max(0, credits - creditsFrozen),
	};
}

async function lockTeamAndBatches(
	tx: CreditTransaction,
	teamId: string,
): Promise<{ team: LockedTeam; batches: LockedCreditBatch[] }> {
	const teams = await tx.$queryRawUnsafe<LockedTeam[]>(
		`SELECT id, credits, credits_frozen FROM teams WHERE id = $1 FOR UPDATE`,
		teamId,
	);
	const team = teams[0];
	if (!team) throw new Error(`credit team not found: ${teamId}`);
	const batches = await tx.$queryRawUnsafe<LockedCreditBatch[]>(
		`SELECT id, team_id, source_type, source_key, original_amount,
		        remaining_amount, reserved_amount, expires_at, granted_at
		 FROM team_credit_batches
		 WHERE team_id = $1
		 ORDER BY expires_at ASC NULLS LAST, granted_at ASC, id ASC
		 FOR UPDATE`,
		teamId,
	);
	const remainingTotal = batches.reduce((total, batch) => total + batch.remaining_amount, 0);
	const reservedTotal = batches.reduce((total, batch) => total + batch.reserved_amount, 0);
	if (remainingTotal !== team.credits || reservedTotal !== team.credits_frozen) {
		throw new Error(
			`credit batch balance mismatch for ${teamId}: batches=${remainingTotal}/${reservedTotal}, team=${team.credits}/${team.credits_frozen}`,
		);
	}
	return { team, batches };
}

async function upsertAllocation(
	tx: CreditTransaction,
	input: {
		teamId: string;
		ledgerEntryId: string;
		batchId: string;
		priority: number;
		amount: number;
		expiredAmount?: number;
		nowIso: string;
	},
): Promise<void> {
	const expiredAmount = input.expiredAmount ?? 0;
	await tx.team_credit_allocations.upsert({
		where: {
			ledger_entry_id_batch_id: {
				ledger_entry_id: input.ledgerEntryId,
				batch_id: input.batchId,
			},
		},
		create: {
			id: crypto.randomUUID(),
			team_id: input.teamId,
			ledger_entry_id: input.ledgerEntryId,
			batch_id: input.batchId,
			priority: input.priority,
			amount: input.amount,
			expired_amount: expiredAmount,
			created_at: input.nowIso,
		},
		update: {
			amount: { increment: input.amount },
			expired_amount: { increment: expiredAmount },
		},
	});
}

async function recordMembershipExpiry(
	tx: CreditTransaction,
	batch: LockedCreditBatch,
	expiredAmount: number,
	nowIso: string,
): Promise<void> {
	if (batch.source_type !== "membership_daily") return;
	await tx.membership_credit_grants.updateMany({
		where: { id: batch.source_key },
		data: {
			...(expiredAmount > 0 ? { expired_amount: { increment: expiredAmount } } : {}),
			processed_at: nowIso,
		},
	});
}

async function expireUnlockedAmounts(
	tx: CreditTransaction,
	teamId: string,
	batches: LockedCreditBatch[],
	nowIso: string,
): Promise<number> {
	const now = Date.parse(validateIsoTimestamp(nowIso, "nowIso"));
	let totalExpired = 0;
	for (const [priority, batch] of batches.entries()) {
		if (!batch.expires_at) continue;
		const expiresAt = Date.parse(validateIsoTimestamp(batch.expires_at, "batch.expires_at"));
		if (expiresAt > now) continue;
		const expiredAmount = Math.max(0, batch.remaining_amount - batch.reserved_amount);
		if (expiredAmount > 0) {
			const ledger = await tx.team_credit_ledger.upsert({
				where: {
					team_id_entry_type_task_id: {
						team_id: teamId,
						entry_type: "expire",
						task_id: batch.id,
					},
				},
				create: {
					id: crypto.randomUUID(),
					team_id: teamId,
					entry_type: "expire",
					amount: expiredAmount,
					task_id: batch.id,
					task_kind: "credit_batch_expiry",
					actor_user_id: null,
					note: `source:${batch.source_type}:${batch.source_key}`,
					created_at: nowIso,
					api_key_id: null,
				},
				update: { amount: { increment: expiredAmount } },
			});
			await tx.team_credit_batches.update({
				where: { id: batch.id },
				data: { remaining_amount: { decrement: expiredAmount }, updated_at: nowIso },
			});
			await upsertAllocation(tx, {
				teamId,
				ledgerEntryId: ledger.id,
				batchId: batch.id,
				priority,
				amount: expiredAmount,
				expiredAmount,
				nowIso,
			});
			batch.remaining_amount -= expiredAmount;
			totalExpired += expiredAmount;
		}
		await recordMembershipExpiry(tx, batch, expiredAmount, nowIso);
	}
	if (totalExpired > 0) {
		await tx.teams.update({
			where: { id: teamId },
			data: { credits: { decrement: totalExpired }, updated_at: nowIso },
		});
	}
	return totalExpired;
}

async function createLedger(
	tx: CreditTransaction,
	input: CreditLedgerInput & { id?: string },
): Promise<{ id: string }> {
	const id = input.id ?? crypto.randomUUID();
	return tx.team_credit_ledger.create({
		data: {
			id,
			team_id: input.teamId,
			entry_type: input.entryType,
			amount: input.amount,
			task_id: nullableText(input.taskId),
			task_kind: nullableText(input.taskKind),
			actor_user_id: nullableText(input.actorUserId),
			note: nullableText(input.note),
			created_at: input.nowIso,
			api_key_id: nullableText(input.apiKeyId),
		},
		select: { id: true },
	});
}

async function findIdempotentLedger(
	tx: CreditTransaction,
	input: Pick<CreditLedgerInput, "teamId" | "entryType" | "taskId">,
): Promise<{
	id: string;
	amount: number;
	task_kind: string | null;
	actor_user_id: string | null;
} | null> {
	const taskId = nullableText(input.taskId);
	if (!taskId) return null;
	return tx.team_credit_ledger.findUnique({
		where: {
			team_id_entry_type_task_id: {
				team_id: input.teamId,
				entry_type: input.entryType,
				task_id: taskId,
			},
		},
		select: {
			id: true,
			amount: true,
			task_kind: true,
			actor_user_id: true,
		},
	});
}

export async function grantTeamCreditsInTransaction(
	tx: CreditTransaction,
	input: CreditGrantInput,
): Promise<{ granted: boolean; ledgerEntryId: string }> {
	const teamId = requiredText(input.teamId, "teamId");
	const amount = positiveInteger(input.amount, "amount");
	const sourceType = requiredText(input.sourceType, "sourceType");
	validateIsoTimestamp(input.nowIso, "nowIso");
	if (input.expiresAt) validateIsoTimestamp(input.expiresAt, "expiresAt");
	await lockTeamAndBatches(tx, teamId);
	const existing = await findIdempotentLedger(tx, input);
	if (existing) {
		const batch = await tx.team_credit_batches.findFirst({
			where: { team_id: teamId, source_type: sourceType, source_key: input.sourceKey ?? existing.id },
			select: { id: true },
		});
		if (!batch) throw new Error(`credit grant ledger ${existing.id} has no source batch`);
		return { granted: false, ledgerEntryId: existing.id };
	}
	const ledger = await createLedger(tx, { ...input, teamId, amount });
	const sourceKey = requiredText(input.sourceKey ?? ledger.id, "sourceKey");
	await tx.team_credit_batches.create({
		data: {
			id: crypto.randomUUID(),
			team_id: teamId,
			source_type: sourceType,
			source_key: sourceKey,
			original_amount: amount,
			remaining_amount: amount,
			reserved_amount: 0,
			expires_at: nullableText(input.expiresAt),
			granted_at: input.nowIso,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
	await tx.teams.update({
		where: { id: teamId },
		data: { credits: { increment: amount }, updated_at: input.nowIso },
	});
	return { granted: true, ledgerEntryId: ledger.id };
}

export async function grantTeamCredits(
	db: PrismaClient,
	input: CreditGrantInput,
): Promise<{ granted: boolean; ledgerEntryId: string }> {
	return db.$transaction((tx) => grantTeamCreditsInTransaction(tx, input));
}

async function persistReservation(
	tx: CreditTransaction,
	input: ReservationInput & { teamId: string; taskId: string },
	batches: LockedCreditBatch[],
	amount: number,
): Promise<void> {
	const allocations = planCreditBatchAllocations(batches.map(batchToSpendable), amount);
	if (!allocations) {
		throw new Error("credit reservation allocation invariant failed");
	}
	const ledger = await createLedger(tx, { ...input, amount, entryType: "reserve" });
	for (const allocation of allocations) {
		await tx.team_credit_batches.update({
			where: { id: allocation.batchId },
			data: { reserved_amount: { increment: allocation.amount }, updated_at: input.nowIso },
		});
		await upsertAllocation(tx, {
			teamId: input.teamId,
			ledgerEntryId: ledger.id,
			batchId: allocation.batchId,
			priority: allocation.priority,
			amount: allocation.amount,
			nowIso: input.nowIso,
		});
	}
	await tx.teams.update({
		where: { id: input.teamId },
		data: { credits_frozen: { increment: amount }, updated_at: input.nowIso },
	});
	return;
}

async function reserveInTransaction(
	tx: CreditTransaction,
	input: ReservationInput,
): Promise<boolean> {
	const teamId = requiredText(input.teamId, "teamId");
	const taskId = requiredText(input.taskId, "taskId");
	const amount = positiveInteger(input.amount, "amount");
	const { batches } = await lockTeamAndBatches(tx, teamId);
	await expireUnlockedAmounts(tx, teamId, batches, input.nowIso);
	const existing = await findIdempotentLedger(tx, { teamId, entryType: "reserve", taskId });
	if (existing) return false;
	const balance = summarizeCreditBatchBalance(batches);
	if (balance.available < amount) return false;
	await persistReservation(tx, { ...input, teamId, taskId }, batches, amount);
	return true;
}

export async function reserveTeamCreditBatches(
	db: PrismaClient,
	input: ReservationInput,
): Promise<boolean> {
	return db.$transaction((tx) => reserveInTransaction(tx, input));
}

export async function reserveTeamCreditBatchesUpToAvailable(
	db: PrismaClient,
	input: ReservationInput & { minimumAmount: number },
): Promise<CreditReservationAttempt> {
	return db.$transaction(async (tx) => {
		const teamId = requiredText(input.teamId, "teamId");
		const taskId = requiredText(input.taskId, "taskId");
		const targetAmount = positiveInteger(input.amount, "amount");
		const minimumAmount = positiveInteger(input.minimumAmount, "minimumAmount");
		if (minimumAmount > targetAmount) {
			throw new Error("minimumAmount must not exceed amount");
		}

		const { batches } = await lockTeamAndBatches(tx, teamId);
		await expireUnlockedAmounts(tx, teamId, batches, input.nowIso);
		const balance = summarizeCreditBatchBalance(batches);
		const existing = await findIdempotentLedger(tx, {
			teamId,
			entryType: "reserve",
			taskId,
		});
		if (existing) {
			const sameOwner = existing.actor_user_id === nullableText(input.actorUserId);
			const sameTaskKind = existing.task_kind === nullableText(input.taskKind);
			if (input.allowExistingReservation === true && sameOwner && sameTaskKind) {
				const pending = await pendingReservationAllocations(tx, { teamId, taskId });
				const pendingAmount = pending?.allocations.reduce(
					(total, allocation) => total + allocation.amount,
					0,
				) ?? 0;
				if (pendingAmount > 0) {
					return { status: "existing_reservation", amount: pendingAmount };
				}
			}
			return { status: "idempotency_conflict", ...balance };
		}
		if (balance.available < minimumAmount) {
			return { status: "insufficient", ...balance };
		}

		const amount = Math.min(targetAmount, balance.available);
		await persistReservation(tx, { ...input, teamId, taskId }, batches, amount);
		return { status: "reserved", amount };
	});
}

export async function chargeTeamCreditBatches(
	db: PrismaClient,
	input: CreditLedgerInput,
): Promise<{ charged: boolean; ledgerEntryId: string | null }> {
	return db.$transaction(async (tx) => chargeTeamCreditBatchesInTransaction(tx, input));
}

export async function chargeTeamCreditBatchesInTransaction(
	tx: CreditTransaction,
	input: CreditLedgerInput,
): Promise<{ charged: boolean; ledgerEntryId: string | null }> {
	const teamId = requiredText(input.teamId, "teamId");
	const amount = positiveInteger(input.amount, "amount");
	const { batches } = await lockTeamAndBatches(tx, teamId);
	await expireUnlockedAmounts(tx, teamId, batches, input.nowIso);
	const existing = await findIdempotentLedger(tx, input);
	if (existing) return { charged: false, ledgerEntryId: existing.id };
	const allocations = planCreditBatchAllocations(batches.map(batchToSpendable), amount);
	if (!allocations) return { charged: false, ledgerEntryId: null };
	const ledger = await createLedger(tx, { ...input, teamId, amount });
	for (const allocation of allocations) {
		await tx.team_credit_batches.update({
			where: { id: allocation.batchId },
			data: { remaining_amount: { decrement: allocation.amount }, updated_at: input.nowIso },
		});
		await upsertAllocation(tx, {
			teamId,
			ledgerEntryId: ledger.id,
			batchId: allocation.batchId,
			priority: allocation.priority,
			amount: allocation.amount,
			nowIso: input.nowIso,
		});
	}
	await tx.teams.update({
		where: { id: teamId },
		data: { credits: { decrement: amount }, updated_at: input.nowIso },
	});
	return { charged: true, ledgerEntryId: ledger.id };
}

async function pendingReservationAllocations(
	tx: CreditTransaction,
	input: { teamId: string; taskId: string },
): Promise<{
	reserveLedger: { id: string; amount: number };
	allocations: Array<{ batchId: string; amount: number; priority: number }>;
} | null> {
	const reserveLedger = await tx.team_credit_ledger.findUnique({
		where: {
			team_id_entry_type_task_id: {
				team_id: input.teamId,
				entry_type: "reserve",
				task_id: input.taskId,
			},
		},
		select: { id: true, amount: true },
	});
	if (!reserveLedger) return null;
	const reserveAllocations = await tx.team_credit_allocations.findMany({
		where: { ledger_entry_id: reserveLedger.id },
		orderBy: [{ priority: "asc" }, { id: "asc" }],
		select: { batch_id: true, amount: true, priority: true },
	});
	const settlementLedgers = await tx.team_credit_ledger.findMany({
		where: {
			team_id: input.teamId,
			task_id: input.taskId,
			entry_type: { in: ["deduct", "release"] },
		},
		select: { id: true },
	});
	const settled = settlementLedgers.length > 0
		? await tx.team_credit_allocations.groupBy({
			by: ["batch_id"],
			where: { ledger_entry_id: { in: settlementLedgers.map((ledger) => ledger.id) } },
			_sum: { amount: true },
		})
		: [];
	const settledByBatch = new Map(settled.map((row) => [row.batch_id, row._sum.amount ?? 0]));
	return {
		reserveLedger,
		allocations: reserveAllocations
			.map((allocation) => ({
				batchId: allocation.batch_id,
				amount: Math.max(0, allocation.amount - (settledByBatch.get(allocation.batch_id) ?? 0)),
				priority: allocation.priority,
			}))
			.filter((allocation) => allocation.amount > 0),
	};
}

async function settleReservationInTransaction(
	tx: CreditTransaction,
	input: ReservationInput & { entryType: "deduct" | "release" },
): Promise<boolean> {
	const teamId = requiredText(input.teamId, "teamId");
	const taskId = requiredText(input.taskId, "taskId");
	const amount = positiveInteger(input.amount, "amount");
	const { batches } = await lockTeamAndBatches(tx, teamId);
	await expireUnlockedAmounts(tx, teamId, batches, input.nowIso);
	const existing = await findIdempotentLedger(tx, { teamId, entryType: input.entryType, taskId });
	// A release may be written in more than one pass: older chat turns can
	// already have a partial release, while the remaining reservation still
	// needs to be returned.  The ledger keeps its unique task key, so extend
	// that existing release row and append the additional batch allocations.
	if (existing && input.entryType !== "release") return false;
	const reservation = await pendingReservationAllocations(tx, { teamId, taskId });
	if (!reservation) return false;
	const pendingTotal = reservation.allocations.reduce((total, allocation) => total + allocation.amount, 0);
	if (pendingTotal < amount) return false;
	const ledger = existing
		? await tx.team_credit_ledger.update({
				where: { id: existing.id },
				data: { amount: { increment: amount } },
			})
		: await createLedger(tx, { ...input, teamId, taskId, amount });
	const batchById = new Map(batches.map((batch) => [batch.id, batch]));
	let remaining = amount;
	let expiredOnRelease = 0;
	for (const allocation of reservation.allocations) {
		if (remaining === 0) break;
		const batch = batchById.get(allocation.batchId);
		if (!batch) throw new Error(`reserved credit batch missing: ${allocation.batchId}`);
		const applied = Math.min(remaining, allocation.amount);
		const isExpiredRelease = input.entryType === "release"
			&& batch.expires_at !== null
			&& Date.parse(validateIsoTimestamp(batch.expires_at, "batch.expires_at")) <= Date.parse(input.nowIso);
		const expiredAmount = isExpiredRelease ? applied : 0;
		await tx.team_credit_batches.update({
			where: { id: batch.id },
			data: {
				reserved_amount: { decrement: applied },
				...(input.entryType === "deduct" || expiredAmount > 0
					? { remaining_amount: { decrement: applied } }
					: {}),
				updated_at: input.nowIso,
			},
		});
		await upsertAllocation(tx, {
			teamId,
			ledgerEntryId: ledger.id,
			batchId: batch.id,
			priority: allocation.priority,
			amount: applied,
			expiredAmount,
			nowIso: input.nowIso,
		});
		if (expiredAmount > 0) await recordMembershipExpiry(tx, batch, expiredAmount, input.nowIso);
		expiredOnRelease += expiredAmount;
		remaining -= applied;
	}
	const creditsToRemove = input.entryType === "deduct" ? amount : expiredOnRelease;
	await tx.teams.update({
		where: { id: teamId },
		data: {
			...(creditsToRemove > 0 ? { credits: { decrement: creditsToRemove } } : {}),
			credits_frozen: { decrement: amount },
			updated_at: input.nowIso,
		},
	});
	return true;
}

export async function deductReservedTeamCreditBatches(
	db: PrismaClient,
	input: ReservationInput,
): Promise<boolean> {
	return db.$transaction((tx) => settleReservationInTransaction(tx, { ...input, entryType: "deduct" }));
}

export async function releaseReservedTeamCreditBatches(
	db: PrismaClient,
	input: ReservationInput,
): Promise<boolean> {
	return db.$transaction((tx) => settleReservationInTransaction(tx, { ...input, entryType: "release" }));
}

export async function increaseReservedTeamCreditBatches(
	db: PrismaClient,
	input: {
		teamId: string;
		taskId: string;
		expectedReserved: number;
		delta: number;
		nowIso: string;
	},
): Promise<boolean> {
	return db.$transaction(async (tx) => {
		const teamId = requiredText(input.teamId, "teamId");
		const taskId = requiredText(input.taskId, "taskId");
		const delta = positiveInteger(input.delta, "delta");
		const expectedReserved = positiveInteger(input.expectedReserved, "expectedReserved");
		const { batches } = await lockTeamAndBatches(tx, teamId);
		await expireUnlockedAmounts(tx, teamId, batches, input.nowIso);
		const reservation = await pendingReservationAllocations(tx, { teamId, taskId });
		if (!reservation || reservation.reserveLedger.amount !== expectedReserved) return false;
		const allocations = planCreditBatchAllocations(batches.map(batchToSpendable), delta);
		if (!allocations) return false;
		const priorityOffset = reservation.allocations.reduce(
			(maximum, allocation) => Math.max(maximum, allocation.priority + 1),
			0,
		);
		await tx.team_credit_ledger.update({
			where: { id: reservation.reserveLedger.id },
			data: { amount: { increment: delta } },
		});
		for (const allocation of allocations) {
			await tx.team_credit_batches.update({
				where: { id: allocation.batchId },
				data: { reserved_amount: { increment: allocation.amount }, updated_at: input.nowIso },
			});
			await upsertAllocation(tx, {
				teamId,
				ledgerEntryId: reservation.reserveLedger.id,
				batchId: allocation.batchId,
				priority: priorityOffset + allocation.priority,
				amount: allocation.amount,
				nowIso: input.nowIso,
			});
		}
		await tx.teams.update({
			where: { id: teamId },
			data: { credits_frozen: { increment: delta }, updated_at: input.nowIso },
		});
		return true;
	});
}

export async function expireTeamCreditBatches(
	db: PrismaClient,
	input: { teamId: string; nowIso: string },
): Promise<number> {
	return db.$transaction(async (tx) => {
		const teamId = requiredText(input.teamId, "teamId");
		const { batches } = await lockTeamAndBatches(tx, teamId);
		return expireUnlockedAmounts(tx, teamId, batches, input.nowIso);
	});
}
