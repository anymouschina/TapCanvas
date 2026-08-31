import { randomUUID } from "node:crypto";
import {
	PublicFlowCreateNodeSchema,
	PublicFlowTaskNodeDataSchema,
	type PublicFlowGraph,
	type PublicFlowPatchRequestDto,
} from "./flow.public.schemas";
import {
	getPublicFlowNodeHandles,
	getPublicFlowTaskNodeCoreType,
	listPublicFlowNodeHandles,
} from "./flow.node-protocol";
import { autoWireReferenceEdges } from "./flow.reference-autowire";
import { finalizeStoryboardAdventureContracts } from "./flow.storyboard-adventure-contract";
import { AppError } from "../../middleware/error";

type NodeLike = Record<string, unknown> & { id?: unknown; data?: unknown };
type EdgeLike = Record<string, unknown> & { id?: unknown; source?: unknown; target?: unknown };

type ApplyPatchResult = {
	data: PublicFlowGraph;
	stats: {
		deletedNodes: number;
		deletedEdges: number;
		createdNodes: number;
		createdEdges: number;
		patchedNodes: number;
		appendedArrays: number;
	};
	createdNodeIds: string[];
	reusedNodeIds: string[];
	createdEdgeIds: string[];
	deletedEdgeIds: string[];
};

const GROUP_PADDING = 8;
const GROUP_MIN_WIDTH = 160;
const GROUP_MIN_HEIGHT = 90;
const GROUP_GAP_X = 12;
const GROUP_GAP_Y = 12;
const LAYOUT_EXCLUDED_GROUP_SOURCES = new Set<string>([
	"novel_storyboard_progress",
]);

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readId(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumeric(value: unknown): number | null {
	const direct = readFiniteNumber(value);
	if (direct !== null) return direct;
	if (typeof value !== "string") return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function readNodePosition(
	node: NodeLike | null | undefined,
): { x: number; y: number } | null {
	if (!node) return null;
	const record = asObject(node.position);
	const x = readFiniteNumber(record?.x);
	const y = readFiniteNumber(record?.y);
	if (x === null || y === null) return null;
	return { x, y };
}

function readGroupSize(
	node: NodeLike | null | undefined,
): { width: number; height: number } | null {
	if (!node || readId(node.type) !== "groupNode") return null;
	const style = asObject(node.style);
	const width = readNumeric(style?.width);
	const height = readNumeric(style?.height);
	if (width === null || height === null) return null;
	return { width, height };
}

function readNodeParentId(node: NodeLike | null | undefined): string {
	if (!node) return "";
	return readId((node as Record<string, unknown>).parentId);
}

function isGroupNode(node: NodeLike | null | undefined): boolean {
	return readId(node?.type) === "groupNode";
}

function fallbackNodeSize(
	node: NodeLike,
): { width: number; height: number } {
	if (readId(node.type) === "taskNode") {
		const data = asObject(node.data) || {};
		const kind = readId(data.kind);
		const kindLower = kind.toLowerCase();
		const coreType = getPublicFlowTaskNodeCoreType(kind || null);
		if (coreType === "text") return { width: 380, height: 360 };
		if (coreType === "storyboard") return { width: 560, height: 470 };
		if (kindLower === "imageedit") return { width: 320, height: 220 };
		return { width: 420, height: 240 };
	}
	if (isGroupNode(node)) return { width: 240, height: 160 };
	return { width: 220, height: 120 };
}

function readNodeSize(
	node: NodeLike,
): { width: number; height: number } {
	const fallback = fallbackNodeSize(node);
	const data = asObject(node.data);
	const style = asObject(node.style);
	const width =
		readNumeric((node as Record<string, unknown>).width) ??
		readNumeric(data?.nodeWidth) ??
		readNumeric(style?.width) ??
		fallback.width;
	const height =
		readNumeric((node as Record<string, unknown>).height) ??
		readNumeric(data?.nodeHeight) ??
		readNumeric(style?.height) ??
		fallback.height;
	return { width, height };
}

function shouldExcludeNodeFromGroupArrange(node: NodeLike): boolean {
	if (isGroupNode(node)) return true;
	const data = asObject(node.data) || {};
	const source = readId(data.source);
	return Boolean(source) && LAYOUT_EXCLUDED_GROUP_SOURCES.has(source);
}

function isWorkflowGroup(node: NodeLike): boolean {
	if (!isGroupNode(node)) return false;
	const data = asObject(node.data) || {};
	return readId(data.workflowKey).length > 0;
}

function rebuildNodeById(nodes: readonly NodeLike[]): Map<string, NodeLike> {
	const nodeById = new Map<string, NodeLike>();
	for (const node of nodes) {
		const id = readId(node.id);
		if (!id) continue;
		nodeById.set(id, node);
	}
	return nodeById;
}

function orderNodesParentFirst(nodes: readonly NodeLike[]): NodeLike[] {
	const nodeById = rebuildNodeById(nodes);
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const ordered: NodeLike[] = [];

	const visit = (node: NodeLike): void => {
		const id = readId(node.id);
		if (!id) {
			ordered.push(node);
			return;
		}
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			visiting.delete(id);
			visited.add(id);
			ordered.push(node);
			return;
		}
		visiting.add(id);
		const parentId = readNodeParentId(node);
		if (parentId && parentId !== id) {
			const parent = nodeById.get(parentId);
			if (parent) visit(parent);
		}
		visiting.delete(id);
		if (visited.has(id)) return;
		visited.add(id);
		ordered.push(node);
	};

	for (const node of nodes) visit(node);
	return ordered;
}

function replaceNodePositions(options: {
	nodes: readonly NodeLike[];
	positionById: ReadonlyMap<string, { x: number; y: number }>;
}): NodeLike[] {
	if (options.positionById.size === 0) return [...options.nodes];
	return options.nodes.map((node) => {
		const id = readId(node.id);
		if (!id) return node;
		const position = options.positionById.get(id);
		if (!position) return node;
		return {
			...node,
			position,
		};
	});
}

function updateSingleGroupFrame(options: {
	nodes: readonly NodeLike[];
	groupId: string;
}): NodeLike[] {
	const nodeById = rebuildNodeById(options.nodes);
	const group = nodeById.get(options.groupId);
	if (!group || !isGroupNode(group)) return [...options.nodes];

	const children = options.nodes.filter(
		(node) => readNodeParentId(node) === options.groupId,
	);
	if (children.length === 0) return [...options.nodes];

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const child of children) {
		const position = readNodePosition(child);
		if (!position) continue;
		const size = readNodeSize(child);
		minX = Math.min(minX, position.x);
		minY = Math.min(minY, position.y);
		maxX = Math.max(maxX, position.x + size.width);
		maxY = Math.max(maxY, position.y + size.height);
	}

	if (
		!Number.isFinite(minX) ||
		!Number.isFinite(minY) ||
		!Number.isFinite(maxX) ||
		!Number.isFinite(maxY)
	) {
		return [...options.nodes];
	}

	const groupPosition = readNodePosition(group) || { x: 0, y: 0 };
	const desiredPosition = {
		x: groupPosition.x + (minX - GROUP_PADDING),
		y: groupPosition.y + (minY - GROUP_PADDING),
	};
	const desiredSize = {
		width: Math.max(
			GROUP_MIN_WIDTH,
			(maxX - minX) + GROUP_PADDING * 2,
		),
		height: Math.max(
			GROUP_MIN_HEIGHT,
			(maxY - minY) + GROUP_PADDING * 2,
		),
	};
	const currentSize = readNodeSize(group);
	const dx = desiredPosition.x - groupPosition.x;
	const dy = desiredPosition.y - groupPosition.y;
	const positionChanged = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;
	const sizeChanged =
		Math.abs(desiredSize.width - currentSize.width) > 0.1 ||
		Math.abs(desiredSize.height - currentSize.height) > 0.1;
	if (!positionChanged && !sizeChanged) return [...options.nodes];

	return orderNodesParentFirst(
		options.nodes.map((node) => {
			const id = readId(node.id);
			if (id === options.groupId) {
				const style = asObject(node.style) || {};
				return {
					...node,
					position: desiredPosition,
					width: desiredSize.width,
					height: desiredSize.height,
					style: {
						...style,
						width: desiredSize.width,
						height: desiredSize.height,
					},
				};
			}
			if (!positionChanged || readNodeParentId(node) !== options.groupId) return node;
			const position = readNodePosition(node) || { x: 0, y: 0 };
			return {
				...node,
				position: {
					x: position.x - dx,
					y: position.y - dy,
				},
			};
		}),
	);
}

function compactSingleGroup(options: {
	nodes: readonly NodeLike[];
	edges: readonly unknown[];
	groupId: string;
}): NodeLike[] {
	const group = options.nodes.find((node) => readId(node.id) === options.groupId);
	if (!group || !isGroupNode(group)) return [...options.nodes];

	const allChildren = options.nodes.filter(
		(node) => readNodeParentId(node) === options.groupId,
	);
	if (allChildren.length === 0) return [...options.nodes];

	const arrangeableChildren = allChildren.filter(
		(node) => !shouldExcludeNodeFromGroupArrange(node),
	);
	const orderedArrangeableChildren = isWorkflowGroup(group)
		? orderWorkflowChildrenByTopology(arrangeableChildren, options.edges)
		: arrangeableChildren;

	let nextNodes = [...options.nodes];
	if (orderedArrangeableChildren.length > 0) {
		const colCount = isWorkflowGroup(group)
			? orderedArrangeableChildren.length
			: Math.max(1, Math.ceil(Math.sqrt(orderedArrangeableChildren.length)));
		const rowCount = Math.max(
			1,
			Math.ceil(orderedArrangeableChildren.length / colCount),
		);
		const colWidths = Array.from({ length: colCount }, () => 0);
		const rowHeights = Array.from({ length: rowCount }, () => 0);

		orderedArrangeableChildren.forEach((node, index) => {
			const row = Math.floor(index / colCount);
			const col = index % colCount;
			const size = readNodeSize(node);
			colWidths[col] = Math.max(colWidths[col] || 0, size.width);
			rowHeights[row] = Math.max(rowHeights[row] || 0, size.height);
		});

		const colOffsets = Array.from({ length: colCount }, () => 0);
		const rowOffsets = Array.from({ length: rowCount }, () => 0);

		let cursorX = GROUP_PADDING;
		for (let col = 0; col < colCount; col += 1) {
			colOffsets[col] = cursorX;
			cursorX += (colWidths[col] || 0) + GROUP_GAP_X;
		}

		let cursorY = GROUP_PADDING;
		for (let row = 0; row < rowCount; row += 1) {
			rowOffsets[row] = cursorY;
			cursorY += (rowHeights[row] || 0) + GROUP_GAP_Y;
		}

		const positionById = new Map<string, { x: number; y: number }>();
		orderedArrangeableChildren.forEach((node, index) => {
			const row = Math.floor(index / colCount);
			const col = index % colCount;
			positionById.set(readId(node.id), {
				x: colOffsets[col] ?? GROUP_PADDING,
				y: rowOffsets[row] ?? GROUP_PADDING,
			});
		});

		nextNodes = replaceNodePositions({
			nodes: nextNodes,
			positionById,
		});
	}

	return updateSingleGroupFrame({
		nodes: nextNodes,
		groupId: options.groupId,
	});
}

/**
 * Workflow groups are execution graphs, so their visual order follows the DAG
 * instead of insertion order. This prevents a late-added upstream node from
 * being placed after delivery and drawing a misleading backward/looping edge.
 */
function orderWorkflowChildrenByTopology(
	children: readonly NodeLike[],
	edges: readonly unknown[],
): NodeLike[] {
	const childById = new Map(children.map((node) => [readId(node.id), node] as const));
	const stableIndexById = new Map(children.map((node, index) => [readId(node.id), index] as const));
	const compareReady = (left: NodeLike, right: NodeLike): number => (
		(stableIndexById.get(readId(left.id)) ?? Number.MAX_SAFE_INTEGER)
		- (stableIndexById.get(readId(right.id)) ?? Number.MAX_SAFE_INTEGER)
		|| readId(left.id).localeCompare(readId(right.id))
	);
	const indegree = new Map([...childById.keys()].map((id) => [id, 0] as const));
	const outgoing = new Map<string, Set<string>>();
	for (const rawEdge of edges) {
		const edge = asObject(rawEdge) as EdgeLike | null;
		const source = readId(edge?.source);
		const target = readId(edge?.target);
		if (!source || !target || source === target || !childById.has(source) || !childById.has(target)) continue;
		const targets = outgoing.get(source) ?? new Set<string>();
		if (targets.has(target)) continue;
		targets.add(target);
		outgoing.set(source, targets);
		indegree.set(target, (indegree.get(target) ?? 0) + 1);
	}

	const ready = children
		.filter((node) => (indegree.get(readId(node.id)) ?? 0) === 0)
		.sort(compareReady);
	const ordered: NodeLike[] = [];
	while (ready.length > 0) {
		const node = ready.shift();
		if (!node) break;
		ordered.push(node);
		for (const targetId of outgoing.get(readId(node.id)) ?? []) {
			const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
			indegree.set(targetId, nextIndegree);
			const target = childById.get(targetId);
			if (nextIndegree === 0 && target) {
				ready.push(target);
				ready.sort(compareReady);
			}
		}
	}

	return ordered.length === children.length
		? ordered
		: [...children];
}

function collectAffectedGroupIds(options: {
	createdNodeIds: readonly string[];
	nodeById: ReadonlyMap<string, NodeLike>;
}): string[] {
	const groupIds = new Set<string>();
	for (const createdNodeId of options.createdNodeIds) {
		const node = options.nodeById.get(createdNodeId);
		if (!node) continue;
		const nodeId = readId(node.id);
		if (isGroupNode(node) && nodeId) groupIds.add(nodeId);

		let parentId = readNodeParentId(node);
		while (parentId) {
			const parent = options.nodeById.get(parentId);
			if (!parent || !isGroupNode(parent)) break;
			groupIds.add(parentId);
			parentId = readNodeParentId(parent);
		}
	}
	return Array.from(groupIds);
}

function sortGroupIdsByDepthDesc(
	groupIds: readonly string[],
	nodeById: ReadonlyMap<string, NodeLike>,
): string[] {
	const depthCache = new Map<string, number>();
	const computeDepth = (groupId: string): number => {
		if (depthCache.has(groupId)) return depthCache.get(groupId) || 0;
		const node = nodeById.get(groupId);
		const parentId = readNodeParentId(node);
		const depth =
			parentId && nodeById.has(parentId) && isGroupNode(nodeById.get(parentId))
				? computeDepth(parentId) + 1
				: 0;
		depthCache.set(groupId, depth);
		return depth;
	};

	return [...groupIds].sort((left, right) => {
		const depthDelta = computeDepth(right) - computeDepth(left);
		if (depthDelta !== 0) return depthDelta;
		return left.localeCompare(right);
	});
}

function getNodeAbsolutePosition(
	node: NodeLike,
	nodeById: Map<string, NodeLike>,
	visiting: Set<string> = new Set(),
): { x: number; y: number } | null {
	const id = readId(node.id);
	if (id) {
		if (visiting.has(id)) return readNodePosition(node);
		visiting.add(id);
	}
	const base = readNodePosition(node);
	if (!base) return null;
	const parentId = readId((node as Record<string, unknown>).parentId);
	if (!parentId || parentId === id) return base;
	const parent = nodeById.get(parentId);
	if (!parent) return base;
	const parentAbs = getNodeAbsolutePosition(parent, nodeById, visiting);
	if (!parentAbs) return base;
	return {
		x: parentAbs.x + base.x,
		y: parentAbs.y + base.y,
	};
}

function shouldTreatChildPositionAsAbsolute(input: {
	parentNode: NodeLike;
	parentAbsPosition: { x: number; y: number };
	childPosition: { x: number; y: number };
}): boolean {
	const parentSize = readGroupSize(input.parentNode);
	if (!parentSize) return true;
	const margin = 24;
	const withinRelativeBounds =
		input.childPosition.x >= -margin &&
		input.childPosition.y >= -margin &&
		input.childPosition.x <= parentSize.width + margin &&
		input.childPosition.y <= parentSize.height + margin;
	if (withinRelativeBounds) return false;
	const normalized = {
		x: input.childPosition.x - input.parentAbsPosition.x,
		y: input.childPosition.y - input.parentAbsPosition.y,
	};
	const withinNormalizedBounds =
		normalized.x >= -margin &&
		normalized.y >= -margin &&
		normalized.x <= parentSize.width + margin &&
		normalized.y <= parentSize.height + margin;
	return withinNormalizedBounds;
}

function normalizeCreateNodePositionRelativeToParent(
	node: NodeLike,
	nodeById: Map<string, NodeLike>,
): NodeLike {
	const parentId = readId((node as Record<string, unknown>).parentId);
	if (!parentId) return node;
	const parent = nodeById.get(parentId);
	if (!parent || readId(parent.type) !== "groupNode") return node;
	const childPosition = readNodePosition(node);
	const parentAbsPosition = getNodeAbsolutePosition(parent, nodeById);
	if (!childPosition || !parentAbsPosition) return node;
	if (
		!shouldTreatChildPositionAsAbsolute({
			parentNode: parent,
			parentAbsPosition,
			childPosition,
		})
	) {
		return node;
	}
	return {
		...node,
		position: {
			x: childPosition.x - parentAbsPosition.x,
			y: childPosition.y - parentAbsPosition.y,
		},
	};
}

function stableJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "";
	}
}

function ensureNodeId(node: NodeLike): string {
	const id = readId(node.id);
	return id || `n-${randomUUID()}`;
}

function ensureEdgeId(edge: EdgeLike): string {
	const id = readId(edge.id);
	return id || `e-${randomUUID()}`;
}

function assertValidEdgeHandle(options: {
	node: NodeLike;
	nodeId: string;
	handleId: string;
	direction: "source" | "target";
}): void {
	const { node, nodeId, handleId, direction } = options;
	const knownHandles = getPublicFlowNodeHandles(node);
	if (!knownHandles) return;
	const handleSet = direction === "source" ? knownHandles.sources : knownHandles.targets;
	if (handleSet.has(handleId)) return;
	const side = direction === "source" ? "sourceHandle" : "targetHandle";
	const allowed = listPublicFlowNodeHandles(node, direction);
	const allowedStr = allowed.length ? allowed.join(", ") : "（此节点无合法 handle）";
	throw new AppError(`createEdges ${side} 非法: ${handleId}，节点 ${nodeId} 允许的 ${side}: ${allowedStr}`, {
		status: 400,
		code: "flow_patch_invalid_handle",
		details: {
			nodeId,
			side,
			handleId,
			allowedHandles: allowed,
		},
	});
}

function ensureFlowGraphShape(raw: unknown): PublicFlowGraph {
	const obj = asObject(raw) || {};
	const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
	const edges = Array.isArray(obj.edges) ? obj.edges : [];
	const viewport = obj.viewport ?? undefined;
	return {
		nodes,
		edges,
		...(typeof viewport === "undefined"
			? {}
			: { viewport: viewport as { x: number; y: number; zoom: number } | null }),
	};
}

function ensureNodeDataObject(node: NodeLike): Record<string, unknown> {
	const data = asObject(node.data);
	return data ? data : {};
}

/**
 * A composition node is a durable projection of one video run, not an ad-hoc canvas node.
 * Its identity is fully declared by structured fields, so a repeated create can safely become
 * an update without broadening the behavior of ordinary createNodes writes.
 */
function isSameCanonicalComposeNode(options: {
	id: string;
	existing: NodeLike;
	incoming: NodeLike;
}): boolean {
	const existingData = ensureNodeDataObject(options.existing);
	const incomingData = ensureNodeDataObject(options.incoming);
	const existingRunId = readCanonicalComposeRunId(existingData);
	const incomingRunId = readCanonicalComposeRunId(incomingData);
	return (
		options.existing.type === "taskNode" &&
		options.incoming.type === "taskNode" &&
		existingData.kind === "composeVideo" &&
		incomingData.kind === "composeVideo" &&
		existingRunId.length > 0 &&
		existingRunId === incomingRunId &&
		options.id === `film-${incomingRunId}`
	);
}

function readCanonicalComposeRunId(data: Record<string, unknown>): string {
	const directRunId = readId(data.clipRunId);
	if (directRunId) return directRunId;
	const productionMetadata = asObject(data.productionMetadata);
	return readId(productionMetadata?.runId);
}

function isIdenticalExistingEdge(options: { existing: EdgeLike; incoming: EdgeLike }): boolean {
	const fields: Array<keyof EdgeLike> = ["source", "target", "sourceHandle", "targetHandle", "type", "label", "data"];
	return fields.every((field) => stableJson(options.existing[field]) === stableJson(options.incoming[field]));
}

function validateCreateNode(raw: unknown): NodeLike {
	const parsed = PublicFlowCreateNodeSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("createNodes 节点协议不合法；仅支持前端真实节点协议", {
			status: 400,
			code: "invalid_flow_create_node",
			details: {
				issues: parsed.error.issues.map((issue) => ({
					path: issue.path,
					message: issue.message,
					code: issue.code,
				})),
			},
		});
	}
	return parsed.data as NodeLike;
}

function assertShotTableNodeContract(node: NodeLike): void {
	const nodeId = readId(node.id);
	const data = ensureNodeDataObject(node);
	if (data.kind !== "shotTable") return;
	const parsed = PublicFlowTaskNodeDataSchema.safeParse(data);
	if (parsed.success) return;
	throw new AppError("分镜表节点缺少可渲染的结构化 shotTable 数据", {
		status: 400,
		code: "invalid_shot_table_node_data",
		details: {
			nodeId: nodeId || null,
			issues: parsed.error.issues.map((issue) => ({
				path: issue.path,
				message: issue.message,
			})),
			requiredAction:
				"在同一次 tapcanvas_flow_patch 修复链中提供 data.shotTable 对象；content、prompt 或 Markdown 表格不能替代结构化分镜表。",
		},
	});
}

function mergeNodeData(options: {
	existing: Record<string, unknown>;
	patch: Record<string, unknown>;
	allowOverwrite: boolean;
	nodeId: string;
	recoveryArgs: PublicFlowPatchRequestDto;
}): Record<string, unknown> {
	const { existing, patch, allowOverwrite, nodeId, recoveryArgs } = options;
	const next: Record<string, unknown> = { ...existing };

	const conflicts: string[] = [];
	for (const [key, value] of Object.entries(patch)) {
		const current = next[key];
		if (!allowOverwrite && typeof current !== "undefined" && current !== null) {
			if (stableJson(current) !== stableJson(value)) conflicts.push(key);
			continue;
		}
		next[key] = value;
	}

	if (conflicts.length) {
		const immutableArgs = Object.fromEntries(
			Object.entries(recoveryArgs).filter(([, value]) => typeof value !== "undefined"),
		) as PublicFlowPatchRequestDto;
		const exactRetryArgs: PublicFlowPatchRequestDto = {
			...immutableArgs,
			allowOverwrite: true,
		};
		throw new AppError(
			`patchNodeData 会覆盖既有字段: ${conflicts.join(", ")}。若本次写入本就要补齐或更新这些字段，请按 recovery 合同原样重试`,
			{
				status: 409,
				code: "flow_patch_conflict",
				details: {
					nodeId,
					keys: conflicts,
					hint: "resubmit the exact recovery.exactRetryArgs; no additional user confirmation is required",
					recovery: {
						allowed: true,
						retryKey: `tapcanvas_flow_patch:${nodeId}:${conflicts.join(",")}`,
						retryToolName: "tapcanvas_flow_patch",
						maxAttempts: 1,
						immutableArgs,
						// The source call is verified against immutableArgs first. The recovery turn
						// must then equal this complete request, so it cannot change node data, add
						// operations, or broaden the write scope while enabling the intended update.
						exactRetryArgs,
						requiredActions: [
							"使用 exactRetryArgs 中的完整参数原样重调 tapcanvas_flow_patch；不得修改、增加或删除任何其他操作。",
						],
					},
				},
			},
		);
	}

	return next;
}

function appendNodeArray(options: {
	node: NodeLike;
	key: string;
	items: unknown[];
}): { nextNode: NodeLike; appended: number } {
	const { node, key, items } = options;
	if (!key.trim()) {
		throw new AppError("appendNodeArrays.key 不能为空", {
			status: 400,
			code: "invalid_flow_patch",
		});
	}
	if (!items.length) return { nextNode: node, appended: 0 };

	const data = ensureNodeDataObject(node);
	const current = (data as Record<string, unknown>)[key];
	const sameSbaSelectionEvent = (left: unknown, right: unknown): boolean => {
		const leftEvent = asObject(left);
		const rightEvent = asObject(right);
		if (!leftEvent || !rightEvent) return false;
		return [
			"version",
			"eventId",
			"branchNodeId",
			"parentNodeId",
			"sbaPath",
			"basisFingerprint",
			"selectedAt",
			"source",
		].every((field) => leftEvent[field] === rightEvent[field]);
	};
	const appendItems = (existingItems: readonly unknown[]): unknown[] => {
		if (key !== "sbaSelectionEvents") return [...items];
		const eventById = new Map<string, unknown>();
		for (const existingItem of existingItems) {
			const eventId = readId(asObject(existingItem)?.eventId);
			if (eventId) eventById.set(eventId, existingItem);
		}
		const pending: unknown[] = [];
		for (const item of items) {
			const eventId = readId(asObject(item)?.eventId);
			const existingItem = eventId ? eventById.get(eventId) : undefined;
			if (existingItem !== undefined) {
				if (sameSbaSelectionEvent(existingItem, item)) continue;
				throw new AppError(`sbaSelectionEvents.eventId 已存在但内容不同: ${eventId}`, {
					status: 409,
					code: "flow_patch_conflict",
					details: { nodeId: readId(node.id), key, eventId },
				});
			}
			if (eventId) eventById.set(eventId, item);
			pending.push(item);
		}
		return pending;
	};
	if (typeof current === "undefined" || current === null) {
		const pending = appendItems([]);
		return {
			nextNode: { ...node, data: { ...data, [key]: pending } },
			appended: pending.length,
		};
	}
	if (!Array.isArray(current)) {
		throw new AppError(`appendNodeArrays 目标字段不是数组: ${key}`, {
			status: 409,
			code: "flow_patch_type_mismatch",
			details: { nodeId: readId(node.id), key, currentType: typeof current },
		});
	}
	const pending = appendItems(current);
	return {
		nextNode: pending.length > 0
			? { ...node, data: { ...data, [key]: [...current, ...pending] } }
			: node,
		appended: pending.length,
	};
}

export function applyPublicFlowGraphPatch(options: {
	current: unknown;
	patch: PublicFlowPatchRequestDto;
}): ApplyPatchResult {
	const current = ensureFlowGraphShape(options.current);
	const allowOverwrite = options.patch.allowOverwrite === true;

	let nodeList: NodeLike[] = (Array.isArray(current.nodes) ? current.nodes : [])
		.map((raw) => asObject(raw) as NodeLike | null)
		.filter((node): node is NodeLike => Boolean(node));
	const edgeList: unknown[] = Array.isArray(current.edges) ? [...current.edges] : [];

	const nodeById = new Map<string, NodeLike>();
	for (const node of nodeList) {
		const id = readId(node.id);
		if (!id) continue;
		nodeById.set(id, node);
	}

	let createdNodes = 0;
	let deletedNodes = 0;
	let deletedEdges = 0;
	let patchedNodes = 0;
	let appendedArrays = 0;
	let createdEdges = 0;
	let createdNodeWithoutExplicitId = false;
	const autoWireTargetNodeIds = new Set<string>();
	const createdNodeIds: string[] = [];
	const reusedNodeIds: string[] = [];
	const createdEdgeIds: string[] = [];
	const deletedEdgeIds = new Set<string>();

	const deleteEdgeIdSet = new Set(
		(options.patch.deleteEdgeIds || []).map((id) => readId(id)).filter(Boolean),
	);
	if (deleteEdgeIdSet.size > 0) {
		const existingEdgeIds = new Set<string>();
		for (const raw of edgeList) {
			const edge = asObject(raw) as EdgeLike | null;
			const edgeId = readId(edge?.id);
			if (edgeId) existingEdgeIds.add(edgeId);
		}
		const missingEdgeIds = [...deleteEdgeIdSet].filter((edgeId) => !existingEdgeIds.has(edgeId));
		if (missingEdgeIds.length > 0) {
			throw new AppError(`deleteEdgeIds 边不存在: ${missingEdgeIds.join(", ")}`, {
				status: 404,
				code: "flow_edge_not_found",
				details: { edgeIds: missingEdgeIds },
			});
		}
		const retainedEdges: unknown[] = [];
		for (const raw of edgeList) {
			const edge = asObject(raw) as EdgeLike | null;
			const edgeId = readId(edge?.id);
			if (edgeId && deleteEdgeIdSet.has(edgeId)) {
				deletedEdges += 1;
				deletedEdgeIds.add(edgeId);
				continue;
			}
			retainedEdges.push(raw);
		}
		edgeList.length = 0;
		edgeList.push(...retainedEdges);
	}

	const deleteNodeIdSet = new Set(
		(options.patch.deleteNodeIds || []).map((id) => readId(id)).filter(Boolean),
	);
	if (deleteNodeIdSet.size > 0) {
		const missingNodeIds = [...deleteNodeIdSet].filter((nodeId) => !nodeById.has(nodeId));
		if (missingNodeIds.length > 0) {
			throw new AppError(`deleteNodeIds 节点不存在: ${missingNodeIds.join(", ")}`, {
				status: 404,
				code: "flow_node_not_found",
				details: { nodeIds: missingNodeIds },
			});
		}
		const retainedNodes: NodeLike[] = [];
		for (const node of nodeList) {
			const nodeId = readId(node.id);
			if (nodeId && deleteNodeIdSet.has(nodeId)) {
				nodeById.delete(nodeId);
				deletedNodes += 1;
				continue;
			}
			retainedNodes.push(node);
		}
		nodeList = retainedNodes;

		const retainedEdges: unknown[] = [];
		for (const raw of edgeList) {
			const edge = asObject(raw) as EdgeLike | null;
			const edgeId = readId(edge?.id);
			const sourceId = readId(edge?.source);
			const targetId = readId(edge?.target);
			if ((sourceId && deleteNodeIdSet.has(sourceId)) || (targetId && deleteNodeIdSet.has(targetId))) {
				if (!edgeId || !deleteEdgeIdSet.has(edgeId)) {
					deletedEdges += 1;
				}
				if (edgeId) deletedEdgeIds.add(edgeId);
				continue;
			}
			retainedEdges.push(raw);
		}
		edgeList.length = 0;
		edgeList.push(...retainedEdges);
	}

	const normalizedCreateNodes: NodeLike[] = [];
	for (const raw of options.patch.createNodes || []) {
		const obj = validateCreateNode(raw);
		if (!readId(obj.id)) createdNodeWithoutExplicitId = true;
		const id = ensureNodeId(obj);
		const existing = nodeById.get(id);
		if (existing && !isSameCanonicalComposeNode({ id, existing, incoming: obj })) {
			throw new AppError(`createNodes 节点已存在: ${id}`, {
				status: 409,
				code: "flow_patch_conflict",
				details: { nodeId: id },
			});
		}
		if (existing) {
			const next = {
				...existing,
				data: mergeNodeData({
					existing: ensureNodeDataObject(existing),
					patch: ensureNodeDataObject(obj),
					allowOverwrite: true,
					nodeId: id,
					recoveryArgs: options.patch,
				}),
			};
			nodeById.set(id, next);
			nodeList = nodeList.map((node) => (readId(node.id) === id ? next : node));
			patchedNodes += 1;
			reusedNodeIds.push(id);
			autoWireTargetNodeIds.add(id);
			continue;
		}
		normalizedCreateNodes.push({ ...obj, id });
	}

	for (const obj of orderNodesParentFirst(normalizedCreateNodes)) {
		const id = readId(obj.id);
		const next = normalizeCreateNodePositionRelativeToParent(
			obj,
			nodeById,
		);
		nodeById.set(id, next);
		nodeList.push(next);
		createdNodes += 1;
		createdNodeIds.push(id);
		autoWireTargetNodeIds.add(id);
	}

	for (const item of options.patch.patchNodeData || []) {
		const id = readId(item.id);
		const existing = id ? nodeById.get(id) : null;
		if (!id || !existing) {
			throw new AppError(`patchNodeData 节点不存在: ${id || "(missing id)"}`, {
				status: 404,
				code: "flow_node_not_found",
				details: { nodeId: id || null },
			});
		}
		const prevData = ensureNodeDataObject(existing);
		const merged = mergeNodeData({
			existing: prevData,
			patch: item.data,
			// 顶层 allowOverwrite 兜全量；条目级 allowOverwrite 让 agent 能精准只覆盖某一条
			// （错误提示就是这么指引的），二者任一为真即放行。
			allowOverwrite:
				allowOverwrite ||
				(item as { allowOverwrite?: boolean }).allowOverwrite === true,
			nodeId: id,
			recoveryArgs: options.patch,
		});
		const next = { ...existing, data: merged };
		nodeById.set(id, next);
		patchedNodes += 1;
		autoWireTargetNodeIds.add(id);
	}

	for (const item of options.patch.appendNodeArrays || []) {
		const id = readId(item.id);
		const existing = id ? nodeById.get(id) : null;
		if (!id || !existing) {
			throw new AppError(`appendNodeArrays 节点不存在: ${id || "(missing id)"}`, {
				status: 404,
				code: "flow_node_not_found",
				details: { nodeId: id || null },
			});
		}
		const appended = appendNodeArray({ node: existing, key: item.key, items: item.items });
		nodeById.set(id, appended.nextNode);
		appendedArrays += appended.appended;
	}

	const contractTouchedNodeIds = new Set<string>([
		...createdNodeIds,
		...reusedNodeIds,
		...(options.patch.patchNodeData || []).map((item) => readId(item.id)).filter(Boolean),
		...(options.patch.appendNodeArrays || []).map((item) => readId(item.id)).filter(Boolean),
	]);
	for (const nodeId of contractTouchedNodeIds) {
		const node = nodeById.get(nodeId);
		if (node) assertShotTableNodeContract(node);
	}

	const layoutAffectedNodeIds = new Set(createdNodeIds);
	for (const item of options.patch.patchNodeData || []) {
		const id = readId(item.id);
		const node = id ? nodeById.get(id) : null;
		if (id && isGroupNode(node)) layoutAffectedNodeIds.add(id);
	}

	const finalNodeIds = new Set(nodeById.keys());

	const edgeById = new Set<string>();
	for (const raw of edgeList) {
		const obj = asObject(raw) as EdgeLike | null;
		if (!obj) continue;
		const id = readId(obj.id);
		if (id) edgeById.add(id);
	}

	for (const raw of options.patch.createEdges || []) {
		const obj = asObject(raw) as EdgeLike | null;
		if (!obj) {
			throw new AppError("createEdges 元素必须是 object", {
				status: 400,
				code: "invalid_flow_patch",
			});
		}
		const source = readId(obj.source);
		const target = readId(obj.target);
		if (!source || !target) {
			throw new AppError("createEdges 必须提供 source/target", {
				status: 400,
				code: "invalid_flow_patch",
			});
		}
		if (!finalNodeIds.has(source) || !finalNodeIds.has(target)) {
			const message = createdNodeWithoutExplicitId
				? "createEdges 引用的节点不存在；若引用同批新节点，必须显式提供稳定 id，不能使用 label"
				: "createEdges 引用的节点不存在";
			throw new AppError(message, {
				status: 409,
				code: "flow_patch_ref_missing",
				details: {
					source,
					target,
					...(createdNodeWithoutExplicitId
						? {
								hint: "若 createEdges 需要引用同批新节点，createNodes 必须显式提供稳定 id，且边只能使用这些 id，不能使用 label。",
						  }
						: {}),
				},
			});
		}
		const sourceNode = nodeById.get(source) || null;
		const targetNode = nodeById.get(target) || null;
		if (!sourceNode || !targetNode) {
			const message = createdNodeWithoutExplicitId
				? "createEdges 引用的节点不存在；若引用同批新节点，必须显式提供稳定 id，不能使用 label"
				: "createEdges 引用的节点不存在";
			throw new AppError(message, {
				status: 409,
				code: "flow_patch_ref_missing",
				details: {
					source,
					target,
					...(createdNodeWithoutExplicitId
						? {
								hint: "若 createEdges 需要引用同批新节点，createNodes 必须显式提供稳定 id，且边只能使用这些 id，不能使用 label。",
						  }
						: {}),
				},
			});
		}
		const sourceHandle = readId(obj.sourceHandle);
		const targetHandle = readId(obj.targetHandle);
		if (sourceHandle) {
			assertValidEdgeHandle({
				node: sourceNode,
				nodeId: source,
				handleId: sourceHandle,
				direction: "source",
			});
		}
		if (targetHandle) {
			assertValidEdgeHandle({
				node: targetNode,
				nodeId: target,
				handleId: targetHandle,
				direction: "target",
			});
		}
		const id = ensureEdgeId(obj);
		if (edgeById.has(id)) {
			const existing = edgeList
				.map((raw) => asObject(raw) as EdgeLike | null)
				.find((edge): edge is EdgeLike => readId(edge?.id) === id);
			if (existing && isIdenticalExistingEdge({ existing, incoming: obj })) continue;
			throw new AppError(`createEdges 边已存在: ${id}`, {
				status: 409,
				code: "flow_patch_conflict",
				details: { edgeId: id },
			});
		}
		const next = {
			...obj,
			id,
			source,
			target,
			...(sourceHandle ? { sourceHandle } : {}),
			...(targetHandle ? { targetHandle } : {}),
		};
		edgeById.add(id);
		edgeList.push(next);
		createdEdges += 1;
		createdEdgeIds.push(id);
	}

	finalizeStoryboardAdventureContracts({
		nodeById,
		edges: edgeList,
		touchedNodeIds: contractTouchedNodeIds,
	});

	const autoWired = autoWireReferenceEdges({
		nodeById,
		edgeList,
		targetNodeIds: autoWireTargetNodeIds,
	});
	createdEdges += autoWired.createdEdges;

	if (layoutAffectedNodeIds.size > 0) {
		nodeList = orderNodesParentFirst(
			nodeList.map((node) => {
				const id = readId(node.id);
				return id ? nodeById.get(id) || node : node;
			}),
		);
		let workingNodeById = rebuildNodeById(nodeList);
		const affectedGroupIds = sortGroupIdsByDepthDesc(
			collectAffectedGroupIds({
				createdNodeIds: Array.from(layoutAffectedNodeIds),
				nodeById: workingNodeById,
			}),
			workingNodeById,
		);
		for (const groupId of affectedGroupIds) {
			nodeList = compactSingleGroup({
				nodes: nodeList,
				edges: edgeList,
				groupId,
			});
			workingNodeById = rebuildNodeById(nodeList);
		}
		nodeById.clear();
		for (const [id, node] of workingNodeById.entries()) {
			nodeById.set(id, node);
		}
	}

	const finalNodes = orderNodesParentFirst(
		nodeList.map((node) => {
			const id = readId(node.id);
			if (!id) return node;
			return nodeById.get(id) || node;
		}),
	);

	const currentExtra = (typeof current === "object" && current !== null && !Array.isArray(current))
		? Object.fromEntries(
			Object.entries(current as Record<string, unknown>).filter(
				([k]) => k !== "nodes" && k !== "edges" && k !== "viewport",
			),
		)
		: {};
	return {
		data: {
			...currentExtra,
			nodes: finalNodes,
			edges: edgeList,
			...(typeof current.viewport === "undefined" ? {} : { viewport: current.viewport }),
		},
		stats: { deletedNodes, deletedEdges, createdNodes, createdEdges, patchedNodes, appendedArrays },
		createdNodeIds,
		reusedNodeIds,
		createdEdgeIds,
		deletedEdgeIds: [...deletedEdgeIds],
	};
}

/**
 * 从 applyPublicFlowGraphPatch 的结果构造画布 SSE 同步补丁（upsertNodes/removeNodeIds/...）。
 * 关键约束：createNodes/createEdges 的 id 常由服务端生成（agent 请求普遍不带 id），
 * 必须用 applied.createdNodeIds/createdEdgeIds 反查最终数据；按请求里的 id 反查会恒空，
 * 导致写库成功但浏览器收不到任何节点变更（须手动刷新）。
 * `data` 可传持久化前经 sanitize/schema 校验后的图数据（与落库内容一致），缺省用 applied.data。
 */
export function buildCanvasSyncPatch(options: {
	applied: ApplyPatchResult;
	patch: PublicFlowPatchRequestDto;
	data?: PublicFlowGraph;
}): Record<string, unknown> | null {
	const { applied, patch } = options;
	const graph = options.data ?? applied.data;
	const nodeMap = new Map(
		(graph.nodes ?? []).map((n) => [String((n as NodeLike).id ?? ""), n]),
	);
	const edgeMap = new Map(
		(graph.edges ?? []).map((e) => [String((e as EdgeLike).id ?? ""), e]),
	);
	const upsertNodes = [
		...applied.createdNodeIds.map((id) => nodeMap.get(id)),
		...applied.reusedNodeIds.map((id) => nodeMap.get(id)),
		...(patch.patchNodeData ?? []).map((p) => nodeMap.get(String(p.id ?? ""))),
		...(patch.appendNodeArrays ?? []).map((p) => nodeMap.get(String(p.id ?? ""))),
	].filter(Boolean);
	const upsertEdges = applied.createdEdgeIds.map((id) => edgeMap.get(id)).filter(Boolean);
	const syncPatch: Record<string, unknown> = {};
	if (upsertNodes.length) syncPatch.upsertNodes = upsertNodes;
	if (patch.deleteNodeIds?.length) syncPatch.removeNodeIds = patch.deleteNodeIds;
	if (upsertEdges.length) syncPatch.upsertEdges = upsertEdges;
	if (applied.deletedEdgeIds.length) syncPatch.removeEdgeIds = applied.deletedEdgeIds;
	return Object.keys(syncPatch).length ? syncPatch : null;
}
