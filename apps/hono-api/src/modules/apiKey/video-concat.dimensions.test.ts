import { describe, expect, it } from "vitest";

import { resolveTargetDims } from "./video-concat";

describe("video concat target dimensions", () => {
	it("preserves the source short side when an aspect ratio is supplied", () => {
		expect(resolveTargetDims("16:9", { w: 864, h: 496 })).toEqual({ w: 882, h: 496 });
		expect(resolveTargetDims("9:16", { w: 496, h: 864 })).toEqual({ w: 496, h: 882 });
		expect(resolveTargetDims("16:9", { w: 1280, h: 720 })).toEqual({ w: 1280, h: 720 });
	});

	it("uses the 1080 short-side fallback only when the source cannot be probed", () => {
		expect(resolveTargetDims("16:9", null)).toEqual({ w: 1920, h: 1080 });
		expect(resolveTargetDims("9:16", null)).toEqual({ w: 1080, h: 1920 });
	});

	it("keeps the probed source dimensions when the aspect is absent or invalid", () => {
		expect(resolveTargetDims(undefined, { w: 1279, h: 721 })).toEqual({ w: 1280, h: 722 });
		expect(resolveTargetDims("invalid", { w: 864, h: 496 })).toEqual({ w: 864, h: 496 });
	});
});
