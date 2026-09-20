import { describe, expect, it } from "vitest";
import { inspectClipReferenceSelection } from "./execution.clip-reference-selection";

describe("clip reference selection", () => {
	const registry = { referenceRole: "identity", referenceAssetIds: ["a", "b", "c"], referenceImageNodeIds: ["node-a"] };
	it("accepts an ordered subset without changing either the pool or selection", () => {
		const state = { referenceAssetIds: ["c", "a"], referenceImageNodeIds: [] };
		expect(inspectClipReferenceSelection(state, registry, "state")).toBeNull();
		expect(state.referenceAssetIds).toEqual(["c", "a"]);
		expect(registry.referenceAssetIds).toEqual(["a", "b", "c"]);
	});
	it.each([
		[{ referenceImageNodeIds: [] }, "explicitly declare"],
		[{ referenceAssetIds: ["other"], referenceImageNodeIds: [] }, "outside"],
		[{ referenceAssetIds: ["a", "a"], referenceImageNodeIds: [] }, "duplicate"],
		[{ referenceAssetIds: [], referenceImageNodeIds: [] }, "replacement"],
	] as const)("returns actionable structural evidence for an invalid selection", (state, reason) => {
		expect(inspectClipReferenceSelection(state, registry, "state")).toContain(reason);
	});
	it("allows genuinely new objects without fabricating IDs", () => {
		expect(inspectClipReferenceSelection({ referenceAssetIds: [], referenceImageNodeIds: [] },
			{ referenceRole: "environment", referenceAssetIds: [], referenceImageNodeIds: [] }, "state")).toBeNull();
	});
});
