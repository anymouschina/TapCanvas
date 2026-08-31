import { beforeEach, describe, expect, it, vi } from "vitest";

type LedgerRow = {
	id: string;
	team_id: string;
	entry_type: string;
	amount: number;
	task_id: string | null;
	task_kind: string | null;
	actor_user_id: string | null;
	note: string | null;
	created_at: string;
};

let store: LedgerRow[] = [];

function reset(rows: LedgerRow[]) {
	store = rows.slice();
}

function matchesWhere(row: LedgerRow, where: any): boolean {
	if (!where) return true;
	for (const [k, v] of Object.entries(where)) {
		if (k === "AND" && Array.isArray(v)) {
			if (!v.every((sub) => matchesWhere(row, sub))) return false;
			continue;
		}
		if (k === "OR" && Array.isArray(v)) {
			if (!v.some((sub) => matchesWhere(row, sub))) return false;
			continue;
		}
		const cell = (row as any)[k];
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const op = v as Record<string, unknown>;
			if ("in" in op && Array.isArray(op.in)) {
				if (!(op.in as unknown[]).includes(cell)) return false;
				continue;
			}
			if ("not" in op) {
				if (op.not === null) {
					if (cell === null || cell === undefined) return false;
				} else if (cell === op.not) return false;
				continue;
			}
			if ("contains" in op) {
				if (typeof cell !== "string") return false;
				if (!cell.includes(String(op.contains))) return false;
				continue;
			}
			if ("gte" in op) {
				if (!(cell >= (op.gte as any))) return false;
			}
			if ("lte" in op) {
				if (!(cell <= (op.lte as any))) return false;
			}
			if ("lt" in op) {
				if (!(cell < (op.lt as any))) return false;
			}
			if ("gt" in op) {
				if (!(cell > (op.gt as any))) return false;
			}
			continue;
		}
		if (cell !== v) return false;
	}
	return true;
}

const prisma = {
	team_credit_ledger: {
		aggregate: vi.fn(async ({ where, _sum, _count }: any) => {
			const filtered = store.filter((r) => matchesWhere(r, where));
			const out: any = {};
			if (_sum?.amount) out._sum = { amount: filtered.reduce((s, r) => s + r.amount, 0) };
			if (_count) out._count = { _all: filtered.length };
			return out;
		}),
		findMany: vi.fn(async ({ where, orderBy, take, select }: any) => {
			let rows = store.filter((r) => matchesWhere(r, where));
			if (Array.isArray(orderBy)) {
				rows = [...rows].sort((a, b) => {
					for (const ob of orderBy) {
						for (const [field, dir] of Object.entries(ob as Record<string, "asc" | "desc">)) {
							const av = (a as any)[field];
							const bv = (b as any)[field];
							if (av === bv) continue;
							const cmp = av > bv ? 1 : -1;
							return dir === "desc" ? -cmp : cmp;
						}
					}
					return 0;
				});
			}
			if (typeof take === "number") rows = rows.slice(0, take);
			if (select) {
				return rows.map((r) => {
					const out: any = {};
					for (const k of Object.keys(select)) out[k] = (r as any)[k];
					return out;
				});
			}
			return rows;
		}),
		findFirst: vi.fn(async ({ where, orderBy, select }: any) => {
			let rows = store.filter((r) => matchesWhere(r, where));
			if (orderBy) {
				const obList = Array.isArray(orderBy) ? orderBy : [orderBy];
				rows = [...rows].sort((a, b) => {
					for (const ob of obList) {
						for (const [field, dir] of Object.entries(ob as Record<string, "asc" | "desc">)) {
							const av = (a as any)[field];
							const bv = (b as any)[field];
							if (av === bv) continue;
							const cmp = av > bv ? 1 : -1;
							return dir === "desc" ? -cmp : cmp;
						}
					}
					return 0;
				});
			}
			const first = rows[0];
			if (!first) return null;
			if (select) {
				const out: any = {};
				for (const k of Object.keys(select)) out[k] = (first as any)[k];
				return out;
			}
			return first;
		}),
		groupBy: vi.fn(async ({ by, where, _sum, _count }: any) => {
			const filtered = store.filter((r) => matchesWhere(r, where));
			const buckets = new Map<string, LedgerRow[]>();
			const field = by[0] as keyof LedgerRow;
			for (const r of filtered) {
				const key = String(r[field] ?? "");
				const arr = buckets.get(key) ?? [];
				arr.push(r);
				buckets.set(key, arr);
			}
			const result: any[] = [];
			for (const [, rows] of buckets) {
				const item: any = { [field]: rows[0]?.[field] ?? null };
				if (_sum?.amount) item._sum = { amount: rows.reduce((s, r) => s + r.amount, 0) };
				if (_count) item._count = { _all: rows.length };
				result.push(item);
			}
			return result;
		}),
	},
};

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));

import {
	fetchUserCreditsOverview,
	listUserCreditsLedger,
} from "./user-admin.credits.repo";

function row(partial: Partial<LedgerRow>): LedgerRow {
	return {
		id: "id-" + Math.random().toString(36).slice(2, 10),
		team_id: "T",
		entry_type: "deduct",
		amount: 0,
		task_id: null,
		task_kind: null,
		actor_user_id: "U1",
		note: null,
		created_at: "2026-05-04T00:00:00.000Z",
		...partial,
	};
}

describe("fetchUserCreditsOverview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		reset([]);
	});

	it("aggregates deductTotal/countTotal/byTaskKind for the actor only", async () => {
		reset([
			row({ id: "1", entry_type: "deduct", amount: 10, task_id: "ta", task_kind: "image", created_at: "2026-05-04T01:00:00.000Z" }),
			row({ id: "2", entry_type: "deduct", amount: 20, task_id: "tb", task_kind: "image", created_at: "2026-05-04T02:00:00.000Z" }),
			row({ id: "3", entry_type: "deduct", amount: 5, task_id: "tc", task_kind: "video", created_at: "2026-05-04T03:00:00.000Z" }),
			row({ id: "4", entry_type: "deduct", amount: 99, task_id: "td", task_kind: "image", actor_user_id: "U2", created_at: "2026-05-04T04:00:00.000Z" }),
		]);
		const ov = await fetchUserCreditsOverview("U1", { now: new Date("2026-05-04T05:00:00.000Z") });
		expect(ov.totals.deductTotal).toBe(35);
		expect(ov.totals.countTotal).toBe(3);
		const byKind = Object.fromEntries(ov.byTaskKind.map((r) => [r.taskKind, r]));
		expect(byKind.image.amount).toBe(30);
		expect(byKind.image.count).toBe(2);
		expect(byKind.video.amount).toBe(5);
	});

	it("computes frozenNow as reserve - deduct - release per task, clamped to >=0", async () => {
		reset([
			row({ id: "r1", entry_type: "reserve", amount: 50, task_id: "ta", created_at: "2026-05-04T01:00:00.000Z" }),
			row({ id: "d1", entry_type: "deduct", amount: 30, task_id: "ta", created_at: "2026-05-04T02:00:00.000Z" }),
			row({ id: "r2", entry_type: "reserve", amount: 80, task_id: "tb", created_at: "2026-05-04T03:00:00.000Z" }),
		]);
		const ov = await fetchUserCreditsOverview("U1", { now: new Date("2026-05-04T05:00:00.000Z") });
		expect(ov.totals.frozenNow).toBe(20 + 80);
	});

	it("computes deductMonth and deductToday based on provided now", async () => {
		reset([
			row({ id: "old", entry_type: "deduct", amount: 100, task_id: "x", created_at: "2026-04-30T23:59:59.000Z" }),
			row({ id: "monthEarly", entry_type: "deduct", amount: 50, task_id: "y", created_at: "2026-05-01T00:00:00.000Z" }),
			row({ id: "today", entry_type: "deduct", amount: 7, task_id: "z", created_at: "2026-05-04T03:00:00.000Z" }),
		]);
		const ov = await fetchUserCreditsOverview("U1", { now: new Date("2026-05-04T05:00:00.000Z") });
		// month total in May 2026: 50 + 7 = 57
		expect(ov.totals.deductMonth).toBe(57);
		// today (2026-05-04) total: 7
		expect(ov.totals.deductToday).toBe(7);
		// overall: 100 + 50 + 7 = 157
		expect(ov.totals.deductTotal).toBe(157);
	});

	it("returns zeroed overview for an empty userId", async () => {
		const ov = await fetchUserCreditsOverview("", {});
		expect(ov.totals.deductTotal).toBe(0);
		expect(ov.byTaskKind).toEqual([]);
	});
});

describe("listUserCreditsLedger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		reset([]);
	});

	it("orders by (created_at desc, id desc) and provides nextCursor when more rows remain", async () => {
		reset([
			row({ id: "a", entry_type: "deduct", amount: 1, task_id: "t1", created_at: "2026-05-04T01:00:00.000Z" }),
			row({ id: "b", entry_type: "deduct", amount: 2, task_id: "t2", created_at: "2026-05-04T02:00:00.000Z" }),
			row({ id: "c", entry_type: "deduct", amount: 3, task_id: "t3", created_at: "2026-05-04T03:00:00.000Z" }),
		]);
		const page1 = await listUserCreditsLedger("U1", { limit: 2 });
		expect(page1.items.map((r) => r.id)).toEqual(["c", "b"]);
		expect(page1.nextCursor).not.toBeNull();
		const page2 = await listUserCreditsLedger("U1", {
			limit: 2,
			cursor: page1.nextCursor!.id,
			cursorAt: page1.nextCursor!.createdAt,
		});
		expect(page2.items.map((r) => r.id)).toEqual(["a"]);
		expect(page2.nextCursor).toBeNull();
	});

	it("filters by entryTypes / taskIdLike / since-until", async () => {
		reset([
			row({ id: "a", entry_type: "deduct", amount: 1, task_id: "img-1", created_at: "2026-05-01T00:00:00.000Z" }),
			row({ id: "b", entry_type: "topup", amount: 9, task_id: null, created_at: "2026-05-02T00:00:00.000Z" }),
			row({ id: "c", entry_type: "deduct", amount: 4, task_id: "vid-1", created_at: "2026-05-03T00:00:00.000Z" }),
		]);
		const onlyDeduct = await listUserCreditsLedger("U1", { entryTypes: ["deduct"] });
		expect(onlyDeduct.items.map((r) => r.id)).toEqual(["c", "a"]);

		const onlyImg = await listUserCreditsLedger("U1", { taskIdLike: "img" });
		expect(onlyImg.items.map((r) => r.id)).toEqual(["a"]);

		const inRange = await listUserCreditsLedger("U1", {
			since: "2026-05-02T00:00:00.000Z",
			until: "2026-05-02T23:59:59.000Z",
		});
		expect(inRange.items.map((r) => r.id)).toEqual(["b"]);
	});

	it("returns empty when userId is empty", async () => {
		const result = await listUserCreditsLedger("", {});
		expect(result).toEqual({ items: [], nextCursor: null });
	});
});
