import { describe, expect, it } from "vitest";
import {
	deriveWorkflowExecutionSemanticsV2,
	parseWorkflowExecutionSemanticsV2,
	WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
} from "./execution-semantics";

describe("workflow execution semantics v2", () => {
	it("derives replay semantics only for factually side-effect-free safe plugins", () => {
		expect(deriveWorkflowExecutionSemanticsV2({
			sideEffect: "none",
			retrySafety: "safe",
			executionMode: "parallel_safe",
			idempotencyKeyInput: null,
			resultLookup: "none",
			resultLookupKeyOutput: null,
		})).toMatchObject({ recoveryMode: "replay", maxAutomaticAttempts: 1, backoffClass: "none" });
	});

	it("derives provider reconciliation without allowing an automatic replay", () => {
		expect(deriveWorkflowExecutionSemanticsV2({
			sideEffect: "paid_generation",
			retrySafety: "idempotency_key_required",
			executionMode: "exclusive",
			idempotencyKeyInput: "requestId",
			resultLookup: "provider_receipt",
			resultLookupKeyOutput: "taskId",
		})).toMatchObject({
			recoveryMode: "reconcile",
			maxAutomaticAttempts: 1,
			idempotency: { source: "input", inputField: "requestId" },
		});
	});

	it("rejects paid generation without a provider receipt", () => {
		expect(() => parseWorkflowExecutionSemanticsV2({
			protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
			sideEffect: "paid_generation",
			retrySafety: "unsafe",
			executionMode: "exclusive",
			idempotency: null,
			resultLookup: { mode: "none", outputField: null },
			recoveryMode: "manual",
			maxAutomaticAttempts: 1,
			backoffClass: "none",
			failureStage: "media_generation",
		})).toThrow(/provider receipt/u);
	});
});
