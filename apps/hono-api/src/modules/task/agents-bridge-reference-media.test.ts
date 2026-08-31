import { describe, expect, it } from "vitest";

import { filterRejectedSelectedReferenceMedia } from "./agents-bridge-reference-media";

describe("filterRejectedSelectedReferenceMedia", () => {
	it("keeps media unchanged when the selected reference is not rejected", () => {
		const result = filterRejectedSelectedReferenceMedia({
			referenceImages: ["https://cdn.test/selected.png"],
			assetInputs: [
				{
					nodeId: "node-selected",
					url: "https://cdn.test/selected.png",
					role: "character" as const,
				},
			],
			selectedReferenceProtocolImages: ["https://cdn.test/protocol.png"],
			selectedReference: {
				nodeId: "node-selected",
				approvalStatus: "approved",
				imageUrl: "https://cdn.test/selected.png",
			},
		});

		expect(result.selectedReferenceRejected).toBe(false);
		expect(result.referenceImages).toEqual(["https://cdn.test/selected.png"]);
		expect(result.assetInputs).toHaveLength(1);
		expect(result.selectedReferenceProtocolImages).toEqual([
			"https://cdn.test/protocol.png",
		]);
	});

	it("removes only the explicitly rejected selected node media", () => {
		const result = filterRejectedSelectedReferenceMedia({
			referenceImages: [
				"https://cdn.test/selected.png",
				"https://cdn.test/manual.png",
				"https://cdn.test/protocol.png",
			],
			assetInputs: [
				{
					nodeId: "node-selected",
					url: "https://cdn.test/selected-copy.png",
					role: "character" as const,
				},
				{
					nodeId: "node-manual",
					url: "https://cdn.test/manual.png",
					role: "reference" as const,
				},
			],
			selectedReferenceProtocolImages: ["https://cdn.test/protocol.png"],
			selectedReference: {
				nodeId: "node-selected",
				approvalStatus: " rejected ",
				imageUrl: "https://cdn.test/selected.png",
				sourceUrl: "https://cdn.test/selected-source.png",
			},
		});

		expect(result.selectedReferenceRejected).toBe(true);
		expect(result.referenceImages).toEqual(["https://cdn.test/manual.png"]);
		expect(result.assetInputs).toEqual([
			{
				nodeId: "node-manual",
				url: "https://cdn.test/manual.png",
				role: "reference",
			},
		]);
		expect(result.selectedReferenceProtocolImages).toEqual([]);
	});
});
