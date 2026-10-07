import { describe, expect, it } from "vitest";
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from "@tapcanvas/video-orchestrator-protocol";
import { upgradeVideoWorkflowFlowData } from "../../../../../packages/schemas/video-workflow-canvas-template";
import { inspectVideoWorkflowCanvasDefinition } from "./execution.video-workflow-definition-authority";
import { compileWorkflowGraph } from "./execution.recovery";

const INSTANCE = "video-workflow-test";

function currentTemplateFlow(): string {
	const skeleton = {
		viewport: { x: 1, y: 2, zoom: 0.5 },
		workflowSourceSnapshots: { kept: true },
		nodes: [
			{ id: "g1", type: "groupNode", position: { x: 0, y: 0 }, data: {
				workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
				workflowInstanceId: INSTANCE,
				workflowExecutionScope: "media_delivery",
				workflowExecutionVariant: "full_video",
			} },
			{ id: `${INSTANCE}:manual-trigger`, type: "taskNode", parentId: "g1", position: { x: 0, y: 0 }, data: { kind: "workflowTrigger" } },
			{ id: "unrelated", type: "taskNode", position: { x: 9, y: 9 }, data: { kind: "image", label: "keep me" } },
		],
		edges: [],
	};
	return upgradeVideoWorkflowFlowData(JSON.stringify(skeleton)).data;
}

/** Simulates a workflow saved from the previous template revision. */
function staleCopy(flowData: string): string {
	const root = JSON.parse(flowData) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
	for (const node of root.nodes) {
		if (node.data.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) continue;
		node.data.workflowCanvasDefinitionVersion = 130;
		node.data.workflowCanvasDefinitionFingerprint = "sha256:previous-template";
	}
	return JSON.stringify(root).replaceAll("tapcanvas.chapter-asset-outline/v2", "tapcanvas.chapter-asset-outline/v1");
}

describe("upgradeVideoWorkflowFlowData", () => {
	it("brings a workflow saved from an older template back to an executable current definition", () => {
		const current = currentTemplateFlow();
		expect(inspectVideoWorkflowCanvasDefinition(current).current).toBe(true);
		const stale = JSON.parse(staleCopy(current)) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
		const sequenceAgent = stale.nodes.find((node) => node.id === `${INSTANCE}:chapter-sequence-agent`);
		expect(sequenceAgent).toBeDefined();
		sequenceAgent!.data.workflowAgentModelKey = "user-selected-model";
		const staleData = JSON.stringify(stale);
		expect(inspectVideoWorkflowCanvasDefinition(staleData).current).toBe(false);
		expect(() => compileWorkflowGraph(JSON.parse(staleData))).toThrow(/chapter-asset-outline/);

		const upgraded = upgradeVideoWorkflowFlowData(staleData);
		expect(upgraded.upgradedWorkflowInstanceIds).toEqual([INSTANCE]);
		expect(inspectVideoWorkflowCanvasDefinition(upgraded.data).current).toBe(true);
		const root = JSON.parse(upgraded.data) as {
			viewport: unknown;
			workflowSourceSnapshots: unknown;
			nodes: Array<{ id: string; data: Record<string, unknown> }>;
			edges: unknown[];
		};
		expect(() => compileWorkflowGraph(root as never)).not.toThrow();
		expect(root.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 });
		expect(root.workflowSourceSnapshots).toEqual({ kept: true });
		expect(root.nodes.find((node) => node.id === "unrelated")?.data).toEqual({ kind: "image", label: "keep me" });
		expect(root.nodes.find((node) => node.id === `${INSTANCE}:chapter-sequence-agent`)?.data.workflowAgentModelKey)
			.toBe("user-selected-model");
		expect(upgradeVideoWorkflowFlowData(upgraded.data).data).toBe(upgraded.data);
	});

	it("leaves flows without a one-click workflow untouched", () => {
		const data = JSON.stringify({ nodes: [{ id: "a", type: "taskNode", data: { kind: "image" } }], edges: [] });
		const upgraded = upgradeVideoWorkflowFlowData(data);
		expect(upgraded.upgradedWorkflowInstanceIds).toEqual([]);
		expect(JSON.parse(upgraded.data)).toEqual(JSON.parse(data));
	});
});
