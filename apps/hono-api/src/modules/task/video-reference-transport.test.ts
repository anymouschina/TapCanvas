import { describe, expect, it } from "vitest";
import type { AppContext } from "../../types";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { encodeReferenceWithinLimit, replaceReferenceTransportUrls, prepareVideoReferenceTransport } from "./video-reference-transport";

describe("video reference transport", () => {
	it("preserves provider-hosted asset handles without downloading or rehosting", async () => {
		const extras = { referenceImages: ["asset://registered-image"] };
		const c = { env: { VIDEO_REFERENCE_MAX_BYTES: "10485760" } } as unknown as AppContext;
		expect(await prepareVideoReferenceTransport({ c, urls: extras.referenceImages, extras })).toBe(extras);
	});
	it("preserves all reference identities and roles across the provider manifest", () => {
		const original = { referenceImages: ["https://a/large.png", "https://a/small.png"], firstFrameUrl: "https://a/large.png",
			referenceMediaManifest: { images: [{ url: "https://a/large.png", role: "first_frame", assetId: "asset-1" }, { url: "https://a/small.png", role: "reference_image", assetId: "asset-2" }] },
			prompt: "Use https://a/large.png as reference" };
		const mapped = replaceReferenceTransportUrls(original, new Map([["https://a/large.png", "https://a/derived.jpg"]]));
		expect(mapped).toEqual({ ...original, referenceImages: ["https://a/derived.jpg", "https://a/small.png"], firstFrameUrl: "https://a/derived.jpg",
			referenceMediaManifest: { images: [{ url: "https://a/derived.jpg", role: "first_frame", assetId: "asset-1" }, { url: "https://a/small.png", role: "reference_image", assetId: "asset-2" }] } });
		expect(original.firstFrameUrl).toBe("https://a/large.png");
	});
	it("returns small input byte-for-byte", async () => {
		const input = Buffer.from("unchanged");
		expect(await encodeReferenceWithinLimit(input, 100)).toBe(input);
	});
	it("encodes an oversized valid image within the byte limit without cropping", async () => {
		const canvas = createCanvas(600, 300);
		const context = canvas.getContext("2d");
		const image = context.createImageData(600, 300);
		let state = 7;
		for (let i = 0; i < image.data.length; i += 4) {
			state = (state * 1664525 + 1013904223) >>> 0;
			image.data[i] = state & 255; image.data[i + 1] = (state >>> 8) & 255; image.data[i + 2] = (state >>> 16) & 255; image.data[i + 3] = 255;
		}
		context.putImageData(image, 0, 0);
		const original = canvas.toBuffer("image/png");
		expect(original.length).toBeGreaterThan(350_000);
		const encoded = await encodeReferenceWithinLimit(original, 350_000);
		expect(encoded.length).toBeLessThanOrEqual(350_000);
		const decoded = await loadImage(encoded);
		expect(decoded.width / decoded.height).toBe(2);
	});
});
