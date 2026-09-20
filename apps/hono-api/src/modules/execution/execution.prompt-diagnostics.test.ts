import { describe, expect, it } from "vitest";
import { projectAssetDiagnosticsForPrompt } from "./execution.prompt-diagnostics";

describe("project diagnostic prompt projection", () => {
	it("bounds unrelated project diagnostics while preserving counts and selected facts", () => {
		const diagnostics = Array.from({ length: 624 }, (_, index) => ({
			referenceId: `asset-${index}-${"long-stable-identity".repeat(10)}`,
			code: "no_successful_analysis_receipt",
		}));
		const before = JSON.stringify(diagnostics);
		const result = projectAssetDiagnosticsForPrompt(diagnostics, new Set([diagnostics[0]!.referenceId]));
		expect(result.total).toBe(624);
		expect(result.byCode).toEqual([{ code: "no_successful_analysis_receipt", count: 624 }]);
		expect(result.selectedAndUnscoped).toEqual([diagnostics[0]]);
		expect(JSON.stringify(result).length).toBeLessThan(1000);
		expect(JSON.stringify(diagnostics)).toBe(before);
	});
	it("retains global errors and reports an empty audit without inventing evidence", () => {
		const global = { referenceId: null, code: "analysis_store_unavailable" };
		expect(projectAssetDiagnosticsForPrompt([global], new Set()).selectedAndUnscoped).toEqual([global]);
		expect(projectAssetDiagnosticsForPrompt([], new Set())).toMatchObject({ total: 0, byCode: [], selectedAndUnscoped: [] });
	});
});
