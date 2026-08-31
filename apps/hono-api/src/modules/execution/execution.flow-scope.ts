type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseGraph(raw: unknown): JsonRecord {
	const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
		throw new Error("Workflow flow data must contain nodes and edges arrays");
	}
	return parsed;
}

function nodeIdentity(value: unknown): string {
	if (!isRecord(value)) return "";
	return typeof value.id === "string" ? value.id.trim() : "";
}

function nodeData(value: unknown): JsonRecord {
	if (!isRecord(value) || !isRecord(value.data)) return {};
	return value.data;
}

function workflowSourceSnapshots(
	nodes: readonly unknown[],
	eligibleNodeIds: ReadonlySet<string>,
): JsonRecord {
	const groupIds = new Set(nodes.flatMap((node) => {
		if (!eligibleNodeIds.has(nodeIdentity(node))) return [];
		const value = nodeData(node).sourceGroupId;
		return typeof value === "string" && value.trim() ? [value.trim()] : [];
	}));
	return Object.fromEntries([...groupIds].map((groupId) => {
		const group = nodes.find((node) => nodeIdentity(node) === groupId);
		if (!isRecord(group) || group.type !== "groupNode") {
			throw new Error(`Workflow source group ${groupId} does not exist`);
		}
		if (nodeData(group).adminWorkflow === true) {
			throw new Error(`Workflow source group ${groupId} cannot be an administrator workflow group`);
		}
		const children = nodes.filter((node) => isRecord(node) && node.parentId === groupId);
		if (children.length === 0) throw new Error(`Workflow source group ${groupId} has no child nodes`);
		return [groupId, { group, children }];
	}));
}

export function scopeWorkflowFlowData(
	raw: unknown,
	triggerNodeId: string,
	stopAfterNodeId?: string,
): JsonRecord {
	const graph = parseGraph(raw);
	const normalizedTriggerId = triggerNodeId.trim();
	if (!normalizedTriggerId) throw new Error("triggerNodeId is required");
	const nodes = graph.nodes as unknown[];
	const edges = graph.edges as unknown[];
	const trigger = nodes.find((node) => nodeIdentity(node) === normalizedTriggerId);
	if (!trigger) throw new Error(`Workflow trigger ${normalizedTriggerId} does not exist`);
	const triggerFacts = nodeData(trigger);
	if (triggerFacts.kind !== "workflowTrigger" || triggerFacts.adminWorkflow !== true) {
		throw new Error(`Node ${normalizedTriggerId} is not an administrator workflow trigger`);
	}
	const workflowInstanceId =
		typeof triggerFacts.workflowInstanceId === "string"
			? triggerFacts.workflowInstanceId.trim()
			: "";
	if (!workflowInstanceId) throw new Error("Workflow trigger is missing workflowInstanceId");

	const eligibleNodeIds = new Set(nodes.flatMap((node) => {
		const facts = nodeData(node);
		const id = nodeIdentity(node);
		return id
			&& isRecord(node)
			&& node.type === "taskNode"
			&& facts.adminWorkflow === true
			&& facts.workflowInstanceId === workflowInstanceId
			? [id]
			: [];
	}));
	const sourceSnapshots = workflowSourceSnapshots(nodes, eligibleNodeIds);
	const eligibleEdges = edges.filter((edge) => {
		if (!isRecord(edge)) return false;
		return typeof edge.source === "string"
			&& typeof edge.target === "string"
			&& eligibleNodeIds.has(edge.source)
			&& eligibleNodeIds.has(edge.target);
	});
	const outgoing = new Map<string, string[]>();
	for (const edge of eligibleEdges) {
		if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") continue;
		const targets = outgoing.get(edge.source) ?? [];
		targets.push(edge.target);
		outgoing.set(edge.source, targets);
	}
	const reachable = new Set<string>([normalizedTriggerId]);
	const pending = [normalizedTriggerId];
	while (pending.length > 0) {
		const current = pending.shift();
		if (!current) continue;
		for (const target of outgoing.get(current) ?? []) {
			if (reachable.has(target)) continue;
			reachable.add(target);
			pending.push(target);
		}
	}
	if (reachable.size < 2) {
		throw new Error("Workflow trigger has no reachable atomic nodes");
	}
	const normalizedStopAfterNodeId = stopAfterNodeId?.trim() ?? "";
	let executionNodeIds = reachable;
	if (normalizedStopAfterNodeId) {
		if (normalizedStopAfterNodeId === normalizedTriggerId) {
			throw new Error("stopAfterNodeId must identify an atomic node after the trigger");
		}
		if (!reachable.has(normalizedStopAfterNodeId)) {
			throw new Error(`Workflow stop node ${normalizedStopAfterNodeId} is not reachable from trigger ${normalizedTriggerId}`);
		}
		const stopNode = nodes.find((node) => nodeIdentity(node) === normalizedStopAfterNodeId);
		if (nodeData(stopNode).kind !== "workflowStage") {
			throw new Error(`Workflow stop node ${normalizedStopAfterNodeId} is not an atomic workflow stage`);
		}
		const incoming = new Map<string, string[]>();
		for (const edge of eligibleEdges) {
			if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") continue;
			const sources = incoming.get(edge.target) ?? [];
			sources.push(edge.source);
			incoming.set(edge.target, sources);
		}
		const ancestors = new Set<string>([normalizedStopAfterNodeId]);
		const ancestorQueue = [normalizedStopAfterNodeId];
		while (ancestorQueue.length > 0) {
			const current = ancestorQueue.shift();
			if (!current) continue;
			for (const source of incoming.get(current) ?? []) {
				if (!reachable.has(source) || ancestors.has(source)) continue;
				ancestors.add(source);
				ancestorQueue.push(source);
			}
		}
		if (!ancestors.has(normalizedTriggerId)) {
			throw new Error(`Workflow stop node ${normalizedStopAfterNodeId} has no dependency path from trigger ${normalizedTriggerId}`);
		}
		executionNodeIds = ancestors;
	}
	return {
		...graph,
		nodes: nodes.filter((node) => executionNodeIds.has(nodeIdentity(node))),
		edges: eligibleEdges.filter((edge) => (
			isRecord(edge)
			&& typeof edge.source === "string"
			&& typeof edge.target === "string"
			&& executionNodeIds.has(edge.source)
			&& executionNodeIds.has(edge.target)
		)),
		workflowExecutionScope: {
			version: 1,
			triggerNodeId: normalizedTriggerId,
			workflowInstanceId,
			...(typeof triggerFacts.workflowKey === "string" && triggerFacts.workflowKey.trim()
				? { workflowKey: triggerFacts.workflowKey.trim() }
				: {}),
			...(normalizedStopAfterNodeId ? { stopAfterNodeId: normalizedStopAfterNodeId } : {}),
		},
		workflowSourceSnapshots: sourceSnapshots,
	};
}
