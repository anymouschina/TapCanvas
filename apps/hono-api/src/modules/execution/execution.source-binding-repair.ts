import type { AppContext } from "../../types";
import { getFlowForOwner } from "../flow/flow.repo";
import { loadChapterWorkflowSource } from "../chapter/chapter.workflow-source";
import { projectNodeAssetsFromCanvases } from "../material/material.project-node-assets";
import { createWorkflowCallerCanvasSnapshot, projectAssetSnapshot,
	type WorkflowCallerCanvasSnapshot, type WorkflowProjectContext } from "./execution.project-context";

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Bind only a missing canonical input. An already frozen source is never refreshed. */
export async function repairMissingWorkflowSourceBinding(input: {
	projectContext: WorkflowProjectContext; callerCanvasSnapshot: WorkflowCallerCanvasSnapshot;
	loadSource: () => Promise<{ snapshot: WorkflowCallerCanvasSnapshot; revision: number }>;
}) {
	const { projectContext: context, callerCanvasSnapshot: snapshot } = input;
	const sourceId = context.sourceNodeId;
	const unchanged = { projectContext: context, callerCanvasSnapshot: snapshot, repaired: false };
	if (!sourceId) return unchanged;
	const asset = context.assetSnapshot.find((item) => item.flowId === context.canvasId && item.nodeId === sourceId);
	const frozen = snapshot.nodes.find((node) => record(node).id === sourceId);
	// Never rebind an existing asset identity, including unavailable assets.
	if (asset) return unchanged;
	const loaded = frozen ? null : await input.loadSource();
	const source = frozen ?? loaded?.snapshot.nodes.find((node) => record(node).id === sourceId);
	if (!source) throw new Error(`Canonical source ${sourceId} is still missing from its authorized canvas`);
	const data = record(record(source).data);
	if (data.kind !== "text" || ![data.content, data.chapterText].some((value) => typeof value === "string" && value.trim())) {
		throw new Error(`Canonical source ${sourceId} has no narrative text`);
	}
	const chapter = context.canvasId.startsWith("chapter:");
	const ownerId = chapter ? context.canvasId.slice("chapter:".length) : context.canvasId;
	const sourceSnapshot = projectNodeAssetsFromCanvases([{ projectId: context.projectId,
		ownerType: chapter ? "chapter" : "project", ownerId, flowId: context.canvasId,
		data: { nodes: [source], edges: [] }, canvasRevision: loaded?.revision ?? 0,
		createdAt: context.capturedAt, updatedAt: loaded ? new Date().toISOString() : context.capturedAt }]).map(projectAssetSnapshot)[0];
	if (!sourceSnapshot || sourceSnapshot.mediaKind !== "text" || sourceSnapshot.state !== "ready") {
		throw new Error(`Canonical source ${sourceId} did not produce a ready text asset`);
	}
	return { repaired: true,
		projectContext: { ...context, assetSnapshot: [...context.assetSnapshot, sourceSnapshot],
			projectAssetIds: [...new Set([...context.projectAssetIds, sourceSnapshot.assetId])] },
		callerCanvasSnapshot: { ...snapshot, nodes: frozen ? snapshot.nodes : [...snapshot.nodes, source] } };
}

export async function loadWorkflowSourceBindingCandidate(c: AppContext, ownerId: string, context: WorkflowProjectContext) {
	if (context.canvasId.startsWith("chapter:")) {
		const source = await loadChapterWorkflowSource(c, ownerId, context.projectId, context.canvasId.slice("chapter:".length));
		return { snapshot: createWorkflowCallerCanvasSnapshot(source.flow), revision: source.revision };
	}
	const flow = await getFlowForOwner(c.env.DB, context.canvasId, ownerId);
	if (!flow || flow.project_id !== context.projectId) throw new Error("Canonical source canvas is not accessible in the frozen project");
	return { snapshot: createWorkflowCallerCanvasSnapshot(flow.data), revision: flow.canvas_revision ?? 0 };
}
