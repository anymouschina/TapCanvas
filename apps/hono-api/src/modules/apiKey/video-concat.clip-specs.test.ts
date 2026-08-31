import { describe, expect, it } from "vitest";

import { normalizeClipSpecs } from "./video-concat";

describe("normalizeClipSpecs", () => {
	it("accepts plain URL strings unchanged", () => {
		expect(normalizeClipSpecs(["https://a/1.mp4", "https://a/2.mp4"])).toEqual([
			{ url: "https://a/1.mp4", inSec: undefined, outSec: undefined },
			{ url: "https://a/2.mp4", inSec: undefined, outSec: undefined },
		]);
	});

	it("accepts rich specs with trim ranges and repeated source urls", () => {
		const out = normalizeClipSpecs([
			{ url: "https://a/long.mp4", inSec: 0, outSec: 2 },
			{ url: "https://a/long.mp4", inSec: 7.2, outSec: 7.5 },
		]);
		expect(out[0]).toEqual({ url: "https://a/long.mp4", inSec: 0, outSec: 2 });
		expect(out[1]).toEqual({ url: "https://a/long.mp4", inSec: 7.2, outSec: 7.5 });
	});

	it("rejects a missing url", () => {
		expect(() => normalizeClipSpecs([{ url: "  " }, "https://a/2.mp4"])).toThrow(/clips\[0\]/);
	});

	it("rejects negative inSec and non-positive outSec", () => {
		expect(() =>
			normalizeClipSpecs([{ url: "https://a/1.mp4", inSec: -1 }, "https://a/2.mp4"]),
		).toThrow(/clips\[0\].*inSec/);
		expect(() =>
			normalizeClipSpecs([{ url: "https://a/1.mp4", outSec: 0 }, "https://a/2.mp4"]),
		).toThrow(/clips\[0\].*outSec/);
	});

	it("rejects a trim window shorter than 0.1s", () => {
		expect(() =>
			normalizeClipSpecs([{ url: "https://a/1.mp4", inSec: 2, outSec: 2.05 }, "https://a/2.mp4"]),
		).toThrow(/clips\[0\].*0\.1s/);
	});

	it("carries a valid xfade transition through", () => {
		const out = normalizeClipSpecs([
			"https://a/1.mp4",
			{ url: "https://a/2.mp4", transition: "slideup" },
		]);
		expect(out[1].transition).toBe("slideup");
	});

	it("rejects an unknown transition at the api boundary", () => {
		expect(() =>
			normalizeClipSpecs(["https://a/1.mp4", { url: "https://a/2.mp4", transition: "swirl" }]),
		).toThrow(/clips\[1\].*transition/);
	});
});
