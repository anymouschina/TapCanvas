import { describe, expect, it, vi } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import fixture from "./execution.recovery-invocation-fixture.json";
import { inheritWorkflowRecoveryInvocation } from "./execution.recovery-invocation";
import { prepareWorkflowExecutionSnapshotRerun } from "./execution.snapshot-runtime";
import { prepareWorkflowOutputReuse, readResolvedWorkflowReplayCheckpoints } from "./execution.output-reuse";
import { workflowAuthorRepairRouteAt } from "./execution.author-repair-target";
import { workflowAgentPublicTurnId, workflowAgentSessionKey } from "./execution.agent-identity";
import { findWorkflowNode, type WorkflowNodeOutputV1, type WorkflowNodeItemRunV1, type WorkflowNodeExecutionResult } from "./execution.node-runtime";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";
import { runWorkflowPipelineNode } from "./execution.pipeline-runner";
import { workflowConsumerReplaySelectionAttempt } from "./execution.consumer-replay-selection";
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";

const sourceId = fixture.provenance.executionId;
const flow: Record<string, unknown> = fixture.flowData;
const selection = fixture.flowData.workflowAuthorRepairSelection;
const rootId = selection.rootNodeId;
const root = findWorkflowNode(flow, rootId);
function receipt(withPaid: boolean): WorkflowNodeOutputV1 {
	const outer = selection.route[0]; const step = selection.route[1]; const inner = selection.route[2];
	const identity = { executionId: sourceId, nodeId: selection.targetNodeId, physicalRetryOrdinal: null };
	const leafEvidence = { observationFailure: { message: "database observation unavailable" }, ...(withPaid ? {
		deliveryEvidence: { sessionKey: workflowAgentSessionKey(identity), logicalTaskId: workflowAgentPublicTurnId(identity),
			recoveryCheckpoint: { phase: "atomic_selfcheck", completedInferences: [{ status: "completed", response: "cached" }],
				pendingInference: { status: "inference_attempted", requestId: "unknown-paid-request" } } } } : {}) };
	const writer: WorkflowNodeOutputV1 = { protocolVersion: "1", nodeId: inner.nodeId, executorRef: "agents.logical-task/v2",
		executionMode: "each", ports: {}, artifacts: [], evidence: {}, itemRuns: [{ status: "failed", itemId: inner.itemId!,
			index: 0, runtimeNodeId: selection.targetNodeId, ports: {}, artifacts: [], lineage: [], evidence: leafEvidence }] };
	return { protocolVersion: "1", nodeId: rootId, executorRef: "workflow.pipeline.run/v1", executionMode: "each", ports: {}, artifacts: [], evidence: {},
		itemRuns: [{ status: "failed", itemId: outer.itemId!, index: 0, runtimeNodeId: step.nodeId, lineage: [], ports: {}, artifacts: [],
			evidence: { pipelineState: { protocolVersion: "workflow.pipeline.state/v1", cursorStepId: step.stepId,
				steps: { [step.stepId!]: { status: "failed", outputRefs: writer }, "clip-production-collect": { status: "success", outputRefs: {
					protocolVersion: "1", executorRef: "video.clip-production.collect/v1", nodeId: `${step.nodeId}::step::clip-production-collect`,
					executionMode: "once", ports: {}, artifacts: [], itemRuns: [], evidence: { historical: true, executorCompleted: true } } } } } } }] };
}
async function recover(output: WorkflowNodeOutputV1, source = flow, ownerId = "owner", currentSource = source) {
	const current = prepareWorkflowExecutionSnapshotRerun(currentSource).data;
	return prepareWorkflowOutputReuse({ flowData: current, flowId: "flow", ownerId,
		replay: { sourceExecutionId: sourceId, startFromNodeId: rootId, scope: "recovery_snapshot" },
		repository: { loadExecutionBundle: async (_id, owner, flowId) => owner === "owner" && flowId === "flow"
			? { flowData: source, nodeRuns: [{ id: "R5-root-run", nodeId: rootId, status: "failed", outputRefs: output }] } : null } });
}

describe("admitted bounded invocation recovery", () => {
	it("inherits the synthetic admitted route, diagnostic, attempt and frozen model without using client repair facts", () => {
		const current = prepareWorkflowExecutionSnapshotRerun(flow).data;
		expect(current.workflowAuthorRepairSelection).toBeUndefined();
		const before = structuredClone(flow);
		const inherited = inheritWorkflowRecoveryInvocation({ source: flow, current });
		for (const key of ["workflowAuthorRepairSelection", "workflowResolvedAuthorRepair", "workflowAuthorRepairAttempt"]) expect(inherited[key]).toEqual(flow[key]);
		expect(flow).toEqual(before); expect(current.workflowDirectAgentModelSelection).toEqual(flow.workflowDirectAgentModelSelection);
		const route = workflowAuthorRepairRouteAt(inherited, rootId);
		expect(route).toEqual(selection.route[0]);
	});
	it.each(["workflowDirectAgentModelSelection", "workflowDeliveryScope", "workflowSourceSnapshots", "workflowExecutionScope"])("rejects changed frozen %s before admission", field => {
		const current = prepareWorkflowExecutionSnapshotRerun(flow).data; current[field] = { changed: true };
		expect(() => inheritWorkflowRecoveryInvocation({ source: flow, current })).toThrow(`workflow_recovery_frozen_invocation_changed:${field}`);
	});
	it("rejects a damaged attempt or route without silently expanding the selected item", () => {
		const damaged = structuredClone(fixture.flowData); damaged.workflowAuthorRepairAttempt.requestHash = `sha256:${"0".repeat(64)}`;
		expect(() => inheritWorkflowRecoveryInvocation({ source: damaged, current: prepareWorkflowExecutionSnapshotRerun(damaged).data })).toThrow("attempt_mismatch");
		const route = structuredClone(fixture.flowData); route.workflowAuthorRepairSelection.route[1].nodeId = "other-owner";
		expect(() => inheritWorkflowRecoveryInvocation({ source: route, current: prepareWorkflowExecutionSnapshotRerun(route).data })).toThrow("route_identity_invalid");
	});
	it("rejects an author selection with missing or mismatched receipt, and mixed consumer/author modes", () => {
		const withoutReceipt: Record<string, unknown> = structuredClone(flow); delete withoutReceipt.workflowResolvedAuthorRepair;
		expect(() => inheritWorkflowRecoveryInvocation({ source: withoutReceipt, current: prepareWorkflowExecutionSnapshotRerun(withoutReceipt).data })).toThrow("selection_receipt_mismatch");
		for (const field of ["sourceExecutionId", "sourceNodeRunId", "targetNodeId", "deliveryHash"] as const) {
			const invalid = structuredClone(fixture.flowData);
			invalid.workflowAuthorRepairSelection[field] = field === "deliveryHash" ? `sha256:${"0".repeat(64)}` : "other-identity";
			expect(() => inheritWorkflowRecoveryInvocation({ source: invalid, current: prepareWorkflowExecutionSnapshotRerun(invalid).data })).toThrow("selection_receipt_mismatch");
		}
		const mixed = structuredClone(flow);
		mixed.workflowAuthorRepairSelection = { ...selection, mode: "consumer_replay", consumer: { pipelineNodeId: selection.route[1].nodeId,
			startStepId: "clip-production-collect", stopStepId: "clip-production-nodes-materialize", stepIds: ["clip-production-collect", "clip-production-nodes-materialize"] } };
		expect(() => inheritWorkflowRecoveryInvocation({ source: mixed, current: prepareWorkflowExecutionSnapshotRerun(mixed).data })).toThrow("modes_conflict");
	});
	it("preserves an admitted consumer range and rejects a changed stop identity", () => {
		const source = structuredClone(flow);
		delete source.workflowResolvedAuthorRepair; delete source.workflowAuthorRepairAttempt;
		const consumer = { pipelineNodeId: selection.route[1].nodeId, startStepId: "clip-production-collect", stopStepId: "clip-production-nodes-materialize",
			stepIds: ["clip-production-collect", "clip-production-nodes-materialize"] };
		source.workflowAuthorRepairSelection = { ...selection, mode: "consumer_replay", consumer };
		source.workflowConsumerReplayAttempt = workflowConsumerReplaySelectionAttempt({ version: 1, sourceNodeRunId: selection.sourceNodeRunId,
			deliveryHash: selection.deliveryHash, idempotencyKey: "consumer-attempt", startStepId: consumer.startStepId, stopStepId: consumer.stopStepId,
			targetPath: selection.route.map(segment => segment.kind === "item" ? { kind: "item", itemId: segment.itemId! } : { kind: "step", stepId: segment.stepId! }) }, selection.sourceExecutionId, rootId);
		const result = inheritWorkflowRecoveryInvocation({ source, current: prepareWorkflowExecutionSnapshotRerun(source).data });
		expect(result.workflowAuthorRepairSelection).toEqual(source.workflowAuthorRepairSelection);
		expect(result.workflowConsumerReplayAttempt).toEqual(source.workflowConsumerReplayAttempt); expect(result.workflowResolvedAuthorRepair).toBeUndefined();
		source.workflowAuthorRepairSelection = { ...selection, mode: "consumer_replay", consumer: { ...consumer, stopStepId: "other-stop" } };
		expect(() => inheritWorkflowRecoveryInvocation({ source, current: prepareWorkflowExecutionSnapshotRerun(source).data })).toThrow("attempt_mismatch");
	});
	it("does not call an author when R5 only records observationFailure and provider admission is unverified", async () => {
		const output = receipt(false); const before = structuredClone(output);
		await expect(recover(output)).rejects.toThrow("workflow_recovery_agent_admission_unverified");
		expect(output).toEqual(before);
	});
	it("retains an off-route unknown failed author sibling without denying the selected recoverable action", async () => {
		const output = receipt(true);
		const state = output.itemRuns[0].evidence.pipelineState as { steps: Record<string, { outputRefs: WorkflowNodeOutputV1 }> };
		const writer = state.steps[selection.route[1].stepId!].outputRefs;
		const offRoute: WorkflowNodeItemRunV1 = { status: "failed", itemId: "off-route", index: 1, runtimeNodeId: `${writer.nodeId}::item::off-route`,
			ports: {}, artifacts: [], lineage: [], evidence: { observationFailure: { message: "unknown paid state" } } };
		state.steps[selection.route[1].stepId!].outputRefs = { ...writer, itemRuns: [...writer.itemRuns, offRoute] };
		const recovered = await recover(output);
		const checkpoint = readResolvedWorkflowReplayCheckpoints(recovered)[0].checkpoint.outputRefs;
		const after = checkpoint.itemRuns[0].evidence.pipelineState as typeof state;
		expect(after.steps[selection.route[1].stepId!].outputRefs.itemRuns[1]).toEqual(offRoute);
	});
	it("keeps exact paid cursor and calls only the one selected author adapter with its verified source; siblings/media never run", async () => {
		const output = receipt(true); const before = structuredClone(output);
		const data = await recover(output);
		const checkpoint = readResolvedWorkflowReplayCheckpoints(data)[0].checkpoint.outputRefs;
		const paidCursor = ((output.itemRuns[0].evidence.pipelineState as { steps: Record<string, { outputRefs: WorkflowNodeOutputV1 }> })
			.steps[selection.route[1].stepId!].outputRefs.itemRuns[0].evidence.deliveryEvidence);
		const runAuthor = vi.fn(async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			expect(context.node.id).toBe(selection.targetNodeId);
			const evidence = context.resumeOutputRefs?.itemRuns.find(item => item.runtimeNodeId === context.node.id)?.evidence ?? context.resumeOutputRefs?.evidence;
			expect(evidence?.deliveryEvidence).toEqual(paidCursor);
			expect(evidence?.agentRepairSource).toEqual({ sourceExecutionId: sourceId,
				sessionKey: workflowAgentSessionKey({ executionId: sourceId, nodeId: selection.targetNodeId, physicalRetryOrdinal: null }),
				turnId: workflowAgentPublicTurnId({ executionId: sourceId, nodeId: selection.targetNodeId, physicalRetryOrdinal: null }) });
			return { ok: true, outputRefs: { protocolVersion: "1", nodeId: context.node.id, executorRef: "agents.logical-task/v2", executionMode: "once",
				ports: { "clip-designs": { text: "reconciled saved result" } }, artifacts: [], itemRuns: [], evidence: { executorCompleted: true } } };
		});
		const dependencies = {} as WorkflowNodeExecutorDependencies;
		const run = (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => executeWorkflowNodeByMode(context, dependencies,
			child => child.node.data.workflowPipeline ? runWorkflowPipelineNode(child, dependencies, run) : runAuthor(child));
		const inner = createWorkflowCollection({ collectionId: "inner", producerNodeId: "input", producerPortId: "source-segments",
			itemIds: [selection.route[2].itemId!, "other-inner"], values: ["source", "unrelated"] });
		const collection = createWorkflowCollection({ collectionId: "outer", producerNodeId: "input", producerPortId: "source-segments",
			itemIds: [selection.route[0].itemId!, ...Array.from({ length: 12 }, (_, i) => `sibling-${i}`)], values: [inner, ...Array(12).fill("unrelated")] });
		const context: WorkflowNodeExecutionContext = { node: root, executionId: "recovery-member", executionFamilyId: sourceId, recoveryOfExecutionId: sourceId,
			ownerId: "owner", flowId: "flow", projectId: null, workflowKey: "generic", flowVersionData: data, resumeOnly: true,
			resumeOutputRefs: checkpoint, inputs: { "source-segments": [collection], "clip-sequences": [collection], "chapter-assets": [{}], "delivery-contract": [{}] } };
		const result = await run(context);
		if (!result.ok) throw new Error("errorMessage" in result ? result.errorMessage : "unexpected external wait");
		expect(result.ok).toBe(true); expect(runAuthor).toHaveBeenCalledTimes(1);
		expect(result.outputRefs.ports).toEqual({}); expect(result.outputRefs.artifacts).toEqual([]);
		expect(result.outputRefs.evidence.authorRepairDelivery).toMatchObject({ deliveryEvidence: { status: "success" }, expectedDelivery: { nodeId: selection.targetNodeId } });
		expect(output).toEqual(before);
		const cold = await run({ ...context, resumeOutputRefs: result.outputRefs }); expect(cold.ok).toBe(true); expect(runAuthor).toHaveBeenCalledTimes(1);
	});
	it("denies another owner and a changed executor; standalone rerun does not inherit the bounded attempt", async () => {
		await expect(recover(receipt(true), flow, "other-owner")).rejects.toThrow("not found in this workflow");
		const changed = structuredClone(fixture.flowData); changed.nodes[0].data.workflowPipeline.steps[0].node.data.workflowInstruction += " changed";
		await expect(recover(receipt(true), flow, "owner", changed)).rejects.toThrow("bounded_definition_changed");
		const current = prepareWorkflowExecutionSnapshotRerun(flow).data;
		const unbounded = await prepareWorkflowOutputReuse({ flowData: current, flowId: "flow", ownerId: "owner", repository: { loadExecutionBundle: async () => null } });
		expect(unbounded.workflowResolvedAuthorRepair).toBeUndefined(); expect(unbounded.workflowAuthorRepairSelection).toBeUndefined();
		expect(unbounded.workflowAuthorRepairAttempt).toBeUndefined();
	});
});
