import { describe, expect, it } from "vitest";

import type { ModelCatalogModelDto } from "./model-catalog.schemas";
import { buildPublicChatEnabledModelCatalogSummaryFromModels } from "./model-catalog.public-chat-summary";

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
