function readHttpUrl(value) {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		const url = new URL(value.trim());
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

export function readMediaDeliveryCandidates(kind, status) {
	const turn = status && typeof status === "object" && !Array.isArray(status) ? status.turn : null;
	const terminalDelivery = turn && typeof turn === "object" && !Array.isArray(turn)
		? turn.terminalDelivery
		: null;
	const evidence = terminalDelivery && typeof terminalDelivery === "object" && !Array.isArray(terminalDelivery) &&
		Array.isArray(terminalDelivery.deliveryEvidence)
		? terminalDelivery.deliveryEvidence
		: [];
	return evidence.flatMap((value) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return [];
		const attributes = value.attributes && typeof value.attributes === "object" && !Array.isArray(value.attributes)
			? value.attributes
			: {};
		const isArtifactReceipt = value.kind === "artifact" && value.mediaType === kind;
		const isSubmissionReceipt = value.kind === "persisted_state" && value.artifactClass === kind &&
			attributes.completionBoundary === "submission";
		if (!isArtifactReceipt && !isSubmissionReceipt) return [];
		const evidenceId = typeof value.evidenceId === "string" && value.evidenceId.trim()
			? value.evidenceId.trim()
			: null;
		const nodeId = typeof attributes.nodeId === "string" && attributes.nodeId.trim()
			? attributes.nodeId.trim()
			: null;
		const taskId = typeof attributes.taskId === "string" && attributes.taskId.trim()
			? attributes.taskId.trim()
			: null;
		const requirementIds = Array.isArray(value.requirementIds)
			? value.requirementIds.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
			: [];
		const url = readHttpUrl(attributes.url);
		return evidenceId && requirementIds.length > 0
			? [{ evidenceId, nodeId, taskId, requirementIds, url }]
			: [];
	});
}

export function readFlowNodes(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const flowData = value.data && typeof value.data === "object" && !Array.isArray(value.data)
		? value.data
		: null;
	return flowData && Array.isArray(flowData.nodes) ? flowData.nodes : [];
}

export function readFlowNodeIds(flow) {
	return new Set(readFlowNodes(flow).flatMap((node) =>
		node && typeof node === "object" && !Array.isArray(node) &&
		typeof node.id === "string" && node.id.trim()
			? [node.id.trim()]
			: []
	));
}

function readNodeData(node) {
	return node && typeof node === "object" && !Array.isArray(node) &&
		node.data && typeof node.data === "object" && !Array.isArray(node.data)
		? node.data
		: {};
}

function readNodeTaskIds(data) {
	return [data.taskId, data.imageTaskId, data.videoTaskId]
		.filter((item) => typeof item === "string" && item.trim())
		.map((item) => item.trim());
}

function isExactCandidateNode(node, candidate) {
	if (!node || typeof node !== "object" || Array.isArray(node)) return false;
	const data = readNodeData(node);
	const taskIds = readNodeTaskIds(data);
	return (candidate.nodeId && node.id === candidate.nodeId) ||
		(candidate.taskId && taskIds.includes(candidate.taskId));
}

function isIsolatedFlowDeltaNode(node, kind, baselineNodeIds) {
	if (!node || typeof node !== "object" || Array.isArray(node)) return false;
	if (typeof node.id !== "string" || !node.id.trim() || baselineNodeIds.has(node.id.trim())) return false;
	return readNodeData(node).kind === kind;
}

export function observeMaterializedEvidence(kind, candidates, flow, baselineNodeIds) {
	const nodes = readFlowNodes(flow);
	const usedNodeIds = new Set();
	return candidates.flatMap((candidate) => {
		if (candidate.url) return [];
		const hasReceiptIdentity = Boolean(candidate.nodeId || candidate.taskId);
		const node = nodes.find((value) => {
			if (!value || typeof value !== "object" || Array.isArray(value)) return false;
			const nodeId = typeof value.id === "string" ? value.id.trim() : "";
			if (!nodeId || usedNodeIds.has(nodeId)) return false;
			return hasReceiptIdentity
				? isExactCandidateNode(value, candidate)
				: isIsolatedFlowDeltaNode(value, kind, baselineNodeIds);
		});
		if (!node) return [];
		const nodeId = typeof node.id === "string" ? node.id.trim() : "";
		usedNodeIds.add(nodeId);
		const data = readNodeData(node);
		if (data.status === "error" || data.status === "failed") {
			throw new Error(
				`${kind} materialization failed for node ${nodeId}: ${String(data.error || data.errorMessage || "unknown")}`,
			);
		}
		const url = readHttpUrl(kind === "image" ? data.imageUrl : data.videoUrl);
		if (data.status !== "success" || !url) return [];
		const taskId = readNodeTaskIds(data)[0] ?? null;
		return [{
			evidenceId: `${candidate.evidenceId}:materialized:${nodeId}`,
			kind: "artifact",
			mediaType: kind,
			sourceRef: nodeId,
			requirementIds: candidate.requirementIds,
			attributes: {
				materialized: true,
				url,
				nodeId,
				...(taskId ? { taskId } : {}),
				observationSource: hasReceiptIdentity ? "isolated_flow_receipt" : "isolated_flow_delta",
			},
		}];
	});
}
