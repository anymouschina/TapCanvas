import { describe, expect, it } from "vitest";
import {
	freezeWorkflowExecutionSemanticsSnapshot,
	projectWorkflowExecutionSemanticsSnapshot,
	readWorkflowExecutionSemanticsSnapshot,
	readWorkflowNodeExecutionSemantics,
} from "./execution.semantics-snapshot";

describe("workflow execution semantics snapshot", () => {
	it("projects existing contracts onto a bounded graph without recomputing semantics", () => {
		const nodes = ["source", "other"].map(id => ({ id, type: "taskNode", data: {
			kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.input.text/v1" },
		} }));
		const original = freezeWorkflowExecutionSemanticsSnapshot({ nodes, edges: [] });
		const before = structuredClone(original);
		const projected = projectWorkflowExecutionSemanticsSnapshot(original, { ...original, nodes: nodes.slice(0, 1) });
		expect(readWorkflowExecutionSemanticsSnapshot(projected).nodes).toEqual({
			source: readWorkflowExecutionSemanticsSnapshot(original).nodes.source,
		});
		expect(freezeWorkflowExecutionSemanticsSnapshot(projected)).toEqual(projected);
		expect(original).toEqual(before);
		expect(() => projectWorkflowExecutionSemanticsSnapshot(original, { nodes: [{ ...nodes[0], id: "unknown" }] })).toThrow("no frozen execution semantics");
	});
	it("freezes every built-in node contract into the immutable execution version", () => {
		const frozen = freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [
				{ id: "source", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.input.text/v1" } } },
				{ id: "image", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.image.generate/v1" } } },
			],
			edges: [],
		});

		expect(readWorkflowExecutionSemanticsSnapshot(frozen).nodes).toEqual(expect.objectContaining({
			source: expect.objectContaining({ executorRef: "workflow.input.text/v1" }),
			image: expect.objectContaining({ executorRef: "tapcanvas.image.generate/v1" }),
		}));
		expect(readWorkflowNodeExecutionSemantics(frozen, "source")).toMatchObject({
			recoveryMode: "replay",
			maxAutomaticAttempts: 1,
			failureStage: "input",
		});
		expect(readWorkflowNodeExecutionSemantics(frozen, "image")).toMatchObject({
			sideEffect: "paid_generation",
			recoveryMode: "reconcile",
			maxAutomaticAttempts: 1,
			resultLookup: { mode: "provider_receipt", outputField: "taskId" },
		});
	});

	it("freezes configured reconciliation attempts and rejects unsafe manual retries", () => {
		const node = (executorRef: string) => ({ id: "configured", data: {
			workflowAtomicSpec: { executorRef }, workflowRetryPolicy: { maxAttempts: 3 },
		} });
		const frozen = freezeWorkflowExecutionSemanticsSnapshot({ nodes: [node("tapcanvas.video.generate/v1")], edges: [] });
		expect(readWorkflowNodeExecutionSemantics(frozen, "configured")).toMatchObject({ maxAutomaticAttempts: 3, recoveryMode: "reconcile" });
		expect(() => freezeWorkflowExecutionSemanticsSnapshot({ nodes: [node("agents.tool.invoke/v1")], edges: [] })).toThrow(/idempotency identity/);
	});

	it("freezes inline step semantics and rejects snapshots that omit those steps", () => {
		const image = { id: "inner-image", type: "taskNode", kind: "workflowStage", data: { kind: "workflowStage", workflowAtomicSpec: {
			version: 1, category: "media", operation: "generate", executorRef: "tapcanvas.image.generate/v1", executionMode: "once", inputPorts: ["input"], outputPorts: ["result"],
		} } };
		const pipeline = { protocolVersion: "workflow.pipeline.run/v1", inputs: [{ portId: "input", mode: "value", artifactTypes: [] }],
			steps: [{ stepId: "image", node: image }], bindings: [{ from: { kind: "input", portId: "input" }, to: { stepId: "image", portId: "input" }, mode: "value" }],
			outputs: [{ portId: "result", from: { stepId: "image", portId: "result" }, mode: "value" }],
		};
		const frozen = freezeWorkflowExecutionSemanticsSnapshot({ nodes: [{ id: "pipeline", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.pipeline.run/v1" }, workflowPipeline: pipeline } }] });
		const snapshot = readWorkflowExecutionSemanticsSnapshot(frozen);
		expect(Object.keys(snapshot.nodes).sort()).toEqual(["inner-image", "pipeline"]);
		expect(snapshot.nodes.pipeline.semantics).toMatchObject({ sideEffect: "paid_generation", recoveryMode: "reconcile", resultLookup: { outputField: "providerReceiptRefs" } });
		expect(() => readWorkflowExecutionSemanticsSnapshot({ ...frozen, workflowExecutionSemantics: { ...snapshot, nodes: { pipeline: snapshot.nodes.pipeline } } })).toThrow(/cover every/);
	});

	it("preserves a valid frozen snapshot", () => {
		const first = freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [{ id: "output", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.output/v1" } } }],
			edges: [],
		});
		const second = freezeWorkflowExecutionSemanticsSnapshot(first);
		expect(second.workflowExecutionSemantics).toEqual(first.workflowExecutionSemantics);
	});

	it("rejects a snapshot whose executor identity differs from the immutable node", () => {
		const frozen = freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [{ id: "output", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.output/v1" } } }],
			edges: [],
		});
		const snapshot = frozen.workflowExecutionSemantics as Record<string, unknown>;
		const nodes = snapshot.nodes as Record<string, Record<string, unknown>>;
		expect(() => freezeWorkflowExecutionSemanticsSnapshot({
			...frozen,
			workflowExecutionSemantics: {
				...snapshot,
				nodes: { ...nodes, output: { ...nodes.output, executorRef: "workflow.input/v1" } },
			},
		})).toThrow(/do not match/u);
	});

	it("projects an admitted plugin capability into the same frozen runtime contract", () => {
		const executorRef = "workflow.plugin-executor/v1/example-plugin/1.0.0/example-node/1/example-capability/1";
		const manifest = {
			protocolVersion: "workflow.plugin-manifest/v1",
			pluginId: "example-plugin",
			pluginVersion: "1.0.0",
			displayName: "Example",
			description: "Example workflow plugin",
			runtimeOwner: { kind: "isolated-worker" as const, ownerId: "example-owner", runtimeVersion: "1.0.0" },
			permissions: [],
			capabilities: [{
				capabilityId: "example-capability",
				capabilityVersion: 1,
				title: "Example capability",
				description: "Reads a deterministic fact",
				entrypoint: "execute",
				requiredPermissions: [],
				inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
				outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
				execution: {
					sideEffect: "none",
					retrySafety: "safe",
					executionMode: "parallel_safe",
					idempotencyKeyInput: null,
					resultLookup: "none",
					resultLookupKeyOutput: null,
				},
			}],
			nodeDefinitions: [{
				nodeType: "example-node",
				nodeVersion: 1,
				title: "Example node",
				description: "Example node",
				category: "tool",
				capability: { capabilityId: "example-capability", capabilityVersion: 1 },
				requiredPermissions: [],
				configSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
				inputPorts: [],
				outputPorts: [],
			}],
		};
		const frozen = freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [{ id: "plugin", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef } } }],
			edges: [],
		}, [{
			manifest,
			admission: {
				pluginId: "example-plugin",
				pluginVersion: "1.0.0",
				runtimeOwner: manifest.runtimeOwner,
				grantedPermissions: [],
			},
		}]);

		expect(readWorkflowNodeExecutionSemantics(frozen, "plugin")).toMatchObject({
			recoveryMode: "replay",
			failureStage: "plugin_execution",
			maxAutomaticAttempts: 1,
		});
	});
});
