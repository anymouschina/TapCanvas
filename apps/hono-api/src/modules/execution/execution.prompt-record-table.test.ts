import { expect, it } from "vitest";
import { workflowPromptRecordTable } from "./execution.prompt-record-table";
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function expand(base: Record<string, unknown>, item: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const result = { ...base };
	for (const [key, value] of Object.entries(item)) {
		result[key] = record(value) && record(result[key]) ? expand(result[key], value) : value;
	}
	return result;
}
it("preserves every candidate and nested fact exactly, including null, empty and absent fields", () => {
	const rows = [
		{ assetId: "a", state: "ready", facts: { name: "甲", unavailable: null, anchors: [], present: false }, evidence: [] },
		{ assetId: "b", state: "ready", facts: { name: "乙", unavailable: null, anchors: [], present: false }, evidence: [], note: "only b" },
	];
	const table = workflowPromptRecordTable(rows);
	expect(table.items.map((item) => item.assetId)).toEqual(["a", "b"]);
	expect(table.items.map((item) => expand(table.sharedFacts, item))).toEqual(rows);
	expect(table.sharedFacts).toMatchObject({ state: "ready", facts: { unavailable: null, anchors: [], present: false } });
});
it("does not replace differing arrays, scalar types, or object shapes with shared values", () => {
	const rows = [{ assetId: "a", x: null, a: [1], b: {} }, { assetId: "b", x: 0, a: [], b: { name: "乙" } }];
	const table = workflowPromptRecordTable(rows);
	expect(table.items.map((item) => expand(table.sharedFacts, item))).toEqual(rows);
});
it("reduces repeated metadata without changing stable IDs or descriptions", () => {
	const rows = Array.from({ length: 50 }, (_, i) => ({ assetId: `asset:${i}`, description: `描述${i}`,
		state: "ready", facts: { identity: `角色${i}`, physicalIdentityKey: null, anchors: [], prohibitedDrift: [], taskId: null } }));
	const table = workflowPromptRecordTable(rows);
	expect(table.items.map((item) => expand(table.sharedFacts, item))).toEqual(rows);
	expect(JSON.stringify(table).length).toBeLessThan(JSON.stringify(rows).length * 0.65);
});
