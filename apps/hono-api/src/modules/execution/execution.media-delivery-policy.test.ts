import { describe, expect, it } from "vitest";
import { freezeMediaDeliveryPolicy, readMediaDeliveryPolicy } from "./execution.media-delivery-policy";
import { mediaDeliveryCoverage } from "./execution.media-delivery-coverage";

describe("explicit partial media delivery", () => {
  const expected = [0, 1, 2, 3].map(index => ({ itemId: `clip-${index}`, durationSeconds: 15 }));
  it("keeps only delivered duration and reports missing identities without changing the plan", () => {
    expect(mediaDeliveryCoverage(expected, ["clip-0", "clip-2"], true)).toEqual({
      status: "partial", requestedDurationSeconds: 60, deliveredDurationSeconds: 30,
      completedItemIds: ["clip-0", "clip-2"], missingItemIds: ["clip-1", "clip-3"],
    });
    expect(expected).toHaveLength(4);
  });
  it("does not pad missing footage or admit unknown/duplicate/empty deliveries", () => {
    for (const ids of [[], ["clip-0", "clip-0"], ["unknown"]]) {
      expect(() => mediaDeliveryCoverage(expected, ids, true)).toThrow();
    }
    expect(() => mediaDeliveryCoverage(expected, ["clip-0"], false)).toThrow();
  });
  it("freezes policy onto every paid generation and the assembly node without mutating the template", () => {
    const flow = { nodes: ["tapcanvas.video.generate/v1", "video.concat/v1", "tapcanvas.image.generate/v1", "video.voice-manifest.materialize/v1", "workflow.control.condition/v1"].map((executorRef, i) => ({
      id: String(i), data: { workflowAtomicSpec: { executorRef } },
    })) };
    const result = freezeMediaDeliveryPolicy(flow);
    expect(JSON.stringify(flow)).not.toContain("workflowMediaDeliveryPolicy");
    expect(JSON.stringify(result).match(/workflowMediaDeliveryPolicy/g)).toHaveLength(4);
    // A single refused item is denied on its own evidence; the siblings it cannot replace are
    // still delivered, so every executor that issues one paid request per item carries the policy.
    const frozen = (result.nodes as readonly { id: string; data: Record<string, unknown> }[]);
    expect(frozen.slice(0, 4).every(node => node.data.workflowMediaDeliveryPolicy !== undefined)).toBe(true);
    expect(frozen[4]!.data.workflowMediaDeliveryPolicy).toBeUndefined();
    expect(readMediaDeliveryPolicy({})).toBeNull();
    expect(() => readMediaDeliveryPolicy({ workflowMediaDeliveryPolicy: { maxRetries: 99 } })).toThrow();
  });
});
