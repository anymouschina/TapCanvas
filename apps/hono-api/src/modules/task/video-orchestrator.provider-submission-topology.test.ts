import { describe, expect, it } from "vitest";
import {
	resolveVideoPreflightSubmissionTopology,
	resolveVideoProviderDurationTopology,
	resolveVideoProviderSubmissionTopology,
} from "./video-orchestrator.provider-submission-topology";
import type { VideoGenerationContract } from "./video-orchestrator.generation-contract";

const generationContract = (durationOptions: number[]): VideoGenerationContract => ({
	videoModel: "doubao-seedance-2.5",
	durationOptions,
	maxDurationSeconds: durationOptions.at(-1) ?? 0,
	referenceImagePolicy: {
		countUnit: "unique_url",
		maximumTotalImages: 12,
		maximumBusinessImages: 10,
	},
	referenceAudioPolicy: { minimumDurationSeconds: 1, maximumDurationSeconds: 20 },
});

describe("resolveVideoProviderSubmissionTopology", () => {
	it("keeps the agent-planned beat count for a full chapter without requiring a target duration", () => {
		expect(resolveVideoPreflightSubmissionTopology({
			deliveryScope: "full_chapter",
			requestedExpectedBeatCount: 11,
			userIntentContract: { delivery: { kind: "video" } },
			generationContract: generationContract([5, 10, 15]),
		})).toEqual({
			expectedBeatCount: 11,
			providerSubmissionTopology: null,
		});
	});

	it("still freezes provider topology for an explicit bounded duration", () => {
		expect(resolveVideoPreflightSubmissionTopology({
			deliveryScope: "bounded_duration",
			requestedExpectedBeatCount: 4,
			userIntentContract: { delivery: { kind: "video", durationSeconds: 20 } },
			generationContract: generationContract([5, 10, 15, 20]),
		})).toEqual({
			expectedBeatCount: 1,
			providerSubmissionTopology: {
				targetDurationSeconds: 20,
				expectedClipCount: 1,
				minimumClipDurations: [20],
				source: "model_max_duration",
			},
		});
	});

	it("uses one 20s provider submission when the live model supports 20s", () => {
		expect(resolveVideoProviderSubmissionTopology({
			userIntentContract: { delivery: { kind: "video", durationSeconds: 20 } },
			generationContract: generationContract(Array.from({ length: 27 }, (_, index) => index + 4)),
		})).toEqual({
			targetDurationSeconds: 20,
			expectedClipCount: 1,
			minimumClipDurations: [20],
			source: "model_max_duration",
		});
	});

	it("freezes a 20s Seedance 2.0 delivery as 15s plus 5s provider submissions", () => {
		expect(resolveVideoProviderDurationTopology({
			targetDurationSeconds: 20,
			durationOptions: Array.from({ length: 12 }, (_, index) => index + 4),
		})).toEqual({
			targetDurationSeconds: 20,
			expectedClipCount: 2,
			minimumClipDurations: [15, 5],
			source: "model_max_duration",
		});
	});

	it("fills the model maximum first when the target exceeds one submission", () => {
		expect(resolveVideoProviderSubmissionTopology({
			userIntentContract: { delivery: { kind: "video", durationSeconds: 40 } },
			generationContract: generationContract(Array.from({ length: 27 }, (_, index) => index + 4)),
		}).minimumClipDurations).toEqual([30, 10]);
	});

	it("freezes 40 seconds as 30 plus 10 without reading narrative beat count", () => {
		expect(resolveVideoProviderDurationTopology({
			targetDurationSeconds: 40,
			durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
		})).toEqual({
			targetDurationSeconds: 40,
			expectedClipCount: 2,
			minimumClipDurations: [30, 10],
			source: "model_max_duration",
		});
	});

	it("uses the minimum five physical clips for a model whose maximum is 8 seconds", () => {
		expect(resolveVideoProviderDurationTopology({
			targetDurationSeconds: 40,
			durationOptions: [5, 8],
		})).toEqual({
			targetDurationSeconds: 40,
			expectedClipCount: 5,
			minimumClipDurations: [8, 8, 8, 8, 8],
			source: "model_max_duration",
		});
	});

	it("uses three physical clips for a 15-second model without averaging the duration", () => {
		expect(resolveVideoProviderDurationTopology({
			targetDurationSeconds: 40,
			durationOptions: [5, 10, 15],
		})).toEqual({
			targetDurationSeconds: 40,
			expectedClipCount: 3,
			minimumClipDurations: [15, 15, 10],
			source: "model_max_duration",
		});
	});

	it("respects an explicitly frozen user clip count above the provider minimum", () => {
		expect(resolveVideoProviderSubmissionTopology({
			userIntentContract: { delivery: { kind: "video", durationSeconds: 20, clipCount: 4 } },
			generationContract: generationContract([5, 10, 15, 20]),
		})).toEqual({
			targetDurationSeconds: 20,
			expectedClipCount: 4,
			minimumClipDurations: [5, 5, 5, 5],
			source: "user_clip_count",
		});
	});

	it("preserves agent-authored provider durations instead of collapsing them to the minimum count", () => {
		expect(resolveVideoProviderDurationTopology({
			targetDurationSeconds: 60,
			durationOptions: Array.from({ length: 12 }, (_, index) => index + 4),
			requestedClipCount: 6,
			explicitDurations: [10, 10, 10, 10, 10, 10],
		})).toEqual({
			targetDurationSeconds: 60,
			expectedClipCount: 6,
			minimumClipDurations: [10, 10, 10, 10, 10, 10],
			source: "user_clip_durations",
		});
	});

	it("fails when the requested exact duration cannot be represented", () => {
		expect(() => resolveVideoProviderSubmissionTopology({
			userIntentContract: { delivery: { kind: "video", durationSeconds: 24 } },
			generationContract: generationContract([5, 10, 15]),
		})).toThrow("video_provider_topology_exact_duration_unsupported");
	});
});
