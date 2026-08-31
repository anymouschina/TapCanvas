import { describe, expect, it } from "vitest";
import {
  isLegacyLocalPreUpstreamVideoErrorCode,
  isOptionalReferenceAudioFailure,
  isVideoSubmitCapacityBackpressure,
  isVideoSubmitKnownPreUpstreamFailure,
  matchVideoSubmitRejectedReferenceIds,
  readVideoSubmitErrorCode,
  readVideoSubmitRejectedReferenceIds,
  readVideoSubmitRejectedUrls,
  shouldRetryVideoWithoutOptionalReferenceAudio,
} from "./video-orchestrator.submit-error";

describe("video submit error classification", () => {
  it("recognizes the structured membership concurrency code", () => {
    expect(isVideoSubmitCapacityBackpressure({
      code: "membership_concurrency_limit_reached",
      message: "localized text may change",
    })).toBe(true);
    expect(readVideoSubmitErrorCode({ code: "membership_concurrency_limit_reached" }))
      .toBe("membership_concurrency_limit_reached");
  });

  it("treats explicit pre-upstream evidence and the audited legacy model gate as pre-submit", () => {
    expect(isVideoSubmitKnownPreUpstreamFailure({
      code: "future_preflight_error",
      details: { upstreamRequestAttempted: false },
    })).toBe(true);
    expect(isVideoSubmitKnownPreUpstreamFailure({ code: "new_api_model_disabled" })).toBe(true);
    expect(isLegacyLocalPreUpstreamVideoErrorCode("new_api_model_disabled")).toBe(true);
    expect(isVideoSubmitKnownPreUpstreamFailure({ code: "video_prompt_too_long" })).toBe(true);
    expect(isLegacyLocalPreUpstreamVideoErrorCode("video_prompt_too_long")).toBe(true);
    expect(isVideoSubmitKnownPreUpstreamFailure({ code: "newapi:newapi_request_failed" }))
      .toBe(false);
  });

  it("does not classify message-only or unrelated failures as capacity backpressure", () => {
    expect(isVideoSubmitCapacityBackpressure(new Error("当前套餐最多同时执行 1 个任务"))).toBe(false);
    expect(isVideoSubmitCapacityBackpressure({ code: "model_spec_pricing_unavailable" })).toBe(false);
  });

  it("preserves explicit provider moderation rejection URLs as deterministic evidence", () => {
		const error = {
      details: {
        upstreamData: {
          code: "ark_moderation_rejected",
          data: { rejected_urls: ["https://cdn.test/rejected.png?signature=one", "https://cdn.test/rejected.png?signature=one"] },
        },
      },
		};
		expect(readVideoSubmitRejectedUrls(error)).toEqual(["https://cdn.test/rejected.png?signature=one"]);
		expect(matchVideoSubmitRejectedReferenceIds(error, [
			{ referenceId: "asset-kept", url: "https://cdn.test/kept.png?signature=current" },
			{ referenceId: "asset-rejected", url: "https://cdn.test/rejected.png?signature=original" },
		])).toEqual(["asset-rejected"]);
		const annotated = { ...error, providerRejectedReferenceIds: ["asset-rejected", "asset-rejected"] };
		expect(readVideoSubmitRejectedReferenceIds(annotated)).toEqual(["asset-rejected"]);
    expect(readVideoSubmitRejectedUrls({ code: "unrelated" })).toEqual([]);
  });

  it("retries optional reference audio only with explicit pre-upstream evidence", () => {
    const safeAudioFailure = {
      code: "speaker_voice_manifest_mismatch",
      details: { upstreamRequestAttempted: false },
    };
    expect(isOptionalReferenceAudioFailure(safeAudioFailure)).toBe(true);
    expect(shouldRetryVideoWithoutOptionalReferenceAudio({
      error: safeAudioFailure,
      hadReferenceAudio: true,
    })).toBe(true);
    expect(shouldRetryVideoWithoutOptionalReferenceAudio({
      error: safeAudioFailure,
      hadReferenceAudio: true,
      referenceAudioRequired: true,
    })).toBe(false);
    expect(shouldRetryVideoWithoutOptionalReferenceAudio({
      error: { code: "speaker_voice_manifest_mismatch" },
      hadReferenceAudio: true,
    })).toBe(false);
    expect(shouldRetryVideoWithoutOptionalReferenceAudio({
      error: safeAudioFailure,
      hadReferenceAudio: false,
    })).toBe(false);
  });
});
