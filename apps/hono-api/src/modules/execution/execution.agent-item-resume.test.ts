import { expect, it, vi } from "vitest";
import { executeRegisteredWorkflowNode, type WorkflowNodeExecutionContext } from "./execution.node-executors";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";

it.each(["direct", "once_inherited", "failed_collection", "inherited_wait", "current_wait"] as const)("preserves the repair checkpoint through %s recovery", async (mode) => {
	const nodeId = "author::item::one";
	const evidence = {
		outputContractFailure: { code: "structured_output_invalid" },
		outputRepair: { version: 1, sourceTurnId: "physical-one", candidate: "draft", error: "invalid shape" },
		deliveryEvidence: { physicalRetryOrdinal: 1, logicalTaskId: "physical-one", ...(mode === "inherited_wait" || mode === "once_inherited" || mode === "current_wait" ? { sessionKey: `workflow:${(mode === "inherited_wait" || mode === "once_inherited") ? "prior-execution" : "execution"}:${nodeId}` } : {}) },
	};
	const output: WorkflowNodeOutputV1 = { protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId, executionMode: "once", ports: {}, artifacts: [], itemRuns: [], evidence };
	const context: WorkflowNodeExecutionContext = {
		executionId: "execution", executionFamilyId: "family", ownerId: "owner", flowId: "flow", projectId: "project", workflowKey: "workflow",
		runtimeItemIndex: 0, resumeOnly: true, resumeOutputRefs: output, inputs: {},
		node: { id: nodeId, type: "taskNode", kind: "workflowStage", data: {
			workflowInstruction: "Write the requested text", workflowAgentDefinitionId: "writer", workflowAgentModelKey: "gemini-3.8-flash", workflowAgentOutputArtifactType: "tapcanvas.text/v1", workflowAgentOutputEncoding: "plain_text", workflowAgentMaxOutputTokens: 4096, workflowAgentDeliveryRequirement: "Return the text",
			workflowAtomicSpec: { version: 1, category: "agent", operation: "write", executorRef: "agents.logical-task/v2", executionMode: "once", inputPorts: [], outputPorts: ["result"] },
		} },
	};
	const runAgent = vi.fn(async () => ({ taskId: "physical-one", text: "corrected", assets: [], expectedDelivery: {}, deliveryEvidence: {}, deliveryVerification: { status: "satisfied" }, requestTerminal: { status: "succeeded" } }));
	const effectiveContext: WorkflowNodeExecutionContext = mode === "direct" ? context : mode === "once_inherited" ? { ...context, runtimeItemIndex: undefined, recoveryOfExecutionId: "prior-execution" } : {
		...context, runtimeItemIndex: undefined, recoveryOfExecutionId: "prior-execution",
		node: { ...context.node, id: "author", data: { ...context.node.data,
			workflowAtomicSpec: { version: 1, category: "agent", operation: "write", executorRef: "agents.logical-task/v2", executionMode: "each", itemConcurrency: 1, inputPorts: ["input"], outputPorts: ["result"] },
		} },
		inputs: { input: [createWorkflowCollection({ collectionId: "inputs", producerNodeId: "split", producerPortId: "input", values: ["first"], itemIds: ["one"] })] },
		resumeOutputRefs: { ...output, nodeId: "author", executionMode: "each", evidence: {}, itemRuns: [{
			itemId: "one", index: 0, runtimeNodeId: nodeId, lineage: [], status: mode === "inherited_wait" || mode === "current_wait" ? "waiting_external" : "failed", ports: {}, artifacts: [], evidence,
			errorCode: "workflow_node_runtime_failed", errorMessage: "checkpoint observation failed",
		}] },
	};
	const result = await executeRegisteredWorkflowNode(effectiveContext, { runAgent, runVideo: vi.fn(), runJavascript: vi.fn() });
	expect(result.ok).toBe(true);
	expect(runAgent).toHaveBeenCalledTimes(1);
	expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ nodeId, resumeOnly: mode === "direct" || mode === "current_wait", previousEvidence: evidence }));
});
