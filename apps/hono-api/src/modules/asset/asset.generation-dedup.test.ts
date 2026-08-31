import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";

const findFirst = vi.hoisted(() => vi.fn());

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({ assets: { findFirst } }),
}));

import { findGeneratedAssetBySourceUrl } from "./asset.repo";

beforeEach(() => {
	vi.clearAllMocks();
	findFirst.mockResolvedValue(null);
});

describe("generation asset dedup scope", () => {
	it("scopes reuse to the same owner, project, task, and provider source", async () => {
		await findGeneratedAssetBySourceUrl(
			{} as PrismaClient,
			"user-1",
			{
				sourceUrl: "https://provider.example.com/output.png",
				projectId: "project-1",
				taskId: "task-1",
			},
		);

		expect(findFirst).toHaveBeenCalledWith({
			where: {
				owner_id: "user-1",
				project_id: "project-1",
				data: { contains: '"kind":"generation"' },
				AND: [
					{ data: { contains: '"sourceUrl":"https://provider.example.com/output.png"' } },
					{ data: { contains: '"taskId":"task-1"' } },
				],
			},
			orderBy: { created_at: "desc" },
		});
	});

	it("keeps an explicitly projectless generation in the projectless scope", async () => {
		await findGeneratedAssetBySourceUrl(
			{} as PrismaClient,
			"user-1",
			{
				sourceUrl: "https://provider.example.com/output.png",
				projectId: null,
			},
		);

		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ project_id: null }),
		}));
	});
});
