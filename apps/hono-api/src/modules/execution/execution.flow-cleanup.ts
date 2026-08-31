import { getPrismaClient } from "../../platform/node/prisma";

/**
 * 工作流执行结束后从 flow 主数据剥离「fan-out 中间产物」节点。
 *
 * 背景：执行 image/video fan-out 节点时，物化节点（asset-image-generate::item::*、
 * video-submit::item::*）会写回 flow 主数据（用户模板）。若不清理，每次执行都会
 * 让 flow 主表累积几十个中间资产节点（75 节点 / 252KB vs 干净模板 17 节点 / 47KB），
 * 污染用户画布并触发版本 churn。
 *
 * 本函数在执行终态（success/failed）时调用：删除属于该执行的全部 fan-out 中间产物
 * 节点（id 含 `::item::` 且带 workflowExecutionId 标记）。当前原子工作流的 concat
 * 主片只存在于 node-run 输出与 delivery evidence，不再向模板画布投影第二张成片节点；
 * 历史版本已经写入的非 fan-out 用户节点不在本清理函数的删除范围内。
 *
 * 幂等：重复调用时目标节点已不存在，natural no-op。失败不阻塞执行终态返回。
 */
export async function stripWorkflowFanoutNodes(input: {
	executionId: string;
	flowId: string;
	ownerId: string;
	nowIso: string;
}): Promise<{ strippedNodes: number; strippedEdges: number }> {
	const prisma = getPrismaClient();
	const flow = await prisma.flows.findFirst({
		where: { id: input.flowId, owner_id: input.ownerId },
		select: { id: true, name: true, data: true, canvas_revision: true },
	});
	if (!flow || !flow.data) return { strippedNodes: 0, strippedEdges: 0 };

	let parsed: { nodes?: unknown; edges?: unknown };
	try {
		parsed = JSON.parse(flow.data) as { nodes?: unknown; edges?: unknown };
	} catch {
		return { strippedNodes: 0, strippedEdges: 0 };
	}
	const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
	const edges = Array.isArray(parsed.edges) ? parsed.edges : [];

	const isFanoutOutput = (node: unknown): boolean => {
		if (!node || typeof node !== "object" || Array.isArray(node)) return false;
		const record = node as Record<string, unknown>;
		const id = typeof record.id === "string" ? record.id : "";
		if (!id.includes("::item::")) return false;
		const data = record.data;
		if (!data || typeof data !== "object" || Array.isArray(data)) return false;
		const nodeData = data as Record<string, unknown>;
		// 只剥离属于当前执行的中间产物；不含 workflowExecutionId 的普通 item 节点不动。
		return nodeData.workflowExecutionId === input.executionId;
	};

	const strippedNodeIds = new Set<string>();
	const retainedNodes = nodes.filter((node: unknown) => {
		if (!isFanoutOutput(node)) return true;
		const id = typeof (node as Record<string, unknown>).id === "string"
			? ((node as Record<string, unknown>).id as string)
			: "";
		strippedNodeIds.add(id);
		return false;
	});
	if (strippedNodeIds.size === 0) return { strippedNodes: 0, strippedEdges: 0 };

	const retainedEdges = edges.filter((edge: unknown) => {
		if (!edge || typeof edge !== "object" || Array.isArray(edge)) return true;
		const record = edge as Record<string, unknown>;
		const source = typeof record.source === "string" ? record.source : "";
		const target = typeof record.target === "string" ? record.target : "";
		return !strippedNodeIds.has(source) && !strippedNodeIds.has(target);
	});

	const nextData = JSON.stringify({ ...parsed, nodes: retainedNodes, edges: retainedEdges });
	try {
		await prisma.flows.updateMany({
			where: { id: input.flowId, owner_id: input.ownerId },
			data: {
				data: nextData,
				updated_at: input.nowIso,
			},
		});
	} catch {
		// 清理失败不阻塞执行终态；下次执行前 flow 污染由幂等重试或人工回滚兜底。
		return { strippedNodes: strippedNodeIds.size, strippedEdges: edges.length - retainedEdges.length };
	}
	return { strippedNodes: strippedNodeIds.size, strippedEdges: edges.length - retainedEdges.length };
}
