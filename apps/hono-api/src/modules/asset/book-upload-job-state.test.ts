import { describe, expect, it } from "vitest";

import { isStalledBookUploadJob } from "./book-upload-job-state";

describe("isStalledBookUploadJob", () => {
	const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
	const staleAfterMs = 120_000;

	it("returns false for terminal jobs", () => {
		expect(
			isStalledBookUploadJob({
				job: {
					status: "failed",
					updatedAt: "2026-04-02T23:40:05.253Z",
				},
				nowMs,
				staleAfterMs,
			}),
		).toBe(false);
		expect(
			isStalledBookUploadJob({
				job: {
					status: "succeeded",
					updatedAt: "2026-04-02T23:40:05.253Z",
				},
				nowMs,
				staleAfterMs,
			}),
		).toBe(false);
	});

	it("returns false for recent active jobs", () => {
		expect(
			isStalledBookUploadJob({
				job: {
					status: "running",
					updatedAt: "2026-04-02T23:59:10.000Z",
					startedAt: "2026-04-02T23:59:10.000Z",
					progress: {
						phase: "queued",
						percent: 1,
					},
				},
				nowMs,
				staleAfterMs,
			}),
		).toBe(false);
	});

	it("returns true for queued jobs that never started and are stale", () => {
		expect(
			isStalledBookUploadJob({
				job: {
					status: "queued",
					updatedAt: "2026-04-02T23:40:05.253Z",
					progress: {
						phase: "queued",
						percent: 0,
					},
				},
				nowMs,
				staleAfterMs,
			}),
		).toBe(true);
	});

	it("returns true for running jobs stuck at the initial heartbeat", () => {
		expect(
			isStalledBookUploadJob({
				job: {
					status: "running",
					updatedAt: "2026-04-02T23:40:05.253Z",
					startedAt: "2026-04-02T23:40:05.253Z",
					progress: {
						phase: "queued",
						percent: 1,
					},
				},
				nowMs,
				staleAfterMs,
			}),
		).toBe(true);
	});

	it("returns false once parsing has actually advanced", () => {
		expect(
			isStalledBookUploadJob({
				job: {
					status: "running",
					updatedAt: "2026-04-02T23:40:05.253Z",
					startedAt: "2026-04-02T23:40:05.253Z",
					progress: {
						phase: "chapter_boundaries",
						percent: 40,
					},
				},
				nowMs,
				staleAfterMs,
			}),
		).toBe(false);
	});
});
