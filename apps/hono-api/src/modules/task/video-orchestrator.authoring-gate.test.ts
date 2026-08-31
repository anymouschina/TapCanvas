import { describe, expect, it } from "vitest";

import {
  evaluateAuthoringPaidOperationGate,
  evaluateAuthoringProductionStateGate,
} from "./video-orchestrator.authoring-gate";

describe("authoring production-state gate", () => {
  it("创作半场未交棒且生产态已离开 collecting 时显式冲突", () => {
    expect(
      evaluateAuthoringProductionStateGate({
        authoringState: "writing_dispatched",
        productionState: "video_running",
      }),
    ).toMatchObject({ allowed: false, code: "authoring_production_state_conflict" });
  });

  it("正常创作态和已到交棒闸的状态不拦截", () => {
    expect(
      evaluateAuthoringProductionStateGate({
        authoringState: "script_approved",
        productionState: "collecting",
      }),
    ).toEqual({ allowed: true });
    expect(
      evaluateAuthoringProductionStateGate({
        authoringState: "estimate_ready",
        productionState: "scheduled",
      }),
    ).toEqual({ allowed: true });
  });
});

describe("authoring paid-operation gate", () => {
  const currentPlanFingerprint = "speaker-plan-v1-current";
  const matchingPlanEvidence = {
    speakerCoveragePlanFingerprint: currentPlanFingerprint,
    actualPlanFingerprint: currentPlanFingerprint,
  } as const;

  it("不影响未启用 commit_beats 的旧散跑路径", () => {
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "start",
        authoringState: null,
        speakerCoverageStatus: null,
        ...matchingPlanEvidence,
      }),
    ).toEqual({ allowed: true });
  });

  it("writing_dispatched 禁止 estimate，不能用历史 storyPlan 绕过前置流程", () => {
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "estimate",
        authoringState: "writing_dispatched",
        speakerCoverageStatus: null,
        ...matchingPlanEvidence,
      }),
    ).toMatchObject({ allowed: false, code: "authoring_not_ready_for_estimate" });
  });

  it("writing_dispatched 禁止 start，即使调用方已有旧确认令牌", () => {
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "start",
        authoringState: "writing_dispatched",
        speakerCoverageStatus: "ready",
        ...matchingPlanEvidence,
      }),
    ).toMatchObject({ allowed: false, code: "authoring_not_ready_for_start" });
  });

  it("driver 只能在剧本已批且 speaker coverage ready 后 estimate", () => {
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "estimate",
        authoringState: "assets_ready",
        speakerCoverageStatus: "ready",
        invokedByAuthoringDriver: true,
        ...matchingPlanEvidence,
      }),
    ).toEqual({ allowed: true });
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "estimate",
        authoringState: "assets_ready",
        speakerCoverageStatus: "failed",
        invokedByAuthoringDriver: true,
        ...matchingPlanEvidence,
      }),
    ).toMatchObject({ allowed: false, code: "speaker_coverage_not_ready" });
  });

  it("estimate_ready 仍必须有 ready coverage 才允许显式 start", () => {
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "start",
        authoringState: "estimate_ready",
        speakerCoverageStatus: "ready",
        ...matchingPlanEvidence,
      }),
    ).toEqual({ allowed: true });
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "start",
        authoringState: "estimate_ready",
        speakerCoverageStatus: null,
        ...matchingPlanEvidence,
      }),
    ).toMatchObject({ allowed: false, code: "speaker_coverage_not_ready" });
  });

  it("coverage 虽 ready 但属于旧计划时拒绝 estimate/start", () => {
    expect(
      evaluateAuthoringPaidOperationGate({
        operation: "start",
        authoringState: "estimate_ready",
        speakerCoverageStatus: "ready",
        speakerCoveragePlanFingerprint: "speaker-plan-v1-old",
        actualPlanFingerprint: currentPlanFingerprint,
      }),
    ).toMatchObject({ allowed: false, code: "speaker_coverage_plan_mismatch" });
  });
});
