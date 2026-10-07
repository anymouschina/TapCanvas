import { describe, expect, it, vi } from "vitest";
import { projectOptionalClipStagingDiagrams } from "./execution.clip-staging-optional";

describe("optional Clip staging diagrams", () => {
	const context = { executionId: "film-execution", runtimeNodeId: "materialize-clip-nodes" };

	it("preserves prior media and partial diagram assets while returning explicit failure evidence", async () => {
		const retainedAssets = ["video-node", "image-node"];
		const materialize = vi.fn(async () => {
			retainedAssets.push("already-stored-diagram");
			throw new Error("diagram canvas persistence unavailable");
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const result = await projectOptionalClipStagingDiagrams(materialize, context);
			expect(result).toMatchObject({ status: "failed", nodeIds: [], diagnostics: [{
				code: "optional_staging_diagram_failed", ...context, errorMessage: "diagram canvas persistence unavailable",
			}] });
			expect(retainedAssets).toEqual(["video-node", "image-node", "already-stored-diagram"]);
			expect(materialize).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"workflow_optional_staging_diagram_diagnostic"'));
		} finally { warn.mockRestore(); }
	});

	it("retains verified diagram receipts and distinguishes an unavailable optional capability", async () => {
		const receipt = { nodeIds: ["diagram-1"], createdNodeIds: ["diagram-1"] };
		expect(await projectOptionalClipStagingDiagrams(async () => receipt, context))
			.toEqual({ ...receipt, status: "succeeded", diagnostics: [] });
		expect(await projectOptionalClipStagingDiagrams(undefined, context))
			.toEqual({ nodeIds: [], createdNodeIds: [], status: "not_requested", diagnostics: [] });
	});
});
