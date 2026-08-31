import { describe, expect, it } from "vitest";
import {
  assessPreSubmitResume,
  assessPreNodeCreationResume,
  buildPreSubmitProductionArtifactRoots,
  buildPreSubmitReferenceRepair,
  hasPreNodeCreationResumeAuthority,
  readVerifiedClipPreSubmitFailureReceipts,
  readVerifiedRunPreSubmitFailureReceipt,
} from "./video-orchestrator.pre-submit-resume";
import {
  assessPreSubmitCapacityEvidence,
  resolvePreSubmitEvidenceStartedAfter,
  verifyPreSubmitCapacityEvidence,
} from "./video-orchestrator.pre-submit-evidence";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import { stableContentHash } from "./video-orchestrator.authoring.repo";
import { VIDEO_ORCHESTRATOR_PROTOCOL_VERSION } from "@tapcanvas/video-orchestrator-protocol";

function node(data: Record<string, unknown>): VideoFlowNode {
  const referenceType = data.referenceType;
  return {
    id: String(data.id ?? "node-1"),
    data: {
      ...data,
      ...(referenceType === "character" && !data.characterProfileVersion
        ? { characterProfileVersion: "character-card/v3" }
        : {}),
      ...(referenceType === "scene" && !data.sceneProfileVersion
        ? { sceneProfileVersion: "scene-card/v1" }
        : {}),
    },
  };
}

describe("pre-submit video run resume evidence", () => {
  it("reopens the durable result nodes for exactly the structurally failed clip indexes", () => {
    expect(buildPreSubmitProductionArtifactRoots([
      node({ id: "clip-2", clipIndex: 2 }),
      node({ id: "clip-0", clipIndex: 0 }),
      node({ id: "clip-2-duplicate", clipIndex: 2 }),
      node({ id: "clip-invalid", clipIndex: "not-an-index" }),
    ])).toEqual(["video-result:0", "video-result:2"]);
  });

  it("uses a hash-bound clip receipt to recover a half-reset canvas status", () => {
    const requestHash = "request-hash-3";
    const receipt = {
      kind: "structured_pre_upstream_rejection",
      phase: "pre_upstream",
      runId: "run-1",
      clipIndex: 3,
      requestHash,
      providerRequestAttempted: false,
      providerAccepted: false,
      verifiedBy: "hono_video_submission_boundary",
      errorCode: "provider_contract_rejected",
    };
    const verified = readVerifiedClipPreSubmitFailureReceipts({
      runId: "run-1",
      artifacts: [{
        artifact_key: "video-submission:3",
        status: "stale",
        payload: JSON.stringify(receipt),
        content_hash: requestHash,
      }],
    });
    expect(verified).toEqual([{
      artifactKey: "video-submission:3",
      clipIndex: 3,
      errorCode: "provider_contract_rejected",
    }]);
    const halfResetNode = node({
      id: "clip-3",
      kind: "video",
      clipRunId: "run-1",
      clipIndex: 3,
      status: "submit_retrying",
    });
    const assessment = assessPreSubmitResume(
      [halfResetNode],
      "run-1",
      new Set([halfResetNode.id]),
      new Set(verified.map((item) => item.clipIndex)),
    );
    expect(assessment.eligible).toBe(true);
    expect(assessment.failedNodes.map((item) => item.id)).toEqual(["clip-3"]);
  });

  it("rejects a clip receipt whose request hash does not match the durable artifact", () => {
    expect(readVerifiedClipPreSubmitFailureReceipts({
      runId: "run-1",
      artifacts: [{
        artifact_key: "video-submission:0",
        status: "stale",
        payload: JSON.stringify({
          kind: "structured_pre_upstream_rejection",
          phase: "pre_upstream",
          runId: "run-1",
          clipIndex: 0,
          requestHash: "request-a",
          providerRequestAttempted: false,
          providerAccepted: false,
          verifiedBy: "hono_video_submission_boundary",
        }),
        content_hash: "request-b",
      }],
    })).toEqual([]);
  });

  it("accepts a legacy submit_failed node only when it has no task identity or video asset", () => {
    const assessment = assessPreSubmitResume([
      node({
        id: "clip-0",
        kind: "video",
        clipRunId: "run-1",
        clipIndex: 0,
        status: "submit_failed",
        clipSubmitAttempts: 3,
      }),
    ], "run-1");

    expect(assessment.eligible).toBe(true);
    expect(assessment.failedNodes.map((item) => item.id)).toEqual(["clip-0"]);
  });

  it.each([
    ["task identity", { taskId: "task-1" }, "upstream_task_identity_present"],
    ["uncertain phase", { clipSubmitPhase: "upstream_uncertain" }, "submission_phase_not_pre_upstream"],
    ["uncertain flag", { upstreamSubmitUncertain: true }, "upstream_submission_uncertain"],
    ["video asset", { videoUrl: "https://assets.example/clip.mp4" }, "video_asset_already_present"],
  ])("rejects %s evidence", (_label, extra, expectedCode) => {
    const assessment = assessPreSubmitResume([
      node({
        id: "clip-0",
        kind: "video",
        clipRunId: "run-1",
        status: "submit_failed",
        ...extra,
      }),
    ], "run-1");

    expect(assessment.eligible).toBe(false);
    expect(assessment.blockers.map((blocker) => blocker.code)).toContain(expectedCode);
  });

  it("accepts an old upstream_uncertain marker only when the node has external structured evidence", () => {
    const assessment = assessPreSubmitResume([
      node({
        id: "clip-0",
        kind: "video",
        clipRunId: "run-1",
        clipIndex: 0,
        status: "submit_failed",
        clipSubmitPhase: "upstream_uncertain",
        upstreamSubmitUncertain: true,
      }),
    ], "run-1", new Set(["clip-0"]));

    expect(assessment.eligible).toBe(true);
  });

  it("accepts the audited legacy local model gate despite its old uncertain projection", () => {
    const assessment = assessPreSubmitResume([
      node({
        id: "clip-0",
        kind: "video",
        clipRunId: "run-1",
        clipIndex: 0,
        status: "submit_failed",
        clipSubmitPhase: "upstream_uncertain",
        upstreamSubmitUncertain: true,
        clipSubmitErrorCode: "new_api_model_disabled",
      }),
    ], "run-1");

    expect(assessment.eligible).toBe(true);
  });

  it("accepts an audited legacy prompt hard-gate failure without a task or asset", () => {
    const assessment = assessPreSubmitResume([
      node({
        id: "clip-8",
        kind: "video",
        clipRunId: "run-1",
        clipIndex: 8,
        status: "submit_failed",
        clipSubmitPhase: "upstream_uncertain",
        upstreamSubmitUncertain: false,
        clipSubmitErrorCode: "video_prompt_too_long",
        taskId: "",
        videoTaskId: "",
      }),
    ], "run-1");

    expect(assessment.eligible).toBe(true);
  });

  it("accepts a structurally known pre-upstream failure before any video node was created", () => {
    expect(assessPreNodeCreationResume({
      nodes: [],
      runId: "run-1",
      clipsDone: 0,
      errorCode: "clip_video_reference_node_missing",
    })).toEqual({ eligible: true, failedNodes: [], blockers: [] });
  });

  it("accepts the legacy identity-resolution rejection only as pre-node resume authority", () => {
    const errorCode = "clip_reference_asset_identity_unresolved";
    expect(assessPreNodeCreationResume({
      nodes: [],
      runId: "run-identity",
      clipsDone: 0,
      errorCode,
    })).toEqual({ eligible: true, failedNodes: [], blockers: [] });
    expect(hasPreNodeCreationResumeAuthority({
      errorCode,
      hasVerifiedRunReceipt: false,
    })).toBe(true);
  });

  it("still requires a plan delta or signed receipt for an unknown node-less failure", () => {
    expect(hasPreNodeCreationResumeAuthority({
      errorCode: "unknown_local_failure",
      hasVerifiedRunReceipt: false,
    })).toBe(false);
    expect(hasPreNodeCreationResumeAuthority({
      errorCode: "unknown_local_failure",
      hasVerifiedRunReceipt: true,
    })).toBe(true);
  });

  it("preserves a successful run-scoped clip while resuming a different pre-submit failure", () => {
    const assessment = assessPreNodeCreationResume({
      nodes: [node({
        id: "clip-0",
        kind: "video",
        clipRunId: "run-1",
        clipIndex: 0,
        status: "success",
        taskId: "task-0",
        videoUrl: "https://assets.example/clip-0.mp4",
      })],
      runId: "run-1",
      clipsDone: 0,
      errorCode: "clip_video_reference_node_missing",
    });
    expect(assessment).toEqual({ eligible: true, failedNodes: [], blockers: [] });
  });

  it.each([
    ["success without asset", { status: "success", taskId: "task-0" }, "successful_run_node_asset_missing"],
    ["running without task", { status: "running" }, "active_run_node_task_identity_missing"],
    ["failed node", { status: "failed" }, "run_node_state_not_reconcilable"],
  ])("rejects ambiguous partial-run evidence: %s", (_label, extra, expectedCode) => {
    const assessment = assessPreNodeCreationResume({
      nodes: [node({ id: "clip-0", kind: "video", clipRunId: "run-1", clipIndex: 0, ...extra })],
      runId: "run-1",
      clipsDone: 0,
      errorCode: "clip_video_reference_node_missing",
    });
    expect(assessment.eligible).toBe(false);
    expect(assessment.blockers.map((item) => item.code)).toContain(expectedCode);
  });

  it("accepts only a hash-bound run-level receipt matching the persisted error code", () => {
    const receipt = {
      version: 1,
      code: "speaker_voice_asset_duration_invalid",
      status: 422,
      upstreamRequestAttempted: false,
      clipsDone: 0,
      recordedAt: "2026-08-08T11:26:35.070Z",
    };
    expect(readVerifiedRunPreSubmitFailureReceipt({
      artifacts: [{
        artifact_key: "production:pre_submit_failure",
        status: "ready",
        payload: JSON.stringify(receipt),
        content_hash: stableContentHash(receipt),
      }],
      errorCode: receipt.code,
      clipsDone: 0,
    })).toEqual(receipt);
    expect(readVerifiedRunPreSubmitFailureReceipt({
      artifacts: [{
        artifact_key: "production:pre_submit_failure",
        status: "ready",
        payload: JSON.stringify(receipt),
        content_hash: "tampered",
      }],
      errorCode: receipt.code,
      clipsDone: 0,
    })).toBeNull();
  });
});

describe("pre-submit durable reference repair", () => {
  it("binds a uniquely proven current asset that was created after the frozen contract", () => {
    const currentNodeId = "asset-character-doctor";
    const contract = {
      kind: "character",
      name: "卫生所医生",
      referenceRole: "identity",
      referenceImageNodeIds: [],
    };
    const beatSheetJson = JSON.stringify({
      version: 2,
      meta: {},
      beats: [{ clipIndex: 0, videoReferenceNodeIds: [], assetObjectContracts: [contract] }],
    });
    const planPayload = {
      protocolVersion: VIDEO_ORCHESTRATOR_PROTOCOL_VERSION,
      runId: "run-1",
      clips: [{ clipIndex: 0, videoReferenceNodeIds: [], assetObjectContracts: [contract] }],
    };
    const result = buildPreSubmitReferenceRepair({
      beatSheetJson,
      storyPlanJson: JSON.stringify({
        ...planPayload,
        executablePlanHash: stableContentHash(planPayload),
      }),
      currentNodes: [node({
        id: currentNodeId,
        kind: "image",
        referenceType: "character",
        roleName: "卫生所医生",
        imageUrl: "https://assets.example/doctor.png",
      })],
    });

    const repairedBeatSheet = JSON.parse(result.beatSheetJson) as {
      beats: Array<{
        videoReferenceNodeIds: string[];
        assetObjectContracts: Array<{ referenceImageNodeIds: string[] }>;
      }>;
    };
    expect(repairedBeatSheet.beats[0]?.videoReferenceNodeIds).toEqual([currentNodeId]);
    expect(repairedBeatSheet.beats[0]?.assetObjectContracts[0]?.referenceImageNodeIds).toEqual([
      currentNodeId,
    ]);
    expect(result.evidence.beatSheet.bound).toEqual([{
      newNodeId: currentNodeId,
      kind: "character",
      name: "卫生所医生",
      clipIndexes: [0],
    }]);
    expect(result.evidence.beatSheet.unresolved).toEqual([]);
  });

  it("rebinds BeatSheet and executable plan to the same unique current canvas node", () => {
    const oldAssetId = "material-asset-character-shenzhixia";
    const currentNodeId = "asset-manifest-character-沈知夏";
    const contract = {
      kind: "character",
      name: "沈知夏",
      referenceRole: "identity",
      referenceImageNodeIds: [oldAssetId],
    };
    const beatSheetJson = JSON.stringify({
      version: 2,
      meta: {},
      beats: [{
        clipIndex: 0,
        videoReferenceNodeIds: [oldAssetId],
        assetObjectContracts: [contract],
      }],
    });
    const planPayload = {
      protocolVersion: VIDEO_ORCHESTRATOR_PROTOCOL_VERSION,
      runId: "run-1",
      clips: [{
        clipIndex: 0,
        videoReferenceNodeIds: [oldAssetId],
        assetObjectContracts: [contract],
      }],
    };
    const result = buildPreSubmitReferenceRepair({
      beatSheetJson,
      storyPlanJson: JSON.stringify({
        ...planPayload,
        executablePlanHash: stableContentHash(planPayload),
      }),
      currentNodes: [node({
        id: currentNodeId,
        kind: "image",
        referenceType: "character",
        roleName: "沈知夏",
        imageUrl: "https://assets.example/shenzhixia.png",
      })],
    });

    const repairedBeatSheet = JSON.parse(result.beatSheetJson) as {
      beats: Array<{ videoReferenceNodeIds: string[]; assetObjectContracts: Array<{ referenceImageNodeIds: string[] }> }>;
    };
    const repairedPlan = JSON.parse(result.storyPlanJson) as {
      clips: Array<{ videoReferenceNodeIds: string[]; assetObjectContracts: Array<{ referenceImageNodeIds: string[] }> }>;
      executablePlanHash: string;
      [key: string]: unknown;
    };
    expect(repairedBeatSheet.beats[0]?.videoReferenceNodeIds).toEqual([currentNodeId]);
    expect(repairedBeatSheet.beats[0]?.assetObjectContracts[0]?.referenceImageNodeIds).toEqual([currentNodeId]);
    expect(repairedPlan.clips[0]?.videoReferenceNodeIds).toEqual([currentNodeId]);
    expect(repairedPlan.clips[0]?.assetObjectContracts[0]?.referenceImageNodeIds).toEqual([currentNodeId]);
    const { executablePlanHash, ...hashPayload } = repairedPlan;
    expect(executablePlanHash).toBe(stableContentHash(hashPayload));
    expect(result.evidence.beatSheet.unresolved).toEqual([]);
    expect(result.evidence.storyPlan.unresolved).toEqual([]);
  });

  it("keeps an ambiguous identity unresolved instead of selecting a canvas node", () => {
    const oldNodeId = "old-character-node";
    const beatSheetJson = JSON.stringify({
      version: 2,
      beats: [{
        clipIndex: 0,
        videoReferenceNodeIds: [oldNodeId],
        assetObjectContracts: [{
          kind: "character",
          name: "沈知夏",
          referenceImageNodeIds: [oldNodeId],
        }],
      }],
    });
    const planPayload = {
      protocolVersion: VIDEO_ORCHESTRATOR_PROTOCOL_VERSION,
      clips: [{
        clipIndex: 0,
        videoReferenceNodeIds: [oldNodeId],
        assetObjectContracts: [{
          kind: "character",
          name: "沈知夏",
          referenceImageNodeIds: [oldNodeId],
        }],
      }],
    };
    const duplicateNodes = ["character-a", "character-b"].map((id) => node({
      id,
      kind: "image",
      referenceType: "character",
      roleName: "沈知夏",
      imageUrl: `https://assets.example/${id}.png`,
    }));
    const result = buildPreSubmitReferenceRepair({
      beatSheetJson,
      storyPlanJson: JSON.stringify({
        ...planPayload,
        executablePlanHash: stableContentHash(planPayload),
      }),
      currentNodes: duplicateNodes,
    });

    expect(result.evidence.beatSheet.unresolved).toContainEqual(expect.objectContaining({
      nodeId: oldNodeId,
      reason: "current_identity_ambiguous",
    }));
    expect(result.evidence.storyPlan.unresolved).toContainEqual(expect.objectContaining({
      nodeId: oldNodeId,
      reason: "current_identity_ambiguous",
    }));
  });
});

describe("structured capacity rejection evidence", () => {
  const failedNode = node({
    id: "clip-0",
    kind: "video",
    clipRunId: "run-1",
    clipIndex: 0,
    status: "submit_failed",
  });
  const storyboardNode = node({
    id: "storyboard-0",
    kind: "image",
    imageUrl: "https://assets.example/frame-0.png",
  });
  const vendorLog = {
    taskId: "failed-structured-id",
    startedAt: "2026-07-22T08:16:00.000Z",
    requestJson: JSON.stringify({
      request: {
        prompt: "frozen prompt",
        extras: { firstFrameUrl: "https://assets.example/frame-0.png" },
      },
    }),
    responseJson: JSON.stringify({
      status: 429,
      error: { code: "membership_concurrency_limit_reached" },
    }),
  };

  function verify(overrides?: {
    vendorLog?: typeof vendorLog;
    taskResultTaskIds?: Set<string>;
    vendorRefTaskIds?: Set<string>;
    ledgerTaskIds?: Set<string>;
  }) {
    return verifyPreSubmitCapacityEvidence({
      failedNodes: [failedNode],
      flowNodes: [failedNode, storyboardNode],
      storyPlanJson: JSON.stringify({
        clips: [{ clipPrompt: "frozen prompt", storyboardImageNodeId: "storyboard-0" }],
      }),
      vendorLogs: [overrides?.vendorLog ?? vendorLog],
      taskResultTaskIds: overrides?.taskResultTaskIds ?? new Set(),
      vendorRefTaskIds: overrides?.vendorRefTaskIds ?? new Set(),
      ledgerTaskIds: overrides?.ledgerTaskIds ?? new Set(),
    });
  }

  it("verifies exact frozen prompt plus structured pre-upstream rejection", () => {
    expect(verify()).toEqual([{
      nodeId: "clip-0",
      clipIndex: 0,
      vendorLogTaskId: "failed-structured-id",
      vendorLogStartedAt: "2026-07-22T08:16:00.000Z",
      code: "membership_concurrency_limit_reached",
    }]);
  });

  it("verifies a structured Seedance reference-mode conflict without reading error prose", () => {
    const nestedError = JSON.stringify({
      error: {
        code: "InvalidParameter",
        message: "provider prose can change",
        param: "content",
        type: "BadRequest",
      },
    });
    const result = verify({
      vendorLog: {
        ...vendorLog,
        requestJson: JSON.stringify({
          request: {
            prompt: "frozen prompt\n\n[参考与一致性] exact appended contract",
            extras: {
              firstFrameUrl: "https://assets.example/frame-0.png",
              referenceMediaManifest: {
                images: [
                  { url: "https://assets.example/character.png", role: "reference_image" },
                  { url: "https://assets.example/frame-0.png", role: "first_frame" },
                ],
                audios: [{ url: "https://assets.example/voice.mp3", role: "reference_audio" }],
              },
            },
          },
        }),
        responseJson: JSON.stringify({
          status: 400,
          error: {
            code: "newapi:newapi_request_failed",
            details: {
              upstreamStatus: 400,
              upstreamData: { code: "fail_to_fetch_task", message: nestedError },
            },
          },
        }),
      },
    });

    expect(result).toEqual([{
      nodeId: "clip-0",
      clipIndex: 0,
      vendorLogTaskId: "failed-structured-id",
      vendorLogStartedAt: "2026-07-22T08:16:00.000Z",
      code: "seedance_reference_mode_conflict",
    }]);
  });

  it("verifies the same structured conflict for reference video plus a literal frame", () => {
    const nestedError = JSON.stringify({
      error: {
        code: "InvalidParameter",
        message: "provider prose can change",
        param: "content",
        type: "BadRequest",
      },
    });
    const result = verify({
      vendorLog: {
        ...vendorLog,
        requestJson: JSON.stringify({
          request: {
            prompt: "frozen prompt\n\n[参考与一致性] exact appended contract",
            extras: {
              firstFrameUrl: "https://assets.example/frame-0.png",
              upstreamVideoUrl: "https://assets.example/previous.mp4",
              referenceMediaManifest: {
                images: [{
                  url: "https://assets.example/frame-0.png",
                  role: "first_frame",
                }],
                audios: [],
              },
            },
          },
        }),
        responseJson: JSON.stringify({
          status: 400,
          error: {
            code: "newapi:newapi_request_failed",
            details: {
              upstreamStatus: 400,
              upstreamData: { code: "fail_to_fetch_task", message: nestedError },
            },
          },
        }),
      },
    });

    expect(result).toEqual([{
      nodeId: "clip-0",
      clipIndex: 0,
      vendorLogTaskId: "failed-structured-id",
      vendorLogStartedAt: "2026-07-22T08:16:00.000Z",
      code: "seedance_reference_mode_conflict",
    }]);
  });

  it("does not reuse older recoverable evidence after a newer exact request failed differently", () => {
    const recoverable = {
      ...vendorLog,
      requestJson: JSON.stringify({
        request: {
          prompt: "frozen prompt\n\n[参考与一致性] exact appended contract",
          extras: {
            firstFrameUrl: "https://assets.example/frame-0.png",
            upstreamVideoUrl: "https://assets.example/previous.mp4",
            referenceMediaManifest: {
              images: [{
                url: "https://assets.example/frame-0.png",
                role: "first_frame",
              }],
              audios: [],
            },
          },
        },
      }),
      responseJson: JSON.stringify({
        status: 400,
        error: {
          code: "newapi:newapi_request_failed",
          details: {
            upstreamStatus: 400,
            upstreamData: {
              code: "fail_to_fetch_task",
              message: JSON.stringify({
                error: {
                  code: "InvalidParameter",
                  message: "provider prose can change",
                  param: "content",
                  type: "BadRequest",
                },
              }),
            },
          },
        },
      }),
    };
    const newerUnknownFailure = {
      ...recoverable,
      taskId: "failed-newer-unknown",
      startedAt: "2026-07-22T08:17:00.000Z",
      responseJson: JSON.stringify({
        status: 500,
        error: { code: "newapi:newapi_request_failed" },
      }),
    };

    const result = assessPreSubmitCapacityEvidence({
      failedNodes: [failedNode],
      flowNodes: [failedNode, storyboardNode],
      storyPlanJson: JSON.stringify({
        clips: [{ clipPrompt: "frozen prompt", storyboardImageNodeId: "storyboard-0" }],
      }),
      vendorLogs: [recoverable, newerUnknownFailure],
      taskResultTaskIds: new Set(),
      vendorRefTaskIds: new Set(),
      ledgerTaskIds: new Set(),
    });

    expect(result.verified).toEqual([]);
    expect(result.diagnostics[0]?.vendorLogs[0]).toMatchObject({
      taskId: "failed-newer-unknown",
      mismatchReasons: ["structured_rejection_mismatch"],
    });
  });

  it("uses the earlier run timestamp so later drive claims cannot hide prior vendor logs", () => {
    expect(resolvePreSubmitEvidenceStartedAfter({
      created_at: "2026-07-22T09:07:00.000Z",
      updated_at: "2026-07-22T09:16:00.032Z",
      last_drive_at: "2026-07-22T09:18:00.107Z",
    })).toBe("2026-07-22T09:07:00.000Z");
  });

  it("verifies a frozen prompt followed by deterministic request assembly", () => {
    expect(verify({
      vendorLog: {
        ...vendorLog,
        requestJson: JSON.stringify({
          request: {
            prompt: "frozen prompt\n\n[参考与一致性] exact appended contract",
            extras: { firstFrameUrl: "https://assets.example/frame-0.png" },
          },
        }),
      },
    })).toHaveLength(1);
  });

  it("verifies the exact retained projection when the frozen prompt exceeds the log limit", () => {
    const longPrompt = `frozen-${"甲".repeat(1900)}`;
    const finalPrompt = `${longPrompt}\n\n[参考与一致性] exact appended contract`;
    const loggedPrompt = `${finalPrompt.slice(0, 1800)}…(truncated, len=${finalPrompt.length})`;
    const result = verifyPreSubmitCapacityEvidence({
      failedNodes: [failedNode],
      flowNodes: [failedNode, storyboardNode],
      storyPlanJson: JSON.stringify({
        clips: [{ clipPrompt: longPrompt, storyboardImageNodeId: "storyboard-0" }],
      }),
      vendorLogs: [{
        ...vendorLog,
        requestJson: JSON.stringify({
          request: {
            prompt: loggedPrompt,
            extras: { firstFrameUrl: "https://assets.example/frame-0.png" },
          },
        }),
      }],
      taskResultTaskIds: new Set(),
      vendorRefTaskIds: new Set(),
      ledgerTaskIds: new Set(),
    });

    expect(result).toHaveLength(1);
  });

  it("rejects a short prompt that only shares an arbitrary textual prefix", () => {
    expect(verify({
      vendorLog: {
        ...vendorLog,
        requestJson: JSON.stringify({
          request: {
            prompt: "frozen prompt but not the deterministic append boundary",
            extras: { firstFrameUrl: "https://assets.example/frame-0.png" },
          },
        }),
      },
    })).toEqual([]);
  });

  it.each([
    ["different prompt", {
      ...vendorLog,
      requestJson: JSON.stringify({
        request: {
          prompt: "other",
          extras: { firstFrameUrl: "https://assets.example/frame-0.png" },
        },
      }),
    }],
    ["different first frame", {
      ...vendorLog,
      requestJson: JSON.stringify({
        request: {
          prompt: "frozen prompt",
          extras: { firstFrameUrl: "https://assets.example/other.png" },
        },
      }),
    }],
    ["different code", { ...vendorLog, responseJson: JSON.stringify({ status: 429, error: { code: "other" } }) }],
    ["non-synthetic task id", { ...vendorLog, taskId: "real-task-id" }],
  ])("rejects %s", (_label, rejectedLog) => {
    expect(verify({ vendorLog: rejectedLog })).toEqual([]);
  });

  it.each([
    ["task result", { taskResultTaskIds: new Set([vendorLog.taskId]) }],
    ["vendor ref", { vendorRefTaskIds: new Set([vendorLog.taskId]) }],
    ["ledger entry", { ledgerTaskIds: new Set([vendorLog.taskId]) }],
  ])("rejects evidence with a %s", (_label, conflictingEvidence) => {
    expect(verify(conflictingEvidence)).toEqual([]);
  });

  it("reports exact non-sensitive mismatch reasons per candidate vendor log", () => {
    const assessment = assessPreSubmitCapacityEvidence({
      failedNodes: [failedNode],
      flowNodes: [failedNode, storyboardNode],
      storyPlanJson: JSON.stringify({
        clips: [{ clipPrompt: "frozen prompt", storyboardImageNodeId: "storyboard-0" }],
      }),
      vendorLogs: [{
        ...vendorLog,
        requestJson: JSON.stringify({
          request: {
            prompt: "other",
            extras: { firstFrameUrl: "https://assets.example/other.png" },
          },
        }),
      }],
      taskResultTaskIds: new Set(),
      vendorRefTaskIds: new Set(),
      ledgerTaskIds: new Set([vendorLog.taskId]),
    });

    expect(assessment.verified).toEqual([]);
    expect(assessment.diagnostics).toEqual([{
      nodeId: "clip-0",
      clipIndex: 0,
      candidateLogCount: 1,
      mismatchReasons: [
        "prompt_serialization_mismatch",
        "first_frame_mismatch",
        "ledger_present",
      ],
      vendorLogs: [{
        taskId: "failed-structured-id",
        startedAt: "2026-07-22T08:16:00.000Z",
        code: "membership_concurrency_limit_reached",
        mismatchReasons: [
          "prompt_serialization_mismatch",
          "first_frame_mismatch",
          "ledger_present",
        ],
      }],
    }]);
  });

  it("reports missing run inputs before comparing vendor logs", () => {
    const assessment = assessPreSubmitCapacityEvidence({
      failedNodes: [failedNode],
      flowNodes: [failedNode],
      storyPlanJson: JSON.stringify({ clips: [] }),
      vendorLogs: [],
      taskResultTaskIds: new Set(),
      vendorRefTaskIds: new Set(),
      ledgerTaskIds: new Set(),
    });

    expect(assessment.verified).toEqual([]);
    expect(assessment.diagnostics[0]).toMatchObject({
      nodeId: "clip-0",
      clipIndex: 0,
      candidateLogCount: 0,
      mismatchReasons: [
        "planned_clip_missing",
        "planned_prompt_missing",
        "vendor_log_missing",
      ],
    });
  });
});
