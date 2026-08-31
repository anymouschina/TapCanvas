import { describe, expect, it } from "vitest";

import type { WorkerEnv } from "../../types";
import { createVideoUnderstandingModelInputUrl } from "./agents-video-understand.transport";

describe("video understanding model transport", () => {
	it("fails explicitly when object storage is not configured", async () => {
		await expect(createVideoUnderstandingModelInputUrl({
			env: {} as WorkerEnv,
			objectKey: "gen/videos/proxies/example.mp4",
		})).rejects.toThrow("对象存储未配置");
	});

	it("signs the exact proxy key on the configured S3 data plane", async () => {
		const signedUrl = await createVideoUnderstandingModelInputUrl({
			env: {
				OBJECT_STORAGE_PROVIDER: "r2",
				R2_ACCESS_KEY_ID: "test-access-key",
				R2_SECRET_ACCESS_KEY: "test-secret-key",
				R2_ENDPOINT_URL: "https://account-id.r2.cloudflarestorage.com",
				R2_REGION: "auto",
				R2_BUCKET: "canvas-pro",
				R2_PUBLIC_BASE_URL: "https://files.example.com",
			} as WorkerEnv,
			objectKey: "gen/videos/proxies/20260801/proxy.mp4",
		});
		const parsed = new URL(signedUrl);
		expect(parsed.protocol).toBe("https:");
		expect(parsed.hostname).toBe("canvas-pro.account-id.r2.cloudflarestorage.com");
		expect(parsed.pathname).toBe("/gen/videos/proxies/20260801/proxy.mp4");
		expect(parsed.searchParams.has("X-Amz-Signature")).toBe(true);
	});
});
