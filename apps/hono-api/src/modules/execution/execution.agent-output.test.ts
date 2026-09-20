import { describe, expect, it } from "vitest";
import type { NodeRunRow } from "./execution.repo";
import { declaredTerminalDeliveryOutputs, projectWorkflowExecutionAgentOutputs } from "./execution.agent-output";

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


describe("declared terminal delivery outputs", () => {
	it.each(["agents.delivery.verify/v2", "tapcanvas.video.prepare/v1"])("exports %s terminal facts without intermediate results", (executorRef) => {
		const graph = {
			nodes: ["intermediate", "delivery"].map((id) => ({ id, data: {
				workflowAtomicSpec: { category: "delivery", executorRef, outputPorts: ["result"] },
			} })),
			edges: [{ source: "intermediate", target: "delivery" }],
		};
		const rows = ["intermediate", "delivery"].map((id) => nodeRun({
			id: `run-${id}`, node_id: id, node_type: executorRef,
			output_refs: JSON.stringify({ protocolVersion: "1", executorRef, nodeId: id,
				executionMode: "once", ports: { result: { videoUrl: "https://media.example/movie.mp4" } },
				artifacts: [], evidence: { executorCompleted: true }, itemRuns: [] }),
		}));
		expect(projectWorkflowExecutionAgentOutputs(rows, declaredTerminalDeliveryOutputs(graph)))
			.toEqual([{ nodeId: "delivery", nodeRunId: "run-delivery", ports: {
				result: { videoUrl: "https://media.example/movie.mp4" },
			}, artifacts: [] }]);
		expect(projectWorkflowExecutionAgentOutputs(rows.map((row) => ({ ...row, status: "failed" })),
			declaredTerminalDeliveryOutputs(graph))).toEqual([]);
	});
});
