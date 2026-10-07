import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWorkflowAgentRepairHandoff, WorkflowAgentRepairSourceMismatchError } from "./execution.agent-repair-handoff";

const source = {
	inputs: {
		outline: [{ outlineId: "outline-1", objectId: "object-1", kind: "object", name: "Glass", brief: "exact source facts",
			executionProvenance: { version: 1, executionId: "execution-1", sessionId: "session-1", apiStyle: "responses" } }],
		contract: [{ required: ["name", "description"], limit: 12, enabled: true, optional: null }],
	},
	userIntentContract: { requestedAction: "create", sourceExecutionId: "execution-1" },
	projectContext: { projectId: "project-1", chapterId: "chapter-1" },
};

function reverseObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(reverseObjectKeys);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reverseObjectKeys(nested)]));
	}
	return value;
}

function checkpoint(sourceContext = JSON.stringify(source)) {
	return { version: 1, contractHash: "sha256:frozen-contract", sourceContext,
		candidate: '{"exact":"unfinished', correction: "repair invalid JSON", pendingEditPrefix: '{"textEdits":',
		progress: { candidateSha256: "sha256:frozen-candidate", unchangedRepairs: 3 },
		authorSelfCheck: { revisions: [{ attemptState: { status: "unknown", requestId: "paid-request-1" } }] } };
}

function sourceMismatch(frozenSource: string, currentSource: string): WorkflowAgentRepairSourceMismatchError {
	try {
		verifyWorkflowAgentRepairHandoff({ checkpoint: checkpoint(frozenSource), sourceContext: currentSource });
	} catch (error) {
		expect(error).toBeInstanceOf(WorkflowAgentRepairSourceMismatchError);
		return error as WorkflowAgentRepairSourceMismatchError;
	}
	throw new Error("expected_source_identity_rejection");
}

describe("workflow repair frozen source identity", () => {
	it("proves reordered persisted facts equal while retaining the original draft and source bytes", () => {
		const frozen = checkpoint();
		const original = JSON.stringify(frozen);
		const persistedSource = JSON.stringify(reverseObjectKeys(source), null, 2);
		expect(persistedSource).not.toBe(frozen.sourceContext);
		const retained = verifyWorkflowAgentRepairHandoff({ checkpoint: frozen, sourceContext: persistedSource });
		expect(retained).toEqual(frozen);
		expect(retained.sourceContext).toBe(frozen.sourceContext);
		expect(retained.candidate).toBe(frozen.candidate);
		expect(retained.pendingEditPrefix).toBe(frozen.pendingEditPrefix);
		expect(retained.authorSelfCheck).toBe(frozen.authorSelfCheck);
		expect(JSON.stringify(frozen)).toBe(original);
	});

	it.each([
		["object value", { ...source, projectContext: { ...source.projectContext, projectId: "another-project" } }, "/projectContext/projectId"],
		["source identity", { ...source, userIntentContract: { ...source.userIntentContract, sourceExecutionId: "another-execution" } }, "/userIntentContract/sourceExecutionId"],
		["array order", { ...source, inputs: { ...source.inputs, contract: [{ ...source.inputs.contract[0], required: ["description", "name"] }] } }, "/inputs/contract/0/required/0"],
		["array length", { ...source, inputs: { ...source.inputs, outline: [] } }, "/inputs/outline"],
		["value type", { ...source, inputs: { ...source.inputs, contract: [{ ...source.inputs.contract[0], limit: "12" }] } }, "/inputs/contract/0/limit"],
		["numeric value", { ...source, inputs: { ...source.inputs, contract: [{ ...source.inputs.contract[0], limit: 13 }] } }, "/inputs/contract/0/limit"],
		["boolean value", { ...source, inputs: { ...source.inputs, contract: [{ ...source.inputs.contract[0], enabled: false }] } }, "/inputs/contract/0/enabled"],
		["null value", { ...source, inputs: { ...source.inputs, contract: [{ ...source.inputs.contract[0], optional: "" }] } }, "/inputs/contract/0/optional"],
		["missing key", { ...source, projectContext: { projectId: "project-1" } }, "/projectContext/chapterId"],
		["added key", { ...source, projectContext: { ...source.projectContext, ownerId: "new-owner" } }, "/projectContext/ownerId"],
	])("rejects changed %s and records a structural path", (_label, currentSource, path) => {
		const error = sourceMismatch(JSON.stringify(source), JSON.stringify(currentSource));
		expect(error.message).toBe("workflow_agent_repair_source_mismatch");
		expect(error.diagnostics.path).toBe(path);
	});

	it("retains byte equality for opaque source text but rejects differing opaque or invalid JSON sources", () => {
		expect(verifyWorkflowAgentRepairHandoff({ checkpoint: checkpoint("frozen text"), sourceContext: "frozen text" }).sourceContext).toBe("frozen text");
		for (const [frozen, current] of [["frozen text", "frozen text "], ['{"value":1,}', '{"value":1}']]) {
			expect(sourceMismatch(frozen!, current!).diagnostics.reason).toBe("source_json_invalid");
		}
		expect(sourceMismatch('"frozen text"', ' "frozen text"').diagnostics.reason).toBe("source_json_container_required");
	});

	it("does not compare JSON encoded strings within source fields as objects", () => {
		const error = sourceMismatch('{"text":"{\\\"a\\\":1,\\\"b\\\":2}"}', '{"text":"{\\\"b\\\":2,\\\"a\\\":1}"}');
		expect(error.diagnostics).toMatchObject({ reason: "source_value_changed", path: "/text", checkpointType: "string", currentType: "string" });
	});

	it("checks own keys without prototype-property collisions", () => {
		const frozen = '{"__proto__":{"source":"same"},"constructor":1,"a":2}';
		expect(verifyWorkflowAgentRepairHandoff({ checkpoint: checkpoint(frozen), sourceContext: '{"a":2,"constructor":1,"__proto__":{"source":"same"}}' }).sourceContext).toBe(frozen);
		expect(sourceMismatch(frozen, '{"a":2,"constructor":1}').diagnostics.path).toBe("/__proto__");
	});

	it("keeps diagnostics free of source values and retains both encoding hashes", () => {
		const frozen = '{"secret":"private frozen facts"}';
		const current = '{"secret":"private changed facts"}';
		const error = sourceMismatch(frozen, current);
		const diagnostics = JSON.stringify(error.diagnostics);
		expect(diagnostics).not.toContain("private");
		expect(error.diagnostics.checkpointSourceHash).toBe(`sha256:${createHash("sha256").update(frozen).digest("hex")}`);
		expect(error.diagnostics.currentSourceHash).toBe(`sha256:${createHash("sha256").update(current).digest("hex")}`);
	});

	it("preserves finite JS number facts across reordered serialization without introducing a safe-integer restriction", () => {
		const frozen = JSON.stringify({ value: 9007199254740992, ratio: 0.5 });
		const current = JSON.stringify({ ratio: 0.5, value: 9007199254740992 });
		expect(verifyWorkflowAgentRepairHandoff({ checkpoint: checkpoint(frozen), sourceContext: current }).sourceContext).toBe(frozen);
		expect(sourceMismatch(frozen, JSON.stringify({ ratio: 0.5, value: 9007199254740994 })).diagnostics.reason).toBe("source_value_changed");
	});

	it("does not prove source equality through non-finite parse results", () => {
		expect(sourceMismatch('{"value":1e400}', '{"value":2e400}').diagnostics.reason)
			.toBe("source_number_identity_unprovable");
	});
});
