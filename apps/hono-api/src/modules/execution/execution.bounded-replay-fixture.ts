import liveDefinition from "./testfixtures/bounded-author-consumer.json";
import type { WorkflowOutputReuseRepository } from "./execution.output-reuse";

type FixtureNode = Readonly<{ id: string; data: Record<string, unknown> }>;
type FixtureEdge = { source: string; target: string; sourceHandle: string; targetHandle: string };

/** Actual saved atomic port/artifact/pipeline binding contracts with fixture identities and creative instructions removed. */
export function boundedReplayFixture() {
	const live = structuredClone(liveDefinition) as unknown as { nodes: FixtureNode[]; edges: FixtureEdge[] };
	const ancestorIds = new Set(["trigger", "source", "contract", "author"]);
	const source = structuredClone({ nodes: live.nodes.filter(n => ancestorIds.has(n.id)), edges: live.edges.filter(e => ancestorIds.has(e.source) && ancestorIds.has(e.target)) });
	const nodeRuns = source.nodes.map(n => {
		const spec = n.data.workflowAtomicSpec as { executorRef: string; outputPorts: string[] } | undefined;
		const executorRef = spec?.executorRef ?? "workflow.trigger/v1";
		const ports = spec?.outputPorts ?? ["trigger"];
		return { id: `receipt-${n.id}`, nodeId: n.id, status: "success", outputRefs: { protocolVersion: "1", nodeId: n.id, executorRef, executionMode: "once",
			ports: Object.fromEntries(ports.map(port => [port, { text: `delivered-${n.id}` }])), artifacts: [], evidence: { executorCompleted: true }, itemRuns: [] } };
	});
	const repository: WorkflowOutputReuseRepository = { loadExecutionBundle: async () => ({ flowData: source, nodeRuns }) };
	return { source, live, nodeRuns, repository };
}
