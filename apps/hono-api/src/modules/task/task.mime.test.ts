import { describe, expect, it } from "vitest";

import {
	canContainPadMimeType,
	isSupportedImageMimeType,
	isSupportedMappedVideoReferenceMimeType,
	normalizeMimeType,
} from "./task.mime";

describe("task mime helpers", () => {
	it("normalizes mime types case-insensitively", () => {
		expect(normalizeMimeType("Image/JPEG; charset=utf-8")).toBe("image/jpeg");
		expect(normalizeMimeType(" IMAGE/PNG ")).toBe("image/png");
	});

	it("accepts only real image mime types for contain-pad", () => {
		expect(canContainPadMimeType("image/png")).toBe(true);
		expect(canContainPadMimeType("IMAGE/WEBP")).toBe(true);
		expect(canContainPadMimeType("video/mp4")).toBe(false);
	});

	it("accepts mp4 only for mapped video input references", () => {
		expect(isSupportedImageMimeType("Image/JPEG")).toBe(true);
		expect(isSupportedMappedVideoReferenceMimeType("video/mp4")).toBe(true);
		expect(isSupportedMappedVideoReferenceMimeType("VIDEO/MP4")).toBe(true);
		expect(isSupportedMappedVideoReferenceMimeType("application/pdf")).toBe(false);
	});
});
