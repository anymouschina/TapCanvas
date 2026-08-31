import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	createAssetRow: vi.fn(),
	findGeneratedAssetBySourceUrl: vi.fn(),
	updateAssetDataRow: vi.fn(),
}));

vi.mock("./asset.repo", () => ({
	createAssetRow: mocks.createAssetRow,
	findGeneratedAssetBySourceUrl: mocks.findGeneratedAssetBySourceUrl,
	updateAssetDataRow: mocks.updateAssetDataRow,
}));

import { hostTaskAssetsInWorker } from "./asset.hosting";

function context(): AppContext {
	return {
		env: {
			DB: {},
		},
		req: {
			url: "http://localhost:8788/tasks/run",
			header: () => undefined,
		},
	} as AppContext;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findGeneratedAssetBySourceUrl.mockResolvedValue({
		id: "asset-1",
		name: "Image",
		data: JSON.stringify({
			kind: "generation",
			type: "image",
			url: "http://localhost:8788/assets/local/gen/images/hosted.png",
			thumbnailUrl: null,
			sourceUrl: "https://provider.example.com/output.png",
		}),
		owner_id: "user-1",
		project_id: "project-1",
		created_at: "2026-08-20T00:00:00.000Z",
		updated_at: "2026-08-20T00:00:00.000Z",
	});
});

describe("generation asset hosting reuse", () => {
	it("returns a reused hosted asset instead of dropping it from the task result", async () => {
		const result = await hostTaskAssetsInWorker({
			c: context(),
			userId: "user-1",
			assets: [{
				type: "image",
				url: "https://provider.example.com/output.png",
			}],
			meta: {
				taskId: "task-1",
				generationContext: { projectId: "project-1" },
			},
		});

		expect(result).toEqual([{
			type: "image",
			url: "http://localhost:8788/assets/local/gen/images/hosted.png",
			thumbnailUrl: null,
			assetId: "asset-1",
		}]);
		expect(mocks.createAssetRow).not.toHaveBeenCalled();
		expect(mocks.updateAssetDataRow).not.toHaveBeenCalled();
	});
});
