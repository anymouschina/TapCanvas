import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";

const { fetchWithHttpDebugLog, getNewApiPricingSnapshot } = vi.hoisted(() => ({
	fetchWithHttpDebugLog: vi.fn(),
	getNewApiPricingSnapshot: vi.fn(),
}));

vi.mock("../../httpDebugLog", () => ({
	fetchWithHttpDebugLog,
}));

vi.mock("../billing/new-api-pricing", () => ({
	getNewApiPricingSnapshot,
}));

import {
	isNonSelectableCatalogModel,
	isSelectableNewApiModel,
	getNewApiGatewayReadiness,
	listNewApiModels,
	matchesNewApiRuntimeModelIdentity,
} from "./new-api-models.service";

const env = {
	DB: {},
	JWT_SECRET: "test-secret",
	NEW_API_INTERNAL_BASE_URL: "http://new-api.test",
	NEW_API_PUBLIC_BASE_URL: "http://gateway.test:4455",
	NEW_API_INTERNAL_TOKEN: "test-token",
} as unknown as WorkerEnv;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function modelRow(kind: string, overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		model_name: "gpt-test",
		description: "test model",
		status: 1,
		sync_official: 0,
		created_time: 1,
		updated_time: 1,
		name_rule: 0,
		kind,
		...overrides,
	};
}

describe("new-api model catalog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: null,
			usdExchangeRate: 7,
			creditsByModelKey: new Map(),
			directCreditsByModelKey: new Map(),
			supportedEndpointTypesByModelKey: new Map(),
			specCreditsByModelSpecKey: new Map(),
		});
	});

	it("publishes aggregate gateway readiness without exposing credentials", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			success: true,
			data: {
				ready: false,
				enabled_model_count: 3,
				configured_channel_count: 0,
				executable_model_count: 0,
				reasons: ["no_configured_channels"],
			},
		}));

		const result = await getNewApiGatewayReadiness(env);

		expect(result).toEqual({
			ready: false,
			enabledModelCount: 3,
			configuredChannelCount: 0,
			executableModelCount: 0,
			reasons: ["no_configured_channels"],
			setupUrl: "http://gateway.test:4455/console/channel",
			recommendedProvider: {
				name: "鲁班 API",
				baseUrl: "https://tt-api.lluban.com/",
				registerUrl: "https://tt-api.lluban.com/register",
				topupUrl: "https://tt-api.lluban.com/console/topup",
				tokenUrl: "https://tt-api.lluban.com/console/token",
			},
		});
		expect(fetchWithHttpDebugLog).toHaveBeenCalledWith(
			expect.anything(),
			"http://new-api.test/api/internal/readiness",
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
			}),
			expect.objectContaining({ tag: "new-api-gateway-readiness" }),
		);
	});

	it("keeps explicit video-tool models out of the generation catalog", () => {
		expect(isNonSelectableCatalogModel("volc-enhance-video")).toBe(true);
		expect(isNonSelectableCatalogModel("volc-erase-video-subtitle")).toBe(true);
		expect(isNonSelectableCatalogModel("volc-erase-video-subtitle-pro")).toBe(true);
		expect(isNonSelectableCatalogModel("volc-matte-greenscreen-video")).toBe(true);
		expect(isNonSelectableCatalogModel("wan2.7-videoedit")).toBe(false);
	});

	it("normalizes new-api chat models to the text catalog", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ data: [modelRow("chat")] }));

		const result = await listNewApiModels(env, { kind: "text", enabled: true, fresh: true });

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ modelName: "gpt-test", kind: "text", enabled: true });
		expect(getNewApiPricingSnapshot).toHaveBeenCalledWith(env, { fresh: true });
	});

	it("publishes the Lite video-analysis duration price separately from its chat price", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("chat", {
				model_name: "doubao-seed-2-0-lite-260428",
				tags: "tapcanvas:capability=video-analysis",
			})],
		}));
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: "video-analysis-upfront-test",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([["doubao-seed-2-0-lite-260428", 1]]),
			directCreditsByModelKey: new Map(),
			supportedEndpointTypesByModelKey: new Map([
				["doubao-seed-2-0-lite-260428", ["openai"]],
			]),
			specCreditsByModelSpecKey: new Map(),
		});

		const result = await listNewApiModels(env, {
			kind: "text",
			enabled: true,
			fresh: true,
		});

		expect(result[0]?.pricing?.cost).toBe(1);
		expect(result[0]?.videoAnalysisPricing).toMatchObject({
			mode: "duration_metered",
			pricingVersion: "video-analysis-duration-v1",
			unit: "second",
			priceCnyPerSecond: 0.125,
			cost: 31,
			specKey: "video-understand:duration-metered:60s:5fps:16k-output:v1",
			tokenBudget: {
				maxVideoInputTokens: 81_920,
				maxTotalInputTokens: 120_375,
				maxOutputTokens: 16_384,
			},
		});
	});

	it("never derives a request model key from descriptive prose", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("image", {
				model_name: "doubao-seedream-5-0-pro-260628",
				description: "Doubao Seedream 5.0 Pro — ARK upstream model ID",
			})],
		}));

		const result = await listNewApiModels(env, { enabled: true, fresh: true });

		expect(result[0]?.requestModelKey).toBe("doubao-seedream-5-0-pro-260628");
	});

	it("uses only the structured request-model tag for an explicit upstream mapping", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("video", {
				model_name: "Seedance 2.0",
				description: "Display label without routing semantics",
				tags: "tapcanvas:kind=video,tapcanvas:request-model=doubao-seedance-2-0-260128",
			})],
		}));

		const result = await listNewApiModels(env, { enabled: true, fresh: true });

		expect(result[0]?.requestModelKey).toBe("doubao-seedance-2-0-260128");
	});

	it("preserves authoritative canonical routing aliases from new-api", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("video", {
				model_name: "doubao-seedance-2.0",
				routing_aliases: [
					"doubao-seedance-2.0-apimart",
					"doubao-seedance-2-0-260128",
				],
			})],
		}));

		const result = await listNewApiModels(env, { enabled: true, fresh: true });

		expect(result[0]?.routingAliases).toEqual([
			"doubao-seedance-2.0-apimart",
			"doubao-seedance-2-0-260128",
		]);
	});

	it("matches only exact live model identities, including structured routing aliases", () => {
		const runtimeModel = {
			modelName: "doubao-seedance-2.0",
			requestModelKey: "doubao-seedance-2.0",
			routingAliases: ["doubao-seedance-2-0-260128"],
		};
		expect(matchesNewApiRuntimeModelIdentity(runtimeModel, "doubao-seedance-2-0-260128"))
			.toBe(true);
		expect(matchesNewApiRuntimeModelIdentity(runtimeModel, "DOUBAO-SEEDANCE-2.0"))
			.toBe(true);
		expect(matchesNewApiRuntimeModelIdentity(runtimeModel, "doubao-seedance-2"))
			.toBe(false);
	});

	it("reuses a supplied authoritative pricing snapshot without fetching it again", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ data: [modelRow("chat")] }));
		const pricingSnapshot = {
			creditsPerCny: 100,
			pricingVersion: "supplied",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([["gpt-test", 6]]),
			directCreditsByModelKey: new Map(),
			supportedEndpointTypesByModelKey: new Map([["gpt-test", ["openai"]]]),
			specCreditsByModelSpecKey: new Map(),
		};

		const result = await listNewApiModels(env, {
			enabled: true,
			fresh: true,
			pricingSnapshot,
		});

		expect(result[0]?.pricing?.cost).toBe(6);
		expect(result[0]?.runtimeEndpoints).toEqual(["openai"]);
		expect(getNewApiPricingSnapshot).not.toHaveBeenCalled();
	});

	it("does not mark enabled metadata as selectable when runtime pricing is absent", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ data: [modelRow("chat")] }));

		const result = await listNewApiModels(env, { kind: "text", enabled: true, fresh: true });

		expect(result).toHaveLength(1);
		expect(result[0]?.pricing).toBeUndefined();
		expect(result[0] ? isSelectableNewApiModel(result[0]) : true).toBe(false);
	});

	it("does not mark a priced model selectable when no valid protocol endpoint is published", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ data: [modelRow("chat")] }));
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: "priced-but-unroutable",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([["gpt-test", 6]]),
			directCreditsByModelKey: new Map(),
			supportedEndpointTypesByModelKey: new Map(),
			specCreditsByModelSpecKey: new Map(),
		});

		const result = await listNewApiModels(env, { kind: "text", enabled: true, fresh: true });

		expect(result).toHaveLength(1);
		expect(result[0]?.runtimeEndpoints).toEqual([]);
		expect(result[0] ? isSelectableNewApiModel(result[0]) : true).toBe(false);
	});

	it("marks a model selectable only after price and a valid protocol endpoint are published", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ data: [modelRow("chat")] }));
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: "routable",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([["gpt-test", 6]]),
			directCreditsByModelKey: new Map(),
			supportedEndpointTypesByModelKey: new Map([["gpt-test", ["openai"]]]),
			specCreditsByModelSpecKey: new Map(),
		});

		const result = await listNewApiModels(env, { kind: "text", enabled: true, fresh: true });

		expect(result).toHaveLength(1);
		expect(result[0]?.runtimeEndpoints).toEqual(["openai"]);
		expect(result[0] ? isSelectableNewApiModel(result[0]) : false).toBe(true);
	});

	it("accepts a newly published video model without a model-name allowlist", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("video", {
				model_name: "sd2",
				capabilities: JSON.stringify(["text_to_video", "reference_images"]),
				params_def: JSON.stringify([
					{
						key: "duration",
						type: "enum",
						default: 5,
						options: [{ value: 4, label: "4s" }, { value: 5, label: "5s" }],
					},
					{
						key: "resolution",
						type: "enum",
						default: "720p",
						options: [{ value: "480p", label: "480P" }, { value: "720p", label: "720P" }],
					},
				]),
			})],
		}));
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: "megaby-test",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([["sd2", 325]]),
			directCreditsByModelKey: new Map([["sd2", 325]]),
			supportedEndpointTypesByModelKey: new Map([["sd2", ["task.megaby"]]]),
			specCreditsByModelSpecKey: new Map([
				["sd2:video:480p:4s", 325],
				["sd2:video:720p:4s", 650],
			]),
		});

		const result = await listNewApiModels(env, { kind: "video", enabled: true, fresh: true });

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			modelName: "sd2",
			requestModelKey: "sd2",
			runtimeEndpoints: ["task.megaby"],
			pricing: { cost: 325, enabled: true },
		});
		expect(result[0] ? isSelectableNewApiModel(result[0]) : false).toBe(true);
	});

	it("does not expose a local flat price when the realtime snapshot has no Kling price", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("video", { model_name: "kling-v3" })],
		}));

		const result = await listNewApiModels(env, { enabled: true, fresh: true });

		expect(result).toHaveLength(1);
		expect(result[0]?.pricing).toBeUndefined();
	});

	it("uses the realtime base image price when the snapshot has no per-spec prices", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("image", {
				params_def: JSON.stringify([{
					key: "resolution",
					default: "2K",
					options: [{ value: "1K", label: "1K" }, { value: "2K", label: "2K" }, { value: "4K", label: "4K" }],
				}]),
			})],
		}));
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: "test",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([["gpt-test", 30]]),
			directCreditsByModelKey: new Map([["gpt-test", 30]]),
			supportedEndpointTypesByModelKey: new Map([["gpt-test", ["image-generation"]]]),
			specCreditsByModelSpecKey: new Map(),
		});

		const result = await listNewApiModels(env, { enabled: true, fresh: true });

		expect(result[0]?.pricing).toEqual({
			cost: 30,
			enabled: true,
			specCosts: [
				{ specKey: "image:1k", cost: 30, enabled: true },
				{ specKey: "image:2k", cost: 30, enabled: true },
				{ specKey: "image:4k", cost: 30, enabled: true },
			],
		});
	});

	it("projects Seedance 2.5 limits and feature flags into dynamic videoOptions", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("video", {
				model_name: "doubao-seedance-2.5",
				capabilities: JSON.stringify([
					"multimodal_reference",
					"reference_images",
					"reference_videos",
					"reference_audios",
					"audio_only_reference",
					"first_last_frame",
					"video_editing",
					"video_subject_removal",
					"video_subtitle_removal",
					"video_extension",
					"ultra_long_video",
					"timestamp_prompt",
					"native_audio",
				]),
				params_def: JSON.stringify([
					{
						key: "duration",
						type: "enum",
						default: 5,
						options: [{ value: 4, label: "4s" }, { value: 30, label: "30s" }],
					},
					{
						key: "resolution",
						type: "enum",
						default: "720p",
						options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }],
					},
					{ key: "reference_images", type: "integer", max: 30 },
					{ key: "reference_videos", type: "integer", max: 10 },
					{ key: "reference_audios", type: "integer", max: 10 },
					{ key: "reference_media", type: "integer", max: 50 },
					{ key: "reference_video_duration_seconds", type: "float", max: 30.2 },
					{ key: "reference_audio_duration_seconds", type: "float", max: 30.2 },
					{ key: "video_extension_duration_seconds", type: "integer", max: 30 },
					{ key: "nested_video_duration_seconds", type: "integer", max: 60 },
					{ key: "ultra_long_duration_seconds", type: "integer", max: 180 },
				]),
			})],
		}));

		const result = await listNewApiModels(env, { kind: "video", enabled: true, fresh: true });

		expect(result[0]?.meta?.videoOptions).toMatchObject({
			defaultDurationSeconds: 5,
			defaultResolution: "720p",
			maxReferenceImages: 30,
			maxReferenceVideos: 10,
			maxReferenceAudios: 10,
			maxReferenceMedia: 50,
			maxReferenceVideoDurationSeconds: 30.2,
			maxReferenceAudioDurationSeconds: 30.2,
			maxVideoExtensionDurationSeconds: 30,
			maxNestedVideoDurationSeconds: 60,
			maxUltraLongDurationSeconds: 180,
			supportsMultimodalReferences: true,
			supportsReferenceImages: true,
			supportsReferenceVideos: true,
			supportsReferenceAudios: true,
			supportsAudioOnlyReference: true,
			supportsFirstLastFrame: true,
			supportsVideoEditing: true,
			supportsVideoSubjectRemoval: true,
			supportsVideoSubtitleRemoval: true,
			supportsVideoExtension: true,
			supportsUltraLongVideo: true,
			supportsTimestampPrompt: true,
			supportsNativeAudio: true,
		});
		expect(result[0]?.meta?.runtimeParameters).toEqual(expect.arrayContaining([
			expect.objectContaining({ key: "duration", type: "enum" }),
			expect.objectContaining({ key: "resolution", type: "enum", default: "720p" }),
		]));
	});

	it("preserves realtime per-spec image prices instead of flattening them to the base price", async () => {
		const saverModel = "gemini-3-pro-image-preview-saver";
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("image", {
				model_name: saverModel,
				params_def: JSON.stringify([{
					key: "resolution",
					default: "2K",
					options: [{ value: "1K", label: "1K" }, { value: "2K", label: "2K" }, { value: "4K", label: "4K" }],
				}]),
			})],
		}));
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: "tiered",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([[saverModel, 30]]),
			directCreditsByModelKey: new Map([[saverModel, 30]]),
			supportedEndpointTypesByModelKey: new Map([[saverModel, ["image-generation"]]]),
			specCreditsByModelSpecKey: new Map([
				[`${saverModel}:image:1k`, 30],
				[`${saverModel}:image:2k`, 30],
				[`${saverModel}:image:4k`, 50],
			]),
		});

		const result = await listNewApiModels(env, { enabled: true, fresh: true });

		expect(result[0]?.pricing).toEqual({
			cost: 30,
			enabled: true,
			specCosts: [
				{ specKey: "image:1k", cost: 30, enabled: true },
				{ specKey: "image:2k", cost: 30, enabled: true },
				{ specKey: "image:4k", cost: 50, enabled: true },
			],
		});
	});

	it("projects image quality controls and quality-specific realtime prices", async () => {
		const modelName = "gpt-image-2";
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({
			data: [modelRow("image", {
				model_name: modelName,
				params_def: JSON.stringify([
					{
						key: "image_size",
						default: "1K",
						options: [{ value: "1K", label: "1K" }, { value: "2K", label: "2K" }, { value: "4K", label: "4K" }],
					},
					{
						key: "quality",
						default: "low",
						options: [{ value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }],
					},
				]),
			})],
		}));
		getNewApiPricingSnapshot.mockResolvedValue({
			creditsPerCny: 100,
			pricingVersion: "gpt-image-2-premium-v1",
			usdExchangeRate: 7,
			creditsByModelKey: new Map([[modelName, 30]]),
			directCreditsByModelKey: new Map([[modelName, 30]]),
			supportedEndpointTypesByModelKey: new Map([[modelName, ["image-generation"]]]),
			specCreditsByModelSpecKey: new Map([
				[`${modelName}:image:1k:low`, 30],
				[`${modelName}:image:2k:medium`, 120],
				[`${modelName}:image:4k:high`, 760],
			]),
		});

		const result = await listNewApiModels(env, { enabled: true, fresh: true });

		expect(result[0]?.meta?.imageOptions).toMatchObject({
			defaultImageSize: "1K",
			defaultQuality: "low",
			qualityOptions: ["low", "medium", "high"],
		});
		expect(result[0]?.pricing?.specCosts).toEqual([
			{ specKey: "image:1k:low", cost: 30, enabled: true },
			{ specKey: "image:2k:medium", cost: 120, enabled: true },
			{ specKey: "image:4k:high", cost: 760, enabled: true },
		]);
	});

	it("reports an upstream non-2xx response as an explicit 502", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ error: "unavailable" }, 503));

		await expect(listNewApiModels(env, { fresh: true })).rejects.toMatchObject({
			status: 502,
			code: "new_api_model_list_request_failed",
			details: expect.objectContaining({ upstreamStatus: 503 }),
		});
	});

	it("reports DNS and connection failures as an explicit 502", async () => {
		fetchWithHttpDebugLog.mockRejectedValue(new TypeError("fetch failed"));

		await expect(listNewApiModels(env, { fresh: true })).rejects.toMatchObject({
			status: 502,
			code: "new_api_model_list_request_failed",
			details: expect.objectContaining({ reason: "network_error" }),
		});
	});

	it("reports a response without a data array as invalid", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ data: null }));

		await expect(listNewApiModels(env, { fresh: true })).rejects.toMatchObject({
			status: 502,
			code: "new_api_model_list_invalid",
			details: { reason: "data_not_array" },
		});
	});

	it("preserves a valid empty data array as a successful empty catalog", async () => {
		fetchWithHttpDebugLog.mockResolvedValue(jsonResponse({ data: [] }));

		await expect(listNewApiModels(env, { fresh: true })).resolves.toEqual([]);
	});

	it("does not return expired cached rows when refresh fails", async () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-07-20T08:00:00.000Z"));
			fetchWithHttpDebugLog.mockResolvedValueOnce(jsonResponse({ data: [modelRow("chat")] }));
			await expect(listNewApiModels(env, { fresh: true })).resolves.toHaveLength(1);

			vi.advanceTimersByTime(5 * 60_000 + 1);
			fetchWithHttpDebugLog.mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503));
			await expect(listNewApiModels(env)).rejects.toMatchObject({
				status: 502,
				code: "new_api_model_list_request_failed",
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
