import { describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import type { WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";
import {
	createWorkflowPureCacheRequest,
	findWorkflowPureCacheHit,
	materializeWorkflowPureCacheHit,
	recordWorkflowPureCacheStore,
} from "./execution.pure-cache";

function textNode(id: string, data: Record<string, unknown> = {}): WorkflowNodeSnapshot {
	return {
		id,
		type: "taskNode",
		kind: "workflowStage",
		data: {
			prompt: "hello",
			...data,
			workflowAtomicSpec: {
				version: 1,
				category: "source",
				operation: "text_input",
				executorRef: "workflow.input.text/v1",
				executionMode: "once",
				inputPorts: [],
				outputPorts: ["text"],
				cachePolicy: {
					version: 1,
					strategy: "content_addressed",
					contractVersion: "workflow.input.text/v1@1",
				},
			},
		},
	};
}

function textOutput(nodeId: string): WorkflowNodeOutputV1 {
	return {
		protocolVersion: "1",
		executorRef: "workflow.input.text/v1",
		nodeId,
		executionMode: "once",
		ports: { text: "hello" },
		artifacts: [{ type: "tapcanvas.text/v1", identity: null, value: "hello" }],
		evidence: { executorCompleted: true },
		itemRuns: [],
	};
}

describe("workflow pure node cache", () => {
	it("skips cache lookup for first-class workflow nodes without an atomic cache specification", async () => {
		await expect(createWorkflowPureCacheRequest({
			ownerId: "owner-1",
			node: {
				id: "trigger",
				type: "taskNode",
				kind: "workflowTrigger",
				data: { kind: "workflowTrigger" },
			},
			inputs: {},
			resumeOnly: false,
		})).resolves.toBeNull();
	});

	it("derives the same owner-scoped content key from canonically equivalent facts", async () => {
		const first = await createWorkflowPureCacheRequest({
			ownerId: "owner-1",
			node: textNode("node-a", { alpha: 1, nested: { z: true, a: false } }),
			inputs: { input: [{ right: 2, left: 1 }] },
			resumeOnly: false,
		});
		const second = await createWorkflowPureCacheRequest({
			ownerId: "owner-1",
			node: textNode("node-b", { nested: { a: false, z: true }, alpha: 1 }),
			inputs: { input: [{ left: 1, right: 2 }] },
			resumeOnly: false,
		});

		expect(first?.cacheKey).toBe(second?.cacheKey);
		expect(first?.cacheKey).toMatch(/^[a-f0-9]{64}$/);
		const otherOwner = await createWorkflowPureCacheRequest({
			ownerId: "owner-2",
			node: textNode("node-c", { alpha: 1, nested: { z: true, a: false } }),
			inputs: { input: [{ right: 2, left: 1 }] },
			resumeOnly: false,
		});
		expect(otherOwner?.cacheKey).not.toBe(first?.cacheKey);
	});

	it("rejects a cache declaration for an executor without a server purity attestation", async () => {
		const node = textNode("unsafe");
		node.data.workflowAtomicSpec = {
			...(node.data.workflowAtomicSpec as Record<string, unknown>),
			executorRef: "tapcanvas.image.generate/v1",
		};
		await expect(createWorkflowPureCacheRequest({
			ownerId: "owner-1",
			node,
			inputs: {},
			resumeOnly: false,
		})).rejects.toThrow("no server purity attestation");
	});

	it("stores provenance, resolves an exact durable candidate, and rebinds only node identity", async () => {
		const request = await createWorkflowPureCacheRequest({
			ownerId: "owner-1",
			node: textNode("source-node"),
			inputs: {},
			resumeOnly: false,
		});
		if (!request) throw new Error("Expected cache request");
		const stored = recordWorkflowPureCacheStore({
			request,
			outputRefs: textOutput("source-node"),
			executionId: "execution-source",
			nodeRunId: "run-source",
		});
		const findMany = vi.fn(async () => [{
			id: "run-source",
			execution_id: "execution-source",
			output_refs: JSON.stringify(stored),
		}]);
		const db = {
			workflow_node_runs: { findMany },
		} as unknown as WorkerEnv["DB"];

		const hit = await findWorkflowPureCacheHit(db, "owner-1", request);
		expect(hit).not.toBeNull();
		if (!hit) throw new Error("Expected cache hit");
		const materialized = materializeWorkflowPureCacheHit({
			request,
			hit,
			node: textNode("target-node"),
		});
		expect(materialized.nodeId).toBe("target-node");
		expect(materialized.ports).toEqual(stored.ports);
		expect(materialized.evidence.workflowPureCache).toMatchObject({
			status: "hit",
			originExecutionId: "execution-source",
			originNodeRunId: "run-source",
			sourceExecutionId: "execution-source",
			sourceNodeRunId: "run-source",
		});
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({
				status: "success",
				workflow_executions: { owner_id: "owner-1" },
			}),
			take: 20,
		}));
	});

	it("refuses to persist an output containing execution-scoped artifact identities", async () => {
		const request = await createWorkflowPureCacheRequest({
			ownerId: "owner-1",
			node: textNode("node-a"),
			inputs: {},
			resumeOnly: false,
		});
		if (!request) throw new Error("Expected cache request");
		expect(() => recordWorkflowPureCacheStore({
			request,
			outputRefs: {
				...textOutput("node-a"),
				artifacts: [{ type: "tapcanvas.text/v1", identity: "execution-scoped", value: "hello" }],
			},
			executionId: "execution-a",
			nodeRunId: "run-a",
		})).toThrow("execution-scoped artifact identities");
	});
});
