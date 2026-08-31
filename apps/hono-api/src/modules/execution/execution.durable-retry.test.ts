import { describe, expect, it } from "vitest";
import { readWorkflowDurableRetryDirective } from "./execution.durable-retry";

describe("readWorkflowDurableRetryDirective", () => {
	it("continues a logical workflow from explicit bounded retry evidence", () => {
		expect(readWorkflowDurableRetryDirective({
			evidence: {
				retryableByDurableWorkflow: true,
				retryableFailure: "structured_output_invalid",
				workflowRetryCount: 3,
			},
		})).toEqual({
			failureCode: "structured_output_invalid",
			retryOrdinal: 3,
		});
	});

	it("continues a collection when any failed item publishes durable retry evidence", () => {
		expect(readWorkflowDurableRetryDirective({
			evidence: { finalized: true },
			itemRuns: [
				{ status: "success", evidence: { executorCompleted: true } },
				{
					status: "failed",
					evidence: {
						retryableByDurableWorkflow: true,
						retryableFailure: "structured_output_invalid",
						workflowRetryCount: 4,
					},
				},
			],
		})).toEqual({
			failureCode: "structured_output_invalid",
			retryOrdinal: 4,
		});
	});

	it.each([
		null,
		{},
		{ evidence: {} },
		{ evidence: { retryableByDurableWorkflow: false, retryableFailure: "structured_output_invalid", workflowRetryCount: 1 } },
		{ evidence: { retryableByDurableWorkflow: true, retryableFailure: "", workflowRetryCount: 1 } },
		{ evidence: { retryableByDurableWorkflow: true, retryableFailure: "structured_output_invalid", workflowRetryCount: 0 } },
	])("rejects incomplete or exhausted retry evidence", (value) => {
		expect(readWorkflowDurableRetryDirective(value)).toBeNull();
	});
});
