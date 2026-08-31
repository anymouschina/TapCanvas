import { afterEach, describe, expect, it } from "vitest";

import {
	__resetMediaWorkerClientForTests,
	concatVideosViaMediaWorker,
	extractPosterViaMediaWorker,
	isMediaWorkerEnabled,
	probeMediaViaMediaWorker,
	transcodeProxyViaMediaWorkerStrict,
} from "./client";

const ENV_KEY = "MEDIA_WORKER_GRPC_ADDR";

describe("media-worker client env gating", () => {
	afterEach(() => {
		delete process.env[ENV_KEY];
		__resetMediaWorkerClientForTests();
	});

	it("is disabled when MEDIA_WORKER_GRPC_ADDR is unset", async () => {
		delete process.env[ENV_KEY];
		__resetMediaWorkerClientForTests();
		expect(isMediaWorkerEnabled()).toBe(false);
		await expect(
			extractPosterViaMediaWorker({ videoR2Key: "gen/x.mp4", userId: "u" }),
		).resolves.toBeNull();
		await expect(
			probeMediaViaMediaWorker({ videoR2Key: "gen/x.mp4" }),
		).resolves.toBeNull();
	});

	it("treats blank addr as disabled", () => {
		process.env[ENV_KEY] = "   ";
		__resetMediaWorkerClientForTests();
		expect(isMediaWorkerEnabled()).toBe(false);
	});

	it("fails explicitly when a required transcode path is not configured", async () => {
		delete process.env[ENV_KEY];
		__resetMediaWorkerClientForTests();
		await expect(
			transcodeProxyViaMediaWorkerStrict({ videoUrl: "https://example.com/video.mp4" }),
		).rejects.toThrow("MEDIA_WORKER_GRPC_ADDR 未配置");
	});

	it("fails explicitly when the required workflow concat path is not configured", async () => {
		delete process.env[ENV_KEY];
		__resetMediaWorkerClientForTests();
		await expect(
			concatVideosViaMediaWorker({
				clips: [
					{ url: "https://example.com/clip-1.mp4" },
					{ url: "https://example.com/clip-2.mp4" },
				],
				userId: "u",
				xfadeSeconds: 0,
				colorMatch: false,
			}),
		).rejects.toThrow("MEDIA_WORKER_GRPC_ADDR 未配置");
	});

	it("reports enabled when addr is set", () => {
		process.env[ENV_KEY] = "media-worker:9090";
		__resetMediaWorkerClientForTests();
		expect(isMediaWorkerEnabled()).toBe(true);
	});
});
