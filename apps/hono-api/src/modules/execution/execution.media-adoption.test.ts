import { describe, expect, it } from "vitest";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";
import {
	WorkflowMediaAdoptionsSchema,
	validateWorkflowMediaAdoptionTargets,
	validateWorkflowMediaAdoptionDescendants,
	workflowMediaAdoptionCheckpoint,
	workflowMediaAdoptionPipelineCheckpoint,
	workflowMediaAdoptionAssetId,
} from "./execution.media-adoption";

function output(): WorkflowNodeOutputV1 {
  return { protocolVersion: "1", executorRef: "tapcanvas.image.generate/v1", nodeId: "images", executionMode: "each",
    ports: { image: "old collection" }, artifacts: [], evidence: { executorCompleted: false },
    itemRuns: ["success", "failed", "waiting_external"].map((status, index) => ({
      itemId: `item-${index}`, index, status: status as "success" | "failed" | "waiting_external",
      runtimeNodeId: `images::item::item-${index}`, lineage: [], ports: {}, artifacts: [],
      evidence: { taskId: `accepted-${index}` },
    })) };
}
const adoption = { nodeId: "images", itemId: "item-0", assetId: "verified-asset" };

function directWorkflow(): Record<string, unknown> {
  return { nodes: ["images", "video", "independent"].map((id) => ({ id, type: "taskNode", data: {
    workflowAtomicSpec: { executorRef: id === "images" ? "tapcanvas.image.generate/v1" : "tapcanvas.video.generate/v1" },
  } })), edges: [{ source: "images", target: "video" }] };
}

function nestedFixture(): Readonly<{
  workflow: Record<string, unknown>;
  pipelineNode: { id: string; type: string; kind: string; data: Record<string, unknown> };
  output: WorkflowNodeOutputV1;
  adoptions: readonly { nodeId: string; itemId: string; assetId: string }[];
}> {
  const pipelineId = "pipeline";
  const sharedItemId = "effect:shared";
  const stepId = "generate";
  const scopes = ["pipeline::item::clip%3A0", "pipeline::item::clip%3A1"];
  const adoptions = scopes.map((scope) => ({
    nodeId: `${scope}::step::${stepId}`,
    itemId: sharedItemId,
    assetId: "verified-shared-image",
  }));
  const mediaOutput = (scope: string): WorkflowNodeOutputV1 => {
    const nodeId = `${scope}::step::${stepId}`;
    return {
      protocolVersion: "1", executorRef: "tapcanvas.image.generate/v1", nodeId,
      executionMode: "each", ports: {}, artifacts: [], evidence: { partial: true, executorCompleted: false },
      itemRuns: [
        { itemId: sharedItemId, index: 0, status: "failed", runtimeNodeId: `${nodeId}::item::${encodeURIComponent(sharedItemId)}`,
          lineage: [], ports: {}, artifacts: [], evidence: { taskId: null, providerStatus: "failed" }, errorCode: "provider_rejected" },
        { itemId: "effect:other", index: 1, status: "success", runtimeNodeId: `${nodeId}::item::effect%3Aother`,
          lineage: [], ports: {}, artifacts: [{ type: "tapcanvas.image/v1", identity: "old-sibling-asset", value: "https://assets.example/sibling.png" }],
          evidence: { taskId: "accepted-sibling", providerStatus: "success" } },
      ],
    };
  };
  const consumerOutput = (scope: string): WorkflowNodeOutputV1 => ({
    protocolVersion: "1", executorRef: "video.clip-design-inputs/v1", nodeId: `${scope}::step::consume`,
    executionMode: "once", ports: { prepared: "old prepared binding" }, artifacts: [],
    evidence: { executorCompleted: true }, itemRuns: [],
  });
  const pipelineNode = {
    id: pipelineId, type: "taskNode", kind: "workflowStage",
    data: {
      kind: "workflowStage",
      workflowAtomicSpec: { version: 1, category: "control", operation: "pipeline", executorRef: "workflow.pipeline.run/v1",
        executionMode: "each", inputPorts: ["asset-items"], outputPorts: ["prepared"] },
      workflowPipeline: {
        protocolVersion: "workflow.pipeline.run/v1",
        inputs: [{ portId: "asset-items", mode: "collection", artifactTypes: [] }],
        bindings: [
          { from: { kind: "input", portId: "asset-items" }, to: { stepId: "generate", portId: "asset-items" }, mode: "collection" },
          { from: { kind: "step", stepId: "generate", portId: "images" }, to: { stepId: "consume", portId: "images" }, mode: "collection" },
        ],
        outputs: [{ portId: "prepared", from: { stepId: "consume", portId: "prepared" }, mode: "collection" }],
        steps: [
          { stepId, node: { id: stepId, type: "taskNode", kind: "workflowStage", data: {
            workflowAtomicSpec: { version: 1, category: "media", operation: "generate", executorRef: "tapcanvas.image.generate/v1",
              executionMode: "each", inputPorts: ["asset-items"], outputPorts: ["images"] },
          } } },
          { stepId: "consume", node: { id: "consume", type: "taskNode", kind: "workflowStage", data: {
            workflowAtomicSpec: { version: 1, category: "control", operation: "consume", executorRef: "video.clip-design-inputs/v1",
              executionMode: "once", inputPorts: ["images"], outputPorts: ["prepared"] },
          } } },
        ],
      },
    },
  };
  const output: WorkflowNodeOutputV1 = {
    protocolVersion: "1", executorRef: "workflow.pipeline.run/v1", nodeId: pipelineId, executionMode: "each",
    ports: {}, artifacts: [], evidence: { executorCompleted: false },
    itemRuns: scopes.map((scope, index) => ({
      itemId: `clip:${index}`, index, status: "failed", runtimeNodeId: scope, lineage: [], ports: {}, artifacts: [],
      evidence: { pipelineState: { protocolVersion: "workflow.pipeline.state/v1", cursorStepId: "consume", steps: {
        generate: { status: "success", outputRefs: mediaOutput(scope) },
        consume: { status: "success", outputRefs: consumerOutput(scope) },
      } } },
    })),
  };
  return { workflow: { nodes: [pipelineNode], edges: [] }, pipelineNode, output, adoptions };
}

describe("explicit media reference adoption", () => {
  it("protects downstream paid receipts while allowing independent outputs", () => {
    const root = directWorkflow();
    expect(() => validateWorkflowMediaAdoptionDescendants({ root, adoptions: [adoption], runs: [
      { nodeId: "video", status: "skipped", outputRefs: null },
      { nodeId: "independent", status: "success", outputRefs: null },
    ] })).not.toThrow();
    expect(() => validateWorkflowMediaAdoptionDescendants({ root, adoptions: [adoption], runs: [
      { nodeId: "video", status: "waiting_external", outputRefs: null },
    ] })).toThrow("media_adoption_downstream_receipt_exists");
    expect(() => validateWorkflowMediaAdoptionDescendants({ root, adoptions: [adoption], runs: [
      { nodeId: "video", status: "failed", outputRefs: { ...output(), nodeId: "video", evidence: { taskId: "accepted-video" } } },
    ] })).toThrow("media_adoption_downstream_receipt_exists");
  });
  it("preserves original successful media and every unrelated receipt", () => {
    const original = output();
    const before = JSON.stringify(original);
    expect(validateWorkflowMediaAdoptionTargets({ adoptions: [adoption], outputs: [{ nodeId: "images", outputRefs: original }],
      workflowDefinition: directWorkflow() })).toEqual(["images"]);
    const next = workflowMediaAdoptionCheckpoint(original, [adoption]);
    expect(next.itemRuns.map((item) => item.evidence.taskId)).toEqual(["accepted-1", "accepted-2"]);
    expect(next.ports).toEqual({});
    expect(JSON.stringify(original)).toBe(before);
    expect(workflowMediaAdoptionCheckpoint(original, [])).toBe(original);
  });
  it("allows correcting a failed item but does not displace an in-flight task", () => {
    const outputs = [{ nodeId: "images", outputRefs: output() }];
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [{ ...adoption, itemId: "item-1" }], outputs,
      workflowDefinition: directWorkflow() })).not.toThrow();
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [{ ...adoption, itemId: "item-2" }], outputs,
      workflowDefinition: directWorkflow() })).toThrow("media_adoption_item_unsettled");
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [{ ...adoption, itemId: "missing" }], outputs,
      workflowDefinition: directWorkflow() })).toThrow("media_adoption_item_missing");
  });
  it("rejects ambiguous targets and non-image output contracts", () => {
    expect(WorkflowMediaAdoptionsSchema.safeParse([adoption, { ...adoption, assetId: "another" }]).success).toBe(false);
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [adoption], outputs: [{ nodeId: "images",
      outputRefs: { ...output(), executorRef: "tapcanvas.video.generate/v1" } }], workflowDefinition: directWorkflow() }))
      .toThrow("media_adoption_image_collection_required");
  });

  it("adopts the same exact nested item across collection items and preserves sibling receipts", () => {
    const fixture = nestedFixture();
    const before = JSON.stringify(fixture.output);
    expect(validateWorkflowMediaAdoptionTargets({ adoptions: fixture.adoptions, workflowDefinition: fixture.workflow,
      outputs: [{ nodeId: "pipeline", status: "failed", outputRefs: fixture.output }] })).toEqual(["pipeline"]);
    expect(() => validateWorkflowMediaAdoptionDescendants({ root: fixture.workflow, adoptions: fixture.adoptions,
      runs: [{ nodeId: "pipeline", status: "failed", outputRefs: fixture.output }] })).not.toThrow();

    const amended = workflowMediaAdoptionPipelineCheckpoint({ node: fixture.pipelineNode, output: fixture.output,
      adoptions: fixture.adoptions });
    expect(JSON.stringify(fixture.output)).toBe(before);
    expect(amended.itemRuns).toHaveLength(2);
    for (const outerItem of amended.itemRuns) {
      const pipelineState = outerItem.evidence.pipelineState as Record<string, unknown>;
      const steps = pipelineState.steps as Record<string, Record<string, unknown>>;
      expect(steps.generate?.status).toBe("failed");
      expect(steps.consume).toBeUndefined();
      const savedMedia = steps.generate?.outputRefs as WorkflowNodeOutputV1;
      expect(savedMedia.itemRuns.map((item) => item.itemId)).toEqual(["effect:other"]);
      expect(savedMedia.itemRuns[0]?.evidence.taskId).toBe("accepted-sibling");
      expect(savedMedia.evidence.mediaAdoptionCheckpoint).toMatchObject({
        protocolVersion: "workflow.media-adoption-checkpoint/v1", adoptedItemIds: ["effect:shared"],
      });
      expect(workflowMediaAdoptionAssetId({ workflowMediaAdoptions: fixture.adoptions },
        `${savedMedia.nodeId}::item::${encodeURIComponent("effect:shared")}`)).toBe("verified-shared-image");
    }
  });

  it("rejects an already-started nested paid consumer and rejects an inexact nested target", () => {
    const fixture = nestedFixture();
    const first = fixture.output.itemRuns[0];
    if (!first) throw new Error("nested collection fixture missing");
    const state = first.evidence.pipelineState as Record<string, unknown>;
    const steps = state.steps as Record<string, Record<string, unknown>>;
    const videoNode = { stepId: "video", node: { id: "video", type: "taskNode", kind: "workflowStage", data: {
      workflowAtomicSpec: { version: 1, category: "media", operation: "generate", executorRef: "tapcanvas.video.generate/v1",
        executionMode: "each", inputPorts: ["prepared"], outputPorts: ["video"] },
    } } };
    const basePipeline = fixture.pipelineNode.data.workflowPipeline as Record<string, unknown>;
    const guardedPipeline = { ...basePipeline,
      steps: [...basePipeline.steps as unknown[], videoNode],
      bindings: [...basePipeline.bindings as unknown[], { from: { kind: "step", stepId: "consume", portId: "prepared" },
        to: { stepId: "video", portId: "prepared" }, mode: "collection" }],
      outputs: [...basePipeline.outputs as unknown[], { portId: "video", from: { stepId: "video", portId: "video" }, mode: "collection" }],
    };
    const guardedRoot = { nodes: [{ ...fixture.pipelineNode, data: { ...fixture.pipelineNode.data, workflowPipeline: guardedPipeline } }], edges: [] };
    const acceptedVideo: WorkflowNodeOutputV1 = { protocolVersion: "1", executorRef: "tapcanvas.video.generate/v1",
      nodeId: `${first.runtimeNodeId}::step::video`, executionMode: "each", ports: {}, artifacts: [],
      evidence: { taskId: "accepted-video" }, itemRuns: [] };
    steps.video = { status: "failed", outputRefs: acceptedVideo };
    const guardedOutput = { ...fixture.output, itemRuns: fixture.output.itemRuns.map((item) => item.runtimeNodeId === first.runtimeNodeId
      ? { ...item, evidence: { ...item.evidence, pipelineState: state } } : item) };
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [fixture.adoptions[0]!], workflowDefinition: guardedRoot,
      outputs: [{ nodeId: "pipeline", status: "failed", outputRefs: guardedOutput }] }))
      .toThrow("media_adoption_nested_downstream_receipt_exists:video");
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [{ ...fixture.adoptions[0]!, itemId: "wrong" }],
      workflowDefinition: fixture.workflow, outputs: [{ nodeId: "pipeline", status: "failed", outputRefs: fixture.output }] }))
      .toThrow("media_adoption_item_missing");
  });
});
