import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../types";

import {
	REMOTE_MEDIA_FETCH_ATTEMPTS,
	RetryableRemoteMediaError,
	isRetryableRemoteMediaStatus,
	runRemoteMediaFetch,
	sanitizeRemoteMediaUrl,
} from "./remote-media-fetch";

const context = { env: {} } as unknown as AppContext;

/** 全部重试都走同一条确定性路径，测试里把退避压到 0ms 以免拖慢回归。 */
const instantRetry = { delaysMs: [0, 0] as const };

afterEach(() => {
	vi.restoreAllMocks();
});

describe("isRetryableRemoteMediaStatus", () => {
	it("瞬时状态可重试：写后读 404 / 限流 / 5xx", () => {
		for (const status of [404, 408, 425, 429, 500, 502, 503, 504]) {
			expect(isRetryableRemoteMediaStatus(status)).toBe(true);
		}
	});

	it("确定性边界不重试：权限与请求本身错误", () => {
		for (const status of [400, 401, 403, 410, 422]) {
			expect(isRetryableRemoteMediaStatus(status)).toBe(false);
		}
	});
});

describe("runRemoteMediaFetch", () => {
	it("首次成功时不额外请求", async () => {
		const attempt = vi.fn().mockResolvedValue("bytes");
		const outcome = await runRemoteMediaFetch({ c: context, url: "https://cdn/x.png", tag: "t", event: "e", attempt, ...instantRetry });
		expect(outcome).toMatchObject({ ok: true, value: "bytes", attempts: 1 });
		expect(attempt).toHaveBeenCalledTimes(1);
	});

	it("传输层瞬时失败后重试并成功，保留真实尝试次数", async () => {
		const attempt = vi
			.fn()
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockResolvedValueOnce("bytes");
		const outcome = await runRemoteMediaFetch({ c: context, url: "https://cdn/x.png", tag: "t", event: "e", attempt, ...instantRetry });
		expect(outcome).toMatchObject({ ok: true, value: "bytes", attempts: 2 });
		expect(attempt).toHaveBeenCalledTimes(2);
	});

	it("刚写入对象的瞬时 404 可重试（真实失败场景）", async () => {
		const attempt = vi
			.fn()
			.mockRejectedValueOnce(new RetryableRemoteMediaError("HTTP 404", 404))
			.mockResolvedValueOnce("bytes");
		const outcome = await runRemoteMediaFetch({
			c: context,
			url: "https://cdn/x.png",
			tag: "t",
			event: "e",
			isRetryable: (error) => error instanceof RetryableRemoteMediaError && isRetryableRemoteMediaStatus(error.httpStatus ?? 0),
			attempt,
			...instantRetry,
		});
		expect(outcome).toMatchObject({ ok: true, attempts: 2 });
	});

	it("确定性 403 不重试，立即如实失败", async () => {
		const attempt = vi.fn().mockRejectedValue(new RetryableRemoteMediaError("HTTP 403", 403));
		const outcome = await runRemoteMediaFetch({
			c: context,
			url: "https://cdn/x.png",
			tag: "t",
			event: "e",
			isRetryable: (error) => error instanceof RetryableRemoteMediaError && isRetryableRemoteMediaStatus(error.httpStatus ?? 0),
			attempt,
			...instantRetry,
		});
		expect(outcome).toMatchObject({ ok: false, attempts: 1, httpStatus: 403, reason: "HTTP 403" });
		expect(attempt).toHaveBeenCalledTimes(1);
	});

	it("尝试耗尽后仍然失败，并保留最后一次原因与尝试次数", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const attempt = vi.fn().mockRejectedValue(new Error("TLS handshake timeout"));
		const outcome = await runRemoteMediaFetch({ c: context, url: "https://cdn/x.png?a=1#frag", tag: "t", event: "e", attempt, ...instantRetry });
		expect(outcome).toMatchObject({ ok: false, attempts: REMOTE_MEDIA_FETCH_ATTEMPTS, reason: "TLS handshake timeout" });
		expect(attempt).toHaveBeenCalledTimes(REMOTE_MEDIA_FETCH_ATTEMPTS);
		// 只记录可定位的资源标识，不写出可能带签名的完整 URL。
		expect(warn).toHaveBeenCalledTimes(REMOTE_MEDIA_FETCH_ATTEMPTS - 1);
		expect(String(warn.mock.calls[0]?.[0] ?? "")).not.toContain("?a=1");
	});

	it("默认退避策略按 1s / 3s 递增并封顶", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const sleeps: number[] = [];
		vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, delay?: number) => {
			sleeps.push(Number(delay ?? 0));
			handler();
			return 0 as unknown as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout);
		const attempt = vi.fn().mockRejectedValue(new Error("fetch failed"));
		await runRemoteMediaFetch({ c: context, url: "https://cdn/x.png", tag: "t", event: "e", attempt });
		expect(sleeps).toEqual([1_000, 3_000]);
	});
});

describe("sanitizeRemoteMediaUrl", () => {
	it("剥离查询串与片段", () => {
		expect(sanitizeRemoteMediaUrl("https://cdn.test/gen/a.png?sig=secret#x")).toBe("https://cdn.test/gen/a.png");
	});

	it("无法解析时返回稳定占位，不泄露原文", () => {
		expect(sanitizeRemoteMediaUrl("not a url")).toBe("[unparsable-url]");
	});
});
