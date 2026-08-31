import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	listModelCatalogModels: vi.fn(),
	listModelCatalogVendors: vi.fn(),
	listNewApiModels: vi.fn(),
}));

vi.mock("./model-catalog.service", () => ({
	listModelCatalogModels: mocks.listModelCatalogModels,
	listModelCatalogVendors: mocks.listModelCatalogVendors,
}));

vi.mock("../new-api-models/new-api-models.service", () => ({
	isNonSelectableCatalogModel: () => false,
	isSelectableNewApiModel: (model: {
		enabled: boolean;
		runtimeEndpoints: string[];
		pricing?: { cost: number; enabled: boolean };
	}) => model.enabled && model.runtimeEndpoints.length > 0 &&
		model.pricing?.enabled === true && model.pricing.cost > 0,
	listNewApiModels: mocks.listNewApiModels,
}));

vi.mock("../new-api-models/new-api-model-identity", () => ({
	matchesNewApiRuntimeModelIdentity: (
		model: { modelName: string; requestModelKey?: string; routingAliases?: string[] },
		identity: string | null | undefined,
	) => Boolean(identity) && [
		model.modelName,
		model.requestModelKey,
		...(model.routingAliases ?? []),
	].includes(identity ?? ""),
}));

vi.mock("../task/task.vendor", () => ({
	normalizeDispatchVendor: (vendor: string) => vendor.trim().toLowerCase(),
}));

import { loadPublicChatEnabledModelCatalogSummary } from "./model-catalog.public-chat-summary";

describe("loadPublicChatEnabledModelCatalogSummary", () => {
	it("fresh-reads the executable runtime directory before projecting enabled media models", async () => {
		mocks.listModelCatalogVendors.mockResolvedValue([{
			key: "ark",
			name: "ARK",
			enabled: true,
			hasApiKey: true,
			authType: "bearer",
			createdAt: "2026-08-13T00:00:00.000Z",
			updatedAt: "2026-08-13T00:00:00.000Z",
		}]);
		mocks.listModelCatalogModels.mockResolvedValue([{
			modelKey: "video-runtime-model",
			modelAlias: "video-runtime-model",
			vendorKey: "ark",
			labelZh: "Runtime video model",
			kind: "video",
			enabled: true,
			createdAt: "2026-08-13T00:00:00.000Z",
			updatedAt: "2026-08-13T00:00:00.000Z",
		}]);
		mocks.listNewApiModels.mockResolvedValue([{
			modelName: "video-runtime-model",
			requestModelKey: "video-runtime-model",
			routingAliases: [],
			displayLabel: "Runtime video model",
			kind: "video",
			enabled: true,
			runtimeEndpoints: ["openai-video"],
			pricing: { cost: 100, enabled: true, specCosts: [] },
			meta: { videoOptions: {} },
		}]);

		const result = await loadPublicChatEnabledModelCatalogSummary(
			{ env: {} } as unknown as AppContext,
			"",
		);

		expect(mocks.listNewApiModels).toHaveBeenCalledWith(
			expect.anything(),
			{ enabled: true, fresh: true },
		);
		expect(result.error).toBeNull();
		expect(result.summary?.videoModels.map((model) => model.modelKey)).toEqual([
			"video-runtime-model",
		]);
	});

	it("exposes the exact runtime image key even when the local product catalog contains only a stale family key", async () => {
		mocks.listModelCatalogModels.mockResolvedValue([{
			modelKey: "ark/doubao-seedream-5-0",
			modelAlias: "doubao-seedream-5-0",
			vendorKey: "ark",
			labelZh: "Stale local Seedream row",
			kind: "image",
			enabled: true,
			createdAt: "2026-08-13T00:00:00.000Z",
			updatedAt: "2026-08-13T00:00:00.000Z",
		}]);
		mocks.listNewApiModels.mockResolvedValue([{
			modelName: "doubao-seedream-5-0-pro-260628",
			requestModelKey: "doubao-seedream-5-0-pro-260628",
			routingAliases: [],
			displayLabel: "Seedream 5.0 Pro",
			kind: "image",
			enabled: true,
			runtimeEndpoints: ["openai-image"],
			pricing: { cost: 120, enabled: true, specCosts: [] },
			meta: {
				imageOptions: {
					defaultImageSize: "1K",
					imageSizeOptions: ["1K", "2K"],
				},
			},
		}]);

		const result = await loadPublicChatEnabledModelCatalogSummary(
			{ env: {} } as unknown as AppContext,
			"user-1",
		);

		expect(result.error).toBeNull();
		expect(result.summary?.imageModels).toEqual([expect.objectContaining({
			vendorKey: "newapi",
			modelKey: "doubao-seedream-5-0-pro-260628",
			labelZh: "Seedream 5.0 Pro",
			availability: "system",
			imageOptions: expect.objectContaining({
				defaultImageSize: "1K",
			}),
		})]);
	});
});
