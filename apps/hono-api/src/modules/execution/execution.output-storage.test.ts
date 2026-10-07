import { describe, expect, it } from "vitest";
import { decodeWorkflowOutput, encodeWorkflowOutput, patchWorkflowOutput, workflowOutputDelta } from "./execution.output-storage";
import type { WorkflowOutputPatch } from "./execution.output-storage";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";

describe("workflow output content-addressed storage", () => {
	it("deduplicates repeated text and evidence without losing any JSON field", () => {
		const text = "镜头动作与人物对白".repeat(3_000);
		const evidence = { candidates: Array.from({ length: 50 }, (_, id) => ({ id, text: `case-${id}`.repeat(100) })) };
		const value = { text, evidence };
		const output = {
			protocolVersion: "1", executorRef: "agents.run/v1", nodeId: "writer", executionMode: "each",
			ports: { collection: [value] }, artifacts: [{ type: "text", identity: "one", value: text }], evidence,
			itemRuns: [{ itemId: "one", index: 0, lineage: [], runtimeNodeId: "writer::one", status: "success", ports: { value },
				artifacts: [{ type: "text", identity: "one", value: text }], evidence }],
		};
		const stored = encodeWorkflowOutput(output);
		expect(decodeWorkflowOutput(JSON.stringify(stored))).toEqual(output);
		expect(parseWorkflowNodeOutputV1(stored)).toEqual(parseWorkflowNodeOutputV1(output));
		expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(Buffer.byteLength(JSON.stringify(output)) / 2);
		expect(Object.values(stored.blocks).filter((block) => block === text)).toHaveLength(1);
	});

	it("sends only new blocks and replaces the manifest when the next checkpoint changes", () => {
		const first = encodeWorkflowOutput({ items: [{ id: "one", text: "一".repeat(1_000) }], status: "running" });
		const next = encodeWorkflowOutput({ items: [{ id: "one", text: "一".repeat(1_000) }, { id: "two", text: "二".repeat(1_000) }], status: "success" });
		const delta = workflowOutputDelta(next, Object.keys(first.blocks));
		expect(Object.values(delta.blocks)).not.toContain("一".repeat(1_000));
		expect(Object.values(delta.blocks)).toContain("二".repeat(1_000));
		const retained = Object.fromEntries(Object.entries(first.blocks).filter(([id]) => delta.blockIds.includes(id)));
		expect(decodeWorkflowOutput({ ...next, blocks: { ...retained, ...delta.blocks } })).toEqual(decodeWorkflowOutput(next));
		expect(workflowOutputDelta(next, Object.keys(next.blocks)).blocks).toEqual({});
	});

	it("canonicalizes object order, preserves JSON ownership and cannot confuse user values with references", () => {
		const shared = { text: "shared".repeat(400), ref: ["ref", "not-a-block"], __value: { storageVersion: "user" } };
		const a = encodeWorkflowOutput({ a: shared, b: shared });
		const b = encodeWorkflowOutput({ b: shared, a: shared });
		expect(a).toEqual(b);
		const decoded = decodeWorkflowOutput(a) as { a: typeof shared; b: typeof shared };
		expect(decoded).toEqual({ a: shared, b: shared });
		decoded.a.text = "edited";
		expect(decoded.b.text).toBe(shared.text);
		const special = JSON.parse('{"__proto__":{"text":"preserved"},"constructor":null}') as unknown;
		expect(decodeWorkflowOutput(encodeWorkflowOutput(special))).toEqual(special);
	});

	it("explicitly rejects missing, corrupt or unsupported blocks", () => {
		const stored = encodeWorkflowOutput({ text: "retained".repeat(1_000) });
		const id = Object.keys(stored.blocks)[0]!;
		const missing = { ...stored, blocks: {} };
		expect(() => decodeWorkflowOutput(missing)).toThrow("block missing");
		expect(() => decodeWorkflowOutput({ ...stored, blocks: { ...stored.blocks, [id]: "corrupted" } })).toThrow("hash mismatch");
		expect(() => decodeWorkflowOutput({ ...stored, storageVersion: "unknown" })).toThrow("Unsupported");
		expect(() => decodeWorkflowOutput({ ...stored, root: ["unknown", []] })).toThrow("Invalid");
	});

	it("reads semantic JSON and uses the existing JSON serialization contract", () => {
		const value = { missing: undefined, at: new Date("2026-01-01"), values: [undefined, null, false, 0, ""] };
		expect(decodeWorkflowOutput(encodeWorkflowOutput(value))).toEqual(JSON.parse(JSON.stringify(value)));
		expect(decodeWorkflowOutput('{"evidence":{"taskId":"accepted"}}')).toEqual({ evidence: { taskId: "accepted" } });
		expect(decodeWorkflowOutput(null)).toBeNull();
		expect(() => encodeWorkflowOutput(undefined)).toThrow("not JSON serializable");
		expect(() => encodeWorkflowOutput(1n)).toThrow();
	});

	it("preserves JSON strings that PostgreSQL jsonb cannot represent directly", () => {
		const input = { ["nul\u0000key"]: ["\ud800", "\udfff", "\u0000", "中文😀"] };
		const stored = encodeWorkflowOutput(input);
		expect(decodeWorkflowOutput(stored)).toEqual(input);
		expect(JSON.stringify(stored)).toContain("escaped-string");
	});
});

describe("explicit stored workflow output patches", () => {
	it("reuses a huge untouched branch and only encodes the replacement and its ancestors", () => {
		const body = { items: Array.from({ length: 1_000 }, (_, index) => ({ index, text: "retained receipt".repeat(500) })) };
		const previous = encodeWorkflowOutput({ accepted: body, control: { status: "waiting" } });
		const result = patchWorkflowOutput(previous, [{ kind: "replace", path: ["control", "status"], value: "success" }]);
		expect(result.diagnostics).toMatchObject({ patchedContainers: 2, encodedReplacementValues: 1 });
		expect(result.diagnostics.reusedBlocks).toBeGreaterThanOrEqual(2);
		for (const [id, block] of Object.entries(previous.blocks)) {
			if (Object.hasOwn(result.output.blocks, id)) expect(result.output.blocks[id]).toBe(block);
		}
		const expected = encodeWorkflowOutput({ accepted: body, control: { status: "success" } });
		expect(result.output).toEqual(expected);
		expect(JSON.stringify(decodeWorkflowOutput(result.output))).toBe(JSON.stringify(decodeWorkflowOutput(expected)));
	});

	it("adds an explicit missing object field or array element without implicit upsert", () => {
		const previous = encodeWorkflowOutput({ object: { z: "retained" }, array: ["zero", "two"] });
		const result = patchWorkflowOutput(previous, [
			{ kind: "add", path: ["object", "a"], value: { taskId: "accepted" } },
			{ kind: "add", path: ["array", 1], value: "one" },
		]);
		expect(result.output).toEqual(encodeWorkflowOutput({ object: { a: { taskId: "accepted" }, z: "retained" }, array: ["zero", "one", "two"] }));
		expect(decodeWorkflowOutput(patchWorkflowOutput(previous, [{ kind: "add", path: ["array", 2], value: undefined }]).output))
			.toEqual({ object: { z: "retained" }, array: ["zero", "two", null] });
		expect(() => patchWorkflowOutput(previous, [{ kind: "add", path: ["object", "z"], value: "overwrite" }])).toThrow("already exists");
		expect(() => patchWorkflowOutput(previous, [{ kind: "add", path: [], value: "overwrite" }])).toThrow("already exists");
		expect(() => patchWorkflowOutput(previous, [{ kind: "add", path: ["missing", "child"], value: 1 }])).toThrow("missing");
		expect(() => patchWorkflowOutput(previous, [
			{ kind: "add", path: ["array", 1], value: "insert" }, { kind: "replace", path: ["array", 0], value: "ambiguous" },
		])).toThrow("index shift");
	});

	it("patches independent paths through a shared block without changing another occurrence", () => {
		const shared = { text: "retained".repeat(1_000), status: "waiting", old: true };
		const previous = encodeWorkflowOutput({ a: shared, b: shared, array: ["zero", { taskId: "accepted" }, "two"] });
		const result = patchWorkflowOutput(previous, [
			{ kind: "replace", path: ["a", "status"], value: "success" },
			{ kind: "delete", path: ["a", "old"] },
			{ kind: "replace", path: ["array", 1, "taskId"], value: "same-task-complete" },
		]);
		expect(decodeWorkflowOutput(result.output)).toEqual({
			a: { text: shared.text, status: "success" }, b: shared, array: ["zero", { taskId: "same-task-complete" }, "two"],
		});
		expect(decodeWorkflowOutput(previous)).toEqual({ a: shared, b: shared, array: ["zero", { taskId: "accepted" }, "two"] });
		expect(decodeWorkflowOutput(patchWorkflowOutput(previous, [{ kind: "delete", path: ["array", 1] }]).output))
			.toEqual({ a: shared, b: shared, array: ["zero", "two"] });
	});

	it("normalizes replacements using their JSON location and preserves escaped keys and strings", () => {
		const key = "nul\u0000key";
		const previous = encodeWorkflowOutput({ [key]: "old", date: "old", object: { omitted: 1 }, array: [1, 2] });
		const result = patchWorkflowOutput(previous, [
			{ kind: "replace", path: [key], value: { toJSON: (location: string) => ({ location, text: "\ud800\u0000" }) } },
			{ kind: "replace", path: ["date"], value: new Date("2026-01-01") },
			{ kind: "replace", path: ["object", "omitted"], value: undefined },
			{ kind: "replace", path: ["array", 0], value: undefined },
			{ kind: "replace", path: ["array", 1], value: { toJSON: (location: string) => location } },
		]);
		expect(decodeWorkflowOutput(result.output)).toEqual({ [key]: { location: key, text: "\ud800\u0000" },
			date: "2026-01-01T00:00:00.000Z", object: {}, array: [null, "1"] });
		const special = JSON.parse('{"__proto__":"old","constructor":"old"}') as unknown;
		expect(decodeWorkflowOutput(patchWorkflowOutput(encodeWorkflowOutput(special), [
			{ kind: "replace", path: ["__proto__"], value: "preserved" },
		]).output)).toEqual(JSON.parse('{"__proto__":"preserved","constructor":"old"}'));
		expect(decodeWorkflowOutput(patchWorkflowOutput(encodeWorkflowOutput({ toJSON: "old", accepted: "retained" }), [
			{ kind: "replace", path: ["toJSON"], value: () => "must not reinterpret its parent" },
		]).output)).toEqual({ accepted: "retained" });
	});

	it("supports explicit root replacement and leaves cold-start encoding unchanged", () => {
		const value = { at: new Date("2026-01-01"), missing: undefined, values: [undefined, "\udfff", "\u0000"] };
		const result = patchWorkflowOutput(encodeWorkflowOutput({ taskId: "accepted" }), [{ kind: "replace", path: [], value }]);
		expect(result.output).toEqual(encodeWorkflowOutput(value));
		expect(decodeWorkflowOutput(result.output)).toEqual(JSON.parse(JSON.stringify(value)));
		expect(patchWorkflowOutput(result.output, []).output).toEqual(result.output);
	});

	it.each(["object", "array", "root"] as const)("calls a function's own toJSON before normalization at %s", position => {
		const value = Object.assign(() => undefined, { toJSON: (key: string) => ({ key, taskId: "retained-function-receipt" }) });
		const previous = encodeWorkflowOutput({ object: "old", array: ["old"] });
		const path = position === "object" ? ["object"] : position === "array" ? ["array", 0] : [];
		const expected = encodeWorkflowOutput(position === "object" ? { object: value, array: ["old"] }
			: position === "array" ? { object: "old", array: [value] } : value);
		const result = patchWorkflowOutput(previous, [{ kind: "replace", path, value }]);
		expect(result.output).toEqual(expected);
		expect(JSON.stringify(decodeWorkflowOutput(result.output))).toBe(JSON.stringify(decodeWorkflowOutput(expected)));
	});

	it.each([
		{ name: "undefined", value: undefined },
		{ name: "symbol", value: Symbol("omitted") },
		{ name: "function", value: () => "omitted" },
	])("does not read inherited fields when special-key $name values are omitted", ({ value }) => {
		for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
			const previous = encodeWorkflowOutput({ [key]: "old", accepted: "retained" });
			const cold = encodeWorkflowOutput({ [key]: value, accepted: "retained" });
			expect(patchWorkflowOutput(previous, [{ kind: "replace", path: [key], value }]).output).toEqual(cold);
			expect(patchWorkflowOutput(encodeWorkflowOutput({ accepted: "retained" }), [{ kind: "add", path: [key], value }]).output).toEqual(cold);
			expect(patchWorkflowOutput(previous, [{ kind: "delete", path: [key] }]).output).toEqual(encodeWorkflowOutput({ accepted: "retained" }));
		}
	});

	it("matches a cold encode across sequential stored patches and storage threshold changes", () => {
		let semantic = { accepted: { taskId: "same-task", text: "large".repeat(1_000) }, state: { status: "waiting", details: { old: true } } };
		let stored = encodeWorkflowOutput(semantic);
		for (let index = 0; index < 20; index += 1) {
			const text = index % 2 === 0 ? "small" : "large".repeat(1_000);
			const status = index % 2 === 0 ? "success" : "waiting";
			semantic = { ...semantic, accepted: { ...semantic.accepted, text }, state: { ...semantic.state, status } };
			stored = patchWorkflowOutput(stored, [
				{ kind: "replace", path: ["accepted", "text"], value: text },
				{ kind: "replace", path: ["state", "status"], value: status },
			]).output;
			const cold = encodeWorkflowOutput(semantic);
			expect(stored).toEqual(cold);
			expect(JSON.stringify(decodeWorkflowOutput(stored))).toBe(JSON.stringify(decodeWorkflowOutput(cold)));
		}
	});

	it.each<WorkflowOutputPatch[]>([
		[{ kind: "replace", path: ["missing"], value: 1 }],
		[{ kind: "replace", path: ["array", -1], value: 1 }],
		[{ kind: "replace", path: ["array", 0.5], value: 1 }],
		[{ kind: "replace", path: ["array", 2], value: 1 }],
		[{ kind: "replace", path: ["array", "0"], value: 1 }],
		[{ kind: "replace", path: ["object", 0], value: 1 }],
		[{ kind: "delete", path: [] }],
		[{ kind: "replace", path: ["scalar", "child"], value: 1 }],
		[{ kind: "delete", path: ["object", "field"] }, { kind: "replace", path: ["object", "field"], value: 1 }],
		[{ kind: "replace", path: ["object"], value: {} }, { kind: "delete", path: ["object", "field"] }],
		[{ kind: "delete", path: ["array", 0] }, { kind: "replace", path: ["array", 1], value: 1 }],
	])("rejects missing, invalid or conflicting operations %#", (...operations) => {
		const previous = encodeWorkflowOutput({ array: [1, 2], object: { field: "kept" }, scalar: 1 });
		expect(() => patchWorkflowOutput(previous, operations)).toThrow();
	});

	it("rejects invalid replacement JSON and corrupt or missing blocks even on an untouched branch", () => {
		const previous = encodeWorkflowOutput({ untouched: "retained".repeat(1_000), status: "waiting" });
		const edit: WorkflowOutputPatch[] = [{ kind: "replace", path: ["status"], value: "success" }];
		const blockId = Object.keys(previous.blocks).find(id => typeof previous.blocks[id] === "string")!;
		expect(() => patchWorkflowOutput({ ...previous, blocks: { ...previous.blocks, [blockId]: "corrupt" } }, edit)).toThrow("hash mismatch");
		const missing = { ...previous.blocks }; delete missing[blockId];
		expect(() => patchWorkflowOutput({ ...previous, blocks: missing }, edit)).toThrow("block missing");
		expect(() => patchWorkflowOutput({ ...previous, blocks: { ...previous.blocks, invalid: "unreachable corrupt block" } }, edit)).toThrow("hash mismatch");
		expect(() => patchWorkflowOutput({ ...previous, root: ["unknown", []] } as unknown as typeof previous, edit)).toThrow("Invalid");
		expect(() => patchWorkflowOutput({ ...previous, storageVersion: "unsupported" } as unknown as typeof previous, edit)).toThrow("Unsupported");
		expect(() => patchWorkflowOutput(previous, [{ kind: "replace", path: [], value: undefined }])).toThrow("not JSON serializable");
		expect(() => patchWorkflowOutput(previous, [{ kind: "replace", path: ["status"], value: 1n }])).toThrow();
		const cycle: { self?: unknown } = {}; cycle.self = cycle;
		expect(() => patchWorkflowOutput(previous, [{ kind: "replace", path: ["status"], value: cycle }])).toThrow();
	});
});
