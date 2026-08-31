import { describe, expect, it } from "vitest";

import {
	buildColorCorrections,
	buildSinglePassConcatArgs,
	floorToFrameGrid,
	TARGET_FPS,
	type ClipMeta,
} from "./video-concat.filtergraph";

const DIMS = { w: 1080, h: 1920 };

function clip(over: Partial<ClipMeta> = {}): ClipMeta {
	return {
		durationSec: 10,
		hasAudio: true,
		yuv: null,
		transition: "fade",
		...over,
	};
}

function filterComplexOf(args: string[]): string {
	const i = args.indexOf("-filter_complex");
	expect(i).toBeGreaterThan(-1);
	return args[i + 1];
}

describe("floorToFrameGrid", () => {
	it("floors a duration onto the target fps frame grid", () => {
		expect(floorToFrameGrid(10.017)).toBeCloseTo(Math.floor(10.017 * TARGET_FPS) / TARGET_FPS, 6);
		expect(floorToFrameGrid(10)).toBeCloseTo(10, 6);
	});
});

describe("buildSinglePassConcatArgs", () => {
	it("returns null when xfade is disabled", () => {
		expect(
			buildSinglePassConcatArgs({
				clips: [clip(), clip()],
				dims: DIMS,
				xfadeSeconds: 0,
				colorMatch: false,
				outFile: "/tmp/out.mp4",
			}),
		).toBeNull();
	});

	it("returns null when any clip duration is unknown", () => {
		expect(
			buildSinglePassConcatArgs({
				clips: [clip(), clip({ durationSec: null })],
				dims: DIMS,
				xfadeSeconds: 0.4,
				colorMatch: false,
				outFile: "/tmp/out.mp4",
			}),
		).toBeNull();
	});

	it("returns null with fewer than 2 clips", () => {
		expect(
			buildSinglePassConcatArgs({
				clips: [clip()],
				dims: DIMS,
				xfadeSeconds: 0.4,
				colorMatch: false,
				outFile: "/tmp/out.mp4",
			}),
		).toBeNull();
	});

	it("builds one ffmpeg invocation that normalizes, crossfades and encodes in a single pass", () => {
		const args = buildSinglePassConcatArgs({
			clips: [clip({ durationSec: 10 }), clip({ durationSec: 8 })],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		});
		expect(args).not.toBeNull();
		const a = args as string[];
		// two file inputs via input-index placeholders resolved by caller order
		expect(a.filter((x) => x === "-i").length).toBe(2);
		const fc = filterComplexOf(a);
		// per-input normalization folded into the filter graph
		expect(fc).toContain(
			`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=${TARGET_FPS}[vn0]`,
		);
		expect(fc).toContain("[vn0][vn1]xfade=transition=fade:duration=0.400:offset=9.600[vout]");
		expect(fc).toContain("acrossfade=d=0.400[aout]");
		// audio pinned to the clip's video duration
		expect(fc).toContain("apad,atrim=duration=10.000");
		// single final encode
		expect(a).toContain("libx264");
		expect(a.indexOf("-map")).toBeGreaterThan(-1);
		expect(a[a.length - 1]).toBe("/tmp/out.mp4");
	});

	it("accumulates xfade offsets across 3 clips on the frame grid", () => {
		const args = buildSinglePassConcatArgs({
			clips: [clip({ durationSec: 10.017 }), clip({ durationSec: 8 }), clip({ durationSec: 6 })],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		}) as string[];
		const fc = filterComplexOf(args);
		const d0 = floorToFrameGrid(10.017);
		const off1 = (d0 - 0.4).toFixed(3);
		const off2 = (d0 + 8 - 0.8).toFixed(3);
		expect(fc).toContain(`xfade=transition=fade:duration=0.400:offset=${off1}[v1]`);
		expect(fc).toContain(`xfade=transition=fade:duration=0.400:offset=${off2}[vout]`);
	});

	it("synthesizes silent audio for clips without an audio stream", () => {
		const args = buildSinglePassConcatArgs({
			clips: [clip(), clip({ hasAudio: false, durationSec: 8 })],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		}) as string[];
		const fc = filterComplexOf(args);
		expect(fc).toContain("anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=8.000[an1]");
		expect(fc).not.toContain("[1:a]");
	});

	it("clamps the crossfade to 40% of the shortest clip", () => {
		const args = buildSinglePassConcatArgs({
			clips: [clip({ durationSec: 10 }), clip({ durationSec: 0.5 })],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		}) as string[];
		const fc = filterComplexOf(args);
		// 40% of 0.5s = 0.2s
		expect(fc).toContain("duration=0.200");
	});

	it("emits per-clip trim+setpts before normalization when trim is set", () => {
		const args = buildSinglePassConcatArgs({
			clips: [
				clip({ durationSec: 2, trim: { inSec: 1.5, outSec: 3.5 } }),
				clip({ durationSec: 8 }),
			],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		});
		expect(args).not.toBeNull();
		const fc = filterComplexOf(args as string[]);
		// video: trim to the source range, reset PTS, then normalize
		expect(fc).toContain(
			`[0:v]trim=start=1.500:end=3.500,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=${TARGET_FPS}[vn0]`,
		);
		// audio: same range, reset PTS, then pin to the effective duration
		expect(fc).toContain(
			"[0:a]atrim=start=1.500:end=3.500,asetpts=PTS-STARTPTS,aformat=sample_rates=44100:sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=2.000[an0]",
		);
		// untrimmed clip keeps the plain chains
		expect(fc).toContain(`[1:v]scale=1080:1920`);
		// xfade offset uses the effective (trimmed) duration: 2 - 0.4 = 1.6
		expect(fc).toContain("xfade=transition=fade:duration=0.400:offset=1.600[vout]");
	});

	it("trims silent clips through anullsrc duration only", () => {
		const args = buildSinglePassConcatArgs({
			clips: [
				clip(),
				clip({ hasAudio: false, durationSec: 1, trim: { inSec: 4, outSec: 5 } }),
			],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		}) as string[];
		const fc = filterComplexOf(args);
		expect(fc).toContain("[1:v]trim=start=4.000:end=5.000,setpts=PTS-STARTPTS,scale=");
		expect(fc).toContain("anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=1.000[an1]");
		expect(fc).not.toContain("[1:a]");
	});

	it("folds color-match corrections into the per-clip video chains", () => {
		const args = buildSinglePassConcatArgs({
			clips: [
				clip({ yuv: { y: 100, u: 128, v: 128 } }),
				clip({ yuv: { y: 140, u: 128, v: 128 } }),
			],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: true,
			outFile: "/tmp/out.mp4",
		}) as string[];
		const fc = filterComplexOf(args);
		// target Y = 120 → clip0 brightens (+20/255), clip1 darkens
		expect(fc).toContain("eq=brightness=0.0784");
		expect(fc).toContain("eq=brightness=-0.0784");
	});

	it("uses the per-clip transition for xfade when specified", () => {
		const args = buildSinglePassConcatArgs({
			clips: [clip(), clip({ transition: "slideup" })],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		}) as string[];
		const fc = filterComplexOf(args);
		expect(fc).toContain("xfade=transition=slideup:duration=0.400");
	});

	it("rejects an unknown transition instead of silently replacing it", () => {
		expect(() => buildSinglePassConcatArgs({
			clips: [clip(), clip({ transition: "not-a-real-transition" })],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		})).toThrow("video_concat_transition_invalid");
	});

	it("uses different transitions per clip in a 3-clip sequence", () => {
		const args = buildSinglePassConcatArgs({
			clips: [clip(), clip({ transition: "circleopen" }), clip({ transition: "wipedown" })],
			dims: DIMS,
			xfadeSeconds: 0.4,
			colorMatch: false,
			outFile: "/tmp/out.mp4",
		}) as string[];
		const fc = filterComplexOf(args);
		expect(fc).toContain("xfade=transition=circleopen");
		expect(fc).toContain("xfade=transition=wipedown");
	});
});

describe("buildColorCorrections", () => {
	it("returns per-clip corrections toward the global mean, clamped", () => {
		const out = buildColorCorrections([
			{ y: 0, u: 128, v: 128 },
			{ y: 255, u: 128, v: 128 },
		]);
		expect(out).not.toBeNull();
		const [a, b] = out as Array<{ bOff: number; rm: number; bm: number } | null>;
		// mean Y=127.5 → offsets ±0.5 clamped to ±0.3
		expect(a?.bOff).toBeCloseTo(0.3, 6);
		expect(b?.bOff).toBeCloseTo(-0.3, 6);
	});

	it("marks negligible corrections as null entries", () => {
		const out = buildColorCorrections([
			{ y: 120, u: 128, v: 128 },
			{ y: 120.5, u: 128, v: 128 },
		]);
		expect(out).not.toBeNull();
		expect((out as Array<unknown>)[0]).toBeNull();
		expect((out as Array<unknown>)[1]).toBeNull();
	});

	it("returns null when any probe is missing", () => {
		expect(buildColorCorrections([{ y: 120, u: 128, v: 128 }, null])).toBeNull();
	});
});
