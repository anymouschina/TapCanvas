import { describe, expect, it } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { blockingBackgroundCollection, resolveBlockingBackgroundBinding } from "./execution.blocking-backgrounds";

const plan = { assetId: "room-floor", displayName: "Room floor", prompt: "Top-down room", negativePrompt: "people", referenceAssetBindings: [{ assetId: "scene-1", role: "content" }] };
describe("blocking background asset contract", () => {
  it("deduplicates declared identities, preserves authored prompts and exact image references", () => {
    const artifact = { text: JSON.stringify({ beats: [{ blockingPlan: { backgroundPlan: plan } }, { blockingPlan: { backgroundPlan: plan } }] }) };
    const result = blockingBackgroundCollection(artifact, "execution", "split");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.value).toEqual({ ...plan, assetPurpose: "blocking_background" });
    expect(() => blockingBackgroundCollection({ beats: [{ blockingPlan: { backgroundPlan: plan } }, { blockingPlan: { backgroundPlan: { ...plan, prompt: "Different room" } } }] }, "e", "s")).toThrow("Conflicting background plans");
  });
  it("requires a ready binding for an explicit background and uses no unrelated image", () => {
    const collection = createWorkflowCollection({ collectionId: "images", producerNodeId: "generate", producerPortId: "asset-bindings", itemIds: ["room-floor"], values: [{ nodeId: "floor-node", imageUrl: "https://assets.example/floor.png" }] });
    expect(resolveBlockingBackgroundBinding({ backgroundPlan: plan }, collection)).toEqual({ nodeId: "floor-node", imageUrl: "https://assets.example/floor.png" });
    expect(() => resolveBlockingBackgroundBinding({ backgroundPlan: { ...plan, assetId: "another-floor" } }, collection)).toThrow("no ready image binding");
    expect(resolveBlockingBackgroundBinding({}, undefined)).toBeNull();
  });
  it("preserves explicit background variants and ignores object property order", () => {
    const reversed = Object.fromEntries(Object.entries(plan).reverse());
    const variant = { ...plan, assetId: "room-blackout", prompt: "Room after blackout" };
    const result = blockingBackgroundCollection({ beats: [plan, reversed, variant].map(backgroundPlan => ({ blockingPlan: { backgroundPlan } })) }, "e", "s");
    expect(result.items.map(item => item.itemId)).toEqual(["room-floor", "room-blackout"]);
    expect(result.items.map(item => item.value)).toEqual([plan, variant].map(value => ({ ...value, assetPurpose: "blocking_background" })));
    expect(() => blockingBackgroundCollection({ beats: [plan, { ...plan, referenceAssetBindings: [{ assetId: "other", role: "content" }] }].map(backgroundPlan => ({ blockingPlan: { backgroundPlan } })) }, "e", "s"))
      .toThrow("Conflicting background plans");
  });
});
