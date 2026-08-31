import { describe, expect, it } from "vitest";

import {
  resolveWorkflowVideoRecoveryItemRun,
  selectWorkflowVideoRecoveryCandidates,
  workflowVideoRecoveryCandidateFromNode,
} from "./workflow-video-terminal-recovery";

const runtimeNodeId = "video-submit::item::clip%3A3";
const executionFamilyId = "family-1";
const canvasNodeId = `${runtimeNodeId}::family::${executionFamilyId}::output::video`;

function workflowNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: canvasNodeId,
    data: {
      kind: "video",
      status: "submitting",
      workflowExecutionId: "execution-1",
      workflowRuntimeNodeId: runtimeNodeId,
      workflowEffectId: `${executionFamilyId}:${runtimeNodeId}:video-submit`,
      ...overrides,
    },
  };
}

function outputRefs(input: Readonly<{
  status: "success" | "waiting_external" | "failed";
  evidence?: Record<string, unknown>;
}>): Record<string, unknown> {
  return {
    protocolVersion: "1",
    executorRef: "tapcanvas.video.generate/v1",
    nodeId: "video-submit",
    executionMode: "each",
    ports: {},
    artifacts: [],
    evidence: {},
    itemRuns: [{
      itemId: "clip:3",
      index: 3,
      status: input.status,
      runtimeNodeId,
      lineage: [],
      ports: {},
      artifacts: [],
      evidence: {
        canvasNodeId,
        taskId: "provider-task-3",
        providerStatus: input.status === "failed" ? "failed" : "processing",
        ...input.evidence,
      },
      ...(input.status === "failed"
        ? {
            errorCode: "workflow_node_runtime_failed",
            errorMessage: "provider rejected this clip",
          }
        : {}),
    }],
  };
}

describe("workflow video terminal recovery identity", () => {
  it("selects a submitting workflow node even when the canvas has no taskId", () => {
    expect(selectWorkflowVideoRecoveryCandidates([workflowNode()])).toEqual([{
      nodeId: canvasNodeId,
      executionId: "execution-1",
      aggregateNodeId: "video-submit",
      runtimeNodeId,
      effectId: `${executionFamilyId}:${runtimeNodeId}:video-submit`,
    }]);
  });

  it("rejects mismatched paid-effect and canvas identities", () => {
    expect(workflowVideoRecoveryCandidateFromNode(workflowNode({
      workflowEffectId: `another-family:${runtimeNodeId}:video-submit`,
    }))).toBeNull();
    expect(workflowVideoRecoveryCandidateFromNode({
      ...workflowNode(),
      id: "another-canvas-node",
    })).toBeNull();
  });
});

describe("resolveWorkflowVideoRecoveryItemRun", () => {
  const candidate = workflowVideoRecoveryCandidateFromNode(workflowNode());
  if (!candidate) throw new Error("test candidate must be valid");

  it("returns the newest exact immutable item receipt", () => {
    const failed = resolveWorkflowVideoRecoveryItemRun(candidate, [
      { outputRefs: outputRefs({ status: "failed" }) },
      { outputRefs: outputRefs({ status: "waiting_external" }) },
    ]);
    expect(failed).toMatchObject({
      status: "failed",
      runtimeNodeId,
      evidence: { canvasNodeId, taskId: "provider-task-3" },
      errorMessage: "provider rejected this clip",
    });
  });

  it("does not project a receipt belonging to another canvas node", () => {
    expect(resolveWorkflowVideoRecoveryItemRun(candidate, [{
      outputRefs: outputRefs({
        status: "failed",
        evidence: { canvasNodeId: "another-canvas-node" },
      }),
    }])).toBeNull();
  });
});
