import { getPrismaClient } from "../../platform/node/prisma";
import {
  VIDEO_RUN_TERMINAL_STATES,
} from "@tapcanvas/video-orchestrator-protocol";
import { AUTHORING_DELIVERY_VERIFY_NODE_KEY } from "./video-orchestrator.authoring-graph";

export type VideoRunRow = {
  id: string;
  owner_id: string;
  flow_id: string | null;
  project_id: string | null;
  chapter_id: string | null;
  recipe_id: string | null;
  state: string;
  story_plan: string | null;
  film_bible: string | null;
  adaptation_strategy: string | null;
  /** BeatSheet JSON；非空表示统一 delivery graph run，空值只用于独立 direct-video run。 */
  beat_sheet: string | null;
  /** 【编排域 P1】创作态（与生产态 state 正交），见 video-orchestrator.authoring.repo.ts。 */
  authoring_state: string | null;
  total_clips: number;
  clips_done: number;
  error_message: string | null;
  last_drive_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

// 终态：run 已结束，不再驱动 / 不可取消 / 握手无需回放。**必须**与前端 videoRunStore.ts 的
// 终态来自共享协议，否则会出现前端显示"生成中"、后端不再推进的 limbo 状态。
// 活跃集合始终由 canonical terminal set 的补集派生，不另建第二份状态词表。
// 现在统一用"非终态即活跃"，由这一个终态集派生 active，杜绝两套词表漂移。
export { VIDEO_RUN_TERMINAL_STATES };

/** run 是否处于终态（已结束）。非终态 = 可驱动 / 可取消 / 握手需回放。 */
export function isTerminalVideoRunState(state: string): boolean {
  return (VIDEO_RUN_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * 【收批占位态·2026-07-04 filmBible 落库】首批 add_clips 携带 filmBible/adaptationStrategy 时 run 行
 * 尚未 start 创建 → 以本状态建占位行只存叙事元数据。collecting 行**不可驱动**（claim/stale 扫描一律排除，
 * 否则 worker 会拿到 story_plan 为空的行、直接判 failed 把 runId 污染成不可续用），start 时由
 * insertVideoRun 升级为 scheduled。取消（cancelActiveVideoRunsForProject）仍覆盖它，保证能清占位。
 */
export const VIDEO_RUN_COLLECTING_STATE = "collecting";

/** worker/driver 不可认领的生产状态：终态 + 收批占位态。 */
const NON_DRIVABLE_STATES = [...VIDEO_RUN_TERMINAL_STATES, VIDEO_RUN_COLLECTING_STATE];

/**
 * 生产 driver 只拥有两类结构上不同的 run：没有 BeatSheet 的独立 direct-video run，或 delivery graph
 * 已经通过 production:handoff 并把生命周期投影为 authoring_done 的一键成片 run。
 * 其他 authoring_state（尤其 authoring_failed）仍归 authoring driver；若让生产 driver 抢占，会把旧编排
 * 失败当成生产计划执行，并按 updated_at 最老优先持续占满批次，最终饿死真正 scheduled 的生产 run。
 */
function parseDeliveryVerificationPayload(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function deliveryReceiptNeedsExternalEvidence(payload: string | null): boolean {
  const record = parseDeliveryVerificationPayload(payload);
  const verification = record?.deliveryVerification;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) return false;
  const verificationRecord = verification as Record<string, unknown>;
  const missingCriteria = Array.isArray(verificationRecord.missingCriteria)
    ? verificationRecord.missingCriteria.filter((criterion): criterion is string => typeof criterion === "string")
    : [];
  return verificationRecord.satisfied === false && missingCriteria.includes("finalMediaProbe");
}

async function listDeliveryEvidenceWorkRunIds(runId?: string): Promise<string[]> {
  const rows = await getPrismaClient().authoring_artifacts.findMany({
    where: {
      artifact_key: AUTHORING_DELIVERY_VERIFY_NODE_KEY,
      status: { in: ["waiting_external", "ready"] },
      ...(runId ? { run_id: runId } : {}),
    },
    select: { run_id: true, status: true, payload: true },
  });
  return [...new Set(rows.flatMap((row) => (
    row.status === "waiting_external" || deliveryReceiptNeedsExternalEvidence(row.payload)
      ? [row.run_id]
      : []
  )))];
}

function buildProductionDrivableWhere(
  staleBeforeIso: string,
  deliveryEvidenceRunIds: readonly string[],
) {
  const normalProductionOwner = {
    state: { notIn: NON_DRIVABLE_STATES },
    OR: [
      { beat_sheet: null, authoring_state: null },
      { beat_sheet: { not: null }, authoring_state: "authoring_done" },
    ],
  };
  return {
    AND: [
      {
        OR: [
          normalProductionOwner,
          ...(deliveryEvidenceRunIds.length > 0
            ? [{
                id: { in: [...deliveryEvidenceRunIds] },
                state: "concatenated",
                beat_sheet: { not: null },
                authoring_state: "authoring_done",
              }]
            : []),
        ],
      },
      {
        OR: [{ last_drive_at: null }, { last_drive_at: { lt: staleBeforeIso } }],
      },
    ],
  };
}

export async function insertVideoRun(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  projectId?: string | null;
  chapterId?: string | null;
  recipeId?: string | null;
  storyPlan: unknown;
  totalClips: number;
  nowIso: string;
  /** run 级全片圣经（JSON 文本·可选）：start 时把进程内缓存的 filmBible 一并落库（add_clips 已落过则幂等覆盖同值）。 */
  filmBible?: string | null;
  /** 改编策略（JSON 文本·可选）：同 filmBible 机制。 */
  adaptationStrategy?: string | null;
  /**
   * 【样片先行扩拍·2026-07-07】显式允许"已完成(concatenated) run 追加分段续拍"：样片 run（如只含
   * 样片段）完成并经用户确认后，同 runId 带全量 clips 再 start（extendRun）→ 此处把 concatenated
   * 拉回 scheduled 续跑；已成段由画布 vclip 节点按 (clipRunId, clipIndex) 幂等跳过、不重生成不重扣费。
   * 默认 false：保持"已完成片拒绝重跑"语义（orchestrateVideoStart 显式拒绝，防僵尸假起跑回归）。
   */
  allowExtendCompleted?: boolean;
}): Promise<VideoRunRow> {
  const prisma = getPrismaClient();
  // 【failed/cancelled 复活语义·2026-07-04 ch3 实测根治】旧版 update 分支不重置 state：
  // 失败 run 再 start 返回"scheduled"但行仍是 failed → worker（claimDrivableVideoRuns 只取非终态）
  // 永不驱动 = 僵尸恢复。现在 failed/cancelled 再 start 视为真恢复：state 拉回 scheduled、清错误/
  // 完成时间/驱动锁；clips_done 保留（已成段由画布 vclip 节点幂等续传，不重生成不重扣费）。
  // concatenated（已完成）默认不在此复活——仅 allowExtendCompleted（样片先行扩拍）显式放行。
  const existing = await prisma.video_runs.findUnique({
    where: { id: input.runId },
    select: { state: true, authoring_state: true },
  });
  const reviveFromTerminal =
    existing != null &&
    (existing.state === "failed" ||
      existing.state === "cancelled" ||
      (existing.state === "concatenated" && input.allowExtendCompleted === true));
  // 收批占位行（add_clips 落 filmBible 时所建·见 VIDEO_RUN_COLLECTING_STATE）在 start 时升级为 scheduled，
  // 否则 worker 永不认领 = 假起跑。
  const promoteFromCollecting = existing?.state === VIDEO_RUN_COLLECTING_STATE;
  const updateData = {
    story_plan: JSON.stringify(input.storyPlan ?? null),
    total_clips: Math.max(0, Math.trunc(input.totalClips)),
    updated_at: input.nowIso,
    // collecting 占位行（upsertVideoRunNarrativeMeta 所建）没有 flow/project/chapter 上下文，
    // 升级为 scheduled 时必须回填，否则 worker 认领即报「story_plan/flow_id 缺失」假死。
    ...(input.flowId ? { flow_id: input.flowId } : {}),
    ...(input.projectId ? { project_id: input.projectId } : {}),
    ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
    ...(input.recipeId ? { recipe_id: input.recipeId } : {}),
    ...(input.filmBible ? { film_bible: input.filmBible } : {}),
    ...(input.adaptationStrategy ? { adaptation_strategy: input.adaptationStrategy } : {}),
    ...(reviveFromTerminal || promoteFromCollecting
      ? { state: "scheduled", error_message: null, completed_at: null, last_drive_at: null }
      : {}),
  };

  if (existing?.authoring_state === "estimate_ready") {
    const handedOff = await prisma.video_runs.updateMany({
      where: {
        id: input.runId,
        state: VIDEO_RUN_COLLECTING_STATE,
        authoring_state: "estimate_ready",
      },
      data: {
        ...updateData,
        state: "scheduled",
        authoring_state: "authoring_done",
        error_message: null,
        completed_at: null,
        // The durable worker is the sole production owner. A null lease is the
        // ready-queue receipt; no synchronous HTTP driver owns this handoff.
        last_drive_at: null,
      },
    });
    if (handedOff.count !== 1) {
      throw new Error(
        `video_run_start_state_changed: run ${input.runId} 已离开 collecting/estimate_ready，禁止覆盖当前状态`,
      );
    }
    const startedRun = await prisma.video_runs.findUnique({ where: { id: input.runId } });
    if (!startedRun) {
      throw new Error(`video_run_start_persisted_row_missing: run ${input.runId}`);
    }
    return startedRun as VideoRunRow;
  }

  const startedRun = await prisma.video_runs.upsert({
    where: { id: input.runId },
    create: {
      id: input.runId,
      owner_id: input.ownerId,
      flow_id: input.flowId ?? null,
      project_id: input.projectId ?? null,
      chapter_id: input.chapterId ?? null,
      recipe_id: input.recipeId ?? null,
      state: "scheduled",
      story_plan: JSON.stringify(input.storyPlan ?? null),
      film_bible: input.filmBible ?? null,
      adaptation_strategy: input.adaptationStrategy ?? null,
      total_clips: Math.max(0, Math.trunc(input.totalClips)),
      clips_done: 0,
      // The start transaction publishes the run directly to the durable ready queue.
      last_drive_at: null,
      created_at: input.nowIso,
      updated_at: input.nowIso,
    },
    // 同 runId 再次 start 视为恢复，不重置进度，只刷新计划与时间；终态 failed/cancelled 额外复活。
    // film_bible/adaptation_strategy 只在调用方带值时覆盖（不带 = 保留 add_clips 已落库的那份）。
    update: updateData,
  });
  return startedRun as VideoRunRow;
}

/**
 * 【filmBible/adaptationStrategy 落库·2026-07-04】首批 add_clips 即持久化叙事元数据：run 行已存在则只更新
 * 这两列；行不存在（尚未 start）则建 collecting 占位行（需 ownerId，散跑无用户上下文时返回 false 退化为
 * 进程内缓存）。幂等、可重复调用。
 */
export async function upsertVideoRunNarrativeMeta(input: {
  runId: string;
  ownerId?: string | null;
  filmBible?: string | null;
  adaptationStrategy?: string | null;
  nowIso: string;
}): Promise<boolean> {
  const runId = String(input.runId ?? "").trim();
  if (!runId) return false;
  if (input.filmBible == null && input.adaptationStrategy == null) return false;
  const prisma = getPrismaClient();
  const data = {
    updated_at: input.nowIso,
    ...(input.filmBible != null ? { film_bible: input.filmBible } : {}),
    ...(input.adaptationStrategy != null ? { adaptation_strategy: input.adaptationStrategy } : {}),
  };
  const updated = await prisma.video_runs.updateMany({ where: { id: runId }, data });
  if (updated.count > 0) return true;
  const ownerId = String(input.ownerId ?? "").trim();
  if (!ownerId) return false;
  try {
    await prisma.video_runs.create({
      data: {
        id: runId,
        owner_id: ownerId,
        state: VIDEO_RUN_COLLECTING_STATE,
        story_plan: null,
        film_bible: input.filmBible ?? null,
        adaptation_strategy: input.adaptationStrategy ?? null,
        total_clips: 0,
        clips_done: 0,
        created_at: input.nowIso,
        updated_at: input.nowIso,
      },
    });
    return true;
  } catch {
    // 并发下别的调用刚建出同 id 行 → 退回 update 一次。
    const retry = await prisma.video_runs.updateMany({ where: { id: runId }, data });
    return retry.count > 0;
  }
}

/**
 * 【累积分段落库·2026-07-05 ch1 实测根治】add_clips 每批把**全量累积分段**写进 video_runs.story_plan
 * （JSON {"clips":[…]}）：内存/redis 累积区 TTL 到期或 api 重启后，estimate 从这里回填——整章镜头表
 * （最贵的 LLM 产出）不再静默蒸发。start 时会用最终 storyPlan 覆盖本列，形状兼容（都含 clips 数组）。
 * 幂等持久化：行不存在则建 collecting 占位行（同 upsertVideoRunNarrativeMeta 语义）。调用方必须检查返回值，
 * 失败时禁止继续 estimate/start，避免跨重启丢失已冻结 generationContract。
 */
export async function upsertVideoRunAccumClips(input: {
	runId: string;
	ownerId?: string | null;
	projectId?: string | null;
	flowId?: string | null;
	chapterId?: string | null;
	storyPlanJson: string;
	nowIso: string;
	/**
	 * Explicit replaceAtIndex recovery is the only path allowed to refresh the
	 * executable plan after a provider failure. Normal add_clips must remain
	 * collecting-only so a running/accepted run cannot be overwritten.
	 */
	allowTerminalReplacement?: boolean;
}): Promise<boolean> {
	const runId = String(input.runId ?? "").trim();
	if (!runId || !input.storyPlanJson) return false;
	const prisma = getPrismaClient();
	const projectId = String(input.projectId ?? "").trim() || null;
	const flowId = String(input.flowId ?? "").trim() || null;
	const chapterId = String(input.chapterId ?? "").trim() || null;
	const data = buildAccumulatedClipUpdateData({
		nowIso: input.nowIso,
		storyPlanJson: input.storyPlanJson,
		projectId,
		flowId,
		chapterId,
	});
	const stateWhere = input.allowTerminalReplacement
		? { in: [VIDEO_RUN_COLLECTING_STATE, "failed", "cancelled"] }
		: VIDEO_RUN_COLLECTING_STATE;
	const updated = await prisma.video_runs.updateMany({
		// Normal accumulation is collecting-only. An explicit replacement is the
		// narrow, user-authorized exception for a failed/cancelled run; it reopens
		// only the executable plan before the next estimate/start boundary.
		where: { id: runId, state: stateWhere },
		data,
	});
	if (updated.count > 0) return true;
	const exists = await prisma.video_runs.findUnique({ where: { id: runId }, select: { id: true } });
	if (exists) return false; // 行在但已离开 collecting —— 不覆盖
	const ownerId = String(input.ownerId ?? "").trim();
	if (!ownerId) return false;
	try {
		await prisma.video_runs.create({
			data: {
				id: runId,
				owner_id: ownerId,
				project_id: projectId,
				flow_id: flowId,
				chapter_id: chapterId,
				state: VIDEO_RUN_COLLECTING_STATE,
				story_plan: input.storyPlanJson,
				film_bible: null,
				adaptation_strategy: null,
				total_clips: 0,
				clips_done: 0,
				created_at: input.nowIso,
				updated_at: input.nowIso,
			},
		});
		return true;
	} catch {
		const retry = await prisma.video_runs.updateMany({
			where: { id: runId, state: stateWhere },
			data,
		});
		return retry.count > 0;
	}
}

/**
 * Build the collecting-run update without treating omitted scope as a clear
 * operation. Authoring execution may refresh story_plan after a scope CAS;
 * the existing project/flow/chapter identity must survive that refresh.
 */
export function buildAccumulatedClipUpdateData(input: {
	nowIso: string;
	storyPlanJson: string;
	projectId?: string | null;
	flowId?: string | null;
	chapterId?: string | null;
}): {
	updated_at: string;
	story_plan: string;
	project_id?: string;
	flow_id?: string;
	chapter_id?: string;
} {
	const projectId = String(input.projectId ?? "").trim();
	const flowId = String(input.flowId ?? "").trim();
	const chapterId = String(input.chapterId ?? "").trim();
	return {
		updated_at: input.nowIso,
		story_plan: input.storyPlanJson,
		...(projectId ? { project_id: projectId } : {}),
		...(flowId ? { flow_id: flowId } : {}),
		...(chapterId ? { chapter_id: chapterId } : {}),
	};
}

export async function getVideoRun(runId: string): Promise<VideoRunRow | null> {
  const prisma = getPrismaClient();
  const row = await prisma.video_runs.findUnique({ where: { id: runId } });
  return (row as VideoRunRow | null) ?? null;
}

export async function resumeFailedVideoRunAfterPreSubmit(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  chapterId?: string | null;
  clipsDone: number;
  nowIso: string;
}): Promise<VideoRunRow | null> {
  const prisma = getPrismaClient();
  const resumed = await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      owner_id: input.ownerId,
      state: "failed",
      authoring_state: "authoring_done",
      ...(input.flowId ? { flow_id: input.flowId } : {}),
      ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
    },
    data: {
      state: "scheduled",
      clips_done: Math.max(0, Math.trunc(input.clipsDone)),
      error_message: null,
      completed_at: null,
      last_drive_at: null,
      updated_at: input.nowIso,
    },
  });
  if (resumed.count !== 1) return null;
  return getVideoRun(input.runId);
}

// 单驱动者互斥锁（防双提交双扣费的核心）：原子 CAS 认领某 run 的驱动权。
// 仅当 run 非终态且 last_drive_at 为空/早于阈值（无人/上一持有者已过期）时，把 last_drive_at 置为 now，
// 单条 UPDATE … WHERE 在 Postgres 行级原子——count===1 即本调用方独占了该窗口的驱动权。
// 当前同步工具请求与断连后的 stale recovery worker 共用这把锁：
// 谁先 CAS 成功谁驱动，另一方看到 last_drive_at 在窗口内 → 让位，绝不并发驱动同一 clip。
// 历史根因（2026-06-14 双扣费实测）：旧版同步请求完全不碰 last_drive_at，worker 永远看到
// NULL → 两路各自 generate_storyboard→submit_video，同一 clip 提交两次、各计费一次。
export async function tryClaimVideoRunForDrive(input: {
  runId: string;
  nowIso: string;
  staleBeforeIso: string;
  deliveryEvidenceRunIds?: readonly string[];
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const deliveryEvidenceRunIds = input.deliveryEvidenceRunIds ?? await listDeliveryEvidenceWorkRunIds(input.runId);
  const res = await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      ...buildProductionDrivableWhere(input.staleBeforeIso, deliveryEvidenceRunIds),
    },
    data: { last_drive_at: input.nowIso },
  });
  return res.count === 1;
}

/**
 * Claims one explicitly woken ready run. Unlike stale recovery, this path only
 * consumes a released (`last_drive_at IS NULL`) lease and never steals a live
 * cycle. BullMQ redelivery therefore becomes a harmless `false` receipt.
 */
export async function tryClaimReadyVideoRunForDrive(input: {
  runId: string;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const deliveryEvidenceRunIds = await listDeliveryEvidenceWorkRunIds(input.runId);
  const res = await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      ...buildProductionDrivableWhere(input.nowIso, deliveryEvidenceRunIds),
      last_drive_at: null,
    },
    data: { last_drive_at: input.nowIso },
  });
  return res.count === 1;
}

// 取一批"可驱动"的 run：生产态非终态（含 planned/video_success/concatenating 等中间态），authoring
// 已明确交棒的 graph run，或本就是无 BeatSheet 的 direct-video run，且 last_drive_at 早于阈值。
// authoring 仍在处理或已经失败的行不属于生产 driver，避免历史失败行占满 limit 导致生产 run 饥饿。
// 逐行走原子 CAS 认领，只返回本 tick 真正抢到的 run——与 agent 手动 drive 共用同一把锁。
export async function claimDrivableVideoRuns(input: {
  staleBeforeIso: string;
  limit: number;
  nowIso: string;
}): Promise<VideoRunRow[]> {
  const prisma = getPrismaClient();
  const deliveryEvidenceRunIds = await listDeliveryEvidenceWorkRunIds();
  const candidates = (await prisma.video_runs.findMany({
    where: buildProductionDrivableWhere(input.staleBeforeIso, deliveryEvidenceRunIds),
    // 调度水位才是公平性的事实：从未驱动的 run 先走，其后按最久未驱动轮转。
    // updated_at 会被持久错误/进度投影刷新，若拿它做主序，固定批次可能长期被同一组旧 run
    // 占满；这里与 authoring driver 共用同一公平排序，只把 updated_at 当稳定次序。
    orderBy: [
      { last_drive_at: { sort: "asc", nulls: "first" } },
      { updated_at: "asc" },
    ],
    take: Math.max(1, Math.trunc(input.limit)),
  })) as VideoRunRow[];
  // 逐行原子认领：findMany 读到的候选可能在抢占前被 agent 手动 drive CAS 走，故对每行单独 CAS，
  // 只保留本调用方真正抢到的（count===1），并回写认领后的 last_drive_at。
  const claimed: VideoRunRow[] = [];
  for (const row of candidates) {
    const ok = await tryClaimVideoRunForDrive({
      runId: row.id,
      nowIso: input.nowIso,
      staleBeforeIso: input.staleBeforeIso,
      deliveryEvidenceRunIds,
    });
    if (ok) claimed.push({ ...row, last_drive_at: input.nowIso });
  }
  return claimed;
}

// 批量取章节标题（供 run-status SSE 标出任务归属章节）。空/未知 id 直接跳过，绝不抛。
export async function getChapterTitlesByIds(
  ids: Array<string | null | undefined>,
): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (uniq.length === 0) return {};
  try {
    const rows = await getPrismaClient().chapters.findMany({
      where: { id: { in: uniq } },
      select: { id: true, title: true },
    });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.id] = r.title;
    return out;
  } catch {
    return {};
  }
}

export async function getAuthoringClipProgressByRunIds(
  runIds: readonly string[],
): Promise<Record<string, { ready: number }>> {
  const ids = [...new Set(runIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const artifacts = await getPrismaClient().authoring_artifacts.findMany({
    where: { run_id: { in: ids }, artifact_key: { startsWith: "clip:" } },
    select: { run_id: true, status: true },
  });
  const progress: Record<string, { ready: number }> = {};
  for (const id of ids) progress[id] = { ready: 0 };
  for (const artifact of artifacts) {
    if (artifact.status === "ready") progress[artifact.run_id]!.ready += 1;
  }
  return progress;
}

// 取某 project 下当前活跃 run。SSE 建连时作为权威快照原子替换前端作用域状态；
// 不需要补发历史终态，快照中不存在即代表当前不活跃。
export async function listActiveVideoRunsForProject(projectId: string): Promise<VideoRunRow[]> {
  const prisma = getPrismaClient();
  return (await prisma.video_runs.findMany({
    where: {
      project_id: projectId,
      OR: [
        { state: { notIn: NON_DRIVABLE_STATES } },
        {
          state: VIDEO_RUN_COLLECTING_STATE,
          authoring_state: { not: null, notIn: ["authoring_done", "authoring_failed"] },
        },
      ],
    },
    orderBy: { updated_at: "asc" },
  })) as VideoRunRow[];
}

/**
 * 读取 project 状态快照的数据库水位。调用方必须先读水位、再读活跃 rows：
 * 水位之后提交的变化由 SSE 增量补齐，水位之前的缓冲帧不得覆盖快照。
 */
export async function getVideoRunStatusWatermarkForProject(projectId: string): Promise<string | null> {
  const row = await getPrismaClient().video_runs.findFirst({
    where: { project_id: projectId },
    orderBy: { updated_at: "desc" },
    select: { updated_at: true },
  });
  return row?.updated_at ?? null;
}

// 取当前章节下当前活跃 run，用于章节画布 SSE 权威快照。
// 章节画布订阅 chapterId 房间，不能依赖项目主画布的 project 级连接替它恢复进度。
export async function listActiveVideoRunsForChapter(chapterId: string): Promise<VideoRunRow[]> {
  const prisma = getPrismaClient();
  return (await prisma.video_runs.findMany({
    where: {
      chapter_id: chapterId,
      OR: [
        { state: { notIn: NON_DRIVABLE_STATES } },
        {
          state: VIDEO_RUN_COLLECTING_STATE,
          authoring_state: { not: null, notIn: ["authoring_done", "authoring_failed"] },
        },
      ],
    },
    orderBy: { updated_at: "asc" },
  })) as VideoRunRow[];
}

/** 章节作用域版本的状态快照数据库水位；时序合同同 project 版本。 */
export async function getVideoRunStatusWatermarkForChapter(chapterId: string): Promise<string | null> {
  const row = await getPrismaClient().video_runs.findFirst({
    where: { chapter_id: chapterId },
    orderBy: { updated_at: "desc" },
    select: { updated_at: true },
  });
  return row?.updated_at ?? null;
}

/**
 * 【画幅连续性·2026-07-10 ch11 实测】取本项目最近一次「非当前 run」计划里的 aspect（就近向前找，
 * 最多看 5 条）。用于 estimate 恒算画幅连续性告警：小T 擅自换画幅（ch8-10 全 16:9、ch11 写成 9:16）
 * 又被 auto-approve 自动代答确认 → 用户选定画幅被静默换掉。查不到＝null（新项目首拍不告警）。
 */
export async function getLatestProjectRunAspect(input: {
  projectId: string;
  excludeRunId?: string;
}): Promise<string | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.video_runs.findMany({
    where: {
      project_id: input.projectId,
      ...(input.excludeRunId ? { id: { not: input.excludeRunId } } : {}),
    },
    orderBy: { created_at: "desc" },
    take: 5,
    select: { story_plan: true },
  });
  for (const row of rows) {
    const m = String(row.story_plan ?? "").match(/"aspect"\s*:\s*"([^"]+)"/);
    const aspect = m?.[1]?.trim();
    if (aspect) return aspect;
  }
  return null;
}

// 终止某 project/画布作用域下所有活跃 video_run：置 state='cancelled'（终态）。"活跃"=非终态（notIn 终态集），
// 覆盖 planned/video_success/concatenating 等中间态 → 取消按钮能处理全部 canonical 活跃状态。
// cancelled 进入终态集后 claimDrivableVideoRuns 不再 claim、worker 自动停手（无需改驱动/claim 逻辑）。
// 返回被终止的行（state 已改写为 cancelled）供调用方广播 run-status，让前端进度 chip 立即消失。
export async function cancelActiveVideoRunsForProject(input: {
  projectId: string;
  flowId?: string;
  chapterId?: string;
  nowIso: string;
}): Promise<VideoRunRow[]> {
  const prisma = getPrismaClient();
  const flowId = String(input.flowId || '').trim();
  const chapterId = String(input.chapterId || '').trim();
  const rows = (await prisma.video_runs.findMany({
    where: {
      project_id: input.projectId,
      ...(chapterId ? { chapter_id: chapterId } : flowId ? { flow_id: flowId } : {}),
      state: { notIn: [...VIDEO_RUN_TERMINAL_STATES] },
    },
  })) as VideoRunRow[];
  if (!rows.length) return [];
  await prisma.video_runs.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { state: "cancelled", updated_at: input.nowIso, completed_at: input.nowIso },
  });
  return rows.map((r) => ({ ...r, state: "cancelled", completed_at: input.nowIso }));
}

// 定时扫僵尸 run：活跃(scheduled/video_running)但**确实卡死(无人在推进)**才杀。
// 根因修复（实测：8镜×~250s 故事板的慢片 + 上游排队会合法超 1h；旧逻辑只按 created_at>1h 一刀切，
// 把"慢但正在正常推进"的片当僵尸误杀 → 用户永远拿不到成片）。判僵尸必须**同时**满足：
//   ① created_at 早于 olderThanIso（足够老）；且
//   ② updated_at 也早于 olderThanIso（近期没有编排→生产交棒等真实状态变化）；且
//   ③ 最近没被驱动过——last_drive_at 为空(从未驱动/worker 死过)或早于 notDrivenSinceIso(driver 已不在推它)。
// 正在被 driver 逐 tick 推进的 run(last_drive_at 持续刷新)即便很老也不杀，让慢片跑完。
// 注：created_at / last_drive_at 均为 ISO-8601-Z 文本，字符串比较即按时间序。
/** 三振出局：连续命中 stall 判定达到此次数才真 cancel；期间任何健康推进会清零计数。 */
export const STALL_STRIKES_TO_CANCEL = 3;
const STALL_STRIKE_RE = /^stall_strike:(\d+)$/;

/**
 * 纯函数：根据 run 当前 error_message 里的 strike 计数，决定本次 stall 命中是「记一振」还是「出局」。
 * 设计动机（2026-06-10 误杀复盘）：旧逻辑一击毙命，慢生图把 drive 间隔撑过阈值就把 10/12 的健康
 * run 杀成 cancelled（终态、无复活）。run 状态本可从画布确定性重建，宁可多等两个窗口也不可误杀。
 */
export function nextStallStrikeDecision(errorMessage: string | null | undefined): {
  action: "strike" | "cancel";
  strikes: number;
} {
  const m = String(errorMessage || "").trim().match(STALL_STRIKE_RE);
  const prior = m ? Number(m[1]) : 0;
  const strikes = (Number.isFinite(prior) && prior > 0 ? prior : 0) + 1;
  return strikes >= STALL_STRIKES_TO_CANCEL ? { action: "cancel", strikes } : { action: "strike", strikes };
}

// —— fix #2：真实进度水位标（no-progress watermark）————————————————————————————————
// 根因：cancelStaleVideoRuns 的僵尸判据是「last_drive_at 早于阈值=无人在推」。但被 driver 每 tick
// 推进的 run，last_drive_at 一直新鲜 → 永远豁免，即便 clips_done 卡住零前进（某镜反复被上游版权
// 审核打回→无限重提、烧钱却永不收尾，实测 ch1051）。把"健康"的代理从「最近被驱动过」改成「clips_done
// 是否真在前进」：driver 每 tick 把当前 clips_done + 该档位起始时刻写进 error_message 当水位标，
// clips_done 一前进就清零（绝不误杀慢渲染），同一 clips_done 卡满窗口才取消。
// 窗口默认 25min（> 单镜正常渲染 + 上游排队上限；卡住的死循环每 ~10min 烧一发，25min≈封顶 2 发）。
const NO_PROGRESS_RE = /^noprogress:(\d+):(.+)$/;
export const NO_PROGRESS_CANCEL_MESSAGE = "no_progress_timeout_auto_cancelled";

/** All clips are durable; the only remaining action is the user's browser-side WebAV concat. */
export function isVideoRunAwaitingClientConcat(input: {
  state: string;
  clipsDone: number;
  totalClips: number;
  errorMessage?: string | null;
}): boolean {
  const errorMessage = String(input.errorMessage ?? "").trim();
  const hasHardError =
    errorMessage.length > 0 &&
    !NO_PROGRESS_RE.test(errorMessage) &&
    !STALL_STRIKE_RE.test(errorMessage);
  return (
    input.state === "video_success" &&
    input.totalClips > 0 &&
    input.clipsDone >= input.totalClips &&
    !hasHardError
  );
}

/**
 * 纯函数：本次驱动后，依据「是否有真实进度 + 现有水位标」决定如何更新 error_message / 是否取消。
 * - madeProgress（clips_done 前进或抵达终态）→ clear（清水位标，回到健康）。
 * - 无进展且无/陈旧水位标 → mark（以 now 为该 clips_done 档的停滞起点）。
 * - 无进展且水位标 clips_done 与当前不同（刚前进过被清又卡新档）→ mark（起点刷新为 now）。
 * - 无进展且同一 clips_done 卡满 stallCancelMs → cancel。
 */
export function nextNoProgressDecision(input: {
  errorMessage: string | null | undefined;
  clipsDone: number;
  madeProgress: boolean;
  nowIso: string;
  stallCancelMs: number;
}): { action: "clear" | "mark" | "cancel"; errorMessage: string | null } {
  if (input.madeProgress) return { action: "clear", errorMessage: null };
  const m = String(input.errorMessage || "").trim().match(NO_PROGRESS_RE);
  const priorClips = m ? Number(m[1]) : NaN;
  const priorSince = m ? m[2] : "";
  // 无水位标 / 令牌是别的内容 / clips_done 档位变了 → 以 now 为新停滞窗口起点。
  if (!m || !priorSince || priorClips !== input.clipsDone) {
    return { action: "mark", errorMessage: `noprogress:${input.clipsDone}:${input.nowIso}` };
  }
  const elapsed = Date.parse(input.nowIso) - Date.parse(priorSince);
  if (Number.isFinite(elapsed) && elapsed >= input.stallCancelMs) {
    return { action: "cancel", errorMessage: NO_PROGRESS_CANCEL_MESSAGE };
  }
  // 仍在同一档停滞、未满窗口 → 保留原起点（绝不刷新，否则永远到不了窗口）。
  return { action: "mark", errorMessage: `noprogress:${input.clipsDone}:${priorSince}` };
}

function rethrowVideoRunSweepError(stage: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const annotated = new Error(`[video-run-sweep:${stage}] ${message}`);
  if (error instanceof Error && error.stack) {
    annotated.stack = `${annotated.name}: ${annotated.message}\nCaused by:\n${error.stack}`;
  }
  throw annotated;
}

export async function cancelStaleVideoRuns(input: {
  olderThanIso: string;
  nowIso: string;
  /** last_drive_at 早于此(或为空)才算"无人在推"。缺省=只按 created_at(旧行为，仅兜底)。 */
  notDrivenSinceIso?: string;
}): Promise<VideoRunRow[]> {
  const prisma = getPrismaClient();
  let rows: VideoRunRow[];
  try {
    rows = (await prisma.video_runs.findMany({
      where: {
        // collecting 占位行本就无人驱动（尚未 start），别按 stall 三振把它取消污染 runId。
        state: { notIn: NON_DRIVABLE_STATES },
        // stale sweep 与 production driver 共享所有权边界：authoring 尚未交棒的
        // run 归 authoring driver 管，不能被生产维护任务写入 stall 水位。
        AND: [
          {
            OR: [
              { beat_sheet: null, authoring_state: null },
              { beat_sheet: { not: null }, authoring_state: "authoring_done" },
            ],
          },
        ],
        created_at: { lt: input.olderThanIso },
        // authoring 可能运行数小时；刚从 collecting 原子交棒到 scheduled 的 run 虽然 created_at 很老，
        // updated_at 却是刚发生的真实进展。若不检查它，stale sweep 会先写 stall_strike 并抢走
        // last_drive_at，导致首个生产 tick 只显示“生成中”却没有派发任何视频任务。
        updated_at: { lt: input.olderThanIso },
        ...(input.notDrivenSinceIso
          ? { OR: [{ last_drive_at: null }, { last_drive_at: { lt: input.notDrivenSinceIso } }] }
          : {}),
      },
    })) as VideoRunRow[];
  } catch (error) {
    rethrowVideoRunSweepError("find_candidates", error);
  }
  if (!rows.length) return [];

  // 三振出局：每个 stall 窗口只记一振（记振时刷新 last_drive_at，下一振要再等满一个窗口）；
  // 期间任何健康 drive 会清掉计数（run-driver 在无错推进时回写 error_message=null）。
  const toCancel: VideoRunRow[] = [];
  for (const row of rows) {
    if (
      isVideoRunAwaitingClientConcat({
        state: row.state,
        clipsDone: row.clips_done,
        totalClips: row.total_clips,
        errorMessage: row.error_message,
      })
    ) {
      continue;
    }
    const decision = nextStallStrikeDecision(row.error_message);
    if (decision.action === "cancel") {
      toCancel.push(row);
      continue;
    }
    // The stale scan races with synchronous start/reconcile and with other
    // worker ticks.  A row can leave the scanned state between findMany and
    // this write; update() would throw P2025 and abort the whole batch, which
    // starves newly accepted runs.  Keep the state snapshot in the predicate
    // and treat count=0 as a harmless lost race for this stale candidate.
    try {
      await prisma.video_runs.updateMany({
        where: { id: row.id, state: row.state, updated_at: row.updated_at },
        data: {
          error_message: `stall_strike:${decision.strikes}`,
          last_drive_at: input.nowIso,
          updated_at: input.nowIso,
        },
      });
    } catch (error) {
      rethrowVideoRunSweepError(`mark_strike:${row.id}`, error);
    }
  }
  if (!toCancel.length) return [];
  try {
    await prisma.video_runs.updateMany({
      where: { id: { in: toCancel.map((r) => r.id) } },
      data: {
        state: "cancelled",
        updated_at: input.nowIso,
        completed_at: input.nowIso,
        error_message: `stale_run_auto_cancelled(strikes=${STALL_STRIKES_TO_CANCEL})`,
      },
    });
  } catch (error) {
    rethrowVideoRunSweepError("cancel_batch", error);
  }
  return toCancel.map((r) => ({ ...r, state: "cancelled", completed_at: input.nowIso }));
}

// 兜底：从 flow 行解出 project_id（用于 run.project_id 为空时广播到正确的 project 房间）。
export async function getProjectIdForFlow(flowId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  const row = await prisma.flows.findUnique({ where: { id: flowId }, select: { project_id: true } });
  return row?.project_id ?? null;
}

export async function updateVideoRunProgress(input: {
  runId: string;
  state: string;
  clipsDone: number;
  nowIso: string;
  errorMessage?: string | null;
  completed?: boolean;
}): Promise<void> {
  const prisma = getPrismaClient();
  // 【终态不许被进度回写降级·2026-07-07 ch5-v1 实测】重叠 tick 竞态：87s 长 tick（开始于 concat
  // 之前、持旧 clips 视图）迟到收尾，把已 concatenated 的 run 覆盖回 video_running 5/8 → run 重新
  // 可认领、被反复重驱动。行一旦进终态（concatenated/failed/cancelled），进度回写一律跳过——
  // 离开终态只有两条合法路径：insertVideoRun（failed/cancelled 复活、样片扩拍）与 cancel 专用更新。
  await prisma.video_runs.updateMany({
    where: { id: input.runId, state: { notIn: [...VIDEO_RUN_TERMINAL_STATES] } },
    data: {
      state: input.state,
      clips_done: Math.max(0, Math.trunc(input.clipsDone)),
      // Every attempted durable cycle renews the current worker lease. Business
      // progress is tracked independently by clips/state and retry receipts.
      last_drive_at: input.nowIso,
      updated_at: input.nowIso,
      ...(typeof input.errorMessage !== "undefined" ? { error_message: input.errorMessage } : {}),
      ...(input.completed ? { completed_at: input.nowIso } : {}),
    },
  });
}

/**
 * Relinquish a non-terminal synchronous drive lease after an explicit timeout,
 * abort, or drive failure. This does not change the user-visible outcome; it
 * only lets the recovery worker preserve provider-accepted media work.
 */
export async function releaseVideoRunDriveLease(runId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.video_runs.updateMany({
    where: { id: runId, state: { notIn: [...VIDEO_RUN_TERMINAL_STATES] } },
    data: { last_drive_at: null },
  });
}

/**
 * Preserve a deterministic drive failure as a leased/backed-off row. Keeping
 * last_drive_at at the failed attempt time prevents a fixed poison batch from
 * returning to the nulls-first window every tick and starving newer runs.
 */
export async function recordVideoRunDriveFailure(input: {
  runId: string;
  claimedAtIso: string;
  errorMessage: string;
  nowIso: string;
}): Promise<boolean> {
  const updated = await getPrismaClient().video_runs.updateMany({
    where: {
      id: input.runId,
      state: { notIn: [...VIDEO_RUN_TERMINAL_STATES] },
      last_drive_at: input.claimedAtIso,
    },
    data: {
      last_drive_at: input.nowIso,
      updated_at: input.nowIso,
      error_message: `drive_error:${input.errorMessage}`.slice(0, 1_000),
    },
  });
  return updated.count === 1;
}
