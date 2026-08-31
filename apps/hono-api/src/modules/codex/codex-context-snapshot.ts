import { createHash, randomUUID } from "node:crypto";
import type {
	CodexCanvasContext,
	CodexCanvasContextSnapshot,
	CodexCanvasScope,
} from "@tapcanvas/codex-task-protocol";
import type { AppContext } from "../../types";
import {
	CanvasFlowCorruptedError,
	CanvasFlowNotFoundError,
	getChapterCanvasFlow,
} from "../chapter/chapter.canvas-flow.service";
import { PublicFlowGraphSchema } from "../flow/flow.public.schemas";
import { getFlowByIdUnsafe } from "../flow/flow.repo";

const MAX_CONTEXT_SNAPSHOT_BYTES = 2 * 1024 * 1024;

type ProjectContext = {
	id: string;
	name: string;
};

type SnapshotGraph = CodexCanvasContextSnapshot["graph"];

export class CodexCanvasContextSnapshotError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly status: 400 | 403 | 409 | 413 | 422,
		public readonly details: Record<string, unknown> | null = null,
	) {
		super(message);
		this.name = "CodexCanvasContextSnapshotError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeId(value: unknown): string {
	if (!isRecord(value)) return "";
	return typeof value.id === "string" ? value.id.trim() : "";
}

function nodeKind(value: unknown): string {
	if (!isRecord(value)) return "";
	const data = isRecord(value.data) ? value.data : null;
	const dataKind = typeof data?.kind === "string" ? data.kind.trim() : "";
	if (dataKind) return dataKind;
	return typeof value.type === "string" ? value.type.trim() : "";
}

function normalizeGraph(value: unknown, sourceLabel: string): SnapshotGraph {
	const parsed = PublicFlowGraphSchema.safeParse(value);
	if (!parsed.success) {
		throw new CodexCanvasContextSnapshotError(
			`${sourceLabel} 的画布数据不符合真实 graph 契约`,
			"codex_canvas_graph_invalid",
			422,
			{ issues: parsed.error.issues },
		);
	}
	const viewport = parsed.data.viewport ?? null;
	if (viewport && viewport.zoom <= 0) {
		throw new CodexCanvasContextSnapshotError(
			`${sourceLabel} 的画布 viewport.zoom 必须大于 0`,
			"codex_canvas_viewport_invalid",
			422,
		);
	}
	return {
		nodes: parsed.data.nodes,
		edges: parsed.data.edges,
		viewport,
	};
}

function parseFlowGraph(raw: string, flowId: string): SnapshotGraph {
	let value: unknown;
	try {
		value = JSON.parse(raw) as unknown;
	} catch (error: unknown) {
		throw new CodexCanvasContextSnapshotError(
			`Flow ${flowId} 的画布 JSON 已损坏，无法创建 Codex 上下文快照`,
			"codex_canvas_flow_corrupted",
			422,
			{
				reason: error instanceof Error ? error.message : String(error),
			},
		);
	}
	return normalizeGraph(value, `Flow ${flowId}`);
}

function selectNodes(
	graph: SnapshotGraph,
	selectedNodeIds: string[],
): { nodes: unknown[]; kinds: string[] } {
	const uniqueIds = new Set(selectedNodeIds);
	if (uniqueIds.size !== selectedNodeIds.length) {
		throw new CodexCanvasContextSnapshotError(
			"selectedNodeIds 包含重复节点，无法确定唯一画布选择",
			"codex_canvas_selection_invalid",
			400,
		);
	}
	const byId = new Map<string, unknown>();
	for (const node of graph.nodes) {
		const id = nodeId(node);
		if (id) byId.set(id, node);
	}
	const missing = selectedNodeIds.filter((id) => !byId.has(id));
	if (missing.length > 0) {
		throw new CodexCanvasContextSnapshotError(
			"选中节点已不在当前持久化画布版本中，请等待画布保存后重新派发",
			"codex_canvas_selection_stale",
			409,
			{ missingNodeIds: missing },
		);
	}
	const nodes = selectedNodeIds.map((id) => byId.get(id));
	const kinds = [...new Set(nodes.map(nodeKind).filter(Boolean))];
	return { nodes, kinds };
}

function assertRevision(
	expected: number | null,
	actual: number,
	scopeKind: "flow" | "chapter",
): void {
	if (expected === null || expected === actual) return;
	throw new CodexCanvasContextSnapshotError(
		"画布版本已变化，请基于最新画布重新派发任务",
		"codex_canvas_revision_conflict",
		409,
		{ expected, actual, scopeKind },
	);
}

async function loadSnapshotSource(input: {
	c: AppContext;
	userId: string;
	project: ProjectContext;
	scope: CodexCanvasScope;
}): Promise<{
	graph: SnapshotGraph;
	flowName: string | null;
	canvasRevision: number | null;
}> {
	if (input.scope.flowId) {
		const flow = await getFlowByIdUnsafe(input.c.env.DB, input.scope.flowId);
		if (!flow || flow.project_id !== input.project.id) {
			throw new CodexCanvasContextSnapshotError(
				"任务指定的 flow 不属于该项目",
				"codex_canvas_flow_scope_invalid",
				400,
			);
		}
		const revision = flow.canvas_revision ?? 0;
		assertRevision(input.scope.canvasRevision, revision, "flow");
		return {
			graph: parseFlowGraph(flow.data, flow.id),
			flowName: flow.name,
			canvasRevision: revision,
		};
	}

	if (input.scope.chapterId) {
		const chapter = await input.c.env.DB.chapters.findFirst({
			where: { id: input.scope.chapterId },
			select: { project_id: true, title: true },
		});
		if (!chapter || chapter.project_id !== input.project.id) {
			throw new CodexCanvasContextSnapshotError(
				"任务指定的 chapter 不属于该项目",
				"codex_canvas_chapter_scope_invalid",
				400,
			);
		}
		try {
			const result = await getChapterCanvasFlow(
				input.c,
				input.userId,
				input.scope.chapterId,
			);
			assertRevision(input.scope.canvasRevision, result.revision, "chapter");
			return {
				graph: normalizeGraph(
					result.flow ?? { nodes: [], edges: [] },
					`Chapter ${input.scope.chapterId}`,
				),
				flowName: chapter.title,
				canvasRevision: result.revision,
			};
		} catch (error: unknown) {
			if (error instanceof CodexCanvasContextSnapshotError) throw error;
			if (error instanceof CanvasFlowNotFoundError) {
				throw new CodexCanvasContextSnapshotError(
					"无权读取任务指定的章节画布",
					"codex_canvas_chapter_forbidden",
					403,
				);
			}
			if (error instanceof CanvasFlowCorruptedError) {
				throw new CodexCanvasContextSnapshotError(
					"章节画布 JSON 已损坏，无法创建 Codex 上下文快照",
					"codex_canvas_chapter_corrupted",
					422,
				);
			}
			throw error;
		}
	}

	if (input.scope.canvasRevision !== null) {
		throw new CodexCanvasContextSnapshotError(
			"项目级 Codex 任务没有 flow/chapter，不能携带 canvasRevision",
			"codex_canvas_revision_scope_invalid",
			400,
		);
	}
	if (input.scope.selectedNodeIds.length > 0) {
		throw new CodexCanvasContextSnapshotError(
			"项目级 Codex 任务没有真实画布，不能携带 selectedNodeIds",
			"codex_canvas_selection_scope_invalid",
			400,
		);
	}
	return {
		graph: { nodes: [], edges: [], viewport: null },
		flowName: null,
		canvasRevision: null,
	};
}

export function codexCanvasContextReference(
	snapshot: CodexCanvasContextSnapshot,
): CodexCanvasContext {
	const { graph: _graph, selectedNodes: _selectedNodes, ...reference } = snapshot;
	return reference;
}

export function assembleCodexCanvasContextSnapshot(input: {
	project: ProjectContext;
	scope: CodexCanvasScope;
	source: {
		graph: SnapshotGraph;
		flowName: string | null;
		canvasRevision: number | null;
	};
	snapshotId: string;
	createdAt: string;
}): CodexCanvasContextSnapshot {
	const selection = selectNodes(input.source.graph, input.scope.selectedNodeIds);
	const content = {
		snapshotId: input.snapshotId,
		projectId: input.project.id,
		flowId: input.scope.flowId,
		chapterId: input.scope.chapterId,
		canvasRevision: input.source.canvasRevision,
		selectedNodeIds: input.scope.selectedNodeIds,
		selectedNodeKinds: selection.kinds,
		projectName: input.project.name,
		flowName: input.source.flowName,
		nodeCount: input.source.graph.nodes.length,
		edgeCount: input.source.graph.edges.length,
		createdAt: input.createdAt,
		graph: input.source.graph,
		selectedNodes: selection.nodes,
	};
	const serializedContent = JSON.stringify(content);
	const snapshot: CodexCanvasContextSnapshot = {
		...content,
		sha256: createHash("sha256").update(serializedContent).digest("hex"),
	};
	const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
	if (snapshotBytes > MAX_CONTEXT_SNAPSHOT_BYTES) {
		throw new CodexCanvasContextSnapshotError(
			`画布上下文快照为 ${snapshotBytes} bytes，超过 ${MAX_CONTEXT_SNAPSHOT_BYTES} bytes 的明确上限；请缩小真实画布作用域后重试`,
			"codex_canvas_context_too_large",
			413,
			{ snapshotBytes, maxBytes: MAX_CONTEXT_SNAPSHOT_BYTES },
		);
	}
	return snapshot;
}

export async function createCodexCanvasContextSnapshot(input: {
	c: AppContext;
	userId: string;
	project: ProjectContext;
	scope: CodexCanvasScope;
	nowIso?: string;
}): Promise<CodexCanvasContextSnapshot> {
	const source = await loadSnapshotSource(input);
	return assembleCodexCanvasContextSnapshot({
		project: input.project,
		scope: input.scope,
		source,
		snapshotId: randomUUID(),
		createdAt: input.nowIso ?? new Date().toISOString(),
	});
}
