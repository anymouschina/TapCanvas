import { describe, expect, it, vi } from "vitest";
import {
	createWorkflowCollection,
	isWorkflowCollection,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowNodeExecutionContext } from "./execution.node-executors";
import type { WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import type { WorkflowNodeExecutionResult } from "./execution.node-runtime";
import { effectiveWorkflowItemConcurrency, executeWorkflowNodeByMode } from "./execution.collection-runtime";

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

function context(inputs: WorkflowNodeExecutionContext["inputs"], checkpointOutputRefs?: WorkflowNodeExecutionContext["checkpointOutputRefs"]): WorkflowNodeExecutionContext {
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
		...(checkpointOutputRefs ? { checkpointOutputRefs } : {}),
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
	initial.node.data.workflowAtomicSpec = { ...(initial.node.data.workflowAtomicSpec as Record<string, unknown>), executorRef: "tapcanvas.image.generate/v1" };
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
		status: "waiting_external", ports: { generatedAssetId: "asset-1" },
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

it("omits an unselected selective output instead of emitting an activating empty collection", async () => {
	const base = context({
		"clip-contexts": [collection("clips", "clip-contexts", [{ beat: { clipId: "clip-0" } }], ["clip-0"])],
	});
	const node = {
		...base.node,
		data: {
			...base.node.data,
			workflowAtomicSpec: {
				executionMode: "each",
				executorRef: "test/each",
				inputPorts: ["clip-contexts"],
				outputPorts: ["video-assets", "prepared-nodes"],
				selectiveOutputPorts: ["video-assets", "prepared-nodes"],
			},
		},
	};
	const result = await executeWorkflowNodeByMode(
		{ ...base, node },
		{} as WorkflowNodeExecutorDependencies,
		async () => ({
			ok: true,
			outputRefs: {
				protocolVersion: "1",
				executorRef: "test/each",
				nodeId: "clip-writer-agent::item::clip-0",
				executionMode: "once",
				ports: {},
				artifacts: [],
				evidence: { executorCompleted: true },
				itemRuns: [],
			},
		}),
	);

	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("Expected a successful item run");
	expect(result.outputRefs.ports).not.toHaveProperty("video-assets");
	expect(result.outputRefs.ports).not.toHaveProperty("prepared-nodes");
});


describe("collection checkpoint persistence recovery", () => {
  it("coalesces a settled item burst into one durable cumulative checkpoint", async () => {
    const ids = Array.from({ length: 16 }, (_, index) => `clip-${index}`);
    const persisted: string[][] = [];
    const input: WorkflowNodeExecutionContext = {
      ...context({ "clip-contexts": [collection("clips", "clip-contexts",
        ids.map(clipId => ({ beat: { clipId } })), ids)] }),
      checkpointOutputRefs: async output => {
        persisted.push(output.itemRuns.map(run => run.itemId));
      },
    };
    input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "test/each", itemConcurrency: 16 };
    const result = await executeWorkflowNodeByMode(input, {} as WorkflowNodeExecutorDependencies,
      async item => success(item.runtimeItemIndex));
    expect(result.ok).toBe(true);
    expect(result.outputRefs?.itemRuns.map(run => run.itemId)).toEqual(ids);
    expect(persisted).toEqual([ids]);
  });

  it("applies an explicit worker capacity limit and records both concurrency values", async () => {
    expect(effectiveWorkflowItemConcurrency(16, "2")).toBe(2);
    expect(() => effectiveWorkflowItemConcurrency(16, "invalid")).toThrow("WORKFLOW_ITEM_CONCURRENCY_LIMIT");
    expect(() => effectiveWorkflowItemConcurrency(16, "")).toThrow("WORKFLOW_ITEM_CONCURRENCY_LIMIT");
    const ids = ["clip-0", "clip-1", "clip-2"];
    const input = context({ "clip-contexts": [collection("clips", "clip-contexts",
      ids.map(clipId => ({ beat: { clipId } })), ids)] });
    input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "test/each", itemConcurrency: 16 };
    let active = 0;
    let peak = 0;
    vi.stubEnv("WORKFLOW_ITEM_CONCURRENCY_LIMIT", "2");
    try {
      const result = await executeWorkflowNodeByMode(input, {} as WorkflowNodeExecutorDependencies,
        async item => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>(resolve => setTimeout(resolve, 1));
          active -= 1;
          return success(item.runtimeItemIndex);
        });
      expect(result.ok).toBe(true);
      expect(peak).toBe(2);
      expect(result.outputRefs?.evidence).toMatchObject({ itemConcurrency: 2, configuredItemConcurrency: 16 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("overlaps independent items while preserving their source order in the receipt", async () => {
    const ids = ["clip-0", "clip-1", "clip-2", "clip-3", "clip-4"];
    const input = context({ "clip-contexts": [collection("clips", "clip-contexts",
      ids.map(clipId => ({ beat: { clipId } })), ids)] });
    input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "test/each", itemConcurrency: 4 };
    let active = 0;
    let maxActive = 0;
    let started = 0;
    let releaseFirstWave: () => void = () => undefined;
    const firstWave = new Promise<void>(resolve => { releaseFirstWave = resolve; });
    const result = await executeWorkflowNodeByMode(input, {} as WorkflowNodeExecutorDependencies,
      async item => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started += 1;
        if (started === 4) releaseFirstWave();
        await firstWave;
        active -= 1;
        return success(item.runtimeItemIndex);
      });
    expect(result.ok).toBe(true);
    expect(maxActive).toBe(4);
    expect(result.outputRefs?.itemRuns.map(run => run.itemId)).toEqual(ids);
    expect(result.outputRefs?.itemRuns.map(run => run.status)).toEqual(ids.map(() => "success"));
  });

  it("preserves settled outputs without classifying a permission failure as a transient database wait", async () => {
    const input = context({ "clip-contexts": [collection("clips", "clip-contexts",
      [{ beat: { clipId: "clip-0" } }], ["clip-0"])] }, async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); });
    input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "test/each", itemConcurrency: 1 };
    const result = await executeWorkflowNodeByMode(input, {} as WorkflowNodeExecutorDependencies,
      async item => success(item.node.id));
    expect(result).toMatchObject({ ok: false, errorMessage: "permission denied" });
    expect(result).not.toHaveProperty("waitingExternal", true);
    expect(result.outputRefs?.itemRuns[0]).toMatchObject({ status: "success" });
  });

  it.each(["P2028", "P2034", "57P03"])("preserves in-flight successes and resumes without replay after %s", async (code) => {
    const input = context({ "clip-contexts": [collection("clips", "clip-contexts",
      [0, 1, 2, 3].map(index => ({ beat: { clipId: `clip-${index}` } })),
      ["clip-0", "clip-1", "clip-2", "clip-3"]) ] }, async () => { throw Object.assign(new Error("checkpoint unavailable"), { code }); });
    input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "test/each", itemConcurrency: 2 };
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

it("replays only the exact Clip item named by nested media retry authorization", async () => {
  const input = context({ "clip-contexts": [collection("clips", "clip-contexts",
    [{ beat: { clipId: "clip-a" } }, { beat: { clipId: "clip-b" } }], ["clip-a", "clip-b"])] });
  input.node.id = "pipeline";
  input.node.data.workflowAtomicSpec = { executionMode: "each", executorRef: "workflow.pipeline.run/v1", itemConcurrency: 1 };
  const failedRun = (itemId: string, index: number) => ({ itemId, index,
    runtimeNodeId: `pipeline::item::${itemId}`, lineage: [], status: "failed" as const,
    ports: {}, artifacts: [], evidence: { pipelineState: { protocolVersion: "workflow.pipeline.state/v1", steps: {} } },
  });
  const previous = {
    protocolVersion: "1" as const, executorRef: "workflow.pipeline.run/v1", nodeId: "pipeline",
    executionMode: "each" as const, ports: {}, artifacts: [], evidence: {},
    itemRuns: [failedRun("clip-a", 0), failedRun("clip-b", 1)],
  };
  const resumedInput: WorkflowNodeExecutionContext = { ...input, resumeOnly: true,
    recoveryOfExecutionId: "execution-before", resumeOutputRefs: previous,
    flowVersionData: { workflowMediaRetries: [{
    nodeId: "pipeline::item::clip-a::step::images", itemId: "image-a", taskId: "task-failed",
    executorRef: "tapcanvas.image.generate/v1", executionMode: "each", canvasNodeId: "canvas-image-a", retryKey: "retry-a",
  }] } };
  const execute = vi.fn(async (item: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => ({
    ok: true, outputRefs: { protocolVersion: "1", executorRef: "workflow.pipeline.run/v1", nodeId: item.node.id,
      executionMode: "once", ports: {}, artifacts: [], evidence: {}, itemRuns: [] },
  }));

  const result = await executeWorkflowNodeByMode(resumedInput, {} as WorkflowNodeExecutorDependencies, execute);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[0].node.id).toBe("pipeline::item::clip-a");
  expect(result.outputRefs?.itemRuns.find((item) => item.itemId === "clip-b")).toEqual(previous.itemRuns[1]);
});

 it("recovers transient pre-receipt database failures by the same idempotent item identity", async () => {
   const base = context({"clip-contexts":[collection("clips","clip-contexts",[{beat:{clipId:"one"}}],["one"])]});
   base.node.data.workflowAtomicSpec = {executionMode:"each",executorRef:"tapcanvas.image.generate/v1",itemConcurrency:1};
   const first = await executeWorkflowNodeByMode(base,{} as WorkflowNodeExecutorDependencies,async () => {
     throw Object.assign(new Error("database not ready"),{code:"57P03"});
   });
   expect(first).toMatchObject({waitingExternal:true,outputRefs:{itemRuns:[{status:"waiting_external",
     evidence:{observationFailure:{errorCodes:["57P03"]}}}]}});
   const execute = vi.fn(async (item:WorkflowNodeExecutionContext) => success(item.node.id));
   const resumed = await executeWorkflowNodeByMode({...base,resumeOnly:true,resumeOutputRefs:first.outputRefs},
     {} as WorkflowNodeExecutorDependencies,execute);
   expect(resumed.ok).toBe(true);
   expect(execute).toHaveBeenCalledWith(expect.objectContaining({node:expect.objectContaining({id:"clip-writer-agent::item::one"}),resumeOnly:false}),expect.anything());
 });
