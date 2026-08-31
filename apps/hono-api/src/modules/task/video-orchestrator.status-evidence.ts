import {
  collectFinalVideoDeliveryEvidence,
  type FinalVideoDeliveryEvidence,
} from "./video-run.delivery-projection";
import type { VideoFinishingContract } from "./video-orchestrator.finishing-contract";
import {
  buildVideoFinishingTechnicalVerification,
  parseVideoFinishingTechnicalVerification,
  videoFinishingVerificationMatchesMedia,
  type VideoFinishingClipInput,
  type VideoFinishingTechnicalVerification,
} from "./video-orchestrator.finishing-verification";
import type { VideoNarrativeDeliveryVerification } from "./video-orchestrator.narrative-delivery-verification";

export type FinalVideoStatusEvidenceProjection = {
  concatVideoUrl?: string;
  concatNodeId?: string;
  masterVideoUrl?: string;
  masterNodeId?: string;
  deliveryEvidence: {
    kind: "video";
    runId: string;
    source: "persisted_canvas_compose_node" | "persisted_canvas_video_master_node";
    nodeId?: string;
    videoUrl?: string;
    sourceVideoUrl?: string;
    narrativeVerification?: VideoNarrativeDeliveryVerification;
    finishingVerification?: VideoFinishingTechnicalVerification;
  };
  deliveryVerification: {
    satisfied: boolean;
    expected: "durable_http_final_video_url";
    missingCriteria: string[];
    diagnostics?: string[];
    failureReason?: string;
  };
};

/** Require lifecycle success and a durable final-asset URL; post-generation review is diagnostic only. */
export function isSatisfiedFinalVideoStatus(status: Record<string, unknown>): boolean {
  const verification =
    status.deliveryVerification &&
    typeof status.deliveryVerification === "object" &&
    !Array.isArray(status.deliveryVerification)
      ? status.deliveryVerification as Record<string, unknown>
      : null;
  return status.success === true && verification?.satisfied === true;
}

/** Keep the completed media lifecycle fact while making top-level success mean durable asset delivery. */
export function buildFinalVideoGoalOutcomeProjection(
  status: Record<string, unknown>,
): {
  success: boolean;
  runSuccess: boolean;
  goalOutcome: "satisfied" | "unsatisfied";
  deliveryDiagnostic?: true;
  code?: "video_delivery_verification_unsatisfied";
} {
  const runSuccess = status.success === true;
  const success = isSatisfiedFinalVideoStatus(status);
  return {
    success,
    runSuccess,
    goalOutcome: success ? "satisfied" : "unsatisfied",
    ...(!success
      ? {
          deliveryDiagnostic: true as const,
          code: "video_delivery_verification_unsatisfied" as const,
        }
      : {}),
  };
}

function findRunEvidence(
  nodes: Array<Record<string, unknown>>,
  runId: string,
): FinalVideoDeliveryEvidence | null {
  const canonicalNodeId = `film-${runId}`;
  return (
    collectFinalVideoDeliveryEvidence({ nodes, edges: [] }).find(
      (evidence) => evidence.runId === runId && evidence.nodeId === canonicalNodeId,
    ) ?? null
  );
}

function readDurableHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

type MasterEvidence = FinalVideoDeliveryEvidence & {
  data: Record<string, unknown>;
  finishingVerification: VideoFinishingTechnicalVerification | null;
};

function findMasterEvidence(
  nodes: Array<Record<string, unknown>>,
  runId: string,
): MasterEvidence | null {
  const nodeId = `film-master-${runId}`;
  const node = nodes.find((candidate) => String(candidate.id ?? "").trim() === nodeId);
  const data = node?.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : null;
  if (
    !data ||
    data.finishingMaster !== true ||
    String(data.clipRunId ?? "").trim() !== runId ||
    String(data.status ?? "").trim().toLowerCase() !== "success"
  ) return null;
  const results = Array.isArray(data.videoResults) ? data.videoResults : [];
  const primaryIndex = Number.isInteger(data.videoPrimaryIndex) ? Number(data.videoPrimaryIndex) : 0;
  const selected = results[primaryIndex] && typeof results[primaryIndex] === "object"
    ? results[primaryIndex] as Record<string, unknown>
    : null;
  const videoUrl = readDurableHttpUrl(selected?.url) || readDurableHttpUrl(data.videoUrl);
  return videoUrl
    ? {
        runId,
        nodeId,
        videoUrl,
        data,
        finishingVerification: parseVideoFinishingTechnicalVerification(
          data.finishingVerification,
        ),
      }
    : null;
}

function collectMasterContractMismatches(
  evidence: MasterEvidence,
  contract: VideoFinishingContract,
  expectedSourceDurationSeconds: number,
  sourceResolution: string,
  sourceVideoUrl: string,
  clips: VideoFinishingClipInput[],
): string[] {
  const mismatches: string[] = [];
  const expectedFields: Array<[string, unknown]> = [
    ["videoTaskKind", contract.kind],
    ["videoModel", contract.modelKey],
    ["billingSpecKey", contract.billingSpecKey],
    ["toolVersion", contract.toolVersion],
    ["finishingScene", contract.scene],
    ["resolution", contract.resolution],
  ];
  for (const [field, expected] of expectedFields) {
    if (String(evidence.data[field] ?? "").trim() !== String(expected).trim()) {
      mismatches.push(`finishingContract.${field}`);
    }
  }
  if (
    typeof contract.fps === "number" &&
    Number(evidence.data.fps) !== contract.fps
  ) {
    mismatches.push("finishingContract.fps");
  }
  const verification = evidence.finishingVerification;
  if (!verification) {
    mismatches.push("finishingVerification");
  } else {
    if (verification.expected.sourceDurationSeconds !== expectedSourceDurationSeconds) {
      mismatches.push("finishingVerification.expected.sourceDurationSeconds");
    }
    if (verification.expected.resolution !== contract.resolution) {
      mismatches.push("finishingVerification.expected.resolution");
    }
    if (verification.expected.sourceResolution !== sourceResolution) {
      mismatches.push("finishingVerification.expected.sourceResolution");
    }
    if (
      typeof contract.fps === "number" &&
      verification.expected.fps !== contract.fps
    ) {
      mismatches.push("finishingVerification.expected.fps");
    }
    const recomputed = buildVideoFinishingTechnicalVerification({
      contract,
      expectedSourceDurationSeconds,
      sourceResolution,
      sourceVideoUrl: "https://verification.invalid/source",
      masterVideoUrl: "https://verification.invalid/master",
      clips: verification.clips.map((clip) => ({
        input: {
          clipIndex: clip.clipIndex,
          expectedDurationSeconds: clip.expectedDurationSeconds,
          videoUrl: `https://verification.invalid/clips/${clip.clipIndex}`,
          requiresAudio: clip.requiresAudio,
        },
        probe: clip.media,
      })),
      source: verification.source,
      master: verification.master,
      verifiedAt: verification.verifiedAt,
    });
    if (
      verification.satisfied !== recomputed.satisfied ||
      verification.missingCriteria.join("\u0000") !== recomputed.missingCriteria.join("\u0000")
    ) {
      mismatches.push("finishingVerification.integrity");
    }
    if (!videoFinishingVerificationMatchesMedia({
      verification,
      contract,
      expectedSourceDurationSeconds,
      sourceResolution,
      sourceVideoUrl,
      masterVideoUrl: evidence.videoUrl,
      clips,
    })) {
      mismatches.push("finishingVerification.mediaIdentity");
    }
    if (!recomputed.satisfied) {
      mismatches.push(
        ...recomputed.missingCriteria.map(
          (criterion) => `finishingVerification.${criterion}`,
        ),
      );
    }
  }
  return Array.from(new Set(mismatches));
}

function collectPersistedFinishingClipInputs(input: {
  nodes: Array<Record<string, unknown>>;
  runId: string;
  verification: VideoFinishingTechnicalVerification | null;
}): VideoFinishingClipInput[] {
  if (!input.verification) return [];
  return input.verification.clips.flatMap((clip) => {
    const node = input.nodes.find((candidate) => {
      const data = candidate.data && typeof candidate.data === "object" && !Array.isArray(candidate.data)
        ? candidate.data as Record<string, unknown>
        : null;
      return data &&
        String(data.clipRunId ?? "").trim() === input.runId &&
        Number(data.clipIndex) === clip.clipIndex &&
        String(data.status ?? "").trim().toLowerCase() === "success";
    });
    const data = node?.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? node.data as Record<string, unknown>
      : null;
    const results = Array.isArray(data?.videoResults) ? data.videoResults : [];
    const primaryIndex = Number.isInteger(data?.videoPrimaryIndex) ? Number(data?.videoPrimaryIndex) : 0;
    const selected = results[primaryIndex] && typeof results[primaryIndex] === "object"
      ? results[primaryIndex] as Record<string, unknown>
      : null;
    const videoUrl = readDurableHttpUrl(selected?.url) || readDurableHttpUrl(data?.videoUrl);
    return videoUrl
      ? [{
          clipIndex: clip.clipIndex,
          expectedDurationSeconds: clip.expectedDurationSeconds,
          videoUrl,
          requiresAudio: clip.requiresAudio,
        }]
      : [];
  });
}

/**
 * Project the persisted final compose-node fact into the status response.
 *
 * `video_runs` intentionally stores lifecycle state rather than duplicating
 * canvas asset URLs. A terminal status therefore has to rejoin the canonical
 * `film-${runId}` node before it can claim delivery. This helper performs only
 * structural evidence selection; it never infers completion from labels,
 * prompts, clip counts, or a terminal state alone.
 */
export function buildFinalVideoStatusEvidenceProjection(input: {
  runId: string;
  nodes: Array<Record<string, unknown>> | null;
  readFailureReason?: string;
  finishingContract?: VideoFinishingContract | null;
  expectedSourceDurationSeconds?: number | null;
  sourceResolution?: string | null;
  narrativeVerification?: VideoNarrativeDeliveryVerification | null;
}): FinalVideoStatusEvidenceProjection {
  const sourceEvidence = input.nodes ? findRunEvidence(input.nodes, input.runId) : null;
  const narrativeVerification = input.narrativeVerification ?? null;
  if (input.finishingContract) {
    const expectedSourceDurationSeconds = Number(input.expectedSourceDurationSeconds);
    const hasExpectedSourceDuration =
      Number.isFinite(expectedSourceDurationSeconds) && expectedSourceDurationSeconds > 0;
    const masterEvidence = input.nodes
      ? findMasterEvidence(input.nodes, input.runId)
      : null;
    const sourceResolution = String(input.sourceResolution ?? "").trim();
    const finishingClips = input.nodes && masterEvidence
      ? collectPersistedFinishingClipInputs({
          nodes: input.nodes,
          runId: input.runId,
          verification: masterEvidence.finishingVerification,
        })
      : [];
    const diagnostics = [
      ...(!sourceEvidence ? ["postGeneration.concatVideoUrl"] : []),
      ...(!hasExpectedSourceDuration ? ["postGeneration.expectedSourceDurationSeconds"] : []),
      ...(!sourceResolution ? ["postGeneration.sourceResolution"] : []),
      ...(!narrativeVerification
        ? ["postGeneration.narrativeVerification"]
        : narrativeVerification.satisfied
          ? []
          : narrativeVerification.missingCriteria.map((criterion) => `postGeneration.${criterion}`)),
      ...(masterEvidence
        ? hasExpectedSourceDuration && sourceEvidence && sourceResolution
          ? collectMasterContractMismatches(
              masterEvidence,
              input.finishingContract,
              expectedSourceDurationSeconds,
              sourceResolution,
              sourceEvidence.videoUrl,
              finishingClips,
            )
              .map((criterion) => `postGeneration.${criterion}`)
          : ["postGeneration.finishingVerificationInputs"]
        : []),
    ];
    const missingCriteria = masterEvidence ? [] : ["masterVideoUrl"];
    const satisfied = missingCriteria.length === 0;
    const failureReason = input.readFailureReason?.trim()
      && !masterEvidence
      ? `final_video_evidence_read_failed: ${input.readFailureReason.trim()}`
      : !masterEvidence
        ? "final_video_url_not_found_on_persisted_finishing_master_node"
        : undefined;
    return {
      ...(sourceEvidence
        ? { concatVideoUrl: sourceEvidence.videoUrl, concatNodeId: sourceEvidence.nodeId }
        : {}),
      ...(masterEvidence
        ? { masterVideoUrl: masterEvidence.videoUrl, masterNodeId: masterEvidence.nodeId }
        : {}),
      deliveryEvidence: {
        kind: "video",
        runId: input.runId,
        source: "persisted_canvas_video_master_node",
        ...(masterEvidence
          ? {
              nodeId: masterEvidence.nodeId,
              videoUrl: masterEvidence.videoUrl,
              ...(masterEvidence.finishingVerification
                ? { finishingVerification: masterEvidence.finishingVerification }
                : {}),
            }
          : {}),
        ...(sourceEvidence ? { sourceVideoUrl: sourceEvidence.videoUrl } : {}),
        ...(narrativeVerification ? { narrativeVerification } : {}),
      },
      deliveryVerification: {
        satisfied,
        expected: "durable_http_final_video_url",
        missingCriteria,
        ...(diagnostics.length > 0 ? { diagnostics: Array.from(new Set(diagnostics)) } : {}),
        ...(failureReason ? { failureReason } : {}),
      },
    };
  }

  const evidence = sourceEvidence;
  if (evidence) {
    const diagnostics = !narrativeVerification
      ? ["postGeneration.narrativeVerification"]
      : narrativeVerification.satisfied
        ? []
        : narrativeVerification.missingCriteria.map((criterion) => `postGeneration.${criterion}`);
    return {
      concatVideoUrl: evidence.videoUrl,
      concatNodeId: evidence.nodeId,
      deliveryEvidence: {
        kind: "video",
        runId: input.runId,
        source: "persisted_canvas_compose_node",
        nodeId: evidence.nodeId,
        videoUrl: evidence.videoUrl,
        ...(narrativeVerification ? { narrativeVerification } : {}),
      },
      deliveryVerification: {
        satisfied: true,
        expected: "durable_http_final_video_url",
        missingCriteria: [],
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      },
    };
  }

  const failureReason = input.readFailureReason?.trim()
    ? `final_video_evidence_read_failed: ${input.readFailureReason.trim()}`
    : "final_video_url_not_found_on_persisted_compose_node";
  return {
    deliveryEvidence: {
      kind: "video",
      runId: input.runId,
      source: "persisted_canvas_compose_node",
    },
    deliveryVerification: {
      satisfied: false,
      expected: "durable_http_final_video_url",
      missingCriteria: ["concatVideoUrl"],
      failureReason,
    },
  };
}
