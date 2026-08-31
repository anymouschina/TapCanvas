import { describe, expect, it } from "vitest";
import {
	adjustKlingV3BillingSpecKey,
	buildKlingV3ImageContentItems,
	collectKlingStructuredReferenceUrls,
	isKlingV3FamilyVideoModel,
	isKlingV3OmniVideoModel,
	isKlingV3ReferenceVideoModel,
	normalizeKlingVideoReferType,
} from "./task.kling-v3";

describe("normalizeKlingVideoReferType", () => {
	it("accepts feature/base (trim + case-insensitive)", () => {
		expect(normalizeKlingVideoReferType("feature")).toBe("feature");
		expect(normalizeKlingVideoReferType(" FEATURE ")).toBe("feature");
		expect(normalizeKlingVideoReferType("base")).toBe("base");
	});

	it("returns null when unset/invalid so callers skip metadata injection (零回归)", () => {
		for (const value of [undefined, null, "", "motion", 1, true, {}]) {
			expect(normalizeKlingVideoReferType(value), String(value)).toBe(null);
		}
	});
});

describe("isKlingV3FamilyVideoModel", () => {
	it("matches kling-v3 / kling-v3-omni incl. vendor suffixes, case-insensitive", () => {
		for (const model of [
			"kling-v3",
			"kling-v3-apimart",
			"kling-v3-omni",
			"kling-v3-omni-apimart",
			"KLING-V3-OMNI",
			" kling-v3-omni ",
			"kling-o3",
			"kling-v3-funai",
			"kling-o3-funai",
		]) {
			expect(isKlingV3FamilyVideoModel(model), model).toBe(true);
		}
	});

	it("rejects motion-control, older klings and other vendors", () => {
		for (const model of [
			"kling-v3-motion-control",
			"kling-v3-motion-control-apimart",
			"kling-v2-6",
			"kling-video-o1",
			"pixverse-v6",
			"doubao-seedance-2-0-260128",
			"",
		]) {
			expect(isKlingV3FamilyVideoModel(model), model).toBe(false);
		}
	});

	it("omni detection excludes plain kling-v3", () => {
		expect(isKlingV3OmniVideoModel("kling-v3-omni-apimart")).toBe(true);
		expect(isKlingV3OmniVideoModel("kling-v3")).toBe(false);
	});

	it("source-video detection includes the merged public kling-v3", () => {
		expect(isKlingV3ReferenceVideoModel("kling-v3")).toBe(true);
		expect(isKlingV3ReferenceVideoModel("kling-v3-funai")).toBe(true);
		expect(isKlingV3ReferenceVideoModel("kling-v3-omni-apimart")).toBe(true);
		expect(isKlingV3ReferenceVideoModel("kling-o3")).toBe(false);
		expect(isKlingV3ReferenceVideoModel("kling-o3-funai")).toBe(false);
	});
});

describe("collectKlingStructuredReferenceUrls", () => {
	it("keeps explicit http(s) references, aliases and order without duplicates", () => {
		expect(
			collectKlingStructuredReferenceUrls(
				["https://x/style.png", "asset://local", "https://x/style.png"],
				"http://x/element.png",
			),
		).toEqual(["https://x/style.png", "http://x/element.png"]);
	});
});

describe("buildKlingV3ImageContentItems", () => {
	it("marks first/last frame roles and dedupes refs", () => {
		const items = buildKlingV3ImageContentItems({
			refs: ["https://x/first.png", "https://x/last.png", "https://x/ref.png"],
			firstFrameUrl: "https://x/first.png",
			lastFrameUrl: "https://x/last.png",
		});
		expect(items).toEqual([
			{ type: "image_url", image_url: { url: "https://x/first.png" }, role: "first_frame" },
			{ type: "image_url", image_url: { url: "https://x/last.png" }, role: "last_frame" },
			{ type: "image_url", image_url: { url: "https://x/ref.png" }, role: "reference_image" },
		]);
	});

	it("treats identical first/last frame as first frame only", () => {
		const items = buildKlingV3ImageContentItems({
			refs: ["https://x/same.png"],
			firstFrameUrl: "https://x/same.png",
			lastFrameUrl: "https://x/same.png",
		});
		expect(items).toEqual([
			{ type: "image_url", image_url: { url: "https://x/same.png" }, role: "first_frame" },
		]);
	});

	it("plain refs become reference_image; non-http refs (asset://) are skipped", () => {
		const items = buildKlingV3ImageContentItems({
			refs: ["https://x/a.png", "asset://ark-only", "https://x/a.png"],
		});
		expect(items).toEqual([
			{ type: "image_url", image_url: { url: "https://x/a.png" }, role: "reference_image" },
		]);
	});
});

describe("adjustKlingV3BillingSpecKey", () => {
	it("rewrites to +sound tier when audio is on", () => {
		expect(
			adjustKlingV3BillingSpecKey({
				model: "kling-v3-omni",
				specKey: "video:720p:5s",
				audio: true,
				hasVideoReference: false,
			}),
		).toBe("video:720p+sound:5s");
		expect(
			adjustKlingV3BillingSpecKey({
				model: "kling-v3-apimart",
				specKey: "video:4k:10s",
				audio: true,
				hasVideoReference: false,
			}),
		).toBe("video:4k+sound:10s");
	});

	it("rewrites to +video tier for merged public v3 and omni video reference (video wins over audio)", () => {
		expect(
			adjustKlingV3BillingSpecKey({
				model: "kling-v3-omni-apimart",
				specKey: "video:1080p:8s",
				audio: true,
				hasVideoReference: true,
			}),
		).toBe("video:1080p+video:8s");
		expect(
			adjustKlingV3BillingSpecKey({
				model: "kling-v3-funai",
				specKey: "video:720p:5s",
				audio: false,
				hasVideoReference: true,
			}),
		).toBe("video:720p+video:5s");
	});

	it("keeps base tier for 4k video reference and leaves kling-o3 on its own price contract", () => {
		expect(
			adjustKlingV3BillingSpecKey({
				model: "kling-v3-omni",
				specKey: "video:4k:5s",
				audio: false,
				hasVideoReference: true,
			}),
		).toBe("video:4k:5s");
		expect(adjustKlingV3BillingSpecKey({
			model: "kling-o3",
			specKey: "video:720p:5s",
			audio: true,
			hasVideoReference: true,
		})).toBe("video:720p:5s");
	});

	it("is idempotent and leaves non-standard keys / other models untouched", () => {
		expect(
			adjustKlingV3BillingSpecKey({
				model: "kling-v3-omni",
				specKey: "video:720p+sound:5s",
				audio: true,
				hasVideoReference: false,
			}),
		).toBe("video:720p+sound:5s");
		expect(
			adjustKlingV3BillingSpecKey({
				model: "pixverse-v6",
				specKey: "video:720p:5s",
				audio: true,
				hasVideoReference: false,
			}),
		).toBe("video:720p:5s");
		expect(
			adjustKlingV3BillingSpecKey({
				model: "kling-v3-omni",
				specKey: null,
				audio: true,
				hasVideoReference: false,
			}),
		).toBeNull();
	});
});
