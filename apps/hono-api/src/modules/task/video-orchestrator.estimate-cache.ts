// 【estimate 计划缓存·根治 start 重发巨型 storyPlan 截断 livelock（2026-06-30 用户拍板·让 AI 自闭环不阻塞）】
//
// 病根：N 段叙事整片的 storyPlan（每段几千字 clipPrompt × N）极大；start 被某道软门退回/或模型输出截断时，
// 小T 必须把整坨 storyPlan 重吐一遍 → 又慢又常被模型 max_tokens 截断成「不是合法 JSON」→ 反复重试落不了地
// （实测 ch1《买活》11 段 ~15K 字符，video_runs 始终为空＝start 从没成功）。
//
// 根治：estimate 时服务端把已校验的 storyPlan 按 runId 缓存 30 分钟；start 只回传 runId 时，
// 服务端复用同一冻结计划。start 载荷收缩到几十字节 → 不再截断 → 一次落地、自闭环。
// 缓存丢失（api 重启/多实例 cache miss）时，调用方仍可显式重发完整 storyPlan。
//
// 为何不写 video_runs：estimate 只是内部核算，不能提前制造“生产已起跑”的持久事实。故使用独立计划缓存，
// 绝不碰 video_runs 的执行状态；只有 start 在权限、余额、幂等与真实资产边界通过后才创建生产事实。

// 【2026-07-03 根治 estimate→start 跨 api 重启断链】纯内存缓存在 api 重启（部署）时清空 →
// 用户 estimate 后若赶上一次部署，start 撞 cache_miss，且小T 上下文压缩常已丢失 storyPlan 全文无法重发 →
// 整片卡死起不来（实测 ch3《说谎》：质检已过、estimate v3 已确认，却因我中途重启 api 清了缓存而 start 失败）。
// 加 redis 持久层（TTL 原生·跨重启不丢·多副本共享），**不碰 video_runs**（保持"estimate 不建行、drive 付费闸不被绕"
// 的安全不变量·见下方原注）。redis 不可用（测试/无 redis 本地）时优雅退化为纯内存（旧行为，单测零变）。
import { getSharedRedis } from "../../platform/redis-shared";

const ESTIMATE_PLAN_TTL_MS = 30 * 60 * 1000;
const ESTIMATE_PLAN_TTL_SEC = 30 * 60;
const MAX_ENTRIES = 500;
const REDIS_KEY_PREFIX = "estplan:";

type CacheEntry = { plan: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function pruneExpired(now: number): void {
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

/** estimate 阶段缓存本次已校验的 storyPlan（按 runId）。可单测：注入 now。同步写内存 + 尽力写 redis 持久层。 */
export function cacheEstimatePlan(runId: string, plan: unknown, now: number = Date.now()): void {
  const id = String(runId ?? "").trim();
  if (!id || plan == null) return;
  pruneExpired(now);
  cache.set(id, { plan, expiresAt: now + ESTIMATE_PLAN_TTL_MS });
  // 防内存膨胀：超上限删最旧（Map 保持插入序）。
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  // 持久层（best-effort·fire-and-forget）：redis 存一份，跨 api 重启/部署不丢。redis 不可用则仅内存。
  try {
    const redis = getSharedRedis();
    if (redis) {
      void redis
        .set(`${REDIS_KEY_PREFIX}${id}`, JSON.stringify(plan), "EX", ESTIMATE_PLAN_TTL_SEC)
        .catch(() => {});
    }
  } catch {
    // ignore
  }
}

/** start 阶段按 runId 取回 estimate 缓存的 storyPlan；无/过期返回 null。 */
export function loadEstimatePlan(runId: string, now: number = Date.now()): unknown | null {
  const id = String(runId ?? "").trim();
  if (!id) return null;
  const entry = cache.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(id);
    return null;
  }
  return entry.plan;
}

/**
 * 持久版取回（start 用）：先命中内存快路径；miss（api 重启清了内存）时回落 redis 持久层。
 * redis 命中即回填内存 + 返回。都 miss 返回 null（小T 仍可重发 storyPlan·旧行为）。
 */
export async function loadEstimatePlanDurable(
  runId: string,
  now: number = Date.now(),
): Promise<unknown | null> {
  const inMemory = loadEstimatePlan(runId, now);
  if (inMemory != null) return inMemory;
  const id = String(runId ?? "").trim();
  if (!id) return null;
  try {
    const redis = getSharedRedis();
    if (!redis) return null;
    const raw = await redis.get(`${REDIS_KEY_PREFIX}${id}`);
    if (!raw) return null;
    const plan = JSON.parse(raw);
    // 回填内存快路径（TTL 用剩余的近似值即可，取满 TTL 简单安全）。
    cache.set(id, { plan, expiresAt: now + ESTIMATE_PLAN_TTL_MS });
    return plan;
  } catch {
    return null;
  }
}

/** 测试辅助：清空缓存。 */
export function __clearEstimatePlanCache(): void {
  cache.clear();
}
