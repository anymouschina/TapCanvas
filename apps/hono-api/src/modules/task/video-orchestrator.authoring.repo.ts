/**
 * 【编排域状态机·仓储层】authoring_state / beat_sheet / authoring_artifacts / 章级改编合同。
 * spec：docs/superpowers/specs/2026-07-11-authoring-orchestrator-ddd-design.md
 *
 * authoring_state 是统一 delivery graph 的生命周期投影；没有 BeatSheet 的独立 direct-video run 不使用该字段。
 * 图 manifest、artifact status 与 derived_from 是调度真源，状态文案不再决定下一动作。
 */

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "../../types";

import { getPrismaClient } from "../../platform/node/prisma";
import { runDatabaseTransactionWithTransientRetry } from "../../platform/node/database-transaction-retry";
import { readPersistedFrozenLoopIdentity } from "./video-orchestrator.loop-idempotency";
import {
  VIDEO_AUTHORING_STATES,
  VIDEO_AUTHORING_TERMINAL_STATES,
  type VideoAuthoringState,
} from "@tapcanvas/video-orchestrator-protocol";
import { VIDEO_RUN_COLLECTING_STATE } from "./video-run.repo";
import {
	AUTHORING_ASSET_COVERAGE_NODE_KEY,
  AUTHORING_ASSEMBLY_NODE_KEY,
  AUTHORING_ESTIMATE_NODE_KEY,
  AUTHORING_PRODUCTION_HANDOFF_NODE_KEY,
} from "./video-orchestrator.authoring-graph";

export const AUTHORING_STATES = VIDEO_AUTHORING_STATES;
export type AuthoringState = VideoAuthoringState;

/**
 * 每个视频 clip 在真正调用供应商前都要登记一条 durable submission intent。
 * 恢复器只允许消费服务端写入的、明确关闭为 pre-upstream rejection 的 intent；
 * 画布上的 status/taskId 不是计费边界的权威记录。
 */
export const VIDEO_SUBMISSION_ARTIFACT_PREFIX = "video-submission:";
export const ASSET_REPAIR_FRONTIER_ARTIFACT_KEY = "asset:repair-frontier-v3";
export const ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY = "asset:repair-executor-owner";
export const ASSET_REPAIR_FRONTIER_CLAIM_LEASE_MS = 2 * 60_000;

export type AssetRepairFrontierClaimOwner =
	| {
		kind: "continuation";
		executionId: string;
		continuationProvider: string;
		continuationClaimToken: string;
	}
	| {
		kind: "request" | "system";
		executionId: string;
	};

type AssetRepairFrontierClaimReceiptV1 = {
	version: 1;
	token: string;
	ownerKind: AssetRepairFrontierClaimOwner["kind"];
	ownerExecutionId: string;
	expiresAt: string;
};

const ASSET_REPAIR_FRONTIER_CLAIM_PREFIX = "asset_repair_claim_v1:";
const ASSET_REPAIR_CONTINUATION_PROVIDER = "agents_async_continuation";

function serializeAssetRepairFrontierClaimReceipt(
	receipt: AssetRepairFrontierClaimReceiptV1,
): string {
	return `${ASSET_REPAIR_FRONTIER_CLAIM_PREFIX}${JSON.stringify(receipt)}`;
}

function parseAssetRepairFrontierClaimReceipt(
	value: string | null,
): AssetRepairFrontierClaimReceiptV1 | null {
	if (!value?.startsWith(ASSET_REPAIR_FRONTIER_CLAIM_PREFIX)) return null;
	try {
		const parsed: unknown = JSON.parse(value.slice(ASSET_REPAIR_FRONTIER_CLAIM_PREFIX.length));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const record = parsed as Record<string, unknown>;
		const token = typeof record.token === "string" ? record.token.trim() : "";
		const ownerExecutionId = typeof record.ownerExecutionId === "string"
			? record.ownerExecutionId.trim()
			: "";
		const ownerKind = record.ownerKind;
		const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt.trim() : "";
		return record.version === 1 && token && ownerExecutionId &&
			(ownerKind === "continuation" || ownerKind === "request" || ownerKind === "system") &&
			Number.isFinite(Date.parse(expiresAt))
			? { version: 1, token, ownerKind, ownerExecutionId, expiresAt }
			: null;
	} catch {
		return null;
	}
}

function buildAssetRepairFrontierClaimReceipt(input: {
	token: string;
	owner: AssetRepairFrontierClaimOwner;
	nowIso: string;
}): AssetRepairFrontierClaimReceiptV1 {
	return {
		version: 1,
		token: input.token,
		ownerKind: input.owner.kind,
		ownerExecutionId: input.owner.executionId,
		expiresAt: new Date(Date.parse(input.nowIso) + ASSET_REPAIR_FRONTIER_CLAIM_LEASE_MS).toISOString(),
	};
}

/**
 * Read only a frontier that can be claimed now. Active unexpired claims stay
 * invisible; expired receipts expose the same immutable payload so the next
 * owner can reach the exact reclaim CAS instead of stranding the run.
 */
export async function readClaimableAssetRepairFrontierPayload(input: {
	runId: string;
	nowIso: string;
}): Promise<string | null> {
	const row = await getPrismaClient().authoring_artifacts.findUnique({
		where: {
			run_id_artifact_key: {
				run_id: input.runId,
				artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
			},
		},
		select: { status: true, payload: true, error: true },
	});
	if (!row?.payload) return null;
	if (row.status === "waiting_external") return row.payload;
	const receipt = parseAssetRepairFrontierClaimReceipt(row.error);
	return row.status === "claimed" && receipt &&
		Date.parse(receipt.expiresAt) <= Date.parse(input.nowIso)
		? row.payload
		: null;
}

type AssetRepairFrontierIdentity = {
	runId: string;
	executionGeneration: string;
	revision: number;
};

function parseAssetRepairFrontierIdentity(
	value: string | null,
): AssetRepairFrontierIdentity | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const record = parsed as Record<string, unknown>;
		const runId = typeof record.runId === "string" ? record.runId.trim() : "";
		const executionGeneration = typeof record.executionGeneration === "string"
			? record.executionGeneration.trim()
			: "";
		const progress = record.progress && typeof record.progress === "object" && !Array.isArray(record.progress)
			? record.progress as Record<string, unknown>
			: null;
		const revision = typeof progress?.revision === "number" && Number.isInteger(progress.revision) && progress.revision >= 0
			? progress.revision
			: null;
		return record.version === 3 && runId && executionGeneration && revision !== null
			? { runId, executionGeneration, revision }
			: null;
	} catch {
		return null;
	}
}

export type AssetRepairExecutorOwnershipV1 = {
	version: 1;
	runId: string;
	repairGeneration: string;
	continuationId: string;
	ownerId: string;
	projectId: string | null;
	flowId: string | null;
	chapterId: string | null;
};

function parseAssetRepairExecutorOwnership(
	value: string | null,
): AssetRepairExecutorOwnershipV1 | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const record = parsed as Record<string, unknown>;
		if (record.version !== 1) return null;
		const runId = typeof record.runId === "string" ? record.runId.trim() : "";
		const repairGeneration = typeof record.repairGeneration === "string"
			? record.repairGeneration.trim()
			: "";
		const continuationId = typeof record.continuationId === "string"
			? record.continuationId.trim()
			: "";
		const ownerId = typeof record.ownerId === "string" ? record.ownerId.trim() : "";
		const readNullableId = (candidate: unknown): string | null =>
			typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
		const projectId = readNullableId(record.projectId);
		const flowId = readNullableId(record.flowId);
		const chapterId = readNullableId(record.chapterId);
		return runId && repairGeneration && continuationId
			&& ownerId
			? {
				version: 1,
				runId,
				repairGeneration,
				continuationId,
				ownerId,
				projectId,
				flowId,
				chapterId,
			}
			: null;
	} catch {
		return null;
	}
}

function continuationDataOwnsRepairGeneration(
	value: string | null,
	runId: string,
	repairGeneration: string,
): boolean {
	if (!value) return false;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
		const runs = (parsed as Record<string, unknown>).ownedRepairRuns;
		return Array.isArray(runs) && runs.some((candidate) => {
			if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
			const record = candidate as Record<string, unknown>;
			return record.version === 1 && record.runId === runId && record.repairGeneration === repairGeneration;
		});
	} catch {
		return false;
	}
}

export function videoSubmissionArtifactKey(clipIndex: number): string {
  return `${VIDEO_SUBMISSION_ARTIFACT_PREFIX}${clipIndex}`;
}

/** 终态：tick 不再认领。authoring_done=已交棒生产态机（estimate/start 之后）。 */
export const AUTHORING_TERMINAL_STATES = VIDEO_AUTHORING_TERMINAL_STATES;

export function isAuthoringState(state: unknown): state is AuthoringState {
  return typeof state === "string" &&
    (AUTHORING_STATES as readonly string[]).includes(state);
}

export function isTerminalAuthoringState(state: string): boolean {
  return (AUTHORING_TERMINAL_STATES as readonly string[]).includes(state);
}

/** 稳定内容 hash（键序无关·产物指纹）。 */
export function stableContentHash(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      return Object.keys(rec)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = canon(rec[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canon(value))).digest("hex").slice(0, 32);
}

/**
 * commit_beats 只允许创建新 collecting run，或更新同一 owner 的 collecting run。
 * 已进入生产或生产终态的 run 不得在这里复活或覆盖，避免丢失已生成 clip 与 story_plan 事实。
 */
export type BeatSheetRunCommitStatus = "created" | "replaced" | "already_committed";

export async function upsertBeatSheetRun(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  projectId?: string | null;
  chapterId?: string | null;
  beatSheetJson: string;
  filmBibleJson?: string | null;
  adaptationStrategyJson?: string | null;
  nowIso: string;
  db?: Prisma.TransactionClient;
}): Promise<BeatSheetRunCommitStatus> {
  const prisma = input.db ?? getPrismaClient();
  const existing = await prisma.video_runs.findUnique({
    where: { id: input.runId },
    select: { owner_id: true, state: true, authoring_state: true, beat_sheet: true },
  });
  if (existing) {
    if (existing.owner_id !== input.ownerId) throw new Error("beat_sheet_run_owner_mismatch");
    const incomingFrozenIdentity = readPersistedFrozenLoopIdentity(input.beatSheetJson);
    if (incomingFrozenIdentity && existing.authoring_state) {
      const existingFrozenIdentity = readPersistedFrozenLoopIdentity(existing.beat_sheet);
      if (
        existingFrozenIdentity?.revision === incomingFrozenIdentity.revision &&
        existingFrozenIdentity.fingerprint === incomingFrozenIdentity.fingerprint
      ) {
        return "already_committed";
      }
      throw new Error("beat_sheet_run_frozen_identity_conflict");
    }
    if (existing.state !== VIDEO_RUN_COLLECTING_STATE) {
      throw new Error(`beat_sheet_run_production_state_locked:${existing.state}`);
    }
    const updated = await prisma.video_runs.updateMany({
      where: {
        id: input.runId,
        owner_id: input.ownerId,
        state: VIDEO_RUN_COLLECTING_STATE,
      },
      data: {
        beat_sheet: input.beatSheetJson,
        authoring_state: "beats_committed",
        // A full recommit is the authoritative recovery boundary for a collecting run.
        // Do not expose the previous authoring failure as if it still described the active run.
        error_message: null,
        // The committing request owns the synchronous authoring lease.
        last_drive_at: input.nowIso,
        updated_at: input.nowIso,
        ...(input.flowId ? { flow_id: input.flowId } : {}),
        ...(input.projectId ? { project_id: input.projectId } : {}),
        ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
        ...(input.filmBibleJson ? { film_bible: input.filmBibleJson } : {}),
        ...(input.adaptationStrategyJson ? { adaptation_strategy: input.adaptationStrategyJson } : {}),
      },
    });
    if (updated.count !== 1) throw new Error("beat_sheet_run_commit_race");
    return "replaced";
  }

  const created = await prisma.video_runs.createMany({
    data: [{
      id: input.runId,
      owner_id: input.ownerId,
      flow_id: input.flowId ?? null,
      project_id: input.projectId ?? null,
      chapter_id: input.chapterId ?? null,
      state: VIDEO_RUN_COLLECTING_STATE,
      story_plan: null,
      film_bible: input.filmBibleJson ?? null,
      adaptation_strategy: input.adaptationStrategyJson ?? null,
      beat_sheet: input.beatSheetJson,
      authoring_state: "beats_committed",
      total_clips: 0,
      clips_done: 0,
      last_drive_at: input.nowIso,
      created_at: input.nowIso,
      updated_at: input.nowIso,
    }],
    skipDuplicates: true,
  });
  if (created.count === 1) return "created";

  // A concurrent first acceptance won the runId. Re-read its immutable frozen
  // identity after the unique-key conflict and coalesce only an exact replay.
  const raced = await prisma.video_runs.findUnique({
    where: { id: input.runId },
    select: { owner_id: true, state: true, authoring_state: true, beat_sheet: true },
  });
  if (!raced) throw new Error("beat_sheet_run_commit_race_missing");
  if (raced.owner_id !== input.ownerId) throw new Error("beat_sheet_run_owner_mismatch");
  const incomingFrozenIdentity = readPersistedFrozenLoopIdentity(input.beatSheetJson);
  const racedFrozenIdentity = readPersistedFrozenLoopIdentity(raced.beat_sheet);
  if (
    incomingFrozenIdentity &&
    raced.authoring_state &&
    racedFrozenIdentity?.revision === incomingFrozenIdentity.revision &&
    racedFrozenIdentity.fingerprint === incomingFrozenIdentity.fingerprint
  ) {
    return "already_committed";
  }
  throw new Error("beat_sheet_run_frozen_identity_conflict");
}

/**
 * 把驱动层验真的新 BeatSheet 快照原子写回原 run。
 * expectedBeatSheetJson 是 CAS 条件：并发驱动已推进或用户重提 BeatSheet 时本调用让位，绝不覆盖新版本。
 */
export async function persistBeatSheetSnapshot(input: {
  runId: string;
  expectedBeatSheetJson: string;
  beatSheetJson: string;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const updated = await prisma.video_runs.updateMany({
    where: { id: input.runId, beat_sheet: input.expectedBeatSheetJson },
    data: { beat_sheet: input.beatSheetJson, updated_at: input.nowIso },
  });
  return updated.count === 1;
}

/** CAS 推进 authoring_state（from 不匹配=让位返回 false，容忍并发推进者）。 */
export async function advanceAuthoringState(input: {
  runId: string;
  from: AuthoringState | AuthoringState[];
  to: AuthoringState;
  nowIso: string;
  errorMessage?: string | null;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const fromList = Array.isArray(input.from) ? input.from : [input.from];
  const updated = await prisma.video_runs.updateMany({
    where: { id: input.runId, authoring_state: { in: fromList as string[] } },
    data: {
      authoring_state: input.to,
      updated_at: input.nowIso,
      ...(input.errorMessage !== undefined ? { error_message: input.errorMessage } : {}),
    },
  });
	return updated.count > 0;
}

/**
 * The authoring repair wait and its exact v3 execution epoch become visible in
 * one transaction. Canvas status nodes are downstream projections only.
 */
export async function advanceAuthoringStateWithAssetRepairFrontier(input: {
  runId: string;
  from: AuthoringState | AuthoringState[];
  declaration: unknown;
  nowIso: string;
  errorMessage: string;
}): Promise<boolean> {
  const payload = JSON.stringify(input.declaration);
  const frontier = parseAssetRepairFrontierIdentity(payload);
  if (frontier?.runId !== input.runId) throw new Error("asset_repair_frontier_invalid");
  const fromList = Array.isArray(input.from) ? input.from : [input.from];
  const prisma = getPrismaClient();
  return prisma.$transaction(async (db) => {
    const updated = await db.video_runs.updateMany({
      where: { id: input.runId, authoring_state: { in: fromList as string[] } },
      data: {
        authoring_state: "asset_repair_required",
        updated_at: input.nowIso,
        error_message: input.errorMessage,
      },
    });
    if (updated.count !== 1) return false;
    await upsertAuthoringArtifact({
      runId: input.runId,
      artifactKey: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
      contentHash: stableContentHash(input.declaration),
      derivedFrom: [AUTHORING_ASSET_COVERAGE_NODE_KEY, "assetRepair/v3"],
      status: "waiting_external",
      payload,
      error: null,
      nowIso: input.nowIso,
      db,
    });
    await db.authoring_artifacts.updateMany({
      where: {
        run_id: input.runId,
        artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
      },
      data: {
        status: "stale",
        error: "asset_repair_frontier_generation_rotated",
        updated_at: input.nowIso,
      },
    });
    return true;
  });
}

/**
 * Hard-cut adoption for pre-v3 rows. It is reachable only from an explicit,
 * run-scoped drive/recovery event (periodic scans exclude asset_repair_required)
 * and succeeds only when the authoritative frontier is genuinely absent.
 */
export async function adoptLegacyAssetRepairFrontierIfAbsent(input: {
  runId: string;
  ownerId: string;
  projectId: string | null;
  flowId: string | null;
  chapterId: string | null;
  declaration: unknown;
  nowIso: string;
}): Promise<boolean> {
  const payload = JSON.stringify(input.declaration);
  const identity = parseAssetRepairFrontierIdentity(payload);
  if (identity?.runId !== input.runId || identity.revision !== 0) {
    throw new Error("legacy_asset_repair_frontier_adoption_invalid");
  }
  const prisma = getPrismaClient();
  return prisma.$transaction(async (db) => {
    const run = await db.video_runs.findFirst({
      where: {
        id: input.runId,
        owner_id: input.ownerId,
        project_id: input.projectId,
        flow_id: input.flowId,
        chapter_id: input.chapterId,
        state: VIDEO_RUN_COLLECTING_STATE,
        authoring_state: "asset_repair_required",
      },
      select: { id: true },
    });
    if (!run) return false;
    const existing = await db.authoring_artifacts.findUnique({
      where: {
        run_id_artifact_key: {
          run_id: input.runId,
          artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
        },
      },
      select: { id: true },
    });
    if (existing) return false;
    await db.authoring_artifacts.create({
      data: {
        id: randomUUID(),
        run_id: input.runId,
        artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
        content_hash: stableContentHash(input.declaration),
        derived_from: JSON.stringify(["legacy_asset_repair_adoption", "assetRepair/v3"]),
        status: "waiting_external",
        payload,
        error: null,
        created_at: input.nowIso,
        updated_at: input.nowIso,
      },
    });
    await db.authoring_artifacts.updateMany({
      where: {
        run_id: input.runId,
        artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
      },
      data: {
        status: "stale",
        error: "legacy_asset_repair_frontier_adopted",
        updated_at: input.nowIso,
      },
    });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Close only the current physical asset-repair execution after its durable
 * agent continuation has exhausted every retry. The narrow scope/state CAS
 * preserves the BeatSheet, repair declaration and every materialized asset;
 * it merely prevents an ownerless WAITING_EXTERNAL run from claiming that an
 * executor is still active.
 */
export async function failAssetRepairRunAfterTerminalExecutor(input: {
	runId: string;
	ownerId: string;
	projectId: string;
	flowId: string;
	chapterId: string | null;
	errorMessage: string;
	nowIso: string;
}): Promise<boolean> {
	const prisma = getPrismaClient();
	const updated = await prisma.video_runs.updateMany({
		where: {
			id: input.runId,
			owner_id: input.ownerId,
			project_id: input.projectId,
			flow_id: input.flowId || null,
			chapter_id: input.chapterId,
			state: VIDEO_RUN_COLLECTING_STATE,
			authoring_state: "asset_repair_required",
		},
		data: {
			authoring_state: "authoring_failed",
			error_message: input.errorMessage,
			last_drive_at: null,
			updated_at: input.nowIso,
		},
	});
	return updated.count === 1;
}

/**
 * Creates one continuation and transfers every frozen repair generation to it
 * in the same database transaction. The mutable owner receipt lives in the
 * existing authoring artifact graph, so this adds no schema or hidden fallback.
 * A child may take over only from its exact parent (or from an explicitly
 * terminal owner artifact); a late sibling cannot steal a newer execution.
 */
export async function createAssetRepairContinuationWithOwnership(input: {
	db: PrismaClient;
	continuationId: string;
	continuationProvider: string;
	continuationUserId: string;
	continuationData: unknown;
	parentContinuationId: string | null;
	createdAt: string;
	runs: Array<{
		runId: string;
		repairGeneration: string;
		ownerId: string;
		projectId: string;
		flowId: string | null;
		chapterId: string | null;
	}>;
}): Promise<boolean> {
	try {
		return await input.db.$transaction(async (tx) => {
			const existingTask = await tx.task_statuses.findUnique({
				where: {
					task_id_provider: {
						task_id: input.continuationId,
						provider: input.continuationProvider,
					},
				},
				select: { id: true },
			});
			if (existingTask) return false;

			for (const run of input.runs) {
				const scopedRun = await tx.video_runs.findFirst({
					where: {
						id: run.runId,
						owner_id: run.ownerId,
						project_id: run.projectId,
						...(run.flowId ? { flow_id: run.flowId } : {}),
						chapter_id: run.chapterId,
						state: VIDEO_RUN_COLLECTING_STATE,
						authoring_state: "asset_repair_required",
					},
					select: {
						id: true,
						owner_id: true,
						project_id: true,
						flow_id: true,
						chapter_id: true,
					},
				});
				if (!scopedRun) {
					throw new Error(`asset_repair_executor_run_scope_changed:${run.runId}`);
				}
				const runFenced = await tx.video_runs.updateMany({
					where: {
						id: run.runId,
						owner_id: run.ownerId,
						project_id: run.projectId,
						...(run.flowId ? { flow_id: run.flowId } : {}),
						chapter_id: run.chapterId,
						state: VIDEO_RUN_COLLECTING_STATE,
						authoring_state: "asset_repair_required",
					},
					data: { updated_at: input.createdAt },
				});
				if (runFenced.count !== 1) {
					throw new Error(`asset_repair_executor_run_raced:${run.runId}`);
				}
				const frontierArtifact = await tx.authoring_artifacts.findUnique({
					where: {
						run_id_artifact_key: {
							run_id: run.runId,
							artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
						},
					},
					select: { id: true, payload: true, status: true },
				});
				const frontier = parseAssetRepairFrontierIdentity(frontierArtifact?.payload ?? null);
				if (
					frontierArtifact?.status !== "waiting_external" ||
					frontier?.runId !== run.runId ||
					frontier.executionGeneration !== run.repairGeneration
				) {
					throw new Error(`asset_repair_executor_frontier_generation_mismatch:${run.runId}`);
				}
				const frontierFenced = await tx.authoring_artifacts.updateMany({
					where: {
						id: frontierArtifact.id,
						payload: frontierArtifact.payload,
						status: "waiting_external",
					},
					data: { updated_at: input.createdAt },
				});
				if (frontierFenced.count !== 1) {
					throw new Error(`asset_repair_executor_frontier_raced:${run.runId}`);
				}
				const existingOwner = await tx.authoring_artifacts.findUnique({
					where: {
						run_id_artifact_key: {
							run_id: run.runId,
							artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
						},
					},
					select: { id: true, payload: true, status: true },
				});
				const previous = parseAssetRepairExecutorOwnership(existingOwner?.payload ?? null);
				const mayTakeOwnership =
					!existingOwner ||
					previous?.continuationId === input.continuationId ||
					(Boolean(input.parentContinuationId) && previous?.continuationId === input.parentContinuationId) ||
					existingOwner.status === "failed" ||
					existingOwner.status === "stale";
				if (!mayTakeOwnership) {
					throw new Error(`asset_repair_executor_owner_conflict:${run.runId}`);
				}
				const ownership: AssetRepairExecutorOwnershipV1 = {
					version: 1,
					runId: run.runId,
					repairGeneration: run.repairGeneration,
					continuationId: input.continuationId,
					ownerId: scopedRun.owner_id,
					projectId: scopedRun.project_id,
					flowId: scopedRun.flow_id,
					chapterId: scopedRun.chapter_id,
				};
				const payload = JSON.stringify(ownership);
				if (existingOwner) {
					const replaced = await tx.authoring_artifacts.updateMany({
						where: {
							id: existingOwner.id,
							payload: existingOwner.payload,
							status: existingOwner.status,
						},
						data: {
							content_hash: stableContentHash(ownership),
							status: "waiting_external",
							payload,
							error: null,
							updated_at: input.createdAt,
						},
					});
					if (replaced.count !== 1) {
						throw new Error(`asset_repair_executor_owner_raced:${run.runId}`);
					}
				} else {
					await tx.authoring_artifacts.create({
						data: {
							id: randomUUID(),
							run_id: run.runId,
							artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
							content_hash: stableContentHash(ownership),
							derived_from: "[]",
							status: "waiting_external",
							payload,
							error: null,
							created_at: input.createdAt,
							updated_at: input.createdAt,
						},
					});
				}
			}

			await tx.task_statuses.create({
				data: {
					id: randomUUID(),
					task_id: input.continuationId,
					provider: input.continuationProvider,
					user_id: input.continuationUserId,
					status: "waiting",
					data: JSON.stringify(input.continuationData),
					created_at: input.createdAt,
					updated_at: input.createdAt,
					completed_at: null,
				},
			});
			return true;
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error
			? String(error.code)
			: "";
		if (code === "P2002") {
			const existing = await input.db.task_statuses.findUnique({
				where: {
					task_id_provider: {
						task_id: input.continuationId,
						provider: input.continuationProvider,
					},
				},
				select: { id: true },
			});
			if (existing) return false;
		}
		throw error;
	}
}

/**
 * Atomically terminalizes one claimed continuation and every asset-repair run
 * it currently owns. Updating the continuation row first inside the same
 * transaction is the settlement fence: cancellation or another claimant wins
 * before any run can be changed, and a crash cannot leave a failed owner with
 * an unclosed WAITING_EXTERNAL run (or the inverse).
 */
export async function settleClaimedAssetRepairContinuation(input: {
	continuationId: string;
	continuationProvider: string;
	continuationUserId: string;
	continuationClaimToken: string;
	continuationData: unknown;
	requestedStatus: "completed" | "failed";
	runs: Array<{
		runId: string;
		repairGeneration: string;
		ownerId: string;
		projectId: string;
		flowId: string;
		chapterId: string | null;
	}>;
	errorMessage: string;
	nowIso: string;
}): Promise<{ terminalized: boolean; settledRunIds: string[]; status: "completed" | "failed" }> {
	const prisma = getPrismaClient();
	return runDatabaseTransactionWithTransientRetry(() => prisma.$transaction(async (tx) => {
		const currentContinuation = await tx.task_statuses.findUnique({
			where: {
				task_id_provider: {
					task_id: input.continuationId,
					provider: input.continuationProvider,
				},
			},
			select: { status: true, data: true },
		});
		let claimMatches = false;
		if (currentContinuation?.status === "claimed" && currentContinuation.data) {
			try {
				const parsed: unknown = JSON.parse(currentContinuation.data);
				claimMatches = Boolean(
					parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
					(parsed as Record<string, unknown>).claimToken === input.continuationClaimToken,
				);
			} catch {
				claimMatches = false;
			}
		}
		if (!claimMatches || !currentContinuation?.data) {
			return { terminalized: false, settledRunIds: [], status: input.requestedStatus };
		}
		const continuationFenced = await tx.task_statuses.updateMany({
			where: {
				task_id: input.continuationId,
				provider: input.continuationProvider,
				status: "claimed",
				data: currentContinuation.data,
			},
			data: { updated_at: input.nowIso },
		});
		if (continuationFenced.count !== 1) {
			return { terminalized: false, settledRunIds: [], status: input.requestedStatus };
		}

		const ownedRuns: Array<{
			run: (typeof input.runs)[number];
			ownerArtifactId: string;
			ownerPayload: string;
			scope: AssetRepairExecutorOwnershipV1;
			stillWaiting: boolean;
			frontierStatus: string;
		}> = [];
		for (const run of input.runs) {
			const frontierArtifact = await tx.authoring_artifacts.findUnique({
				where: {
					run_id_artifact_key: {
						run_id: run.runId,
						artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
					},
				},
				select: { payload: true, status: true },
			});
			const frontier = parseAssetRepairFrontierIdentity(frontierArtifact?.payload ?? null);
			const ownerArtifact = await tx.authoring_artifacts.findUnique({
				where: {
					run_id_artifact_key: {
						run_id: run.runId,
						artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
					},
				},
				select: { id: true, payload: true, status: true },
			});
			const owner = parseAssetRepairExecutorOwnership(ownerArtifact?.payload ?? null);
			if (!ownerArtifact?.payload || !owner || owner.runId !== run.runId) {
				throw new Error(`asset_repair_executor_owner_receipt_invalid:${run.runId}`);
			}
			const frontierGenerationChanged =
				frontier?.runId === run.runId &&
				frontier.executionGeneration !== run.repairGeneration;
			if (frontierGenerationChanged) {
				// A recovery/new repair epoch supersedes this physical executor. Close
				// only its task row; never inspect or mutate the new frontier/run owner.
				continue;
			}
			if (!frontier || (frontierArtifact?.status !== "waiting_external" && frontierArtifact?.status !== "ready")) {
				throw new Error(`asset_repair_executor_frontier_unsettled:${run.runId}`);
			}
			if (owner.continuationId !== input.continuationId) {
				if (ownerArtifact.status !== "waiting_external") {
					// A successor already settled or recovery invalidated this owner. The
					// old physical continuation may close only its own task row.
					continue;
				}
				const successor = await tx.task_statuses.findUnique({
					where: {
						task_id_provider: {
							task_id: owner.continuationId,
							provider: input.continuationProvider,
						},
					},
					select: { status: true, data: true },
				});
				if (
					!successor ||
					(successor.status !== "waiting" && successor.status !== "claimed") ||
					!continuationDataOwnsRepairGeneration(
						successor.data,
						run.runId,
						owner.repairGeneration,
					)
				) {
					throw new Error(`asset_repair_executor_successor_invalid:${run.runId}`);
				}
				continue;
			}
			if (owner.repairGeneration !== run.repairGeneration) {
				throw new Error(`asset_repair_executor_generation_mismatch:${run.runId}`);
			}
			if (ownerArtifact.status !== "waiting_external") {
				throw new Error(`asset_repair_executor_owner_not_active:${run.runId}`);
			}
			const ownerFenced = await tx.authoring_artifacts.updateMany({
				where: {
					id: ownerArtifact.id,
					payload: ownerArtifact.payload,
					status: "waiting_external",
				},
				data: {
					status: "settling",
					updated_at: input.nowIso,
				},
			});
			if (ownerFenced.count !== 1) {
				throw new Error(`asset_repair_executor_owner_fence_raced:${run.runId}`);
			}
			const waitingRun = await tx.video_runs.findFirst({
				where: {
					id: run.runId,
					owner_id: owner.ownerId,
					project_id: owner.projectId,
					flow_id: owner.flowId,
					chapter_id: owner.chapterId,
					state: VIDEO_RUN_COLLECTING_STATE,
					authoring_state: "asset_repair_required",
				},
				select: { id: true },
			});
			ownedRuns.push({
				run,
				ownerArtifactId: ownerArtifact.id,
				ownerPayload: ownerArtifact.payload,
				scope: owner,
				stillWaiting: Boolean(waitingRun),
				frontierStatus: frontierArtifact.status,
			});
		}

		// A "completed" executor cannot release its last owner while the exact
		// owned generation still waits for external assets and no successor took
		// the lease. That is a terminal unsatisfied delivery, not success.
		const effectiveStatus = input.requestedStatus === "completed" &&
			ownedRuns.some((owned) => owned.stillWaiting)
			? "failed"
			: input.requestedStatus;
		const terminalized = await tx.task_statuses.updateMany({
			where: {
				task_id: input.continuationId,
				provider: input.continuationProvider,
				status: "claimed",
				data: currentContinuation.data,
			},
			data: {
				user_id: input.continuationUserId,
				status: effectiveStatus,
				data: JSON.stringify(input.continuationData),
				completed_at: input.nowIso,
				updated_at: input.nowIso,
			},
		});
		if (terminalized.count !== 1) {
			throw new Error(`asset_repair_continuation_settlement_raced:${input.continuationId}`);
		}

		const settledRunIds: string[] = [];
		for (const owned of ownedRuns) {
			const run = owned.run;
			if (!owned.stillWaiting || effectiveStatus !== "failed") {
				const ownerUpdated = await tx.authoring_artifacts.updateMany({
					where: {
						id: owned.ownerArtifactId,
						payload: owned.ownerPayload,
						status: "settling",
					},
					data: {
						status: owned.frontierStatus === "ready" || !owned.stillWaiting ? "ready" : "failed",
						error: owned.frontierStatus === "ready" || !owned.stillWaiting ? null : input.errorMessage,
						updated_at: input.nowIso,
					},
				});
				if (ownerUpdated.count !== 1) {
					throw new Error(`asset_repair_executor_owner_settlement_raced:${run.runId}`);
				}
				continue;
			}
			const settled = await tx.video_runs.updateMany({
				where: {
					id: run.runId,
					owner_id: owned.scope.ownerId,
					project_id: owned.scope.projectId,
					flow_id: owned.scope.flowId,
					chapter_id: owned.scope.chapterId,
					state: VIDEO_RUN_COLLECTING_STATE,
					authoring_state: "asset_repair_required",
				},
				data: {
					authoring_state: "authoring_failed",
					error_message: input.errorMessage,
					last_drive_at: null,
					updated_at: input.nowIso,
				},
			});
			if (settled.count === 1) {
				settledRunIds.push(run.runId);
				const ownerUpdated = await tx.authoring_artifacts.updateMany({
					where: {
						id: owned.ownerArtifactId,
						payload: owned.ownerPayload,
						status: "settling",
					},
					data: {
						status: "failed",
						error: input.errorMessage,
						updated_at: input.nowIso,
					},
				});
				if (ownerUpdated.count !== 1) {
					throw new Error(`asset_repair_executor_owner_settlement_raced:${run.runId}`);
				}
			} else {
				throw new Error(`asset_repair_executor_run_settlement_raced:${run.runId}`);
			}
		}
		return { terminalized: true, settledRunIds, status: effectiveStatus };
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), {
		operation: "settle_claimed_asset_repair_continuation",
		onRetry: (diagnostic) => {
			console.warn("[continuation-settlement] transient transaction conflict; retrying exact claim", {
				...diagnostic,
				continuationId: input.continuationId,
			});
		},
	});
}

/**
 * 将一次尚未进入生产的 coverage 失败从 cancelled 恢复为 collecting。
 *
 * 这是一个非常窄的 CAS：只允许 authoring_failed + coverage 缺口的 run，且不改写
 * BeatSheet 或清除原始 error_message。恢复器会先把“没有任何上游视频任务/真实视频 URL”
 * 的证据写入 authoring_artifacts，再由 authoring driver 重新验真并推进状态。这样用户显式
 * 说“继续”时可以恢复同一 run，同时不会把真正已经付费或已受理的生产 run 误复活。
 */
export async function resumeCancelledAuthoringRun(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  projectId?: string | null;
  chapterId?: string | null;
  nowIso: string;
}): Promise<AuthoringRunRow | null> {
  const prisma = getPrismaClient();
  const resumed = await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      owner_id: input.ownerId,
      state: "cancelled",
      authoring_state: "authoring_failed",
      error_message: { startsWith: "authoring_asset_coverage_missing:" },
      ...(input.flowId ? { flow_id: input.flowId } : {}),
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
    },
    data: {
      state: VIDEO_RUN_COLLECTING_STATE,
      // 保留 error_message，driver 需要它识别这是 coverage 自愈，而不是普通失败。
      completed_at: null,
      last_drive_at: null,
      updated_at: input.nowIso,
    },
  });
  if (resumed.count !== 1) return null;
  return getAuthoringRun(input.runId);
}

/**
 * Resume a cancelled pre-production run whose persisted clip artifacts prove
 * that writer work is still safely resumable. The caller must first fresh-read
 * the canvas and durable submission intents; this CAS only enforces the final
 * zero-production lifecycle boundary and never rewrites the BeatSheet or ready
 * writer artifacts.
 */
export async function resumeCancelledWriterAuthoringRun(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  projectId?: string | null;
  chapterId?: string | null;
  nowIso: string;
}): Promise<AuthoringRunRow | null> {
  const prisma = getPrismaClient();
  const resumed = await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      owner_id: input.ownerId,
      state: "cancelled",
      authoring_state: "authoring_failed",
      total_clips: 0,
      clips_done: 0,
      ...(input.flowId ? { flow_id: input.flowId } : {}),
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
    },
    data: {
      state: VIDEO_RUN_COLLECTING_STATE,
      // Re-enter the single initial writer-dispatch phase. It deterministically
      // dispatches only pending slots, preserves ready/running/failed artifacts,
      // then hands failed slots to the existing bounded repair phase.
      authoring_state: "beats_committed",
      error_message: null,
      completed_at: null,
      last_drive_at: null,
      updated_at: input.nowIso,
    },
  });
  if (resumed.count !== 1) return null;
  return getAuthoringRun(input.runId);
}

/**
 * A writer repair can fail after the first recovery has already reopened the
 * same zero-production run. Keep the lifecycle state at authoring_failed so
 * the unified recovery driver can process both pending and repairable failed
 * writer slots in one cycle; ready artifacts and the BeatSheet remain intact.
 */
export async function resumeCollectingWriterAuthoringRun(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  projectId?: string | null;
  chapterId?: string | null;
  nowIso: string;
}): Promise<AuthoringRunRow | null> {
  const prisma = getPrismaClient();
  const resumed = await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      owner_id: input.ownerId,
      state: VIDEO_RUN_COLLECTING_STATE,
      authoring_state: "authoring_failed",
      total_clips: 0,
      clips_done: 0,
      ...(input.flowId ? { flow_id: input.flowId } : {}),
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
    },
    data: {
      authoring_state: "authoring_failed",
      error_message: null,
      completed_at: null,
      last_drive_at: null,
      updated_at: input.nowIso,
    },
  });
  if (resumed.count !== 1) return null;
  return getAuthoringRun(input.runId);
}

/**
 * Atomically restores one terminal asset-repair wait and rotates its exact
 * server-owned v3 frontier generation. The canvas is a later projection only:
 * a losing recovery request cannot mutate either the durable epoch or the run.
 */
export async function resumeCollectingAssetRepairWaitRunWithFrontier(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  projectId?: string | null;
  chapterId?: string | null;
  declaration: unknown;
  executionGeneration: string;
  nowIso: string;
}): Promise<AuthoringRunRow | null> {
  const serialized = JSON.stringify(input.declaration);
  const identity = parseAssetRepairFrontierIdentity(serialized);
  if (
    identity?.runId !== input.runId ||
    identity.executionGeneration !== input.executionGeneration
  ) {
    throw new Error("asset_repair_recovery_frontier_invalid");
  }
  const prisma = getPrismaClient();
  const resumed = await prisma.$transaction(async (db) => {
    const changed = await db.video_runs.updateMany({
      where: {
        id: input.runId,
        owner_id: input.ownerId,
        state: VIDEO_RUN_COLLECTING_STATE,
        authoring_state: "authoring_failed",
        total_clips: 0,
        clips_done: 0,
        OR: [
          { error_message: { startsWith: "authoring_no_progress_timeout: state=asset_repair_required," } },
          { error_message: { startsWith: "asset_repair_executor_terminal:" } },
        ],
        ...(input.flowId ? { flow_id: input.flowId } : {}),
        ...(input.projectId ? { project_id: input.projectId } : {}),
        ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
      },
      data: {
        authoring_state: "asset_repair_required",
        error_message: null,
        last_drive_at: null,
        updated_at: input.nowIso,
      },
    });
    if (changed.count !== 1) return false;
    await upsertAuthoringArtifact({
      runId: input.runId,
      artifactKey: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
      contentHash: stableContentHash(input.declaration),
      derivedFrom: ["authoring_recovery", "assetRepair/v3"],
      status: "waiting_external",
      payload: serialized,
      error: null,
      nowIso: input.nowIso,
      db,
    });
    await db.authoring_artifacts.updateMany({
      where: {
        run_id: input.runId,
        artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
      },
      data: {
        status: "stale",
        error: "asset_repair_frontier_generation_rotated",
        updated_at: input.nowIso,
      },
    });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return resumed ? getAuthoringRun(input.runId) : null;
}

/**
 * 将 authoring driver 因 productionState=cancelled 而错误归档的同一 run 恢复到
 * 冲突 artifact 记录的前一 authoring state。该入口只允许零生产进度、已取消状态，
 * 且不改写 BeatSheet；恢复前的错误与目标状态由上层 artifact 证据绑定。
 */
export async function resumeCancelledAuthoringConflictRun(input: {
  runId: string;
  ownerId: string;
  flowId?: string | null;
  projectId?: string | null;
  chapterId?: string | null;
  restoreAuthoringState: AuthoringState;
  nowIso: string;
}): Promise<AuthoringRunRow | null> {
  const prisma = getPrismaClient();
  const resumed = await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      owner_id: input.ownerId,
      state: "cancelled",
      authoring_state: "authoring_done",
      total_clips: 0,
      clips_done: 0,
      ...(input.flowId ? { flow_id: input.flowId } : {}),
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
    },
    data: {
      state: VIDEO_RUN_COLLECTING_STATE,
      authoring_state: input.restoreAuthoringState,
      error_message: null,
      completed_at: null,
      last_drive_at: null,
      updated_at: input.nowIso,
    },
  });
  if (resumed.count !== 1) return null;
  return getAuthoringRun(input.runId);
}

export type AuthoringRunRow = {
  id: string;
  owner_id: string;
  flow_id: string | null;
  project_id: string | null;
  chapter_id: string | null;
  state: string;
  error_message: string | null;
  beat_sheet: string | null;
  authoring_state: string | null;
  created_at: string;
  updated_at: string;
};

/** Read one durable authoring run without applying scheduler eligibility rules. */
export async function getAuthoringRun(runId: string): Promise<AuthoringRunRow | null> {
  const row = await getPrismaClient().video_runs.findUnique({
    where: { id: runId },
    select: {
      id: true,
      owner_id: true,
      flow_id: true,
      project_id: true,
      chapter_id: true,
      state: true,
      error_message: true,
      beat_sheet: true,
      authoring_state: true,
      created_at: true,
      updated_at: true,
    },
  });
  return row as AuthoringRunRow | null;
}

/** writer clip 失败的历史 error_message 前缀；只用于终态展示与审计。 */
export const WRITER_CLIP_FAILURE_PREFIX = "writer clip 失败:";
/** 历史终态前缀；首次结构化提交失败的 writer 不再进入 tick 恢复队列。 */
export const WRITER_CLIP_UNREPAIRABLE_PREFIX = "authoring_writer_unrepairable:";

/**
 * tick 只认领能依靠已有持久事实继续推进的非终态 run。真实资产 coverage 等待态
 * 仅由精确 run 事件唤醒，不进入周期扫描；其它 authoring_failed 仍是显式终态。
 * writer clip 一旦 failed 即按 single_submission_record_and_fail 收口，不再周期认领、重派或拉长预算。
 */
/**
 * 【放弃版本判据·2026-07-28】同章节是否存在更晚创建的 run。
 * 用户改编一章会连开多版（ch1197 一天 18 版实测）——旧版失败后用户直接开新版，
 * 旧版就是"已放弃"。历史调度器曾把这些失败版本重新认领并产生额外 writer 调用；
 * 当前失败 writer 已是记录即终态，不再参与周期恢复。此判据仍按创建时间比、不按 updated_at，
 * 避免历史状态整理本身改变版本先后关系。
 */
export async function hasNewerRunForChapter(input: {
  chapterId: string | null;
  createdAt: Date | string | null;
  excludeRunId: string;
}): Promise<boolean> {
  if (!input.chapterId || !input.createdAt) return false;
  const prisma = getPrismaClient();
  const newer = await prisma.video_runs.findFirst({
    where: {
      chapter_id: input.chapterId,
      id: { not: input.excludeRunId },
      // created_at 是 ISO-8601 字符串列，字典序即时间序，可直接 gt 比较。
      created_at: {
        gt: input.createdAt instanceof Date ? input.createdAt.toISOString() : String(input.createdAt),
      },
    },
    select: { id: true },
  });
  return newer != null;
}

export async function listActiveAuthoringRuns(
  limit = 5,
  options: { lastDrivenBeforeIso?: string } = {},
): Promise<AuthoringRunRow[]> {
  const prisma = getPrismaClient();
  const take = Math.max(1, limit);
  const staleDriveWhere = options.lastDrivenBeforeIso
    ? {
        AND: [{
          OR: [
            { last_drive_at: null },
            { last_drive_at: { lt: options.lastDrivenBeforeIso } },
          ],
        }],
      }
    : {};
  const orderBy = [
    { last_drive_at: { sort: "asc" as const, nulls: "first" as const } },
    { updated_at: "asc" as const },
  ];
  const select = {
    id: true,
    owner_id: true,
    flow_id: true,
    project_id: true,
    chapter_id: true,
    state: true,
    error_message: true,
    beat_sheet: true,
    authoring_state: true,
    created_at: true,
    updated_at: true,
  } as const;

  // 周期恢复器只认领能够靠服务端已有事实继续推进的内部工作。
  // asset_repair_required 与 coverage authoring_failed 都在等待新的外部资产证据；
  // 没有新事件时反复 fresh-read 不能改变结果，只会让持久等待 run 永久占用 worker。
  // 它们只能由 loop 重放、repair_assets、recover_authoring 等显式事件按 runId 唤醒。
  const executableRows = await prisma.video_runs.findMany({
    where: {
      OR: [
        {
          authoring_state: {
            not: null,
            notIn: [
              ...AUTHORING_TERMINAL_STATES,
              "asset_repair_required",
            ] as string[],
          },
        },
      ],
      ...staleDriveWhere,
    },
    orderBy,
    take,
    select,
  });
  return executableRows as AuthoringRunRow[];
}

/** 记录 authoring worker 已实际取得该 run 的驱动锁；只更新调度水位，不改生命周期状态。 */
export async function markAuthoringRunDriveAttempt(input: {
  runId: string;
  nowIso: string;
}): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.video_runs.updateMany({
    where: {
      id: input.runId,
      authoring_state: { not: null },
    },
    data: { last_drive_at: input.nowIso },
  });
}

// ── authoring_artifacts：产物登记（8.1 build-system 底座）─────────────────────

export type AuthoringArtifactRow = {
  id: string;
  run_id: string;
  artifact_key: string;
  content_hash: string;
  derived_from: string;
  status: string;
  payload: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function upsertAuthoringArtifact(input: {
  runId: string;
  artifactKey: string;
  contentHash: string;
  derivedFrom?: readonly string[];
  status?: string;
  payload?: string | null;
  error?: string | null;
  nowIso: string;
  db?: Prisma.TransactionClient;
}): Promise<void> {
  const prisma = input.db ?? getPrismaClient();
  const derived = JSON.stringify(input.derivedFrom ?? []);
  await prisma.authoring_artifacts.upsert({
    where: {
      run_id_artifact_key: { run_id: input.runId, artifact_key: input.artifactKey },
    },
    create: {
      id: randomUUID(),
      run_id: input.runId,
      artifact_key: input.artifactKey,
      content_hash: input.contentHash,
      derived_from: derived,
      status: input.status ?? "pending",
      payload: input.payload ?? null,
      error: input.error ?? null,
      created_at: input.nowIso,
      updated_at: input.nowIso,
    },
    update: {
      content_hash: input.contentHash,
      derived_from: derived,
      ...(input.status ? { status: input.status } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      updated_at: input.nowIso,
    },
  });
}

/**
 * Create the first v3 frontier, replay the exact same waiting declaration, or
 * explicitly rotate a terminal ready frontier to a fresh generation. A second
 * repair cycle on the same durable run is legal; overwriting an active or
 * failed generation is not.
 */
export async function persistInitialAssetRepairFrontierArtifact(input: {
  runId: string;
  declaration: unknown;
  nowIso: string;
}): Promise<void> {
  const payload = JSON.stringify(input.declaration);
  const next = parseAssetRepairFrontierIdentity(payload);
  if (next?.runId !== input.runId) throw new Error("asset_repair_frontier_invalid");
  const prisma = getPrismaClient();
  await prisma.$transaction(async (db) => {
    const existing = await db.authoring_artifacts.findUnique({
      where: {
        run_id_artifact_key: {
          run_id: input.runId,
          artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
        },
      },
      select: { id: true, payload: true, status: true },
    });
    if (existing) {
      const current = parseAssetRepairFrontierIdentity(existing.payload);
      if (
        existing.status === "waiting_external" &&
        current?.executionGeneration === next.executionGeneration &&
        current.revision === next.revision &&
        existing.payload === payload
      ) {
        return;
      }
      if (
        existing.status === "ready" &&
        current &&
        current.executionGeneration !== next.executionGeneration &&
        next.revision === 0
      ) {
        const rotated = await db.authoring_artifacts.updateMany({
          where: {
            id: existing.id,
            status: "ready",
            payload: existing.payload,
          },
          data: {
            content_hash: stableContentHash(input.declaration),
            derived_from: JSON.stringify(["assetRepair/v3", "server_authoritative_frontier"]),
            status: "waiting_external",
            payload,
            error: null,
            updated_at: input.nowIso,
          },
        });
        if (rotated.count !== 1) {
          throw new Error("asset_repair_frontier_generation_rotation_raced");
        }
        await db.authoring_artifacts.updateMany({
          where: {
            run_id: input.runId,
            artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
          },
          data: {
            status: "stale",
            error: "asset_repair_frontier_generation_rotated",
            updated_at: input.nowIso,
          },
        });
        return;
      }
      throw new Error("asset_repair_frontier_initial_write_conflict");
    }
    await db.authoring_artifacts.create({
      data: {
        id: randomUUID(),
        run_id: input.runId,
        artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
        content_hash: stableContentHash(input.declaration),
        derived_from: JSON.stringify(["assetRepair/v3", "server_authoritative_frontier"]),
        status: "waiting_external",
        payload,
        error: null,
        created_at: input.nowIso,
        updated_at: input.nowIso,
      },
    });
  });
}

export async function claimAssetRepairFrontierArtifact(input: {
  runId: string;
  expectedExecutionGeneration: string;
  expectedRevision: number;
  owner: AssetRepairFrontierClaimOwner;
  nowIso: string;
}): Promise<{ claimToken: string; payload: string } | null> {
  const prisma = getPrismaClient();
  const ownerExecutionId = input.owner.executionId.trim();
  if (!ownerExecutionId || !Number.isFinite(Date.parse(input.nowIso))) return null;
  return prisma.$transaction(async (db) => {
    const currentRow = await db.authoring_artifacts.findUnique({
      where: {
        run_id_artifact_key: {
          run_id: input.runId,
          artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
        },
      },
      select: { id: true, payload: true, status: true, error: true, updated_at: true },
    });
    const current = parseAssetRepairFrontierIdentity(currentRow?.payload ?? null);
    if (
      !currentRow?.payload ||
      current?.executionGeneration !== input.expectedExecutionGeneration ||
      current.revision !== input.expectedRevision
    ) return null;

    const ownerArtifact = await db.authoring_artifacts.findUnique({
      where: {
        run_id_artifact_key: {
          run_id: input.runId,
          artifact_key: ASSET_REPAIR_EXECUTOR_OWNER_ARTIFACT_KEY,
        },
      },
      select: { id: true, payload: true, status: true },
    });
    const durableOwner = parseAssetRepairExecutorOwnership(ownerArtifact?.payload ?? null);
    if (input.owner.kind === "continuation") {
      if (
        ownerArtifact?.status !== "waiting_external" ||
        durableOwner?.continuationId !== ownerExecutionId ||
        durableOwner.repairGeneration !== input.expectedExecutionGeneration
      ) return null;
      const task = await db.task_statuses.findUnique({
        where: {
          task_id_provider: {
            task_id: ownerExecutionId,
            provider: input.owner.continuationProvider,
          },
        },
        select: { status: true, data: true },
      });
      if (task?.status !== "claimed" || !task.data) return null;
      try {
        const parsed: unknown = JSON.parse(task.data);
        if (
          !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          (parsed as Record<string, unknown>).claimToken !== input.owner.continuationClaimToken ||
          !continuationDataOwnsRepairGeneration(
            task.data,
            input.runId,
            input.expectedExecutionGeneration,
          )
        ) return null;
      } catch {
        return null;
      }
    } else if (ownerArtifact?.status === "waiting_external") {
      if (!durableOwner) return null;
      const task = await db.task_statuses.findUnique({
        where: {
          task_id_provider: {
            task_id: durableOwner.continuationId,
            provider: ASSET_REPAIR_CONTINUATION_PROVIDER,
          },
        },
        select: { status: true },
      });
      if (task?.status === "waiting" || task?.status === "claimed") return null;
      const madeStale = await db.authoring_artifacts.updateMany({
        where: {
          id: ownerArtifact.id,
          payload: ownerArtifact.payload,
          status: "waiting_external",
        },
        data: {
          status: "stale",
          error: "asset_repair_executor_task_terminal",
          updated_at: input.nowIso,
        },
      });
      if (madeStale.count !== 1) return null;
    }

    const previousClaim = parseAssetRepairFrontierClaimReceipt(currentRow.error);
    const mayClaimWaiting = currentRow.status === "waiting_external";
    const mayReclaimExpired = currentRow.status === "claimed" &&
      previousClaim !== null &&
      Date.parse(previousClaim.expiresAt) <= Date.parse(input.nowIso);
    if (!mayClaimWaiting && !mayReclaimExpired) return null;

    const claimToken = randomUUID();
    const claimReceipt = serializeAssetRepairFrontierClaimReceipt(
      buildAssetRepairFrontierClaimReceipt({
        token: claimToken,
        owner: { ...input.owner, executionId: ownerExecutionId },
        nowIso: input.nowIso,
      }),
    );
    const claimed = await db.authoring_artifacts.updateMany({
      where: {
        id: currentRow.id,
        payload: currentRow.payload,
        status: currentRow.status,
        error: currentRow.error,
        updated_at: currentRow.updated_at,
      },
      data: { status: "claimed", error: claimReceipt, updated_at: input.nowIso },
    });
    return claimed.count === 1 ? { claimToken, payload: currentRow.payload } : null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function releaseAssetRepairFrontierClaim(input: {
  runId: string;
  claimToken: string;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const current = await prisma.authoring_artifacts.findUnique({
    where: {
      run_id_artifact_key: {
        run_id: input.runId,
        artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
      },
    },
    select: { id: true, payload: true, status: true, error: true },
  });
  const receipt = parseAssetRepairFrontierClaimReceipt(current?.error ?? null);
  if (!current?.payload || current.status !== "claimed" || receipt?.token !== input.claimToken) {
    return false;
  }
  const updated = await prisma.authoring_artifacts.updateMany({
    where: {
      id: current.id,
      payload: current.payload,
      status: "claimed",
      error: current.error,
    },
    data: { status: "waiting_external", error: null, updated_at: input.nowIso },
  });
  return updated.count === 1;
}

export async function touchAssetRepairFrontierClaim(input: {
  runId: string;
  claimToken: string;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const current = await prisma.authoring_artifacts.findUnique({
    where: {
      run_id_artifact_key: {
        run_id: input.runId,
        artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
      },
    },
    select: { id: true, payload: true, status: true, error: true },
  });
  const receipt = parseAssetRepairFrontierClaimReceipt(current?.error ?? null);
  if (!current?.payload || current.status !== "claimed" || receipt?.token !== input.claimToken) {
    return false;
  }
  const refreshed = serializeAssetRepairFrontierClaimReceipt({
    ...receipt,
    expiresAt: new Date(Date.parse(input.nowIso) + ASSET_REPAIR_FRONTIER_CLAIM_LEASE_MS).toISOString(),
  });
  const updated = await prisma.authoring_artifacts.updateMany({
    where: {
      id: current.id,
      payload: current.payload,
      status: "claimed",
      error: current.error,
    },
    data: { error: refreshed, updated_at: input.nowIso },
  });
  return updated.count === 1;
}

export async function settleClaimedAssetRepairFrontierArtifact(input: {
  runId: string;
  claimToken: string;
  expectedExecutionGeneration: string;
  expectedRevision: number;
  declaration: unknown;
  status: "waiting_external" | "ready" | "failed";
  advanceAuthoringFrom?: AuthoringState;
  advanceAuthoringTo?: AuthoringState;
  nowIso: string;
}): Promise<boolean> {
  const payload = JSON.stringify(input.declaration);
  const next = parseAssetRepairFrontierIdentity(payload);
  if (
    next?.runId !== input.runId ||
    next.executionGeneration !== input.expectedExecutionGeneration ||
    (next.revision !== input.expectedRevision && next.revision !== input.expectedRevision + 1)
  ) return false;
  const prisma = getPrismaClient();
  return prisma.$transaction(async (db) => {
    const currentRow = await db.authoring_artifacts.findUnique({
      where: {
        run_id_artifact_key: {
          run_id: input.runId,
          artifact_key: ASSET_REPAIR_FRONTIER_ARTIFACT_KEY,
        },
      },
      select: { id: true, payload: true, status: true, error: true },
    });
    const current = parseAssetRepairFrontierIdentity(currentRow?.payload ?? null);
    const claimReceipt = parseAssetRepairFrontierClaimReceipt(currentRow?.error ?? null);
    if (
      !currentRow?.payload ||
      currentRow.status !== "claimed" ||
      claimReceipt?.token !== input.claimToken ||
      current?.executionGeneration !== input.expectedExecutionGeneration ||
      current.revision !== input.expectedRevision
    ) return false;
    const payloadIsIdentical = currentRow.payload === payload;
    if (
      (payloadIsIdentical && next.revision !== input.expectedRevision) ||
      (!payloadIsIdentical && next.revision !== input.expectedRevision + 1)
    ) return false;
    if (input.advanceAuthoringFrom || input.advanceAuthoringTo) {
      if (!input.advanceAuthoringFrom || !input.advanceAuthoringTo) return false;
      const runUpdated = await db.video_runs.updateMany({
        where: { id: input.runId, authoring_state: input.advanceAuthoringFrom },
        data: {
          authoring_state: input.advanceAuthoringTo,
          error_message: null,
          updated_at: input.nowIso,
        },
      });
      if (runUpdated.count !== 1) return false;
    }
    const updated = await db.authoring_artifacts.updateMany({
      where: {
        id: currentRow.id,
        payload: currentRow.payload,
        status: "claimed",
        error: currentRow.error,
      },
      data: {
        content_hash: stableContentHash(input.declaration),
        derived_from: JSON.stringify(["assetRepair/v3", "server_authoritative_frontier"]),
        status: input.status,
        payload,
        error: null,
        updated_at: input.nowIso,
      },
    });
    if (updated.count !== 1) throw new Error("asset_repair_frontier_claim_settlement_raced");
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type AuthoringGraphCommitArtifact = Omit<
  Parameters<typeof upsertAuthoringArtifact>[0],
  "db"
>;

/**
 * BeatSheet run、graph manifest 与全部动态节点的唯一提交边界。
 * worker 只能看到完整的新图或完整的旧图，禁止暴露半提交 frontier。
 */
export async function commitBeatSheetGraphSnapshot(input: {
  run: Omit<Parameters<typeof upsertBeatSheetRun>[0], "db">;
  artifacts: readonly AuthoringGraphCommitArtifact[];
}): Promise<BeatSheetRunCommitStatus> {
  const prisma = getPrismaClient();
  return await prisma.$transaction(async (db) => {
    const status = await upsertBeatSheetRun({ ...input.run, db });
    if (status === "already_committed") return status;
    for (const artifact of input.artifacts) {
      await upsertAuthoringArtifact({ ...artifact, db });
    }
    return status;
  });
}

type VideoSubmissionPayload = {
  schemaVersion?: number;
  kind?: string;
  phase?: string;
  runId?: string;
  clipIndex?: number;
  requestHash?: string;
  providerAccepted?: boolean | null;
  providerRequestAttempted?: boolean | null;
  taskId?: string;
  vendor?: string;
  verifiedBy?: string;
  errorMessage?: string;
  errorCode?: string;
  slotNodeId?: string;
  attempt?: number;
  claimedAt?: string;
  updatedAt?: string;
  replacementAuthorizedAt?: string;
  replacementReason?: string;
  previousSubmission?: {
    status: string;
    contentHash: string;
    payload: VideoSubmissionPayload | null;
    error: string | null;
    updatedAt: string;
  };
};

function parseVideoSubmissionPayload(value: string | null): VideoSubmissionPayload | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as VideoSubmissionPayload
      : null;
  } catch {
    return null;
  }
}

function isVerifiedPreUpstreamSubmission(row: Pick<AuthoringArtifactRow, "status" | "payload">): boolean {
  const payload = parseVideoSubmissionPayload(row.payload);
  return row.status === "stale" &&
    payload?.kind === "structured_pre_upstream_rejection" &&
    payload.phase === "pre_upstream" &&
    payload.providerAccepted === false &&
    payload.providerRequestAttempted === false &&
    payload.verifiedBy === "hono_video_submission_boundary";
}

/**
 * An explicit replaceAtIndex call opens a new submission boundary for a clip
 * whose previous provider task must remain auditable but cannot be reused as
 * the new attempt's idempotency record.
 */
function isExplicitReplacementReady(row: Pick<AuthoringArtifactRow, "status" | "payload">): boolean {
  const payload = parseVideoSubmissionPayload(row.payload);
  return row.status === "stale" &&
    payload?.kind === "explicit_replacement_authorized" &&
    payload.phase === "replacement_ready" &&
    payload.providerRequestAttempted === false &&
    payload.providerAccepted === false &&
    payload.verifiedBy === "hono_video_replacement_boundary";
}

function isClaimableSubmissionIntent(row: Pick<AuthoringArtifactRow, "status" | "payload">): boolean {
  return isVerifiedPreUpstreamSubmission(row) || isExplicitReplacementReady(row);
}

export type VideoSubmissionClaimResult =
  | { claimed: true; artifact: AuthoringArtifactRow }
  | { claimed: false; reason: "existing_submission_intent" | "submission_identity_uncertain" | "database_race"; artifact: AuthoringArtifactRow | null };

/**
 * 供应商 POST 前的唯一提交权。通用 upsert 不得用于 video-submission:*，否则已 accepted/uncertain
 * 记录会被新一轮 pending 覆盖。只有服务端已经验真的 pre-upstream rejection 才能 CAS 进入下一次 claim。
 */
export async function claimVideoSubmissionIntent(input: {
  runId: string;
  clipIndex: number;
  requestHash: string;
  slotNodeId: string;
  attempt: number;
  nowIso: string;
}): Promise<VideoSubmissionClaimResult> {
  const prisma = getPrismaClient();
  const artifactKey = videoSubmissionArtifactKey(input.clipIndex);
  const payload = JSON.stringify({
    schemaVersion: 1,
    kind: "video_clip_submission",
    phase: "claimed",
    runId: input.runId,
    clipIndex: input.clipIndex,
    slotNodeId: input.slotNodeId,
    requestHash: input.requestHash,
    attempt: input.attempt,
    providerRequestAttempted: false,
    providerAccepted: null,
    claimedAt: input.nowIso,
    updatedAt: input.nowIso,
  });
  try {
    const created = await prisma.authoring_artifacts.create({
      data: {
        id: randomUUID(),
        run_id: input.runId,
        artifact_key: artifactKey,
        content_hash: input.requestHash,
        derived_from: JSON.stringify([AUTHORING_PRODUCTION_HANDOFF_NODE_KEY]),
        status: "pending",
        payload,
        created_at: input.nowIso,
        updated_at: input.nowIso,
      },
    });
    return { claimed: true, artifact: created as AuthoringArtifactRow };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }

  const existing = await prisma.authoring_artifacts.findUnique({
    where: { run_id_artifact_key: { run_id: input.runId, artifact_key: artifactKey } },
  }) as AuthoringArtifactRow | null;
  if (!existing) return { claimed: false, reason: "database_race", artifact: null };
  if (!isClaimableSubmissionIntent(existing)) {
    const existingPayload = parseVideoSubmissionPayload(existing.payload);
    const hasAcceptedIdentity = Boolean(existingPayload?.taskId) || existingPayload?.providerAccepted === true;
    return {
      claimed: false,
      reason: hasAcceptedIdentity ? "existing_submission_intent" : "submission_identity_uncertain",
      artifact: existing,
    };
  }
  const updated = await prisma.authoring_artifacts.updateMany({
    where: {
      id: existing.id,
      run_id: input.runId,
      artifact_key: artifactKey,
      status: existing.status,
      content_hash: existing.content_hash,
    },
    data: {
      content_hash: input.requestHash,
      status: "pending",
      payload,
      error: null,
      updated_at: input.nowIso,
    },
  });
  if (updated.count !== 1) {
    const raced = await prisma.authoring_artifacts.findUnique({
      where: { run_id_artifact_key: { run_id: input.runId, artifact_key: artifactKey } },
    }) as AuthoringArtifactRow | null;
    return { claimed: false, reason: "database_race", artifact: raced };
  }
  const claimed = await prisma.authoring_artifacts.findUnique({
    where: { run_id_artifact_key: { run_id: input.runId, artifact_key: artifactKey } },
  });
  return claimed
    ? { claimed: true, artifact: claimed as AuthoringArtifactRow }
    : { claimed: false, reason: "database_race", artifact: null };
}

/**
 * Authorize a fresh provider submission for an explicitly replaced clip.
 *
 * The existing submission row is retained in `previousSubmission`; neither a
 * previously accepted taskId nor its failure evidence is deleted. The new
 * attempt can then use the ordinary claim → provider POST transition without
 * weakening idempotency for normal starts/retries.
 */
export async function authorizeVideoSubmissionReplacement(input: {
  runId: string;
  clipIndex: number;
  reason: string;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const artifactKey = videoSubmissionArtifactKey(input.clipIndex);
  const existing = await prisma.authoring_artifacts.findUnique({
    where: { run_id_artifact_key: { run_id: input.runId, artifact_key: artifactKey } },
  }) as AuthoringArtifactRow | null;

  // A clip that never reached the provider has no intent to reopen; normal
  // claim creation on start is the correct first submission boundary.
  if (!existing) return true;

  const replacementPayload: VideoSubmissionPayload = {
    schemaVersion: 1,
    kind: "explicit_replacement_authorized",
    phase: "replacement_ready",
    runId: input.runId,
    clipIndex: input.clipIndex,
    providerRequestAttempted: false,
    providerAccepted: false,
    verifiedBy: "hono_video_replacement_boundary",
    replacementAuthorizedAt: input.nowIso,
    replacementReason: input.reason,
    previousSubmission: {
      status: existing.status,
      contentHash: existing.content_hash,
      payload: parseVideoSubmissionPayload(existing.payload),
      error: existing.error,
      updatedAt: existing.updated_at,
    },
  };
  const updated = await prisma.authoring_artifacts.updateMany({
    where: {
      id: existing.id,
      run_id: input.runId,
      artifact_key: artifactKey,
      status: existing.status,
      content_hash: existing.content_hash,
    },
    data: {
      status: "stale",
      payload: JSON.stringify(replacementPayload),
      error: "explicit_replacement_authorized",
      updated_at: input.nowIso,
    },
  });
  return updated.count === 1;
}

async function transitionVideoSubmissionIntent(input: {
  runId: string;
  clipIndex: number;
  requestHash: string;
  status: string;
  payload: VideoSubmissionPayload;
  nowIso: string;
  error?: string | null;
}): Promise<boolean> {
  const updated = await getPrismaClient().authoring_artifacts.updateMany({
    where: {
      run_id: input.runId,
      artifact_key: videoSubmissionArtifactKey(input.clipIndex),
      status: "pending",
      content_hash: input.requestHash,
    },
    data: {
      status: input.status,
      payload: JSON.stringify({ ...input.payload, updatedAt: input.nowIso }),
      ...(input.error !== undefined ? { error: input.error } : {}),
      updated_at: input.nowIso,
    },
  });
  return updated.count === 1;
}

export function markVideoSubmissionPreUpstreamRejected(input: {
  runId: string;
  clipIndex: number;
  requestHash: string;
  errorMessage: string;
  errorCode?: string | null;
  nowIso: string;
}): Promise<boolean> {
  return transitionVideoSubmissionIntent({
    ...input,
    status: "stale",
    payload: {
      schemaVersion: 1,
      kind: "structured_pre_upstream_rejection",
      phase: "pre_upstream",
      runId: input.runId,
      clipIndex: input.clipIndex,
      requestHash: input.requestHash,
      providerRequestAttempted: false,
      providerAccepted: false,
      verifiedBy: "hono_video_submission_boundary",
      errorMessage: input.errorMessage,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    },
  });
}

export function markVideoSubmissionUncertain(input: {
  runId: string;
  clipIndex: number;
  requestHash: string;
  errorMessage: string;
  nowIso: string;
}): Promise<boolean> {
  return transitionVideoSubmissionIntent({
    ...input,
    status: "failed",
    payload: {
      schemaVersion: 1,
      kind: "upstream_submission_uncertain",
      phase: "upstream_uncertain",
      runId: input.runId,
      clipIndex: input.clipIndex,
      requestHash: input.requestHash,
      providerRequestAttempted: null,
      providerAccepted: null,
      errorMessage: input.errorMessage,
    },
  });
}

export function markVideoSubmissionAccepted(input: {
  runId: string;
  clipIndex: number;
  requestHash: string;
  taskId: string;
  vendor: string;
  nowIso: string;
}): Promise<boolean> {
  return transitionVideoSubmissionIntent({
    ...input,
    status: "ready",
    payload: {
      schemaVersion: 1,
      kind: "provider_task_accepted",
      phase: "provider_accepted",
      runId: input.runId,
      clipIndex: input.clipIndex,
      requestHash: input.requestHash,
      providerRequestAttempted: true,
      providerAccepted: true,
      taskId: input.taskId,
      vendor: input.vendor,
    },
  });
}

export async function listAuthoringArtifacts(runId: string): Promise<AuthoringArtifactRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.authoring_artifacts.findMany({ where: { run_id: runId } });
  return rows as AuthoringArtifactRow[];
}

export async function markAuthoringArtifact(input: {
  runId: string;
  artifactKey: string;
  /** Optional lifecycle CAS. Dispatchers must claim pending work before creating remote agents. */
  expectedStatus?: string | string[];
  status: string;
  contentHash?: string;
  payload?: string | null;
  error?: string | null;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const expectedStatuses = input.expectedStatus === undefined
    ? null
    : Array.isArray(input.expectedStatus)
      ? input.expectedStatus
      : [input.expectedStatus];
  const updated = await prisma.authoring_artifacts.updateMany({
    where: {
      run_id: input.runId,
      artifact_key: input.artifactKey,
      ...(expectedStatuses ? { status: { in: expectedStatuses } } : {}),
    },
    data: {
      status: input.status,
      ...(input.contentHash !== undefined ? { content_hash: input.contentHash } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      updated_at: input.nowIso,
    },
  });
  return updated.count > 0;
}

class AuthoringClipContractRejectionConflict extends Error {
  constructor() {
    super("authoring_clip_contract_rejection_conflict");
    this.name = "AuthoringClipContractRejectionConflict";
  }
}

/**
 * Atomically routes a deterministic executable-contract failure back to the
 * single writer artifact that owns the invalid JSON paths. Downstream graph
 * nodes are invalidated before any provider handoff; ready sibling clips and
 * their frozen payloads remain untouched.
 */
export async function commitAuthoringClipContractRejection(input: {
  runId: string;
  artifactKey: string;
  expectedAuthoringStates: readonly AuthoringState[];
  failedPayload: string;
  error: string;
  evidenceArtifactKey: string;
  evidenceContentHash: string;
  evidencePayload: string;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      const productionHandoff = await tx.authoring_artifacts.findUnique({
        where: {
          run_id_artifact_key: {
            run_id: input.runId,
            artifact_key: AUTHORING_PRODUCTION_HANDOFF_NODE_KEY,
          },
        },
        select: { status: true },
      });
      if (productionHandoff?.status === "ready") {
        throw new AuthoringClipContractRejectionConflict();
      }

      const runClaim = await tx.video_runs.updateMany({
        where: {
          id: input.runId,
          state: VIDEO_RUN_COLLECTING_STATE,
          authoring_state: { in: [...input.expectedAuthoringStates] },
        },
        data: {
          authoring_state: "authoring_failed",
          error_message: input.error,
          updated_at: input.nowIso,
        },
      });
      if (runClaim.count !== 1) throw new AuthoringClipContractRejectionConflict();

      const clipClaim = await tx.authoring_artifacts.updateMany({
        where: {
          run_id: input.runId,
          artifact_key: input.artifactKey,
          status: "ready",
        },
        data: {
          status: "failed",
          payload: input.failedPayload,
          error: input.error,
          updated_at: input.nowIso,
        },
      });
      if (clipClaim.count !== 1) throw new AuthoringClipContractRejectionConflict();

      await tx.authoring_artifacts.updateMany({
        where: {
          run_id: input.runId,
          artifact_key: { in: [AUTHORING_ASSEMBLY_NODE_KEY, AUTHORING_ESTIMATE_NODE_KEY] },
        },
        data: {
          status: "pending",
          error: input.error,
          updated_at: input.nowIso,
        },
      });

      await tx.authoring_artifacts.upsert({
        where: {
          run_id_artifact_key: {
            run_id: input.runId,
            artifact_key: input.evidenceArtifactKey,
          },
        },
        create: {
          id: randomUUID(),
          run_id: input.runId,
          artifact_key: input.evidenceArtifactKey,
          content_hash: input.evidenceContentHash,
          derived_from: JSON.stringify([input.artifactKey]),
          status: "ready",
          payload: input.evidencePayload,
          error: input.error,
          created_at: input.nowIso,
          updated_at: input.nowIso,
        },
        update: {
          content_hash: input.evidenceContentHash,
          derived_from: JSON.stringify([input.artifactKey]),
          status: "ready",
          payload: input.evidencePayload,
          error: input.error,
          updated_at: input.nowIso,
        },
      });
      return true;
    });
  } catch (error) {
    if (error instanceof AuthoringClipContractRejectionConflict) return false;
    throw error;
  }
}

/**
 * assembled 收口必须原子完成：同一事务内认领状态、写装配事实并进入下一态。
 * clip:N 工件只读，任何装配失败都不会覆盖或删除已冻结的 writer 输出。
 */
export async function commitAuthoringAssemblyVerification(input: {
  runId: string;
  valid: boolean;
  contentHash: string;
  derivedFrom: string[];
  payload: string;
  error?: string | null;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.video_runs.updateMany({
      where: { id: input.runId, authoring_state: "assembled" },
      data: {
        authoring_state: input.valid ? "script_approved" : "authoring_failed",
        updated_at: input.nowIso,
        error_message: input.valid ? null : (input.error ?? "assembly_verification_failed"),
      },
    });
    if (claimed.count !== 1) return false;

    await tx.authoring_artifacts.upsert({
      where: {
        run_id_artifact_key: {
          run_id: input.runId,
          artifact_key: "assembly:verification",
        },
      },
      create: {
        id: randomUUID(),
        run_id: input.runId,
        artifact_key: "assembly:verification",
        content_hash: input.contentHash,
        derived_from: JSON.stringify(input.derivedFrom),
        status: input.valid ? "ready" : "failed",
        payload: input.payload,
        error: input.valid ? null : (input.error ?? "assembly_verification_failed"),
        created_at: input.nowIso,
        updated_at: input.nowIso,
      },
      update: {
        content_hash: input.contentHash,
        derived_from: JSON.stringify(input.derivedFrom),
        status: input.valid ? "ready" : "failed",
        payload: input.payload,
        error: input.valid ? null : (input.error ?? "assembly_verification_failed"),
        updated_at: input.nowIso,
      },
    });
    return true;
  });
}

/** 失效某产物+其下游闭包（derived_from 反向遍历）→ status=stale。返回被失效的 key 列表。 */
export async function invalidateArtifactClosure(input: {
  runId: string;
  rootKeys: string[];
  nowIso: string;
}): Promise<string[]> {
  const rows = await listAuthoringArtifacts(input.runId);
  const dependents = new Map<string, string[]>();
  for (const row of rows) {
    let deps: string[] = [];
    try {
      deps = JSON.parse(row.derived_from) as string[];
    } catch {
      deps = [];
    }
    for (const d of deps) {
      const list = dependents.get(d) ?? [];
      list.push(row.artifact_key);
      dependents.set(d, list);
    }
  }
  const stale = new Set<string>();
  const queue = [...input.rootKeys];
  while (queue.length) {
    const key = queue.shift()!;
    if (stale.has(key)) continue;
    stale.add(key);
    for (const child of dependents.get(key) ?? []) queue.push(child);
  }
  const prisma = getPrismaClient();
  await prisma.authoring_artifacts.updateMany({
    where: { run_id: input.runId, artifact_key: { in: [...stale] } },
    data: { status: "stale", updated_at: input.nowIso },
  });
  return [...stale];
}

// ── 章级改编合同 ─────────────────────────────────────────────────────────────

export async function getChapterAdaptationContract(chapterId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  const row = await prisma.chapters.findUnique({
    where: { id: chapterId },
    select: { adaptation_contract: true },
  });
  return (row?.adaptation_contract as string | null) ?? null;
}

export async function setChapterAdaptationContract(input: {
  chapterId: string;
  contractJson: string;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const updated = await prisma.chapters.updateMany({
    where: { id: input.chapterId },
    data: { adaptation_contract: input.contractJson, updated_at: input.nowIso },
  });
  return updated.count > 0;
}

// ── 章级交付范围 ────────────────────────────────────────────────────────

export type ChapterFilmSpec = {
  deliveryScope?: "full_chapter" | "opening_duration";
  targetDurationSeconds?: number;
  adaptationMode?: "faithful" | "creative";
  notes?: string;
  /**
   * 章级题材申报（2026-07-17 用户拍板「按原文选 domain」根治）：commit_beats 的 meta.filmGenre
   * 持久化于此，作章级题材真源——bridge 组装知识检索上下文（knowledgeContext）时读它，
   * 让领域知识卡按题材命中而不是赌派发词。此前 filmGenre 有申报无消费（装饰品）。
   */
  filmGenre?: string;
  updatedAt?: string;
};

/**
 * 章级持久化拥有交付范围、用户明确指定时才存在的目标总时长，以及显式改编模式。视频模型、画幅和分辨率统一来自
 * 当前 AI 对话的生成偏好与实时目录，不允许历史 chapters.film_spec 建立第二套规格真源。
 * 纯函数：原地合并章级创作合同，返回结构告警列表。
 */
export function mergeFilmSpecAuthority(
  target: Record<string, unknown>,
  spec: Pick<ChapterFilmSpec, "deliveryScope" | "targetDurationSeconds" | "adaptationMode"> | null | undefined,
): string[] {
  const warnings: string[] = [];
  if (!spec) return warnings;
  if (spec.deliveryScope === "opening_duration") {
    const targetDurationSeconds = Number(spec.targetDurationSeconds);
    if (!Number.isInteger(targetDurationSeconds) || targetDurationSeconds <= 0) {
      throw new Error("opening_duration film spec requires a positive integer targetDurationSeconds");
    }
    target.deliveryScope = "opening_duration";
    target.targetDurationSeconds = targetDurationSeconds;
  } else if (spec.deliveryScope === "full_chapter") {
    target.deliveryScope = "full_chapter";
    delete target.targetDurationSeconds;
  }
  if (spec.adaptationMode === "faithful" || spec.adaptationMode === "creative") {
    target.adaptationMode = spec.adaptationMode;
  }
  return warnings;
}

export async function getChapterFilmSpec(chapterId: string): Promise<ChapterFilmSpec | null> {
  const prisma = getPrismaClient();
  const row = await prisma.chapters.findUnique({
    where: { id: chapterId },
    select: { film_spec: true },
  });
  const raw = (row?.film_spec as string | null) ?? null;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return {
      ...(record.adaptationMode === "faithful" || record.adaptationMode === "creative"
        ? { adaptationMode: record.adaptationMode }
        : {}),
      ...(record.deliveryScope === "full_chapter" || record.deliveryScope === "opening_duration"
        ? { deliveryScope: record.deliveryScope }
        : {}),
      ...(record.deliveryScope === "opening_duration" && Number.isInteger(record.targetDurationSeconds) && Number(record.targetDurationSeconds) > 0
        ? { targetDurationSeconds: Number(record.targetDurationSeconds) }
        : {}),
      ...(typeof record.notes === "string" ? { notes: record.notes } : {}),
      ...(typeof record.filmGenre === "string" ? { filmGenre: record.filmGenre } : {}),
      ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
    };
  } catch {
    return null;
  }
}

export async function setChapterFilmSpec(input: {
  chapterId: string;
  ownerId: string;
  spec: ChapterFilmSpec;
  nowIso: string;
}): Promise<boolean> {
  const prisma = getPrismaClient();
  const updated = await prisma.chapters.updateMany({
    where: { id: input.chapterId, owner_id: input.ownerId },
    data: {
      film_spec: JSON.stringify({ ...input.spec, updatedAt: input.nowIso }),
      updated_at: input.nowIso,
    },
  });
  return updated.count > 0;
}
