import { describe, expect, it, vi } from "vitest";
import type { VideoFinishingContract } from "./video-orchestrator.finishing-contract";
import {
	buildVideoFinishingTechnicalVerification,
	inspectVideoFinishingOutput,
	inspectVideoFinishingPreSubmission,
	inspectVideoFinishingSource,
	resolveFinishingMinimumShortEdgePixels,
	videoFinishingVerificationMatchesMedia,
} from "./video-orchestrator.finishing-verification";

const contract: VideoFinishingContract = {
	kind: "video_enhance",
	modelKey: "volc-enhance-video",
	toolVersion: "professional",
	scene: "short_series",
	resolution: "1080p",
	fps: 30,
	billingSpecKey: "professional:1080p:lte30",
};

const sourceProbe = {
	durationSeconds: 96.2,
	width: 1280,
	height: 720,
	videoCodec: "h264",
	audioCodec: "aac",
	fps: 30,
	sizeBytes: 1_000_000,
};

const masterProbe = {
	durationSeconds: 96.18,
	width: 1920,
	height: 1080,
	videoCodec: "h264",
	audioCodec: "aac",
	fps: 30,
	sizeBytes: 2_000_000,
};

const clips = [
	{
		input: {
			clipIndex: 0,
			expectedDurationSeconds: 48.1,
			videoUrl: "https://files.example/clip-0.mp4",
			requiresAudio: true,
		},
		probe: { ...sourceProbe, durationSeconds: 48.1 },
	},
	{
		input: {
			clipIndex: 1,
			expectedDurationSeconds: 48.1,
			videoUrl: "https://files.example/clip-1.mp4",
			requiresAudio: false,
		},
		probe: { ...sourceProbe, durationSeconds: 48.1 },
	},
];

const buildInput = () => ({
	contract,
	expectedSourceDurationSeconds: 96.2,
	sourceResolution: "720p",
	sourceVideoUrl: "https://files.example/source.mp4",
	masterVideoUrl: "https://files.example/master.mp4",
	clips,
	source: sourceProbe,
	master: masterProbe,
	verifiedAt: "2026-08-09T00:00:00.000Z",
});

describe("video finishing technical verification", () => {
	it("maps finishing presets to their required short edge", () => {
		expect(resolveFinishingMinimumShortEdgePixels("720p")).toBe(720);
		expect(resolveFinishingMinimumShortEdgePixels("1080p")).toBe(1080);
		expect(resolveFinishingMinimumShortEdgePixels("2K")).toBe(1440);
		expect(resolveFinishingMinimumShortEdgePixels("4K")).toBe(2160);
		expect(resolveFinishingMinimumShortEdgePixels("1536x864")).toBe(864);
		expect(resolveFinishingMinimumShortEdgePixels("unknown")).toBeNull();
	});

	it("verifies resolution, fps, duration, aspect and source audio from ffprobe facts", () => {
		const result = buildVideoFinishingTechnicalVerification(buildInput());
		expect(result.satisfied).toBe(true);
		expect(result.missingCriteria).toEqual([]);
		expect(result.master).toMatchObject({
			width: 1920,
			height: 1080,
			audioCodec: "aac",
		});
	});

	it("keeps the media facts but reports every deterministic contract mismatch", () => {
		const result = buildVideoFinishingTechnicalVerification({
			...buildInput(),
			master: {
				...masterProbe,
				durationSeconds: 90,
				width: 1280,
				height: 720,
				fps: 24,
				audioCodec: "",
			},
		});
		expect(result.satisfied).toBe(false);
		expect(result.missingCriteria).toEqual([
			"targetResolutionReached",
			"targetFpsReached",
			"durationPreserved",
			"sourceAudioPreserved",
		]);
		expect(result.master.width).toBe(1280);
	});

	it("probes source and master in parallel and returns a reusable verification record", async () => {
		const probe = vi.fn(async ({ url }: { url: string }) => {
			if (url.includes("source")) return sourceProbe;
			if (url.includes("master")) return masterProbe;
			return { ...sourceProbe, durationSeconds: 48.1 };
		});
		const result = await inspectVideoFinishingOutput({
			contract,
			expectedSourceDurationSeconds: 96.2,
			sourceResolution: "720p",
			sourceVideoUrl: "https://files.example/source.mp4",
			masterVideoUrl: "https://files.example/master.mp4",
			clips: clips.map((clip) => clip.input),
			verifiedAt: "2026-08-09T00:00:00.000Z",
			probe,
		});
		expect(probe).toHaveBeenCalledTimes(4);
		expect(result).toMatchObject({
			state: "complete",
			verification: { satisfied: true },
		});
	});

	it("waits for retryable media-worker evidence instead of inventing technical facts", async () => {
		const probe = vi.fn(async ({ url }: { url: string }) =>
			url.includes("source") ? sourceProbe : null,
		);
		await expect(inspectVideoFinishingOutput({
			contract,
			expectedSourceDurationSeconds: 96.2,
			sourceResolution: "720p",
			sourceVideoUrl: "https://files.example/source.mp4",
			masterVideoUrl: "https://files.example/master.mp4",
			clips: clips.map((clip) => clip.input),
			verifiedAt: "2026-08-09T00:00:00.000Z",
			probe,
		})).resolves.toEqual({
			state: "pending",
			reason: "master_media_probe_unavailable",
		});
	});

	it("rejects a dialogue clip without a real audio stream before paid finishing", async () => {
		const probe = vi.fn(async ({ url }: { url: string }) => {
			if (url.includes("clip-0")) return { ...sourceProbe, durationSeconds: 48.1, audioCodec: "" };
			if (url.includes("clip-1")) return { ...sourceProbe, durationSeconds: 48.1 };
			return sourceProbe;
		});
		await expect(inspectVideoFinishingPreSubmission({
			expectedSourceDurationSeconds: 96.2,
			sourceResolution: "720p",
			sourceVideoUrl: "https://files.example/source.mp4",
			clips: clips.map((clip) => clip.input),
			probe,
		})).resolves.toMatchObject({
			state: "complete",
			satisfied: false,
			missingCriteria: [
				"clips[0].requiredAudioPresent",
			],
		});
	});

	it("does not reuse verification after a source, master, clip, duration or audio contract changes", () => {
		const verification = buildVideoFinishingTechnicalVerification(buildInput());
		const base = {
			verification,
			contract,
			expectedSourceDurationSeconds: 96.2,
			sourceResolution: "720p",
			sourceVideoUrl: "https://files.example/source.mp4",
			masterVideoUrl: "https://files.example/master.mp4",
			clips: clips.map((clip) => clip.input),
		};
		expect(videoFinishingVerificationMatchesMedia(base)).toBe(true);
		expect(videoFinishingVerificationMatchesMedia({
			...base,
			clips: [{ ...base.clips[0]!, videoUrl: "https://files.example/replaced.mp4" }, base.clips[1]!],
		})).toBe(false);
		expect(videoFinishingVerificationMatchesMedia({
			...base,
			clips: [{ ...base.clips[0]!, requiresAudio: false }, base.clips[1]!],
		})).toBe(false);
	});

	it("rejects a shortened source timeline before a paid finishing submission", async () => {
		const probe = vi.fn(async () => ({ ...sourceProbe, durationSeconds: 90 }));
		await expect(inspectVideoFinishingSource({
			sourceVideoUrl: "https://files.example/source.mp4",
			expectedDurationSeconds: 96.2,
			probe,
		})).resolves.toMatchObject({
			state: "complete",
			satisfied: false,
			expectedDurationSeconds: 96.2,
			actualDurationSeconds: 90,
			failureReason: expect.stringContaining("video_finishing_source_duration_mismatch"),
		});
	});
});
