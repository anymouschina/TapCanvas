import { projectCanvasMembership } from "@tapcanvas/workflow-kernel-protocol";
import { parseWorkflowCallerCanvasSnapshot, type WorkflowProjectContext } from "./execution.project-context";
import type {
	WorkflowCanvasGroupFacts,
	WorkflowCanvasProjectContextFacts,
} from "./execution.video-workflow-contract";
import type {
	WorkflowAcceptedTurnSource,
	WorkflowActionableDeliverySource,
} from "./execution.workflow-source-authority";
import { freezeWorkflowAuthoritativeSource } from "./execution.source-lineage";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function previousChapterExitFromSource(value: unknown): NonNullable<WorkflowCanvasProjectContextFacts["previousChapterExit"]> | null {
	if (!isRecord(value)) return null;
	const strings = ["chapterId", "sourceBookId", "executionId", "clipId", "state", "visual"] as const;
	if (strings.some((field) => typeof value[field] !== "string" || !(value[field] as string).trim())) return null;
	if (typeof value.sourceBookChapter !== "number" || !Number.isInteger(value.sourceBookChapter) || value.sourceBookChapter < 1) return null;
	return {
		chapterId: value.chapterId as string,
		sourceBookId: value.sourceBookId as string,
		sourceBookChapter: value.sourceBookChapter,
		executionId: value.executionId as string,
		clipId: value.clipId as string,
		state: value.state as string,
		visual: value.visual as string,
	};
}

function visualContextTextRole(value: unknown): string | null {
	if (!isRecord(value) || !isRecord(value.data)) return null;
	if (value.data.kind !== "text") return null;
	const roles = [
		...(value.data.semanticKind === "projectLookBible" ? ["semanticKind=projectLookBible"] : []),
		...(value.data.productionLayer === "anchors" ? ["productionLayer=anchors"] : []),
	];
	return roles.length > 0 ? roles.join(", ") : null;
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
 * group. Canonical and explicitly selected narrative nodes are authoritative
 * and retain their separate node identities. For chapter scope, the frozen
 * ProjectContext carries the canonical locked chapter seed first; explicitly
 * selected ready narrative text nodes follow it as separate sources. An
 * unselected draft is never promoted alongside an explicit source. On a
 * non-chapter request, the accepted turn remains the user request when a
 * narrative node is selected; without a selected node, it supplies the
 * creative source. Without that brief, a completed text-expansion workflow can
 * mark ready nodes as `expanded_story_source`; otherwise a free-form canvas
 * requires one ready narrative text source.
 */
export function readWorkflowCanvasProjectContextFromFlowData(
	input: Readonly<{
		flowId: string;
		rowData: string;
		projectContext: WorkflowProjectContext;
		/** Standalone public chat may use a selected video as the only source. */
		allowNoTextSource?: boolean;
		/** The accepted turn stays a separate request and can supply creative source when no narrative node is selected or canonical. */
		acceptedTurnSource?: WorkflowAcceptedTurnSource | null;
		/** A selected prior delivery is an explicit narrative source, separate from the current user request. */
		actionableDeliverySource?: WorkflowActionableDeliverySource | null;
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
	const narrativeReadyTextNodeIds = readyTextNodeIds.filter((nodeId) => (
		visualContextTextRole(nodesById.get(nodeId)) === null
	));
	const narrativeReadyTextNodeIdSet = new Set(narrativeReadyTextNodeIds);
	const expandedStorySourceNodeIds = narrativeReadyTextNodeIds.filter((nodeId) => {
		const node = nodesById.get(nodeId);
		const data = node && isRecord(node.data) ? node.data : null;
		return data?.workflowSourceRole === "expanded_story_source";
	});
	// Focus is UI context, not an additional source selection. In particular, a
	// previously focused draft must not join an explicitly selected final script.
	const selectedNodeIds = [...new Set(
		input.projectContext.selection.nodeIds.map((value) => value.trim()).filter(Boolean),
	)];
	const explicitlySelectedIds = [...new Set(
		selectedNodeIds.filter((value) => narrativeReadyTextNodeIdSet.has(value)),
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

	const acceptedSource = input.acceptedTurnSource;
	const actionableDeliverySource = input.actionableDeliverySource ?? null;
	const chapterScoped = input.projectContext.canvasId.startsWith("chapter:");
	let sourceNodeIds: string[] = [];
	if (input.projectContext.sourceNodeId) {
		const canonicalNode = nodesById.get(input.projectContext.sourceNodeId);
		const visualRole = visualContextTextRole(canonicalNode);
		if (visualRole) {
			throw new Error(`Project context canonical source node ${input.projectContext.sourceNodeId} is visual context (${visualRole}), not an authoritative narrative source`);
		}
		if (!readyTextNodeIdSet.has(input.projectContext.sourceNodeId)) {
			throw new Error(`Project context canonical source node ${input.projectContext.sourceNodeId} is not a ready text asset`);
		}
		sourceNodeIds = [input.projectContext.sourceNodeId];
	}
	if (sourceNodeIds.length > 0) {
		const includedSourceNodeIds = new Set(sourceNodeIds);
		sourceNodeIds.push(...explicitlySelectedIds.filter((nodeId) => !includedSourceNodeIds.has(nodeId)));
	} else {
		sourceNodeIds = explicitlySelectedIds;
	}
	if (sourceNodeIds.length === 0 && selectedNodeIds.length > 0
		&& !acceptedSource && !actionableDeliverySource && !input.allowNoTextSource) {
		throw new Error("Project context selection does not include a ready text source node");
	}
	const acceptedTurnIsNarrativeSource = Boolean(
		acceptedSource && !actionableDeliverySource && !chapterScoped && sourceNodeIds.length === 0,
	);
	if (!acceptedTurnIsNarrativeSource && sourceNodeIds.length === 0) {
		if (input.allowNoTextSource && selectedNodeIds.length > 0) {
			sourceNodeIds = [];
		} else if (actionableDeliverySource && !chapterScoped) {
			// The explicit delivery reference is the selected narrative source; do not
			// silently supplement it with an unselected project draft.
			sourceNodeIds = [];
		} else if (selectedNodeIds.length === 0 && expandedStorySourceNodeIds.length > 0) {
			// A completed text-expansion workflow is an explicit structural source
			// role. Prefer it over older draft text nodes so one-click production
			// consumes the newly authored story without requiring manual deletion or
			// semantic keyword routing.
			sourceNodeIds = expandedStorySourceNodeIds;
		} else {
			sourceNodeIds = narrativeReadyTextNodeIds;
		}
		if (sourceNodeIds.length !== 1 && !input.allowNoTextSource) {
			throw new Error(
				`Project context source requires exactly one ready narrative text node when there is no explicit canvas selection or canonical source; found ${String(sourceNodeIds.length)}`,
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
		const frozenAsset = input.projectContext.assetSnapshot.find((asset) => (
			asset.flowId === input.projectContext.canvasId && asset.nodeId === nodeId
		));
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

	const canonicalSource = input.projectContext.sourceNodeId
		? nodesById.get(input.projectContext.sourceNodeId) : null;
	const canonicalData = canonicalSource && isRecord(canonicalSource.data) ? canonicalSource.data : null;
	const previousChapterExit = input.projectContext.canvasId.startsWith("chapter:")
		? previousChapterExitFromSource(canonicalData?.previousChapterExit) : null;
	const canvasAuthoritativeSources = acceptedTurnIsNarrativeSource && acceptedSource
		? [{ sourceId: acceptedSource.sourceId, content: acceptedSource.text, sourceFingerprint: acceptedSource.fingerprint, kind: acceptedSource.kind }]
		: sourceNodes.length > 0
			? sourceNodes.map((node) => freezeWorkflowAuthoritativeSource({
				nodeId: node.nodeId,
				content: node.content,
				...(node.label ? { label: node.label } : {}),
				...(node.sourceRevision !== undefined ? { sourceRevision: node.sourceRevision } : {}),
				...(node.sourceHash ? { sourceHash: node.sourceHash } : {}),
			}))
			: [];
	const deliveryAuthoritativeSource = actionableDeliverySource
		? freezeWorkflowAuthoritativeSource({
			sourceId: `actionable-delivery:${actionableDeliverySource.reference.referenceId}`,
			sourceType: "actionable_delivery",
			referenceId: actionableDeliverySource.reference.referenceId,
			publicTurnId: actionableDeliverySource.reference.publicTurnId,
			deliveredAt: actionableDeliverySource.reference.deliveredAt,
			label: actionableDeliverySource.reference.label,
			artifactKind: actionableDeliverySource.reference.artifactKind,
			content: actionableDeliverySource.reference.content,
			contentHash: actionableDeliverySource.reference.contentHash,
		})
		: null;
	const authoritativeSources = deliveryAuthoritativeSource
		? chapterScoped
			? [...canvasAuthoritativeSources, deliveryAuthoritativeSource]
			: [deliveryAuthoritativeSource, ...canvasAuthoritativeSources]
		: canvasAuthoritativeSources;

	return {
		sourceMode: "project_context",
		flowId: input.flowId,
		sourceNodeIds,
		...(previousChapterExit ? { previousChapterExit } : {}),
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
					"referenceType", "roleName", "physicalIdentityKey", "semanticKind", "productionLayer",
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
		actionableDeliverySource?: WorkflowActionableDeliverySource | null;
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
