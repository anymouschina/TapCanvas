import { describe, it, expect, vi } from "vitest";

const mockUpsert = vi.fn(async () => ({
	id: "task-1",
	type: "image",
	cdn_url: "https://cdn/img.webp",
	task_id: "task-1",
	node_id: "agent-node-1",
	user_id: "user-1",
	created_at: "2026-05-24T00:00:00Z",
}));
const mockFindUnique = vi.fn(async () => null);

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		asset_uris: {
			upsert: mockUpsert,
			findUnique: mockFindUnique,
		},
	}),
}));

import { upsertAssetUri, findAssetUri } from "./asset-uri.repo";

describe("asset-uri.repo", () => {
	it("upsertAssetUri 写入并返回行", async () => {
		await upsertAssetUri({
			id: "task-1",
			type: "image",
			cdnUrl: "https://cdn/img.webp",
			taskId: "task-1",
			nodeId: "agent-node-1",
			userId: "user-1",
		});
		expect(mockUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "task-1" },
				create: expect.objectContaining({ cdn_url: "https://cdn/img.webp" }),
			}),
		);
	});

	it("findAssetUri 未找到时返回 null", async () => {
		const result = await findAssetUri("nonexistent");
		expect(result).toBeNull();
	});
});
