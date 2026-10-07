import { z } from "zod";
import { parseWorkflowPipelineRunSpec } from "@tapcanvas/workflow-kernel-protocol";
import { normalizeAuthorRevisionEvidence } from "../../../../../packages/schemas/author-revision-evidence/index.cjs";
import { workflowAuthorRepairAttempt } from "./execution.author-repair";
import { readWorkflowAuthorRepairSelection } from "./execution.author-repair-target";
import { workflowConsumerReplaySelectionAttempt } from "./execution.consumer-replay-selection";
import { workflowAgentRepairSource } from "./execution.agent-repair-handoff";
import { findWorkflowNode, parseWorkflowNodeOutputV1, resolveWorkflowNodeExecutionMode,
	resolveWorkflowNodeExecutorRef, type WorkflowNodeOutputV1, type WorkflowNodeSnapshot } from "./execution.node-runtime";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonical(value: unknown): string {
	const ordered = (input: unknown): unknown => Array.isArray(input) ? input.map(ordered)
		: record(input) ? Object.fromEntries(Object.keys(input).sort().map(key => [key, ordered(input[key])])) : input;
	return JSON.stringify(ordered(value)) ?? "undefined";
}
const attemptSchema = z.object({ version: z.literal(1), idempotencyKey: z.string().min(1),
	requestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
const frozenInvocationFields = ["workflowExecutionScope", "workflowProjectContext", "workflowCallerCanvasSnapshot",
	"workflowDeliveryScope", "workflowDirectAgentModelSelection", "workflowInitiatingAgentExecution",
	"workflowSourceSnapshots", "workflowReplayInvocation", "workflowExecutionSemantics"] as const;

/** Recovery inherits a server-owned admitted operation; it never creates another repair attempt. */
export function inheritWorkflowRecoveryInvocation(input: Readonly<{
	source: Record<string, unknown>; current: Record<string, unknown>;
}>): Record<string, unknown> {
	const receipt = normalizeAuthorRevisionEvidence(input.source.workflowResolvedAuthorRepair);
	const selection = readWorkflowAuthorRepairSelection(input.source);
	if ((receipt && (selection?.mode === "consumer_replay" || input.source.workflowConsumerReplayAttempt !== undefined))
		|| (selection?.mode === "consumer_replay" && input.source.workflowAuthorRepairAttempt !== undefined)) {
		throw new Error("workflow_recovery_invocation_modes_conflict");
	}
	if (!receipt && !selection) {
		if (input.source.workflowAuthorRepairAttempt !== undefined || input.source.workflowConsumerReplayAttempt !== undefined) {
			throw new Error("workflow_recovery_invocation_receipt_missing");
		}
		return {};
	}
	const scope = input.source.workflowExecutionScope;
	if (!record(scope) || typeof scope.triggerNodeId !== "string" || !scope.triggerNodeId.trim()
		|| scope.stopAfterNodeId !== (selection?.rootNodeId ?? receipt?.targetNodeId)) {
		throw new Error("workflow_recovery_bounded_scope_incomplete");
	}
	for (const field of frozenInvocationFields) {
		if (canonical(input.source[field]) !== canonical(input.current[field])) {
			throw new Error(`workflow_recovery_frozen_invocation_changed:${field}`);
		}
	}
	const inherited: Record<string, unknown> = {};
	if (selection) {
		let node = findWorkflowNode(input.current, selection.rootNodeId);
		let unboxed = false;
		for (const segment of selection.route) {
			if (segment.nodeId !== node.id) throw new Error("workflow_recovery_invocation_route_identity_invalid");
			if (segment.kind === "item") {
				if (unboxed || resolveWorkflowNodeExecutionMode(node) !== "each") throw new Error("workflow_recovery_invocation_item_contract_invalid");
				node = { ...node, id: `${node.id}::item::${encodeURIComponent(segment.itemId)}` }; unboxed = true;
			} else {
				if (resolveWorkflowNodeExecutorRef(node) !== "workflow.pipeline.run/v1"
					|| (!unboxed && resolveWorkflowNodeExecutionMode(node) !== "once")) throw new Error("workflow_recovery_invocation_pipeline_contract_invalid");
				const step = parseWorkflowPipelineRunSpec(node.data.workflowPipeline).steps.find(candidate => candidate.stepId === segment.stepId);
				if (!step) throw new Error("workflow_recovery_invocation_step_missing");
				node = { ...step.node, id: `${node.id}::step::${encodeURIComponent(segment.stepId)}` }; unboxed = false;
			}
		}
		if (node.id !== selection.targetNodeId || resolveWorkflowNodeExecutorRef(node) !== "agents.logical-task/v2"
			|| (!unboxed && resolveWorkflowNodeExecutionMode(node) !== "once")) throw new Error("workflow_recovery_invocation_author_identity_invalid");
		inherited.workflowAuthorRepairSelection = structuredClone(selection);
	}
	if (receipt) {
		const target = selection?.rootNodeId ?? receipt.targetNodeId;
		if (!selection && resolveWorkflowNodeExecutorRef(findWorkflowNode(input.current, target)) !== "agents.logical-task/v2") {
			throw new Error("workflow_recovery_invocation_author_identity_invalid");
		}
		const attempt = attemptSchema.parse(input.source.workflowAuthorRepairAttempt);
		const expected = workflowAuthorRepairAttempt({ version: 1, sourceKind: receipt.sourceKind,
			sourceNodeRunId: receipt.sourceNodeRunId, deliveryHash: receipt.deliveryHash, diagnostic: receipt.diagnostic,
			idempotencyKey: attempt.idempotencyKey, ...(selection ? { targetPath: selection.route.map(segment => segment.kind === "item"
				? { kind: "item" as const, itemId: segment.itemId } : { kind: "step" as const, stepId: segment.stepId }) } : {}) }, receipt.sourceExecutionId, target);
		if (canonical(attempt) !== canonical(expected)) throw new Error("workflow_recovery_invocation_attempt_mismatch");
		inherited.workflowResolvedAuthorRepair = structuredClone(receipt);
		inherited.workflowAuthorRepairAttempt = structuredClone(attempt);
	} else if (selection?.consumer) {
		const attempt = attemptSchema.parse(input.source.workflowConsumerReplayAttempt);
		const expected = workflowConsumerReplaySelectionAttempt({ version: 1, sourceNodeRunId: selection.sourceNodeRunId,
			deliveryHash: selection.deliveryHash, idempotencyKey: attempt.idempotencyKey,
			startStepId: selection.consumer.startStepId, stopStepId: selection.consumer.stopStepId,
			targetPath: selection.route.map(segment => segment.kind === "item" ? { kind: "item" as const, itemId: segment.itemId }
				: { kind: "step" as const, stepId: segment.stepId }) }, selection.sourceExecutionId, selection.rootNodeId);
		if (canonical(attempt) !== canonical(expected)) throw new Error("workflow_recovery_invocation_attempt_mismatch");
		inherited.workflowConsumerReplayAttempt = structuredClone(attempt);
	}
	return inherited;
}

/** A database observation failure is not evidence that a compound author action was never submitted. */
export function assertWorkflowRecoveryObservationReceipt(input: Readonly<{
	node: WorkflowNodeSnapshot; output: WorkflowNodeOutputV1; sourceExecutionId: string; invocation: Record<string, unknown>;
}>): void {
	const selection = readWorkflowAuthorRepairSelection(input.invocation);
	// A consumer attempt executes only deterministic consumer steps, never its historical author.
	if (selection?.mode === "consumer_replay") return;
	const author = normalizeAuthorRevisionEvidence(input.invocation.workflowResolvedAuthorRepair);
	if (!author || input.node.id !== (selection?.rootNodeId ?? author.targetNodeId)) return;
	const walk = (node: WorkflowNodeSnapshot, output: WorkflowNodeOutputV1): void => {
		const restriction = selection?.route.find(segment => segment.nodeId === node.id);
		if (output.executionMode === "each") {
			for (const item of output.itemRuns) if (item.status === "failed" && (!restriction || (restriction.kind === "item" && restriction.itemId === item.itemId))) walk({ ...node, id: item.runtimeNodeId }, {
				...output, nodeId: item.runtimeNodeId, executionMode: "once", itemRuns: [], evidence: item.evidence,
				ports: item.ports, artifacts: item.artifacts });
			return;
		}
		if (output.executorRef === "workflow.pipeline.run/v1") {
			const state = output.evidence.pipelineState;
			if (!record(state) || !record(state.steps)) return;
			const spec = parseWorkflowPipelineRunSpec(node.data.workflowPipeline);
			for (const [stepId, receipt] of Object.entries(state.steps)) {
				if (restriction && (restriction.kind !== "step" || restriction.stepId !== stepId)) continue;
				if (!record(receipt) || receipt.status !== "failed") continue;
				const step = spec.steps.find(candidate => candidate.stepId === stepId);
				const child = parseWorkflowNodeOutputV1(receipt.outputRefs);
				if (step && child) walk({ ...step.node, id: child.nodeId }, child);
			}
			return;
		}
		if (node.id !== author.targetNodeId || output.executorRef !== "agents.logical-task/v2" || !record(output.evidence.observationFailure)) return;
		const retained = output.evidence.agentRepairSource;
		const sourceExecutionId = record(retained) && typeof retained.sourceExecutionId === "string"
			? retained.sourceExecutionId : input.sourceExecutionId;
		if (!workflowAgentRepairSource({ evidence: output.evidence, sourceExecutionId, nodeId: output.nodeId })) {
			throw new Error(`workflow_recovery_agent_admission_unverified:${output.nodeId}`);
		}
	};
	walk(input.node, input.output);
}
