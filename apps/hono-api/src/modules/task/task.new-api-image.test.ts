import { describe, expect, it } from "vitest";

import {
	buildNewApiImageGenerationBody,
	buildNewApiImageRequestShape,
	collectTaskAssetInputImageUrls,
	collectTaskImageOperationReferenceUrls,
	collectTaskReferenceImageUrls,
	convertMessagesToResponsesInput,
	canonicalizeNewApiModelKey,
	extractTextFromOpenAIResponseForTask,
	extractNewApiImageAssets,
	parseOpenAIResponsesSseTextForTask,
	resolveImageLayerDecompositionOptions,
	resolveTaskImageOperationSpec,
	resolveTaskMaskUrl,
} from "./task.service";
import { createImageOperationSpec } from "@tapcanvas/image-operation-protocol";

describe("extractNewApiImageAssets", () => {
	it("extracts gemini inlineData images from candidates payloads", () => {
		const assets = extractNewApiImageAssets({
			candidates: [
				{
					content: {
						parts: [
							{
								inlineData: {
									mimeType: "image/jpeg",
									data: "YWJjMTIz",
								},
								thoughtSignature: "ignored",
							},
						],
					},
				},
			],
		});

		expect(assets).toEqual([
			{
				type: "image",
				url: "data:image/jpeg;base64,YWJjMTIz",
				thumbnailUrl: null,
			},
		]);
	});

	it("still extracts legacy new-api data urls", () => {
		const assets = extractNewApiImageAssets({
			data: [{ b64_json: "ZGVmNDU2" }],
		});

		expect(assets).toEqual([
			{
				type: "image",
				url: "data:image/png;base64,ZGVmNDU2",
				thumbnailUrl: null,
			},
		]);
	});

	it("extracts every RGBA layer returned by Qwen Image Layered", () => {
		const assets = extractNewApiImageAssets({
			images: [
				{ url: "https://fal.media/layer-1.png", content_type: "image/png" },
				{ url: "https://fal.media/layer-2.png", content_type: "image/png" },
			],
		});

		expect(assets.map((asset) => asset.url)).toEqual([
			"https://fal.media/layer-1.png",
			"https://fal.media/layer-2.png",
		]);
	});
});

describe("buildNewApiImageGenerationBody", () => {
	it("maps a simple image generation request to /images/generations JSON shape", () => {
		const body = buildNewApiImageGenerationBody({
			model: "doubao-seedream-5-0-260128",
			prompt: "single image edit",
		});

		expect(body).toEqual({
			model: "doubao-seedream-5-0-260128",
			prompt: "single image edit",
			n: 1,
			response_format: "url",
		});
	});

	it("所有模型都逐字透传 agents 生成的 prompt，不在 Hono 追加语义后缀", () => {
		const gpt = buildNewApiImageGenerationBody({
			model: "gpt-image-2",
			prompt: "角色设定图 三视图",
		});
		expect(gpt.prompt).toBe("角色设定图 三视图");
		const doubao = buildNewApiImageGenerationBody({
			model: "doubao-seedream-5-0-260128",
			prompt: "角色设定图 三视图",
		});
		expect(doubao.prompt).toBe("角色设定图 三视图");
	});

	it("maps multi-reference image edit onto the canonical new-api image reference shape", () => {
		const body = buildNewApiImageGenerationBody({
			model: "doubao-seedream-5-0-260128",
			prompt: "multi image edit",
			size: "1280x720",
			negativePrompt: "no blur",
			seed: 7,
			referenceImages: ["https://example.com/one.jpg", "https://example.com/two.png"],
		});

		expect(body).toEqual({
			model: "doubao-seedream-5-0-260128",
			prompt: "multi image edit",
			n: 1,
			response_format: "url",
			size: "1280x720",
			negative_prompt: "no blur",
			seed: 7,
			images: [
				{ image_url: "https://example.com/one.jpg" },
				{ image_url: "https://example.com/two.png" },
			],
		});
	});

	it("maps validated layer decomposition options to the provider request", () => {
		const layerDecomposition = resolveImageLayerDecompositionOptions({
			imageOperation: "layer_decompose",
			numLayers: 8,
			numInferenceSteps: 30,
			guidanceScale: 6,
		});
		const body = buildNewApiImageGenerationBody({
			model: "fal-ai/qwen-image-layered",
			prompt: "Decompose the image into editable RGBA layers.",
			referenceImages: ["https://example.com/source.png"],
			layerDecomposition: layerDecomposition ?? undefined,
		});

		expect(body).toMatchObject({
			model: "fal-ai/qwen-image-layered",
			image_url: "https://example.com/source.png",
			num_layers: 8,
			num_inference_steps: 30,
			guidance_scale: 6,
			output_format: "png",
		});
	});
});

describe("buildNewApiImageRequestShape", () => {
	it("uses catalog defaults for the exact resolution and quality billing dimensions", () => {
		expect(
			buildNewApiImageRequestShape({
				req: {
					kind: "text_to_image",
					prompt: "an apple",
					extras: {},
				},
				imageOptions: {
					aspectRatioOptions: ["1:1", "16:9"],
					imageSizeOptions: ["1K", "2K", "4K"],
					resolutionOptions: [],
					qualityOptions: ["low", "medium", "high"],
					defaultAspectRatio: "1:1",
					defaultImageSize: "1K",
					defaultQuality: "low",
				},
			}),
		).toMatchObject({
			size: "1:1",
			resolution: "1K",
			quality: "low",
			metadata: { aspectRatio: "1:1", imageSize: "1K" },
		});
	});
});

describe("collectTaskReferenceImageUrls", () => {
	it("includes singular imageUrl fields for vision tasks", () => {
		expect(
			collectTaskReferenceImageUrls({
				imageUrl: "https://example.com/style.png",
				image_url: "https://example.com/duplicate.png",
				referenceImages: ["https://example.com/ref.png"],
			}),
		).toEqual([
			"https://example.com/ref.png",
			"https://example.com/style.png",
			"https://example.com/duplicate.png",
		]);
	});
});

describe("resolveTaskMaskUrl", () => {
	it("prefers explicit extras.maskUrl when present", () => {
		expect(
			resolveTaskMaskUrl({
				maskUrl: "https://example.com/mask.png",
				assetInputs: [{ role: "mask", url: "https://example.com/other-mask.png" }],
			}),
		).toBe("https://example.com/mask.png");
	});

	it("falls back to assetInputs role=mask", () => {
		expect(
			resolveTaskMaskUrl({
				assetInputs: [
					{ role: "reference", url: "https://example.com/ref.png" },
					{ role: "mask", url: "https://example.com/mask.png" },
				],
			}),
		).toBe("https://example.com/mask.png");
	});

	it("reads the independent mask from the structured image operation contract", () => {
		const imageOperationSpec = createImageOperationSpec({
			kind: "inpaint",
			execution: "image-edit",
			sourceNodeId: "source-1",
			inputs: [
				{ role: "source", url: "https://example.com/source.png" },
				{ role: "mask", url: "https://example.com/mask.png" },
			],
		});
		expect(resolveTaskMaskUrl({ imageOperationSpec })).toBe("https://example.com/mask.png");
		expect(resolveTaskImageOperationSpec({ imageOperationSpec })?.kind).toBe("inpaint");
	});

	it("rejects legacy mask fields that disagree with the operation contract", () => {
		const imageOperationSpec = createImageOperationSpec({
			kind: "erase",
			execution: "image-edit",
			sourceNodeId: "source-1",
			inputs: [
				{ role: "source", url: "https://example.com/source.png" },
				{ role: "mask", url: "https://example.com/contract-mask.png" },
			],
		});
		expect(() => resolveTaskMaskUrl({
			imageOperationSpec,
			maskUrl: "https://example.com/stale-mask.png",
		})).toThrow("图片操作合同与旧蒙版字段冲突");
	});
});

describe("collectTaskImageOperationReferenceUrls", () => {
	it("uses the contract source first and excludes the mask", () => {
		const imageOperationSpec = createImageOperationSpec({
			kind: "outpaint",
			execution: "image-edit",
			sourceNodeId: "source-1",
			inputs: [
				{ role: "source", url: "https://example.com/expanded-source.png" },
				{ role: "mask", url: "https://example.com/outpaint-mask.png" },
				{ role: "reference", url: "https://example.com/original.png" },
			],
		});
		expect(collectTaskImageOperationReferenceUrls({ imageOperationSpec })).toEqual([
			"https://example.com/expanded-source.png",
			"https://example.com/original.png",
		]);
	});
});

describe("image operation request metadata", () => {
	it("keeps operation identity in the provider request shape", () => {
		const imageOperationSpec = createImageOperationSpec({
			kind: "upscale",
			execution: "image-edit",
			sourceNodeId: "source-1",
			inputs: [{ role: "source", url: "https://example.com/source.png" }],
			parameters: { scale: 4, targetResolution: "4K" },
		});
		const shape = buildNewApiImageRequestShape({
			req: {
				kind: "image_edit",
				prompt: "upscale",
				extras: { imageOperationSpec, resolution: "4K" },
			},
			imageOptions: {
				aspectRatioOptions: [],
				imageSizeOptions: ["1K", "2K", "4K"],
				resolutionOptions: ["1K", "2K", "4K"],
				qualityOptions: [],
			},
		});
		expect(shape.metadata).toMatchObject({
			imageOperation: "upscale",
			imageOperationId: imageOperationSpec.operationId,
			imageOperationSchemaVersion: 1,
			imageOperationSourceRevision: 1,
			imageOperationParameters: { scale: 4, targetResolution: "4K" },
			imageOperationOutput: { mediaType: "image", count: 1 },
		});
	});
});

describe("convertMessagesToResponsesInput", () => {
	it("converts chat image_url parts to responses input_image parts", () => {
		expect(
			convertMessagesToResponsesInput([
				{
					role: "user",
					content: [
						{ type: "text", text: "describe this image" },
						{
							type: "image_url",
							image_url: { url: "https://example.com/style.png" },
						},
					],
				},
			]),
		).toEqual([
			{
				role: "user",
				content: [
					{ type: "input_text", text: "describe this image" },
					{ type: "input_image", image_url: "https://example.com/style.png" },
				],
			},
		]);
	});
});

describe("OpenAI responses text extraction for task results", () => {
	it("extracts top-level string output_text from responses payloads", () => {
		expect(
			extractTextFromOpenAIResponseForTask({
				id: "resp_text",
				status: "completed",
				output_text: "A usable prompt.",
				output: [],
			}),
		).toBe("A usable prompt.");
	});

	it("collects streamed output_text deltas into a synchronous task response", () => {
		const parsed = parseOpenAIResponsesSseTextForTask(
			[
				"event: response.created",
				'data: {"type":"response.created","response":{"id":"resp_stream","status":"in_progress","output":[]}}',
				"",
				"event: response.output_text.delta",
				'data: {"type":"response.output_text.delta","delta":"A usable "}',
				"",
				"event: response.output_text.delta",
				'data: {"type":"response.output_text.delta","delta":"prompt."}',
				"",
				"event: response.completed",
				'data: {"type":"response.completed","response":{"id":"resp_stream","status":"completed","output":[]}}',
				"",
			].join("\n"),
		);

		expect(parsed.id).toBe("resp_stream");
		expect(parsed.status).toBe("completed");
		expect(extractTextFromOpenAIResponseForTask(parsed)).toBe("A usable prompt.");
	});
});

describe("canonicalizeNewApiModelKey", () => {
	it("strips apimart alias suffix before relaying to new-api", () => {
		expect(canonicalizeNewApiModelKey("apimart", "gpt-image-2-apimart")).toBe("gpt-image-2");
	});

	it("keeps canonical model keys unchanged", () => {
		expect(canonicalizeNewApiModelKey("apimart", "gpt-image-2")).toBe("gpt-image-2");
	});

	it("does not rewrite other vendors implicitly", () => {
		expect(canonicalizeNewApiModelKey("wuyinkeji", "gpt-image-2-suchuang")).toBe(
			"gpt-image-2-suchuang",
		);
	});
});

describe("collectTaskAssetInputImageUrls", () => {
	it("收集 assetInputs 的图片 URL（2026-07-16 根因：风格图在 vendor 层被丢导致画风锚失效）", () => {
		expect(
			collectTaskAssetInputImageUrls({
				assetInputs: [
					{ url: "https://cdn.example.com/style.jpg", role: "style" },
					{ url: "https://cdn.example.com/style.jpg", role: "style" }, // 去重
					{ url: "asset://ark/abc", role: "reference" },
					{ url: "not-a-url", role: "style" }, // 非法丢弃
					"garbage",
					{ role: "style" }, // 无 url 丢弃
				],
			}),
		).toEqual(["https://cdn.example.com/style.jpg", "asset://ark/abc"]);
	});

	it("assetInputs 缺失/非数组时返回空", () => {
		expect(collectTaskAssetInputImageUrls({})).toEqual([]);
		expect(collectTaskAssetInputImageUrls({ assetInputs: "x" })).toEqual([]);
	});
});
