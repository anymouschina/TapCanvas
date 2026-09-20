import { parseBlockingBackgroundPlan, collectBlockingBackgroundPlans } from "../../../../../packages/schemas/blocking-plan-contract/background.mjs";
export { parseBlockingBackgroundPlan } from "../../../../../packages/schemas/blocking-plan-contract/background.mjs";
import { createWorkflowCollection, isWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function blockingBackgroundCollection(artifact: unknown, executionId: string, nodeId: string) {
  const encoded = record(artifact) && typeof artifact.text === "string" ? artifact.text : artifact;
  const parsed: unknown = typeof encoded === "string" ? JSON.parse(encoded) : encoded;
  if (!record(parsed) || !Array.isArray(parsed.beats)) throw new Error("Background collection requires BeatSheet beats");
  return blockingBackgroundPlanCollection(parsed.beats.map((beat: unknown) => {
    if (!record(beat) || !record(beat.blockingPlan)) throw new Error("Beat requires a blockingPlan");
    return beat.blockingPlan.backgroundPlan;
  }), executionId, nodeId);
}

export function blockingBackgroundPlanCollection(rawPlans: readonly unknown[], executionId: string, nodeId: string) {
  const plans = collectBlockingBackgroundPlans(rawPlans);
  return createWorkflowCollection({ collectionId: `${executionId}:${nodeId}:backgrounds`, producerNodeId: nodeId,
    producerPortId: "asset-items", itemIds: plans.map(plan => String(plan.assetId)),
    values: plans.map(plan => ({ ...plan, assetPurpose: "blocking_background" })) });
}

export function resolveBlockingBackgroundBinding(plan: Record<string, unknown>, bindings: unknown): { nodeId: string; imageUrl: string } | null {
  if (plan.backgroundPlan === undefined) return null;
  const background = parseBlockingBackgroundPlan(plan.backgroundPlan);
  if (!isWorkflowCollection(bindings)) throw new Error(`Background ${background.assetId} requires a materialized asset collection`);
  const item = bindings.items.find((entry) => entry.itemId === background.assetId);
  const value = item?.value;
  if (!record(value) || typeof value.nodeId !== "string" || !value.nodeId || typeof value.imageUrl !== "string") {
    throw new Error(`Background ${background.assetId} has no ready image binding`);
  }
  const url = new URL(value.imageUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Background requires a durable HTTP(S) image");
  return { nodeId: value.nodeId, imageUrl: value.imageUrl };
}
