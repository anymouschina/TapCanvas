import { describe, expect, it } from "vitest";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";
import { stampWorkflowNodeOutputProvenance } from "./execution.provenance";

function output(nodeId = "target"): WorkflowNodeOutputV1 {
	return {
		protocolVersion: "1",
		executorRef: "workflow.control.join/v1",
		nodeId,
		executionMode: "once",
		ports: { joined: "value" },
		artifacts: [],
		evidence: { executorCompleted: true },
		itemRuns: [],
	};
}

describe("workflow durable provenance", () => {
	it("stamps exact run and upstream artifact identities without changing the output value", () => {
		const stamped = stampWorkflowNodeOutputProvenance({
			outputRefs: output(),
			createdAt: "2026-08-14T00:00:00.000Z",
			context: {
				executionId: "execution-1",
				nodeRunId: "run-target",
				attempt: 2,
				flowId: "flow-1",
				flowVersionId: "flow-version-3",
				nodeId: "target",
				inputBindings: [{
					sourceNodeId: "source",
					sourceNodeRunId: "run-source",
					sourcePortId: "image",
					targetPortId: "input",
					artifacts: [{ type: "tapcanvas.image/v1", identity: "asset-1" }],
				}],
			},
		});
		expect(stamped.ports).toEqual({ joined: "value" });
		expect(stamped.evidence.workflowProvenance).toEqual({
			protocolVersion: "workflow.node-provenance/v1",
			executionId: "execution-1",
			nodeRunId: "run-target",
			attempt: 2,
			flowId: "flow-1",
			flowVersionId: "flow-version-3",
			nodeId: "target",
			executorRef: "workflow.control.join/v1",
			createdAt: "2026-08-14T00:00:00.000Z",
			inputBindings: [{
				sourceNodeId: "source",
				sourceNodeRunId: "run-source",
				sourcePortId: "image",
				targetPortId: "input",
				artifacts: [{ type: "tapcanvas.image/v1", identity: "asset-1" }],
			}],
		});
	});

	it("fails when a durable node run identity or matching node identity is absent", () => {
		expect(() => stampWorkflowNodeOutputProvenance({
			outputRefs: output(),
			context: {
				executionId: "execution-1",
				nodeRunId: null,
				attempt: 1,
				flowId: "flow-1",
				flowVersionId: "version-1",
				nodeId: "target",
				inputBindings: [],
			},
		})).toThrow("nodeRunId");
		expect(() => stampWorkflowNodeOutputProvenance({
			outputRefs: output("other"),
			context: {
				executionId: "execution-1",
				nodeRunId: "run-1",
				attempt: 1,
				flowId: "flow-1",
				flowVersionId: "version-1",
				nodeId: "target",
				inputBindings: [],
			},
		})).toThrow("node identity mismatch");
	});
});
