import { describe, expect, it } from "vitest";
import { bindWorkflowNestedAgentRepairSources } from "./execution.nested-agent-repair-source";
import { workflowAgentPublicTurnId, workflowAgentSessionKey } from "./execution.agent-identity";
import type { WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";

function node(id: string, executorRef: string, mode: "once" | "each"): WorkflowNodeSnapshot {
	return { id, kind: "workflowStage", type: "taskNode", data: { workflowAgentOutputEncoding: "json_object",
		workflowAtomicSpec: { version: 1, category: "agent", operation: "run", executorRef, executionMode: mode,
			inputPorts: ["input"], outputPorts: ["result"], inputArtifactTypes: { input: ["test/value"] },
			outputArtifactTypes: { result: ["test/value"] } } } };
}
function output(id: string, executorRef: string, mode: "once" | "each"): WorkflowNodeOutputV1 {
	return { protocolVersion: "1", nodeId: id, executorRef, executionMode: mode,
		ports: {}, artifacts: [], itemRuns: [], evidence: { executorCompleted: false } };
}
function paidEvidence(id: string, source = "source") {
	const identity = { executionId: source, nodeId: id, physicalRetryOrdinal: null };
	return { executorCompleted: false, deliveryEvidence: { sessionKey: workflowAgentSessionKey(identity),
		logicalTaskId: workflowAgentPublicTurnId(identity), recoveryCheckpoint: { physicalRunId: "paid-run", reasonCode: "unknown_submission" } },
		paidDiagnostic: { candidateHash: "sha256:original", cursor: { phase: "inference_attempted" } } };
}
function fixture(mode: "once" | "each" = "each") {
	const root = node("pipeline", "workflow.pipeline.run/v1", mode);
	const writer = node("write", "agents.logical-task/v2", "each");
	root.data.workflowPipeline = { protocolVersion: "workflow.pipeline.run/v1", inputs: [{ portId: "input", mode: "value", artifactTypes: ["test/value"] }],
		steps: [{ stepId: "write", node: writer }, { stepId: "media", node: node("media", "tapcanvas.video.generate/v1", "once") }],
		bindings: [{ from: { kind: "input", portId: "input" }, to: { stepId: "write", portId: "input" }, mode: "value" },
			{ from: { kind: "step", stepId: "write", portId: "result" }, to: { stepId: "media", portId: "input" }, mode: "value" }],
		outputs: [{ portId: "result", from: { stepId: "media", portId: "result" }, mode: "value" }] };
	const runtime = mode === "each" ? "pipeline::item::outer" : "pipeline";
	const authorId = `${runtime}::step::write`;
	const leafId = `${authorId}::item::failed`;
	const author: WorkflowNodeOutputV1 = { ...output(authorId, "agents.logical-task/v2", "each"), itemRuns: [
		{ itemId: "failed", index: 0, runtimeNodeId: leafId, status: "failed" as const, lineage: [], ports: {}, artifacts: [], evidence: paidEvidence(leafId) },
		{ itemId: "success", index: 1, runtimeNodeId: `${authorId}::item::success`, status: "success" as const, lineage: [], ports: { result: "old delivery" }, artifacts: [], evidence: { executorCompleted: true } },
		{ itemId: "waiting", index: 2, runtimeNodeId: `${authorId}::item::waiting`, status: "waiting_external" as const, lineage: [], ports: {}, artifacts: [], evidence: { taskId: "accepted-media-receipt" } },
	] };
	const state = { protocolVersion: "workflow.pipeline.state/v1", cursorStepId: "write", steps: {
		write: { status: "failed", outputRefs: author },
		media: { status: "success", outputRefs: { ...output(`${runtime}::step::media`, "tapcanvas.video.generate/v1", "once"), ports: { result: "actual-video-url" } } } } };
	const receipt = output("pipeline", "workflow.pipeline.run/v1", mode);
	if (mode === "once") receipt.evidence.pipelineState = state;
	else receipt.itemRuns = [{ itemId: "outer", index: 0, status: "failed", runtimeNodeId: runtime, lineage: [], ports: {}, artifacts: [], evidence: { pipelineState: state } }];
	return { root, receipt, leafId, state, author };
}
function leaves(receipt: WorkflowNodeOutputV1) {
	const evidence = receipt.executionMode === "each" ? receipt.itemRuns[0].evidence : receipt.evidence;
	return (evidence.pipelineState as { steps: { write: { outputRefs: WorkflowNodeOutputV1 } } }).steps.write.outputRefs.itemRuns;
}
describe("nested failed structured author recovery sources", () => {
	it("binds the exact each/pipeline/each failed leaf and preserves successful and accepted siblings", () => {
		const f = fixture(); const before = structuredClone(f);
		const result = bindWorkflowNestedAgentRepairSources({ node: f.root, output: f.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true });
		expect(leaves(result)[0].evidence.agentRepairSource).toEqual({
			sessionKey: workflowAgentSessionKey({ executionId: "source", nodeId: f.leafId, physicalRetryOrdinal: null }),
			turnId: workflowAgentPublicTurnId({ executionId: "source", nodeId: f.leafId, physicalRetryOrdinal: null }), sourceExecutionId: "source" });
		expect(leaves(result)[0].evidence.paidDiagnostic).toEqual(f.author.itemRuns[0].evidence.paidDiagnostic);
		expect(leaves(result).slice(1)).toEqual(f.author.itemRuns.slice(1)); expect(f).toEqual(before);
		const next = bindWorkflowNestedAgentRepairSources({ node: f.root, output: result, sourceExecutionId: "recovery-member", sourceNodeRunId: "source-run", preserveAgentRepair: true });
		expect(next).toEqual(result); // original source owner survives another derived recovery.
	});
	it("retains a once pipeline whose only persisted step is a failed paid author", () => {
		const f = fixture("once"); delete (f.state.steps as Partial<typeof f.state.steps>).media;
		const result = bindWorkflowNestedAgentRepairSources({ node: f.root, output: f.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true });
		expect(leaves(result)[0].evidence.agentRepairSource).toBeDefined();
		expect(result.evidence.executorCompleted).toBe(false);
	});
	it("does not join an explicitly independent attempt, plain-text work, or failed media to old author drafts", () => {
		const f = fixture();
		expect(bindWorkflowNestedAgentRepairSources({ node: f.root, output: f.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: false })).toBe(f.receipt);
		const text = node("text", "agents.logical-task/v2", "once"); text.data.workflowAgentOutputEncoding = "plain_text";
		const o = { ...output("text", "agents.logical-task/v2", "once"), evidence: paidEvidence("text") };
		expect(bindWorkflowNestedAgentRepairSources({ node: text, output: o, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toEqual(o);
		const media = node("media", "tapcanvas.video.generate/v1", "once");
		const m = { ...output("media", "tapcanvas.video.generate/v1", "once"), evidence: paidEvidence("media") };
		expect(bindWorkflowNestedAgentRepairSources({ node: media, output: m, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toEqual(m);
	});
	it("rejects mismatched source owner, forged runtime item IDs, executor/definition drift and retained receipt conflicts", () => {
		const f = fixture(); const call = () => bindWorkflowNestedAgentRepairSources({ node: f.root, output: f.receipt, sourceExecutionId: "wrong-owner", sourceNodeRunId: "source-run", preserveAgentRepair: true });
		expect(call).toThrow("identity_mismatch");
		const forged = structuredClone(f); forged.author.itemRuns = [{ ...forged.author.itemRuns[0], runtimeNodeId: "forged" }, ...forged.author.itemRuns.slice(1)];
		expect(() => bindWorkflowNestedAgentRepairSources({ node: forged.root, output: forged.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toThrow("item_identity_invalid");
		const drift = structuredClone(f); drift.author.executorRef = "tapcanvas.video.generate/v1";
		expect(() => bindWorkflowNestedAgentRepairSources({ node: drift.root, output: drift.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toThrow("receipt_identity_invalid");
		const conflict = structuredClone(f); conflict.author.itemRuns[0].evidence.agentRepairSource = { sessionKey: "wrong", turnId: "wrong" };
		expect(() => bindWorkflowNestedAgentRepairSources({ node: conflict.root, output: conflict.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toThrow("retained_source_identity_invalid");
	});
	it("preserves an absent pipeline checkpoint but rejects malformed state and unverifiable retained sources", () => {
		const f = fixture("once"); delete f.receipt.evidence.pipelineState;
		expect(bindWorkflowNestedAgentRepairSources({ node: f.root, output: f.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toBe(f.receipt);
		f.receipt.evidence.pipelineState = { protocolVersion: "broken", steps: {} };
		expect(() => bindWorkflowNestedAgentRepairSources({ node: f.root, output: f.receipt, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toThrow("pipeline_state_invalid");
		const author = node("author", "agents.logical-task/v2", "once");
		const o = output("author", "agents.logical-task/v2", "once");
		o.evidence.agentRepairSource = { sessionKey: "unverified", turnId: "unverified", sourceExecutionId: "source" };
		expect(() => bindWorkflowNestedAgentRepairSources({ node: author, output: o, sourceExecutionId: "source", sourceNodeRunId: "source-run", preserveAgentRepair: true })).toThrow("retained_source_unverifiable");
	});
});

it("binds trace-only structured author recovery to its genuine nested source while preserving accepted siblings", () => {
 const f = fixture(); const before = structuredClone(f);
 f.author.itemRuns = [{ ...f.author.itemRuns[0], evidence: { executorCompleted: false, outputContractFailure: { code: "structured_output_invalid", rawOutputRecorded: "agents_cli_trace" } } }, ...f.author.itemRuns.slice(1)];
 const output = bindWorkflowNestedAgentRepairSources({ node: f.root, output: f.receipt, sourceExecutionId: "source", sourceNodeRunId: "real-parent-run", preserveAgentRepair: true });
 const state = output.itemRuns[0].evidence.pipelineState as { steps: { write: { outputRefs: WorkflowNodeOutputV1 } } };
 expect(state.steps.write.outputRefs.itemRuns[0].evidence.agentInitialRecovery).toMatchObject({ sourceExecutionId: "source", sourceNodeRunId: "real-parent-run", nodeId: f.author.itemRuns[0].runtimeNodeId });
 expect(state.steps.write.outputRefs.itemRuns[1]).toEqual(before.author.itemRuns[1]);
 expect(f.author.itemRuns[0].evidence.agentInitialRecovery).toBeUndefined();
});
