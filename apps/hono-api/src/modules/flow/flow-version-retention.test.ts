import { beforeEach, describe, expect, it, vi } from "vitest";

const queryCandidates = vi.fn();
const deleteVersions = vi.fn();

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		$queryRaw: queryCandidates,
		flow_versions: { deleteMany: deleteVersions },
	}),
}));

import {
	startFlowVersionRetentionScheduler,
	sweepExpiredFlowVersions,
} from "./flow-version-retention";

beforeEach(() => {
	vi.clearAllMocks();
	queryCandidates.mockResolvedValue([]);
	deleteVersions.mockResolvedValue({ count: 0 });
});

describe("flow version retention", () => {
	it("keeps the newest version of every flow and every execution-referenced version", async () => {
		queryCandidates.mockResolvedValue([
			{ id: "old-1" },
			{ id: "old-2" },
			{ id: "old-3" },
		]);
		deleteVersions
			.mockResolvedValueOnce({ count: 2 })
			.mockResolvedValueOnce({ count: 1 });

		const result = await sweepExpiredFlowVersions({
			now: new Date("2026-08-14T12:00:00.000Z"),
			batchSize: 2,
			pauseBetweenBatchesMs: 0,
		});

		const candidateQuery = queryCandidates.mock.calls[0]?.[0] as { sql?: string; values?: unknown[] } | undefined;
		expect(candidateQuery?.sql).toContain("PARTITION BY fv.flow_id");
		expect(candidateQuery?.sql).toContain("ranked_versions.version_rank > 1");
		expect(candidateQuery?.sql).toContain("workflow_executions execution");
		expect(candidateQuery?.values).toContain("2026-08-07T12:00:00.000Z");
		expect(deleteVersions).toHaveBeenNthCalledWith(1, {
			where: {
				id: { in: ["old-1", "old-2"] },
				workflow_executions: { none: {} },
			},
		});
		expect(deleteVersions).toHaveBeenNthCalledWith(2, {
			where: {
				id: { in: ["old-3"] },
				workflow_executions: { none: {} },
			},
		});
		expect(result).toMatchObject({
			cutoffIso: "2026-08-07T12:00:00.000Z",
			candidateVersions: 3,
			deletedVersions: 3,
			batches: 2,
		});
	});

	it("does not issue a delete when every version is protected", async () => {
		const result = await sweepExpiredFlowVersions({
			now: new Date("2026-08-14T12:00:00.000Z"),
			pauseBetweenBatchesMs: 0,
		});

		expect(deleteVersions).not.toHaveBeenCalled();
		expect(result.deletedVersions).toBe(0);
		expect(result.batches).toBe(0);
	});

	it("runs once after startup and then once per day", async () => {
		vi.useFakeTimers();
		vi.stubEnv("NODE_ENV", "development");
		const stop = startFlowVersionRetentionScheduler();
		try {
			await vi.advanceTimersByTimeAsync(60 * 1000);
			expect(queryCandidates).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
			expect(queryCandidates).toHaveBeenCalledTimes(2);

			stop();
			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
			expect(queryCandidates).toHaveBeenCalledTimes(2);
		} finally {
			stop();
			vi.unstubAllEnvs();
			vi.useRealTimers();
		}
	});
});
