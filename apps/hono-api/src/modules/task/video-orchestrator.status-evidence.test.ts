import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildFinalVideoGoalOutcomeProjection,
  buildFinalVideoStatusEvidenceProjection,
  isSatisfiedFinalVideoStatus,
} from "./video-orchestrator.status-evidence";
import type { VideoFinishingContract } from "./video-orchestrator.finishing-contract";
import type { VideoFinishingTechnicalVerification } from "./video-orchestrator.finishing-verification";
import type { VideoNarrativeDeliveryVerification } from "./video-orchestrator.narrative-delivery-verification";

const satisfiedNarrativeVerification: VideoNarrativeDeliveryVerification = {
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
    speechLedgerLineCount: 2,
    chapterSourceCharacters: 20,
    beatDurationSeconds: 96,
    storyPlanDurationSeconds: 96,
    concatPolicy: { joinMode: "hard_cut", xfadeSeconds: 0, colorMatch: false },
  },
  missingCriteria: [],
  diagnostics: [],
};

const finishingContract: VideoFinishingContract = {
  kind: "video_enhance",
  modelKey: "volc-enhance-video",
  toolVersion: "professional",
  scene: "short_series",
  resolution: "1080p",
  fps: 30,
  billingSpecKey: "professional:1080p:lte30",
};

const mediaHash = (url: string): string =>
  createHash("sha256").update(url).digest("hex");

const finishingClipNode = (runId: string): Record<string, unknown> => ({
  id: `${runId}-clip-0`,
  data: {
    kind: "video",
    status: "success",
    clipRunId: runId,
    clipIndex: 0,
    videoUrl: "https://files.example/clip-0.mp4",
  },
});

const satisfiedFinishingVerification: VideoFinishingTechnicalVerification = {
  version: 3,
  satisfied: true,
  expected: {
    sourceDurationSeconds: 96,
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
    sourceVideoUrlHash: mediaHash("https://files.example/source.mp4"),
    masterVideoUrlHash: mediaHash("https://files.example/master.mp4"),
  },
  clips: [{
    clipIndex: 0,
    expectedDurationSeconds: 96,
    expectedMinimumShortEdgePixels: 720,
    requiresAudio: true,
    mediaUrlHash: mediaHash("https://files.example/clip-0.mp4"),
    media: {
      durationSeconds: 96,
      width: 1280,
      height: 720,
      videoCodec: "h264",
      audioCodec: "aac",
      fps: 30,
      sizeBytes: 10_000,
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
    durationSeconds: 96,
    width: 1280,
    height: 720,
    videoCodec: "h264",
    audioCodec: "aac",
    fps: 30,
    sizeBytes: 10_000,
  },
  master: {
    durationSeconds: 96,
    width: 1920,
    height: 1080,
    videoCodec: "h264",
    audioCodec: "aac",
    fps: 30,
    sizeBytes: 20_000,
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
};

describe("buildFinalVideoStatusEvidenceProjection", () => {
  it("returns the canonical persisted compose node URL as terminal delivery evidence", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-1",
      narrativeVerification: satisfiedNarrativeVerification,
      nodes: [
        {
          id: "archived-compose",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-1",
            videoUrl: "https://files.example/old.mp4",
          },
        },
        {
          id: "film-run-1",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-1",
            videoResults: [{ url: "https://files.example/final.mp4" }],
            videoPrimaryIndex: 0,
          },
        },
      ],
    });

    expect(result).toEqual({
      concatVideoUrl: "https://files.example/final.mp4",
      concatNodeId: "film-run-1",
      deliveryEvidence: {
        kind: "video",
        runId: "run-1",
        source: "persisted_canvas_compose_node",
        nodeId: "film-run-1",
        videoUrl: "https://files.example/final.mp4",
        narrativeVerification: satisfiedNarrativeVerification,
      },
      deliveryVerification: {
        satisfied: true,
        expected: "durable_http_final_video_url",
        missingCriteria: [],
      },
    });
  });

  it("does not treat a blob URL or terminal run state as durable delivery evidence", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-2",
      narrativeVerification: satisfiedNarrativeVerification,
      nodes: [
        {
          id: "film-run-2",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-2",
            videoUrl: "blob:http://localhost/transient",
          },
        },
      ],
    });

    expect(result.concatVideoUrl).toBeUndefined();
    expect(result.deliveryVerification).toEqual({
      satisfied: false,
      expected: "durable_http_final_video_url",
      missingCriteria: ["concatVideoUrl"],
      failureReason: "final_video_url_not_found_on_persisted_compose_node",
    });
  });

  it("delivers a canonical durable final URL and records missing narrative review diagnostically", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-legacy",
      nodes: [{
        id: "film-run-legacy",
        data: {
          kind: "composeVideo",
          status: "success",
          clipRunId: "run-legacy",
          videoUrl: "https://files.example/legacy.mp4",
        },
      }],
    });

    expect(result.concatVideoUrl).toBe("https://files.example/legacy.mp4");
    expect(result.deliveryVerification).toEqual({
      satisfied: true,
      expected: "durable_http_final_video_url",
      missingCriteria: [],
      diagnostics: ["postGeneration.narrativeVerification"],
    });
  });

  it("does not substitute a sole archived compose node for the canonical run node", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-2",
      narrativeVerification: satisfiedNarrativeVerification,
      nodes: [
        {
          id: "archived-compose",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-2",
            videoUrl: "https://files.example/archived.mp4",
          },
        },
      ],
    });

    expect(result.concatVideoUrl).toBeUndefined();
    expect(result.deliveryVerification).toMatchObject({
      satisfied: false,
      missingCriteria: ["concatVideoUrl"],
      failureReason: "final_video_url_not_found_on_persisted_compose_node",
    });
  });

  it("reports a flow-read failure instead of hiding it behind a successful lifecycle state", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-3",
      narrativeVerification: satisfiedNarrativeVerification,
      nodes: null,
      readFailureReason: "chapter canvas unavailable",
    });

    expect(result.deliveryVerification).toEqual({
      satisfied: false,
      expected: "durable_http_final_video_url",
      missingCriteria: ["concatVideoUrl"],
      failureReason: "final_video_evidence_read_failed: chapter canvas unavailable",
    });
  });

  it("requires the persisted commercial master when the frozen plan includes finishing", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-master",
      narrativeVerification: satisfiedNarrativeVerification,
      finishingContract,
      expectedSourceDurationSeconds: 96,
      sourceResolution: "720p",
      nodes: [
        {
          id: "film-run-master",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-master",
            videoUrl: "https://files.example/source.mp4",
          },
        },
        finishingClipNode("run-master"),
        {
          id: "film-master-run-master",
          data: {
            kind: "video",
            status: "success",
            clipRunId: "run-master",
            finishingMaster: true,
            videoTaskKind: "video_enhance",
            videoModel: "volc-enhance-video",
            billingSpecKey: "professional:1080p:lte30",
            toolVersion: "professional",
            finishingScene: "short_series",
            resolution: "1080p",
            fps: 30,
            finishingVerification: satisfiedFinishingVerification,
            videoResults: [{ url: "https://files.example/master.mp4" }],
            videoPrimaryIndex: 0,
          },
        },
      ],
    });
    expect(result).toMatchObject({
      masterVideoUrl: "https://files.example/master.mp4",
      masterNodeId: "film-master-run-master",
      concatVideoUrl: "https://files.example/source.mp4",
      concatNodeId: "film-run-master",
      deliveryEvidence: {
        source: "persisted_canvas_video_master_node",
        videoUrl: "https://files.example/master.mp4",
        sourceVideoUrl: "https://files.example/source.mp4",
      },
      deliveryVerification: {
        satisfied: true,
        expected: "durable_http_final_video_url",
      },
    });
  });

  it("does not accept a preserved concat source as the final commercial master", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-master-missing",
      narrativeVerification: satisfiedNarrativeVerification,
      finishingContract,
      expectedSourceDurationSeconds: 96,
      sourceResolution: "720p",
      nodes: [{
        id: "film-run-master-missing",
        data: {
          kind: "composeVideo",
          status: "success",
          clipRunId: "run-master-missing",
          videoUrl: "https://files.example/source-only.mp4",
        },
      }],
    });
    expect(result.deliveryVerification).toEqual({
      satisfied: false,
      expected: "durable_http_final_video_url",
      missingCriteria: ["masterVideoUrl"],
      failureReason: "final_video_url_not_found_on_persisted_finishing_master_node",
    });
  });

  it("delivers a generated master and records missing ffprobe evidence diagnostically", () => {
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-unverified-master",
      narrativeVerification: satisfiedNarrativeVerification,
      finishingContract,
      expectedSourceDurationSeconds: 96,
      sourceResolution: "720p",
      nodes: [
        {
          id: "film-run-unverified-master",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-unverified-master",
            videoUrl: "https://files.example/source.mp4",
          },
        },
        {
          id: "film-master-run-unverified-master",
          data: {
            kind: "video",
            status: "success",
            clipRunId: "run-unverified-master",
            finishingMaster: true,
            videoTaskKind: "video_enhance",
            videoModel: "volc-enhance-video",
            billingSpecKey: "professional:1080p:lte30",
            toolVersion: "professional",
            finishingScene: "short_series",
            resolution: "1080p",
            fps: 30,
            videoUrl: "https://files.example/master.mp4",
          },
        },
      ],
    });

    expect(result.masterVideoUrl).toBe("https://files.example/master.mp4");
    expect(result.concatVideoUrl).toBe("https://files.example/source.mp4");
    expect(result.deliveryVerification).toEqual({
      satisfied: true,
      expected: "durable_http_final_video_url",
      missingCriteria: [],
      diagnostics: ["postGeneration.finishingVerification"],
    });
  });

  it("reports an audio-preservation mismatch without hiding either generated asset", () => {
    const failedVerification: VideoFinishingTechnicalVerification = {
      ...satisfiedFinishingVerification,
      satisfied: false,
      master: { ...satisfiedFinishingVerification.master, audioCodec: "" },
      checks: {
        ...satisfiedFinishingVerification.checks,
        sourceAudioPreserved: false,
      },
      missingCriteria: ["sourceAudioPreserved"],
      failureReason: "video_finishing_technical_verification_failed:sourceAudioPreserved",
    };
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-audio-mismatch",
      narrativeVerification: satisfiedNarrativeVerification,
      finishingContract,
      expectedSourceDurationSeconds: 96,
      sourceResolution: "720p",
      nodes: [
        {
          id: "film-run-audio-mismatch",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-audio-mismatch",
            videoUrl: "https://files.example/source.mp4",
          },
        },
        finishingClipNode("run-audio-mismatch"),
        {
          id: "film-master-run-audio-mismatch",
          data: {
            kind: "video",
            status: "success",
            clipRunId: "run-audio-mismatch",
            finishingMaster: true,
            videoTaskKind: "video_enhance",
            videoModel: "volc-enhance-video",
            billingSpecKey: "professional:1080p:lte30",
            toolVersion: "professional",
            finishingScene: "short_series",
            resolution: "1080p",
            fps: 30,
            finishingVerification: failedVerification,
            videoUrl: "https://files.example/master.mp4",
          },
        },
      ],
    });
    expect(result.masterVideoUrl).toBe("https://files.example/master.mp4");
    expect(result.deliveryVerification).toMatchObject({
      satisfied: true,
      missingCriteria: [],
      diagnostics: ["postGeneration.finishingVerification.sourceAudioPreserved"],
    });
  });

  it("delivers the generated master and diagnoses a concat duration mismatch", () => {
    const failedVerification: VideoFinishingTechnicalVerification = {
      ...satisfiedFinishingVerification,
      satisfied: false,
      source: {
        ...satisfiedFinishingVerification.source,
        durationSeconds: 90,
      },
      master: {
        ...satisfiedFinishingVerification.master,
        durationSeconds: 90,
      },
      checks: {
        ...satisfiedFinishingVerification.checks,
        sourceDurationMatchesPlan: false,
      },
      missingCriteria: ["sourceDurationMatchesPlan"],
      failureReason: "video_finishing_technical_verification_failed:sourceDurationMatchesPlan",
    };
    const result = buildFinalVideoStatusEvidenceProjection({
      runId: "run-source-duration-mismatch",
      narrativeVerification: satisfiedNarrativeVerification,
      finishingContract,
      expectedSourceDurationSeconds: 96,
      sourceResolution: "720p",
      nodes: [
        {
          id: "film-run-source-duration-mismatch",
          data: {
            kind: "composeVideo",
            status: "success",
            clipRunId: "run-source-duration-mismatch",
            videoUrl: "https://files.example/source.mp4",
          },
        },
        finishingClipNode("run-source-duration-mismatch"),
        {
          id: "film-master-run-source-duration-mismatch",
          data: {
            kind: "video",
            status: "success",
            clipRunId: "run-source-duration-mismatch",
            finishingMaster: true,
            videoTaskKind: "video_enhance",
            videoModel: "volc-enhance-video",
            billingSpecKey: "professional:1080p:lte30",
            toolVersion: "professional",
            finishingScene: "short_series",
            resolution: "1080p",
            fps: 30,
            finishingVerification: failedVerification,
            videoUrl: "https://files.example/master.mp4",
          },
        },
      ],
    });

    expect(result.masterVideoUrl).toBe("https://files.example/master.mp4");
    expect(result.concatVideoUrl).toBe("https://files.example/source.mp4");
    expect(result.deliveryVerification).toMatchObject({
      satisfied: true,
      missingCriteria: [],
      diagnostics: ["postGeneration.finishingVerification.sourceDurationMatchesPlan"],
    });
  });

  it("rejects a lifecycle-success status when the terminal compose URL is missing", () => {
    expect(isSatisfiedFinalVideoStatus({
      success: true,
      state: "concatenated",
      deliveryVerification: {
        satisfied: false,
        expected: "durable_http_final_video_url",
        missingCriteria: ["concatVideoUrl"],
      },
    })).toBe(false);
  });

  it("accepts only lifecycle success plus satisfied final delivery verification", () => {
    expect(isSatisfiedFinalVideoStatus({
      success: true,
      state: "concatenated",
      deliveryVerification: {
        satisfied: true,
        expected: "durable_http_final_video_url",
        missingCriteria: [],
      },
    })).toBe(true);
  });

  it("keeps lifecycle success separate from an unsatisfied delivery claim", () => {
    expect(buildFinalVideoGoalOutcomeProjection({
      success: true,
      state: "concatenated",
      deliveryVerification: {
        satisfied: false,
        expected: "durable_http_final_video_url",
        missingCriteria: ["concatVideoUrl"],
      },
    })).toEqual({
      success: false,
      runSuccess: true,
      goalOutcome: "unsatisfied",
      deliveryDiagnostic: true,
      code: "video_delivery_verification_unsatisfied",
    });

    expect(buildFinalVideoGoalOutcomeProjection({
      success: true,
      state: "concatenated",
      deliveryVerification: {
        satisfied: true,
        expected: "durable_http_final_video_url",
        missingCriteria: [],
      },
    })).toEqual({
      success: true,
      runSuccess: true,
      goalOutcome: "satisfied",
    });
  });
});
