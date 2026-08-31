import { describe, expect, it } from "vitest";
import {
	findWorkflowNode,
	inspectWorkflowExecutionSupport,
	parseWorkflowNodeOutputV1,
	parseWorkflowNodes,
	resolveWorkflowNodeExecutorRef,
	resolveWorkflowNodeItemConcurrency,
	workflowNodeExecutionFailure,
} from "./execution.node-runtime";

function flow(nodes: unknown[]): string {
	return JSON.stringify({ nodes, edges: [] });
}

describe("workflow execution node runtime", () => {
	it("parses the persisted JSON flow instead of treating the DB string as an object", () => {
		expect(
			parseWorkflowNodes(
				flow([
					{
						id: "output-1",
						type: "taskNode",
						data: { kind: "workflowOutput" },
					},
				]),
			),
		).toEqual([
			{
				id: "output-1",
				type: "taskNode",
				kind: "workflowOutput",
				data: { kind: "workflowOutput" },
			},
		]);
	});

	it("accepts registered structural executors", () => {
		const support = inspectWorkflowExecutionSupport(
			flow([
				{ id: "group-1", type: "groupNode", data: {} },
				{ id: "input-1", type: "taskNode", data: { kind: "workflowInput" } },
				{ id: "text-1", type: "taskNode", data: { kind: "text" } },
				{
					id: "reference-1",
					type: "taskNode",
					data: { kind: "image", skipDagRun: true },
				},
				{ id: "output-1", type: "taskNode", data: { kind: "workflowOutput" } },
			]),
		);

		expect(support.hasWorkflowOutput).toBe(true);
		expect(support.unsupportedNodes).toEqual([]);
		expect(workflowNodeExecutionFailure(support.nodes[1]!)).toBeNull();
		expect(resolveWorkflowNodeExecutorRef(support.nodes[1]!)).toBe("workflow.input/v1");
	});

	it("accepts the asset-plan fan-out executor used by the media workflow", () => {
		const support = inspectWorkflowExecutionSupport(
			flow([
				{
					id: "asset-fan-out",
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: {
							version: 1,
							category: "control",
							operation: "asset_fan_out",
							executorRef: "video.asset-plans.split/v1",
							executionMode: "once",
							inputPorts: ["asset-plans", "beat-sheet"],
							outputPorts: ["asset-items"],
						},
					},
				},
			]),
		);

		expect(support.unsupportedNodes).toEqual([]);
		expect(resolveWorkflowNodeExecutorRef(support.nodes[0]!)).toBe("video.asset-plans.split/v1");
	});

	it("reports every executable media node that lacks a real handler", () => {
		const support = inspectWorkflowExecutionSupport(
			flow([
				{ id: "image-1", type: "taskNode", data: { kind: "image" } },
				{ id: "video-1", type: "taskNode", data: { kind: "video" } },
				{ id: "output-1", type: "taskNode", data: { kind: "workflowOutput" } },
			]),
		);

		expect(support.unsupportedNodes).toEqual([
			{
				nodeId: "image-1",
				kind: "image",
				reason: "executor_not_registered",
			},
			{
				nodeId: "video-1",
				kind: "video",
				reason: "executor_not_registered",
			},
		]);
		expect(workflowNodeExecutionFailure(support.nodes[0]!)).toEqual({
			ok: false,
			errorCode: "workflow_node_executor_missing",
			errorMessage:
				'Workflow node kind "image" has no registered server executor (nodeId=image-1)',
		});
	});

	it("distinguishes prompt-not-ready and missing-kind failures", () => {
		const support = inspectWorkflowExecutionSupport(
			flow([
				{
					id: "draft-1",
					type: "taskNode",
					data: { kind: "image", promptNeedsFill: true },
				},
				{ id: "kindless-1", type: "taskNode", data: {} },
				{ id: "output-1", type: "taskNode", data: { kind: "workflowOutput" } },
			]),
		);

		expect(support.unsupportedNodes).toEqual([
			{ nodeId: "draft-1", kind: "image", reason: "prompt_not_ready" },
			{ nodeId: "kindless-1", kind: "unknown", reason: "kind_missing" },
		]);
	});

	it("fails explicitly for malformed graphs and missing immutable nodes", () => {
		expect(() => parseWorkflowNodes("not-json")).toThrow(/not valid JSON/u);
		expect(() => parseWorkflowNodes(JSON.stringify({ edges: [] }))).toThrow(
			/nodes array/u,
		);
		expect(() =>
			findWorkflowNode(flow([]), "missing-node"),
		).toThrow(/does not exist in the immutable flow version/u);
	});

	it("accepts only complete persisted node outputs for external resume", () => {
		const output = {
			protocolVersion: "1",
			executorRef: "tapcanvas.video.generate/v1",
			nodeId: "video-1",
			executionMode: "each",
			ports: {},
			artifacts: [],
			evidence: { executorCompleted: false },
			itemRuns: [{
				itemId: "segment-1",
				index: 0,
				status: "waiting_external",
				runtimeNodeId: "video-1::item::segment-1",
				lineage: [{ nodeId: "split-1", portId: "items", itemId: "segment-1", index: 0 }],
				ports: {},
				artifacts: [],
				evidence: { canvasNodeId: "output-video-1", taskId: "provider-task-1" },
			}],
		};

		expect(parseWorkflowNodeOutputV1(JSON.stringify(output))).toEqual(output);
		expect(parseWorkflowNodeOutputV1(null)).toBeNull();
		expect(() => parseWorkflowNodeOutputV1({ ...output, itemRuns: [{ status: "waiting_external" }] })).toThrow(/itemRuns\[0\]/u);
	});

	it("defaults each-item concurrency to one and rejects out-of-contract values", () => {
		const base = {
			id: "agent-each",
			type: "taskNode",
			kind: "workflowStage",
			data: { workflowAtomicSpec: { executionMode: "each" } },
		};
		expect(resolveWorkflowNodeItemConcurrency(base)).toBe(1);
		expect(resolveWorkflowNodeItemConcurrency({
			...base,
			data: { workflowAtomicSpec: { executionMode: "each", itemConcurrency: 3 } },
		})).toBe(3);
		expect(resolveWorkflowNodeItemConcurrency({
			...base,
			data: { workflowAtomicSpec: { executionMode: "each", itemConcurrency: 16 } },
		})).toBe(16);
		expect(() => resolveWorkflowNodeItemConcurrency({
			...base,
			data: { workflowAtomicSpec: { executionMode: "each", itemConcurrency: 17 } },
		})).toThrow(/integer between 1 and 16/u);
	});
});
