import { parseScriptExportSelection, type ChapterScriptPlanSummary } from "../../../../../packages/schemas/chapter-script-export";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { parseWorkflowNodeOutputV1 } from "../execution/execution.node-runtime";
import { getProjectForUserAccess } from "../project/project.repo";
import { sortChaptersForDisplay } from "./chapter.order";

// 剧本导出：每章取最近一次产出 Clip 提示词包的运行，把每个片段送给视频模型的提示词按集拼成 TXT（一卡剧本投稿格式）。

type JsonRecord = Record<string, unknown>;

/** The per-Clip video prompts of one chapter run, in film order. */
export type ChapterScriptPlan = Readonly<{
	clips: readonly Readonly<{ clipId: string; durationSeconds: number; prompt: string }>[];
}>;

const PROMPT_NODE_SUFFIX = ":clip-production-pipeline";
const PROMPT_PACKAGE_PORT = "prompt-package";
const CHAPTER_CANVAS_PREFIX = "chapter:";

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Export only the current persisted package contract, preserving prompt text verbatim. */
export function readChapterScriptPlan(raw: unknown): ChapterScriptPlan {
	if (!isRecord(raw) || raw.artifactType !== "tapcanvas.prompt-package/v2" || !Array.isArray(raw.clips) || !raw.clips.length) {
		throw new Error("Saved clip prompt package is missing or invalid");
	}
	const clips = raw.clips.map((clip: unknown) => {
		if (!isRecord(clip) || typeof clip.itemId !== "string" || !clip.itemId.trim()
			|| typeof clip.index !== "number" || !Number.isInteger(clip.index) || clip.index < 0
			|| typeof clip.durationSeconds !== "number" || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0
			|| typeof clip.prompt !== "string" || !clip.prompt.trim()) {
			throw new Error("Saved clip requires an id, index, positive duration and non-empty prompt");
		}
		return { order: clip.index, clipId: clip.itemId, durationSeconds: clip.durationSeconds, prompt: clip.prompt };
	}).sort((left, right) => left.order - right.order);
	if (new Set(clips.map(clip => clip.order)).size !== clips.length
		|| new Set(clips.map(clip => clip.clipId)).size !== clips.length) throw new Error("Saved clip ids and indices must be unique");
	return { clips: clips.map(({ order: _order, ...clip }) => clip) };
}

function readPlanFromOutput(outputRefs: unknown): ChapterScriptPlan {
	const output = parseWorkflowNodeOutputV1(outputRefs);
	if (!output) throw new Error("Saved workflow output is missing");
	return readChapterScriptPlan(output.ports[PROMPT_PACKAGE_PORT]);
}

function planDuration(plan: ChapterScriptPlan): number {
	return plan.clips.reduce((sum, clip) => sum + clip.durationSeconds, 0);
}

/** One episode: each Clip's video prompt verbatim, in film order. */
export function renderChapterScriptEpisode(input: Readonly<{ episode: number; title: string; plan: ChapterScriptPlan }>): string {
	const { plan } = input;
	const lines = [
		`第${input.episode}集　${input.title}`,
		`时长：约 ${planDuration(plan)} 秒 · ${plan.clips.length} 个片段`,
	];
	plan.clips.forEach((clip, index) => {
		lines.push("", `【片段${index + 1}　${clip.durationSeconds}秒】`, clip.prompt);
	});
	return lines.join("\n");
}

export function renderChapterScriptCollection(input: Readonly<{
	projectName: string;
	exportedAt: string;
	episodes: readonly Readonly<{ title: string; plan: ChapterScriptPlan }>[];
}>): string {
	const divider = "=".repeat(40);
	const head = [`《${input.projectName}》剧本`, `共 ${input.episodes.length} 集 · 导出于 ${input.exportedAt.slice(0, 10)}`];
	const body = input.episodes.map((episode, index) => renderChapterScriptEpisode({ episode: index + 1, title: episode.title, plan: episode.plan }));
	return [...head, ...body.flatMap((episode) => ["", divider, "", episode])].join("\n") + "\n";
}

type PlanRow = Readonly<{
	chapterId: string;
	executionId: string;
	executionStatus: string;
	plannedAt: string | null;
}>;

async function requireProject(c: AppContext, userId: string, projectId: string) {
	const project = await getProjectForUserAccess(c.env.DB, projectId, userId);
	if (!project) throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	if (!project.owner_id) throw new AppError("Project owner missing", { status: 500, code: "project_owner_missing", details: { projectId } });
	return { ...project, owner_id: project.owner_id };
}

/** Use each chapter's latest successful prompt node. A corrupt latest output fails explicitly. */
async function loadLatestChapterPlans(c: AppContext, userId: string, projectId: string, chapterIds: readonly string[]): Promise<Map<string, PlanRow & { plan: ChapterScriptPlan }>> {
	const plans = new Map<string, PlanRow & { plan: ChapterScriptPlan }>();
	if (!chapterIds.length) return plans;
	const scope = { owner_id: userId, project_id: projectId,
		canvas_id: { in: chapterIds.map(id => `${CHAPTER_CANVAS_PREFIX}${id}`) } };
	const rows = await c.env.DB.workflow_node_runs.findMany({
		where: { status: "success", node_id: { endsWith: PROMPT_NODE_SUFFIX }, workflow_executions: scope },
		select: { execution_id: true, node_id: true, finished_at: true, created_at: true,
			workflow_executions: { select: { canvas_id: true, status: true } } },
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
	});
	for (const row of rows) {
		const chapterId = row.workflow_executions.canvas_id!.slice(CHAPTER_CANVAS_PREFIX.length);
		if (plans.has(chapterId)) continue;
		const output = await c.env.DB.workflow_node_runs.findFirst({
			where: { execution_id: row.execution_id, node_id: row.node_id, workflow_executions: scope },
			select: { output_refs: true },
		});
		try {
			plans.set(chapterId, { chapterId, executionId: row.execution_id,
				executionStatus: row.workflow_executions.status, plannedAt: row.finished_at,
				plan: readPlanFromOutput(output?.output_refs) });
		} catch (failure: unknown) {
			const reason = failure instanceof Error ? failure.message : String(failure);
			console.error("[chapter-script-export] saved prompt package invalid", { projectId, userId, chapterId,
				executionId: row.execution_id, nodeId: row.node_id, reason });
			throw new AppError(`章节 ${chapterId} 已保存的提示词无法读取：${reason}`, {
				status: 409, code: "script_export_plan_invalid", details: { chapterId, executionId: row.execution_id, reason },
			});
		}
	}
	return plans;
}

async function listProjectChapters(c: AppContext, projectId: string, ownerId: string) {
	const chapters = await c.env.DB.chapters.findMany({
		where: { project_id: projectId, owner_id: ownerId },
		select: { id: true, chapter_index: true, title: true, sort_order: true,
			source_book_chapter: true, created_at: true },
	});
	return sortChaptersForDisplay(chapters.map(chapter => ({
		...chapter,
		sourceBookChapter: chapter.source_book_chapter,
		sortOrder: chapter.sort_order,
		index: chapter.chapter_index,
		createdAt: chapter.created_at,
	})));
}

export async function listChapterScriptPlansForUser(c: AppContext, userId: string, projectId: string): Promise<ChapterScriptPlanSummary[]> {
	const project = await requireProject(c, userId, projectId);
	const chapters = await listProjectChapters(c, projectId, project.owner_id);
	const plans = await loadLatestChapterPlans(c, userId, projectId, chapters.map(chapter => chapter.id));
	return chapters.flatMap((chapter) => {
		const found = plans.get(chapter.id);
		return found ? [{
			chapterId: chapter.id,
			chapterIndex: chapter.chapter_index,
			title: chapter.title,
			executionId: found.executionId,
			executionStatus: found.executionStatus,
			plannedAt: found.plannedAt,
			clipCount: found.plan.clips.length,
			durationSeconds: planDuration(found.plan),
		}] : [];
	});
}

export async function exportChapterScriptsForUser(c: AppContext, userId: string, projectId: string, chapterIds: readonly string[]): Promise<Readonly<{ fileName: string; text: string }>> {
	const project = await requireProject(c, userId, projectId);
	const wanted = new Set(parseScriptExportSelection({ chapterIds }));
	const chapters = await listProjectChapters(c, projectId, project.owner_id);
	const selected = chapters.filter((chapter) => wanted.has(chapter.id));
	if (selected.length !== wanted.size) throw new AppError("部分章节不属于当前项目", { status: 400, code: "script_export_chapter_unknown" });
	const plans = await loadLatestChapterPlans(c, userId, projectId, selected.map(chapter => chapter.id));
	const missing = selected.filter((chapter) => !plans.has(chapter.id)).map((chapter) => chapter.title);
	if (missing.length) {
		throw new AppError(`以下章节还没有生成出视频提示词：${missing.join("、")}`, { status: 409, code: "script_export_plan_missing", details: { missing } });
	}
	const projectName = project.name;
	const exportedAt = new Date().toISOString();
	return {
		fileName: `${projectName}-剧本-${selected.length}集.txt`,
		text: renderChapterScriptCollection({
			projectName,
			exportedAt,
			episodes: selected.map((chapter) => ({ title: chapter.title, plan: plans.get(chapter.id)!.plan })),
		}),
	};
}
