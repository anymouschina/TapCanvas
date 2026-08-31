import { parseWorkflowNodeProvenanceV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	parseWorkflowInputContractRejectionV1,
	type WorkflowRejectedInputBindingV1,
} from "./execution.input-contract";
import {
	findWorkflowNode,
	parseWorkflowNodeOutputV1,
	resolveWorkflowNodeExecutorRef,
} from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import type { NodeRunRow } from "./execution.repo";

export type WorkflowRecoveryFrontierDecision = Readonly<{
	invalidatedNodeIds: readonly string[];
	mode: "input_contract_lineage" | "failed_node";
	rejectedBindingCount: number;
	unresolvedBindingCount: number;
}>;

function recordedProvenance(run: NodeRunRow) {
	const output = parseWorkflowNodeOutputV1(run.output_refs);
	if (!output) return null;
	try {
		return parseWorkflowNodeProvenanceV1(output.evidence.workflowProvenance);
	} catch {
		return null;
	}
}

function resolveReauthorableProducer(input: Readonly<{
	binding: WorkflowRejectedInputBindingV1;
	nodeRunsById: ReadonlyMap<string, NodeRunRow>;
	flowData: unknown;
	failedExecutionId: string;
}>): string | null {
	let currentRunId = input.binding.sourceNodeRunId;
	const visitedRunIds = new Set<string>();
	for (let depth = 0; depth < 64; depth += 1) {
		if (visitedRunIds.has(currentRunId)) return null;
		visitedRunIds.add(currentRunId);
		const run = input.nodeRunsById.get(currentRunId);
		if (!run || run.execution_id !== input.failedExecutionId) return null;
		let node;
		try {
			node = findWorkflowNode(input.flowData, run.node_id);
		} catch {
			return null;
		}
		const executorRef = resolveWorkflowNodeExecutorRef(node);
		if (!executorRef) return null;
		if (executorRef === "agents.logical-task/v2") return node.id;
		const semantics = resolveCoreWorkflowExecutorSemantics(executorRef);
		if (!semantics || semantics.sideEffect !== "none") return null;
		const provenance = recordedProvenance(run);
		if (!provenance || provenance.executionId !== input.failedExecutionId) return null;
		// A pure one-input transform has one unambiguous upstream author. With
		// multiple inputs, the current provenance protocol does not map an output
		// artifact back to one particular input, so recovery must not guess.
		if (provenance.inputBindings.length !== 1) return null;
		currentRunId = provenance.inputBindings[0]!.sourceNodeRunId;
	}
	return null;
}

/**
 * Resolve rerun roots from the exact input binding rejected by a consumer.
 * This is the durable counterpart of n8n's explicit dirty-node frontier, but
 * derives dirtiness from typed contract evidence instead of node names or
 * graph proximity. Ambiguous provenance never broadens recovery to a sibling.
 */
export function resolveWorkflowRecoveryFrontier(input: Readonly<{
	failedNode: NodeRunRow;
	nodeRuns: readonly NodeRunRow[];
	flowData: unknown;
}>): WorkflowRecoveryFrontierDecision {
	const failedOutput = parseWorkflowNodeOutputV1(input.failedNode.output_refs);
	const rejection = (() => {
		try {
			return parseWorkflowInputContractRejectionV1(
				failedOutput?.evidence.inputContractRejection,
			);
		} catch {
			return null;
		}
	})();
	if (failedOutput?.evidence.inputContractRejection !== undefined && !rejection) {
		return {
			invalidatedNodeIds: [input.failedNode.node_id],
			mode: "failed_node",
			rejectedBindingCount: 0,
			unresolvedBindingCount: 0,
		};
	}
	if (!rejection || rejection.consumerNodeId !== input.failedNode.node_id) {
		return {
			invalidatedNodeIds: [input.failedNode.node_id],
			mode: "failed_node",
			rejectedBindingCount: 0,
			unresolvedBindingCount: 0,
		};
	}
	const nodeRunsById = new Map(input.nodeRuns.map((run) => [run.id, run] as const));
	const producerNodeIds = new Set<string>();
	let unresolvedBindingCount = 0;
	for (const binding of rejection.rejectedBindings) {
		const producerNodeId = resolveReauthorableProducer({
			binding,
			nodeRunsById,
			flowData: input.flowData,
			failedExecutionId: input.failedNode.execution_id,
		});
		if (producerNodeId) producerNodeIds.add(producerNodeId);
		else unresolvedBindingCount += 1;
	}
	if (producerNodeIds.size === 0 || unresolvedBindingCount > 0) {
		return {
			invalidatedNodeIds: [input.failedNode.node_id],
			mode: "failed_node",
			rejectedBindingCount: rejection.rejectedBindings.length,
			unresolvedBindingCount,
		};
	}
	return {
		invalidatedNodeIds: [...producerNodeIds].sort(),
		mode: "input_contract_lineage",
		rejectedBindingCount: rejection.rejectedBindings.length,
		unresolvedBindingCount: 0,
	};
}
