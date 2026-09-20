import { describe, expect, it } from "vitest";
import { buildWorkflowExternalWaitDiagnostics } from "./execution.external-wait-diagnostics";

const receipt = {
	protocolVersion: "1", executorRef: "agent.run", nodeId: "node-1", executionMode: "once",
	ports: {}, artifacts: [], itemRuns: [], evidence: { continuationReason: "structured_output_repair_required" },
	externalCheck: { version: 1, mode: "poll", notBeforeAt: "2026-09-07T10:00:05.000Z" },
};

describe("external wait timing evidence", () => {
	it("records nested recovery cursor and backoff without disclosing the candidate", () => {
		const observed = buildWorkflowExternalWaitDiagnostics({ ...receipt, evidence: {
			deliveryEvidence: { logicalTaskId: "turn-3", state: "succeeded", physicalRetryOrdinal: 3,
				retryNotBeforeAt: "2026-09-07T10:10:00Z", recoveryCheckpoint: { reasonCode: "repair", physicalRunId: "run-3", progressRevision: 2 } },
			outputRepair: { sourceTurnId: "turn-3", candidate: "PRIVATE FULL CANDIDATE", error: "structural failure" },
		} });
		expect(observed).toMatchObject({ logicalTaskId: "turn-3", state: "succeeded", physicalRetryOrdinal: 3,
			retryNotBeforeAt: "2026-09-07T10:10:00Z", rejectedSourceTurnId: "turn-3",
			recoveryCheckpoint: { reasonCode: "repair", physicalRunId: "run-3", progressRevision: 2 } });
		expect(JSON.stringify(observed)).not.toContain("PRIVATE FULL CANDIDATE");
	});
	it("distinguishes the requested wait from a late recovery check", () => {
		const before = buildWorkflowExternalWaitDiagnostics(receipt, Date.parse("2026-09-07T10:00:00Z"));
		const after = buildWorkflowExternalWaitDiagnostics(JSON.stringify(receipt), Date.parse("2026-09-07T10:05:00Z"));
		expect(before).toMatchObject({ scheduleStatus: "recorded", remainingDelayMs: 5000, pastDueMs: 0 });
		expect(after).toMatchObject({ remainingDelayMs: 0, pastDueMs: 295000, continuationReason: "structured_output_repair_required" });
	});
	it("does not invent a due time for a signal-only wait", () => {
		const observed = buildWorkflowExternalWaitDiagnostics({ ...receipt, externalCheck: { version: 1, mode: "signal_only" } });
		expect(observed.scheduleStatus).toBe("recorded");
		expect(observed).not.toHaveProperty("pastDueMs");
	});
	it("reports absent and invalid receipts without changing execution", () => {
		expect(buildWorkflowExternalWaitDiagnostics(null).scheduleStatus).toBe("not_recorded");
		expect(buildWorkflowExternalWaitDiagnostics("invalid-json")).toMatchObject({ scheduleStatus: "invalid_receipt" });
		expect(buildWorkflowExternalWaitDiagnostics("invalid-json").failureReason).toBeTypeOf("string");
	});
});


it("exposes failed observation separately from provider progress without arbitrary error text", () => {
 const result = buildWorkflowExternalWaitDiagnostics({ ...receipt, evidence: {
   taskId: "accepted", providerStatus: "unknown",
   observationFailure: { observedAt: "2026-09-10T00:00:00Z", message: "private transport payload" },
 } });
 expect(result).toMatchObject({ taskId: "accepted", providerStatus: "unknown", observationStatus: "query_failed" });
 expect(JSON.stringify(result)).not.toContain("private transport payload");
});
