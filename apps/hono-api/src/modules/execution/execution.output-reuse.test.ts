import { workflowAgentPublicTurnId, workflowAgentSessionKey } from "./execution.agent-identity";
import { boundedReplayFixture } from "./execution.bounded-replay-fixture";
import { scopeWorkflowFlowData } from "./execution.flow-scope";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";
import { workflowAuthorDeliveryHash } from "./execution.author-repair";
import { AUTHOR_SOURCE_REPRESENTATION, authorSourceJsonHash, authorSourceTextHash } from "../../../../../packages/schemas/author-source-representation/index.mjs";
import { readWorkflowAcceptedAuthorRecovery } from "./execution.accepted-author-recovery";

describe("ordinary nested recovery source admission", () => {
	function fixture(mode: "once" | "each") {
		const receiptOutput = (nodeId: string, executorRef: string, executionMode: "once" | "each"): WorkflowNodeOutputV1 => ({
			protocolVersion: "1", nodeId, executorRef, executionMode, ports: {}, artifacts: [], itemRuns: [], evidence: { executorCompleted: false } });
		const author = (id: string, executorRef: string, executionMode: "once" | "each"): WorkflowNodeSnapshot => ({
			id, type: "taskNode", kind: "workflowStage", data: { kind: "workflowStage",
				workflowAgentOutputEncoding: "json_object", workflowAgentFailurePolicy: "repair_with_correction",
				workflowAtomicSpec: { version: 1, category: "agent", operation: "run", executorRef, executionMode,
					inputPorts: ["input"], outputPorts: ["result"], inputArtifactTypes: { input: ["test/value"] }, outputArtifactTypes: { result: ["test/value"] } } } });
		const root = author("pipeline", "workflow.pipeline.run/v1", mode);
		root.data.workflowPipeline = { protocolVersion: "workflow.pipeline.run/v1", inputs: [{ portId: "input", mode: "value", artifactTypes: ["test/value"] }],
			steps: [{ stepId: "write", node: author("write", "agents.logical-task/v2", "each") }],
			bindings: [{ from: { kind: "input", portId: "input" }, to: { stepId: "write", portId: "input" }, mode: "value" }],
			outputs: [{ portId: "result", from: { stepId: "write", portId: "result" }, mode: "value" }] };
		const outerId = mode === "each" ? "pipeline::item::outer" : "pipeline";
		const writeId = `${outerId}::step::write`; const leafId = `${writeId}::item::failed`;
		const identity = { executionId: "original-paid", nodeId: leafId, physicalRetryOrdinal: null };
		const writer: WorkflowNodeOutputV1 = { ...receiptOutput(writeId, "agents.logical-task/v2", "each"), itemRuns: [
			{ itemId: "failed", index: 0, runtimeNodeId: leafId, status: "failed", lineage: [], ports: {}, artifacts: [], evidence: {
				executorCompleted: false, deliveryEvidence: { sessionKey: workflowAgentSessionKey(identity), logicalTaskId: workflowAgentPublicTurnId(identity), recoveryCheckpoint: { physicalRunId: "original-paid-review", reasonCode: "unknown_submission" } } } },
			{ itemId: "success", index: 1, runtimeNodeId: `${writeId}::item::success`, status: "success", lineage: [], ports: { result: { text: '{"valid":true}' } }, artifacts: [], evidence: { executorCompleted: true } },
		] };
		const state = { protocolVersion: "workflow.pipeline.state/v1", cursorStepId: "write", steps: { write: { status: "failed", outputRefs: writer } } };
		const receipt = receiptOutput("pipeline", "workflow.pipeline.run/v1", mode);
		if (mode === "once") receipt.evidence.pipelineState = state;
		else receipt.itemRuns = [{ itemId: "outer", index: 0, status: "failed", runtimeNodeId: outerId, lineage: [], ports: {}, artifacts: [], evidence: { pipelineState: state } }];
		const flow = { nodes: [root], edges: [] };
		const leaves = (o: WorkflowNodeOutputV1) => {
			const e = mode === "each" ? o.itemRuns[0].evidence : o.evidence;
			return (e.pipelineState as typeof state).steps.write.outputRefs.itemRuns;
		};
		return { flow, receipt, leaves, identity };
	}
	async function prepare(f: ReturnType<typeof fixture>, sourceExecutionId: string, receipt: WorkflowNodeOutputV1) {
		return prepareWorkflowOutputReuse({ flowData: f.flow, flowId: "flow", ownerId: "owner",
			replay: { sourceExecutionId, startFromNodeId: "pipeline", scope: "recovery_snapshot" },
			repository: { loadExecutionBundle: async () => ({ flowData: f.flow, nodeRuns: [{ id: "pipeline-run", nodeId: "pipeline", status: "failed", outputRefs: receipt }] }) } });
	}
	it.each(["once", "each"] as const)("admits %s pipeline with only a failed author step and carries exact source into its runtime item", async mode => {
		const f = fixture(mode); const before = structuredClone(f.receipt);
		const first = await prepare(f, "original-paid", f.receipt);
		const checkpoint = readResolvedWorkflowReplayCheckpoints(first)[0].checkpoint.outputRefs;
		expect(f.leaves(checkpoint)[0].evidence.agentRepairSource).toEqual({ sourceExecutionId: "original-paid",
			sessionKey: workflowAgentSessionKey(f.identity), turnId: workflowAgentPublicTurnId(f.identity) });
		expect(f.leaves(checkpoint)[1]).toEqual(f.leaves(f.receipt)[1]); expect(f.receipt).toEqual(before);
		const second = await prepare(f, "recovery-member", checkpoint);
		expect(f.leaves(readResolvedWorkflowReplayCheckpoints(second)[0].checkpoint.outputRefs)[0].evidence.agentRepairSource)
			.toEqual(f.leaves(checkpoint)[0].evidence.agentRepairSource);
	});
	it.each(["replayCheckpoint", "outputReuse"] as const)("keeps legacy nested source ownership from %s before new checkpoint stamps are written", async key => {
		const f = fixture("each"); f.receipt.evidence[key] = { sourceExecutionId: "original-paid", sourceNodeRunId: "original-run" };
		const first = await prepare(f, "legacy-recovery-member", f.receipt);
		const checkpoint = readResolvedWorkflowReplayCheckpoints(first)[0].checkpoint.outputRefs;
		expect(checkpoint.evidence.replayCheckpoint).toMatchObject({ sourceExecutionId: "legacy-recovery-member" });
		expect(f.leaves(checkpoint)[0].evidence.agentRepairSource).toMatchObject({ sourceExecutionId: "original-paid", sessionKey: workflowAgentSessionKey(f.identity) });
		const second = await prepare(f, "next-recovery-member", checkpoint);
		expect(f.leaves(readResolvedWorkflowReplayCheckpoints(second)[0].checkpoint.outputRefs)[0].evidence.agentRepairSource)
			.toEqual(f.leaves(checkpoint)[0].evidence.agentRepairSource);
	});
	it("keeps a new explicit authorRepair independent of failed sibling paid-review sessions", async () => {
		const f = fixture("each"); const before = structuredClone(f.receipt);
		const prepared = await prepareWorkflowOutputReuse({ flowData: f.flow, flowId: "flow", ownerId: "owner",
			replay: { sourceExecutionId: "original-paid", startFromNodeId: "pipeline", authorRepair: {
				version: 1, sourceNodeRunId: "pipeline-run", sourceKind: "delivery_artifact", idempotencyKey: "explicit-new-author",
				deliveryHash: workflowAuthorDeliveryHash('{"valid":true}'), diagnostic: "Revise the explicitly selected successful delivery.",
				targetPath: [{ kind: "item", itemId: "outer" }, { kind: "step", stepId: "write" }, { kind: "item", itemId: "success" }] } },
			repository: { loadExecutionBundle: async () => ({ flowData: f.flow, nodeRuns: [{ id: "pipeline-run", nodeId: "pipeline", status: "failed", outputRefs: f.receipt }] }) } });
		const checkpoint = readResolvedWorkflowReplayCheckpoints(prepared)[0].checkpoint.outputRefs;
		expect(f.leaves(checkpoint)).toHaveLength(1);
		expect(f.leaves(checkpoint)[0]).toEqual(f.leaves(before)[0]);
		expect(f.leaves(checkpoint)[0].evidence.agentRepairSource).toBeUndefined();
		expect(f.receipt).toEqual(before);
	});
});
import {
	prepareWorkflowOutputReuse,
	readResolvedWorkflowOutputReuses,
	readResolvedWorkflowReplayCheckpoints,
	type WorkflowOutputReuseRepository,
} from "./execution.output-reuse";

describe("bounded author receipt feeding a newly added consumer", () => {
	it("reuses four successful ancestors while retaining project/assets/writer/collect/materialize and excluding image generation", async () => {
		const fixture = boundedReplayFixture();
		const scoped = scopeWorkflowFlowData(fixture.live, "trigger", "pipeline::step::clip-production-nodes-materialize", "project");
		const result = await prepareWorkflowOutputReuse({ flowData: scoped, flowId: "flow", ownerId: "owner", replay: { sourceExecutionId: "author-only", startFromNodeId: "project", requireSuccessfulAncestors: true }, repository: fixture.repository });
		expect(readResolvedWorkflowOutputReuses(result).map(item => item.reuse.sourceNodeRunId).sort()).toEqual(["receipt-author", "receipt-contract", "receipt-source", "receipt-trigger"]);
		const pipeline = (result.nodes as Array<{ id: string; data: { workflowPipeline?: { steps: Array<{ stepId: string }> } } }>).find(n => n.id === "pipeline");
		expect(pipeline?.data.workflowPipeline?.steps.map(step => step.stepId)).toEqual(["clip-production-agent", "clip-production-collect", "clip-production-nodes-materialize"]);
		expect(fixture.source.nodes).toHaveLength(4);
	});
	it("reuses unchanged successful ancestors across whole-DAG publication stamps when downstream authoring changed", async () => {
		const fixture = boundedReplayFixture();
		fixture.source.nodes = structuredClone(fixture.source.nodes);
		for (const node of fixture.source.nodes) Object.assign(node.data, {
			workflowCanvasDefinitionVersion: 124,
			workflowCanvasDefinitionFingerprint: "sha256:fde3346abca9f02222718eb59b62b0020bacb2c646c1ba59f7bbaae66a7b24f3",
		});
		for (const node of fixture.live.nodes) Object.assign(node.data, {
			workflowCanvasDefinitionVersion: 125,
			workflowCanvasDefinitionFingerprint: "sha256:ebbc1951b9034d0226701cca308a0a66d4778e70d933a8fa8505f05428a45a3a",
		});
		fixture.live.nodes.find(node => node.id === "assets")!.data.workflowInstruction = "A newly authored downstream contract";
		const sourceBefore = structuredClone(fixture.source);
		const scoped = scopeWorkflowFlowData(fixture.live, "trigger", "pipeline::step::clip-production-nodes-materialize", "project");
		const result = await prepareWorkflowOutputReuse({ flowData: scoped, flowId: "flow", ownerId: "owner",
			replay: { sourceExecutionId: "author-only", startFromNodeId: "project", requireSuccessfulAncestors: true }, repository: fixture.repository });
		expect(readResolvedWorkflowOutputReuses(result).map(item => item.nodeId).sort()).toEqual(["author", "contract", "source", "trigger"]);
		expect(fixture.source).toEqual(sourceBefore);
		const nodes = result.nodes as Array<{ id: string; data: Record<string, unknown> }>;
		expect(nodes.find(node => node.id === "trigger")!.data.workflowCanvasDefinitionVersion).toBe(125);
		expect(nodes.find(node => node.id === "assets")!.data.workflowInstruction).toBe("A newly authored downstream contract");
	});
	it.each(["prompt", "model", "executor", "schema", "binding"] as const)("still rejects a changed successful ancestor %s across publication stamps", async (change) => {
		const fixture = boundedReplayFixture();
		fixture.source.nodes = structuredClone(fixture.source.nodes);
		for (const node of fixture.source.nodes) Object.assign(node.data, { workflowCanvasDefinitionVersion: 124, workflowCanvasDefinitionFingerprint: "old-publication" });
		for (const node of fixture.live.nodes) Object.assign(node.data, { workflowCanvasDefinitionVersion: 125, workflowCanvasDefinitionFingerprint: "new-publication" });
		const author = fixture.live.nodes.find(node => node.id === "author")!.data;
		if (change === "prompt") author.workflowInstruction = "Changed upstream authoring instruction";
		if (change === "model") author.workflowAgentModelKey = "changed-model";
		if (change === "executor") author.workflowAtomicSpec = { ...(author.workflowAtomicSpec as Record<string, unknown>), executorRef: "changed-executor/v1" };
		if (change === "schema") author.workflowAgentJsonObjectContract = { ...(author.workflowAgentJsonObjectContract as Record<string, unknown>), jsonSchema: { type: "object", required: ["different"] } };
		if (change === "binding") fixture.live.edges.find(edge => edge.target === "author")!.sourceHandle = "out-workflow:different";
		const scoped = scopeWorkflowFlowData(fixture.live, "trigger", "pipeline::step::clip-production-nodes-materialize", "project");
		await expect(prepareWorkflowOutputReuse({ flowData: scoped, flowId: "flow", ownerId: "owner",
			replay: { sourceExecutionId: "author-only", startFromNodeId: "project", requireSuccessfulAncestors: true }, repository: fixture.repository })).rejects.toThrow(change === "binding" ? "upstream connections changed" : "changed since the source execution");
	});

	it("rejects new consumer bindings to an undeclared target or missing durable source port", async () => {
		for (const missing of ["target", "durable"]) {
			const fixture = boundedReplayFixture();
			if (missing === "target") fixture.live.edges.find(e => e.target === "project")!.targetHandle = "in-workflow:undeclared";
			else fixture.nodeRuns.find(r => r.nodeId === "author")!.outputRefs.ports = {};
			await expect(prepareWorkflowOutputReuse({ flowData: fixture.live, flowId: "flow", ownerId: "owner", replay: { sourceExecutionId: "author-only", startFromNodeId: "project", requireSuccessfulAncestors: true }, repository: fixture.repository })).rejects.toThrow("new_consumer_binding_invalid");
		}
	});
});

function node(
	id: string,
	executorRef: string,
	inputPorts: readonly string[],
	outputPorts: readonly string[],
	extraData: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		id,
		type: "taskNode",
		data: {
			kind: id === "trigger" ? "workflowTrigger" : "workflowStage",
			adminWorkflow: true,
			...extraData,
			workflowAtomicSpec: {
				version: 1,
				category: id === "trigger" ? "source" : "control",
				operation: id,
				executorRef,
				executionMode: "once",
				inputPorts,
				outputPorts,
			},
		},
	};
}

function edge(source: string, sourcePort: string, target: string, targetPort: string): Record<string, unknown> {
	return {
		id: `${source}:${target}`,
		source,
		target,
		sourceHandle: `out-workflow:${sourcePort}`,
		targetHandle: `in-workflow:${targetPort}`,
	};
}

function output(nodeId: string, executorRef: string, port: string, value: unknown): WorkflowNodeOutputV1 {
	return {
		protocolVersion: "1",
		executorRef,
		nodeId,
		executionMode: "once",
		ports: { [port]: value },
		artifacts: [],
		evidence: { executorCompleted: true },
		itemRuns: [],
	};
}

function graph(extraPlannerData: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		nodes: [
			node("trigger", "workflow.trigger/v1", [], ["trigger"]),
			node("source", "workflow.input.text/v1", ["trigger"], ["text"], { workflowTextInput: "真实正文" }),
			node("planner", "agents.logical-task/v2", ["text"], ["result"], { workflowInstruction: "拆分", ...extraPlannerData }),
			node("output", "workflow.output/v1", ["result"], ["result"]),
		],
		edges: [
			edge("trigger", "trigger", "source", "trigger"),
			edge("source", "text", "planner", "text"),
			edge("planner", "result", "output", "result"),
		],
	};
}

function pipelineBoundaryGraph(inputPorts: readonly string[], includeAuthorizationEdge: boolean): Record<string, unknown> {
	const pipeline = node("pipeline", "workflow.pipeline.run/v1", inputPorts, ["result"], {
		kind: "workflowStage",
		workflowInputPorts: [...inputPorts],
		workflowOutputPorts: ["result"],
	});
	return {
		nodes: [
			node("trigger", "workflow.trigger/v1", [], ["trigger"]),
			node("segments", "workflow.input.text/v1", ["trigger"], ["text"], { workflowTextInput: "segments" }),
			node("contract", "workflow.input.text/v1", ["trigger"], ["text"], { workflowTextInput: "contract" }),
			node("authorization", "workflow.input.text/v1", ["trigger"], ["text"], { workflowTextInput: "authorization" }),
			pipeline,
			node("output", "workflow.output/v1", ["result"], ["result"]),
		],
		edges: [
			edge("trigger", "trigger", "segments", "trigger"),
			edge("trigger", "trigger", "contract", "trigger"),
			edge("trigger", "trigger", "authorization", "trigger"),
			edge("segments", "text", "pipeline", "segments"),
			edge("contract", "text", "pipeline", "contract"),
			...(includeAuthorizationEdge ? [edge("authorization", "text", "pipeline", "authorization")] : []),
			edge("pipeline", "result", "output", "result"),
		],
	};
}

function pipelineReplayRepository(sourceFlowData: Record<string, unknown>): WorkflowOutputReuseRepository {
	return {
		loadExecutionBundle: vi.fn(async () => ({
			flowData: sourceFlowData,
			nodeRuns: [
				{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
				{ id: "run-segments", nodeId: "segments", status: "success", outputRefs: output("segments", "workflow.input.text/v1", "text", "segments") },
				{ id: "run-contract", nodeId: "contract", status: "success", outputRefs: output("contract", "workflow.input.text/v1", "text", "contract") },
			],
		})),
	};
}

function repository(sourceFlowData: Record<string, unknown>): WorkflowOutputReuseRepository {
	return {
		loadExecutionBundle: vi.fn(async (executionId: string) => executionId === "execution-source"
			? {
				flowData: sourceFlowData,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", { occurredAt: "2026-08-12T00:00:00Z" }) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{ id: "run-planner", nodeId: "planner", status: "success", outputRefs: output("planner", "agents.logical-task/v2", "result", ["片段一", "片段二"]) },
				]
			}
			: null),
	};
}

function failedCollectionPlannerOutput(): Record<string, unknown> {
	return {
		protocolVersion: "1",
		executorRef: "agents.logical-task/v2",
		nodeId: "planner",
		executionMode: "each",
		ports: {},
		artifacts: [],
		evidence: { executorCompleted: false, completedItems: 1, failedItems: 1, totalItems: 2 },
		itemRuns: [
			{
				itemId: "clip-01",
				index: 0,
				status: "success",
				runtimeNodeId: "planner::item::clip-01",
				lineage: [],
				ports: { result: { prompt: "已成功提示词" } },
				artifacts: [],
				evidence: { taskId: "turn-01" },
			},
			{
				itemId: "clip-02",
				index: 1,
				status: "failed",
				runtimeNodeId: "planner::item::clip-02",
				lineage: [],
				ports: {},
				artifacts: [],
				evidence: { taskId: "turn-02" },
				errorCode: "workflow_node_runtime_failed",
				errorMessage: "provider interrupted",
			},
		],
	};
}

function failedCollectionMediaOutput(): Record<string, unknown> {
	return {
		protocolVersion: "1",
		executorRef: "tapcanvas.image.generate/v1",
		nodeId: "planner",
		executionMode: "each",
		ports: {},
		artifacts: [],
		evidence: { executorCompleted: false, completedItems: 1, failedItems: 1, totalItems: 2 },
		itemRuns: [
			{
				itemId: "asset-01",
				index: 0,
				status: "success",
				runtimeNodeId: "planner::item::asset-01",
				lineage: [],
				ports: { image: { imageUrl: "https://assets.example/asset-01.png" } },
				artifacts: [{ type: "tapcanvas.image/v1", identity: "asset-01", value: "https://assets.example/asset-01.png" }],
				evidence: { providerStatus: "success", taskId: "task-01", canvasNodeId: "canvas-01" },
			},
			{
				itemId: "asset-02",
				index: 1,
				status: "failed",
				runtimeNodeId: "planner::item::asset-02",
				lineage: [],
				ports: {},
				artifacts: [],
				evidence: { providerStatus: "failed", taskId: "task-02", canvasNodeId: "canvas-02" },
				errorCode: "workflow_node_runtime_failed",
				errorMessage: "provider receipt failed",
			},
		],
	};
}

function mediaGraph(): Record<string, unknown> {
	const value = graph();
	const nodes = value.nodes as Array<Record<string, unknown>>;
	const planner = nodes.find((candidate) => candidate.id === "planner");
	if (!planner || !planner.data || typeof planner.data !== "object" || Array.isArray(planner.data)) {
		throw new Error("planner fixture missing");
	}
	const data = planner.data as Record<string, unknown>;
	const atomicSpec = data.workflowAtomicSpec;
	if (!atomicSpec || typeof atomicSpec !== "object" || Array.isArray(atomicSpec)) {
		throw new Error("planner atomic spec fixture missing");
	}
	planner.data = {
		...data,
		workflowAtomicSpec: {
			...atomicSpec,
			executorRef: "tapcanvas.image.generate/v1",
			executionMode: "each",
			outputPorts: ["image"],
		},
	};
	return value;
}

describe("workflow durable output reuse", () => {
	it("removes stale physical-run reuse receipts before resolving a new execution", async () => {
		const current = graph();
		const nodes = current.nodes as Array<Record<string, unknown>>;
		const planner = nodes.find((candidate) => candidate.id === "planner");
		if (!planner || !planner.data || typeof planner.data !== "object" || Array.isArray(planner.data)) {
			throw new Error("planner fixture missing");
		}
		planner.data = {
			...planner.data,
			workflowResolvedOutputReuse: {
				version: 1,
				kind: "replay",
				sourceExecutionId: "older-execution",
				sourceNodeRunId: "older-success",
			},
			workflowResolvedReplayCheckpoint: {
				version: 1,
				kind: "replay_checkpoint",
				sourceExecutionId: "older-execution",
				sourceNodeRunId: "older-failure",
			},
		};

		const prepared = await prepareWorkflowOutputReuse({
			flowData: current,
			flowId: "flow-1",
			ownerId: "admin-1",
			repository: repository(graph()),
		});

		expect(readResolvedWorkflowOutputReuses(prepared)).toEqual([]);
		expect(readResolvedWorkflowReplayCheckpoints(prepared)).toEqual([]);
		const preparedPlanner = (prepared.nodes as Array<Record<string, unknown>>)
			.find((candidate) => candidate.id === "planner");
		expect(preparedPlanner?.data).not.toHaveProperty("workflowResolvedOutputReuse");
		expect(preparedPlanner?.data).not.toHaveProperty("workflowResolvedReplayCheckpoint");
	});

	it("resolves a pin only from the exact successful durable node run", async () => {
		const current = graph();
		const nodes = current.nodes as Array<Record<string, unknown>>;
		const planner = nodes.find((candidate) => candidate.id === "planner");
		if (!planner || !planner.data || typeof planner.data !== "object" || Array.isArray(planner.data)) {
			throw new Error("planner fixture missing");
		}
		planner.data = {
			...planner.data,
			workflowPinnedOutputSource: {
				version: 1,
				sourceExecutionId: "execution-source",
				sourceNodeRunId: "run-planner",
			},
		};

		const prepared = await prepareWorkflowOutputReuse({
			flowData: current,
			flowId: "flow-1",
			ownerId: "admin-1",
			repository: repository(graph()),
		});
		const reuses = readResolvedWorkflowOutputReuses(prepared);
		expect(reuses).toHaveLength(1);
		expect(reuses[0]).toMatchObject({
			nodeId: "planner",
			reuse: {
				kind: "pin",
				sourceExecutionId: "execution-source",
				sourceNodeRunId: "run-planner",
				outputRefs: {
					ports: { result: ["片段一", "片段二"] },
					evidence: { outputReuse: { kind: "pin" } },
				},
			},
		});
	});

	it("reuses only strict unchanged ancestors and reruns the selected boundary", async () => {
		const prepared = await prepareWorkflowOutputReuse({
			flowData: graph({ workflowInstruction: "新的拆分方法" }),
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner" },
			repository: repository(graph()),
		});
		const reuses = readResolvedWorkflowOutputReuses(prepared);
		expect(reuses.map(({ nodeId }) => nodeId)).toEqual(["trigger", "source"]);
		expect(reuses.every(({ reuse }) => reuse.kind === "replay")).toBe(true);
	});

	it("projects removed declared inputs at a replay boundary while reusing unchanged ancestors", async () => {
		const sourceGraph = pipelineBoundaryGraph(["segments", "contract", "authorization"], true);
		const currentGraph = pipelineBoundaryGraph(["segments", "contract"], false);
		const prepared = await prepareWorkflowOutputReuse({
			flowData: currentGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "pipeline" },
			repository: pipelineReplayRepository(sourceGraph),
		});

		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"segments",
			"contract",
		]);
	});

	it("still rejects changed connections to retained replay-boundary inputs", async () => {
		const sourceGraph = pipelineBoundaryGraph(["segments", "contract", "authorization"], true);
		const currentGraph = pipelineBoundaryGraph(["segments", "contract"], false);
		const currentEdges = currentGraph.edges as Array<Record<string, unknown>>;
		const retainedEdge = currentEdges.find((candidate) => candidate.id === "contract:pipeline");
		if (!retainedEdge) throw new Error("retained contract edge missing");
		retainedEdge.source = "segments";
		await expect(prepareWorkflowOutputReuse({
			flowData: currentGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "pipeline" },
			repository: pipelineReplayRepository(sourceGraph),
		})).rejects.toThrow(/upstream connections changed/u);
	});

	it("treats skipped ancestors as a rerun frontier instead of a reusable-output protocol error", async () => {
		const sourceGraph = graph();
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{ id: "run-planner", nodeId: "planner", status: "skipped", outputRefs: null },
					{ id: "run-output", nodeId: "output", status: "failed", outputRefs: null },
				],
			})),
		};

		const prepared = await prepareWorkflowOutputReuse({
			flowData: sourceGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "output" },
			repository: sourceRepository,
		});

		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"source",
		]);
		expect(readResolvedWorkflowReplayCheckpoints(prepared)).toEqual([]);
	});

	it("reuses delivered artifacts without reapplying the compact authoring schema", async () => {
		const sourceGraph = graph({
			workflowAgentOutputArtifactType: "tapcanvas.beat-sheet/v2",
			workflowAgentOutputEncoding: "json_object",
			workflowAgentJsonObjectContract: {
				requiredStringFields: ["protocolVersion"],
				requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
				requiredArrayFields: ["beats"],
				arrayItemRequiredNonEmptyStringArrayFields: { beats: ["characters"] },
				allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
			},
		});
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{
						id: "run-planner",
						nodeId: "planner",
						status: "success",
						outputRefs: output("planner", "agents.logical-task/v2", "result", {
							taskId: "agent-turn-1",
							text: JSON.stringify({
								protocolVersion: "tapcanvas.beat-sheet/v2",
								sourceCoveragePlan: { speechLedger: [] },
								sourceFidelityAudit: { sourceBeatLedger: [] },
								beats: [{ clipId: "beat-0" }],
							}),
						}),
					},
				],
			})),
		};

		const prepared = await prepareWorkflowOutputReuse({
			flowData: sourceGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "output" },
			repository: sourceRepository,
		});

		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"source",
			"planner",
		]);
		expect(readResolvedWorkflowReplayCheckpoints(prepared)).toEqual([]);
	});

	it("never patches frozen exact string facts in a historical Agent output", async () => {
		const sourceGraph = graph({
			workflowAgentOutputArtifactType: "example.typed-plan/v1",
			workflowAgentOutputEncoding: "json_object",
			workflowAgentJsonObjectContract: {
				requiredStringFields: ["protocolVersion", "plan"],
				exactStringFields: { protocolVersion: "current/v2" },
				allowedFields: ["protocolVersion", "plan"],
			},
		});
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{
						id: "run-planner",
						nodeId: "planner",
						status: "success",
						outputRefs: output("planner", "agents.logical-task/v2", "result", {
							taskId: "agent-turn-1",
							text: JSON.stringify({ protocolVersion: "legacy/v1", plan: "保留创作内容" }),
						}),
					},
				],
			})),
		};

		const prepared = await prepareWorkflowOutputReuse({
			flowData: sourceGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "output" },
			repository: sourceRepository,
		});

		const plannerReuse = readResolvedWorkflowOutputReuses(prepared)
			.find(({ nodeId }) => nodeId === "planner");
		expect(plannerReuse?.reuse.outputRefs.ports.result).toMatchObject({ text: JSON.stringify({ protocolVersion: "legacy/v1", plan: "保留创作内容" }) });
		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"source",
			"planner",
		]);
		expect(readResolvedWorkflowReplayCheckpoints(prepared)).toEqual([]);
	});

	it("revalidates each-mode Agent collection items without invalidating paid descendants", async () => {
		const sourceGraph = graph({
			workflowAgentOutputArtifactType: "example.clip/v1",
			workflowAgentOutputEncoding: "json_object",
			workflowAgentJsonObjectContract: {
				requiredStringFields: ["prompt"],
				allowedFields: ["prompt"],
			},
		});
		const nodes = sourceGraph.nodes as Array<Record<string, unknown>>;
		const planner = nodes.find((candidate) => candidate.id === "planner");
		const plannerData = planner?.data as Record<string, unknown>;
		plannerData.workflowAtomicSpec = {
			...(plannerData.workflowAtomicSpec as Record<string, unknown>),
			executionMode: "each",
		};
		const eachOutput = {
			protocolVersion: "1",
			executorRef: "agents.logical-task/v2",
			nodeId: "planner",
			executionMode: "each",
			ports: {
				result: {
					protocolVersion: "workflow.collection/v1",
					collectionId: "clips",
					items: [
						{ itemId: "clip-0", index: 0, value: { text: JSON.stringify({ prompt: "镜头一" }) }, lineage: [] },
						{ itemId: "clip-1", index: 1, value: { text: JSON.stringify({ prompt: "镜头二" }) }, lineage: [] },
					],
				},
			},
			artifacts: [],
			evidence: { executorCompleted: true },
			itemRuns: [],
		};
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{ id: "run-planner", nodeId: "planner", status: "success", outputRefs: eachOutput },
				],
			})),
		};

		const prepared = await prepareWorkflowOutputReuse({
			flowData: sourceGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "output" },
			repository: sourceRepository,
		});

		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"source",
			"planner",
		]);
		expect(readResolvedWorkflowReplayCheckpoints(prepared)).toEqual([]);
	});

	it("preserves every item receipt from an unchanged failed collection boundary", async () => {
		const sourceGraph = graph();
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{ id: "run-planner", nodeId: "planner", status: "failed", outputRefs: failedCollectionPlannerOutput() },
				],
			})),
		};
		const prepared = await prepareWorkflowOutputReuse({
			flowData: graph(),
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner" },
			repository: sourceRepository,
		});

		const checkpoints = readResolvedWorkflowReplayCheckpoints(prepared);
		expect(checkpoints).toHaveLength(1);
		expect(checkpoints[0]).toMatchObject({
			nodeId: "planner",
			checkpoint: {
				kind: "replay_checkpoint",
				outputRefs: {
					itemRuns: [
						{ itemId: "clip-01", status: "success" },
						{ itemId: "clip-02", status: "failed" },
					],
					evidence: {
						executorCompleted: false,
						completedItems: 1,
						failedItems: 1,
						replayCheckpoint: { sourceExecutionId: "execution-source" },
					},
				},
			},
		});
	});

	it("preserves successful inline pipeline stages when a later stage fails", async () => {
		const sourceGraph = graph();
		const planner = (sourceGraph.nodes as Array<Record<string, unknown>>).find((candidate) => candidate.id === "planner")!;
		(planner.data as Record<string, unknown>).workflowAtomicSpec = {
			version: 1, category: "control", operation: "planner", executorRef: "workflow.pipeline.run/v1",
			executionMode: "once", inputPorts: ["text"], outputPorts: ["result"],
		};
		const failedPipeline = {
			...output("planner", "workflow.pipeline.run/v1", "result", null),
			ports: {},
			evidence: { executorCompleted: false, pipelineState: {
				protocolVersion: "workflow.pipeline.state/v1", cursorStepId: "materialize", updatedAt: new Date().toISOString(),
				steps: {
					author: { status: "success", outputRefs: output("planner::author", "agents.logical-task/v2", "result", ["clip-1"]) },
					materialize: { status: "failed", errorCode: "workflow_node_runtime_failed" },
				},
			} },
		};
		const repository: WorkflowOutputReuseRepository = { loadExecutionBundle: vi.fn(async () => ({
			flowData: sourceGraph,
			nodeRuns: [
				{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
				{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
				{ id: "run-planner", nodeId: "planner", status: "failed", outputRefs: failedPipeline },
			],
		})) };
		const prepared = await prepareWorkflowOutputReuse({
			flowData: sourceGraph, flowId: "flow-1", ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner" }, repository,
		});
		expect(readResolvedWorkflowReplayCheckpoints(prepared)).toMatchObject([{
			nodeId: "planner", checkpoint: { outputRefs: {
				ports: {}, evidence: { executorCompleted: false, pipelineState: { steps: { author: { status: "success" } } } },
			} },
		}]);
	});

	it("replays only an authorized failed item even when its collection was marked successful", async () => {
		const sourceGraph = mediaGraph();
		const media = failedCollectionMediaOutput();
		const repository: WorkflowOutputReuseRepository = { loadExecutionBundle: vi.fn(async () => ({
			flowData: sourceGraph, nodeRuns: [
				{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
				{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "source") },
				{ id: "run-images", nodeId: "planner", status: "success", outputRefs: media },
			],
		})) };
		const prepared = await prepareWorkflowOutputReuse({
			flowData: { ...mediaGraph(), workflowMediaRetrySourceExecutionId: "source-execution", workflowMediaRetries: [{
				nodeId: "planner", itemId: "asset-02", taskId: "task-02", canvasNodeId: "canvas-02", retryKey: "authorized-key",
				executorRef: "tapcanvas.image.generate/v1", executionMode: "each",
			}] }, flowId: "flow-1", ownerId: "owner-1", repository,
			replay: { sourceExecutionId: "source-execution", startFromNodeId: "planner", scope: "recovery_snapshot", invalidatedNodeIds: ["planner"] },
		});
		const checkpoint = readResolvedWorkflowReplayCheckpoints(prepared)[0].checkpoint.outputRefs;
		expect(checkpoint.itemRuns.map((item) => item.itemId)).toEqual(["asset-01"]);
		expect((media.itemRuns as Array<{ itemId: string }>).map((item) => item.itemId)).toEqual(["asset-01", "asset-02"]);
	});

	it("keeps an exact failed media receipt beside successful items without authorizing a new submission", async () => {
		const sourceGraph = mediaGraph();
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{ id: "run-planner", nodeId: "planner", status: "failed", outputRefs: failedCollectionMediaOutput() },
				],
			})),
		};
		const prepared = await prepareWorkflowOutputReuse({
			flowData: mediaGraph(),
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner" },
			repository: sourceRepository,
		});

		const checkpoints = readResolvedWorkflowReplayCheckpoints(prepared);
		expect(checkpoints).toHaveLength(1);
		expect(checkpoints[0]).toMatchObject({
			nodeId: "planner",
			checkpoint: {
				outputRefs: {
					itemRuns: [
						{ itemId: "asset-01", status: "success" },
						{ itemId: "asset-02", status: "failed", evidence: { providerStatus: "failed", taskId: "task-02", canvasNodeId: "canvas-02" } },
					],
					evidence: { completedItems: 1, failedItems: 1, settledItems: 2 },
				},
			},
		});
	});

	it("freezes successful parallel branches and accepted media receipts for execution-family recovery", async () => {
		const sourceGraph = {
			nodes: [
				node("trigger", "workflow.trigger/v1", [], ["trigger"]),
				node("source", "workflow.input.text/v1", ["trigger"], ["text"]),
				node("writer", "agents.logical-task/v2", ["text"], ["result"]),
				node("asset-plan", "workflow.transform/v1", ["text"], ["plans"]),
				node("asset-image", "tapcanvas.image.generate/v1", ["plans"], ["image"]),
				node("output", "workflow.output/v1", ["result", "image"], ["result"]),
			],
			edges: [
				edge("trigger", "trigger", "source", "trigger"),
				edge("source", "text", "writer", "text"),
				edge("source", "text", "asset-plan", "text"),
				edge("asset-plan", "plans", "asset-image", "plans"),
				edge("writer", "result", "output", "result"),
				edge("asset-image", "image", "output", "image"),
			],
		};
		const graphNodes = sourceGraph.nodes as Array<Record<string, unknown>>;
		for (const nodeId of ["writer", "asset-image"]) {
			const graphNode = graphNodes.find((candidate) => candidate.id === nodeId);
			const graphNodeData = graphNode?.data as Record<string, unknown> | undefined;
			if (!graphNodeData || !graphNodeData.workflowAtomicSpec || typeof graphNodeData.workflowAtomicSpec !== "object") {
				throw new Error(`fixture node ${nodeId} missing atomic spec`);
			}
			graphNodeData.workflowAtomicSpec = {
				...(graphNodeData.workflowAtomicSpec as Record<string, unknown>),
				executionMode: "each",
			};
		}
		const writerFailure = {
			...failedCollectionPlannerOutput(),
			nodeId: "writer",
			itemRuns: failedCollectionPlannerOutput().itemRuns instanceof Array
				? (failedCollectionPlannerOutput().itemRuns as Array<Record<string, unknown>>).map((itemRun) => ({
					...itemRun,
					runtimeNodeId: String(itemRun.runtimeNodeId).replace("planner", "writer"),
				}))
				: [],
		};
		const imageCheckpoint = {
			protocolVersion: "1",
			executorRef: "tapcanvas.image.generate/v1",
			nodeId: "asset-image",
			executionMode: "each",
			ports: {},
			artifacts: [],
			evidence: { executorCompleted: false, completedItems: 0, failedItems: 0, waitingItems: 1, totalItems: 1 },
			itemRuns: [{
				itemId: "asset-character-01",
				index: 0,
				status: "waiting_external",
				runtimeNodeId: "asset-image::item::asset-character-01",
				lineage: [],
				ports: {},
				artifacts: [],
				evidence: { providerStatus: "processing", taskId: "paid-task-01", canvasNodeId: "canvas-image-01" },
				externalCheck: { version: 1, mode: "signal_only" },
			}],
			externalCheck: { version: 1, mode: "signal_only" },
		};
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{ id: "run-writer", nodeId: "writer", status: "failed", outputRefs: writerFailure },
					{ id: "run-asset-plan", nodeId: "asset-plan", status: "success", outputRefs: output("asset-plan", "workflow.transform/v1", "plans", [{ itemId: "asset-character-01" }]) },
					{ id: "run-asset-image", nodeId: "asset-image", status: "canceled", outputRefs: imageCheckpoint },
					{ id: "run-output", nodeId: "output", status: "skipped", outputRefs: null },
				],
			})),
		};

		const prepared = await prepareWorkflowOutputReuse({
			flowData: sourceGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: {
				sourceExecutionId: "execution-source",
				startFromNodeId: "writer",
				scope: "recovery_snapshot",
			},
			repository: sourceRepository,
		});

		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"source",
			"asset-plan",
		]);
		const checkpoints = readResolvedWorkflowReplayCheckpoints(prepared);
		expect(checkpoints.map(({ nodeId }) => nodeId)).toEqual(["writer", "asset-image"]);
		const acceptedMedia = checkpoints.find(({ nodeId }) => nodeId === "asset-image");
		expect(acceptedMedia?.checkpoint.outputRefs).toMatchObject({
			externalCheck: { version: 1, mode: "signal_only" },
			evidence: { waitingItems: 1 },
			itemRuns: [{
				itemId: "asset-character-01",
				status: "waiting_external",
				evidence: { taskId: "paid-task-01", canvasNodeId: "canvas-image-01" },
			}],
		});
	});

	it("refuses boundary item reuse when the boundary node data changed", async () => {
		const sourceGraph = graph();
		const sourceRepository: WorkflowOutputReuseRepository = {
			loadExecutionBundle: vi.fn(async () => ({
				flowData: sourceGraph,
				nodeRuns: [
					{ id: "run-trigger", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", "trigger", {}) },
					{ id: "run-source", nodeId: "source", status: "success", outputRefs: output("source", "workflow.input.text/v1", "text", "真实正文") },
					{ id: "run-planner", nodeId: "planner", status: "failed", outputRefs: failedCollectionPlannerOutput() },
				],
			})),
		};
		const prepared = await prepareWorkflowOutputReuse({
			flowData: graph({ workflowInstruction: "用户已经修改节点配置" }),
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner" },
			repository: sourceRepository,
		});

		expect(readResolvedWorkflowReplayCheckpoints(prepared)).toEqual([]);
	});

	it("rejects replay when an upstream executor input changed", async () => {
		const current = graph();
		const nodes = current.nodes as Array<Record<string, unknown>>;
		const source = nodes.find((candidate) => candidate.id === "source");
		if (!source || !source.data || typeof source.data !== "object" || Array.isArray(source.data)) {
			throw new Error("source fixture missing");
		}
		source.data = { ...source.data, workflowTextInput: "已经改过的正文" };
		await expect(prepareWorkflowOutputReuse({
			flowData: current,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner" },
			repository: repository(graph()),
		})).rejects.toThrow(/upstream node source changed/u);
	});

	it("does not ignore runtime-shaped keys inside nested executor configuration", async () => {
		const sourceGraph = graph();
		const sourceNodes = sourceGraph.nodes as Array<Record<string, unknown>>;
		const source = sourceNodes.find((candidate) => candidate.id === "source");
		if (!source || !source.data || typeof source.data !== "object" || Array.isArray(source.data)) {
			throw new Error("source fixture missing");
		}
		source.data = { ...source.data, workflowInputConfig: { status: "draft" } };

		const currentGraph = graph();
		const currentNodes = currentGraph.nodes as Array<Record<string, unknown>>;
		const currentSource = currentNodes.find((candidate) => candidate.id === "source");
		if (!currentSource || !currentSource.data || typeof currentSource.data !== "object" || Array.isArray(currentSource.data)) {
			throw new Error("source fixture missing");
		}
		currentSource.data = { ...currentSource.data, workflowInputConfig: { status: "published" } };

		await expect(prepareWorkflowOutputReuse({
			flowData: currentGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner" },
			repository: repository(sourceGraph),
		})).rejects.toThrow(/upstream node source changed/u);
	});

	it("rejects a pin that names another node's run", async () => {
		const current = graph();
		const nodes = current.nodes as Array<Record<string, unknown>>;
		const planner = nodes.find((candidate) => candidate.id === "planner");
		if (!planner || !planner.data || typeof planner.data !== "object" || Array.isArray(planner.data)) {
			throw new Error("planner fixture missing");
		}
		planner.data = {
			...planner.data,
			workflowPinnedOutputSource: {
				version: 1,
				sourceExecutionId: "execution-source",
				sourceNodeRunId: "run-source",
			},
		};
		await expect(prepareWorkflowOutputReuse({
			flowData: current,
			flowId: "flow-1",
			ownerId: "admin-1",
			repository: repository(graph()),
		})).rejects.toThrow(/does not belong to workflow node planner/u);
	});

	it("invalidates every explicit dirty frontier and its descendants in a recovery snapshot", async () => {
		const sourceGraph = graph();
		const prepared = await prepareWorkflowOutputReuse({
			flowData: sourceGraph,
			flowId: "flow-1",
			ownerId: "admin-1",
			replay: {
				sourceExecutionId: "execution-source",
				startFromNodeId: "output",
				invalidatedNodeIds: ["planner"],
				scope: "recovery_snapshot",
			},
			repository: repository(sourceGraph),
		});

		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"source",
		]);
		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).not.toContain("planner");
	});
});

it.each([false, true])("reuses a once-Agent draft only under the same frozen contract (changed=%s)", async (changed) => {
 const sourceFlowData = graph();
 const flowData = changed ? graph({ workflowInstruction: "A new authoring contract" }) : sourceFlowData;
 const repair = { version: 1, sourceTurnId: "turn-source", candidate: '{"authored":"kept"}', error: "required field absent" };
 const prepared = await prepareWorkflowOutputReuse({ flowData, flowId: "flow-1", ownerId: "admin-1",
  replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner", scope: "recovery_snapshot", invalidatedNodeIds: ["planner"] },
  repository: { loadExecutionBundle: async () => ({ flowData: sourceFlowData, nodeRuns: [
   { id: "run-planner", nodeId: "planner", status: "failed", outputRefs: {
    ...output("planner", "agents.logical-task/v2", "result", "unverified"),
    evidence: { executorCompleted: false, outputRepair: repair, deliveryEvidence: { sessionKey: "old-session" } },
   } },
  ] }) },
 });
 const checkpoints = readResolvedWorkflowReplayCheckpoints(prepared);
 expect(checkpoints).toHaveLength(changed ? 0 : 1);
 if (changed) return;
 expect(checkpoints[0].checkpoint.outputRefs.ports).toEqual({});
 expect(checkpoints[0].checkpoint.outputRefs.evidence.outputRepair).toEqual(repair);
 expect(readResolvedWorkflowOutputReuses(prepared)).toEqual([]);
});


it.each([false, true])("retains a historical accepted author candidate only under its unchanged frozen recovery graph (changed=%s)", async (changed) => {
 const sourceFlowData = graph({ workflowAgentOutputEncoding: "json_object" });
 const flowData = changed ? graph({ workflowInstruction: "new task", workflowAgentOutputEncoding: "json_object" }) : sourceFlowData;
 const identity = { executionId: "execution-source", nodeId: "planner", physicalRetryOrdinal: null };
 const taskId = workflowAgentPublicTurnId(identity), turnId = "harness-turn";
 const candidate = '{"scene":{"cast":[]}}', candidateHash = authorSourceTextHash(candidate);
 const contract = { kind: "json", jsonSchema: { type: "object" } }, contractHash = authorSourceJsonHash(contract);
 const accepted = { version: 1, representation: AUTHOR_SOURCE_REPRESENTATION,
  identity: { taskId, sessionId: workflowAgentSessionKey(identity), turnId }, candidate, candidateHash,
  authorContract: { ref: `${turnId}#/acceptedAuthorSource/authorContract/value`, value: contract, hash: contractHash },
  acceptance: { kind: "harness_accepted_candidate", receiptRef: turnId, candidateHash, authorContractHash: contractHash },
  sourceContext: { value: "frozen original input", hash: authorSourceTextHash("frozen original input") } };
 const saved = { ...output("planner", "agents.logical-task/v2", "result", { text: candidate, acceptedAuthorSource: accepted }),
  evidence: { taskId, executorCompleted: false, outputContractFailure: { code: "structured_output_invalid", message: "layout rejected" } } };
 const before = structuredClone(saved);
 const prepared = await prepareWorkflowOutputReuse({ flowData, flowId: "flow-1", ownerId: "admin-1",
  replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner", scope: "recovery_snapshot", invalidatedNodeIds: ["planner"] },
  repository: { loadExecutionBundle: async () => ({ flowData: sourceFlowData, nodeRuns: [{ id: "original-run", nodeId: "planner", status: "failed", outputRefs: saved }] }) },
 });
 const checkpoints = readResolvedWorkflowReplayCheckpoints(prepared);
 expect(checkpoints).toHaveLength(changed ? 0 : 1);
 if (!changed) {
  const receipt = checkpoints[0].checkpoint.outputRefs;
  expect(readWorkflowAcceptedAuthorRecovery(receipt.evidence)).toMatchObject({ sourceExecutionId: "execution-source", sourceNodeRunId: "original-run", acceptedAuthorSource: accepted });
  expect(receipt.ports).toEqual(saved.ports); expect(receipt.evidence.executorCompleted).toBe(false);
 }
 expect(readResolvedWorkflowOutputReuses(prepared)).toEqual([]);
 expect(saved).toEqual(before);
});

it.each([false, true])("hands off an inactive once-Agent checkpoint without host-submitted output (changed=%s)", async (changed) => {
 const sourceFlowData = graph({ workflowAgentOutputEncoding: "json_object" });
 const flowData = changed ? graph({ workflowInstruction: "changed", workflowAgentOutputEncoding: "json_object" }) : sourceFlowData;
 const identity = { executionId: "execution-source", nodeId: "planner", physicalRetryOrdinal: null };
 const source = { sessionKey: workflowAgentSessionKey(identity), turnId: workflowAgentPublicTurnId(identity) };
 const prepared = await prepareWorkflowOutputReuse({ flowData, flowId: "flow-1", ownerId: "admin-1",
  replay: { sourceExecutionId: "execution-source", startFromNodeId: "planner", scope: "recovery_snapshot", invalidatedNodeIds: ["planner"] },
  repository: { loadExecutionBundle: async () => ({ flowData: sourceFlowData, nodeRuns: [
   { id: "run-planner", nodeId: "planner", status: "failed", outputRefs: {
    ...output("planner", "agents.logical-task/v2", "result", ""),
    evidence: { executorCompleted: false, deliveryEvidence: { sessionKey: source.sessionKey,
      logicalTaskId: source.turnId, recoveryCheckpoint: { physicalRunId: "old-physical" } } },
   } },
  ] }) },
 });
 const checkpoints = readResolvedWorkflowReplayCheckpoints(prepared);
 expect(checkpoints).toHaveLength(changed ? 0 : 1);
 if (!changed) {
  expect(checkpoints[0].checkpoint.outputRefs.evidence.agentRepairSource).toEqual({ ...source, sourceExecutionId: "execution-source" });
  expect(checkpoints[0].checkpoint.outputRefs.ports).toEqual({});
 }
});

it("projects nested media adoption into its owner pipeline checkpoint without losing sibling receipts", async () => {
	const scopeId = "pipeline::item::clip%3A0";
	const nestedNodeId = `${scopeId}::step::generate`;
	const sharedItemId = "effect:shared";
	const adoption = { nodeId: nestedNodeId, itemId: sharedItemId, assetId: "verified-image" };
	const mediaOutput = {
		protocolVersion: "1", executorRef: "tapcanvas.image.generate/v1", nodeId: nestedNodeId,
		executionMode: "each", ports: {}, artifacts: [], evidence: { executorCompleted: true },
		itemRuns: [
			{ itemId: sharedItemId, index: 0, status: "success", runtimeNodeId: `${nestedNodeId}::item::${encodeURIComponent(sharedItemId)}`,
				lineage: [], ports: {}, artifacts: [{ type: "tapcanvas.image/v1", identity: "old-image", value: "https://assets.example/old.png" }], evidence: { taskId: "paid-old-image" } },
			{ itemId: "effect:other", index: 1, status: "success", runtimeNodeId: `${nestedNodeId}::item::effect%3Aother`,
				lineage: [], ports: {}, artifacts: [{ type: "tapcanvas.image/v1", identity: "sibling-image", value: "https://assets.example/sibling.png" }], evidence: { taskId: "paid-sibling-image" } },
		],
	};
	const pipelineNode = {
		id: "pipeline", type: "taskNode", data: {
			kind: "workflowStage",
			workflowAtomicSpec: { version: 1, category: "control", operation: "pipeline", executorRef: "workflow.pipeline.run/v1",
				executionMode: "each", inputPorts: ["assets"], outputPorts: ["images"] },
			workflowPipeline: {
				protocolVersion: "workflow.pipeline.run/v1",
				inputs: [{ portId: "assets", mode: "collection", artifactTypes: [] }],
				bindings: [{ from: { kind: "input", portId: "assets" }, to: { stepId: "generate", portId: "assets" }, mode: "collection" }],
				outputs: [{ portId: "images", from: { stepId: "generate", portId: "images" }, mode: "collection" }],
				steps: [{ stepId: "generate", node: { id: "generate", type: "taskNode", kind: "workflowStage", data: {
					workflowAtomicSpec: { version: 1, category: "media", operation: "generate", executorRef: "tapcanvas.image.generate/v1",
						executionMode: "each", inputPorts: ["assets"], outputPorts: ["images"] },
				} } }],
			},
		},
	};
	const sourceGraph = { nodes: [pipelineNode], edges: [] };
	const ownerOutput = {
		protocolVersion: "1", executorRef: "workflow.pipeline.run/v1", nodeId: "pipeline", executionMode: "each",
		ports: {}, artifacts: [], evidence: { executorCompleted: true },
		itemRuns: [{ itemId: "clip:0", index: 0, status: "success", runtimeNodeId: scopeId, lineage: [], ports: {}, artifacts: [],
			evidence: { pipelineState: { protocolVersion: "workflow.pipeline.state/v1", cursorStepId: null,
				steps: { generate: { status: "success", outputRefs: mediaOutput } }, updatedAt: "2026-09-29T00:00:00.000Z" } } }],
	};
	const flowData = { ...sourceGraph, workflowMediaAdoptions: [adoption],
		workflowMediaAdoptionSourceExecutionId: "execution-source" };
	const prepared = await prepareWorkflowOutputReuse({
		flowData,
		flowId: "flow-1",
		ownerId: "admin-1",
		replay: { sourceExecutionId: "execution-source", startFromNodeId: "pipeline", invalidatedNodeIds: ["pipeline"], scope: "recovery_snapshot" },
		repository: { loadExecutionBundle: async () => ({ flowData: sourceGraph,
			nodeRuns: [{ id: "run-pipeline", nodeId: "pipeline", status: "success", outputRefs: ownerOutput }] }) },
	});

	const checkpoint = readResolvedWorkflowReplayCheckpoints(prepared).find((item) => item.nodeId === "pipeline")?.checkpoint.outputRefs;
	expect(checkpoint?.itemRuns[0]?.status).toBe("success");
	const state = checkpoint?.itemRuns[0]?.evidence.pipelineState as Record<string, unknown>;
	const steps = state.steps as Record<string, Record<string, unknown>>;
	expect(steps.generate?.status).toBe("failed");
	const savedMedia = steps.generate?.outputRefs as WorkflowNodeOutputV1;
	expect(savedMedia.itemRuns.map((item) => item.itemId)).toEqual(["effect:other"]);
	expect(savedMedia.itemRuns[0]?.evidence.taskId).toBe("paid-sibling-image");
	expect(savedMedia.evidence.mediaAdoptionCheckpoint).toMatchObject({
		protocolVersion: "workflow.media-adoption-checkpoint/v1", adoptedItemIds: [sharedItemId],
	});
});
