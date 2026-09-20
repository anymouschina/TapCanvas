import { describe, expect, it } from "vitest";
import {
	createWorkflowCollection,
	isWorkflowCollection,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowNodeExecutionContext } from "./execution.node-executors";
import type { WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import type { WorkflowNodeExecutionResult } from "./execution.node-runtime";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";

function collection<T>(
	collectionId: string,
	producerPortId: string,
	values: readonly T[],
	itemIds: readonly string[],
) {
	return createWorkflowCollection({
		collectionId,
		producerNodeId: "fixture",
		producerPortId,
		values,
		itemIds,
	});
}

function context(inputs: WorkflowNodeExecutionContext["inputs"]): WorkflowNodeExecutionContext {
	return {
		executionId: "execution-1",
		executionFamilyId: "family-1",
		ownerId: "owner-1",
		flowId: "flow-1",
		projectId: "project-1",
		workflowKey: "video",
		node: {
			id: "clip-writer-agent",
			type: "taskNode",
			kind: "workflowStage",
			data: {
				workflowAtomicSpec: {
					executionMode: "each",
					executorRef: "test/each",
					inputAlignment: {
						strategy: "keyed_join",
						primaryPort: "clip-contexts",
						primaryKeyPath: "beat.clipId",
						candidateKeyPath: "assetPlan.consumerClipIds",
						candidatePorts: ["asset-bindings"],
					},
				},
			},
		},
		inputs,
	};
}

function success(value: unknown): WorkflowNodeExecutionResult {
	return {
		ok: true,
		outputRefs: {
			protocolVersion: "1",
			executorRef: "test/each",
			nodeId: "clip-writer-agent",
			executionMode: "each",
			ports: { result: value },
			artifacts: [],
			evidence: {},
			itemRuns: [],
		},
	};
}

describe("workflow collection keyed alignment", () => {
	it("joins a many-to-many asset collection to the clip primary without positional padding", async () => {
		const clipContexts = collection(
			"clips",
			"clip-contexts",
			[
				{ beat: { clipId: "clip-0" } },
				{ beat: { clipId: "clip-1" } },
				{ beat: { clipId: "clip-2" } },
				{ beat: { clipId: "clip-3" } },
			],
			["clip-0", "clip-1", "clip-2", "clip-3"],
		);
		const assetBindings = collection(
			"assets",
			"asset-bindings",
			[
				{ assetPlan: { consumerClipIds: ["clip-0", "clip-2"] }, assetId: "asset-a" },
				{ assetPlan: { consumerClipIds: ["clip-2"] }, assetId: "asset-b" },
				{ assetPlan: { consumerClipIds: ["clip-0"] }, assetId: "asset-c" },
				{ assetPlan: { consumerClipIds: [] }, assetId: "unused-asset" },
			],
			["asset-a", "asset-b", "asset-c", "unused-asset"],
		);
		const seen: Array<{ clipId: string; assetIds: string[] }> = [];
		const executeOnce = async (runContext: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const clip = runContext.inputs["clip-contexts"]?.[0];
			const assets = runContext.inputs["asset-bindings"]?.[0];
			expect(clip).toBeDefined();
			expect(isWorkflowCollection(assets)).toBe(true);
			if (!isWorkflowCollection(assets)) return success(null);
			const clipValue = clip;
			const clipId = typeof clipValue === "object" && clipValue !== null && !Array.isArray(clipValue)
				&& typeof (clipValue as Record<string, unknown>).beat === "object"
				&& (clipValue as Record<string, unknown>).beat !== null
				? String(((clipValue as Record<string, Record<string, unknown>>).beat).clipId)
				: "";
			seen.push({
				clipId,
				assetIds: assets.items.map((item) => String((item.value as Record<string, unknown>).assetId)),
			});
			return success(clipId);
		};

		const result = await executeWorkflowNodeByMode(
			context({
				"clip-contexts": [clipContexts],
				"asset-bindings": [assetBindings],
			}),
			{} as WorkflowNodeExecutorDependencies,
			executeOnce,
		);

		expect(result.ok).toBe(true);
		expect(seen).toEqual([
			{ clipId: "clip-0", assetIds: ["asset-a", "asset-c"] },
			{ clipId: "clip-1", assetIds: [] },
			{ clipId: "clip-2", assetIds: ["asset-a", "asset-b"] },
			{ clipId: "clip-3", assetIds: [] },
		]);
	});

	it.each([undefined, null, "", ["clip-0", 1]].map(consumerClipIds => ({ consumerClipIds })))("rejects malformed candidate keys instead of treating them as an empty relationship: $consumerClipIds", async ({ consumerClipIds }) => {
		const result = await executeWorkflowNodeByMode(context({
			"clip-contexts": [collection("clips", "clip-contexts", [{ beat: { clipId: "clip-0" } }], ["clip-0"])],
			"asset-bindings": [collection("assets", "asset-bindings", [{ assetPlan: { consumerClipIds } }], ["asset-1"])],
		}), {} as WorkflowNodeExecutorDependencies, async () => success(null));
		expect(result).toMatchObject({ ok: false, errorMessage: expect.stringContaining("missing or invalid key") });
	});

	it("fails structurally when a candidate references an unknown primary key", async () => {
		const result = await executeWorkflowNodeByMode(
			context({
				"clip-contexts": [collection("clips", "clip-contexts", [{ beat: { clipId: "clip-0" } }], ["clip-0"])],
				"asset-bindings": [collection("assets", "asset-bindings", [{ assetPlan: { consumerClipIds: ["missing"] } }], ["asset-1"])],
			}),
			{} as WorkflowNodeExecutorDependencies,
			async () => success(null),
		);

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("has no matching primary item"),
		});
	});
});

it("keeps accepted receipt and outputs when a resumed collection item throws", async () => {
	const initial = context({
		"clip-contexts": [collection("clips", "clip-contexts", [{ beat: { clipId: "clip-0" } }], ["clip-0"])],
		"asset-bindings": [collection("assets", "asset-bindings", [], [])],
	});
	const seed = success(null);
	if (!seed.ok) throw new Error("invalid fixture");
	const resumeOutputRefs = {
		...seed.outputRefs,
		itemRuns: [{ itemId: "clip-0", index: 0, runtimeNodeId: "clip-writer-agent::item::clip-0",
			status: "waiting_external" as const, lineage: [], ports: { generatedAssetId: "asset-1" }, artifacts: [],
			evidence: { taskId: "accepted-task", canvasNodeId: "output-node" } }],
	};
	const result = await executeWorkflowNodeByMode(
		{ ...initial, resumeOnly: true, resumeOutputRefs },
		{} as WorkflowNodeExecutorDependencies,
		async () => { throw new Error("observation disconnected"); },
	);
	expect(result.outputRefs?.itemRuns[0]).toMatchObject({
		status: "failed", ports: { generatedAssetId: "asset-1" },
		evidence: { taskId: "accepted-task", canvasNodeId: "output-node",
			observationFailure: { message: "observation disconnected" } },
	});
});

it("delivers successful collection items with explicit missing-item evidence after exhaustion", async () => {
 const base = context({ "clip-contexts": [collection("clips", "clip-contexts", [0,1,2,3].map(i => ({beat:{clipId:`c${i}`}})), ["c0","c1","c2","c3"])] });
 const configured = {...base, node: {...base.node, data: {...base.node.data,
   workflowMediaDeliveryPolicy: {version:1,maxRetries:1,exhausted:"deliver_successes"},
 }}};
 const result = await executeWorkflowNodeByMode(configured, {} as WorkflowNodeExecutorDependencies,
   async ctx => ctx.runtimeItemIndex === 1 || ctx.runtimeItemIndex === 3
     ? {ok:false,errorCode:"workflow_node_runtime_failed",errorMessage:"provider confirmed failure"}
     : success(ctx.runtimeItemIndex));
 expect(result.ok).toBe(true);
 expect(result.outputRefs?.evidence).toMatchObject({partial:true,executorCompleted:true,completedItems:2,failedItems:2,totalItems:4});
 expect(result.outputRefs?.itemRuns.filter(run=>run.status === "success").map(run=>run.itemId)).toEqual(["c0","c2"]);
});


describe("collection checkpoint persistence recovery", () => {
  it("preserves settled outputs without classifying a permission failure as a transient database wait", async () => {
    let input = context({ "clip-contexts": [collection("clips", "clip-contexts",
      [{ beat: { clipId: "clip-0" } }], ["clip-0"])] });
    input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "test/each", itemConcurrency: 1 };
    input = { ...input, checkpointOutputRefs: async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); } };
    const result = await executeWorkflowNodeByMode(input, {} as WorkflowNodeExecutorDependencies,
      async item => success(item.node.id));
    expect(result).toMatchObject({ ok: false, errorMessage: "permission denied" });
    expect(result).not.toHaveProperty("waitingExternal", true);
    expect(result.outputRefs?.itemRuns[0]).toMatchObject({ status: "success" });
  });

  it.each(["P2028", "P2034", "57P03"])("preserves in-flight successes and resumes without replay after %s", async (code) => {
    let input = context({ "clip-contexts": [collection("clips", "clip-contexts",
      [0, 1, 2, 3].map(index => ({ beat: { clipId: `clip-${index}` } })),
      ["clip-0", "clip-1", "clip-2", "clip-3"]) ] });
    input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "test/each", itemConcurrency: 2 };
    input = { ...input, checkpointOutputRefs: async () => { throw Object.assign(new Error("checkpoint unavailable"), { code }); } };
    const executed: string[] = [];
    let release: () => void = () => undefined;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const execute = async (item: WorkflowNodeExecutionContext) => {
      executed.push(item.node.id);
      if (executed.length === 2) release();
      await barrier;
      return success(item.node.id);
    };
    const result = await executeWorkflowNodeByMode(input, {} as WorkflowNodeExecutorDependencies, execute);
    expect(result.ok).toBe(false);
    if (result.ok || !result.waitingExternal) throw new Error("Expected durable persistence wait");
    expect(result.outputRefs.itemRuns).toHaveLength(2);
    expect(result.outputRefs.itemRuns.every(item => item.status === "success")).toBe(true);
    expect(result.outputRefs.evidence.checkpointPersistenceFailure).toMatchObject({ errorCodes: [code] });
    expect(executed).toHaveLength(2);
    const resumed = await executeWorkflowNodeByMode({ ...input, resumeOnly: true,
      resumeOutputRefs: result.outputRefs, checkpointOutputRefs: async () => undefined },
      {} as WorkflowNodeExecutorDependencies, async item => { executed.push(item.node.id); return success(item.node.id); });
    expect(resumed.ok).toBe(true);
    expect(resumed.outputRefs?.itemRuns).toHaveLength(4);
    expect(new Set(executed).size).toBe(4);
    expect(executed).toHaveLength(4);
  });
});
