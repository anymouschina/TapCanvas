import { describe, it, expect, vi } from "vitest";
import { createWorkflowCollection, type WorkflowPipelineRunSpecV1 } from "@tapcanvas/workflow-kernel-protocol";
import { workflowAuthorRepairAttempt, workflowAuthorDeliveryHash } from "./execution.author-repair";
import { resolveWorkflowAuthorRepairTarget, projectWorkflowAuthorRepairOutput, workflowConsumerReplayInputValue } from "./execution.author-repair-target";
import { prepareWorkflowOutputReuse } from "./execution.output-reuse";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";
import { runWorkflowPipelineNode } from "./execution.pipeline-runner";
import { resolveWorkflowConsumerReplaySelection, workflowConsumerReplaySelectionAttempt } from "./execution.consumer-replay-selection";
import { WorkflowSnapshotRerunRequestSchema } from "./execution.schemas";
import { isWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowNodeOutputV1, WorkflowNodeSnapshot, WorkflowNodeItemRunV1 } from "./execution.node-runtime";
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";

function node(id: string, executorRef: string, mode: "once" | "each"): WorkflowNodeSnapshot {
	return { id, type: "taskNode", kind: "workflowStage", data: {
		workflowAtomicSpec: { version: 1, category: "agent", operation: "run", executorRef, executionMode: mode,
			inputPorts: ["input"], outputPorts: ["result"], inputArtifactTypes: { input: ["test/value"] }, outputArtifactTypes: { result: ["test/value"] } },
		workflowAgentOutputEncoding: "json_artifact", workflowAgentFailurePolicy: "repair_with_correction",
	} };
}
function output(nodeId: string, executorRef: string, mode: "once" | "each", text = "old"): WorkflowNodeOutputV1 {
	return { protocolVersion: "1", nodeId, executorRef, executionMode: mode,
		ports: { result: { text } }, artifacts: [], evidence: { executorCompleted: true }, itemRuns: [] };
}
function item(parentId: string, itemId: string, evidence: Record<string, unknown>, index = 0): WorkflowNodeItemRunV1 {
	return { itemId, index, runtimeNodeId: `${parentId}::item::${encodeURIComponent(itemId)}`,
		status: "success", lineage: [], ports: { result: { text: "old" } }, artifacts: [], evidence };
}
const spec: WorkflowPipelineRunSpecV1 = {
	protocolVersion: "workflow.pipeline.run/v1", inputs: [{ portId: "input", mode: "value", artifactTypes: ["test/value"] }],
	steps: [{ stepId: "write", node: node("write", "agents.logical-task/v2", "each") },
		{ stepId: "media", node: node("media", "tapcanvas.video.generate/v1", "once") }],
	bindings: [{ from: { kind: "input", portId: "input" }, to: { stepId: "write", portId: "input" }, mode: "value" },
		{ from: { kind: "step", stepId: "write", portId: "result" }, to: { stepId: "media", portId: "input" }, mode: "value" }],
	outputs: [{ portId: "result", from: { stepId: "media", portId: "result" }, mode: "value" }],
};
const rootNode = { ...node("pipeline", "workflow.pipeline.run/v1", "each"), data: {
	...node("pipeline", "workflow.pipeline.run/v1", "each").data, workflowPipeline: spec } };
const pipelineItem = item("pipeline", "outer", {});
const writerId = `${pipelineItem.runtimeNodeId}::step::write`;
const writer = { ...output(writerId, "agents.logical-task/v2", "each"), itemRuns: [
	item(writerId, "selected", { executorCompleted: true }),
	{ ...item(writerId, "paid-sibling", { taskId: "accepted-original", executorCompleted: false }, 1), status: "waiting_external" as const },
] };
const media = { status: "success", outputRefs: output(`${pipelineItem.runtimeNodeId}::step::media`, "tapcanvas.video.generate/v1", "once", "actual-video-url") };
const state = { protocolVersion: "workflow.pipeline.state/v1", cursorStepId: null,
	steps: { write: { status: "success", outputRefs: writer }, media } };
const source = { ...output("pipeline", "workflow.pipeline.run/v1", "each"), itemRuns: [
	{ ...pipelineItem, evidence: { executorCompleted: true, pipelineState: state } },
	{ ...item("pipeline", "waiting", { taskId: "old-paid-task" }, 1), status: "waiting_external" as const },
] };
const targetPath = [{ kind: "item" as const, itemId: "outer" }, { kind: "step" as const, stepId: "write" },
	{ kind: "item" as const, itemId: "selected" }];
const request = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceNodeRunId: "parent-run",
	deliveryHash: workflowAuthorDeliveryHash("old"), idempotencyKey: "new-attempt", diagnostic: "exact observation", targetPath };
const flow = { nodes: [rootNode], edges: [], workflowExecutionScope: { triggerNodeId: "pipeline" }, workflowDirectAgentModelSelection: { model: "frozen" } };
async function prepared() {
	return prepareWorkflowOutputReuse({ flowData: flow, flowId: "flow", ownerId: "owner",
		replay: { sourceExecutionId: "source", startFromNodeId: "pipeline", authorRepair: request },
		repository: { loadExecutionBundle: async () => ({ flowData: flow,
			nodeRuns: [{ id: "parent-run", nodeId: "pipeline", status: "running", outputRefs: source }] }) } });
}
const deps = {} as WorkflowNodeExecutorDependencies;
describe("exact nested author revision", () => {
	it("binds a successful each author inside a running parent, retaining old paid and media receipts", async () => {
		const before = structuredClone({ flow, source });
		const result = await prepared();
		expect(result.workflowResolvedAuthorRepair).toMatchObject({ targetNodeId: `${writerId}::item::selected`, deliveryArtifact: "old", diagnostic: request.diagnostic });
		expect(result.workflowDirectAgentModelSelection).toEqual(flow.workflowDirectAgentModelSelection);
		const target = resolveWorkflowAuthorRepairTarget(rootNode, source, targetPath);
		expect(target.checkpoint.itemRuns[1]).toEqual(source.itemRuns[1]);
		expect(target.checkpoint.itemRuns[0].evidence.pipelineState).toMatchObject({ steps: { media,
			write: { outputRefs: { itemRuns: [writer.itemRuns[1]] } } } });
		expect({ flow, source }).toEqual(before);
	});
	it("rejects incorrect item/step/hash/identity and binds the path into attempt idempotency", async () => {
		for (const path of [[{ kind: "item" as const, itemId: "missing" }], [...targetPath.slice(0, 1), { kind: "step" as const, stepId: "missing" }]]) {
			expect(() => resolveWorkflowAuthorRepairTarget(rootNode, source, path)).toThrow();
		}
		const forged = structuredClone(source); forged.itemRuns[0].runtimeNodeId = "forged";
		expect(() => resolveWorkflowAuthorRepairTarget(rootNode, forged, targetPath)).toThrow("identity_invalid");
		expect(workflowAuthorRepairAttempt(request, "source", "pipeline").requestHash).not.toEqual(
			workflowAuthorRepairAttempt({ ...request, targetPath: [{ kind: "item", itemId: "other" }] }, "source", "pipeline").requestHash);
	});
	it("executes only one nested author, ignores retained waits, and cold completed restoration makes no new calls", async () => {
		const data = await prepared();
		const checkpoint = (data.nodes as WorkflowNodeSnapshot[])[0].data.workflowResolvedReplayCheckpoint as { outputRefs: WorkflowNodeOutputV1 };
		const context: WorkflowNodeExecutionContext = { executionId: "revision", executionFamilyId: "revision", ownerId: "owner", flowId: "flow", projectId: null,
			workflowKey: "generic", node: rootNode, flowVersionData: data, resumeOnly: true, resumeOutputRefs: checkpoint.outputRefs,
			inputs: { input: [createWorkflowCollection({ collectionId: "original", producerNodeId: "input", producerPortId: "input",
				itemIds: ["outer", "waiting"], values: [createWorkflowCollection({ collectionId: "inner", producerNodeId: "input", producerPortId: "input",
					itemIds: ["selected", "paid-sibling"], values: ["one", "two"] }), "unrelated"] })] } };
		const paid = vi.fn(async (current: WorkflowNodeExecutionContext) => ({ ok: true as const,
			outputRefs: output(current.node.id, "agents.logical-task/v2", "once", "new typed artifact") }));
		const run = (current: WorkflowNodeExecutionContext): Promise<import("./execution.node-runtime").WorkflowNodeExecutionResult> =>
			executeWorkflowNodeByMode(current, deps, async child => child.node.data.workflowPipeline
				? runWorkflowPipelineNode(child, deps, step => run(step)) : paid(child));
		const result = await run(context);
		expect(result.ok).toBe(true); expect(paid).toHaveBeenCalledTimes(1);
		expect(paid.mock.calls[0][0].node.id).toBe(`${writerId}::item::selected`);
		expect(paid.mock.calls[0][0].resumeOutputRefs).toBeUndefined();
		if (!result.ok) throw new Error("unexpected failure");
		expect(result.outputRefs.ports).toEqual({}); expect(result.outputRefs.artifacts).toEqual([]);
		expect(result.outputRefs.evidence.authorRepairDelivery).toMatchObject({ expectedDelivery: { nodeId: `${writerId}::item::selected` },
			deliveryEvidence: { status: "success", outputRefs: { ports: { result: { text: "new typed artifact" } } } } });
		expect(result.outputRefs.itemRuns[1]).toEqual(source.itemRuns[1]);
		const restored = await run({ ...context, resumeOutputRefs: result.outputRefs });
		expect(restored.ok).toBe(true); expect(paid).toHaveBeenCalledTimes(1);
	});
	it("rejects a missing actual collection without executing the selected author as root once", async () => {
		const data = await prepared(); const execute = vi.fn();
		await expect(executeWorkflowNodeByMode({ executionId: "new", executionFamilyId: "new", ownerId: "owner", flowId: "flow", projectId: null,
			workflowKey: "generic", node: rootNode, flowVersionData: data, inputs: { input: ["not collection"] } }, deps, execute)).rejects.toThrow("primary_missing");
		expect(execute).not.toHaveBeenCalled();
	});
	it("does not expose an old downstream result as the revised author's delivery", async () => {
		const data = await prepared();
		const projected = projectWorkflowAuthorRepairOutput(data, source);
		expect(projected.ports).toEqual({}); expect(projected.evidence.authorRepairDelivery).toMatchObject({
			expectedDelivery: { nodeId: `${writerId}::item::selected` }, deliveryEvidence: { outputRefs: { executorRef: "agents.logical-task/v2" } } });
	});
	it("accepts failed ancestors only when the exact author endpoint succeeded", () => {
		const failed = structuredClone(source);
		failed.itemRuns[0].status = "failed";
		const state = failed.itemRuns[0].evidence.pipelineState as { steps: { write: { status: string; outputRefs: WorkflowNodeOutputV1 } } };
		state.steps.write.status = "failed";
		expect(resolveWorkflowAuthorRepairTarget(rootNode, failed, targetPath).node.id).toBe(`${writerId}::item::selected`);
		Object.assign(state.steps.write.outputRefs.itemRuns[0], { status: "failed" });
		expect(() => resolveWorkflowAuthorRepairTarget(rootNode, failed, targetPath)).toThrow("item_not_successful");
	});
	it("does not let a historical successful sibling or media partial policy turn a target failure into success", async () => {
		const data = await prepared();
		const checkpoint = (data.nodes as WorkflowNodeSnapshot[])[0].data.workflowResolvedReplayCheckpoint as { outputRefs: WorkflowNodeOutputV1 };
		const ctx: WorkflowNodeExecutionContext = { executionId: "new", executionFamilyId: "new", ownerId: "owner", flowId: "flow", projectId: null,
			workflowKey: "generic", node: { ...spec.steps[0].node, id: writerId, data: { ...spec.steps[0].node.data,
				workflowMediaDeliveryPolicy: { version: 1, maxRetries: 0, exhausted: "deliver_successes" } } },
			flowVersionData: data, resumeOnly: true, resumeOutputRefs: writer,
			inputs: { input: [createWorkflowCollection({ collectionId: "inner", producerNodeId: "input", producerPortId: "input", itemIds: ["selected", "paid-sibling"], values: ["one", "two"] })] } };
		// Use the initialized writer receipt, retaining an unrelated successful item.
		const state = checkpoint.outputRefs.itemRuns[0].evidence.pipelineState as { steps: { write: { outputRefs: WorkflowNodeOutputV1 } } };
		const initial = structuredClone(state.steps.write.outputRefs); Object.assign(initial.itemRuns[0], { status: "success" });
		const result = await executeWorkflowNodeByMode({ ...ctx, resumeOutputRefs: initial }, deps, async current => ({ ok: false,
			errorCode: "workflow_node_runtime_failed", errorMessage: "explicit action failure",
			outputRefs: { ...output(current.node.id, "agents.logical-task/v2", "once"), evidence: { executorCompleted: false } } }));
		expect(result.ok).toBe(false);
		if (!result.outputRefs) throw new Error("missing output");
		expect(result.outputRefs.evidence.executorCompleted).toBe(false);
		expect(result.outputRefs.evidence.authorRepairDelivery).toMatchObject({ deliveryEvidence: { status: "failed" } });
		expect(result.outputRefs.itemRuns.find(item => item.itemId === "paid-sibling")).toEqual(initial.itemRuns[0]);
	});
});

describe("selected deterministic consumer replay", () => {
	const consumerSpec: WorkflowPipelineRunSpecV1 = { ...spec, steps: [spec.steps[0],
		{ stepId: "collect", node: node("collect", "video.clip-production.collect/v1", "once") },
		{ stepId: "persist", node: node("persist", "video.clip-production.nodes.materialize/v1", "once") }, spec.steps[1]],
		bindings: [spec.bindings[0],
			{ from: { kind: "step", stepId: "write", portId: "result" }, to: { stepId: "collect", portId: "input" }, mode: "value" },
			{ from: { kind: "step", stepId: "collect", portId: "result" }, to: { stepId: "persist", portId: "input" }, mode: "value" },
			{ from: { kind: "step", stepId: "persist", portId: "result" }, to: { stepId: "media", portId: "input" }, mode: "value" }],
	};
	const consumerNode = { ...rootNode, data: { ...rootNode.data, workflowPipeline: consumerSpec } };
	const consumerFlow = { ...flow, nodes: [consumerNode] };
	const consumerSource = structuredClone(source);
	consumerSource.itemRuns[0].status = "failed";
	const consumerState = consumerSource.itemRuns[0].evidence.pipelineState as { steps: Record<string, { status: string; outputRefs: WorkflowNodeOutputV1 }> };
	consumerState.steps.write.status = "failed";
	consumerState.steps.write.outputRefs.ports = {};
	consumerState.steps.collect = { status: "success", outputRefs: output(`${pipelineItem.runtimeNodeId}::step::collect`, "video.clip-production.collect/v1", "once", "old collected") };
	consumerState.steps.persist = { status: "success", outputRefs: output(`${pipelineItem.runtimeNodeId}::step::persist`, "video.clip-production.nodes.materialize/v1", "once", "old nodes") };
	const consumerRequest = { version: 1 as const, sourceNodeRunId: "revision-run", idempotencyKey: "consume-revision", targetPath,
		deliveryHash: request.deliveryHash, startStepId: "collect", stopStepId: "persist" };
	const resolve = () => resolveWorkflowConsumerReplaySelection({ node: consumerNode, output: consumerSource,
		request: consumerRequest, sourceExecutionId: "revision", flowData: consumerFlow });
	it("projects supplemental input collections by exact frozen lineage in a once pipeline with an each author", () => {
		const sharedChapter = { nodeId: "chapter", portId: "source", itemId: "same-chapter", index: 0 };
		const inputs = createWorkflowCollection({ collectionId: "facts", producerNodeId: "frozen-producer", producerPortId: "facts",
			itemIds: ["selected", "other"], values: ["selected fact", "sibling fact"], parentLineage: [[sharedChapter], [sharedChapter]] });
		const frozenState = structuredClone(consumerState);
		const oldWriter = frozenState.steps.write.outputRefs;
		frozenState.steps.write.outputRefs = { ...oldWriter, itemRuns: oldWriter.itemRuns.map(run => run.itemId === "selected"
			? { ...run, lineage: inputs.items[0].lineage } : run) };
		const onceNode = { ...consumerNode, id: pipelineItem.runtimeNodeId, data: { ...consumerNode.data,
			workflowAtomicSpec: node(pipelineItem.runtimeNodeId, "workflow.pipeline.run/v1", "once").data.workflowAtomicSpec } };
		const onceOutput = { ...consumerSource, nodeId: onceNode.id, executionMode: "once" as const, itemRuns: [],
			evidence: { executorCompleted: false, pipelineState: frozenState } };
		const result = resolveWorkflowConsumerReplaySelection({ node: onceNode, output: onceOutput, flowData: consumerFlow,
			request: { ...consumerRequest, targetPath: targetPath.slice(1) }, sourceExecutionId: "source" });
		const projection = workflowConsumerReplayInputValue({ workflowAuthorRepairSelection: result.selection }, onceNode.id, inputs);
		expect(isWorkflowCollection(projection)).toBe(true);
		if (!isWorkflowCollection(projection)) throw new Error("invalid collection");
		expect(projection.items.map(item => item.value)).toEqual(["selected fact"]);
		expect(inputs.items.length).toBe(2);
		expect(() => workflowConsumerReplayInputValue({ workflowAuthorRepairSelection: result.selection }, onceNode.id,
			{ ...inputs, items: inputs.items.slice(1).map((item, index) => ({ ...item, index })) })).toThrow("input_target_missing");
		const shared = createWorkflowCollection({ collectionId: "shared", producerNodeId: "unrelated", producerPortId: "facts",
			itemIds: ["whole"], values: ["shared fact"], parentLineage: [[sharedChapter]] });
		expect(workflowConsumerReplayInputValue({ workflowAuthorRepairSelection: result.selection }, onceNode.id, shared)).toBe(shared);
	});
	it("binds exact input hash/range/path and rejects media or nested hidden effects", () => {
		const before = structuredClone(consumerSource);
		const resolved = resolve();
		expect(resolved.selection.consumer?.stepIds).toEqual(["collect", "persist"]);
		expect(consumerSource).toEqual(before);
		expect(resolved.checkpoint.itemRuns[1]).toEqual(consumerSource.itemRuns[1]);
		expect(() => resolveWorkflowConsumerReplaySelection({ node: consumerNode, output: consumerSource,
			request: { ...consumerRequest, stopStepId: "media" }, sourceExecutionId: "revision", flowData: consumerFlow })).toThrow("effect_not_authorized");
		expect(() => resolveWorkflowConsumerReplaySelection({ node: consumerNode, output: consumerSource,
			request: { ...consumerRequest, deliveryHash: workflowAuthorDeliveryHash("wrong") }, sourceExecutionId: "revision", flowData: consumerFlow })).toThrow("hash_mismatch");
		const nestedNode = structuredClone(consumerNode);
		const nestedSpec = nestedNode.data.workflowPipeline as WorkflowPipelineRunSpecV1;
		Object.assign(nestedSpec.steps[1].node.data, { workflowAtomicSpec: node("collect", "workflow.pipeline.run/v1", "once").data.workflowAtomicSpec, workflowPipeline: spec });
		expect(() => resolveWorkflowConsumerReplaySelection({ node: nestedNode, output: consumerSource,
			request: consumerRequest, sourceExecutionId: "revision", flowData: consumerFlow })).toThrow("effect_not_authorized");
		expect(workflowConsumerReplaySelectionAttempt(consumerRequest, "revision", "pipeline").requestHash).not.toBe(
			workflowConsumerReplaySelectionAttempt({ ...consumerRequest, stopStepId: "collect" }, "revision", "pipeline").requestHash);
		expect(WorkflowSnapshotRerunRequestSchema.safeParse({ startFromNodeId: "pipeline", stopAfterNodeId: "pipeline", consumerReplay: consumerRequest }).success).toBe(true);
		expect(WorkflowSnapshotRerunRequestSchema.safeParse({ startFromNodeId: "pipeline", stopAfterNodeId: "pipeline", consumerReplay: consumerRequest, authorRepair: request }).success).toBe(false);
	});
	it("rejects a failed external author ancestor instead of expanding consumer replay into a new upstream attempt", async () => {
		const upstream = node("external-author", "agents.logical-task/v2", "once");
		const scopedFlow = { ...consumerFlow, nodes: [upstream, consumerNode], edges: [{ id: "external-input", source: upstream.id,
			target: consumerNode.id, sourceHandle: "result", targetHandle: "input" }] };
		const before = structuredClone(scopedFlow);
		await expect(prepareWorkflowOutputReuse({ flowData: scopedFlow, flowId: "flow", ownerId: "owner",
			replay: { sourceExecutionId: "revision", startFromNodeId: "pipeline", consumerReplay: consumerRequest },
			repository: { loadExecutionBundle: async () => ({ flowData: scopedFlow, nodeRuns: [
				{ id: "failed-upstream", nodeId: upstream.id, status: "failed", outputRefs: output(upstream.id, "agents.logical-task/v2", "once") },
				{ id: "revision-run", nodeId: "pipeline", status: "failed", outputRefs: consumerSource },
			] }) } })).rejects.toThrow("workflow_consumer_replay_upstream_receipts_incomplete");
		expect(scopedFlow).toEqual(before);
	});
	it("consumes only the selected author item, persists a new artifact, retains paid history, and cold recovery does not rerun", async () => {
		const data = await prepareWorkflowOutputReuse({ flowData: consumerFlow, flowId: "flow", ownerId: "owner",
			replay: { sourceExecutionId: "revision", startFromNodeId: "pipeline", consumerReplay: consumerRequest },
			repository: { loadExecutionBundle: async () => ({ flowData: consumerFlow,
				nodeRuns: [{ id: "revision-run", nodeId: "pipeline", status: "failed", outputRefs: consumerSource }] }) } });
		const checkpoint = (data.nodes as WorkflowNodeSnapshot[])[0].data.workflowResolvedReplayCheckpoint as { outputRefs: WorkflowNodeOutputV1 };
		const context: WorkflowNodeExecutionContext = { executionId: "consumer", executionFamilyId: "consumer", ownerId: "owner", flowId: "flow", projectId: null,
			workflowKey: "generic", node: consumerNode, flowVersionData: data, resumeOnly: true, resumeOutputRefs: checkpoint.outputRefs,
			inputs: { input: [createWorkflowCollection({ collectionId: "original", producerNodeId: "input", producerPortId: "input",
				itemIds: ["outer", "waiting"], values: ["seed", "unrelated"] })] } };
		const execute = vi.fn(async (current: WorkflowNodeExecutionContext) => {
			if (current.node.id.endsWith("::step::collect")) {
				const value = current.inputs.input[0];
				expect(isWorkflowCollection(value)).toBe(true);
				if (!isWorkflowCollection(value)) throw new Error("missing selected collection");
				expect(value.items.map(item => item.itemId)).toEqual(["selected"]);
				expect(value.items[0].value).toEqual({ text: "old" });
			} else expect(current.node.id.endsWith("::step::persist")).toBe(true);
			return { ok: true as const, outputRefs: output(current.node.id,
				current.node.id.endsWith("::step::collect") ? "video.clip-production.collect/v1" : "video.clip-production.nodes.materialize/v1", "once", "new nodes") };
		});
		const run = (ctx: WorkflowNodeExecutionContext): Promise<import("./execution.node-runtime").WorkflowNodeExecutionResult> => executeWorkflowNodeByMode(ctx, deps,
			child => child.node.data.workflowPipeline ? runWorkflowPipelineNode(child, deps, step => run(step)) : execute(child));
		const result = await run(context);
		expect(result.ok).toBe(true); expect(execute).toHaveBeenCalledTimes(2);
		if (!result.ok) throw new Error("consumer failed");
		expect(result.outputRefs.ports).toEqual({});
		expect(result.outputRefs.evidence.authorRepairDelivery).toMatchObject({ mode: "consumer_replay",
			expectedDelivery: { nodeId: `${pipelineItem.runtimeNodeId}::step::persist` },
			deliveryEvidence: { status: "success", outputRefs: { ports: { result: { text: "new nodes" } } } } });
		expect(result.outputRefs.itemRuns[1]).toEqual(consumerSource.itemRuns[1]);
		const state = result.outputRefs.itemRuns[0].evidence.pipelineState as typeof consumerState;
		expect(state.steps.media).toEqual(consumerState.steps.media);
		expect(state.steps.write).toEqual(consumerState.steps.write);
		expect((await run({ ...context, resumeOutputRefs: result.outputRefs })).ok).toBe(true);
		expect(execute).toHaveBeenCalledTimes(2);
	});
});
