import { projectCanvasMembership } from "@tapcanvas/workflow-kernel-protocol";
import { parseWorkflowCallerCanvasSnapshot, type WorkflowProjectContext } from "./execution.project-context";
import type {
	WorkflowCanvasGroupFacts,
	WorkflowCanvasProjectContextFacts,
} from "./execution.video-workflow-contract";
import type { WorkflowAcceptedTurnSource } from "./execution.workflow-source-authority";
import { freezeWorkflowAuthoritativeSource } from "./execution.source-lineage";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFlowData(raw: unknown): JsonRecord {
	let parsed = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw) as unknown;
		} catch (error: unknown) {
			throw new Error(`Immutable canvas flow version is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) throw new Error("Canvas flow has no nodes array");
	return projectCanvasMembership(parsed) as JsonRecord;
}

export async function readWorkflowCanvasGroup(
	input: Readonly<{ flowId: string; ownerId: string; groupId: string; flowVersionData: unknown }>,
): Promise<WorkflowCanvasGroupFacts> {
	const flow = parseFlowData(input.flowVersionData);
	const snapshots = isRecord(flow.workflowSourceSnapshots) ? flow.workflowSourceSnapshots : null;
	if (!snapshots) throw new Error("Immutable workflow flow version has no source snapshots");
	const snapshot = snapshots[input.groupId];
	if (!isRecord(snapshot) || !isRecord(snapshot.group) || !Array.isArray(snapshot.children)) {
		throw new Error(`Canvas source group ${input.groupId} does not exist in the frozen workflow source snapshots`);
	}
	const group = snapshot.group;
	if (group.type !== "groupNode") throw new Error(`Canvas source ${input.groupId} is not a groupNode`);
	const groupData = isRecord(group.data) ? group.data : {};
	if (groupData.adminWorkflow === true) throw new Error("An administrator workflow group cannot be used as production source content");
	const children = snapshot.children.filter(isRecord);
	if (children.length === 0) throw new Error(`Canvas source group ${input.groupId} has no child nodes`);
	return {
		flowId: input.flowId,
		groupId: input.groupId,
		group,
		children,
	};
}

/**
 * 系统级共享工作流（delivery 重定向到调用者项目）的源组读取：从调用者当前
 * 画布（live flow data）解析 groupNode 及其子节点，使工作流能复用调用者项目
 * 内真实节点（文本 + 已就绪图片/视频）作为源与参考资产。与冻结快照路径
 * （readWorkflowCanvasGroup）只差数据来源，守卫规则完全一致。
 */
export function readWorkflowCanvasGroupFromFlowData(
	input: Readonly<{ flowId: string; groupId: string; rowData: string }>,
): WorkflowCanvasGroupFacts {
	const flow = parseFlowData(input.rowData);
	const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
	const group = nodes.find((node) => isRecord(node) && readNodeId(node) === input.groupId);
	if (!isRecord(group) || group.type !== "groupNode") {
		throw new Error(`Canvas source group ${input.groupId} does not exist in the caller canvas flow ${input.flowId}`);
	}
	const groupData = isRecord(group.data) ? group.data : {};
	if (groupData.adminWorkflow === true) throw new Error("An administrator workflow group cannot be used as production source content");
	const children = nodes.filter((node) => isRecord(node) && node.parentId === input.groupId);
	if (children.length === 0) throw new Error(`Canvas source group ${input.groupId} has no child nodes`);
	return {
		flowId: input.flowId,
		groupId: input.groupId,
		group,
		children,
	};
}

/**
 * Resolve a project-context source without asking the Agent to invent a canvas
 * group. Explicitly selected nodes win. For chapter scope, the frozen
 * ProjectContext carries the canonical locked chapter seed as sourceNodeId;
 * derived script/look-bible text nodes remain visible assets but are not
 * mistaken for the narrative source. A completed text-expansion workflow can
 * mark one ready node as `expanded_story_source`; when no selection or
 * canonical chapter source is provided, that structural role wins over older
 * drafts. A free-form canvas still requires one ready text source otherwise.
 */
export function readWorkflowCanvasProjectContextFromFlowData(
	input: Readonly<{
		flowId: string;
		rowData: string;
		projectContext: WorkflowProjectContext;
		/** Standalone public chat may use a selected video as the only source. */
		allowNoTextSource?: boolean;
		/** A server-owned public turn can be the sole creative source when the caller canvas has no text node. */
		acceptedTurnSource?: WorkflowAcceptedTurnSource | null;
	}>,
): WorkflowCanvasProjectContextFacts {
	const flow = parseFlowData(input.rowData);
	const nodes = Array.isArray(flow.nodes) ? flow.nodes.filter(isRecord) : [];
	const nodesById = new Map(nodes.map((node) => [readNodeId(node), node] as const));
	// Project-node projections (for example the durable workflow status card) can
	// be indexed as `mediaKind=text` even though their canvas node has no source
	// facts.  A source is executable only when the current flow node itself
	// exposes a kind and non-empty content/chapterText/prompt.  Keep the asset
	// snapshot as the readiness signal, but require the node facts here so a
	// status projection can never become the narrative source by accident.
	const readyTextNodeIds = [...new Set(input.projectContext.assetSnapshot.flatMap((asset) => {
		if (
			asset.flowId !== input.projectContext.canvasId
			|| asset.mediaKind !== "text"
			|| asset.state !== "ready"
			|| !asset.nodeId
		) return [];
		const node = nodesById.get(asset.nodeId);
		// Keep an absent node in the candidate set so the later, explicit
		// "does not exist" error remains observable; only an existing node with
		// invalid facts is excluded as a non-source projection.
		if (!node) return [asset.nodeId];
		const data = isRecord(node.data) ? node.data : null;
		const kind = typeof data?.kind === "string" ? data.kind.trim() : "";
		const content = [data?.content, data?.chapterText, data?.prompt]
			.some((value) => typeof value === "string" && value.trim().length > 0);
		return kind && content ? [asset.nodeId] : [];
	}))];
	const readyTextNodeIdSet = new Set(readyTextNodeIds);
	const expandedStorySourceNodeIds = readyTextNodeIds.filter((nodeId) => {
		const node = nodesById.get(nodeId);
		const data = node && isRecord(node.data) ? node.data : null;
		return data?.workflowSourceRole === "expanded_story_source";
	});
	const selectedNodeIds = [...new Set([
		...input.projectContext.selection.nodeIds,
		...(input.projectContext.selection.activeNodeId
			? [input.projectContext.selection.activeNodeId]
			: []),
	].map((value) => value.trim()).filter(Boolean))];
	const explicitlySelectedIds = [...new Set(
		selectedNodeIds.filter((value) => readyTextNodeIdSet.has(value)),
	)];
	const referenceVideoNodeIds = [...new Set(
		selectedNodeIds.filter((value) => {
			const node = nodesById.get(value);
			if (!node) return false;
			const data = isRecord(node.data) ? node.data : {};
			const hasVideoUrl = typeof data.videoUrl === "string" && data.videoUrl.trim().length > 0;
			const hasVideoResults = Array.isArray(data.videoResults) && data.videoResults.some((result) =>
				isRecord(result) && typeof result.url === "string" && result.url.trim().length > 0);
			// A video prompt node is an authoring artifact until media is materialized.
			// Its kind alone cannot authorize a media-analysis invocation.
			return hasVideoUrl || hasVideoResults;
		}),
	)];

	let sourceNodeIds: string[] = [];
	if (input.projectContext.sourceNodeId) {
		if (!readyTextNodeIdSet.has(input.projectContext.sourceNodeId)) {
			throw new Error(`Project context canonical source node ${input.projectContext.sourceNodeId} is not a ready text asset`);
		}
		sourceNodeIds = [input.projectContext.sourceNodeId];
	}
	if (sourceNodeIds.length === 0) {
		sourceNodeIds = explicitlySelectedIds;
		if (selectedNodeIds.length > 0 && sourceNodeIds.length === 0 && !input.allowNoTextSource) {
			throw new Error("Project context selection does not include a ready text source node");
		}
	}
	if (sourceNodeIds.length === 0) {
		if (input.allowNoTextSource && selectedNodeIds.length > 0) {
			sourceNodeIds = [];
		} else if (selectedNodeIds.length === 0 && expandedStorySourceNodeIds.length > 0) {
			// A completed text-expansion workflow is an explicit structural source
			// role. Prefer it over older draft text nodes so one-click production
			// consumes the newly authored story without requiring manual deletion or
			// semantic keyword routing.
			sourceNodeIds = expandedStorySourceNodeIds;
		} else {
			sourceNodeIds = readyTextNodeIds;
		}
		if (sourceNodeIds.length !== 1 && !input.allowNoTextSource) {
			throw new Error(
				`Project context source requires exactly one ready text node when there is no explicit canvas selection or canonical source; found ${String(sourceNodeIds.length)}`,
			);
		}
	}

	const sourceNodes = sourceNodeIds.map((nodeId) => {
		const node = nodesById.get(nodeId);
		if (!node) throw new Error(`Project context source node ${nodeId} does not exist in caller canvas flow ${input.flowId}`);
		const data = isRecord(node.data) ? node.data : {};
		if (data.adminWorkflow === true) throw new Error(`Project context source node ${nodeId} is an administrator workflow node`);
		const kind = typeof data.kind === "string" ? data.kind.trim() : "";
		const content = [data.content, data.chapterText, data.prompt]
			.find((value) => typeof value === "string" && value.trim()) as string | undefined;
		if (!kind || !content?.trim()) {
			throw new Error(`Project context source node ${nodeId} must expose top-level kind and non-empty content facts`);
		}
		const frozenAsset = input.projectContext.assetSnapshot.find((asset) => asset.nodeId === nodeId);
		const declaredRevision = Number(data.sourceChapterRevision);
		const sourceRevision = Number.isInteger(declaredRevision) && declaredRevision >= 0
			? declaredRevision
			: frozenAsset ? Math.max(0, frozenAsset.assetVersion - 1) : 0;
		const declaredHash = typeof data.sourceHash === "string" ? data.sourceHash.trim() : "";
		return {
			nodeId,
			kind,
			content: content.trim(),
			label: typeof data.label === "string" ? data.label.trim() : "",
			sourceRevision,
			...(declaredHash ? { sourceHash: declaredHash } : {}),
		};
	});

	const acceptedSource = input.acceptedTurnSource;
	const authoritativeSources = sourceNodes.length > 0
		? sourceNodes.map((node) => freezeWorkflowAuthoritativeSource({
			nodeId: node.nodeId,
			content: node.content,
			...(node.label ? { label: node.label } : {}),
			...(node.sourceRevision !== undefined ? { sourceRevision: node.sourceRevision } : {}),
			...(node.sourceHash ? { sourceHash: node.sourceHash } : {}),
		}))
		: acceptedSource
			? [{ sourceId: acceptedSource.sourceId, content: acceptedSource.text, sourceFingerprint: acceptedSource.fingerprint, kind: acceptedSource.kind }]
			: [];

	return {
		sourceMode: "project_context",
		flowId: input.flowId,
		sourceNodeIds,
		selectedNodeFacts: selectedNodeIds.flatMap((nodeId) => {
			const node = nodesById.get(nodeId);
			if (!node) return [];
			const data = isRecord(node.data) ? node.data : {};
			if (data.adminWorkflow === true) return [];
			return [{
				nodeId,
				assetIds: input.projectContext.assetSnapshot.filter((asset) => (
					asset.flowId === input.projectContext.canvasId && asset.nodeId === nodeId
				)).map((asset) => asset.assetId),
				// Preserve persisted descriptions as source metadata, not observed
				// visual facts or authoritative narrative. Media remains ID-bound.
				metadata: Object.fromEntries([
					"kind", "label", "content", "chapterText", "prompt", "description",
					"referenceType", "roleName", "physicalIdentityKey",
				].filter((field) => !sourceNodeIds.includes(nodeId)
					|| !["content", "chapterText", "prompt"].includes(field))
				.flatMap((field) => typeof data[field] === "string" && data[field].trim()
					? [[field, data[field]]] : [])),
			}];
		}),
		missingSelectedNodeIds: selectedNodeIds.filter((nodeId) => !nodesById.has(nodeId)),
		...(referenceVideoNodeIds.length > 0 ? { referenceVideoNodeIds } : {}),
		referenceVideoDiagnostics: selectedNodeIds.flatMap((nodeId) => {
			const node = nodesById.get(nodeId);
			const data = node && isRecord(node.data) ? node.data : {};
			return (data.kind === "video" || data.kind === "composeVideo") && !referenceVideoNodeIds.includes(nodeId)
				? [{ nodeId, code: "video_media_not_materialized", analysisRequested: false }] : [];
		}),
		nodes: sourceNodes,
		authoritativeSources,
	};
}

function readNodeId(value: unknown): string {
	return isRecord(value) && typeof value.id === "string" ? value.id.trim() : "";
}

/** Narrative identity and content must come from the same acceptance snapshot. */
export function readWorkflowCanvasProjectContextFromSnapshot(
	input: Readonly<{
		flowId: string;
		flowVersionData: unknown;
		projectContext: WorkflowProjectContext;
		allowNoTextSource?: boolean;
		acceptedTurnSource?: WorkflowAcceptedTurnSource | null;
	}>,
): WorkflowCanvasProjectContextFacts {
	const root = isRecord(input.flowVersionData) ? input.flowVersionData : {};
	const snapshot = parseWorkflowCallerCanvasSnapshot(root.workflowCallerCanvasSnapshot);
	if (!snapshot) throw new Error("Project-context workflow source requires the frozen caller canvas snapshot");
	return readWorkflowCanvasProjectContextFromFlowData({
		...input,
		rowData: JSON.stringify(snapshot),
	});
}
