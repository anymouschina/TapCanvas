import { describe, expect, it } from "vitest";
import {
	buildYunwuKlingImageList,
	extractYunwuKlingTaskStatus,
	extractYunwuKlingVideoUrl,
	extractYunwuModelFromVendorRef,
	inferYunwuAspectRatio,
	isYunwuKlingOmniModel,
	normalizeYunwuKlingDurationSeconds,
} from "./task.yunwu-video";

describe("task.yunwu-video helpers", () => {
	it("recognizes kling omni models", () => {
		expect(isYunwuKlingOmniModel("kling-video-o1")).toBe(true);
		expect(isYunwuKlingOmniModel("kling-v3-omni")).toBe(true);
		expect(isYunwuKlingOmniModel("sora-2")).toBe(false);
	});

	it("extracts model names from stored yunwu vendor refs", () => {
		expect(extractYunwuModelFromVendorRef("yunwu-kling-video-o1")).toBe(
			"kling-video-o1",
		);
		expect(extractYunwuModelFromVendorRef("yunwu:kling-v3-omni")).toBe(
			"kling-v3-omni",
		);
		expect(extractYunwuModelFromVendorRef("yunwu")).toBeNull();
	});

	it("builds kling image_list with first/end frame and reference images", () => {
		expect(
			buildYunwuKlingImageList({
				kind: "text_to_video",
				firstFrameUrl: "https://example.com/first.png",
				lastFrameUrl: "https://example.com/last.png",
				referenceImages: [
					"https://example.com/first.png",
					"https://example.com/ref-a.png",
					"https://example.com/ref-b.png",
				],
			}),
		).toEqual([
			{
				image_url: "https://example.com/first.png",
				type: "first_frame",
			},
			{
				image_url: "https://example.com/last.png",
				type: "end_frame",
			},
			{
				image_url: "https://example.com/ref-a.png",
			},
			{
				image_url: "https://example.com/ref-b.png",
			},
		]);
	});

	it("treats the first reference image as first_frame for image_to_video", () => {
		expect(
			buildYunwuKlingImageList({
				kind: "image_to_video",
				referenceImages: [
					"https://example.com/source.png",
					"https://example.com/style.png",
				],
			}),
		).toEqual([
			{
				image_url: "https://example.com/source.png",
				type: "first_frame",
			},
			{
				image_url: "https://example.com/style.png",
			},
		]);
	});

	it("normalizes aspect ratio and duration constraints", () => {
		expect(
			inferYunwuAspectRatio({
				aspectRatio: "9:16",
				size: "1280x720",
				orientation: "landscape",
			}),
		).toBe("9:16");
		expect(
			inferYunwuAspectRatio({
				size: "720x1280",
				orientation: "landscape",
			}),
		).toBe("9:16");
		expect(
			normalizeYunwuKlingDurationSeconds({
				model: "kling-video-o1",
				durationSeconds: 10,
			}),
		).toBe(10);
		expect(() =>
			normalizeYunwuKlingDurationSeconds({
				model: "kling-video-o1",
				durationSeconds: 6,
			}),
		).toThrow("kling-video-o1");
	});

	it("extracts status and video url from kling query payloads", () => {
		const payload = {
			task_status: "processing",
			works: [
				{
					video: {
						url: "https://cdn.example.com/output.mp4",
					},
				},
			],
		};
		expect(extractYunwuKlingTaskStatus(payload)).toBe("processing");
		expect(extractYunwuKlingVideoUrl(payload)).toBe(
			"https://cdn.example.com/output.mp4",
		);
	});

	it("extracts nested task_result video urls from yunwu query payloads", () => {
		const payload = {
			data: {
				task_status: "succeed",
				task_result: {
					videos: [
						{
							url: "https://cdn.example.com/nested-output.mp4",
						},
					],
				},
			},
		};
		expect(extractYunwuKlingTaskStatus(payload)).toBe("succeed");
		expect(extractYunwuKlingVideoUrl(payload)).toBe(
			"https://cdn.example.com/nested-output.mp4",
		);
	});
});
