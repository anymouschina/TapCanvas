import { describe, expect, it, vi } from "vitest";
import { diffWorkflowOutputCheckpoint, type WorkflowOutputCheckpointJson } from "./execution.output-checkpoint-delta";
import { decodeWorkflowOutput, encodeWorkflowOutput, patchWorkflowOutput } from "./execution.output-storage";

function replay(previous: WorkflowOutputCheckpointJson, next: WorkflowOutputCheckpointJson) {
	const before = JSON.stringify(previous);
	const after = JSON.stringify(next);
	const edits = diffWorkflowOutputCheckpoint(previous, next);
	const stored = encodeWorkflowOutput(previous);
	const patched = patchWorkflowOutput(stored, edits).output;
	expect(decodeWorkflowOutput(patched)).toEqual(next);
	expect(patched).toEqual(encodeWorkflowOutput(next));
	expect(JSON.stringify(previous)).toBe(before);
	expect(JSON.stringify(next)).toBe(after);
	return edits;
}

describe("workflow output checkpoint delta", () => {
	it("roundtrips changed control, failures and unknown evidence while retaining accepted handles and assets", () => {
		const accepted = Object.freeze({ taskId: "accepted-provider-task", asset: { url: "https://owned.example/video.mp4" }, body: "source".repeat(2_000) });
		const previous = { accepted, schedule: { dueAt: "2026-09-30T08:00:00Z", retry: 1 },
			failure: { reason: "original", missing: ["receipt"] }, unknownEvidence: { protocol: "external/v8", cursor: "one" }, obsolete: true };
		const next = { accepted, schedule: { dueAt: "2026-09-30T08:01:00Z", retry: 2 },
			failure: { reason: "corrected", missing: [] }, unknownEvidence: { protocol: "external/v8", cursor: "two", extension: { confidence: 0 } },
			settledAt: "2026-09-30T08:00:30Z" };
		const edits = replay(previous, next);
		expect(edits.some(edit => edit.path[0] === "accepted")).toBe(false);
		expect(edits).toContainEqual({ kind: "delete", path: ["obsolete"] });
		expect(edits).toContainEqual({ kind: "replace", path: ["unknownEvidence", "cursor"], value: "two" });
		expect(edits).toContainEqual({ kind: "add", path: ["settledAt"], value: next.settledAt });
	});

	it("ignores object key ordering and compares all scalar JSON values", () => {
		expect(replay({ one: { first: null, second: false }, two: [0, "", true] },
			{ two: [0, "", true], one: { second: false, first: null } })).toEqual([]);
		for (const [previous, next] of [[0, 1], [false, true], [null, ""], [{ value: 1 }, []], [[], null]] as const) {
			replay(previous, next);
		}
	});

	it("replaces resized arrays as a unit and preserves same-length order changes", () => {
		const previous = { items: [{ taskId: "one" }, { taskId: "two" }], other: { cursor: 1 } };
		const resized: { items: readonly WorkflowOutputCheckpointJson[]; other: { cursor: number } } =
			{ items: [{ taskId: "new" }, { taskId: "one", asset: "real" }, { taskId: "two" }], other: { cursor: 2 } };
		expect(replay(previous, resized)).toContainEqual({ kind: "replace", path: ["items"], value: resized.items });
		const reordered = { items: [{ taskId: "two" }, { taskId: "one" }], other: { cursor: 1 } };
		expect(replay(previous, reordered)).toEqual([
			{ kind: "replace", path: ["items", 0, "taskId"], value: "two" },
			{ kind: "replace", path: ["items", 1, "taskId"], value: "one" },
		]);
		replay(resized, { items: [], other: { cursor: 2 } });
	});

	it("retains literal paths and JSON-special object keys", () => {
		const previous: WorkflowOutputCheckpointJson = JSON.parse('{"__proto__":{"taskId":"one"},"a/b~c":1,"toJSON":"old","\\u0000":"old"}');
		const next: WorkflowOutputCheckpointJson = JSON.parse('{"__proto__":{"taskId":"two"},"a/b~c":{"timestamp":"now"},"toJSON":"new","\\u0000":"\\ud800"}');
		expect(replay(previous, next)).toContainEqual({ kind: "replace", path: ["__proto__", "taskId"], value: "two" });
	});

	it("does not exempt changed asset URLs, accepted task IDs or timestamps", () => {
		const previous = { evidence: { taskId: "accepted-one", asset: { url: "https://owned.example/one.mp4" },
			acceptedAt: "2026-09-30T08:00:00Z" } };
		const next = { evidence: { taskId: "accepted-two", asset: { url: "https://owned.example/two.mp4" },
			acceptedAt: "2026-09-30T08:01:00Z" } };
		expect(replay(previous, next)).toEqual([
			{ kind: "replace", path: ["evidence", "acceptedAt"], value: next.evidence.acceptedAt },
			{ kind: "replace", path: ["evidence", "asset", "url"], value: next.evidence.asset.url },
			{ kind: "replace", path: ["evidence", "taskId"], value: next.evidence.taskId },
		]);
	});

	it("does not traverse an identity-equal immutable branch", () => {
		const shared = Object.freeze({ artifacts: Object.freeze(Array.from({ length: 100 }, (_, index) => Object.freeze({ taskId: `task-${index}`, text: "source".repeat(1_000) }))) });
		const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptors");
		try {
			expect(diffWorkflowOutputCheckpoint({ shared, status: "running" }, { shared, status: "success" }))
				.toEqual([{ kind: "replace", path: ["status"], value: "success" }]);
			expect(descriptors.mock.calls.some(([value]) => value === shared || value === shared.artifacts)).toBe(false);
		} finally { descriptors.mockRestore(); }
	});

	it("allows a previous snapshot to become a nested value without treating cross-snapshot sharing as a cycle", () => {
		const previous = { taskId: "accepted", evidence: { timestamp: "first" } };
		replay(previous, { taskId: "accepted", previous });
	});

	it("rejects non-normalized changed values without invoking their getters or toJSON", () => {
		const getter = vi.fn(() => "unexpected");
		const toJSON = vi.fn(() => "unexpected");
		const cycle: Record<string, unknown> = {}; cycle.self = cycle;
		const accessor = Object.defineProperty({}, "receipt", { enumerable: true, get: getter });
		const withHook = { toJSON };
		class CustomArray extends Array<number> { toJSON = toJSON; }
		for (const value of [new Date(), accessor, withHook, cycle, undefined, Infinity, NaN, [1, , 3], new Map(), new CustomArray(1)]) {
			expect(() => diffWorkflowOutputCheckpoint(null, value as WorkflowOutputCheckpointJson)).toThrow(/checkpoint/);
			expect(() => diffWorkflowOutputCheckpoint(value as WorkflowOutputCheckpointJson, null)).toThrow(/checkpoint/);
		}
		expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
	});
});
