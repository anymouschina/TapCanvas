import { describe, expect, it } from "vitest";

import type { ModelCatalogModelDto } from "./model-catalog.schemas";
import {
	buildPublicChatEnabledModelCatalogSummaryFromModels,
	filterCatalogModelsByExecutableRuntime,
} from "./model-catalog.public-chat-summary";

function createModel(
	input: Partial<ModelCatalogModelDto> &
		Pick<ModelCatalogModelDto, "modelKey" | "vendorKey" | "labelZh" | "kind" | "enabled">,
): ModelCatalogModelDto {
	return {
		modelKey: input.modelKey,
		vendorKey: input.vendorKey,
		modelAlias: input.modelAlias ?? input.modelKey,
		labelZh: input.labelZh,
		kind: input.kind,
		enabled: input.enabled,
		meta: input.meta,
		pricing: input.pricing,
		createdAt: input.createdAt ?? "2026-03-27T00:00:00.000Z",
		updatedAt: input.updatedAt ?? "2026-03-27T00:00:00.000Z",
	};
}

describe("buildPublicChatEnabledModelCatalogSummaryFromModels", () => {
	it("projects only exact selectable audio contracts with live positive pricing", () => {
		const summary = buildPublicChatEnabledModelCatalogSummaryFromModels(
			[],
			new Map(),
			[
				{
					modelName: "doubao-speech-runtime",
					requestModelKey: "doubao-speech-exact",
					displayLabel: "Doubao Speech",
					kind: "audio",
					tags: ["tapcanvas:audio-type=speech", "tapcanvas:audio-engine=doubao"],
					pricing: { cost: 8, enabled: true, specCosts: [] },
				},
				{
					modelName: "unpriced-music",
					requestModelKey: "unpriced-music",
					kind: "audio",
					tags: ["tapcanvas:audio-type=music"],
					pricing: { cost: 0, enabled: true, specCosts: [] },
				},
				{
					modelName: "untagged-audio",
					requestModelKey: "untagged-audio",
					kind: "audio",
					tags: [],
					pricing: { cost: 9, enabled: true, specCosts: [] },
				},
			],
		);

		expect(summary.audioModels).toEqual([{
			modelKey: "doubao-speech-exact",
			label: "Doubao Speech",
			audioType: "speech",
			engine: "doubao",
			pricingCost: 8,
		}]);
	});

	it("accepts exact structured runtime aliases and removes catalog-only identities", () => {
		const legacy = createModel({
			modelKey: "doubao-seedance-2-0-260128",
			modelAlias: "doubao-seedance-2-0-260128",
			vendorKey: "ark",
			labelZh: "Legacy Seedance identity",
			kind: "video",
			enabled: true,
		});
		const executable = createModel({
			modelKey: "doubao-seedance-2.0",
			modelAlias: "doubao-seedance-2.0",
			vendorKey: "ark",
			labelZh: "Seedance 2.0",
			kind: "video",
			enabled: true,
		});
		const stale = createModel({
			modelKey: "stale-video-model",
			modelAlias: "stale-video-model",
			vendorKey: "ark",
			labelZh: "Stale model",
			kind: "video",
			enabled: true,
		});
		const viaStructuredAlias = createModel({
			modelKey: "catalog-display-key",
			modelAlias: "runtime-request-key",
			vendorKey: "ark",
			labelZh: "Structured alias",
			kind: "video",
			enabled: true,
		});

		const filtered = filterCatalogModelsByExecutableRuntime(
			[legacy, stale, executable, viaStructuredAlias],
			[
				{
					modelName: "doubao-seedance-2.0",
					requestModelKey: "doubao-seedance-2.0",
					routingAliases: ["doubao-seedance-2-0-260128"],
				},
				{ modelName: "Runtime Label", requestModelKey: "runtime-request-key" },
			],
		);

		expect(filtered.map((model) => model.modelKey)).toEqual([
			"doubao-seedance-2-0-260128",
			"doubao-seedance-2.0",
			"catalog-display-key",
		]);
	});

	it("keeps only available image/video models and exposes structured specs", () => {
		const summary = buildPublicChatEnabledModelCatalogSummaryFromModels(
			[
				createModel({
					modelKey: "nano-banana-pro",
					modelAlias: "nano-banana-pro",
					vendorKey: "gemini",
					labelZh: "Nano Banana Pro",
					kind: "image",
					enabled: true,
					pricing: { cost: 12, enabled: true, specCosts: [] },
					meta: {
						useCases: ["小说分镜关键帧", "角色一致性"],
						imageOptions: {
							defaultAspectRatio: "16:9",
							defaultImageSize: "2K",
							aspectRatioOptions: ["16:9", "9:16", "16:9"],
							imageSizeOptions: [
								{ value: "2K", label: "2K" },
								"4K",
							],
							resolutionOptions: ["1536x864"],
							supportsReferenceImages: true,
							supportsTextToImage: true,
							supportsImageToImage: true,
						},
					},
				}),
				createModel({
					modelKey: "veo3.1-fast",
					modelAlias: "veo3.1-fast",
					vendorKey: "veo",
					labelZh: "Veo 3.1 Fast",
					kind: "video",
					enabled: true,
					pricing: { cost: 20, enabled: true, specCosts: [] },
					meta: {
						useCases: ["快速预演", "情绪镜头"],
						videoOptions: {
							defaultDurationSeconds: 5,
							defaultResolution: "720p",
							durationOptions: [
								{ value: 5, label: "5s" },
								{ value: 8, label: "8s" },
							],
							sizeOptions: [
								{
									value: "1280x720",
									label: "720p 横屏",
									orientation: "landscape",
									aspectRatio: "16:9",
								},
							],
							resolutionOptions: [
								{ value: "720p", label: "720p" },
								{ value: "1080p", label: "1080p" },
							],
							orientationOptions: [{ value: "landscape", label: "横屏" }],
						},
					},
				}),
				createModel({
					modelKey: "text-only",
					vendorKey: "openai",
					labelZh: "GPT",
					kind: "text",
					enabled: true,
				}),
				createModel({
					modelKey: "disabled-video",
					vendorKey: "veo",
					labelZh: "Disabled",
					kind: "video",
					enabled: false,
				}),
			],
			new Map([
				["gemini", { system: true, user: false }],
				["veo", { system: true, user: true }],
			]),
		);

		expect(summary.imageModels).toHaveLength(1);
		expect(summary.imageModels[0]).toMatchObject({
			modelAlias: "nano-banana-pro",
			availability: "system",
			useCases: ["小说分镜关键帧", "角色一致性"],
			imageOptions: {
				defaultAspectRatio: "16:9",
				defaultImageSize: "2K",
				aspectRatioOptions: ["16:9", "9:16"],
				imageSizeOptions: [
					{ value: "2K", label: "2K", priceLabel: null },
					{ value: "4K", label: "4K", priceLabel: null },
				],
				resolutionOptions: ["1536x864"],
				supportsReferenceImages: true,
				supportsTextToImage: true,
				supportsImageToImage: true,
			},
		});

		expect(summary.videoModels).toHaveLength(1);
		expect(summary.videoModels[0]).toMatchObject({
			modelAlias: "veo3.1-fast",
			availability: "system+user",
			useCases: ["快速预演", "情绪镜头"],
			videoOptions: {
				defaultDurationSeconds: 5,
				defaultResolution: "720p",
				maxDurationSeconds: 8,
				durationOptions: [
					{ value: 5, label: "5s", priceLabel: null },
					{ value: 8, label: "8s", priceLabel: null },
				],
				resolutionOptions: [
					{ value: "720p", label: "720p", priceLabel: null },
					{ value: "1080p", label: "1080p", priceLabel: null },
				],
			},
		});
	});

	it("uses exact live video capabilities instead of stale product-catalog specs", () => {
		const model = createModel({
			modelKey: "doubao-seedance-2.5",
			modelAlias: "doubao-seedance-2.5",
			vendorKey: "ark",
			labelZh: "Seedance 2.5",
			kind: "video",
			enabled: true,
			meta: {
				useCases: ["章节成片"],
				videoOptions: {
					resolutionOptions: [{ value: "480p", label: "480p" }],
					supportsNativeAudio: false,
				},
			},
		});
		const summary = buildPublicChatEnabledModelCatalogSummaryFromModels(
			[model],
			new Map([["ark", { system: true, user: false }]]),
			[{
				modelName: "doubao-seedance-2.5",
				requestModelKey: "doubao-seedance-2.5",
				routingAliases: [],
				meta: {
					videoOptions: {
						resolutionOptions: [{ value: "720p", label: "720p" }],
						sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
						maxReferenceImages: 30,
						maxReferenceAudios: 10,
						maxReferenceAudioDurationSeconds: 30.2,
						supportsReferenceImages: true,
						supportsReferenceAudios: true,
						supportsNativeAudio: true,
					},
				},
			}],
		);

		expect(summary.videoModels[0]?.videoOptions).toMatchObject({
			resolutionOptions: [{ value: "720p", label: "720p", priceLabel: null }],
			sizeOptions: [{ value: "16:9", label: "16:9", aspectRatio: "16:9" }],
			maxReferenceImages: 30,
			maxReferenceAudios: 10,
			maxReferenceAudioDurationSeconds: 30.2,
			supportsReferenceImages: true,
			supportsReferenceAudios: true,
			supportsNativeAudio: true,
		});
		expect(summary.videoModels[0]?.videoOptions?.resolutionOptions)
			.not.toContainEqual(expect.objectContaining({ value: "480p" }));
	});

	it("separates live finishing processors from selectable generation models", () => {
		const finishingModel = createModel({
			modelKey: "volc-enhance-video",
			modelAlias: "volc-enhance-video",
			vendorKey: "volc",
			labelZh: "视频画质增强",
			kind: "video",
			enabled: true,
		});
		const summary = buildPublicChatEnabledModelCatalogSummaryFromModels(
			[finishingModel],
			new Map([["volc", { system: true, user: false }]]),
			[{
				modelName: "volc-enhance-video",
				requestModelKey: "volc-enhance-video",
				routingAliases: [],
				meta: {
					runtimeParameters: [
						{
							key: "toolVersion",
							type: "enum",
							label: "版本",
							default: "standard",
							options: [
								{ value: "standard", label: "标准版" },
								{ value: "professional", label: "专业版" },
							],
						},
						{
							key: "resolution",
							type: "enum",
							label: "分辨率",
							default: "1080p",
							options: [
								{ value: "1080p", label: "1080P" },
								{ value: "4k", label: "4K" },
							],
						},
					],
				},
			}],
		);

		expect(summary.videoModels).toEqual([]);
		expect(summary.videoFinishingModels).toEqual([{
			modelKey: "volc-enhance-video",
			label: "视频画质增强",
			parameters: [
				expect.objectContaining({
					key: "toolVersion",
					defaultValue: "standard",
					options: [
						{ value: "standard", label: "标准版" },
						{ value: "professional", label: "专业版" },
					],
				}),
				expect.objectContaining({
					key: "resolution",
					defaultValue: "1080p",
				}),
			],
		}]);
	});

	it("sorts models by pricing descending so premium models appear first", () => {
		const summary = buildPublicChatEnabledModelCatalogSummaryFromModels(
			[
				createModel({
					modelKey: "image-fast",
					modelAlias: "image-fast",
					vendorKey: "gemini",
					labelZh: "Fast",
					kind: "image",
					enabled: true,
					pricing: { cost: 4, enabled: true, specCosts: [] },
				}),
				createModel({
					modelKey: "image-pro",
					modelAlias: "image-pro",
					vendorKey: "gemini",
					labelZh: "Pro",
					kind: "image",
					enabled: true,
					pricing: { cost: 15, enabled: true, specCosts: [] },
				}),
			],
			new Map([["gemini", { system: true, user: false }]]),
		);

		expect(summary.imageModels.map((item) => item.modelAlias)).toEqual([
			"image-pro",
			"image-fast",
		]);
	});
});
