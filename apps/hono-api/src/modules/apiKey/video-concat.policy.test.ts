import { describe, expect, it } from "vitest";

import {
	resolveVideoConcatPolicy,
	validateVideoConcatTransitions,
} from "./video-concat.policy";

const supported = (transition: string): boolean =>
	transition === "fade" || transition === "slideup";

describe("video concat policy", () => {
	it("uses lossless-timeline hard cuts and no automatic color rewrite by default", () => {
		expect(resolveVideoConcatPolicy({})).toEqual({
			joinMode: "hard_cut",
			xfadeSeconds: 0,
			colorMatch: false,
		});
	});

	it("accepts explicit transition and color policies", () => {
		expect(resolveVideoConcatPolicy({
			requestedXfadeSeconds: 0.35,
			requestedColorMatch: true,
		})).toEqual({
			joinMode: "xfade",
			xfadeSeconds: 0.35,
			colorMatch: true,
		});
	});

	it("fails invalid configuration instead of silently changing concat behavior", () => {
		expect(() => resolveVideoConcatPolicy({ environmentXfadeSeconds: "automatic" }))
			.toThrow("video_concat_xfade_config_invalid");
		expect(() => resolveVideoConcatPolicy({ environmentColorMatch: "sometimes" }))
			.toThrow("video_concat_color_match_config_invalid");
	});

	it("requires an explicit supported transition on every xfade seam", () => {
		const policy = resolveVideoConcatPolicy({ requestedXfadeSeconds: 0.4 });
		expect(() => validateVideoConcatTransitions({
			clips: [{}, {}],
			policy,
			isSupportedTransition: supported,
		})).toThrow("clips[1]: transition is required");
		expect(() => validateVideoConcatTransitions({
			clips: [{}, { transition: "spin" }],
			policy,
			isSupportedTransition: supported,
		})).toThrow("clips[1]: unsupported transition");
		expect(() => validateVideoConcatTransitions({
			clips: [{}, { transition: "slideup" }],
			policy,
			isSupportedTransition: supported,
		})).not.toThrow();
	});

	it("does not silently ignore transition metadata in hard-cut mode", () => {
		const policy = resolveVideoConcatPolicy({});
		expect(() => validateVideoConcatTransitions({
			clips: [{}, { transition: "fade" }],
			policy,
			isSupportedTransition: supported,
		})).toThrow("transition requires an explicit positive xfadeSeconds");
	});
});
