import { VIDEO_RUN_STATUS_PROJECTION_OWNER } from "@tapcanvas/video-orchestrator-protocol";
import {
	isWorkflowExecutionProjectionNode,
	WORKFLOW_EXECUTION_PROJECTION_OWNER,
} from "./flow.workflow-execution-projection";

type FlowRecord = Record<string, unknown>;

const MANAGED_PROJECTION_OWNERS: ReadonlySet<string> = new Set([
	VIDEO_RUN_STATUS_PROJECTION_OWNER,
	WORKFLOW_EXECUTION_PROJECTION_OWNER,
]);

function readRecord(value: unknown): FlowRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as FlowRecord)
		: null;
}

function readNodes(value: FlowRecord): FlowRecord[] {
	return Array.isArray(value.nodes)
		? value.nodes.filter((node): node is FlowRecord => readRecord(node) !== null)
		: [];
}

function nodeId(node: FlowRecord): string {
	return typeof node.id === "string" ? node.id.trim() : "";
}

function managedProjectionOwner(node: FlowRecord): string {
	const data = readRecord(node.data);
	const owner = typeof data?.managedProjection === "string"
		? data.managedProjection.trim()
		: "";
	return MANAGED_PROJECTION_OWNERS.has(owner) ? owner : "";
}

function isWorkflowExecutionOutput(node: FlowRecord): boolean {
	if (node.type !== "taskNode") return false;
	const data = readRecord(node.data);
	if (!data) return false;
	return typeof data.workflowExecutionId === "string"
		&& data.workflowExecutionId.trim().length > 0
		&& typeof data.workflowRuntimeNodeId === "string"
		&& data.workflowRuntimeNodeId.trim().length > 0
		&& typeof data.workflowEffectId === "string"
		&& data.workflowEffectId.trim().length > 0;
}

function readWorkflowExecutionId(node: FlowRecord): string {
	const data = readRecord(node.data);
	return typeof data?.workflowExecutionId === "string"
		? data.workflowExecutionId.trim()
		: "";
}

/**
 * 收集 flow 中全部工作流执行输出节点（成片/逐镜视频等带 workflowExecutionId
 * 的托管投影）所属的执行 id。供保存链路查询执行终态，从而只保护活跃执行产物。
 */
export function readWorkflowExecutionOutputIds(value: unknown): string[] {
	const record = readRecord(value);
	if (!record) return [];
	return [...new Set(
		readNodes(record)
			.filter(isWorkflowExecutionOutput)
			.map(readWorkflowExecutionId)
			.filter(Boolean),
	)];
}

function isServerManagedNode(node: FlowRecord): boolean {
	return Boolean(managedProjectionOwner(node))
		|| isWorkflowExecutionProjectionNode(node)
		|| isWorkflowExecutionOutput(node);
}

function readEdges(value: FlowRecord): FlowRecord[] {
	return Array.isArray(value.edges)
		? value.edges.filter((edge): edge is FlowRecord => readRecord(edge) !== null)
		: [];
}

function edgeTouchesNodeIds(edge: FlowRecord, nodeIds: ReadonlySet<string>): boolean {
	const source = typeof edge.source === "string" ? edge.source.trim() : "";
	const target = typeof edge.target === "string" ? edge.target.trim() : "";
	return nodeIds.has(source) || nodeIds.has(target);
}

/**
 * User snapshots own layout and ordinary canvas content, while server-managed projection data owns
 * the current runtime facts. A full user save may move a live projection node, but cannot regress its
 * data or delete it with a stale local snapshot.
 *
 * 工作流执行产物（workflowExecutionId 输出节点）只在对应执行仍活跃（queued/running，或状态未知）
 * 时受保护；执行已终态（success/failed/canceled）后产物是普通画布资产：用户可经正常画布保存
 * 删除，保存中保留该节点时以用户快照为准。`executionActive` 由保存链路依据 workflow_executions
 * 真实状态提供，缺省时按「全部保护」兼容旧行为。
 */
export function preserveManagedFlowProjections(input: {
	existing: FlowRecord;
	incoming: FlowRecord;
	executionActive?: Readonly<Record<string, boolean>>;
}): FlowRecord {
	const existingManagedNodes = readNodes(input.existing).filter(isServerManagedNode);
	const incomingNodes = readNodes(input.incoming);
	const isExecutionActive = (node: FlowRecord): boolean => {
		if (managedProjectionOwner(node)) return true;
		const executionId = readWorkflowExecutionId(node);
		if (!executionId) return true;
		const known = input.executionActive?.[executionId];
		// 状态未知（未提供映射或执行不存在）时按保护处理，避免误删活跃执行产物。
		return known === undefined ? true : known;
	};
	const activeManagedNodes = existingManagedNodes.filter(isExecutionActive);
	const finishedManagedNodes = existingManagedNodes.filter((node) => !isExecutionActive(node));
	const activeById = new Map(activeManagedNodes.map((node) => [nodeId(node), node]));
	const finishedById = new Map(finishedManagedNodes.map((node) => [nodeId(node), node]));
	const rejectedClaimIds = new Set<string>();
	const nodes = incomingNodes.flatMap((node) => {
		const id = nodeId(node);
		const existingActive = activeById.get(id);
		if (existingActive) return [{
			...node,
			data: existingActive.data,
		}];
		// 终态执行的产物已不再是服务端托管投影：保留用户快照中的版本（用户删除后也不恢复）。
		if (finishedById.has(id)) return [node];
		// A public full-flow write cannot mint a server-owned projection merely by claiming
		// its marker. The projection must first be created by the dedicated server path.
		if (isServerManagedNode(node)) {
			rejectedClaimIds.add(id);
			return [];
		}
		return [node];
	});
	const incomingIds = new Set(incomingNodes.map(nodeId));

	for (const managedNode of activeManagedNodes) {
		if (!incomingIds.has(nodeId(managedNode))) nodes.push(managedNode);
	}

	const managedNodeIds = new Set(activeManagedNodes.map(nodeId));
	const existingManagedEdges = readEdges(input.existing).filter((edge) =>
		edgeTouchesNodeIds(edge, managedNodeIds),
	);
	const existingManagedEdgeById = new Map(existingManagedEdges.map((edge) => [nodeId(edge), edge]));
	const incomingEdges = readEdges(input.incoming).filter((edge) =>
		!edgeTouchesNodeIds(edge, rejectedClaimIds),
	);
	const edges = incomingEdges.map((edge) => existingManagedEdgeById.get(nodeId(edge)) ?? edge);
	const incomingEdgeIds = new Set(incomingEdges.map(nodeId));
	for (const edge of existingManagedEdges) {
		if (!incomingEdgeIds.has(nodeId(edge))) edges.push(edge);
	}

	return { ...input.incoming, nodes, edges };
}
