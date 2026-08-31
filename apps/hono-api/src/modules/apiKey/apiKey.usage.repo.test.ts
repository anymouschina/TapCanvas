import { describe, it, expect, vi, beforeEach } from "vitest";

describe("apiKey usage repo", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doUnmock("../../platform/node/prisma");
	});

	it("listRequestLogsByApiKey 按 api_key_id + 时间倒序分页", async () => {
		const findMany = vi.fn(async () => [
			{
				id: "r1",
				path: "/public/a2a",
				method: "POST",
				status: 200,
				duration_ms: 120,
				started_at: "2026-06-17T00:00:00Z",
			},
		]);
		vi.doMock("../../platform/node/prisma", () => ({
			getPrismaClient: () => ({ api_request_logs: { findMany } }),
		}));
		const { listRequestLogsByApiKey } = await import("./apiKey.usage.repo");
		const rows = await listRequestLogsByApiKey("key-1", { limit: 20 });
		expect(rows[0].path).toBe("/public/a2a");
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { api_key_id: "key-1" } }),
		);
	});

	it("listRequestLogsByApiKey before+since+until 落到 started_at 范围过滤", async () => {
		const findMany = vi.fn(async () => []);
		vi.doMock("../../platform/node/prisma", () => ({
			getPrismaClient: () => ({ api_request_logs: { findMany } }),
		}));
		const { listRequestLogsByApiKey } = await import("./apiKey.usage.repo");
		await listRequestLogsByApiKey("key-1", {
			limit: 20,
			before: "2026-06-20T00:00:00Z",
			since: "2026-06-01T00:00:00Z",
			until: "2026-06-30T00:00:00Z",
		});
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					api_key_id: "key-1",
					started_at: {
						gte: "2026-06-01T00:00:00Z",
						lte: "2026-06-30T00:00:00Z",
						lt: "2026-06-20T00:00:00Z",
					},
				},
			}),
		);
	});

	it("listCreditLedgerByApiKey before 游标落到两表的 created_at 过滤", async () => {
		const pFind = vi.fn(async () => []);
		const tFind = vi.fn(async () => []);
		vi.doMock("../../platform/node/prisma", () => ({
			getPrismaClient: () => ({
				points_ledger: { findMany: pFind },
				team_credit_ledger: { findMany: tFind },
			}),
		}));
		const { listCreditLedgerByApiKey } = await import("./apiKey.usage.repo");
		await listCreditLedgerByApiKey("key-1", { limit: 20, before: "2026-06-20T00:00:00Z" });
		expect(pFind).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { api_key_id: "key-1", change_amount: { lt: 0 }, created_at: { lt: "2026-06-20T00:00:00Z" } },
			}),
		);
		expect(tFind).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { api_key_id: "key-1", entry_type: "deduct", created_at: { lt: "2026-06-20T00:00:00Z" } },
			}),
		);
	});

	it("sumCreditsByApiKey 聚合个人+团队消耗", async () => {
		const pAgg = vi.fn(async () => ({ _sum: { change_amount: -30 } }));
		const tAgg = vi.fn(async () => ({ _sum: { amount: 12 } }));
		vi.doMock("../../platform/node/prisma", () => ({
			getPrismaClient: () => ({
				points_ledger: { aggregate: pAgg },
				team_credit_ledger: { aggregate: tAgg },
			}),
		}));
		const { sumCreditsByApiKey } = await import("./apiKey.usage.repo");
		const out = await sumCreditsByApiKey("key-1");
		expect(out.personalSpent).toBe(30);
		expect(out.teamSpent).toBe(12);
	});
});
