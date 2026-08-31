import { describe, expect, it } from "vitest";

import { buildAgentImageExecutionCatalog } from "./agents-tool-bridge.model-execution-catalog";

describe("buildAgentImageExecutionCatalog", () => {
	it("returns exact executable image model keys with a stable revision", () => {
		const summary = {
			imageModels: [{
				vendorKey: "newapi",
				modelKey: "doubao-seedream-5-0-pro-260628",
				modelAlias: null,
				labelZh: "Seedream 5.0 Pro",
				availability: "system" as const,
				pricingCost: 120,
				useCases: [],
				imageOptions: null,
			}],
			videoModels: [],
			audioModels: [],
		};
		const first = buildAgentImageExecutionCatalog(summary, "2026-08-14T00:00:00.000Z");
		const second = buildAgentImageExecutionCatalog(summary, "2026-08-14T00:01:00.000Z");

		expect(first.models).toEqual([{
			modelKey: "doubao-seedream-5-0-pro-260628",
			label: "Seedream 5.0 Pro",
			pricingCost: 120,
			imageOptions: null,
		}]);
		expect(first.revision).toBe(second.revision);
		expect(first.selectionContract).toContain("Never invent");
		expect(first.selectionContract).toContain("node.data.imageModel");
		expect(first.selectionContract).not.toContain("node.data.modelKey");
	});
});
