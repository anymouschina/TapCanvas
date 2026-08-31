import type { AppContext } from "../../types";
import { getProjectForUserAccess } from "../project/project.repo";
import {
	VIDEO_RUN_TERMINAL_STATES,
	getAuthoringClipProgressByRunIds,
	getVideoRun,
} from "../task/video-run.repo";
import { readAuthoringTotalClips } from "../task/video-run.status-snapshot";
import {
	projectFinalVideoRunsFromCanvas,
	syncFinalVideoStatusNodes,
} from "../task/video-run.delivery-projection";
import { broadcastPatch, broadcastRunStatus } from "./canvas-sse.manager";
import {
	type CanvasFlow,
	type PutCanvasFlowRequest,
	type GetCanvasFlowResponse,
	type PutCanvasFlowResponse,
} from "./chapter.canvas-flow.schemas";
import { listMaterialAssets, deleteMaterialAsset } from "../material/material.repo";
import {
	computeOrphanedMaterialAssetIds,
	isMaterialCanvasDeleteSyncEnabled,
	type ReconcileMaterialAsset,
} from "./chapter.material-reconcile";
import { sweepRegisterCanvasCards } from "../task/material-auto-register";
import { touchProjectActivity } from "../project/project-activity.repo";
import { isAdminRequest } from "../team/team.service";
import {
	preserveAdminWorkflowGraphForNonAdmin,
	projectWorkflowGraphForViewer,
} from "@tapcanvas/workflow-kernel-protocol";
import { readBookBibleArtifactType } from "./book-bible-contract";

// 成片节点 kind 在前后端有两种拼写：后端写 composeVideo、前端规范化成 videoCompose；都要保护。
const PROTECTED_VIDEO_KINDS = new Set(["video", "composevideo", "videocompose"]);

// 生成态资产节点 kind（章节画布里这些都是 agent 生成、非用户手建）：活跃生成期间整体写保护，
// 防前端整图 autosave 拿 stale 快照把 agent 刚建的锚点/分镜板/clip 抹掉（开着画布看时的竞态根因）。
const GENERATED_ASSET_KINDS = new Set([
	"image",
	"imageedit",
	"storyboardimage",
	"video",
	"composevideo",
	"videocompose",
]);

function isGeneratedAssetNode(node: Record<string, unknown>): boolean {
	const kind = (typeof readNodeData(node).kind === "string" ? (readNodeData(node).kind as string) : "").toLowerCase();
	return GENERATED_ASSET_KINDS.has(kind);
}

function isBookBibleTextNode(node: Record<string, unknown>): boolean {
	const data = readNodeData(node);
	return readBookBibleArtifactType(data) !== null;
}

function nodeStatusLower(node: Record<string, unknown>): string {
	const s = readNodeData(node).status;
	return typeof s === "string" ? s.toLowerCase() : "";
}

function readNodeData(node: Record<string, unknown>): Record<string, unknown> {
	const data = (node as { data?: unknown })?.data;
	return data && typeof data === "object" && !Array.isArray(data)
		? (data as Record<string, unknown>)
		: {};
}

/**
 * The locked chapter seed is server-owned canonical narrative state, not an
 * editable canvas card. Full-graph browser autosaves may contain an older
 * projection of that node (or omit its hidden contract fields entirely), so
 * always preserve the database copy byte-for-byte. Narrative changes have a
 * separate revision-fenced chapter update API.
 */
function preserveCanonicalChapterSeedNode(
	chapterId: string,
	current: CanvasFlow,
	incoming: CanvasFlow,
): CanvasFlow {
	const seedId = `chapter-seed-${chapterId}`;
	const currentSeed = (current.nodes ?? []).find((node) =>
		String((node as { id?: unknown }).id ?? "") === seedId,
	);
	if (!currentSeed) return incoming;
	let replaced = false;
	const nodes = (incoming.nodes ?? []).map((node) => {
		if (String((node as { id?: unknown }).id ?? "") !== seedId) return node;
		replaced = true;
		return currentSeed;
	});
	if (!replaced) nodes.unshift(currentSeed);
	return { nodes, edges: incoming.edges ?? [] };
}

/** 已完成的视频/成片节点：生产链写好的终值（success + videoUrl），不可被整图 PUT 降级。 */
function isCompletedVideoNode(node: Record<string, unknown>): boolean {
	const data = readNodeData(node);
	const kind = (typeof data.kind === "string" ? data.kind : "").toLowerCase();
	const status = typeof data.status === "string" ? data.status : "";
	const videoUrl = typeof data.videoUrl === "string" ? data.videoUrl : "";
	return PROTECTED_VIDEO_KINDS.has(kind) && status === "success" && videoUrl.length > 0;
}

/**
 * 视频节点写保护：本章节存在「进行中(非终态)video_run」时，禁止整图 PUT 把同步生产链或恢复 worker
 * 已写好的视频/成片节点降级(success→running/queued)或抹掉 videoUrl，并补回被整图漏带的已完成节点。
 *
 * 根因：前端章节画布整图 autosave 拿内存里的旧图覆盖生产链的逐段回写，把已完成 clip 打回
 * running → run-driver 的 countSucceededClips 数不到 → run 卡在 N/总数 不推进（实测 ch11 clip#2）。
 * 护栏只在 run 活跃期生效；run 终态(concatenated/failed/cancelled)后不保护，UI 可自由编辑/重做。
 * 生产链自身只做 upgrade(running→success)，DB 当前非 success 故不入保护集，不会被本护栏误伤。
 */
async function reconcileActiveRunVideoNodes(
	ctx: AppContext,
	chapterId: string,
	ownerId: string,
	incoming: CanvasFlow,
	deletedNodeIds?: Iterable<string>,
): Promise<CanvasFlow> {
	// 用户显式删除墓碑：这些 id 是前端「真删」的资产节点。下方写保护构建 protectedById 时
	// 把墓碑里的非视频资产排除——既不回填也不补回，让删除真正落盘（治母板/分镜板删不掉）。
	const tombstone = new Set<string>();
	for (const id of deletedNodeIds ?? []) {
		const s = String(id ?? "").trim();
		if (s) tombstone.add(s);
	}
	const prisma = ctx.env.DB;
	const row = await prisma.chapters.findFirst({
		where: { id: chapterId, owner_id: ownerId },
		select: { canvas_flow: true },
	});
	if (!row?.canvas_flow) return incoming;
	let current: CanvasFlow;
	try {
		current = JSON.parse(row.canvas_flow) as CanvasFlow;
	} catch {
		return incoming;
	}
	incoming = preserveCanonicalChapterSeedNode(chapterId, current, incoming);

	// 「活跃生成中」判定（决定是否对 agent 资产节点整体写保护）：
	//   ① 存在进行中的 video_run；或 ② 当前画布有 running/queued 的在飞节点（出锚点/分镜板/clip 阶段）。
	// 空闲期(都不满足)→ 前端整图权威、删除照常生效，不误锁。
	const activeRunRows = await prisma.video_runs.findMany({
		where: { chapter_id: chapterId, state: { notIn: [...VIDEO_RUN_TERMINAL_STATES] } },
		select: { id: true },
	});
	const activeRun = activeRunRows.length > 0;
	// 活跃 run id 集：只护「当前在跑 run」的视频；旧/已完成(终态)run 的视频不护，让用户能删历史视频。
	const activeRunIds = new Set(activeRunRows.map((r) => r.id));
	const hasInflight = (current.nodes ?? []).some((n) => {
		const s = nodeStatusLower(n as Record<string, unknown>);
		return s === "running" || s === "queued";
	});
	// 【2026-06-30 根治·删 hasDesignBoards 保护信号】原「画布有 design_board 分镜板 → 永久算活跃生成」
	// 是老分镜板工作流(出板→start)的遗留：分镜板已废（章节统一「文本故事板→视频节点·直接出 sd2」、不再出
	// design_board 图），而它让有遗留分镜板的章节 underActiveGeneration **永久为真** → 保护常开 → 用户删母板/
	// 分镜板被无脑复活（墓碑在 autosave churn 里被竞态清掉、赢不了）。改为只认「真有活跃 run / 在飞节点」：
	// 空闲章节(无 run、无 running/queued)→ 前端整图权威、删除立即落盘，不再复活遗留 design_board。
	const underActiveGeneration = Boolean(activeRun) || hasInflight;
	if (!underActiveGeneration) {
		// 【空闲期成片并集守卫·2026-07-04 ch3 实测】run 一到终态(concatenated)原保护就全关，
		// 「前端整图权威」的前提是前端图新鲜——但陈旧标签页/陈旧 IndexedDB 快照（从 run 起跑前
		// 加载）整图 PUT 会把刚出完的 23 段成片节点整批静默抹掉（本次实测 revision 1257→1258 全丢）。
		// 空闲期仍做最小并集：服务端已有、incoming 缺失、且不在显式删除墓碑里的【已完成视频/成片】
		// 节点（success+videoUrl）一律补回。用户真删带 tombstone，照常落盘不复活。
		const missing: Record<string, unknown>[] = [];
		const completedById = new Map<string, Record<string, unknown>>();
		for (const node of current.nodes ?? []) {
			const id = typeof (node as { id?: unknown }).id === "string" ? (node as { id: string }).id : "";
			if (!id || tombstone.has(id) || !isCompletedVideoNode(node as Record<string, unknown>)) continue;
			completedById.set(id, node as Record<string, unknown>);
		}
		const incomingIds = new Set(
			(incoming.nodes ?? [])
				.map((n) => (typeof (n as { id?: unknown }).id === "string" ? (n as { id: string }).id : ""))
				.filter(Boolean),
		);
		for (const node of current.nodes ?? []) {
			const id = typeof (node as { id?: unknown }).id === "string" ? (node as { id: string }).id : "";
			if (!id || incomingIds.has(id) || tombstone.has(id)) continue;
			// 空闲期并集补回两类：①已完成视频/成片（原有）②书级圣经 text 节点（2026-07-10 加）。
			if (
				!isCompletedVideoNode(node as Record<string, unknown>) &&
				!isBookBibleTextNode(node as Record<string, unknown>)
			)
				continue;
			missing.push(node as Record<string, unknown>);
		}
		let restoredCompletedFields = 0;
		const protectedNodes = (incoming.nodes ?? []).map((node) => {
			const id = typeof (node as { id?: unknown }).id === "string" ? (node as { id: string }).id : "";
			const completed = id ? completedById.get(id) : undefined;
			if (!completed) return node;
			const currentData = readNodeData(completed);
			const incomingData = readNodeData(node as Record<string, unknown>);
			const incomingUrl = typeof incomingData.videoUrl === "string" ? incomingData.videoUrl.trim() : "";
			const currentUrl = typeof currentData.videoUrl === "string" ? currentData.videoUrl.trim() : "";
			if (incomingData.status === "success" && incomingUrl === currentUrl) return node;
			restoredCompletedFields += 1;
			return {
				...node,
				data: {
					...incomingData,
					status: currentData.status,
					videoUrl: currentData.videoUrl,
					videoResults: currentData.videoResults,
					videoPrimaryIndex: currentData.videoPrimaryIndex,
					productionState: currentData.productionState,
				},
			};
		});
		if (!missing.length && restoredCompletedFields === 0) return incoming;
		console.warn(
			`[canvas-flow-guard] chapter=${chapterId} 空闲期整图 PUT 检测到 stale 成片快照：补回节点×${missing.length}、恢复同节点终值×${restoredCompletedFields}: ${missing
				.map((n) => String((n as { id?: unknown }).id))
				.join(",")}`,
		);
		return { nodes: [...protectedNodes, ...missing], edges: incoming.edges ?? [] };
	}

	// 活跃生成期：护住所有「生成态资产节点」(图片/分镜板/视频/成片)——前端整图 PUT 缺了就补回、
	// 不让已成功的资产被 stale 快照降级/抹 url。用户文本/分组节点不在保护集，删除照常。
	const protectedById = new Map<string, Record<string, unknown>>();
	for (const node of current.nodes ?? []) {
		const id = typeof (node as { id?: unknown }).id === "string" ? (node as { id: string }).id : "";
		if (
			!id ||
			(!isGeneratedAssetNode(node as Record<string, unknown>) &&
				!isBookBibleTextNode(node as Record<string, unknown>))
		)
			continue;
		const data = readNodeData(node as Record<string, unknown>);
		const kind = (typeof data.kind === "string" ? data.kind : "").toLowerCase();
		const isVideoNode = kind === "video" || kind === "composevideo" || kind === "videocompose";
		if (isVideoNode) {
			// 视频/成片只护两类：①当前在跑 run 的 clip（clipRunId/runId ∈ 活跃 run 集）②正在渲染(running/queued)的。
			// 旧/已完成(终态 run)的视频不进保护集 → 用户能删历史视频（治"删了又被护栏补回"）。
			const runId =
				(typeof data.clipRunId === "string" ? data.clipRunId.trim() : "") ||
				(typeof data.runId === "string" ? data.runId.trim() : "");
			const status = nodeStatusLower(node as Record<string, unknown>);
			const inflight = status === "running" || status === "queued";
			if (!(runId && activeRunIds.has(runId)) && !inflight) continue;
			// 【用户指令至上·2026-07-17 用户拍板】显式墓碑删除的已完成(非在飞)视频节点：尊重删除、
			// 不复活——护栏只防「漏带」(stale 快照 omission)，不防用户显式删除。实证：runId 被复用重新
			// 出片时，上一轮生成的 success 旧成片被当"在跑 run 的视频"无条件护住，用户删了又复活。
			// 在飞(running/queued) clip 仍护（worker 回写竞态·真要删=取消 run）。
			if (tombstone.has(id) && !inflight) continue;
		} else if (tombstone.has(id)) {
			// 非视频资产（母板/分镜板/图片）被用户显式删除 → 尊重删除，不护、不复活。
			continue;
		}
		protectedById.set(id, node as Record<string, unknown>);
	}
	if (protectedById.size === 0) return incoming;

	const seen = new Set<string>();
	const nodes = (incoming.nodes ?? []).map((node) => {
		const id = typeof (node as { id?: unknown }).id === "string" ? (node as { id: string }).id : "";
		if (id) seen.add(id);
		const guard = id ? protectedById.get(id) : undefined;
		if (!guard) return node;
		const g = readNodeData(guard);
		const d = readNodeData(node as Record<string, unknown>);
		// 视频/成片：强制回填 worker 终值 status/videoUrl，防降级（success→running/抹 videoUrl）。
		if (isCompletedVideoNode(guard)) {
			return { ...node, data: { ...d, status: g.status, videoUrl: g.videoUrl } };
		}
		// 图片/分镜板：前端把已出图的资产降级/抹 imageUrl 时，按 DB 终值回填。
		const gImg = typeof g.imageUrl === "string" ? g.imageUrl : "";
		const dImg = typeof d.imageUrl === "string" ? d.imageUrl : "";
		if (gImg && !dImg) {
			return { ...node, data: { ...d, imageUrl: gImg, status: g.status ?? d.status } };
		}
		return node;
	});
	// 整图漏带的被保护资产节点（autosave 拿 stale 快照漏了 agent 刚建的锚点/板/clip）→ 按 DB 补回。
	for (const [id, guard] of protectedById) {
		if (!seen.has(id)) nodes.push(guard);
	}
	return { nodes, edges: incoming.edges ?? [] };
}

export class CanvasFlowNotFoundError extends Error {
	constructor(public readonly chapterId: string) {
		super(`Chapter canvas flow not found: ${chapterId}`);
		this.name = "CanvasFlowNotFoundError";
	}
}

export class CanvasFlowRevisionConflictError extends Error {
	constructor(
		public readonly chapterId: string,
		public readonly expected: number,
		public readonly actual: number,
	) {
		super(
			`Canvas flow revision conflict on chapter ${chapterId}: expected ${expected}, actual ${actual}`,
		);
		this.name = "CanvasFlowRevisionConflictError";
	}
}

export class CanvasFlowCorruptedError extends Error {
	constructor(
		public readonly chapterId: string,
		public readonly cause: unknown,
	) {
		super(`Chapter canvas flow is corrupted for ${chapterId}`);
		this.name = "CanvasFlowCorruptedError";
	}
}

async function resolveChapterOwnerId(
	ctx: AppContext,
	userId: string,
	chapterId: string,
): Promise<string> {
	const prisma = ctx.env.DB;

	// Owner fast-path
	const owned = await prisma.chapters.findFirst({
		where: { id: chapterId, owner_id: userId },
		select: { owner_id: true },
	});
	if (owned) return owned.owner_id;

	// Team member path: find chapter, then verify project access
	const chapter = await prisma.chapters.findFirst({
		where: { id: chapterId },
		select: { owner_id: true, project_id: true },
	});
	if (!chapter) throw new CanvasFlowNotFoundError(chapterId);

	const project = await getProjectForUserAccess(prisma, chapter.project_id, userId);
	if (!project) throw new CanvasFlowNotFoundError(chapterId);

	return chapter.owner_id;
}

export async function getChapterCanvasFlow(
	ctx: AppContext,
	userId: string,
	chapterId: string,
): Promise<GetCanvasFlowResponse> {
	const prisma = ctx.env.DB;
	const ownerId = await resolveChapterOwnerId(ctx, userId, chapterId);

	const row = await prisma.chapters.findFirst({
		where: { id: chapterId, owner_id: ownerId },
		select: { id: true, canvas_flow: true, canvas_flow_revision: true },
	});
	if (!row) throw new CanvasFlowNotFoundError(chapterId);

	let flow: CanvasFlow | null = null;
	if (row.canvas_flow) {
		try {
			flow = JSON.parse(row.canvas_flow) as CanvasFlow;
		} catch (err) {
			throw new CanvasFlowCorruptedError(row.id, err);
		}
	}
	const visibleFlow = flow === null
		? null
		: projectWorkflowGraphForViewer(flow, isAdminRequest(ctx));
	return {
		chapterId: row.id,
		revision: row.canvas_flow_revision,
		flow: visibleFlow === null ? null : (visibleFlow as CanvasFlow),
	};
}

/**
 * 画布删除 → 设定库同步（用户定规则）。保存成功后调用：
 * 找出「绑定到本章节、但本章节最新画布已不再引用」的设定库资产并删除。
 * 非阻塞：任何失败只告警，绝不影响画布保存本身。
 */
async function syncMaterialDeletionsForChapter(
	ctx: AppContext,
	input: { chapterId: string; ownerId: string; projectId: string; flow: CanvasFlow },
): Promise<void> {
	if (!isMaterialCanvasDeleteSyncEnabled()) return;
	const db = ctx.env.DB;
	const assetDtos = await listMaterialAssets(db, {
		ownerId: input.ownerId,
		...(input.projectId ? { projectId: input.projectId } : {}),
	});
	if (!assetDtos.length) return;
	const assets: ReconcileMaterialAsset[] = assetDtos.map((asset) => {
		const data =
			asset.latestVersion && typeof asset.latestVersion.data === "object"
				? (asset.latestVersion.data as Record<string, unknown>)
				: {};
		const sourceChapterId =
			typeof data.sourceChapterId === "string" ? data.sourceChapterId : null;
		return { id: asset.id, kind: asset.kind, name: asset.name, sourceChapterId };
	});
	const orphanIds = computeOrphanedMaterialAssetIds({
		chapterId: input.chapterId,
		flow: input.flow as { nodes?: Array<{ data?: Record<string, unknown> | null }> },
		assets,
	});
	for (const assetId of orphanIds) {
		await deleteMaterialAsset(db, { ownerId: input.ownerId, assetId });
		console.warn(
			`[material-delete-sync] removed asset=${assetId} chapter=${input.chapterId} reason=not-referenced-on-canvas`,
		);
	}
}

export async function putChapterCanvasFlow(
	ctx: AppContext,
	userId: string,
	chapterId: string,
	input: PutCanvasFlowRequest,
): Promise<PutCanvasFlowResponse> {
	const prisma = ctx.env.DB;
	const ownerId = await resolveChapterOwnerId(ctx, userId, chapterId);
	const currentRow = await prisma.chapters.findFirst({
		where: { id: chapterId, owner_id: ownerId },
		select: { id: true, canvas_flow: true },
	});
	if (!currentRow) throw new CanvasFlowNotFoundError(chapterId);
	let existingFlow: CanvasFlow = { nodes: [], edges: [] };
	if (currentRow.canvas_flow) {
		try {
			existingFlow = JSON.parse(currentRow.canvas_flow) as CanvasFlow;
		} catch (error) {
			throw new CanvasFlowCorruptedError(currentRow.id, error);
		}
	}
	const permissionSafeInputFlow = isAdminRequest(ctx)
		? input.flow
		: preserveAdminWorkflowGraphForNonAdmin({
			existing: existingFlow,
			incoming: input.flow,
		}) as CanvasFlow;

	// 【项目资产注册 sweep】保存前对 success 卡节点做 best-effort 设定库注册（堵网页端「恢复完成」
	// 收尾不经服务端 finalizer 的注册漏洞）。就地写幂等标记（materialAssetId/materialRegisteredImageUrl）
	// 随本次保存持久化 → 稳态下后续保存零 DB 查询。失败只告警，绝不阻断保存。
	try {
		await sweepRegisterCanvasCards({
			c: ctx,
			userId: ownerId,
			chapterId,
			nodes: (permissionSafeInputFlow.nodes ?? []) as Array<{ id?: unknown; data?: unknown }>,
		});
	} catch (err) {
		console.warn(`[material-sweep] chapter=${chapterId} sweep failed:`, err);
	}
	// A full graph snapshot is valid only for the revision it was built from.
	// Never raise expectedRevision and retry the same snapshot: doing so turns a
	// stale browser/agent graph into an authoritative overwrite. Agent callers
	// already own structured patches and must re-read + re-apply those patches
	// after this method reports a conflict.
	const guardedFlow = await reconcileActiveRunVideoNodes(
		ctx,
		chapterId,
		ownerId,
		permissionSafeInputFlow,
		input.deletedNodeIds,
	);
	const result = await prisma.chapters.updateMany({
		where: {
			id: chapterId,
			owner_id: ownerId,
			canvas_flow_revision: input.expectedRevision,
		},
		data: {
			canvas_flow: JSON.stringify(guardedFlow),
			canvas_flow_revision: { increment: 1 },
			updated_at: new Date().toISOString(),
		},
	});
	if (result.count === 0) {
		const row = await prisma.chapters.findFirst({
			where: { id: chapterId, owner_id: ownerId },
			select: { canvas_flow_revision: true },
		});
		if (!row) throw new CanvasFlowNotFoundError(chapterId);
		throw new CanvasFlowRevisionConflictError(
			chapterId,
			input.expectedRevision,
			row.canvas_flow_revision,
		);
	}
	const fresh = await prisma.chapters.findFirst({
		where: { id: chapterId, owner_id: ownerId },
		select: { canvas_flow_revision: true, project_id: true },
	});

	// The browser owns WebAV concat. Once its durable HTTP(S) result is present
	// in the canonical compose node, project that delivery evidence into the run
	// state. This may repair an earlier watchdog cancellation, but only when the
	// same owner/chapter run has all clips completed.
	const nowIso = new Date().toISOString();
	const completedRuns = await projectFinalVideoRunsFromCanvas({
		db: prisma,
		flow: guardedFlow,
		ownerId,
		chapterId,
		nowIso,
	});
	const statusNodeSync = syncFinalVideoStatusNodes({
		flow: guardedFlow,
		runs: completedRuns,
	});
	let persistedFlow = guardedFlow;
	let persistedRevision = fresh?.canvas_flow_revision ?? input.expectedRevision + 1;
	if (statusNodeSync.upsertNodes.length > 0 && fresh) {
		const statusResult = await prisma.chapters.updateMany({
			where: {
				id: chapterId,
				owner_id: ownerId,
				canvas_flow_revision: fresh.canvas_flow_revision,
			},
			data: {
				canvas_flow: JSON.stringify(statusNodeSync.flow),
				canvas_flow_revision: { increment: 1 },
				updated_at: nowIso,
			},
		});
		if (statusResult.count === 1) {
			persistedFlow = statusNodeSync.flow;
			persistedRevision = fresh.canvas_flow_revision + 1;
			broadcastPatch(
				chapterId,
				{ revision: persistedRevision, upsertNodes: statusNodeSync.upsertNodes },
				"",
			);
		} else {
			console.error(
				`[video-run-delivery] chapter=${chapterId} final status node CAS conflicted at revision=${fresh.canvas_flow_revision}`,
			);
		}
	}
	for (const run of completedRuns) {
		if (!run.stateChanged || !fresh?.project_id) continue;
		const persistedRun = await getVideoRun(run.runId);
		if (!persistedRun) {
			throw new Error(`completed video run ${run.runId} disappeared before status broadcast`);
		}
		const authoringProgress = await getAuthoringClipProgressByRunIds([run.runId]);
		broadcastRunStatus(fresh.project_id, {
			runId: run.runId,
			flowId: null,
			state: "concatenated",
			totalClips: run.totalClips,
			clipsDone: run.clipsDone,
			errorMessage: null,
			completedAt: run.completedAt,
			authoringState: persistedRun.authoring_state,
			authoringClipsReady: authoringProgress[run.runId]?.ready ?? 0,
			authoringTotalClips: readAuthoringTotalClips(persistedRun),
			updatedAt: persistedRun.updated_at,
			chapterId,
			chapterTitle: null,
		});
	}

	// 画布删除 → 设定库同步（非阻塞）：保存成功后核对本章绑定资产是否还在画布上。
	try {
		await syncMaterialDeletionsForChapter(ctx, {
			chapterId,
			ownerId,
			projectId: fresh?.project_id ?? "",
			flow: persistedFlow,
		});
	} catch (err) {
		console.warn(`[material-delete-sync] reconcile failed chapter=${chapterId}:`, err);
	}
	if (!fresh?.project_id) throw new CanvasFlowNotFoundError(chapterId);
	await touchProjectActivity({
		db: prisma,
		projectId: fresh.project_id,
		ownerId,
		nowIso,
		// The chapter canvas write is already durable and is the source of truth
		// for project-only flows. Activity metadata is best-effort here: a missing
		// project row (or a concurrent project deletion) must not make an accepted
		// video task look blocked after its node was persisted.
		allowMissing: true,
	});

	const viewerIsAdmin = isAdminRequest(ctx);
	const submittedViewerFlow = projectWorkflowGraphForViewer(
		permissionSafeInputFlow,
		viewerIsAdmin,
	) as CanvasFlow;
	const persistedViewerFlow = projectWorkflowGraphForViewer(
		persistedFlow,
		viewerIsAdmin,
	) as CanvasFlow;
	const wasCanonicalized = JSON.stringify(submittedViewerFlow) !== JSON.stringify(persistedViewerFlow);

	return {
		chapterId,
		revision: persistedRevision,
		...(wasCanonicalized ? { authoritativeFlow: persistedViewerFlow } : {}),
	};
}
