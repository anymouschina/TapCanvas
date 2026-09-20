import { describe, expect, it, vi } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";
import { executeWithImmediateOutputRepair } from "./execution.immediate-output-repair";
import { workflowExternalPollAfter } from "./execution.external-check";
import { stampWorkflowNodeOutputProvenance } from "./execution.provenance";
import { workflowNodeWaiting, type WorkflowNodeOutputV1 } from "./execution.node-runtime";
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";

const dependencies: WorkflowNodeExecutorDependencies = { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: vi.fn() };

describe("collection item correction checkpoints", () => {
	it("persists concurrent candidates under the parent identity and preserves both through correction", async () => {
		const checkpoints: WorkflowNodeOutputV1[] = [];
		const context: WorkflowNodeExecutionContext = {
			executionId: "execution", executionFamilyId: "family", ownerId: "owner", flowId: "flow", projectId: "project", workflowKey: "workflow",
			node: { id: "author", type: "taskNode", kind: "workflowStage", data: {
				workflowAtomicSpec: { version: 1, category: "agent", operation: "write", executorRef: "agents.logical-task/v2", executionMode: "each", itemConcurrency: 2, inputPorts: ["input"], outputPorts: ["result"] },
			} },
			inputs: { input: [createWorkflowCollection({ collectionId: "inputs", producerNodeId: "split", producerPortId: "input", values: ["first", "second"], itemIds: ["one", "two"] })] },
			checkpointOutputRefs: async (outputRefs) => {
				checkpoints.push(stampWorkflowNodeOutputProvenance({ outputRefs, context: {
					executionId: "execution", nodeRunId: "run", attempt: 1, flowId: "flow", flowVersionId: "version", nodeId: "author", inputBindings: [],
				} }));
			},
		};
		let corrected = 0;
		let releaseBoth: () => void = () => undefined;
		const bothCorrecting = new Promise<void>((resolve) => { releaseBoth = resolve; });
		const execute = async (item: WorkflowNodeExecutionContext) => {
			const output: WorkflowNodeOutputV1 = {
				protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: item.node.id, executionMode: "once", ports: {}, artifacts: [], itemRuns: [],
				evidence: { continuationReason: "structured_output_repair_required", outputRepair: { version: 1, sourceTurnId: item.node.id, candidate: item.node.id, error: "Required field missing" } },
			};
			if (!item.resumeOnly) return workflowNodeWaiting(output, workflowExternalPollAfter(5_000));
			expect(item.resumeOutputRefs?.evidence.outputRepair).toEqual(output.evidence.outputRepair);
			corrected += 1;
			if (corrected === 2) releaseBoth();
			await bothCorrecting;
			return { ok: true as const, outputRefs: { ...output, evidence: { executorCompleted: true }, ports: { result: item.node.id } } };
		};
		const result = await executeWorkflowNodeByMode(context, dependencies, (item, deps) => executeWithImmediateOutputRepair(item, deps, execute));
		expect(result.ok).toBe(true);
		expect(corrected).toBe(2);
		expect(checkpoints.every((checkpoint) => checkpoint.nodeId === "author")).toBe(true);
		const pending = checkpoints.find((checkpoint) => checkpoint.itemRuns.length === 2 && checkpoint.itemRuns.every((item) => item.status === "waiting_external"));
		expect(pending?.itemRuns.map((item) => item.evidence.outputRepair)).toHaveLength(2);
		expect(pending?.externalCheck).toBeDefined();
		expect(checkpoints.at(-1)?.itemRuns.every((item) => item.status === "success")).toBe(true);
	});
	it("keeps author candidates waiting when their internal checkpoint transaction expires", async () => {
		const failure = Object.assign(new Error("transaction expired"), { code: "P2028" });
		const context: WorkflowNodeExecutionContext = {
			executionId: "execution", executionFamilyId: "family", ownerId: "owner", flowId: "flow", projectId: "project", workflowKey: "workflow",
			node: { id: "author", type: "taskNode", kind: "workflowStage", data: {
				workflowAtomicSpec: { version: 1, category: "agent", operation: "write", executorRef: "agents.logical-task/v2", executionMode: "each", itemConcurrency: 2, inputPorts: ["input"], outputPorts: ["result"] },
			} },
			inputs: { input: [createWorkflowCollection({ collectionId: "inputs", producerNodeId: "split", producerPortId: "input", values: ["first", "second"], itemIds: ["one", "two"] })] },
			checkpointOutputRefs: async () => { throw failure; },
		};
		let corrected = 0;
		const execute = async (item: WorkflowNodeExecutionContext) => {
			if (item.resumeOnly) corrected += 1;
			const output: WorkflowNodeOutputV1 = {
				protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: item.node.id, executionMode: "once", ports: {}, artifacts: [], itemRuns: [],
				evidence: { continuationReason: "structured_output_repair_required", outputRepair: { version: 1, sourceTurnId: item.node.id, candidate: item.node.id, error: "Required field missing" } },
			};
			return workflowNodeWaiting(output, workflowExternalPollAfter(5_000));
		};
		const result = await executeWorkflowNodeByMode(context, dependencies, (item, deps) => executeWithImmediateOutputRepair(item, deps, execute));
		expect(result.ok).toBe(false);
		if (result.ok || !result.waitingExternal) throw new Error("Persistence failure must defer reconciliation");
		expect(corrected).toBe(0);
		expect(result.outputRefs.itemRuns).toHaveLength(2);
		expect(result.outputRefs.itemRuns.every((item) => item.status === "waiting_external")).toBe(true);
		expect(result.outputRefs.itemRuns.every((item) => item.evidence.outputRepair !== undefined)).toBe(true);
		expect(result.outputRefs.evidence.checkpointPersistenceFailure).toMatchObject({ errorCodes: ["P2028"] });
		const resumed = await executeWorkflowNodeByMode({ ...context, resumeOnly: true,
			resumeOutputRefs: result.outputRefs, checkpointOutputRefs: async () => undefined,
		}, dependencies, async (item) => {
			expect(item.resumeOnly).toBe(true);
			const saved = result.outputRefs.itemRuns.find((run) => run.runtimeNodeId === item.node.id);
			expect(saved?.evidence.outputRepair).toBeDefined();
			return { ok: true, outputRefs: {
				protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: item.node.id,
				executionMode: "once", ports: { result: item.node.id }, artifacts: [], itemRuns: [], evidence: {},
			} };
		});
		expect(resumed.ok).toBe(true);
		expect(resumed.outputRefs?.itemRuns.every((item) => item.status === "success")).toBe(true);
	});

});
