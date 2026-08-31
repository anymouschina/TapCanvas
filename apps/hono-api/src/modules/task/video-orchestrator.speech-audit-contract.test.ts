import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_ANALYSIS_PRICING_VERSION } from "../billing/video-analysis-upfront-pricing";
import type { NewApiModelDto } from "../new-api-models/new-api-models.service";

vi.mock("../new-api-models/new-api-video-analysis-model", () => ({
	requireSelectableVideoAnalysisModel: vi.fn(),
}));

import { requireSelectableVideoAnalysisModel } from "../new-api-models/new-api-video-analysis-model";
import {
	parseVideoSpeechAuditContract,
	parseVideoSpeechAuditRequest,
	resolveBeatSheetVideoSpeechAuditContract,
} from "./video-orchestrator.speech-audit-contract";

const request = {
	kind: "video_speech_audit" as const,
	modelKey: "doubao-seed-2-0-mini-260428",
	fps: 1,
};

describe("video speech audit contract", () => {
	beforeEach(() => {
		vi.mocked(requireSelectableVideoAnalysisModel).mockResolvedValue({
			requestModelKey: request.modelKey,
			videoAnalysisPricing: {
				enabled: true,
				mode: "duration_metered",
				pricingVersion: VIDEO_ANALYSIS_PRICING_VERSION,
				unit: "second",
				priceCnyPerSecond: 0.0625,
				creditsPerCny: 100,
				minimumCredits: 1,
				specKey: "video-understand:duration-metered:60s:5fps:16k-output:v1",
				cost: 100,
				officialCostCny: 1,
				priceCny: 1.5,
				salePriceMultiplier: 1.5,
				limits: {} as never,
				tokenBudget: {} as never,
			},
		} as NewApiModelDto);
	});

	it("parses only an explicit model and legal analysis fps", () => {
		expect(parseVideoSpeechAuditRequest(request)).toEqual(request);
		expect(parseVideoSpeechAuditRequest({ ...request, fps: 8 })).toBeNull();
		expect(parseVideoSpeechAuditRequest({ ...request, modelKey: "" })).toBeNull();
	});

	it("freezes the exact selectable runtime model and pricing identity", async () => {
		const beatSheet = { meta: { speechAudit: request } };
		await expect(resolveBeatSheetVideoSpeechAuditContract({
			c: {} as never,
			beatSheet,
		})).resolves.toEqual({
			...request,
			billingSpecKey: "video-understand:duration-metered:60s:5fps:16k-output:v1",
			pricingVersion: VIDEO_ANALYSIS_PRICING_VERSION,
			creditsPerCny: 100,
		});
	});

	it("rejects a malformed persisted contract instead of substituting defaults", () => {
		expect(parseVideoSpeechAuditContract({ ...request })).toBeNull();
	});
});
