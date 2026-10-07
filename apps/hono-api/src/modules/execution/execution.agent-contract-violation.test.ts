import { expect, it, vi } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { AppError } from "../../middleware/error";
import { executeRegisteredWorkflowNode, type WorkflowNodeExecutionContext } from "./execution.node-executors";

const itemNodeId = "author::item::one";
const receipt = {
	taskId: "physical-one",
	deliveryEvidence: {
		sessionKey: `workflow:execution:${itemNodeId}`,
		logicalTaskId: "physical-one",
		retryablePhysicalFailure: true,
		physicalFailureReason: "workflow_agent_orphaned_checkpoint",
		physicalRetryOrdinal: 1,
	},
};

function waitingItemContext(): WorkflowNodeExecutionContext {
	return {
		executionId: "execution", executionFamilyId: "family", ownerId: "owner", flowId: "flow", projectId: "project", workflowKey: "workflow",
		resumeOnly: true,
		inputs: { input: [createWorkflowCollection({ collectionId: "inputs", producerNodeId: "split", producerPortId: "input", values: ["first"], itemIds: ["one"] })] },
		node: { id: "author", type: "taskNode", kind: "workflowStage", data: {
			workflowInstruction: "Write the requested text", workflowAgentDefinitionId: "writer", workflowAgentModelKey: "gemini-3.8-flash", workflowAgentOutputArtifactType: "tapcanvas.text/v1", workflowAgentOutputEncoding: "plain_text", workflowAgentMaxOutputTokens: 4096, workflowAgentDeliveryRequirement: "Return the text",
			workflowAtomicSpec: { version: 1, category: "agent", operation: "write", executorRef: "agents.logical-task/v2", executionMode: "each", itemConcurrency: 1, inputPorts: ["input"], outputPorts: ["result"] },
		} },
		resumeOutputRefs: {
			protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: "author", executionMode: "each", ports: {}, artifacts: [], evidence: {},
			itemRuns: [{ itemId: "one", index: 0, runtimeNodeId: itemNodeId, lineage: [], status: "waiting_external", ports: {}, artifacts: [], evidence: receipt }],
		},
	};
}

it("fails a waiting item explicitly when the bridge status violates the host contract", async () => {
	// Re-reading the same durable turn returns the same payload, so re-polling
	// would keep the node waiting forever without any progress.
	const runAgent = vi.fn(async () => {
		throw new AppError("Agents chat status response is invalid: executionProvenanceHistory item is invalid", {
			status: 502,
			code: "agents_chat_status_invalid_response",
		});
	});
	const result = await executeRegisteredWorkflowNode(waitingItemContext(), { runAgent, runVideo: vi.fn(), runJavascript: vi.fn() });

	expect(result.ok).toBe(false);
	expect("waitingExternal" in result && result.waitingExternal).toBeFalsy();
	const item = result.outputRefs?.itemRuns[0];
	expect(item, JSON.stringify(result)).toMatchObject({ status: "failed", errorCode: "agents_chat_status_invalid_response" });
	// The accepted turn's receipt stays attached so recovery can reconcile it.
	expect(item?.evidence).toMatchObject(receipt);
	expect(item?.evidence.runtimeContractViolation).toMatchObject({ code: "agents_chat_status_invalid_response" });
});

it("keeps observing a waiting item when the bridge outcome is merely unknown", async () => {
	const runAgent = vi.fn(async () => {
		throw new AppError("Agents chat runtime status transport outcome is unknown", {
			status: 502,
			code: "agents_chat_runtime_transport_unknown",
		});
	});
	const result = await executeRegisteredWorkflowNode(waitingItemContext(), { runAgent, runVideo: vi.fn(), runJavascript: vi.fn() });

	expect(result.outputRefs?.itemRuns[0]?.status).toBe("waiting_external");
});
