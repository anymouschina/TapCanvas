import { describe, expect, it } from "vitest";
import {
	parseWorkflowExecutionSemanticsV2,
	type WorkflowPipelineRunSpecV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";
import type { WorkflowNodeExecutionResult, WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import { workflowExternalPollAfter } from "./execution.external-check";
import { composeWorkflowPipelineRunSemantics, runWorkflowPipelineNode } from "./execution.pipeline-runner";

function frozenStep(id: string, executorRef: string, inputPort: string, outputPort: string) {
	return {
		stepId: id,
		node: {
			id,
			type: "taskNode",
			kind: "workflowStage",
			data: {
				workflowAtomicSpec: {
					version: 1,
					category: "control",
					operation: "test",
					executorRef,
					executionMode: "once",
					inputPorts: [inputPort],
					outputPorts: [outputPort],
					inputArtifactTypes: { [inputPort]: ["tapcanvas.test-value/v1"] },
					outputArtifactTypes: { [outputPort]: ["tapcanvas.test-value/v1"] },
				},
			},
		},
	};
}

function pipelineSpec(): WorkflowPipelineRunSpecV1 {
	return {
		protocolVersion: "workflow.pipeline.run/v1",
		inputs: [{ portId: "seed", mode: "value", artifactTypes: ["tapcanvas.test-value/v1"] }],
		steps: [frozenStep("prepare", "video.clip-contexts/v1", "seed", "context"),
			frozenStep("submit", "tapcanvas.video.generate/v1", "context", "video")],
		bindings: [
			{ from: { kind: "input", portId: "seed" }, to: { stepId: "prepare", portId: "seed" }, mode: "value" },
			{ from: { kind: "step", stepId: "prepare", portId: "context" }, to: { stepId: "submit", portId: "context" }, mode: "value" },
		],
		outputs: [{ portId: "video", from: { stepId: "submit", portId: "video" }, mode: "value" }],
	};
}

function outerNode(spec: WorkflowPipelineRunSpecV1): WorkflowNodeSnapshot {
	return {
		id: "clip-pipeline::clip-fast",
		type: "taskNode",
		kind: "workflowStage",
		data: {
			workflowPipeline: spec,
			workflowAtomicSpec: {
				version: 1,
				category: "control",
				operation: "run",
				executorRef: "workflow.pipeline.run/v1",
				executionMode: "each",
				inputPorts: ["seed"],
				outputPorts: ["video"],
			},
		},
	};
}

function executionContext(spec: WorkflowPipelineRunSpecV1, resumeOutputRefs?: WorkflowNodeOutputV1): WorkflowNodeExecutionContext {
	return {
		executionId: "execution-1",
		executionFamilyId: "family-1",
		ownerId: "owner-1",
		flowId: "flow-1",
		projectId: "project-1",
		workflowKey: "video",
		node: outerNode(spec),
		inputs: { seed: [{ clipId: "clip-fast" }] },
		...(resumeOutputRefs ? { resumeOutputRefs } : {}),
	};
}

function output(node: WorkflowNodeSnapshot, executorRef: string, portId: string, value: unknown, evidence: Record<string, unknown> = {}): WorkflowNodeOutputV1 {
	return {
		protocolVersion: "1",
		executorRef,
		nodeId: node.id,
		executionMode: "once",
		ports: { [portId]: value },
		artifacts: [],
		evidence,
		itemRuns: [],
	};
}

describe("durable inline workflow pipeline", () => {
	it("composes replay-safe preparation with paid idempotent generation", () => {
		const spec = pipelineSpec();
		const localSafe = parseWorkflowExecutionSemanticsV2({
			protocolVersion: "workflow.execution-semantics/v2",
			sideEffect: "local_mutation",
			retrySafety: "safe",
			executionMode: "parallel_safe",
			idempotency: null,
			resultLookup: { mode: "none", outputField: null },
			recoveryMode: "replay",
			maxAutomaticAttempts: 1,
			backoffClass: "none",
			failureStage: "artifact_persistence",
		});
		const semantics = composeWorkflowPipelineRunSemantics(spec, (node) => (
			node.id === "prepare" ? localSafe : resolveCoreWorkflowExecutorSemantics(
				(node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string,
			)
		));
		expect(semantics).toMatchObject({
			sideEffect: "paid_generation",
			retrySafety: "idempotency_key_required",
			recoveryMode: "reconcile",
			resultLookup: { mode: "provider_receipt", outputField: "providerReceiptRefs" },
		});
	});

	it("persists a waiting stage receipt and resumes it without losing its accepted task", async () => {
		const spec: WorkflowPipelineRunSpecV1 = {
			protocolVersion: "workflow.pipeline.run/v1",
			inputs: [{ portId: "seed", mode: "value", artifactTypes: ["tapcanvas.test-value/v1"] }],
			steps: [frozenStep("submit", "tapcanvas.video.generate/v1", "seed", "video")],
			bindings: [{ from: { kind: "input", portId: "seed" }, to: { stepId: "submit", portId: "seed" }, mode: "value" }],
			outputs: [{ portId: "video", from: { stepId: "submit", portId: "video" }, mode: "value" }],
		};
		const calls: Array<{ resumeOnly: boolean; receipt: unknown }> = [];
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			calls.push({ resumeOnly: context.resumeOnly === true, receipt: context.resumeOutputRefs?.evidence.taskId });
			const outputRefs = output(context.node, "tapcanvas.video.generate/v1", "video", "asset://clip-fast", { taskId: "provider-task-fast" });
			if (!context.resumeOnly) {
				return {
					ok: false,
					waitingExternal: true,
					externalCheck: workflowExternalPollAfter(1_000),
					outputRefs,
				};
			}
			return { ok: true, outputRefs };
		};
		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(first).toMatchObject({ ok: false, waitingExternal: true });
		if (first.ok || !first.waitingExternal) throw new Error("Expected durable external wait");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		expect(saved.evidence.pipelineState).toMatchObject({
			steps: { submit: { status: "waiting_external", outputRefs: { evidence: { taskId: "provider-task-fast" } } } },
		});
		const resumed = await runWorkflowPipelineNode(executionContext(spec, saved), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(resumed).toMatchObject({ ok: true, outputRefs: { ports: { video: "asset://clip-fast" } } });
		expect(calls).toEqual([
			{ resumeOnly: false, receipt: undefined },
			{ resumeOnly: true, receipt: "provider-task-fast" },
		]);
	});

	it("reuses a successful author stage when a later stage fails", async () => {
		const spec = pipelineSpec();
		const calls: string[] = [];
		let failSubmit = true;
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			calls.push(context.node.id.split("::").at(-1)!);
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			if (context.node.id.endsWith("::prepare")) {
				return { ok: true, outputRefs: output(context.node, executorRef, "context", "frozen-author-result") };
			}
			if (failSubmit) return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "contract mismatch" };
			return { ok: true, outputRefs: output(context.node, executorRef, "video", "asset://clip-fast") };
		};
		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(first).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed" });
		if (first.ok || !first.outputRefs) throw new Error("Expected persisted failed pipeline output");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		expect(saved.evidence.pipelineState).toMatchObject({ steps: { prepare: { status: "success" }, submit: { status: "failed" } } });
		failSubmit = false;
		const resumed = await runWorkflowPipelineNode(executionContext(spec, saved), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(resumed).toMatchObject({ ok: true, outputRefs: { ports: { video: "asset://clip-fast" } } });
		expect(calls).toEqual(["prepare", "submit", "submit"]);
	});

	it("revisits only failed children of a partial stage on explicit family recovery", async () => {
		const spec = pipelineSpec();
		const calls: Array<{ stage: string; resumeOnly: boolean; priorFailures: number }> = [];
		const failedItem = {
			itemId: "asset-b", index: 1, status: "failed" as const, runtimeNodeId: "prepare::item::asset-b",
			lineage: [], ports: {}, artifacts: [], evidence: {}, errorCode: "workflow_node_runtime_failed",
		};
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const stage = context.node.id.split("::").at(-1)!;
			calls.push({ stage, resumeOnly: context.resumeOnly === true,
				priorFailures: context.resumeOutputRefs?.itemRuns.filter((run) => run.status === "failed").length ?? 0 });
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			if (stage === "prepare") {
				return { ok: true, outputRefs: {
					...output(context.node, executorRef, "context", "asset-list", {
						partial: context.resumeOnly !== true,
					}),
					itemRuns: context.resumeOnly === true ? [] : [failedItem],
				} };
			}
			if (context.recoveryOfExecutionId == null) {
				return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "required asset missing" };
			}
			return { ok: true, outputRefs: output(context.node, executorRef, "video", "asset://clip-fast") };
		};
		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		if (first.ok || !first.outputRefs) throw new Error("Expected persisted partial pipeline output");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		const recovered = await runWorkflowPipelineNode({
			...executionContext(spec, saved), resumeOnly: false, recoveryOfExecutionId: "execution-1",
		}, {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(recovered).toMatchObject({ ok: true, outputRefs: { ports: { video: "asset://clip-fast" } } });
		expect(calls).toEqual([
			{ stage: "prepare", resumeOnly: false, priorFailures: 0 },
			{ stage: "submit", resumeOnly: false, priorFailures: 0 },
			{ stage: "prepare", resumeOnly: true, priorFailures: 1 },
			{ stage: "submit", resumeOnly: false, priorFailures: 0 },
		]);
	});
});
