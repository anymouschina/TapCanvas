import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { encodeWorkflowOutput, WORKFLOW_OUTPUT_STORAGE_VERSION } from "./execution.output-storage";
import { persistWorkflowOutput } from "./execution.output-storage-store";

describe("workflow output delta persistence", () => {
	it("locks the row and sends no previously committed body again", async () => {
		const body = "已提交正文".repeat(1_000);
		const output = encodeWorkflowOutput({ body, status: "running" });
		const query = vi.fn(async (_query: Prisma.Sql): Promise<unknown> => [])
			.mockResolvedValueOnce([{ storage_version: WORKFLOW_OUTPUT_STORAGE_VERSION, block_ids: Object.keys(output.blocks) }])
			.mockResolvedValueOnce([{ output_bytes: 20_000 }]);
		const transaction = { $queryRaw: query } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
		const metrics = await persistWorkflowOutput(transaction, "row-1", output);
		expect(query.mock.calls[0]![0].sql).toContain("FOR UPDATE");
		expect(query.mock.calls[1]![0].sql).toContain("jsonb_object_agg");
		expect(query.mock.calls[1]![0].sql).toContain("WHERE key IN");
		expect(JSON.stringify(query.mock.calls[1]![0].values)).not.toContain(body);
		expect(metrics).toMatchObject({ newBlocks: 0, reusedBlocks: Object.keys(output.blocks).length, outputBytes: 20_000 });
	});

	it.each([
		{ rows: [], reason: "target row is missing" },
		{ rows: [{ storage_version: "unknown", block_ids: [] }], reason: "Unsupported" },
	])("rejects invalid persisted targets before updating: $reason", async ({ rows, reason }) => {
		const query = vi.fn().mockResolvedValueOnce(rows);
		const transaction = { $queryRaw: query } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
		await expect(persistWorkflowOutput(transaction, "row-1", encodeWorkflowOutput({}))).rejects.toThrow(reason);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("does not acknowledge a checkpoint unless exactly one row was updated", async () => {
		const query = vi.fn().mockResolvedValueOnce([{ storage_version: null, block_ids: [] }]).mockResolvedValueOnce([]);
		const transaction = { $queryRaw: query } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
		await expect(persistWorkflowOutput(transaction, "row-1", encodeWorkflowOutput({}))).rejects.toThrow("target row changed");
	});
});
