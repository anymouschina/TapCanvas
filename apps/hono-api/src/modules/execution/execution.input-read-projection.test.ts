import { describe, expect, it } from "vitest";
import { collectWorkflowInputReadProjections } from "./execution.input-read-projection";
import { AgentNodeReadSchema } from "./execution.agent-history";

const document = { text: "完整来源😀。".repeat(500), identity: "source-a" };
const inputs = { source: [document] };
const identity = { executionId: "execution", persistedInputSource: { nodeId: "parent", revision: "revision", inputs } };

describe("generic frozen input references", () => {
	it("references exact uniquely persisted subtrees without changing the source", () => {
		const before = JSON.stringify(inputs);
		const result = collectWorkflowInputReadProjections(inputs, identity);
		expect(result.projections).toHaveLength(1);
		const projection = result.projections[0]!;
		const reference = JSON.parse(projection.reference);
		const read = AgentNodeReadSchema.parse(reference.contentRead.args);
		expect(read).toMatchObject({ executionId: "execution", nodeId: "parent", revision: "revision",
			path: ["source", "0"], field: "input", format: "json", offset: 0, textLimit: 12000 });
		expect(projection.source).toBe(JSON.stringify(document));
		expect(projection.reference.length).toBeLessThan(projection.source.length);
		expect(reference.fields).toEqual({ text: "string", identity: "string" });
		expect(JSON.stringify(inputs)).toBe(before);
		expect(JSON.stringify(result.diagnostics)).not.toContain(document.text);
	});
	it("uses the persisted parent path for a sliced runtime input", () => {
		const result = collectWorkflowInputReadProjections({ current: [document] }, {
			executionId: "execution", persistedInputSource: { nodeId: "parent", revision: "revision",
				inputs: { group: [{ members: [document] }] } },
		});
		expect(JSON.parse(result.projections[0]!.reference).contentRead.args.path).toEqual(["group", "0", "members", "0"]);
	});
	it("describes a complete array without dropping or ranking its items", () => {
		const array = Array.from({ length: 100 }, (_, index) => ({ index, text: "small item" }));
		const scoped = { source: [array] };
		const result = collectWorkflowInputReadProjections(scoped, { executionId: "execution",
			persistedInputSource: { nodeId: "parent", revision: "revision", inputs: scoped } });
		expect(result.projections).toHaveLength(1);
		expect(JSON.parse(result.projections[0]!.reference)).toMatchObject({ kind: "array", itemCount: array.length });
		expect(JSON.parse(result.projections[0]!.source)).toEqual(array);
	});
	it("keeps source and unrelated evidence independently readable instead of reloading their parent", () => {
		const contract = {
			limits: { duration: 30 },
			source: document,
			evidence: { text: "unrelated evidence".repeat(800), identity: "evidence-b" },
		};
		const scoped = { contract: [contract] };
		const before = JSON.stringify(scoped);
		const result = collectWorkflowInputReadProjections(scoped, { executionId: "execution",
			persistedInputSource: { nodeId: "parent", revision: "revision", inputs: scoped } });
		expect(result.projections).toHaveLength(2);
		const paths = result.projections.map(item => AgentNodeReadSchema.parse(JSON.parse(item.reference).contentRead.args).path);
		expect(paths).toEqual([["contract", "0", "source"], ["contract", "0", "evidence"]]);
		let disclosed = before;
		for (const item of result.projections) disclosed = disclosed.replace(item.source, item.reference);
		const rendered = JSON.parse(disclosed).contract[0];
		expect(rendered.limits).toEqual({ duration: 30 });
		expect(rendered.source.contentRead.args.path).toEqual(paths[0]);
		expect(rendered.evidence.contentRead.args.path).toEqual(paths[1]);
		expect(disclosed).not.toContain(document.text);
		expect(disclosed.length).toBeLessThan(before.length);
		expect(JSON.stringify(scoped)).toBe(before);
	});

	it("never references an ancestor of a subtree already emitted through another runtime input", () => {
		const parent = { source: document, value: "visible" };
		const result = collectWorkflowInputReadProjections({ child: [document], parent: [parent] }, {
			executionId: "execution", persistedInputSource: { nodeId: "parent", revision: "revision", inputs: { parent: [parent] } },
		});
		expect(result.projections).toHaveLength(1);
		expect(result.projections[0]!.source).toBe(JSON.stringify(document));
	});

	it("retains missing, changed, and ambiguous source identities", () => {
		expect(collectWorkflowInputReadProjections(inputs, { executionId: "execution" }).projections).toEqual([]);
		expect(collectWorkflowInputReadProjections({ source: [{ ...document, identity: "changed" }] }, identity).projections).toEqual([]);
		const ambiguous = collectWorkflowInputReadProjections(inputs, { executionId: "execution",
			persistedInputSource: { nodeId: "parent", revision: "revision", inputs: { a: [document], b: [document] } } });
		expect(ambiguous.projections).toEqual([]);
		expect(ambiguous.diagnostics.retainedAmbiguous).toBeGreaterThan(0);
	});
	it("does not replace small objects or create overlapping nested references", () => {
		const small = { source: [{ value: 1 }] };
		expect(collectWorkflowInputReadProjections(small, { executionId: "execution",
			persistedInputSource: { nodeId: "parent", revision: "revision", inputs: small } }).projections).toEqual([]);
		const nested = { source: [{ nested: document }] };
		expect(collectWorkflowInputReadProjections(nested, { executionId: "execution",
			persistedInputSource: { nodeId: "parent", revision: "revision", inputs: nested } }).projections).toHaveLength(1);
	});
	it("keeps excluded knowledge projections and their containing parents intact", () => {
		const value = { knowledge: document, independent: { text: "other".repeat(900) } };
		const scoped = { source: [value] };
		const result = collectWorkflowInputReadProjections(scoped, { executionId: "execution",
			persistedInputSource: { nodeId: "parent", revision: "revision", inputs: scoped } },
		{ excludedSources: [JSON.stringify(document)] });
		expect(result.projections).toHaveLength(1);
		expect(result.projections[0]!.source).toBe(JSON.stringify(value.independent));
	});
	it("preserves unsupported paths rather than inventing a shorter handle", () => {
		const key = "x".repeat(513);
		const result = collectWorkflowInputReadProjections(inputs, { executionId: "execution",
			persistedInputSource: { nodeId: "parent", revision: "revision", inputs: { [key]: [document] } } });
		expect(result.projections).toEqual([]);
		expect(result.diagnostics.retainedInvalidPath).toBeGreaterThan(0);
	});
});
