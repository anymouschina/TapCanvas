import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../types";

const mocks = vi.hoisted(() => ({
	supersedeProjectAssetMemoryEntries: vi.fn(async () => undefined),
	writeMemoryEntries: vi.fn(async (..._args: unknown[]) => ["memory-1"]),
}));

vi.mock("./memory.repo", () => mocks);

import { syncProjectAssetMemoryInDb } from "./project-asset-memory";

const db = {} as PrismaClient;

describe("project asset memory index", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("stores only a versioned reference and never the raw asset payload", async () => {
		const result = await syncProjectAssetMemoryInDb(db, {
			userId: "user-1",
			projectId: "project-1",
			assetId: "asset-1",
			name: "Hero image",
			data: {
				kind: "generation",
				url: "https://assets.example.com/hero.png",
				prompt: "private source prompt that must not be copied",
			},
			updatedAt: "2026-08-27T09:00:00.000Z",
		});

		expect(result.status).toBe("persisted");
		expect(mocks.supersedeProjectAssetMemoryEntries).toHaveBeenCalledWith(db, expect.objectContaining({
			userId: "user-1",
			projectId: "project-1",
			assetId: "asset-1",
		}));
		const request = mocks.writeMemoryEntries.mock.calls[0]?.[2] as
			{ entries: Array<{ content: unknown }> } | undefined;
		const entry = request?.entries[0];
		expect(entry?.content).toEqual({
			kind: "project_asset_ref",
			projectId: "project-1",
			assetId: "asset-1",
			assetName: "Hero image",
			updatedAt: "2026-08-27T09:00:00.000Z",
			metadata: { kind: "generation", url: "https://assets.example.com/hero.png" },
		});
		expect(JSON.stringify(entry?.content)).not.toContain("private source prompt");
	});

	it("does not create a project index for a stateless asset", async () => {
		await expect(syncProjectAssetMemoryInDb(db, {
			userId: "user-1",
			projectId: null,
			assetId: "asset-1",
			name: "Local image",
			data: { kind: "generation" },
			updatedAt: "2026-08-27T09:00:00.000Z",
		})).resolves.toEqual({ status: "skipped", reason: "project_id_missing" });
		expect(mocks.writeMemoryEntries).not.toHaveBeenCalled();
	});
});
