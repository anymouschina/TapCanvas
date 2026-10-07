import { Prisma, type PrismaClient } from "@prisma/client";
import { decodeWorkflowOutput } from "./execution.output-storage";
import { resolveWorkflowWaitingReason, type WorkflowWaitingReason } from "./execution.workflow-waiting-reason";

export type ExecutionHistoryNodeMetadata = Readonly<{
	node_id: string;
	status: string;
	error_message: string | null;
	created_at: string;
}>;

export type ExecutionHistoryFocus = Readonly<{
	node: ExecutionHistoryNodeMetadata;
	label: string;
	waitingReason: WorkflowWaitingReason | null;
}>;

const PRIORITY: Readonly<Record<string, number>> = {
	failed: 0, waiting_external: 1, running: 2, queued: 3,
	canceled: 4, success: 5, skipped: 6, not_selected: 7,
};

export function selectExecutionHistoryFocus(nodes: readonly ExecutionHistoryNodeMetadata[]): ExecutionHistoryNodeMetadata | null {
	let focus: ExecutionHistoryNodeMetadata | null = null;
	for (const node of nodes) {
		const priority = PRIORITY[node.status] ?? 99;
		if (priority > 3) continue;
		if (!focus || priority < (PRIORITY[focus.status] ?? 99)
			|| (priority === PRIORITY[focus.status] && node.created_at.localeCompare(focus.created_at) < 0)) focus = node;
	}
	return focus;
}

type HistoryMetadata = Readonly<{
	id: string;
	flow_version_id: string;
	workflow_node_runs: readonly ExecutionHistoryNodeMetadata[];
}>;

type FocusLabelRow = Readonly<{
	flow_version_id: string;
	node_id: string;
	snapshot_type: string | null;
	nodes_type: string | null;
	label: string | null;
	workflow_node_id: string | null;
}>;

/** No full snapshot or successful-node outputs cross the connection for a list. */
export async function hydrateExecutionHistoryFocus<T extends HistoryMetadata>(
	prisma: Pick<PrismaClient, "$queryRaw" | "workflow_node_runs">,
	rows: readonly T[],
): Promise<Array<T & { focus_node: ExecutionHistoryFocus | null }>> {
	const focuses = rows.map((row) => selectExecutionHistoryFocus(row.workflow_node_runs));
	const requested = rows.flatMap((row, index) => focuses[index]
		? [{ flow_version_id: row.flow_version_id, node_id: focuses[index]!.node_id }] : []);
	const labels = requested.length === 0 ? [] : await prisma.$queryRaw<FocusLabelRow[]>(Prisma.sql`
		SELECT wanted.flow_version_id, wanted.node_id,
			jsonb_typeof(snapshot.value) AS snapshot_type,
			jsonb_typeof(snapshot.value->'nodes') AS nodes_type,
			CASE WHEN jsonb_typeof(focus.value#>'{data,label}') = 'string'
				THEN focus.value#>>'{data,label}' END AS label,
			CASE WHEN jsonb_typeof(focus.value#>'{data,workflowNodeId}') = 'string'
				THEN focus.value#>>'{data,workflowNodeId}' END AS workflow_node_id
		FROM (SELECT DISTINCT flow_version_id, node_id FROM jsonb_to_recordset(${JSON.stringify(requested)}::jsonb)
			AS request(flow_version_id text, node_id text)) AS wanted
		JOIN flow_versions AS version ON version.id = wanted.flow_version_id
		CROSS JOIN LATERAL (SELECT version.data::jsonb AS value OFFSET 0) AS snapshot
		CROSS JOIN LATERAL (SELECT jsonb_path_query_first(snapshot.value,
			'$.nodes[*] ? (@.id == $nodeId)', jsonb_build_object('nodeId', wanted.node_id)) AS value OFFSET 0) AS focus
	`);
	const labelsByVersion = new Map<string, Map<string, FocusLabelRow>>();
	for (const label of labels) {
		if (label.snapshot_type !== "object" || label.nodes_type !== "array") {
			throw new Error("Workflow execution history immutable flow snapshot must contain nodes");
		}
		let byNode = labelsByVersion.get(label.flow_version_id);
		if (!byNode) { byNode = new Map(); labelsByVersion.set(label.flow_version_id, byNode); }
		byNode.set(label.node_id, label);
	}
	const result: Array<T & { focus_node: ExecutionHistoryFocus | null }> = [];
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index]!;
		const node = focuses[index];
		if (!node) { result.push({ ...row, focus_node: null }); continue; }
		const label = labelsByVersion.get(row.flow_version_id)?.get(node.node_id);
		if (!label) throw new Error(`Workflow history snapshot missing for ${row.id}/${node.node_id}`);
		let waitingReason: WorkflowWaitingReason | null = null;
		if (node.status === "waiting_external") {
			// Read one receipt at a time, project it immediately, and release it.
			// A page of waiting runs must not retain every multi-MB output at once.
			const receipt = await prisma.workflow_node_runs.findUnique({
				where: { execution_id_node_id: { execution_id: row.id, node_id: node.node_id } },
				select: { output_refs: true },
			});
			if (!receipt) throw new Error(`Workflow history waiting receipt missing for ${row.id}/${node.node_id}`);
			waitingReason = resolveWorkflowWaitingReason(decodeWorkflowOutput(receipt.output_refs));
		}
		result.push({ ...row, focus_node: {
			node, label: label.label?.trim() || label.workflow_node_id?.trim() || node.node_id, waitingReason,
		} });
	}
	return result;
}
