import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";

const { fetchWithHttpDebugLog } = vi.hoisted(() => ({
	fetchWithHttpDebugLog: vi.fn(),
}));

vi.mock("../../httpDebugLog", () => ({
	fetchWithHttpDebugLog,
}));

import { getNewApiPricingSnapshot } from "./new-api-pricing";

const env = {
	DB: {},
	JWT_SECRET: "test-secret",
	NEW_API_INTERNAL_BASE_URL: "http://new-api.test",
	NEW_API_INTERNAL_TOKEN: "test-token",
	NEW_API_USD_EXCHANGE_RATE: "7",
} as unknown as WorkerEnv;

describe("new-api pricing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports DNS and connection failures as an explicit 502", async () => {
		fetchWithHttpDebugLog.mockRejectedValue(new TypeError("fetch failed"));

		await expect(getNewApiPricingSnapshot(env, { fresh: true })).rejects.toMatchObject({
			status: 502,
			code: "new_api_pricing_request_failed",
			details: expect.objectContaining({ reason: "network_error" }),
		});
	});

	it("requires an explicit positive USD exchange rate before requesting pricing", async () => {
		const invalidEnv = {
			...env,
			NEW_API_USD_EXCHANGE_RATE: "",
		} as WorkerEnv;

		await expect(getNewApiPricingSnapshot(invalidEnv, { fresh: true })).rejects.toMatchObject({
			status: 500,
			code: "new_api_usd_exchange_rate_invalid",
			details: { configured: false },
		});
		expect(fetchWithHttpDebugLog).not.toHaveBeenCalled();
	});

	it("uses 100 credits per CNY when the environment does not override it", async () => {
		fetchWithHttpDebugLog.mockResolvedValueOnce(new Response(JSON.stringify({
				pricing_version: "test-v1",
				data: [{
					model_name: "gpt-image-test",
					quota_type: 1,
					model_price: 0.2,
					supported_endpoint_types: ["image-generation", "image-generation", ""],
				}],
			}), { status: 200 }));

		const result = await getNewApiPricingSnapshot(env, { fresh: true });

		expect(result.creditsPerCny).toBe(100);
		expect(result.creditsByModelKey.get("gpt-image-test")).toBe(20);
		expect(result.supportedEndpointTypesByModelKey.get("gpt-image-test")).toEqual([
			"image-generation",
		]);
	});

	it("bypasses a cached flat image price and refreshes per-spec prices", async () => {
		const saverModel = "gemini-3-pro-image-preview-saver";
		fetchWithHttpDebugLog
			.mockResolvedValueOnce(new Response(JSON.stringify({
				pricing_version: "flat-v1",
				data: [{
					model_name: saverModel,
					quota_type: 1,
					model_price: 0.3,
					param_pricing: {
						currency: "CNY",
						results: [
							{ spec_key: "image:1k", price_cny: 0.3 },
							{ spec_key: "image:2k", price_cny: 0.3 },
							{ spec_key: "image:4k", price_cny: 0.3 },
						],
					},
				}],
			}), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				pricing_version: "tiered-v2",
				data: [{
					model_name: saverModel,
					quota_type: 1,
					model_price: 0.3,
					param_pricing: {
						currency: "CNY",
						results: [
							{ spec_key: "image:1k", price_cny: 0.3 },
							{ spec_key: "image:2k", price_cny: 0.3 },
							{ spec_key: "image:4k", price_cny: 0.5 },
						],
					},
				}],
			}), { status: 200 }));

		const cached = await getNewApiPricingSnapshot(env, { fresh: true });
		expect(cached.specCreditsByModelSpecKey.get(`${saverModel}:image:4k`)).toBe(30);

		const refreshed = await getNewApiPricingSnapshot(env, { fresh: true });
		expect(refreshed.pricingVersion).toBe("tiered-v2");
		expect(refreshed.specCreditsByModelSpecKey.get(`${saverModel}:image:1k`)).toBe(30);
		expect(refreshed.specCreditsByModelSpecKey.get(`${saverModel}:image:2k`)).toBe(30);
		expect(refreshed.specCreditsByModelSpecKey.get(`${saverModel}:image:4k`)).toBe(50);
		expect(fetchWithHttpDebugLog).toHaveBeenCalledTimes(2);
	});

	it("preserves the gpt-image-2 quality by resolution matrix", async () => {
		fetchWithHttpDebugLog.mockResolvedValueOnce(new Response(JSON.stringify({
				pricing_version: "gpt-image-2-premium-v1",
				data: [{
					model_name: "gpt-image-2",
					quota_type: 1,
					model_price: 0.3,
					param_pricing: {
						currency: "CNY",
						reference_image_price_cny: 0.1,
						results: [
							{ spec_key: "image:1k:low", price_cny: 0.3 },
							{ spec_key: "image:2k:medium", price_cny: 1.2 },
							{ spec_key: "image:4k:high", price_cny: 7.6 },
						],
					},
				}],
			}), { status: 200 }));

		const result = await getNewApiPricingSnapshot(env, { fresh: true });

		expect(result.creditsByModelKey.get("gpt-image-2")).toBe(30);
		expect(result.specCreditsByModelSpecKey.get("gpt-image-2:image:1k:low")).toBe(30);
		expect(result.specCreditsByModelSpecKey.get("gpt-image-2:image:2k:medium")).toBe(120);
		expect(result.specCreditsByModelSpecKey.get("gpt-image-2:image:4k:high")).toBe(760);
		expect(result.referenceImageCreditsByModelKey.get("gpt-image-2")).toBe(10);
	});
});
