import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AUTHOR_SOURCE_REPRESENTATION, authorSourceJsonHash, authorSourceTextHash } from "../../../../../packages/schemas/author-source-representation/index.mjs";
import { workflowAgentPublicTurnId, workflowAgentSessionKey } from "./execution.agent-identity";
import { bindWorkflowAcceptedAuthorRecovery, readWorkflowAcceptedAuthorRecovery } from "./execution.accepted-author-recovery";
import { parseWorkflowNodeOutputV1, type WorkflowNodeOutputV1 } from "./execution.node-runtime";
import { decodeWorkflowOutput, encodeWorkflowOutput } from "./execution.output-storage";

function fixture() {
	const identity = { executionId: "source-execution", nodeId: "writer", physicalRetryOrdinal: null };
	const taskId = workflowAgentPublicTurnId(identity), sessionId = workflowAgentSessionKey(identity), turnId = "internal-harness-turn";
	const candidate = '{"scenes":[{"cast":[]}]}', candidateHash = authorSourceTextHash(candidate);
	const contract = { kind: "json", jsonSchema: { type: "object" }, submissionPolicy: "single_submission" };
	const contractHash = authorSourceJsonHash(contract), sourceContext = '{"inputs":{"source":"original source"}}';
	const accepted = { version: 1, representation: AUTHOR_SOURCE_REPRESENTATION, identity: { taskId, sessionId, turnId },
		candidate, candidateHash, authorContract: { ref: `${turnId}#/acceptedAuthorSource/authorContract/value`, value: contract, hash: contractHash },
		acceptance: { kind: "harness_accepted_candidate", receiptRef: turnId, candidateHash, authorContractHash: contractHash },
		sourceContext: { value: sourceContext, hash: authorSourceTextHash(sourceContext) } };
	const output: WorkflowNodeOutputV1 = { protocolVersion: "1", nodeId: identity.nodeId, executorRef: "agents.logical-task/v2", executionMode: "once",
		ports: { result: { text: candidate, acceptedAuthorSource: accepted } }, artifacts: [], itemRuns: [],
		evidence: { taskId, executorCompleted: false, outputContractFailure: { code: "structured_output_invalid", message: "Host compilation rejected layout" } } };
	return { output, sourceExecutionId: identity.executionId, sourceNodeRunId: "actual-failed-run" };
}

describe("accepted author checkpoint recovery", () => {
	it("retains the exact accepted candidate and frozen contract/source without claiming completion or altering its receipt", () => {
		const input = fixture(), before = structuredClone(input);
		const result = bindWorkflowAcceptedAuthorRecovery(input);
		const recovery = readWorkflowAcceptedAuthorRecovery(result.evidence);
		expect(recovery).toMatchObject({ version: 1, sourceExecutionId: "source-execution", sourceNodeRunId: "actual-failed-run", nodeId: "writer", portName: "result" });
		expect(recovery?.acceptedAuthorSource).toEqual((input.output.ports.result as Record<string, unknown>).acceptedAuthorSource);
		expect(result.ports).toEqual(input.output.ports);
		expect(result.evidence.executorCompleted).toBe(false);
		expect(bindWorkflowAcceptedAuthorRecovery({ ...input, output: result, sourceExecutionId: "next-recovery-member", sourceNodeRunId: "next-run" })).toBe(result);
		expect(input).toEqual(before);
	});
	it("leaves a missing accepted source or another failure kind explicit", () => {
		const input = fixture();
		for (const output of [{ ...input.output, ports: {} }, { ...input.output, evidence: { taskId: input.output.evidence.taskId } }]) {
			expect(bindWorkflowAcceptedAuthorRecovery({ ...input, output })).toBe(output);
			expect(readWorkflowAcceptedAuthorRecovery(output.evidence)).toBeNull();
		}
	});
	it("keeps new accepted contract hashes verifiable through the actual sorted storage codec", () => {
		const input = fixture();
		const decoded = parseWorkflowNodeOutputV1(decodeWorkflowOutput(JSON.stringify(encodeWorkflowOutput(input.output))));
		if (!decoded) throw new Error("fixture codec output invalid");
		const proof = readWorkflowAcceptedAuthorRecovery(bindWorkflowAcceptedAuthorRecovery({ ...input, output: decoded }).evidence);
		expect(proof?.acceptedAuthorSource).toBeDefined();
		expect(proof?.sourceDiagnostics).toEqual([]);
	});
	it("preserves order-damaged historical contract facts as diagnostics without inventing an acceptance", () => {
		const input = fixture();
		const port = input.output.ports.result as Record<string, unknown>;
		const accepted = port.acceptedAuthorSource as { authorContract: { value: Record<string, unknown>; hash: string }; acceptance: { authorContractHash: string } };
		// Actual historical algorithm: exact object insertion order before storage.
		const historicalHash = `sha256:${createHash("sha256").update(JSON.stringify(accepted.authorContract.value)).digest("hex")}`;
		accepted.authorContract.hash = historicalHash;
		accepted.acceptance.authorContractHash = historicalHash;
		accepted.authorContract.value = Object.fromEntries(Object.entries(accepted.authorContract.value).reverse());
		const before = structuredClone(input);
		const recovered = bindWorkflowAcceptedAuthorRecovery(input);
		const proof = readWorkflowAcceptedAuthorRecovery(recovered.evidence);
		expect(proof?.candidateHash).toBe(authorSourceTextHash('{"scenes":[{"cast":[]}]}'));
		expect(proof?.acceptedAuthorSource).toBeUndefined();
		expect(proof?.sourceDiagnostics).toEqual([{ code: "author_source_contract_mismatch", path: "/acceptedAuthorSource/authorContract/hash", status: "source_candidate_preserved_contract_unverified" }]);
		expect(input).toEqual(before);
	});
	it.each(["candidateHash", "sourceHash", "portText", "task", "session"])("rejects damaged or cross-scope %s receipt facts", (mutation) => {
		const input = fixture();
		const port = input.output.ports.result as Record<string, unknown>;
		const accepted = port.acceptedAuthorSource as { candidateHash: string; sourceContext: { hash: string }; authorContract: { hash: string }; identity: { taskId: string; sessionId: string } };
		if (mutation === "candidateHash") accepted.candidateHash = authorSourceTextHash("different");
		if (mutation === "sourceHash") accepted.sourceContext.hash = authorSourceTextHash("different");
		if (mutation === "portText") port.text = "rewritten delivery";
		if (mutation === "task") input.output.evidence.taskId = "other-task";
		if (mutation === "session") accepted.identity.sessionId = "other-session";
		expect(() => bindWorkflowAcceptedAuthorRecovery(input)).toThrow();
	});
});
