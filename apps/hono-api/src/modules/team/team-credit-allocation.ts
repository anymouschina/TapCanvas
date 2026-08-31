export type SpendableCreditBatch = {
	id: string;
	remainingAmount: number;
	reservedAmount: number;
	expiresAt: string | null;
	grantedAt: string;
};

export type PlannedCreditAllocation = {
	batchId: string;
	amount: number;
	priority: number;
};

function compareExpiry(left: string | null, right: string | null): number {
	if (left === right) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	return left.localeCompare(right);
}

export function compareCreditBatchSpendOrder(
	left: SpendableCreditBatch,
	right: SpendableCreditBatch,
): number {
	return compareExpiry(left.expiresAt, right.expiresAt)
		|| left.grantedAt.localeCompare(right.grantedAt)
		|| left.id.localeCompare(right.id);
}

export function planCreditBatchAllocations(
	batches: readonly SpendableCreditBatch[],
	requestedAmount: number,
): PlannedCreditAllocation[] | null {
	if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) return null;
	let remaining = requestedAmount;
	const allocations: PlannedCreditAllocation[] = [];
	const ordered = [...batches].sort(compareCreditBatchSpendOrder);

	for (const [priority, batch] of ordered.entries()) {
		const available = Math.max(0, batch.remainingAmount - batch.reservedAmount);
		if (available === 0) continue;
		const amount = Math.min(remaining, available);
		allocations.push({ batchId: batch.id, amount, priority });
		remaining -= amount;
		if (remaining === 0) return allocations;
	}

	return null;
}
