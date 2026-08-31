import { beforeEach, describe, expect, it, vi } from "vitest";

type LedgerRow = {
	entry_type: string;
	amount: number;
	task_id: string | null;
	actor_user_id: string | null;
};

type TaskResultRow = {
	user_id: string;
	task_id: string;
	vendor: string;
	kind: string;
	status: string;
	result: string;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
};

type TaskStatusRow = {
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

type VendorCallRow = {
	row_id: number | null;
	user_id: string;
	user_login: string | null;
	user_name: string | null;
	vendor: string;
	task_id: string;
	task_kind: string | null;
	status: string;
	started_at: string | null;
	finished_at: string | null;
	duration_ms: number | null;
	error_message: string | null;
	request_json: string | null;
	response_json: string | null;
	created_at: string;
	updated_at: string;
};

const ledger: LedgerRow[] = [];
let taskResult: TaskResultRow | null = null;
const statuses: TaskStatusRow[] = [];
const vendorCalls: VendorCallRow[] = [];

function matchLedger(row: LedgerRow, where: any): boolean {
	if (where.actor_user_id && row.actor_user_id !== where.actor_user_id) return false;
	if (where.task_id && row.task_id !== where.task_id) return false;
	return true;
}

const prisma = {
	task_results: {
		findUnique: vi.fn(async ({ where }: any) => {
			const wantU = where.user_id_task_id?.user_id;
			const wantT = where.user_id_task_id?.task_id;
			if (taskResult && taskResult.user_id === wantU && taskResult.task_id === wantT) {
				return taskResult;
			}
			return null;
		}),
	},
	team_credit_ledger: {
		findMany: vi.fn(async ({ where }: any) => {
			return ledger.filter((r) => matchLedger(r, where));
		}),
	},
	task_statuses: {
		findMany: vi.fn(async ({ where, orderBy }: any) => {
			let rows = statuses.filter((s) => {
				if (where.task_id && s.task_id !== where.task_id) return false;
				if (where.user_id && s.user_id !== where.user_id) return false;
				return true;
			});
			if (orderBy?.created_at === "asc") {
				rows = [...rows].sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
			}
			return rows;
		}),
	},
	vendor_api_call_logs: {
		findMany: vi.fn(async ({ where, take }: any) => {
			let rows = vendorCalls.filter((c) => {
				if (where.user_id && c.user_id !== where.user_id) return false;
				if (where.task_id && c.task_id !== where.task_id) return false;
				return true;
			});
			if (typeof take === "number") rows = rows.slice(0, take);
			return rows;
		}),
	},
};

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));

import { fetchTaskLogBundle } from "./user-admin.task-log.repo";

function resetAll() {
	ledger.length = 0;
	statuses.length = 0;
	vendorCalls.length = 0;
	taskResult = null;
}

describe("fetchTaskLogBundle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAll();
	});

	it("aggregates credits per task across reserve/deduct/release", async () => {
		ledger.push(
			{ entry_type: "reserve", amount: 50, task_id: "tx", actor_user_id: "U1" },
			{ entry_type: "deduct", amount: 30, task_id: "tx", actor_user_id: "U1" },
			{ entry_type: "release", amount: 5, task_id: "tx", actor_user_id: "U1" },
		);
		const bundle = await fetchTaskLogBundle("U1", "tx");
		expect(bundle.credits).toEqual({ reserved: 50, deducted: 30, released: 5, pending: 15 });
	});

	it("returns null result + empty arrays + zero credits when nothing recorded", async () => {
		const bundle = await fetchTaskLogBundle("U1", "nope");
		expect(bundle.result).toBeNull();
		expect(bundle.statuses).toEqual([]);
		expect(bundle.vendorCalls).toEqual([]);
		expect(bundle.credits).toEqual({ reserved: 0, deducted: 0, released: 0, pending: 0 });
	});

	it("parses task_results.result JSON and orders statuses ascending by created_at", async () => {
		taskResult = {
			user_id: "U1",
			task_id: "tx",
			vendor: "newapi",
			kind: "text_to_image",
			status: "succeeded",
			result: JSON.stringify({ status: "succeeded", urls: ["a"] }),
			created_at: "2026-05-04T00:00:00.000Z",
			updated_at: "2026-05-04T01:00:00.000Z",
			completed_at: "2026-05-04T01:00:00.000Z",
		};
		statuses.push(
			{ id: "s2", task_id: "tx", provider: "p1", user_id: "U1", status: "succeeded", data: null, created_at: "2026-05-04T02:00:00.000Z", updated_at: "2026-05-04T02:00:00.000Z", completed_at: "2026-05-04T02:00:00.000Z" },
			{ id: "s1", task_id: "tx", provider: "p1", user_id: "U1", status: "running", data: null, created_at: "2026-05-04T01:00:00.000Z", updated_at: "2026-05-04T01:00:00.000Z", completed_at: null },
		);
		const bundle = await fetchTaskLogBundle("U1", "tx");
		expect(bundle.result?.vendor).toBe("newapi");
		expect((bundle.result?.raw as any).urls).toEqual(["a"]);
		expect(bundle.statuses.map((s) => s.id)).toEqual(["s1", "s2"]);
	});

	it("parses request/response JSON for vendor calls", async () => {
		vendorCalls.push({
			row_id: 1,
			user_id: "U1",
			user_login: null,
			user_name: null,
			vendor: "newapi",
			task_id: "tx",
			task_kind: "text_to_image",
			status: "succeeded",
			started_at: "2026-05-04T01:00:00.000Z",
			finished_at: "2026-05-04T01:00:01.000Z",
			duration_ms: 1000,
			error_message: null,
			request_json: JSON.stringify({ prompt: "hi" }),
			response_json: JSON.stringify({ ok: true }),
			created_at: "2026-05-04T01:00:01.000Z",
			updated_at: "2026-05-04T01:00:01.000Z",
		});
		const bundle = await fetchTaskLogBundle("U1", "tx");
		expect(bundle.vendorCalls).toHaveLength(1);
		expect((bundle.vendorCalls[0]?.requestJson as any).prompt).toBe("hi");
		expect((bundle.vendorCalls[0]?.responseJson as any).ok).toBe(true);
	});

	it("returns empty bundle when userId or taskId is empty", async () => {
		const bundle = await fetchTaskLogBundle("", "tx");
		expect(bundle.result).toBeNull();
		expect(bundle.credits.reserved).toBe(0);
		expect(bundle.statuses).toEqual([]);
		expect(bundle.vendorCalls).toEqual([]);
	});
});
