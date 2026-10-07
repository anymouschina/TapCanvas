import { describe, expect, it, vi } from "vitest";
import {
	createWorkflowCollection,
	parseWorkflowExecutionSemanticsV2,
	type WorkflowPipelineRunSpecV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";
import type { WorkflowNodeExecutionResult, WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import { collectWorkflowInputReadProjections } from "./execution.input-read-projection";
import { workflowExternalPollAfter } from "./execution.external-check";
import { composeWorkflowPipelineRunSemantics, runWorkflowPipelineNode } from "./execution.pipeline-runner";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";

function frozenStep(id: string, executorRef: string, inputPort: string, outputPort: string) {
	return {
		stepId: id,
		node: {
			id,
			type: "taskNode",
			kind: "workflowStage",
			data: {
				workflowAtomicSpec: {
					version: 1,
					category: "control",
					operation: "test",
					executorRef,
					executionMode: "once",
					inputPorts: [inputPort],
					outputPorts: [outputPort],
					inputArtifactTypes: { [inputPort]: ["tapcanvas.test-value/v1"] },
					outputArtifactTypes: { [outputPort]: ["tapcanvas.test-value/v1"] },
				},
			},
		},
	};
}

function pipelineSpec(): WorkflowPipelineRunSpecV1 {
	return {
		protocolVersion: "workflow.pipeline.run/v1",
		inputs: [{ portId: "seed", mode: "value", artifactTypes: ["tapcanvas.test-value/v1"] }],
		steps: [frozenStep("prepare", "video.clip-contexts/v1", "seed", "context"),
			frozenStep("submit", "tapcanvas.video.generate/v1", "context", "video")],
		bindings: [
			{ from: { kind: "input", portId: "seed" }, to: { stepId: "prepare", portId: "seed" }, mode: "value" },
			{ from: { kind: "step", stepId: "prepare", portId: "context" }, to: { stepId: "submit", portId: "context" }, mode: "value" },
		],
		outputs: [{ portId: "video", from: { stepId: "submit", portId: "video" }, mode: "value" }],
	};
}

function waitingSiblingPipelineSpec(): WorkflowPipelineRunSpecV1 {
	return {
		protocolVersion: "workflow.pipeline.run/v1",
		inputs: [{ portId: "seed", mode: "value", artifactTypes: ["tapcanvas.test-value/v1"] }],
		steps: [
			frozenStep("a", "tapcanvas.video.generate/v1", "seed", "a-result"),
			frozenStep("c", "video.clip-contexts/v1", "a-result", "c-result"),
			frozenStep("b", "video.clip-contexts/v1", "seed", "b-result"),
		],
		bindings: [
			{ from: { kind: "input", portId: "seed" }, to: { stepId: "a", portId: "seed" }, mode: "value" },
			{ from: { kind: "input", portId: "seed" }, to: { stepId: "b", portId: "seed" }, mode: "value" },
			{ from: { kind: "step", stepId: "a", portId: "a-result" }, to: { stepId: "c", portId: "a-result" }, mode: "value" },
		],
		outputs: [
			{ portId: "independent", from: { stepId: "b", portId: "b-result" }, mode: "value" },
			{ portId: "result", from: { stepId: "c", portId: "c-result" }, mode: "value" },
		],
	};
}

function outerNode(spec: WorkflowPipelineRunSpecV1): WorkflowNodeSnapshot {
	return {
		id: "clip-pipeline::clip-fast",
		type: "taskNode",
		kind: "workflowStage",
		data: {
			workflowPipeline: spec,
			workflowAtomicSpec: {
				version: 1,
				category: "control",
				operation: "run",
				executorRef: "workflow.pipeline.run/v1",
				executionMode: "each",
				inputPorts: ["seed"],
				outputPorts: ["video"],
			},
		},
	};
}

function executionContext(spec: WorkflowPipelineRunSpecV1, resumeOutputRefs?: WorkflowNodeOutputV1): WorkflowNodeExecutionContext {
	return {
		executionId: "execution-1",
		executionFamilyId: "family-1",
		ownerId: "owner-1",
		flowId: "flow-1",
		projectId: "project-1",
		workflowKey: "video",
		node: outerNode(spec),
		inputs: { seed: [{ clipId: "clip-fast" }] },
		...(resumeOutputRefs ? { resumeOutputRefs } : {}),
	};
}

function output(node: WorkflowNodeSnapshot, executorRef: string, portId: string, value: unknown, evidence: Record<string, unknown> = {}): WorkflowNodeOutputV1 {
	return {
		protocolVersion: "1",
		executorRef,
		nodeId: node.id,
		executionMode: "once",
		ports: { [portId]: value },
		artifacts: [],
		evidence,
		itemRuns: [],
	};
}

describe("durable inline workflow pipeline", () => {
	it("recovers nested collection pipeline checkpoints through the retained item frontier", async () => {
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		const calls: string[] = [];
		const dependencies = {} as WorkflowNodeExecutorDependencies;
		const execute = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const prepare = context.node.id.endsWith("::prepare");
			calls.push(context.node.id);
			return { ok: true, outputRefs: output(context.node, prepare ? "video.clip-contexts/v1" : "tapcanvas.video.generate/v1",
				prepare ? "context" : "video", prepare ? "prepared" : "https://assets.example/result.mp4") };
		};
		const context: WorkflowNodeExecutionContext = { ...executionContext(pipelineSpec()),
			inputs: { seed: [createWorkflowCollection({ collectionId: "source", producerNodeId: "source",
				producerPortId: "seed", values: [{ clipId: "one" }, { clipId: "two" }], itemIds: ["one", "two"] })] } };
		context.node.data.workflowAtomicSpec = { ...(context.node.data.workflowAtomicSpec as Record<string, unknown>), itemConcurrency: 2 };
		const runPipeline = (item: WorkflowNodeExecutionContext) => runWorkflowPipelineNode(item, dependencies, execute);
		try {
			const first = await executeWorkflowNodeByMode({ ...context,
				checkpointOutputRefs: async () => { throw Object.assign(new Error("transaction expired"), { code: "P2028" }); } },
				dependencies, runPipeline);
			if (first.ok || !first.waitingExternal) throw new Error("Expected nested persistence continuation");
			expect(first.outputRefs.itemRuns).toHaveLength(2);
			for (const item of first.outputRefs.itemRuns) {
				expect(item).toMatchObject({ status: "waiting_external", evidence: { pipelineState: {
					steps: { prepare: { status: "success", outputRefs: { ports: { context: "prepared" } } } },
				} } });
			}
			const persisted: WorkflowNodeOutputV1[] = [];
			const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
			const resumed = await executeWorkflowNodeByMode({ ...context, resumeOutputRefs: saved, resumeOnly: true,
				checkpointOutputRefs: async snapshot => { persisted.push(snapshot); } }, dependencies, runPipeline);
			expect(resumed.ok).toBe(true);
			expect(resumed.outputRefs?.itemRuns.every(item => item.status === "success")).toBe(true);
			expect(calls).toHaveLength(4);
			expect(new Set(calls).size).toBe(4);
			expect(persisted.length).toBeGreaterThan(0);
		} finally { diagnostic.mockRestore(); }
	});

	it.each(["P2028", "P2034", "57P03"])("retains a completed stage and resumes its cursor after checkpoint %s", async (code) => {
		const failure = Object.assign(new Error("checkpoint unavailable"), { code });
		const calls: string[] = [];
		const execute = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const prepare = context.node.id.endsWith("::prepare");
			calls.push(prepare ? "prepare" : "submit");
			return { ok: true, outputRefs: output(context.node, prepare ? "video.clip-contexts/v1" : "tapcanvas.video.generate/v1",
				prepare ? "context" : "video", prepare ? "prepared-body" : "https://assets.example/result.mp4") };
		};
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()),
				checkpointOutputRefs: async () => { throw failure; } }, {} as WorkflowNodeExecutorDependencies, execute);
			expect(result).toMatchObject({ ok: false, waitingExternal: true,
				outputRefs: { evidence: { checkpointPersistenceFailure: { errorCodes: [code], recoverable: true },
					pipelineState: { cursorStepId: "submit", steps: { prepare: { status: "success",
						outputRefs: { ports: { context: "prepared-body" } } } } } } } });
			if (result.ok || !result.waitingExternal) throw new Error("Expected persistence continuation");
			const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(result.outputRefs)))!;
			const persisted: WorkflowNodeOutputV1[] = [];
			const resumed = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec(), saved), resumeOnly: true,
				checkpointOutputRefs: async snapshot => { persisted.push(snapshot); } }, {} as WorkflowNodeExecutorDependencies, execute);
			expect(resumed.ok).toBe(true);
			expect(calls).toEqual(["prepare", "submit"]);
			expect(persisted).toHaveLength(1);
			expect(resumed.outputRefs?.ports.video).toBe("https://assets.example/result.mp4");
			expect(JSON.parse(diagnostic.mock.calls[0]![0] as string)).toMatchObject({
				message: "workflow_pipeline_checkpoint_failed", errorCodes: [code], recoverable: true,
			});
		} finally { diagnostic.mockRestore(); }
	});

	it("retains an accepted stage checkpoint and reconciles the receipt after persistence recovers", async () => {
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		const accepted: Array<{ resumeOnly: boolean; taskId: unknown }> = [];
		const execute = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			if (context.node.id.endsWith("::prepare")) {
				return { ok: true, outputRefs: output(context.node, "video.clip-contexts/v1", "context", "prepared") };
			}
			accepted.push({ resumeOnly: context.resumeOnly === true, taskId: context.resumeOutputRefs?.evidence.taskId });
			const receipt = output(context.node, "tapcanvas.video.generate/v1", "video", "https://assets.example/result.mp4",
				{ taskId: "accepted-task" });
			if (!context.resumeOnly) await context.checkpointOutputRefs?.(receipt);
			return { ok: true, outputRefs: receipt };
		};
		try {
			const first = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()),
				checkpointOutputRefs: async snapshot => {
					const state = snapshot.evidence.pipelineState as { steps: Record<string, unknown> };
					if (state.steps.submit) throw Object.assign(new Error("expired transaction"), { code: "P2028" });
				} }, {} as WorkflowNodeExecutorDependencies, execute);
			if (first.ok || !first.waitingExternal) throw new Error("Expected accepted receipt wait");
			expect(first.outputRefs.evidence.pipelineState).toMatchObject({ steps: { submit: {
				status: "waiting_external", selectedOutputPorts: ["video"], outputRefs: { evidence: { taskId: "accepted-task" } },
			} } });
			const resumed = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec(), first.outputRefs), resumeOnly: true,
				checkpointOutputRefs: async () => {} }, {} as WorkflowNodeExecutorDependencies, execute);
			expect(resumed.ok).toBe(true);
			expect(accepted).toEqual([{ resumeOnly: false, taskId: undefined }, { resumeOnly: true, taskId: "accepted-task" }]);
		} finally { diagnostic.mockRestore(); }
	});

	it.each(["stage", "item"] as const)("keeps an accepted %s receipt waiting after a later observation throws and reconciles its original handle", async (receiptScope) => {
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		const externalCheck = { version: 1, mode: "poll", notBeforeAt: "2026-09-30T10:00:00.000Z" } as const;
		let submissions = 0;
		const reconciled: unknown[] = [];
		const execute = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			if (context.node.id.endsWith("::prepare")) return { ok: true,
				outputRefs: output(context.node, "video.clip-contexts/v1", "context", "prepared") };
			if (context.resumeOnly) {
				reconciled.push(receiptScope === "stage" ? context.resumeOutputRefs?.evidence.taskId
					: context.resumeOutputRefs?.itemRuns[0]?.evidence.taskId);
				return { ok: true, outputRefs: output(context.node, "tapcanvas.video.generate/v1", "video", "https://assets.example/reconciled.mp4", { taskId: "accepted-once" }) };
			}
			submissions += 1;
			const acceptedOutput: WorkflowNodeOutputV1 = {
				...output(context.node, "tapcanvas.video.generate/v1", "receipt", { providerTask: "accepted-once" }, receiptScope === "stage" ? { taskId: "accepted-once" } : {}),
				artifacts: [{ type: "tapcanvas.test-value/v1", identity: "accepted-artifact", value: "retained" }],
				externalCheck,
				itemRuns: receiptScope === "item" ? [{ itemId: "accepted-item", index: 0, status: "waiting_external", runtimeNodeId: context.node.id,
					lineage: [], ports: {}, artifacts: [], evidence: { taskId: "accepted-once" }, externalCheck }] : [],
			};
			await context.checkpointOutputRefs?.(acceptedOutput);
			throw new Error("The observation connection closed after acceptance.");
		};
		try {
			const first = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()), checkpointOutputRefs: async () => {} },
				{} as WorkflowNodeExecutorDependencies, execute);
			if (first.ok || !first.waitingExternal) throw new Error("Expected retained acceptance to remain waiting");
			expect(first.externalCheck).toEqual(externalCheck);
			expect(first.outputRefs.evidence).not.toHaveProperty("pipelineFailure");
			expect(first.outputRefs.evidence.pipelineState).toMatchObject({ steps: { submit: {
				status: "waiting_external", selectedOutputPorts: ["receipt"], outputRefs: {
					ports: { receipt: { providerTask: "accepted-once" } }, artifacts: [{ identity: "accepted-artifact" }], externalCheck,
					evidence: { pipelineStageObservationFailures: [{ message: "The observation connection closed after acceptance." }] },
				},
			} } });
			const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
			const resumed = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec(), saved), resumeOnly: true, checkpointOutputRefs: async () => {} },
				{} as WorkflowNodeExecutorDependencies, execute);
			expect(resumed.ok).toBe(true);
			expect(submissions).toBe(1);
			expect(reconciled).toEqual(["accepted-once"]);
		} finally { diagnostic.mockRestore(); }
	});

	it("adds a poll schedule with a diagnostic when a known accepted receipt has none", async () => {
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()), checkpointOutputRefs: async () => {} },
				{} as WorkflowNodeExecutorDependencies, async context => {
					if (context.node.id.endsWith("::prepare")) return { ok: true, outputRefs: output(context.node, "video.clip-contexts/v1", "context", "prepared") };
					await context.checkpointOutputRefs?.(output(context.node, "tapcanvas.video.generate/v1", "receipt", "accepted", { taskId: "accepted-once" }));
					throw new Error("Receipt observation failed.");
				});
			expect(result).toMatchObject({ ok: false, waitingExternal: true, externalCheck: { version: 1, mode: "poll" }, outputRefs: {
				evidence: { pipelineState: { steps: { submit: { status: "waiting_external", outputRefs: { evidence: {
					taskId: "accepted-once", pipelineStageObservationFailures: [{ scheduleDiagnostic: "workflow_pipeline_accepted_receipt_schedule_missing" }],
				} } } } } },
			} });
			expect(JSON.parse(diagnostic.mock.calls[0]![0] as string)).toMatchObject({
				message: "workflow_pipeline_stage_observation_failed", scheduleDiagnostic: "workflow_pipeline_accepted_receipt_schedule_missing",
			});
		} finally { diagnostic.mockRestore(); }
	});

	it.each([false, true])("preserves output but keeps an unaccepted throw as an explicit local failure (callback=%s)", async (hasCallback) => {
		const initial = await runWorkflowPipelineNode(executionContext(pipelineSpec()), {} as WorkflowNodeExecutorDependencies,
			async context => context.node.id.endsWith("::prepare")
				? { ok: true, outputRefs: output(context.node, "video.clip-contexts/v1", "context", "prepared") }
				: { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "No acceptance occurred.",
					outputRefs: output(context.node, "tapcanvas.video.generate/v1", "receipt", "prior-without-handle") });
		const result = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec(), initial.outputRefs), resumeOnly: true,
			checkpointOutputRefs: async () => {} }, {} as WorkflowNodeExecutorDependencies, async context => {
			if (hasCallback) await context.checkpointOutputRefs?.(output(context.node, "tapcanvas.video.generate/v1", "receipt", "new-without-handle"));
			throw new Error("No readable accepted handle.");
		});
		expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: expect.stringContaining("No readable accepted handle."),
			outputRefs: { evidence: { pipelineState: { steps: { submit: { status: "failed", selectedOutputPorts: ["receipt"], outputRefs: {
				ports: { receipt: hasCallback ? "new-without-handle" : "prior-without-handle" },
			} } } } } } });
		expect(result).not.toHaveProperty("waitingExternal", true);
	});

	it("does not treat an undeclared receipt-looking field as acceptance or swallow AbortError", async () => {
		const context = { ...executionContext(pipelineSpec()), checkpointOutputRefs: async () => {} };
		const result = await runWorkflowPipelineNode(context, {} as WorkflowNodeExecutorDependencies, async stage => {
			await stage.checkpointOutputRefs?.(output(stage.node, "video.clip-contexts/v1", "context", "retained", { taskId: "not-a-declared-lookup" }));
			throw new Error("Pure transform failed.");
		});
		expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed", outputRefs: {
			evidence: { pipelineState: { steps: { prepare: { status: "failed", outputRefs: { evidence: { taskId: "not-a-declared-lookup" } } } } } },
		} });
		expect(result).not.toHaveProperty("waitingExternal", true);
		const aborted = Object.assign(new Error("User canceled."), { name: "AbortError" });
		await expect(runWorkflowPipelineNode(context, {} as WorkflowNodeExecutorDependencies, async () => { throw aborted; })).rejects.toBe(aborted);
	});

	it("does not give a stage exception database-checkpoint authority or reconcile another stage's handle", async () => {
		const context = { ...executionContext(pipelineSpec()), checkpointOutputRefs: async () => {} };
		const providerError = Object.assign(new Error("Stage failed before acceptance."), { code: "P2028" });
		const result = await runWorkflowPipelineNode(context, {} as WorkflowNodeExecutorDependencies, async () => { throw providerError; });
		expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed" });
		expect(result).not.toHaveProperty("waitingExternal", true);
		expect(result.outputRefs?.evidence).not.toHaveProperty("checkpointPersistenceFailure");
		const mismatched = await runWorkflowPipelineNode(context, {} as WorkflowNodeExecutorDependencies, async stage => {
			if (stage.node.id.endsWith("::prepare")) return { ok: true, outputRefs: output(stage.node, "video.clip-contexts/v1", "context", "prepared") };
			const receipt = { ...output(stage.node, "tapcanvas.video.generate/v1", "receipt", "retained", { taskId: "another-stage-task" }), nodeId: "another-stage" };
			await stage.checkpointOutputRefs?.(receipt);
			throw new Error("This stage did not accept that handle.");
		});
		expect(mismatched).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed", outputRefs: { evidence: {
			pipelineState: { steps: { submit: { status: "failed", outputRefs: { nodeId: "another-stage", evidence: { taskId: "another-stage-task" } } } } },
		} } });
		expect(mismatched).not.toHaveProperty("waitingExternal", true);
	});

	it.each([false, {}, [null]])("does not infer acceptance from an empty or non-handle lookup value %j", async (taskId) => {
		const result = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()), checkpointOutputRefs: async () => {} },
			{} as WorkflowNodeExecutorDependencies, async context => {
				if (context.node.id.endsWith("::prepare")) return { ok: true, outputRefs: output(context.node, "video.clip-contexts/v1", "context", "prepared") };
				await context.checkpointOutputRefs?.(output(context.node, "tapcanvas.video.generate/v1", "receipt", "retained", { taskId }));
				throw new Error("No accepted lookup handle was returned.");
			});
		expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed" });
		expect(result).not.toHaveProperty("waitingExternal", true);
	});

	it("finishes from a retained final stage without replaying any stage", async () => {
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		const execute = vi.fn(async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const prepare = context.node.id.endsWith("::prepare");
			return { ok: true, outputRefs: output(context.node, prepare ? "video.clip-contexts/v1" : "tapcanvas.video.generate/v1",
				prepare ? "context" : "video", prepare ? "prepared" : "https://assets.example/retained.mp4") };
		});
		try {
			const first = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()),
				checkpointOutputRefs: async snapshot => {
					const state = snapshot.evidence.pipelineState as { steps: Record<string, { status: string }> };
					if (state.steps.submit?.status === "success") throw Object.assign(new Error("expired transaction"), { code: "P2028" });
				} }, {} as WorkflowNodeExecutorDependencies, execute);
			if (first.ok || !first.waitingExternal) throw new Error("Expected final ledger persistence wait");
			expect(first.outputRefs.ports.video).toBe("https://assets.example/retained.mp4");
			expect(first.outputRefs.evidence.pipelineState).toMatchObject({ cursorStepId: null,
				steps: { prepare: { status: "success" }, submit: { status: "success" } } });
			const resumed = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec(), first.outputRefs), resumeOnly: true },
				{} as WorkflowNodeExecutorDependencies, execute);
			expect(resumed).toMatchObject({ ok: true, outputRefs: {
				ports: { video: "https://assets.example/retained.mp4" }, evidence: { executorCompleted: true },
			} });
			expect(execute).toHaveBeenCalledTimes(2);
		} finally { diagnostic.mockRestore(); }
	});

	it("keeps completed output when a deterministic checkpoint permission boundary rejects the write", async () => {
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()),
				checkpointOutputRefs: async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); } },
			{} as WorkflowNodeExecutorDependencies, async context => ({ ok: true,
				outputRefs: output(context.node, "video.clip-contexts/v1", "context", "retained-body") }));
			expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed",
				outputRefs: { evidence: { checkpointPersistenceFailure: { recoverable: false },
					pipelineState: { steps: { prepare: { status: "success", outputRefs: { ports: { context: "retained-body" } } } } } } } });
			expect(result).not.toHaveProperty("waitingExternal", true);
		} finally { diagnostic.mockRestore(); }
	});

	it("inherits only real persisted input identities and keeps derived stage facts inline", async () => {
		const spec = pipelineSpec();
		const inputs = { seed: [{ body: "original source ".repeat(500) }] };
		const persistedInputSource = { nodeId: "persisted-pipeline", revision: "durable-input-revision", inputs };
		const projected: ReturnType<typeof collectWorkflowInputReadProjections>[] = [];
		const result = await runWorkflowPipelineNode({ ...executionContext(spec), inputs, persistedInputSource },
			{} as WorkflowNodeExecutorDependencies, async context => {
				expect(context.persistedInputSource).toBe(persistedInputSource);
				projected.push(collectWorkflowInputReadProjections(context.inputs, context));
				const prepare = context.node.id.endsWith("::prepare");
				return { ok: true, outputRefs: output(context.node, prepare ? "video.clip-contexts/v1" : "tapcanvas.video.generate/v1",
					prepare ? "context" : "video", { body: "newly derived content ".repeat(500) }) };
			});
		expect(result.ok).toBe(true);
		expect(projected[0]!.projections).toHaveLength(1);
		expect(JSON.parse(projected[0]!.projections[0]!.reference).contentRead.args).toMatchObject({
			nodeId: persistedInputSource.nodeId, revision: persistedInputSource.revision, path: ["seed", "0"],
		});
		expect(projected[1]!.projections).toEqual([]);
		expect(projected[1]!.diagnostics.retainedUnmatched).toBeGreaterThan(0);
	});

	it("does not invent a durable input handle for an in-memory pipeline", async () => {
		const result = await runWorkflowPipelineNode(executionContext(pipelineSpec()), {} as WorkflowNodeExecutorDependencies, async context => {
			expect(context.persistedInputSource).toBeUndefined();
			const prepare = context.node.id.endsWith("::prepare");
			return { ok: true, outputRefs: output(context.node, prepare ? "video.clip-contexts/v1" : "tapcanvas.video.generate/v1",
				prepare ? "context" : "video", "value") };
		});
		expect(result.ok).toBe(true);
	});

	it("retains partial ancestor receipts and exposes their provider failure when a consumer cannot execute", async () => {
		const spec = pipelineSpec();
		const result = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, async (context) => {
			if (context.node.id.endsWith("::prepare")) return { ok: true, outputRefs: {
				...output(context.node, "video.clip-contexts/v1", "context", { ready: "https://assets.example/ready.png" }, { partial: true }),
				itemRuns: [{ itemId: "unavailable", index: 0, runtimeNodeId: `${context.node.id}::item::unavailable`, status: "failed",
					ports: {}, artifacts: [], lineage: [], evidence: { taskId: "accepted-image", providerStatus: "failed" },
					errorCode: "provider_failed", errorMessage: "supplier rejected request (451)" }],
			} };
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "required image URL missing" };
		});
		expect(result).toMatchObject({ ok: false, errorMessage: expect.stringContaining("supplier rejected request (451)") });
		expect(result.outputRefs?.evidence.pipelineFailure).toMatchObject({
			dependencyFailures: [{ taskId: "accepted-image", itemId: "unavailable" }],
		});
		expect(result.outputRefs?.evidence.pipelineState).toMatchObject({ steps: { prepare: { status: "success",
			outputRefs: { ports: { context: { ready: "https://assets.example/ready.png" } } } } } });
	});

	it("composes replay-safe preparation with paid idempotent generation", () => {
		const spec = pipelineSpec();
		const localSafe = parseWorkflowExecutionSemanticsV2({
			protocolVersion: "workflow.execution-semantics/v2",
			sideEffect: "local_mutation",
			retrySafety: "safe",
			executionMode: "parallel_safe",
			idempotency: null,
			resultLookup: { mode: "none", outputField: null },
			recoveryMode: "replay",
			maxAutomaticAttempts: 1,
			backoffClass: "none",
			failureStage: "artifact_persistence",
		});
		const semantics = composeWorkflowPipelineRunSemantics(spec, (node) => (
			node.id === "prepare" ? localSafe : resolveCoreWorkflowExecutorSemantics(
				(node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string,
			)
		));
		expect(semantics).toMatchObject({
			sideEffect: "paid_generation",
			retrySafety: "idempotency_key_required",
			recoveryMode: "reconcile",
			resultLookup: { mode: "provider_receipt", outputField: "providerReceiptRefs" },
		});
	});

	it.each([false, true])("keeps nested and returned waiting receipts identical with output ports present=%s", async (hasPorts) => {
		const snapshots: WorkflowNodeOutputV1[] = [];
		const externalCheck = { version: 1, mode: "poll", notBeforeAt: "2026-09-30T09:00:00.000Z" } as const;
		let acceptedOutput: WorkflowNodeOutputV1 | undefined;
		const result = await runWorkflowPipelineNode({ ...executionContext(pipelineSpec()),
			checkpointOutputRefs: async snapshot => { snapshots.push(snapshot); } },
		{} as WorkflowNodeExecutorDependencies, async context => {
			if (context.node.id.endsWith("::prepare")) {
				return { ok: true, outputRefs: output(context.node, "video.clip-contexts/v1", "context", "prepared") };
			}
			acceptedOutput = {
				...output(context.node, "tapcanvas.video.generate/v1", "video", "retained-result", {
					taskId: "accepted-task", observationFailure: { message: "previous observation failed", observedAt: "2026-09-30T08:59:00.000Z" },
				}),
				ports: hasPorts ? { video: "retained-result", receipt: { taskId: "accepted-task" } } : {},
				artifacts: [{ type: "tapcanvas.test-value/v1", identity: "retained-artifact", value: "retained-result" }],
				externalCheck,
			};
			await context.checkpointOutputRefs?.(acceptedOutput);
			return { ok: false, waitingExternal: true, outputRefs: acceptedOutput, externalCheck };
		});
		if (result.ok || !result.waitingExternal || !acceptedOutput) throw new Error("Expected retained accepted wait");
		const expectedReceipt = { status: "waiting_external", outputRefs: acceptedOutput,
			selectedOutputPorts: hasPorts ? ["receipt", "video"] : [] };
		const waitingSnapshots = snapshots.filter(snapshot => {
			const state = snapshot.evidence.pipelineState as { steps: Record<string, unknown> };
			return Boolean(state.steps.submit);
		});
		// The nested callback, stage return and final waiting projection must agree.
		expect(waitingSnapshots).toHaveLength(3);
		for (const snapshot of [...waitingSnapshots, result.outputRefs]) {
			expect(snapshot.evidence.pipelineState).toMatchObject({ steps: {
				prepare: { status: "success", selectedOutputPorts: ["context"], outputRefs: { ports: { context: "prepared" } } },
				submit: expectedReceipt,
			} });
			expect(snapshot.evidence.pipelineStepFacts).toMatchObject({
				submit: { status: "waiting_external", selectedOutputPorts: expectedReceipt.selectedOutputPorts },
			});
		}
	});

	it("persists a waiting stage receipt and resumes it without losing its accepted task", async () => {
		const spec: WorkflowPipelineRunSpecV1 = {
			protocolVersion: "workflow.pipeline.run/v1",
			inputs: [{ portId: "seed", mode: "value", artifactTypes: ["tapcanvas.test-value/v1"] }],
			steps: [frozenStep("submit", "tapcanvas.video.generate/v1", "seed", "video")],
			bindings: [{ from: { kind: "input", portId: "seed" }, to: { stepId: "submit", portId: "seed" }, mode: "value" }],
			outputs: [{ portId: "video", from: { stepId: "submit", portId: "video" }, mode: "value" }],
		};
		const calls: Array<{ resumeOnly: boolean; receipt: unknown }> = [];
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			calls.push({ resumeOnly: context.resumeOnly === true, receipt: context.resumeOutputRefs?.evidence.taskId });
			const outputRefs = output(context.node, "tapcanvas.video.generate/v1", "video", "asset://clip-fast", { taskId: "provider-task-fast" });
			if (!context.resumeOnly) {
				return {
					ok: false,
					waitingExternal: true,
					externalCheck: workflowExternalPollAfter(1_000),
					outputRefs,
				};
			}
			return { ok: true, outputRefs };
		};
		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(first).toMatchObject({ ok: false, waitingExternal: true });
		if (first.ok || !first.waitingExternal) throw new Error("Expected durable external wait");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		expect(saved.evidence.pipelineState).toMatchObject({
			steps: { submit: { status: "waiting_external", outputRefs: { evidence: { taskId: "provider-task-fast" } } } },
		});
		const resumed = await runWorkflowPipelineNode(executionContext(spec, saved), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(resumed).toMatchObject({ ok: true, outputRefs: { ports: { video: "asset://clip-fast" } } });
		expect(calls).toEqual([
			{ resumeOnly: false, receipt: undefined },
			{ resumeOnly: true, receipt: "provider-task-fast" },
		]);
	});

	it("runs ready siblings while a dependency waits, then resumes without replaying accepted siblings", async () => {
		const spec = waitingSiblingPipelineSpec();
		const calls: Array<{ step: string; resumeOnly: boolean; priorTaskId?: unknown }> = [];
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const step = context.node.id.split("::").at(-1)!;
			calls.push({ step, resumeOnly: context.resumeOnly === true,
				...(step === "a" ? { priorTaskId: context.resumeOutputRefs?.evidence.taskId } : {}) });
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			if (step === "a" && context.resumeOnly !== true) {
				return {
					ok: false,
					waitingExternal: true,
					externalCheck: workflowExternalPollAfter(1_000),
					outputRefs: output(context.node, executorRef, "a-result", "accepted-task", { taskId: "provider-task-a" }),
				};
			}
			const portId = step === "a" ? "a-result" : step === "b" ? "b-result" : "c-result";
			return { ok: true, outputRefs: output(context.node, executorRef, portId, `settled-${step}`,
				step === "a" ? { taskId: "provider-task-a" } : {}) };
		};

		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(first).toMatchObject({ ok: false, waitingExternal: true });
		if (first.ok || !first.waitingExternal) throw new Error("Expected A to remain externally pending");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		expect(saved.evidence.pipelineState).toMatchObject({
			cursorStepId: "a",
			steps: {
				a: { status: "waiting_external", outputRefs: { evidence: { taskId: "provider-task-a" }, externalCheck: { mode: "poll" } } },
				b: { status: "success" },
			},
		});
		expect(saved.evidence.pipelineState).not.toMatchObject({ steps: { c: expect.anything() } });
		expect(calls.map((call) => call.step)).toEqual(["a", "b"]);

		const resumed = await runWorkflowPipelineNode(executionContext(spec, saved), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(resumed).toMatchObject({ ok: true, outputRefs: { ports: { independent: "settled-b", result: "settled-c" } } });
		expect(calls).toEqual([
			{ step: "a", resumeOnly: false, priorTaskId: undefined },
			{ step: "b", resumeOnly: false },
			{ step: "a", resumeOnly: true, priorTaskId: "provider-task-a" },
			{ step: "c", resumeOnly: false },
		]);
	});

	it("aggregates independent waiting receipts by earliest poll and reconciles each accepted stage once", async () => {
		const spec = waitingSiblingPipelineSpec();
		const earliestCheck = workflowExternalPollAfter(1_000, 1_000_000);
		const laterCheck = workflowExternalPollAfter(5_000, 1_000_000);
		const calls: Array<{ step: string; resumeOnly: boolean; priorTaskId?: unknown }> = [];
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const step = context.node.id.split("::").at(-1)!;
			const priorTaskId = context.resumeOutputRefs?.evidence.taskId;
			calls.push({ step, resumeOnly: context.resumeOnly === true,
				...(step === "a" || step === "b" ? { priorTaskId } : {}) });
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			if (step === "a" && context.resumeOnly !== true) {
				return {
					ok: false,
					waitingExternal: true,
					externalCheck: earliestCheck,
					outputRefs: output(context.node, executorRef, "a-result", "accepted-a", { taskId: "provider-task-a" }),
				};
			}
			if (step === "b" && context.resumeOnly !== true) {
				return {
					ok: false,
					waitingExternal: true,
					externalCheck: laterCheck,
					outputRefs: output(context.node, executorRef, "b-result", "accepted-b", { taskId: "provider-task-b" }),
				};
			}
			const portId = step === "a" ? "a-result" : step === "b" ? "b-result" : "c-result";
			return { ok: true, outputRefs: output(context.node, executorRef, portId, `settled-${step}`) };
		};

		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(first).toMatchObject({ ok: false, waitingExternal: true, outputRefs: { externalCheck: earliestCheck } });
		if (first.ok || !first.waitingExternal) throw new Error("Expected both A and B to remain externally pending");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		expect(saved.evidence.pipelineState).toMatchObject({ steps: {
			a: { status: "waiting_external", outputRefs: { evidence: { taskId: "provider-task-a" }, externalCheck: earliestCheck } },
			b: { status: "waiting_external", outputRefs: { evidence: { taskId: "provider-task-b" }, externalCheck: laterCheck } },
		} });
		expect(calls.map((call) => call.step)).toEqual(["a", "b"]);

		const resumed = await runWorkflowPipelineNode(executionContext(spec, saved), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(resumed).toMatchObject({ ok: true, outputRefs: { ports: { independent: "settled-b", result: "settled-c" } } });
		expect(calls).toEqual([
			{ step: "a", resumeOnly: false, priorTaskId: undefined },
			{ step: "b", resumeOnly: false, priorTaskId: undefined },
			{ step: "a", resumeOnly: true, priorTaskId: "provider-task-a" },
			{ step: "c", resumeOnly: false },
			{ step: "b", resumeOnly: true, priorTaskId: "provider-task-b" },
		]);
	});

	it("returns a ready sibling's real failure instead of masking it with another stage's external wait", async () => {
		const spec = waitingSiblingPipelineSpec();
		const calls: string[] = [];
		const result = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, async (context) => {
			const step = context.node.id.split("::").at(-1)!;
			calls.push(step);
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			if (step === "a") {
				return {
					ok: false,
					waitingExternal: true,
					externalCheck: workflowExternalPollAfter(1_000),
					outputRefs: output(context.node, executorRef, "a-result", "accepted-task", { taskId: "provider-task-a" }),
				};
			}
			if (step === "b") return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "provider rejected ready sibling" };
			return { ok: true, outputRefs: output(context.node, executorRef, "c-result", "must-not-run") };
		});

		expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "provider rejected ready sibling" });
		if (result.ok) throw new Error("Expected the ready sibling failure to remain visible");
		expect("waitingExternal" in result && result.waitingExternal).toBe(false);
		expect(calls).toEqual(["a", "b"]);
		expect(result.outputRefs?.evidence.pipelineState).toMatchObject({ steps: {
			a: { status: "waiting_external", outputRefs: { evidence: { taskId: "provider-task-a" } } },
			b: { status: "failed", errorMessage: "provider rejected ready sibling" },
		} });
		expect(result.outputRefs?.evidence.pipelineState).not.toMatchObject({ steps: { c: expect.anything() } });
	});

	it("reuses a successful author stage when a later stage fails", async () => {
		const spec = pipelineSpec();
		const calls: string[] = [];
		let failSubmit = true;
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			calls.push(context.node.id.split("::").at(-1)!);
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			if (context.node.id.endsWith("::prepare")) {
				return { ok: true, outputRefs: output(context.node, executorRef, "context", "frozen-author-result") };
			}
			if (failSubmit) return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "contract mismatch" };
			return { ok: true, outputRefs: output(context.node, executorRef, "video", "asset://clip-fast") };
		};
		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(first).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed" });
		if (first.ok || !first.outputRefs) throw new Error("Expected persisted failed pipeline output");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		expect(saved.evidence.pipelineState).toMatchObject({ steps: { prepare: { status: "success" }, submit: { status: "failed" } } });
		failSubmit = false;
		const resumed = await runWorkflowPipelineNode(executionContext(spec, saved), {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(resumed).toMatchObject({ ok: true, outputRefs: { ports: { video: "asset://clip-fast" } } });
		expect(calls).toEqual(["prepare", "submit", "submit"]);
	});

	it("revisits only failed children of a partial stage on explicit family recovery", async () => {
		const spec = pipelineSpec();
		const calls: Array<{ stage: string; resumeOnly: boolean; priorFailures: number }> = [];
		const failedItem = {
			itemId: "asset-b", index: 1, status: "failed" as const, runtimeNodeId: "prepare::item::asset-b",
			lineage: [], ports: {}, artifacts: [], evidence: {}, errorCode: "workflow_node_runtime_failed",
		};
		const executeStep = async (context: WorkflowNodeExecutionContext): Promise<WorkflowNodeExecutionResult> => {
			const stage = context.node.id.split("::").at(-1)!;
			calls.push({ stage, resumeOnly: context.resumeOnly === true,
				priorFailures: context.resumeOutputRefs?.itemRuns.filter((run) => run.status === "failed").length ?? 0 });
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			if (stage === "prepare") {
				return { ok: true, outputRefs: {
					...output(context.node, executorRef, "context", "asset-list", {
						partial: context.resumeOnly !== true,
					}),
					itemRuns: context.resumeOnly === true ? [] : [failedItem],
				} };
			}
			if (context.recoveryOfExecutionId == null) {
				return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "required asset missing" };
			}
			return { ok: true, outputRefs: output(context.node, executorRef, "video", "asset://clip-fast") };
		};
		const first = await runWorkflowPipelineNode(executionContext(spec), {} as WorkflowNodeExecutorDependencies, executeStep);
		if (first.ok || !first.outputRefs) throw new Error("Expected persisted partial pipeline output");
		const saved = parseWorkflowNodeOutputV1(JSON.parse(JSON.stringify(first.outputRefs)))!;
		const recovered = await runWorkflowPipelineNode({
			...executionContext(spec, saved), resumeOnly: false, recoveryOfExecutionId: "execution-1",
		}, {} as WorkflowNodeExecutorDependencies, executeStep);
		expect(recovered).toMatchObject({ ok: true, outputRefs: { ports: { video: "asset://clip-fast" } } });
		expect(calls).toEqual([
			{ stage: "prepare", resumeOnly: false, priorFailures: 0 },
			{ stage: "submit", resumeOnly: false, priorFailures: 0 },
			{ stage: "prepare", resumeOnly: true, priorFailures: 1 },
			{ stage: "submit", resumeOnly: false, priorFailures: 0 },
		]);
	});

	it("resumes a nested media-adoption checkpoint without replaying retained collection items", async () => {
		const spec = pipelineSpec();
		const node = outerNode(spec);
		const stageNodeId = `${node.id}::step::prepare`;
		const saved: WorkflowNodeOutputV1 = {
			protocolVersion: "1", executorRef: "workflow.pipeline.run/v1", nodeId: node.id, executionMode: "each",
			ports: {}, artifacts: [], evidence: { pipelineState: {
				protocolVersion: "workflow.pipeline.state/v1", cursorStepId: "prepare", updatedAt: "2026-09-29T00:00:00.000Z",
				steps: { prepare: { status: "failed", errorCode: "workflow_media_adoption_checkpoint", outputRefs: {
					...output({ ...node, id: stageNodeId }, "video.clip-contexts/v1", "context", "retained siblings"),
					evidence: { executorCompleted: false, mediaAdoptionCheckpoint: {
						protocolVersion: "workflow.media-adoption-checkpoint/v1", adoptedItemIds: ["adopted-item"],
					} },
				} } },
			} },
			itemRuns: [],
		};
		const calls: Array<{ stage: string; resumeOnly: boolean }> = [];
		const result = await runWorkflowPipelineNode({
			...executionContext(spec, saved), recoveryOfExecutionId: "execution-source", resumeOnly: false,
		}, {} as WorkflowNodeExecutorDependencies, async (context) => {
			const stage = context.node.id.split("::").at(-1) ?? "unknown";
			calls.push({ stage, resumeOnly: context.resumeOnly === true });
			const executorRef = (context.node.data.workflowAtomicSpec as Record<string, unknown>).executorRef as string;
			return { ok: true, outputRefs: output(context.node, executorRef, stage === "prepare" ? "context" : "video", stage) };
		});
		expect(result).toMatchObject({ ok: true });
		expect(calls[0]).toEqual({ stage: "prepare", resumeOnly: true });
		expect(calls.map((call) => call.stage)).toEqual(["prepare", "submit"]);
	});
});
