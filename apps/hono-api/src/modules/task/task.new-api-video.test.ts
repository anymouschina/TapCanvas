import { describe, expect, it } from "vitest";
import {
	buildNewApiVideoRequestShape,
	extractNewApiVideoAssets,
	isDirectNewApiVideoReferenceUrl,
} from "./task.service";
import { RunTaskRequestSchema } from "./task.schemas";

describe("extractNewApiVideoAssets", () => {
	it("accepts public task requests without a vendor field", () => {
		const parsed = RunTaskRequestSchema.safeParse({
			request: {
				kind: "text_to_video",
				prompt: "动起来",
				extras: {
					modelKey: "veo_3_1",
				},
			},
		});

		expect(parsed.success).toBe(true);
	});

	it("extracts video urls from new-api ark result metadata", () => {
		const assets = extractNewApiVideoAssets({
			provider: "new_api",
			response: {
				metadata: {
					url: "https://cdn.example.com/from-response-metadata.mp4",
				},
			},
		});

		expect(assets).toEqual([
			{
				type: "video",
				url: "https://cdn.example.com/from-response-metadata.mp4",
				thumbnailUrl: null,
			},
		]);
	});

	it("extracts video urls from task log shaped payloads", () => {
		const assets = extractNewApiVideoAssets({
			result_url: "https://cdn.example.com/from-result-url.mp4",
			data: {
				content: {
					video_url: "https://cdn.example.com/from-data-content.mp4",
				},
			},
		});

		expect(assets).toEqual([
			{
				type: "video",
				url: "https://cdn.example.com/from-result-url.mp4",
				thumbnailUrl: null,
			},
			{
				type: "video",
				url: "https://cdn.example.com/from-data-content.mp4",
				thumbnailUrl: null,
			},
		]);
	});

	it("preserves semantic video params for image-to-video requests", () => {
		const requestShape = buildNewApiVideoRequestShape("apimart", {
			kind: "image_to_video",
			prompt: "围绕图片展开，一个美女",
			extras: {
				size: "16:9",
				aspectRatio: "16:9",
				resolution: "480p",
				orientation: "landscape",
			},
		});

		expect(requestShape).toEqual({
			size: "16:9",
			aspectRatio: "16:9",
			resolution: "480p",
		});
	});

	it("preserves semantic video params for non-APIMart vendors too", () => {
		const requestShape = buildNewApiVideoRequestShape("comfly", {
			kind: "text_to_video",
			prompt: "围绕图片展开，一个美女",
			extras: {
				size: "16:9",
				aspectRatio: "16:9",
				resolution: "480p",
				orientation: "landscape",
			},
		});

		expect(requestShape).toEqual({
			size: "16:9",
			aspectRatio: "16:9",
			resolution: "480p",
		});
	});

	it("uses explicit width and height only when semantic size is absent", () => {
		const requestShape = buildNewApiVideoRequestShape("comfly", {
			kind: "text_to_video",
			prompt: "围绕图片展开，一个美女",
			width: 1280,
			height: 720,
			extras: {
				resolution: "720p",
			},
		});

		expect(requestShape).toEqual({
			size: "1280x720",
			resolution: "720p",
		});
	});

	it("detects remote http reference urls for direct video relay", () => {
		expect(isDirectNewApiVideoReferenceUrl("https://example.com/reference.png")).toBe(true);
		expect(isDirectNewApiVideoReferenceUrl("http://example.com/reference.png")).toBe(true);
		expect(isDirectNewApiVideoReferenceUrl("data:image/png;base64,Zm9v")).toBe(false);
		expect(isDirectNewApiVideoReferenceUrl("/local/path.png")).toBe(false);
	});
});
