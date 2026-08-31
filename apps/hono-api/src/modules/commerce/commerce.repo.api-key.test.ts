import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = {
	points_accounts: {
		upsert: vi.fn(async () => ({ balance: 100 })),
		findUnique: vi.fn(async () => ({ balance: 100 })),
		update: vi.fn(async () => ({})),
	},
	points_ledger: {
		create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
			created.push(data);
			return data;
		}),
	},
};
const created: Record<string, unknown>[] = [];

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		$transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
	}),
}));

describe("updatePointsAccountAndInsertLedger api_key_id", () => {
	beforeEach(() => {
		created.length = 0;
	});

	it("把 apiKeyId 写进 points_ledger", async () => {
		const { updatePointsAccountAndInsertLedger } = await import("./commerce.repo");
		await updatePointsAccountAndInsertLedger({} as never, {
			ownerId: "u1",
			changeAmount: -5,
			sourceType: "agents_chat",
			sourceId: "task-1",
			note: null,
			idempotencyKey: "idem-1",
			nowIso: "2026-06-17T00:00:00Z",
			apiKeyId: "key-1",
		});
		expect(created[0].api_key_id).toBe("key-1");
	});

	it("apiKeyId 缺省时写入 null", async () => {
		const { updatePointsAccountAndInsertLedger } = await import("./commerce.repo");
		await updatePointsAccountAndInsertLedger({} as never, {
			ownerId: "u1",
			changeAmount: -5,
			sourceType: "agents_chat",
			sourceId: "task-1",
			note: null,
			idempotencyKey: "idem-2",
			nowIso: "2026-06-17T00:00:00Z",
		});
		expect(created[0].api_key_id).toBe(null);
	});
});
