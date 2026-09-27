import { describe, expect, it, vi } from "vitest";
import { createWorkflowCollection, isWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";
import { executeRegisteredWorkflowNode, type WorkflowNodeExecutionContext, type WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import { runWorkflowPipelineNode } from "./execution.pipeline-runner";
import type { WorkflowNodeExecutionResult, WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";

vi.mock("../../../../web/src/canvas/store", () => ({ useRFStore: {} }));
vi.mock("../../../../web/src/canvas/utils/nodeBounds", () => ({ getNodeAbsPosition: vi.fn() }));
vi.mock("../../../../web/src/auth/isAdmin", () => ({ isCurrentUserAdmin: () => true }));

function collection(values: readonly unknown[], ids: readonly string[], port: string) {
	return createWorkflowCollection({ collectionId: `test:${port}`, producerNodeId: "test", producerPortId: port, values, itemIds: ids });
}

type CanvasTemplateModule = Readonly<{
	buildVideoWorkflowCanvasDefinitionPatch: (input: Readonly<{
		workflowInstanceId: string;
		workflowGroupId: string;
		executionScope: "media_delivery";
		existingEdges: readonly [];
	}>) => Readonly<{ patchNodeData: readonly Readonly<{ id: string; data: Record<string, unknown> }>[] }>;
}>;

async function mediaNode(): Promise<WorkflowNodeSnapshot> {
	const templateModulePath: string = "../../../../web/src/canvas/videoWorkflowCanvasTemplate";
	const templateModule: unknown = await import(templateModulePath);
	if (!templateModule || typeof templateModule !== "object"
		|| !("buildVideoWorkflowCanvasDefinitionPatch" in templateModule)
		|| typeof templateModule.buildVideoWorkflowCanvasDefinitionPatch !== "function") {
		throw new Error("Real template module has no patch builder");
	}
	const patch = (templateModule as CanvasTemplateModule).buildVideoWorkflowCanvasDefinitionPatch({
		workflowInstanceId: "template-test", workflowGroupId: "template-group",
		executionScope: "media_delivery", existingEdges: [],
	});
	const node = patch.patchNodeData.find((candidate) => candidate.id.endsWith(":clip-media-pipeline"));
	if (!node) throw new Error("Real template has no media pipeline");
	return { id: node.id, type: "taskNode", kind: "workflowStage", data: node.data };
}

function stepOutput(context: WorkflowNodeExecutionContext, ports: Record<string, unknown>): WorkflowNodeOutputV1 {
	const spec = context.node.data.workflowAtomicSpec as { executorRef: string };
	return { protocolVersion: "1", executorRef: spec.executorRef, nodeId: context.node.id,
		executionMode: "once", ports, artifacts: [], evidence: { executorCompleted: true }, itemRuns: [] };
}

describe("real video template through durable pipeline and each-item aggregation", () => {
	it.each([true, false])("runs image dependencies before selecting onlyVideoNodes=%s delivery", async (onlyVideoNodes) => {
		const calls: string[] = [];
		const deps = {} as WorkflowNodeExecutorDependencies;
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const stepId = context.node.id.split("::step::").at(-1)!;
			const clipId = context.runtimeItemLineage?.at(-1)?.itemId;
			if (!clipId) throw new Error("Outer each-mode lost Clip lineage");
			calls.push(`${clipId}:${stepId}`);
			if (stepId === "video-execution-choice") return executeRegisteredWorkflowNode(context, deps);
			const imageUrl = `https://media.example/${clipId}.png`;
			const clip = { clipId };
			const ready = { clipId, nodeId: `video-${clipId}`, imageUrl, persisted: true, promptPersisted: true, dependenciesReady: true };
			const outputs: Record<string, Record<string, unknown>> = {
				"clip-production-media-project": {
					"clip-production": collection([clip], [clipId], "clip-production"),
					"asset-items": collection([{ clipId }], [clipId], "asset-items"),
				},
				"clip-asset-image-generate": { "asset-bindings": collection([{ imageUrl }], [clipId], "asset-bindings") },
				"clip-production-project": { "prompt-package": { clipId, imageUrl } },
				"voice-materialize": { "voice-manifest": { mode: "provider_native" } },
				"cost-estimate": { estimate: { clipId, estimatedCredits: 1 } },
				"production-handoff": { "production-plan": collection([ready], [clipId], "production-plan") },
				"video-node-prepare": { "prepared-nodes": collection([ready], [clipId], "prepared-nodes") },
				"video-submit": { "provider-receipts": collection([{ clipId, taskId: `task-${clipId}` }], [clipId], "provider-receipts") },
				"video-results": { "video-assets": collection([{ clipId, videoUrl: `https://media.example/${clipId}.mp4` }], [clipId], "video-assets") },
			};
			const ports = outputs[stepId];
			if (!ports) throw new Error(`Unmocked side effect: ${stepId}`);
			return { ok: true, outputRefs: stepOutput(context, ports) };
		};
		const clipIds = ["clip-0", "clip-1"];
		const context: WorkflowNodeExecutionContext = {
			executionId: "execution-1", executionFamilyId: "family-1", ownerId: "owner-1",
			flowId: "flow-1", projectId: "project-1", workflowKey: "video", node: await mediaNode(),
			inputs: {
				authorization: [{ onlyVideoNodes }],
				"delivery-contract": [{ protocolVersion: "2" }],
				"media-items": [collection(clipIds.map((clipId) => ({ clipId })), clipIds, "media-items")],
			},
		};
		const result = await executeWorkflowNodeByMode(context, deps, (itemContext, dependencies) => (
			runWorkflowPipelineNode(itemContext, dependencies, executeStep)
		));
		expect(result.ok, JSON.stringify(result)).toBe(true);
		if (!result.ok) throw new Error("Pipeline failed");
		const selected = onlyVideoNodes ? "prepared-nodes" : "video-assets";
		const excluded = onlyVideoNodes ? "video-assets" : "prepared-nodes";
		expect(Object.keys(result.outputRefs.ports)).toEqual(["prompt-package", "estimate", "video-assets", "prepared-nodes"]);
		const receipts = result.outputRefs.ports[selected];
		if (!isWorkflowCollection(receipts)) throw new Error("Outer each-mode did not preserve delivery collection");
		expect(receipts.items.map((item) => item.itemId)).toEqual(clipIds);
		const excludedReceipts = result.outputRefs.ports[excluded];
		if (!isWorkflowCollection(excludedReceipts)) throw new Error("Outer each-mode did not preserve the inactive delivery port");
		expect(excludedReceipts.items).toHaveLength(0);
		for (const [index, clipId] of clipIds.entries()) {
			const item = receipts.items[index]!;
			if (!isWorkflowCollection(item.value)) throw new Error("Nested Clip receipt collection was lost");
			expect(item.value.items).toHaveLength(1);
			expect(item.value.items[0]?.itemId).toBe(clipId);
			const selectedStep = onlyVideoNodes ? "video-node-prepare" : "video-submit";
			const excludedStep = onlyVideoNodes ? "video-submit" : "video-node-prepare";
			expect(calls.indexOf(`${clipId}:clip-asset-image-generate`)).toBeLessThan(calls.indexOf(`${clipId}:video-execution-choice`));
			expect(calls.indexOf(`${clipId}:video-execution-choice`)).toBeLessThan(calls.indexOf(`${clipId}:${selectedStep}`));
			expect(calls).not.toContain(`${clipId}:${excludedStep}`);
			if (onlyVideoNodes) expect(calls).not.toContain(`${clipId}:video-results`);
			expect(result.outputRefs.itemRuns[index]?.evidence.pipelineStepFacts).toMatchObject({
				"video-execution-choice": { status: "success", selectedOutputPorts: [onlyVideoNodes ? "matched" : "unmatched"] },
				[selectedStep]: { status: "success" }, [excludedStep]: { status: "not_selected" },
			});
		}
	});
});
