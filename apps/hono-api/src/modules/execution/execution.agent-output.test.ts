import { describe, expect, it } from "vitest";
import type { NodeRunRow } from "./execution.repo";
import { projectWorkflowExecutionAgentOutputs } from "./execution.agent-output";

function nodeRun(overrides: Partial<NodeRunRow>): NodeRunRow {
	return {
		id: "run-output",
		execution_id: "execution-1",
		node_id: "output-1",
		status: "success",
		attempt: 1,
		error_message: null,
		output_refs: JSON.stringify({
			protocolVersion: "1",
			executorRef: "workflow.output/v1",
			nodeId: "output-1",
			executionMode: "once",
			ports: { output: { text: ["固定交付"] } },
			artifacts: [],
			evidence: { executorCompleted: true },
			itemRuns: [],
		}),
		node_type: "workflow.output/v1",
		created_at: "2026-08-31T00:00:00.000Z",
		started_at: "2026-08-31T00:00:00.000Z",
		finished_at: "2026-08-31T00:00:01.000Z",
		...overrides,
	};
}

describe("projectWorkflowExecutionAgentOutputs", () => {
	it("exposes only successful standard workflow output boundaries", () => {
		expect(projectWorkflowExecutionAgentOutputs([
			nodeRun({}),
			nodeRun({ id: "run-stage", node_id: "stage-1", node_type: "workflow.input.text/v1" }),
			nodeRun({ id: "run-failed-output", status: "failed" }),
		])).toEqual([{
			nodeId: "output-1",
			nodeRunId: "run-output",
			ports: { output: { text: ["固定交付"] } },
			artifacts: [],
		}]);
	});
});
