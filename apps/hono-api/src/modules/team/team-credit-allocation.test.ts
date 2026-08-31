import { describe, expect, it } from "vitest";
import { planCreditBatchAllocations, type SpendableCreditBatch } from "./team-credit-allocation";

function batch(input: Partial<SpendableCreditBatch> & Pick<SpendableCreditBatch, "id">): SpendableCreditBatch {
	return {
		id: input.id,
		remainingAmount: input.remainingAmount ?? 100,
		reservedAmount: input.reservedAmount ?? 0,
		expiresAt: input.expiresAt ?? null,
		grantedAt: input.grantedAt ?? "2026-01-01T00:00:00.000Z",
	};
}

describe("planCreditBatchAllocations", () => {
	it("consumes the earliest temporary credits before permanent credits", () => {
		const result = planCreditBatchAllocations([
			batch({ id: "permanent" }),
			batch({ id: "later", expiresAt: "2026-08-02T00:00:00.000Z" }),
			batch({ id: "earlier", expiresAt: "2026-08-01T00:00:00.000Z" }),
		], 250);

		expect(result).toEqual([
			{ batchId: "earlier", amount: 100, priority: 0 },
			{ batchId: "later", amount: 100, priority: 1 },
			{ batchId: "permanent", amount: 50, priority: 2 },
		]);
	});

	it("uses grant time and id as deterministic ties and excludes reserved amounts", () => {
		const result = planCreditBatchAllocations([
			batch({ id: "b", expiresAt: "2026-08-01T00:00:00.000Z", grantedAt: "2026-07-02T00:00:00.000Z" }),
			batch({ id: "a", expiresAt: "2026-08-01T00:00:00.000Z", grantedAt: "2026-07-01T00:00:00.000Z", reservedAmount: 60 }),
		], 100);

		expect(result).toEqual([
			{ batchId: "a", amount: 40, priority: 0 },
			{ batchId: "b", amount: 60, priority: 1 },
		]);
	});

	it("returns null instead of partially allocating an insufficient balance", () => {
		expect(planCreditBatchAllocations([batch({ id: "only", remainingAmount: 10 })], 11)).toBeNull();
	});
});
