import { describe, expect, it } from "vitest";
import { authorizeWorkflowMediaRetries, findWorkflowMediaRetryDownstreamEffects, resolveWorkflowMediaRetryFrontier, workflowMediaRetryBatchIdentity, WorkflowMediaRetriesSchema } from "./execution.media-retry";
import { WorkflowExecutionResumeRequestSchema } from "./execution.schemas";

const retry = { nodeId: "images", itemId: "background", taskId: "task-old" };
function outputs(status = "failed", taskId: string | null = "task-old", executorRef = "tapcanvas.image.generate/v1", extra: Record<string, unknown> = {}, parentStatus = "failed") {
  return [{ nodeId: "images", status: parentStatus, outputRefs: { protocolVersion: "1", executorRef,
    nodeId: "images", executionMode: "each", ports: {}, artifacts: [], evidence: {},
    itemRuns: [{ itemId: "background", index: 0, runtimeNodeId: "images::item::background", lineage: [],
      status, ports: {}, artifacts: [], evidence: { taskId, canvasNodeId: "old-media", providerStatus: "failed" } }],
    ...extra,
  } }];
}
function workflowDefinition(executorRef = "tapcanvas.image.generate/v1", executionMode = "each") {
  return { nodes: [{ id: "images", type: "taskNode", data: { kind: "workflowStage",
    workflowAtomicSpec: { executorRef, executionMode } } }], edges: [] };
}
describe("explicit media retry authorization", () => {
  it("binds a stable new attempt to an exact failed receipt without changing it", () => {
    const source = outputs(); const before = JSON.stringify(source);
    const input = { sourceExecutionId: "old-execution", retries: [retry], outputs: source,
      workflowDefinition: workflowDefinition() };
    const authorized = authorizeWorkflowMediaRetries(input);
    expect(authorized).toEqual(authorizeWorkflowMediaRetries(input));
    expect(authorized[0]).toMatchObject({ ...retry, executionMode: "each", executorRef: "tapcanvas.image.generate/v1", canvasNodeId: "old-media" });
    expect(authorized[0].retryKey).toHaveLength(64);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("rejects accepted, successful, missing and mismatched receipts", () => {
    for (const source of [outputs("success"), outputs("waiting_external"), outputs("failed", "other"), []]) {
      expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "old", retries: [retry], outputs: source,
        workflowDefinition: workflowDefinition() })).toThrow();
    }
  });
  it("authorizes an exact failed video item with no task only as a nullable receipt fact", () => {
    const videoRetry = { nodeId: "images", itemId: "background", taskId: null };
    const base = outputs("failed", null, "tapcanvas.video.generate/v1");
    const sourceOutput = base[0]?.outputRefs;
    const item = sourceOutput?.itemRuns[0];
    if (!sourceOutput || !item) throw new Error("Expected video receipt fixture");
    const videoOutputs = [{ ...base[0]!, outputRefs: { ...sourceOutput, itemRuns: [{
      ...item, evidence: { ...item.evidence, workflowSubmissionState: "rejected_pre_upstream" },
    }] } }];

    const authorized = authorizeWorkflowMediaRetries({
      sourceExecutionId: "old-execution",
      retries: [videoRetry],
      outputs: videoOutputs,
      workflowDefinition: workflowDefinition("tapcanvas.video.generate/v1"),
    });

    expect(authorized[0]).toMatchObject({ ...videoRetry, executorRef: "tapcanvas.video.generate/v1", canvasNodeId: "old-media" });
    expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "old-execution", retries: [videoRetry], outputs: base,
      workflowDefinition: workflowDefinition("tapcanvas.video.generate/v1") })).toThrow(/media_retry_failed_receipt_required/u);
  });
  it("authorizes the exact nested video item runtime id when the persisted item segment is literal", () => {
    const videoRetry = { nodeId: "video-workflow:clip-media::item::parent%3A0::step::video-submit", itemId: "clip-source:clip:0", taskId: null };
    const runtimeNodeId = `${videoRetry.nodeId}::item::${videoRetry.itemId}`;
    const videoOutputs = [{ nodeId: videoRetry.nodeId, status: "failed", outputRefs: {
      protocolVersion: "1", executorRef: "tapcanvas.video.generate/v1", nodeId: videoRetry.nodeId,
      executionMode: "each", ports: {}, artifacts: [], evidence: {}, itemRuns: [{ itemId: videoRetry.itemId,
        index: 0, runtimeNodeId, lineage: [], status: "failed", ports: {}, artifacts: [],
        evidence: { taskId: null, canvasNodeId: "prepared-video", providerStatus: "failed",
          workflowSubmissionState: "rejected_pre_upstream" } }],
    } }];
    const authorized = authorizeWorkflowMediaRetries({ sourceExecutionId: "nested-execution", retries: [videoRetry],
      outputs: videoOutputs, workflowDefinition: { nodes: [{ id: videoRetry.nodeId, type: "taskNode", data: {
        kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1", executionMode: "each" },
      } }], edges: [] } });
    expect(authorized[0]).toMatchObject({ ...videoRetry, canvasNodeId: "prepared-video" });
  });
  it("authorizes a failed item under a successful parent execution", () => {
    const source = outputs("failed", "task-old", "tapcanvas.image.generate/v1", {}, "success");
    const authorized = authorizeWorkflowMediaRetries({ sourceExecutionId: "terminal-success", retries: [retry],
      outputs: source, workflowDefinition: workflowDefinition() });
    expect(authorized[0]).toMatchObject({ ...retry, canvasNodeId: "old-media" });
  });
  it("allows an exact failed item under a canceled execution, but never an accepted item", () => {
    const canceledSource = outputs("failed", "task-old", "tapcanvas.image.generate/v1", {}, "canceled");
    const authorized = authorizeWorkflowMediaRetries({ sourceExecutionId: "terminal-canceled", retries: [retry],
      outputs: canceledSource, workflowDefinition: workflowDefinition() });
    expect(authorized[0]).toMatchObject({ ...retry, canvasNodeId: "old-media" });

    const acceptedSource = outputs("waiting_external", "task-old", "tapcanvas.image.generate/v1", {}, "canceled");
    expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "terminal-canceled", retries: [retry],
      outputs: acceptedSource, workflowDefinition: workflowDefinition() })).toThrow(/media_retry_failed_receipt_required/u);
  });
  it("authorizes an exact failed once media receipt from node-level evidence", () => {
    const onceRetry = { nodeId: "images", itemId: null, taskId: "task-once" };
    const onceOutput = {
      protocolVersion: "1",
      executorRef: "tapcanvas.image.generate/v1",
      nodeId: "images",
      executionMode: "once",
      ports: {},
      artifacts: [],
      itemRuns: [],
      evidence: { taskId: "task-once", canvasNodeId: "once-canvas-node", providerStatus: "failed" },
    };
    const authorized = authorizeWorkflowMediaRetries({
      sourceExecutionId: "old-execution",
      retries: [onceRetry],
      outputs: [{ nodeId: "images", status: "failed", outputRefs: onceOutput }],
      workflowDefinition: workflowDefinition("tapcanvas.image.generate/v1", "once"),
    });
    expect(authorized[0]).toMatchObject({
      ...onceRetry,
      executionMode: "once",
      executorRef: "tapcanvas.image.generate/v1",
      canvasNodeId: "once-canvas-node",
    });
    expect(() => authorizeWorkflowMediaRetries({
      sourceExecutionId: "old-execution",
      retries: [{ ...onceRetry, itemId: "unexpected-item" }],
      outputs: [{ nodeId: "images", status: "failed", outputRefs: onceOutput }],
      workflowDefinition: workflowDefinition("tapcanvas.image.generate/v1", "once"),
    })).toThrow(/media_retry_failed_receipt_required/u);
  });
  it("requires the frozen workflow executor and rejects persisted item asset evidence", () => {
    const mismatchedDefinition = workflowDefinition("tapcanvas.video.generate/v1");
    expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "old", retries: [retry], outputs: outputs(),
      workflowDefinition: mismatchedDefinition })).toThrow(/media_retry_media_collection_required/u);

    const mediaOutputRefs = outputs()[0]?.outputRefs;
    const failedItemRun = mediaOutputRefs?.itemRuns[0];
    if (!mediaOutputRefs || !failedItemRun) throw new Error("Expected media output fixture");
    const outputWithAssetUrl = {
      ...mediaOutputRefs,
      itemRuns: [{ ...failedItemRun, evidence: { ...failedItemRun.evidence, videoUrl: "https://assets.example/already.mp4" } }],
    };
    expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "old", retries: [retry], outputs: [
      { nodeId: "images", status: "failed", outputRefs: outputWithAssetUrl },
    ], workflowDefinition: workflowDefinition() })).toThrow(/media_retry_failed_receipt_required/u);
  });
  it("authorizes a failed item when successful siblings have their own media assets", () => {
    const base = outputs()[0]?.outputRefs;
    const failedItem = base?.itemRuns[0];
    if (!base || !failedItem) throw new Error("Expected failed collection fixture");
    const siblingAsset = {
      type: "tapcanvas.image/v1",
      identity: "sibling-asset",
      value: "https://assets.example/sibling.png",
      media: { protocolVersion: "workflow.media-asset/v1", kind: "image", url: "https://assets.example/sibling.png", mimeType: "image/png" },
    };
    const succeededSibling = {
      itemId: "foreground",
      index: 1,
      runtimeNodeId: "images::item::foreground",
      lineage: [],
      status: "success",
      ports: { image: { imageUrl: "https://assets.example/sibling.png", generatedAssetId: "sibling-asset" } },
      artifacts: [siblingAsset],
      evidence: { imageUrl: "https://assets.example/sibling.png", assetId: "sibling-asset" },
    };
    const outputWithSuccessfulSibling = {
      ...base,
      ports: { images: [{ imageUrl: "https://assets.example/sibling.png" }] },
      artifacts: [siblingAsset],
      evidence: { imageUrl: "https://assets.example/sibling.png" },
      itemRuns: [failedItem, succeededSibling],
    };

    expect(authorizeWorkflowMediaRetries({ sourceExecutionId: "old-execution", retries: [retry],
      outputs: [{ nodeId: "images", status: "failed", outputRefs: outputWithSuccessfulSibling }],
      workflowDefinition: workflowDefinition() })).toHaveLength(1);
  });
  it("does not confuse failure diagnostics or input-reference labels with persisted assets", () => {
    const base = outputs()[0]?.outputRefs;
    if (!base) throw new Error("Expected media output fixture");
    const item = base.itemRuns[0];
    if (!item) throw new Error("Expected failed item fixture");
    const output = {
      ...base,
      itemRuns: [{ ...item, evidence: {
        ...item.evidence,
        providerStatus: "failed",
        referenceImageNodeId: "image-source-1",
        observationFailure: { message: "Provider response mentioned imageUrl but returned no asset" },
      } }],
    };
    expect(authorizeWorkflowMediaRetries({ sourceExecutionId: "old", retries: [retry],
      outputs: [{ nodeId: "images", status: "failed", outputRefs: output }], workflowDefinition: workflowDefinition() })).toHaveLength(1);
  });
  it("rejects duplicate retry targets", () => {
    expect(WorkflowMediaRetriesSchema.safeParse([retry, retry]).success).toBe(false);
  });
  it("keeps all explicitly retried items on one precise failed-node frontier", () => {
    expect(resolveWorkflowMediaRetryFrontier([
      retry,
      { ...retry, itemId: "foreground", taskId: "task-foreground" },
    ])).toBe("images");
    expect(() => resolveWorkflowMediaRetryFrontier([
      retry,
      { ...retry, nodeId: "videos", itemId: "clip", taskId: "task-video" },
    ])).toThrow("workflow_media_retry_frontier_conflict");
    expect(() => resolveWorkflowMediaRetryFrontier([])).toThrow("workflow_media_retry_frontier_missing");
  });
  it("authorizes a failed image item inside a frozen per-clip pipeline without replacing successful siblings", () => {
    const outerId = "clip-media-pipeline";
    const clipRuntimeId = `${outerId}::item::clip%3A0`;
    const mediaNodeId = `${clipRuntimeId}::step::generate`;
    const itemId = "effect:failed";
    const requested = { nodeId: mediaNodeId, itemId, taskId: "task-failed" };
    const mediaOutput = {
      protocolVersion: "1", executorRef: "tapcanvas.image.generate/v1", nodeId: mediaNodeId,
      executionMode: "each", ports: {}, artifacts: [], evidence: { partial: true }, itemRuns: [
        { itemId, index: 0, runtimeNodeId: `${mediaNodeId}::item::effect%3Afailed`, lineage: [], status: "failed",
          ports: {}, artifacts: [], evidence: { canvasNodeId: "canvas-failed", taskId: "task-failed", providerStatus: "failed" } },
        { itemId: "effect:success", index: 1, runtimeNodeId: `${mediaNodeId}::item::effect%3Asuccess`, lineage: [], status: "success",
          ports: {}, artifacts: [{ type: "tapcanvas.image/v1", identity: null, value: "https://assets.example/success.png" }],
          evidence: { canvasNodeId: "canvas-success", taskId: "task-success", providerStatus: "success" } },
      ],
    };
    const source = [{ nodeId: outerId, status: "failed", outputRefs: {
      protocolVersion: "1", executorRef: "workflow.pipeline.run/v1", nodeId: outerId,
      executionMode: "each", ports: {}, artifacts: [], evidence: {}, itemRuns: [{
        itemId: "clip:0", index: 0, runtimeNodeId: clipRuntimeId, lineage: [], status: "failed", ports: {}, artifacts: [],
        evidence: { pipelineState: { protocolVersion: "workflow.pipeline.state/v1", steps: {
          generate: { status: "success", outputRefs: mediaOutput },
        } } },
      }],
    } }];
    const definition = { nodes: [{ id: outerId, type: "taskNode", data: { kind: "workflowStage",
      workflowAtomicSpec: { executorRef: "workflow.pipeline.run/v1", executionMode: "each" },
      workflowPipeline: {
        protocolVersion: "workflow.pipeline.run/v1",
        inputs: [{ portId: "asset-items", mode: "collection", artifactTypes: [] }],
        bindings: [{ from: { kind: "input", portId: "asset-items" }, to: { stepId: "generate", portId: "asset-items" }, mode: "collection" }],
        outputs: [{ portId: "asset-bindings", from: { stepId: "generate", portId: "asset-bindings" }, mode: "collection" }],
        steps: [{ stepId: "generate", node: { id: "generate", type: "taskNode", kind: "workflowStage", data: {
          workflowAtomicSpec: { version: 1, category: "media", operation: "generate", executorRef: "tapcanvas.image.generate/v1",
            executionMode: "each", inputPorts: ["asset-items"], outputPorts: ["asset-bindings"] },
        } } }],
      },
    } }], edges: [] };
    expect(resolveWorkflowMediaRetryFrontier([requested])).toBe(outerId);
    const serialized = JSON.stringify(source);
    expect(authorizeWorkflowMediaRetries({ sourceExecutionId: "execution-original", retries: [requested], outputs: source,
      workflowDefinition: definition })).toMatchObject([{ ...requested, canvasNodeId: "canvas-failed" }]);
    expect(JSON.stringify(source)).toBe(serialized);
    expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "execution-original",
      retries: [{ ...requested, taskId: "task-success" }], outputs: source, workflowDefinition: definition })).toThrow();

    const pipeline = definition.nodes[0]!.data.workflowPipeline;
    const guardedDefinition = { nodes: [{ ...definition.nodes[0]!, data: { ...definition.nodes[0]!.data,
      workflowPipeline: { ...pipeline,
        steps: [...pipeline.steps, { stepId: "video", node: { id: "video", type: "taskNode", kind: "workflowStage",
          data: { workflowAtomicSpec: { version: 1, category: "media", operation: "generate",
            executorRef: "tapcanvas.video.generate/v1", executionMode: "each",
            inputPorts: ["asset-bindings"], outputPorts: ["video"] } } } }],
        bindings: [...pipeline.bindings, { from: { kind: "step", stepId: "generate", portId: "asset-bindings" },
          to: { stepId: "video", portId: "asset-bindings" }, mode: "collection" }],
        outputs: [...pipeline.outputs, { portId: "video", from: { stepId: "video", portId: "video" }, mode: "collection" }],
      },
    } }], edges: [] };
    const originalOuter = source[0]!;
    const originalItem = originalOuter.outputRefs.itemRuns[0]!;
    const guardedSource = [{ ...originalOuter, outputRefs: { ...originalOuter.outputRefs,
      itemRuns: [{ ...originalItem, evidence: { pipelineState: { protocolVersion: "workflow.pipeline.state/v1",
        steps: { generate: { status: "success", outputRefs: mediaOutput }, video: { status: "success" } },
      } } }],
    } }];
    expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "execution-original", retries: [requested],
      outputs: guardedSource, workflowDefinition: guardedDefinition })).toThrow("media_retry_nested_downstream_effect_exists:video");
  });
  it("protects started downstream external effects and derives a stable retry batch identity", () => {
    const graph = { nodes: [
      ...workflowDefinition().nodes,
      { id: "video", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: {
        executorRef: "tapcanvas.video.generate/v1", executionMode: "each",
      } } },
      { id: "take", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: {
        executorRef: "workflow.collection.take/v1", executionMode: "once",
      } } },
    ], edges: [{ id: "images-video", source: "images", target: "video" }, { id: "video-take", source: "video", target: "take" }] };
    const sourceOutputs = [
      { nodeId: "video", status: "success", startedAt: "2026-09-01T00:00:00Z", outputRefs: null },
      { nodeId: "take", status: "success", startedAt: "2026-09-01T00:00:00Z", outputRefs: null },
    ];
    expect(findWorkflowMediaRetryDownstreamEffects({ nodeId: "images", workflowDefinition: graph, outputs: sourceOutputs }))
      .toEqual(["video"]);
    expect(findWorkflowMediaRetryDownstreamEffects({ nodeId: "images", workflowDefinition: graph, outputs: [{
      nodeId: "video", status: "failed", startedAt: "2026-09-01T00:00:00Z", outputRefs: {
        protocolVersion: "1", executorRef: "tapcanvas.video.generate/v1", nodeId: "video", executionMode: "each",
        ports: {}, artifacts: [], evidence: {}, itemRuns: [{ itemId: "clip", index: 0, runtimeNodeId: "video::item::clip",
          lineage: [], status: "failed", ports: {}, artifacts: [],
          evidence: { taskId: null, providerStatus: "failed", workflowSubmissionState: "rejected_pre_upstream" } }],
      },
    }] })).toEqual([]);
    const authorized = authorizeWorkflowMediaRetries({ sourceExecutionId: "source", retries: [retry],
      outputs: outputs(), workflowDefinition: workflowDefinition() });
    expect(workflowMediaRetryBatchIdentity(authorized)).toBe(workflowMediaRetryBatchIdentity(authorized));
  });
  it("requires taskId to be explicit while allowing null for a confirmed pre-upstream video failure", () => {
    expect(WorkflowMediaRetriesSchema.safeParse([{ nodeId: "video", itemId: "clip", taskId: null }]).success).toBe(true);
    expect(WorkflowMediaRetriesSchema.safeParse([{ nodeId: "video", itemId: "clip" }]).success).toBe(false);
  });
  it("admits the explicit endpoint contract but rejects mixing recovery modes", () => {
    expect(WorkflowExecutionResumeRequestSchema.parse({ mediaRetries: [retry] })).toEqual({ mediaRetries: [retry] });
    expect(WorkflowExecutionResumeRequestSchema.parse({ mediaRetries: [{ nodeId: "images", itemId: null, taskId: "task-once" }] }))
      .toEqual({ mediaRetries: [{ nodeId: "images", itemId: null, taskId: "task-once" }] });
    expect(WorkflowExecutionResumeRequestSchema.safeParse({ mediaRetries: [retry], nodeId: "images" }).success).toBe(false);
  });
});
