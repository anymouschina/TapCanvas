import { describe, expect, it } from "vitest";
import { scopeWorkflowFlowData } from "./execution.flow-scope";

describe("workflow execution flow scope", () => {
	it("freezes only the reachable administrator workflow instance", () => {
		const scoped = scopeWorkflowFlowData({
			nodes: [
				{ id: "source-group", type: "groupNode", data: { label: "冻结来源" } },
				{ id: "normal", type: "taskNode", parentId: "source-group", data: { kind: "image" } },
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1", workflowKey: "agent-workflow/v1", sourceGroupId: "source-group" } },
				{ id: "agent", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1", sourceGroupId: "source-group" } },
				{ id: "detached", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "other", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-2" } },
			],
			edges: [
				{ id: "reachable", source: "trigger", target: "agent" },
				{ id: "normal-edge", source: "normal", target: "trigger" },
				{ id: "other-edge", source: "trigger", target: "other" },
			],
			viewport: { x: 1, y: 2, zoom: 1 },
		}, "trigger");

		expect((scoped.nodes as Array<{ id: string }>).map((node) => node.id)).toEqual(["trigger", "agent"]);
		expect((scoped.edges as Array<{ id: string }>).map((edge) => edge.id)).toEqual(["reachable"]);
			expect(scoped.workflowExecutionScope).toEqual({
			version: 1,
			triggerNodeId: "trigger",
			workflowInstanceId: "wf-1",
			workflowKey: "agent-workflow/v1",
		});
		expect(scoped.workflowSourceSnapshots).toEqual({
			"source-group": {
				group: expect.objectContaining({ id: "source-group" }),
				children: [expect.objectContaining({ id: "normal" })],
			},
		});
	});

	it("rejects a trigger without a reachable atomic graph", () => {
		expect(() => scopeWorkflowFlowData({
			nodes: [{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } }],
			edges: [],
		}, "trigger")).toThrow(/no reachable atomic nodes/u);
	});

	it("freezes only the dependency prefix required by a stop node", () => {
		const scoped = scopeWorkflowFlowData({
			nodes: [
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "source", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "planner", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "delivery", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
			],
			edges: [
				{ id: "e1", source: "trigger", target: "source" },
				{ id: "e2", source: "source", target: "planner" },
				{ id: "e3", source: "planner", target: "delivery" },
			],
		}, "trigger", "planner");

		expect((scoped.nodes as Array<{ id: string }>).map((node) => node.id)).toEqual(["trigger", "source", "planner"]);
		expect((scoped.edges as Array<{ id: string }>).map((edge) => edge.id)).toEqual(["e1", "e2"]);
		expect(scoped.workflowExecutionScope).toEqual({
			version: 1,
			triggerNodeId: "trigger",
			workflowInstanceId: "wf-1",
			stopAfterNodeId: "planner",
		});
	});

	it("rejects a stop node outside the trigger dependency graph", () => {
		expect(() => scopeWorkflowFlowData({
			nodes: [
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "source", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "detached", type: "taskNode", data: { kind: "workflowStage", adminWorkflow: true, workflowInstanceId: "wf-1" } },
			],
			edges: [{ id: "e1", source: "trigger", target: "source" }],
		}, "trigger", "detached")).toThrow(/not reachable/u);
	});

	it("rejects another trigger as a stop cursor", () => {
		expect(() => scopeWorkflowFlowData({
			nodes: [
				{ id: "trigger", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
				{ id: "schedule", type: "taskNode", data: { kind: "workflowTrigger", adminWorkflow: true, workflowInstanceId: "wf-1" } },
			],
			edges: [{ id: "e1", source: "trigger", target: "schedule" }],
		}, "trigger", "schedule")).toThrow(/not an atomic workflow stage/u);
	});
});
