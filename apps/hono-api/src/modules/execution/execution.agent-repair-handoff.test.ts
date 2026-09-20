import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWorkflowAgentRepairHandoff, workflowAgentRepairSource } from "./execution.agent-repair-handoff";
import { workflowAgentPublicTurnId, workflowAgentSessionKey } from "./execution.agent-identity";

describe("structured draft handoff", () => {
	const contract = { kind: "json" };
	const checkpoint = { version: 1, contractHash: `sha256:${createHash("sha256").update(JSON.stringify(contract)).digest("hex")}`,
		candidate: "exact draft", correction: "invalid json", sourceContext: "frozen",
		pendingEditPrefix: '{"textEdits":', progress: { unchangedRepairs: 2 } };
	it("preserves pending edits and progress without authoring a replacement", () => {
		expect(verifyWorkflowAgentRepairHandoff({ checkpoint, sourceContext: "frozen" })).toEqual(checkpoint);
	});
	it("rejects missing contract identity and changed sources", () => {
		expect(() => verifyWorkflowAgentRepairHandoff({ checkpoint: { ...checkpoint, contractHash: null }, sourceContext: "frozen" })).toThrow("contract_missing");
		expect(() => verifyWorkflowAgentRepairHandoff({ checkpoint, sourceContext: "changed" })).toThrow("source_mismatch");
	});
	it("accepts only the exact source execution/node/physical identity", () => {
		const identity = { executionId: "source", nodeId: "node", physicalRetryOrdinal: 2 };
		const delivery = { sessionKey: workflowAgentSessionKey(identity), logicalTaskId: workflowAgentPublicTurnId(identity),
			physicalRetryOrdinal: 2, recoveryCheckpoint: { physicalRunId: "run" } };
		expect(workflowAgentRepairSource({ sourceExecutionId: "source", nodeId: "node", evidence: { deliveryEvidence: delivery } }))
			.toEqual({ sessionKey: delivery.sessionKey, turnId: delivery.logicalTaskId });
		expect(() => workflowAgentRepairSource({ sourceExecutionId: "other", nodeId: "node", evidence: { deliveryEvidence: delivery } })).toThrow("identity_mismatch");
	});
});
