import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, WorkerEnv } from "../../types";

const { getModelCreditCost, getNewApiPricingSnapshot, listNewApiModels } = vi.hoisted(() => ({
	getModelCreditCost: vi.fn(),
	getNewApiPricingSnapshot: vi.fn(),
	listNewApiModels: vi.fn(),
}));

vi.mock("./billing.repo", async (importOriginal) => ({
	...(await importOriginal<typeof import("./billing.repo")>()),
	getModelCreditCost,
}));
vi.mock("./new-api-pricing", () => ({ getNewApiPricingSnapshot }));
vi.mock("../new-api-models/new-api-models.service", () => ({ listNewApiModels }));

import { resolveTeamCreditsCostForTask } from "./billing.service";

const env = { DB: {}, JWT_SECRET: "test-secret" } as unknown as WorkerEnv;
const context = { env } as unknown as AppContext;

function pricingSnapshot(input?: {
	credits?: Array<[string, number]>;
	directCredits?: Array<[string, number]>;
	specCredits?: Array<[string, number]>;
	referenceImageCredits?: Array<[string, number]>;
}) {
	return {
		creditsPerCny: 100,
		pricingVersion: "test",
		usdExchangeRate: 7,
		creditsByModelKey: new Map(input?.credits ?? []),
		directCreditsByModelKey: new Map(input?.directCredits ?? []),
		supportedEndpointTypesByModelKey: new Map(),
		specCreditsByModelSpecKey: new Map(input?.specCredits ?? []),
		referenceImageCreditsByModelKey: new Map(input?.referenceImageCredits ?? []),
	};
}

function runtimeModel(modelKey: string, runtimeEndpoints: string[] = ["openai"]) {
	return {
		modelName: modelKey,
		requestModelKey: modelKey,
		enabled: true,
		runtimeEndpoints,
	};
}

describe("billing.service realtime pricing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getModelCreditCost.mockResolvedValue(null);
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot());
		listNewApiModels.mockResolvedValue([
			runtimeModel("seedance-2.0", ["openai-video"]),
			runtimeModel("gpt-image-fixed", ["image-generation"]),
			runtimeModel("kling-v3", ["openai-video"]),
			runtimeModel("unpriced-image", ["image-generation"]),
			runtimeModel("deepseek-v4-flash"),
		]);
	});

	it("prefers an enabled exact system-managed spec price", async () => {
		getModelCreditCost.mockResolvedValue({
			model_key: "doubao-seedance-2-0-260128",
			spec_key: "video:720p:10s",
			cost: 171,
			enabled: 1,
			created_at: "2026-07-22T00:00:00.000Z",
			updated_at: "2026-07-22T00:00:00.000Z",
		});

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_video",
			modelKey: "doubao-seedance-2-0-260128",
			specKey: "video:720p:10s",
		})).resolves.toBe(171);
		expect(getNewApiPricingSnapshot).not.toHaveBeenCalled();
	});

	it("fails explicitly when the exact system-managed spec price is disabled", async () => {
		getModelCreditCost.mockResolvedValue({
			model_key: "doubao-seedance-2-0-260128",
			spec_key: "video:720p:10s",
			cost: 171,
			enabled: 0,
			created_at: "2026-07-22T00:00:00.000Z",
			updated_at: "2026-07-22T00:00:00.000Z",
		});

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_video",
			modelKey: "doubao-seedance-2-0-260128",
			specKey: "video:720p:10s",
		})).rejects.toMatchObject({ status: 503, code: "model_spec_pricing_disabled" });
		expect(getNewApiPricingSnapshot).not.toHaveBeenCalled();
	});

	it("charges an exact realtime Seedance spec price", async () => {
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot({
			specCredits: [["seedance-2.0:video:720p:4s", 684]],
		}));

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_video",
			modelKey: "seedance-2.0",
			specKey: "video:720p:4s",
		})).resolves.toBe(684);
	});

	it("charges Seedance reference-video input and output durations at the same per-second rate", async () => {
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot({
			specCredits: [["seedance-2.0:video:720p:10s", 1710]],
		}));

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "image_to_video",
			modelKey: "seedance-2.0",
			specKey: "video:720p:10s",
			outputDurationSeconds: 10,
			referenceVideoDurationSeconds: 6,
		})).resolves.toBe(2736);
	});

	it("rejects reference-video pricing without a valid input duration", async () => {
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot({
			specCredits: [["seedance-2.0:video:720p:10s", 1710]],
		}));

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "image_to_video",
			modelKey: "seedance-2.0",
			specKey: "video:720p:10s",
			outputDurationSeconds: 10,
			referenceVideoDurationSeconds: 0,
		})).rejects.toMatchObject({ code: "reference_video_duration_required_for_pricing" });
	});

	it("uses a realtime fixed per-call price when an image request carries a spec", async () => {
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot({
			credits: [["gpt-image-fixed", 30]],
			directCredits: [["gpt-image-fixed", 30]],
			specCredits: [["gpt-image-fixed:image:16_9:4k:high", 30]],
		}));

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_image",
			modelKey: "gpt-image-fixed",
			specKey: "image:16_9:4k:high",
		})).resolves.toBe(30);
	});

	it("adds the published per-reference-image price to a quality spec", async () => {
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot({
			specCredits: [["gpt-image-fixed:image:2k:medium", 120]],
			referenceImageCredits: [["gpt-image-fixed", 10]],
		}));

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "image_edit",
			modelKey: "gpt-image-fixed",
			specKey: "image:2k:medium",
			referenceImageCount: 2,
		})).resolves.toBe(140);
	});

	it("does not collapse a missing quality row to a resolution or base price", async () => {
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot({
			credits: [["gpt-image-fixed", 30]],
			directCredits: [["gpt-image-fixed", 30]],
			specCredits: [["gpt-image-fixed:image:2k", 40]],
		}));

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_image",
			modelKey: "gpt-image-fixed",
			specKey: "image:2k:high",
		})).rejects.toMatchObject({
			status: 503,
			code: "model_spec_pricing_unavailable",
		});
	});

	it("reports a missing spec price when neither configured nor realtime pricing exists", async () => {
		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_video",
			modelKey: "kling-v3",
			specKey: "video:1080p:5s",
		})).rejects.toMatchObject({ status: 503, code: "model_spec_pricing_unavailable" });
	});

	it("reports a missing realtime model price instead of using a task-kind default", async () => {
		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_image",
			modelKey: "unpriced-image",
		})).rejects.toMatchObject({ status: 503, code: "model_pricing_unavailable" });
		expect(getNewApiPricingSnapshot).toHaveBeenCalledTimes(2);
		expect(listNewApiModels).toHaveBeenCalledTimes(2);
		for (const [, options] of listNewApiModels.mock.calls) {
			expect(options.pricingSnapshot).toBeDefined();
		}
	});

	it("refreshes authoritative pricing once when a cached model price is missing", async () => {
		getNewApiPricingSnapshot
			.mockResolvedValueOnce(pricingSnapshot())
			.mockResolvedValueOnce(pricingSnapshot({
				credits: [["deepseek-v4-flash", 6]],
			}));
		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "chat",
			modelKey: "deepseek-v4-flash",
		})).resolves.toBe(6);
		expect(getNewApiPricingSnapshot).toHaveBeenNthCalledWith(1, env, undefined);
		expect(getNewApiPricingSnapshot).toHaveBeenNthCalledWith(2, env, { fresh: true });
	});

	it("rejects a positive price when the enabled model has no executable runtime protocol", async () => {
		getNewApiPricingSnapshot.mockResolvedValue(pricingSnapshot({
			credits: [["deepseek-v4-flash", 6]],
		}));
		listNewApiModels.mockResolvedValue([
			runtimeModel("deepseek-v4-flash", []),
		]);

		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "chat",
			modelKey: "deepseek-v4-flash",
		})).rejects.toMatchObject({
			status: 503,
			code: "model_runtime_route_unavailable",
			details: {
				modelKey: "deepseek-v4-flash",
				routeState: "runtime_endpoint_missing",
				pricingRefreshAttempted: true,
			},
		});
		expect(getNewApiPricingSnapshot).toHaveBeenCalledTimes(2);
	});

	it("requires a model key for every priced task", async () => {
		await expect(resolveTeamCreditsCostForTask(context, {
			taskKind: "text_to_image",
			modelKey: null,
		})).rejects.toMatchObject({ status: 400, code: "model_key_required_for_pricing" });
		expect(getNewApiPricingSnapshot).not.toHaveBeenCalled();
	});
});
