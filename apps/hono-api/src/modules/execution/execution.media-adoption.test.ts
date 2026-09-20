import { describe, expect, it } from "vitest";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";
import { WorkflowMediaAdoptionsSchema, validateWorkflowMediaAdoptionTargets, validateWorkflowMediaAdoptionDescendants, workflowMediaAdoptionCheckpoint } from "./execution.media-adoption";

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

describe("explicit media reference adoption", () => {
  it("protects downstream paid receipts while allowing independent outputs", () => {
    const root = { nodes: ["images", "video", "independent"].map((id) => ({ id, type: "taskNode",
      data: { workflowAtomicSpec: { executorRef: id === "images" ? "tapcanvas.image.generate/v1" : "tapcanvas.video.generate/v1" } } })),
      edges: [{ source: "images", target: "video" }] };
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
    validateWorkflowMediaAdoptionTargets({ adoptions: [adoption], outputs: [{ nodeId: "images", outputRefs: original }] });
    const next = workflowMediaAdoptionCheckpoint(original, [adoption]);
    expect(next.itemRuns.map((item) => item.evidence.taskId)).toEqual(["accepted-1", "accepted-2"]);
    expect(next.ports).toEqual({});
    expect(JSON.stringify(original)).toBe(before);
    expect(workflowMediaAdoptionCheckpoint(original, [])).toBe(original);
  });
  it("allows correcting a failed item but does not displace an in-flight task", () => {
    const outputs = [{ nodeId: "images", outputRefs: output() }];
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [{ ...adoption, itemId: "item-1" }], outputs })).not.toThrow();
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [{ ...adoption, itemId: "item-2" }], outputs })).toThrow("media_adoption_item_unsettled");
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [{ ...adoption, itemId: "missing" }], outputs })).toThrow("media_adoption_item_missing");
  });
  it("rejects ambiguous targets and non-image output contracts", () => {
    expect(WorkflowMediaAdoptionsSchema.safeParse([adoption, { ...adoption, assetId: "another" }]).success).toBe(false);
    expect(() => validateWorkflowMediaAdoptionTargets({ adoptions: [adoption], outputs: [{ nodeId: "images",
      outputRefs: { ...output(), executorRef: "tapcanvas.video.generate/v1" } }] })).toThrow("media_adoption_image_collection_required");
  });
});
