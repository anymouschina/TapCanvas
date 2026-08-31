import { describe, expect, it } from "vitest";
import {
	buildProductionGraphEvidenceWrites,
	resolveFinalMediaProbeTimeoutMs,
} from "./video-orchestrator.production-graph-evidence";

const verifiedNarrative = {
	version: 1,
	satisfied: true,
	deliveryScope: "full_chapter",
	expected: {
		persistedBeatSheet: true,
		sourceCoveragePlan: true,
		speechLedgerConservation: true,
		executableSpeechAuthority: true,
		authoritativePromptDelivery: true,
		plannedDuration: true,
		explicitConcatPolicy: true,
	},
	checks: {
		persistedBeatSheet: true,
		sourceCoveragePlan: true,
		speechLedgerConservation: true,
		executableSpeechAuthority: true,
		authoritativePromptDelivery: true,
		plannedDuration: true,
		explicitConcatPolicy: true,
	},
	facts: {
		beatCount: 1,
		storyPlanClipCount: 1,
		authoritativePromptClipCount: 1,
		coverageSpanCount: 1,
		speechLedgerLineCount: 1,
		chapterSourceCharacters: 20,
		beatDurationSeconds: 90,
		storyPlanDurationSeconds: 90,
		concatPolicy: { joinMode: "hard_cut", xfadeSeconds: 0, colorMatch: false },
	},
	missingCriteria: [],
	diagnostics: [],
} as const;

const finalMediaProbe = {
	durationSeconds: 90,
	width: 1280,
	height: 720,
	videoCodec: "h264",
	audioCodec: "aac",
	fps: 30,
	sizeBytes: 2_000,
} as const;

const narrativeDeliveryEvidence = {
	narrativeVerification: verifiedNarrative,
	finalMediaProbe,
};

const verifiedFinishing = {
	version: 3,
	satisfied: true,
	expected: {
		sourceDurationSeconds: 90,
		sourceResolution: "720p",
		sourceMinimumShortEdgePixels: 720,
		resolution: "1080p",
		minimumShortEdgePixels: 1080,
		fps: 30,
		preserveSourceDuration: true,
		preserveSourceAspect: true,
		preserveSourceAudio: true,
	},
	mediaIdentity: {
		sourceVideoUrlHash: "source-hash",
		masterVideoUrlHash: "master-hash",
	},
	clips: [{
		clipIndex: 0,
		expectedDurationSeconds: 90,
		expectedMinimumShortEdgePixels: 720,
		requiresAudio: true,
		mediaUrlHash: "clip-hash",
		media: {
			durationSeconds: 90,
			width: 1280,
			height: 720,
			videoCodec: "h264",
			audioCodec: "aac",
			fps: 30,
			sizeBytes: 1_000,
		},
		checks: {
			videoStreamPresent: true,
			durationMatchesPlan: true,
			generationResolutionReached: true,
			fpsPresent: true,
			requiredAudioPresent: true,
		},
		missingCriteria: [],
	}],
	source: {
		durationSeconds: 90,
		width: 1280,
		height: 720,
		videoCodec: "h264",
		audioCodec: "aac",
		fps: 30,
		sizeBytes: 1_000,
	},
	master: {
		durationSeconds: 90,
		width: 1920,
		height: 1080,
		videoCodec: "h264",
		audioCodec: "aac",
		fps: 30,
		sizeBytes: 2_000,
	},
	checks: {
		clipMediaComplete: true,
		sourceDurationMatchesPlan: true,
		sourceVideoStreamPresent: true,
		sourceResolutionReached: true,
		requiredSourceAudioPresent: true,
		masterVideoStreamPresent: true,
		targetResolutionReached: true,
		targetFpsReached: true,
		durationPreserved: true,
		aspectPreserved: true,
		sourceAudioPreserved: true,
	},
	missingCriteria: [],
	verifiedAt: "2026-08-09T00:00:00.000Z",
} as const;

describe("production graph evidence", () => {
	it("scales final media probe timeouts with frozen film duration inside bounded limits", () => {
		expect(resolveFinalMediaProbeTimeoutMs(null)).toBe(120_000);
		expect(resolveFinalMediaProbeTimeoutMs(30)).toBe(120_000);
		expect(resolveFinalMediaProbeTimeoutMs(180)).toBe(360_000);
		expect(resolveFinalMediaProbeTimeoutMs(10_000)).toBe(900_000);
	});

	it("projects provider waits and durable clip results without treating a wait as completion", () => {
		const writes = buildProductionGraphEvidenceWrites({
			runId: "run-1",
			state: "video_running",
			clips: [
				{ clipIndex: 0, status: "running" },
				{ clipIndex: 1, status: "success", videoUrl: "https://cdn.example/1.mp4" },
			],
		});
		expect(writes).toEqual([
			expect.objectContaining({ artifactKey: "video-result:0", status: "waiting_external" }),
			expect.objectContaining({ artifactKey: "video-result:1", status: "ready" }),
		]);
		expect(writes.some((write) => write.artifactKey === "delivery:verify")).toBe(false);
	});

	it("creates concat and delivery verification only from a durable final URL", () => {
		expect(buildProductionGraphEvidenceWrites({
			runId: "run-2",
			state: "concatenated",
			clips: [{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" }],
			concatVideoUrl: "blob:temporary",
		}).some((write) => write.artifactKey === "delivery:verify")).toBe(false);

		const writes = buildProductionGraphEvidenceWrites({
			runId: "run-2",
			state: "concatenated",
			clips: [{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" }],
			concatVideoUrl: "https://cdn.example/final.mp4",
			deliveryEvidence: narrativeDeliveryEvidence,
		});
		expect(writes).toEqual(expect.arrayContaining([
			expect.objectContaining({ artifactKey: "concat:auto", status: "ready" }),
			expect.objectContaining({ artifactKey: "delivery:verify", status: "ready" }),
		]));
	});

	it("opens the composition node only after every clip has a durable URL", () => {
		const incomplete = buildProductionGraphEvidenceWrites({
			runId: "run-composing",
			state: "concatenating",
			clips: [
				{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" },
				{ clipIndex: 1, status: "running" },
			],
		});
		expect(incomplete.some((write) => write.artifactKey === "concat:auto")).toBe(false);

		const complete = buildProductionGraphEvidenceWrites({
			runId: "run-composing",
			state: "concatenating",
			clips: [
				{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" },
				{ clipIndex: 1, status: "success", videoUrl: "https://cdn.example/1.mp4" },
			],
		});
		expect(complete.find((write) => write.artifactKey === "concat:auto")).toMatchObject({
			status: "running",
			derivedFrom: ["video-result:0", "video-result:1"],
			payload: {
				phase: "concatenating",
				completedClips: 2,
				totalClips: 2,
			},
		});
		expect(complete.some((write) => write.artifactKey === "delivery:verify")).toBe(false);
	});

	it("delivers a durable final URL while retaining missing probe evidence as diagnostics", () => {
		const writes = buildProductionGraphEvidenceWrites({
			runId: "run-legacy",
			state: "concatenated",
			clips: [{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" }],
			concatVideoUrl: "https://cdn.example/legacy.mp4",
		});
		const concat = writes.find((write) => write.artifactKey === "concat:auto");
		const delivery = writes.find((write) => write.artifactKey === "delivery:verify");

		expect(concat).toMatchObject({
			status: "ready",
			payload: { videoUrl: "https://cdn.example/legacy.mp4" },
		});
		expect(delivery).toMatchObject({
			status: "ready",
			payload: {
				deliveryVerification: {
					satisfied: true,
					outcome: "satisfied",
					missingCriteria: [],
					diagnosticCriteria: ["finalMediaProbe", "narrativeVerification"],
				},
			},
		});
	});

	it("delivers the final asset while retaining narrative verification failure as diagnostics", () => {
		const failedNarrative = {
			...verifiedNarrative,
			satisfied: false,
			checks: { ...verifiedNarrative.checks, speechLedgerConservation: false },
			missingCriteria: ["narrativeFidelity.speechLedgerConservation"],
			failureReason: "video_narrative_delivery_verification_failed:speechLedgerConservation",
		};
		const writes = buildProductionGraphEvidenceWrites({
			runId: "run-narrative-failed",
			state: "concatenated",
			clips: [{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" }],
			concatVideoUrl: "https://cdn.example/final.mp4",
			deliveryEvidence: {
				narrativeVerification: failedNarrative,
				finalMediaProbe,
			},
		});
		const delivery = writes.find((write) => write.artifactKey === "delivery:verify");
		expect(delivery).toMatchObject({
			status: "ready",
			payload: {
				deliveryEvidence: { videoUrl: "https://cdn.example/final.mp4" },
				deliveryVerification: {
					satisfied: true,
					outcome: "satisfied",
					missingCriteria: [],
					diagnosticCriteria: ["narrativeVerification.narrativeFidelity.speechLedgerConservation"],
				},
			},
		});
	});

	it("keeps concat as source evidence and verifies the commercial master as final delivery", () => {
		const waiting = buildProductionGraphEvidenceWrites({
			runId: "run-commercial",
			state: "finishing_running",
			clips: [{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" }],
			concatVideoUrl: "https://cdn.example/source.mp4",
		});
		expect(waiting.some((write) => write.artifactKey === "delivery:verify")).toBe(false);

		const completed = buildProductionGraphEvidenceWrites({
			runId: "run-commercial",
			state: "finished",
			clips: [{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" }],
			concatVideoUrl: "https://cdn.example/source.mp4",
			masterVideoUrl: "https://cdn.example/master.mp4",
			deliveryEvidence: narrativeDeliveryEvidence,
			finishingVerification: verifiedFinishing,
		});
		expect(completed.find((write) => write.artifactKey === "concat:auto")?.payload).toMatchObject({
			videoUrl: "https://cdn.example/source.mp4",
		});
		expect(completed.find((write) => write.artifactKey === "delivery:verify")?.payload).toMatchObject({
			deliveryEvidence: {
				videoUrl: "https://cdn.example/master.mp4",
				sourceConcatVideoUrl: "https://cdn.example/source.mp4",
			},
			deliveryVerification: { satisfied: true },
		});
	});

	it("delivers the generated master while reporting technical mismatch as diagnostics", () => {
		const failedVerification = {
			...verifiedFinishing,
			satisfied: false,
			master: { ...verifiedFinishing.master, audioCodec: "" },
			checks: { ...verifiedFinishing.checks, sourceAudioPreserved: false },
			missingCriteria: ["sourceAudioPreserved"],
			failureReason: "video_finishing_technical_verification_failed:sourceAudioPreserved",
		};
		const writes = buildProductionGraphEvidenceWrites({
			runId: "run-commercial-failed-qc",
			state: "finished",
			clips: [{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" }],
			concatVideoUrl: "https://cdn.example/source.mp4",
			masterVideoUrl: "https://cdn.example/master.mp4",
			deliveryEvidence: narrativeDeliveryEvidence,
			finishingVerification: failedVerification,
		});
		const delivery = writes.find((write) => write.artifactKey === "delivery:verify");
		expect(delivery).toMatchObject({
			status: "ready",
			payload: {
				deliveryEvidence: {
					videoUrl: "https://cdn.example/master.mp4",
					sourceConcatVideoUrl: "https://cdn.example/source.mp4",
				},
				deliveryVerification: {
					satisfied: true,
					missingCriteria: [],
					diagnosticCriteria: ["finishingVerification.sourceAudioPreserved"],
				},
			},
		});
	});
});
