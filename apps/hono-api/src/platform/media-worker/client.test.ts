import { afterEach, describe, expect, it } from "vitest";

import {
	__resetMediaWorkerClientForTests,
	MEDIA_PROBE_DEFAULT_TIMEOUT_MS,
	concatVideosViaMediaWorker,
	extractPosterViaMediaWorker,
	isMediaWorkerEnabled,
	probeMediaViaMediaWorker,
	resolveMediaProbeTimeoutMs,
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

describe("media-worker probe budget", () => {
	afterEach(() => {
		delete process.env.MEDIA_PROBE_TIMEOUT_MS;
	});

	it("defaults to a budget that covers a full asset download plus probe", () => {
		// 探测成本是「整份资产下载 + ffprobe」；8.5MB/15s 片段实测约 11s。
		expect(resolveMediaProbeTimeoutMs()).toBeGreaterThan(11_000);
		expect(resolveMediaProbeTimeoutMs()).toBe(MEDIA_PROBE_DEFAULT_TIMEOUT_MS);
	});

	it("honours an explicit caller budget over the environment", () => {
		process.env.MEDIA_PROBE_TIMEOUT_MS = "5000";
		expect(resolveMediaProbeTimeoutMs(45_000)).toBe(45_000);
	});

	it("honours the configured environment budget", () => {
		process.env.MEDIA_PROBE_TIMEOUT_MS = "90000";
		expect(resolveMediaProbeTimeoutMs()).toBe(90_000);
	});

	it("ignores unusable configured values instead of failing the probe", () => {
		process.env.MEDIA_PROBE_TIMEOUT_MS = "not-a-number";
		expect(resolveMediaProbeTimeoutMs()).toBe(MEDIA_PROBE_DEFAULT_TIMEOUT_MS);
		process.env.MEDIA_PROBE_TIMEOUT_MS = "-1";
		expect(resolveMediaProbeTimeoutMs()).toBe(MEDIA_PROBE_DEFAULT_TIMEOUT_MS);
	});
});
