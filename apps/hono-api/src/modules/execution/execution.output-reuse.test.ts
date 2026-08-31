import { describe, expect, it, vi } from "vitest";
import {
	prepareWorkflowOutputReuse,
	readResolvedWorkflowOutputReuses,
	readResolvedWorkflowReplayCheckpoints,
	type WorkflowOutputReuseRepository,
} from "./execution.output-reuse";

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

function output(nodeId: string, executorRef: string, port: string, value: unknown): Record<string, unknown> {
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

	it("revalidates a successful Agent ancestor against the current contract before reuse", async () => {
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
		expect(plannerReuse).toBeUndefined();
		expect(readResolvedWorkflowOutputReuses(prepared).map(({ nodeId }) => nodeId)).toEqual([
			"trigger",
			"source",
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
