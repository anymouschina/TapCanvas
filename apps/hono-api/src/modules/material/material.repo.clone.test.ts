import { describe, expect, it } from "vitest";
import { rewriteClonedMaterialValue } from "./material.repo";

describe("material graph clone value rewriting", () => {
	it("rewrites exact project and material asset identities without touching URLs or prose", () => {
		const rewritten = rewriteClonedMaterialValue(
			{
				projectId: "source-project",
				assetId: "source-character",
				nested: {
					referenceAssetIds: ["source-character", "source-scene"],
					imageUrl: "https://assets.example/source-project/source-character.png",
					description: "source-character appears in source-project",
				},
			},
			{
				sourceProjectId: "source-project",
				targetProjectId: "target-project",
				assetIdMapping: new Map([
					["source-character", "target-character"],
					["source-scene", "target-scene"],
				]),
			},
		);

		expect(rewritten).toEqual({
			projectId: "target-project",
			assetId: "target-character",
			nested: {
				referenceAssetIds: ["target-character", "target-scene"],
				imageUrl: "https://assets.example/source-project/source-character.png",
				description: "source-character appears in source-project",
			},
		});
	});

	it("rejects no values implicitly and preserves null and scalar evidence", () => {
		const rewritten = rewriteClonedMaterialValue(
			[null, true, 7, "unmapped-id"],
			{
				sourceProjectId: "source-project",
				targetProjectId: "target-project",
				assetIdMapping: new Map(),
			},
		);

		expect(rewritten).toEqual([null, true, 7, "unmapped-id"]);
	});
});
