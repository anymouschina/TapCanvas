import { describe, expect, it } from "vitest";
import { workflowAuthorDeliveryHash, normalizeResolvedWorkflowAuthorRepair, workflowAuthorRepairAttempt, type WorkflowAuthorRepairRequest } from "./execution.author-repair";
import { WorkflowSnapshotRerunRequestSchema } from "./execution.schemas";
import { prepareWorkflowOutputReuse, type WorkflowOutputReuseRepository } from "./execution.output-reuse";
import { prepareWorkflowExecutionSnapshotRerun } from "./execution.snapshot-runtime";

const deliveryArtifact = '{"items":[{"text":"retained actual candidate"}]}';
const repair = { version: 1 as const, sourceNodeRunId: "author-run", deliveryHash: workflowAuthorDeliveryHash(deliveryArtifact), sourceKind: "delivery_artifact" as const, idempotencyKey: "revision-1", diagnostic: "Current evidence identifies an unmet obligation; revise it within the original task." };
const node = (id: string, executorRef: string, inputs: string[], outputs: string[], extra: Record<string, unknown> = {}): { id: string; type: string; data: Record<string, unknown> } => ({ id, type: "taskNode", data: {
	kind: id === "trigger" ? "workflowTrigger" : "workflowStage", adminWorkflow: true, workflowInstanceId: "test", ...extra,
	workflowAtomicSpec: { version: 1, category: id === "author" ? "agent" : "source", operation: id, executorRef, executionMode: "once", inputPorts: inputs, outputPorts: outputs },
} });
const flow = {
	nodes: [node("trigger", "workflow.trigger/v1", [], ["trigger"]), node("author", "agents.logical-task/v2", ["trigger"], ["result"], {
		workflowAgentOutputEncoding: "json_artifact", workflowAgentFailurePolicy: "repair_with_correction", workflowAgentJsonObjectContract: { requiredKeys: ["items"] },
	}), node("media", "media.image.generate/v1", ["result"], ["image"])],
	edges: [{ source: "trigger", target: "author", sourceHandle: "out-workflow:trigger", targetHandle: "in-workflow:trigger" }, { source: "author", target: "media", sourceHandle: "out-workflow:result", targetHandle: "in-workflow:result" }],
	workflowExecutionScope: { triggerNodeId: "trigger" },
	workflowDirectAgentModelSelection: { model: "original", source: "user_preference" },
};
const output = (nodeId: string, executorRef: string, ports: Record<string, unknown>) => ({ protocolVersion: "1", nodeId, executorRef, executionMode: "once", ports, artifacts: [], evidence: { executorCompleted: true }, itemRuns: [] });
const authorRun = { id: "author-run", nodeId: "author", status: "success", outputRefs: output("author", "agents.logical-task/v2", { result: { text: deliveryArtifact } }) };
const triggerRun = { id: "trigger-run", nodeId: "trigger", status: "success", outputRefs: output("trigger", "workflow.trigger/v1", { trigger: { source: "frozen" } }) };
const resolve = (request: WorkflowAuthorRepairRequest = repair, runs = [triggerRun, authorRun], current = flow) => {
	const repository: WorkflowOutputReuseRepository = { loadExecutionBundle: async () => ({ flowData: flow, nodeRuns: runs }) };
	return prepareWorkflowOutputReuse({ flowData: current, flowId: "flow", ownerId: "owner", replay: { sourceExecutionId: "old", startFromNodeId: "author", authorRepair: request }, repository });
};

describe("immutable successful author diagnostic repair", () => {
	it("binds explicit field authorization into request identity and successful source receipt", async () => {
		const request = { ...repair, editablePaths: ["/items/0/text"] };
		const result = await resolve(request);
		expect(normalizeResolvedWorkflowAuthorRepair(result.workflowResolvedAuthorRepair)?.editablePaths).toEqual(request.editablePaths);
		expect(workflowAuthorRepairAttempt(request, "old", "author").requestHash).not.toBe(workflowAuthorRepairAttempt(repair, "old", "author").requestHash);
		for (const editablePaths of [[], ["relative"], ["/items", "/items/0"]]) {
			expect(WorkflowSnapshotRerunRequestSchema.safeParse({ startFromNodeId: "author", stopAfterNodeId: "author", authorRepair: { ...repair, editablePaths } }).success).toBe(false);
		}
		await expect(resolve({ ...repair, editablePaths: ["/missing"] })).rejects.toThrow("edit_scope_admission_invalid");
	});
	it("requires one explicit author boundary and rejects client candidate/model/source overrides", () => {
		const request = { startFromNodeId: "author", stopAfterNodeId: "author", authorRepair: repair };
		expect(WorkflowSnapshotRerunRequestSchema.parse(request)).toEqual(request);
		for (const invalid of [{ ...request, stopAfterNodeId: "media" }, { authorRepair: repair },
			{ ...request, model: "other" }, { ...request, authorRepair: { ...repair, candidate: "forged raw" } }, { ...request, authorRepair: { ...repair, sourceContext: "other" } }]) {
			expect(WorkflowSnapshotRerunRequestSchema.safeParse(invalid).success).toBe(false);
		}
	});
	it("resolves the real successful candidate while preserving source runs and frozen model", async () => {
		const before = structuredClone({ flow, authorRun });
		const result = await resolve();
		const { idempotencyKey: _attemptKey, ...evidenceRequest } = repair;
		expect(result.workflowResolvedAuthorRepair).toEqual({ ...evidenceRequest, sourceExecutionId: "old", targetNodeId: "author", deliveryArtifact });
		expect(result.workflowAuthorRepairAttempt).toMatchObject({ version: 1, idempotencyKey: repair.idempotencyKey });
		expect(result.workflowDirectAgentModelSelection).toEqual(flow.workflowDirectAgentModelSelection);
		expect({ flow, authorRun }).toEqual(before);
	});
	it("refuses stale candidate and wrong source identity", async () => {
		await expect(resolve({ ...repair, deliveryHash: workflowAuthorDeliveryHash("other") })).rejects.toThrow("runtime_author_revision_evidence_invalid");
		await expect(resolve({ ...repair, sourceNodeRunId: "other" })).rejects.toThrow("frozen_contract_changed");
		await expect(resolve(repair, [triggerRun, { ...authorRun, status: "failed" }])).rejects.toThrow("source_run_invalid");
	});
	it("does not use feedback to replay incomplete upstream actions or changed author contracts", async () => {
		await expect(resolve(repair, [{ ...triggerRun, status: "failed" }, authorRun])).rejects.toThrow("upstream_receipts_incomplete");
		const current = structuredClone(flow); current.nodes[1].data.workflowAgentFailurePolicy = "single_submission";
		await expect(resolve(repair, [triggerRun, authorRun], current)).rejects.toThrow("frozen_contract_changed");
	});
	it("uses compiled delivery only as evidence even when raw author bytes differ", async () => {
		const rawAuthor = '{"wrapper":{"items":[{"text":"retained actual candidate"}]}}';
		const run = { ...authorRun, outputRefs: { ...authorRun.outputRefs,
			evidence: { executorCompleted: true, structuredOutputReview: { candidateHash: workflowAuthorDeliveryHash(rawAuthor) } } } };
		const result = await resolve(repair, [triggerRun, run]);
		const evidence = normalizeResolvedWorkflowAuthorRepair(result.workflowResolvedAuthorRepair)!;
		expect(evidence.sourceKind).toBe("delivery_artifact");
		expect(evidence.deliveryArtifact).toBe(deliveryArtifact);
		expect(evidence.deliveryHash).not.toBe(workflowAuthorDeliveryHash(rawAuthor));
		expect(evidence).not.toHaveProperty("candidate");
		expect(evidence).not.toHaveProperty("contractHash");
		expect(result).not.toHaveProperty("structuredOutputRepair");
	});
	it("drops a prior repair receipt on ordinary rerun and excludes the media descendant", async () => {
		const result = await resolve();
		const next = prepareWorkflowExecutionSnapshotRerun(result, { startFromNodeId: "author", stopAfterNodeId: "author" });
		expect(next.data.workflowResolvedAuthorRepair).toBeUndefined();
		expect(next.data.workflowAuthorRepairAttempt).toBeUndefined();
		expect((next.data.nodes as { id: string }[]).map(node => node.id)).toEqual(["trigger", "author"]);
		expect(next.data.workflowDirectAgentModelSelection).toEqual(flow.workflowDirectAgentModelSelection);
	});
	it("does not replay an accepted unsettled ancestor during explicit consumer replay", async () => {
		const repository: WorkflowOutputReuseRepository = { loadExecutionBundle: async () => ({ flowData: flow,
			nodeRuns: [{ ...triggerRun, status: "running" }, authorRun] }) };
		await expect(prepareWorkflowOutputReuse({ flowData: flow, flowId: "flow", ownerId: "owner",
			replay: { sourceExecutionId: "old", startFromNodeId: "author", requireSuccessfulAncestors: true }, repository })).rejects.toThrow("upstream_receipt_not_settled");
	});
	it("normalizes only a hash-bound delivery receipt and retains diagnostic as observation text", async () => {
		const result = await resolve();
		expect(normalizeResolvedWorkflowAuthorRepair(result.workflowResolvedAuthorRepair)?.diagnostic).toBe(repair.diagnostic);
		expect(() => normalizeResolvedWorkflowAuthorRepair({ ...(result.workflowResolvedAuthorRepair as Record<string, unknown>), deliveryArtifact: "replacement" })).toThrow("runtime_author_revision_evidence_invalid");
	});
});
