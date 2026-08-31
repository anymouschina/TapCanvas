import { describe, expect, it } from "vitest";

import {
	assertVideoAnalysisBudgetInvariant,
	resolveVideoAnalysisUpfrontPricing,
	calculateVideoAnalysisDurationQuote,
	validateVideoAnalysisExecutionLimits,
	VIDEO_ANALYSIS_EXECUTION_LIMITS,
	VIDEO_ANALYSIS_TOKEN_BUDGET,
} from "./video-analysis-upfront-pricing";

describe("video analysis upfront pricing", () => {
	it("publishes Tanva-compatible duration pricing for the Lite model", () => {
		const pricing = resolveVideoAnalysisUpfrontPricing({
			modelKey: "doubao-seed-2-0-lite-260428",
			creditsPerCny: 100,
		});

		expect(pricing).toMatchObject({
			mode: "duration_metered",
			pricingVersion: "video-analysis-duration-v1",
			unit: "second",
			priceCnyPerSecond: 0.125,
			creditsPerCny: 100,
			cost: 31,
			enabled: true,
			officialCostCny: 0.2015361,
			salePriceMultiplier: 1.5,
			limits: {
				maxDurationSeconds: 60,
				maxVideoBytes: 50 * 1024 * 1024,
				maxFps: 5,
				maxOutputTokens: 16_384,
			},
			tokenBudget: {
				maxVideoInputTokens: 81_920,
				maxNonAudioInputTokens: 120_000,
				maxAudioInputTokens: 375,
				maxTotalInputTokens: 120_375,
			},
		});
		expect(pricing?.priceCny).toBeCloseTo(0.30230415, 8);
	});

	it.each([
		["doubao-seed-2-0-pro-260428", 1 / 3, 42],
		["doubao-seed-2-0-lite-260428", 1 / 10, 13],
		["doubao-seed-2-0-mini-260428", 1 / 20, 7],
	] as const)("quotes %s by actual duration", (modelKey, ratio, expectedCredits) => {
		const quote = calculateVideoAnalysisDurationQuote({ modelKey, durationSeconds: 1, creditsPerCny: 100 });
		expect(quote).toMatchObject({
			mode: "duration_metered",
			modelKey,
			creditsCharged: expectedCredits,
		});
		expect(quote?.priceCnyPerSecond).toBeCloseTo(1.25 * ratio, 8);
	});

	it("does not invent a price for an unconfigured model", () => {
		expect(resolveVideoAnalysisUpfrontPricing({
			modelKey: "another-model",
			creditsPerCny: 100,
		})).toBeNull();
	});

	it("keeps the execution envelope inside the priced 128K input tier", () => {
		expect(() => assertVideoAnalysisBudgetInvariant()).not.toThrow();
		expect(VIDEO_ANALYSIS_TOKEN_BUDGET.maxTotalInputTokens).toBeLessThanOrEqual(128_000);
	});

	it("accepts the exact duration, fps, prompt, and request-body limits", () => {
		const violation = validateVideoAnalysisExecutionLimits({
			durationSeconds: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxDurationSeconds,
			videoSizeBytes: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxVideoBytes,
			fps: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps,
			userPrompt: "x".repeat(VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes),
			requestBody: "x".repeat(VIDEO_ANALYSIS_EXECUTION_LIMITS.maxRequestBodyBytes),
		});
		expect(violation).toBeNull();
	});

	it("rejects every request dimension that can exceed the priced envelope", () => {
		const common = {
			durationSeconds: 60,
			videoSizeBytes: 10_000_000,
			fps: 5,
			userPrompt: "",
			requestBody: "{}",
		};
		expect(validateVideoAnalysisExecutionLimits({
			...common,
			durationSeconds: 60.001,
		})?.code).toBe("video_analysis_duration_limit_exceeded");
		expect(validateVideoAnalysisExecutionLimits({
			...common,
			videoSizeBytes: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxVideoBytes + 1,
		})?.code).toBe("video_analysis_video_size_limit_exceeded");
		expect(validateVideoAnalysisExecutionLimits({
			...common,
			fps: 5.01,
		})?.code).toBe("video_analysis_fps_limit_exceeded");
		expect(validateVideoAnalysisExecutionLimits({
			...common,
			userPrompt: "你".repeat(683),
		})?.code).toBe("video_analysis_prompt_limit_exceeded");
		expect(validateVideoAnalysisExecutionLimits({
			...common,
			requestBody: "x".repeat(16_385),
		})?.code).toBe("video_analysis_request_limit_exceeded");
	});
});
