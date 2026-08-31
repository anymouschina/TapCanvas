// 【clip 持久副作用身份·根治 absent 双开（2026-08-10）】
//
// 病根：画布 clip 节点是「clipIndex→taskId」的唯一记录。节点被前端 stale 整图 autosave 冲掉后，
// 驱动器按画布反查判 absent → 盲再提交——第一条任务还在上游跑，第二条又交上去＝双倍扣费、
// 先完成的一条成孤儿（succeeded 但没人用）。
//
// 根治：PostgreSQL Effect Ledger 在供应商调用前持久化稳定 effectId，并把 accepted/uncertain 的
// providerTaskId 作为唯一在飞身份。驱动器遇到 absent 先查账本，命中即重建占位节点交回 reconcile；
// 账本查询或写入失败必须显式失败，不允许 Redis、进程内 Map 或 TTL 回退开启第二条付费提交路径。

import { findLatestProductionEffect } from "./production-effect-ledger";
import {
  acquireProductionRunLease,
  PRODUCTION_RUN_LEASE_RENEW_INTERVAL_MS,
  releaseProductionRunLease,
  renewProductionRunLease,
} from "./production-run-lease";

/**
 * 查询 clip 的持久副作用身份。PostgreSQL Effect Ledger 是唯一真相源；
 * 画布节点、进程内 Map 与 Redis TTL 都不再承担供应商幂等身份。
 */
export async function getClipInflightTask(
  runId: string,
  clipIndex: number,
): Promise<string | null> {
  const rid = String(runId ?? "").trim();
  if (!rid || !Number.isInteger(clipIndex) || clipIndex < 0) return null;
  const effect = await findLatestProductionEffect({
    runId: rid,
    effectKey: `video-clip:${clipIndex}`,
  });
  if (!effect?.providerTaskId) return null;
  return effect.status === "accepted" || effect.status === "uncertain"
    ? effect.providerTaskId
    : null;
}

// PostgreSQL lease is the sole cross-process drive authority. A database error
// propagates explicitly; no Redis/process-memory fallback may permit duplicate billing.
export const DRIVE_LOCK_RENEW_INTERVAL_MS = PRODUCTION_RUN_LEASE_RENEW_INTERVAL_MS;

export async function acquireRunDriveLock(
  runId: string,
): Promise<string | null> {
  const rid = String(runId ?? "").trim();
  if (!rid) return null;
  return acquireProductionRunLease(rid);
}

/**
 * 通过 PostgreSQL server-time CAS 延长当前持有者的驱动 lease。token 已失效或已被新持有者
 * 替换时返回 false，绝不续错锁；数据库错误原样上抛，不存在跨进程互斥回退。
 */
export async function renewRunDriveLock(
  runId: string,
  token: string,
): Promise<boolean> {
  const rid = String(runId ?? "").trim();
  if (!rid || !token) return false;
  return renewProductionRunLease(rid, token);
}

/** 释放驱动锁（仅持有者本人；token 不符不动——防误删他人新锁）。best-effort。 */
export async function releaseRunDriveLock(runId: string, token: string): Promise<void> {
  const rid = String(runId ?? "").trim();
  if (!rid || !token) return;
  await releaseProductionRunLease(rid, token);
}
