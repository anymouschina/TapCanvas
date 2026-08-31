// 【增量分段累积·根治「一次吐整章 storyPlan」巨输出（2026-07-03 用户「拆分任务去输出」）】
//
// 病根：小T 把整章 N 段完整八段镜头表塞进一次 orchestrate(estimate) 调用的参数里，输出必然巨大
// （ch3《说谎》实测 opus 一次生成 6万 token storyPlan → 慢到 7min/次 / 撑爆内存 OOM / 跳过建资产直冲出片）。
//
// 根治：让小T 把分段**分小批**提交——mode:"add_clips" 每次只发 1-4 段（输出小），服务端按 runId 累积；
// 最后 mode:"estimate" 只回传 runId（不重发 clips），服务端用累积的分段拼成完整 storyPlan。每步输出小 →
// 不截断、不 OOM、可中途建资产、可观测。redis + 内存双写，TTL 与 estimate-cache 同 30min，跨重启不丢。

import { getSharedRedis } from "../../platform/redis-shared";

// TTL 30min → 24h（2026-07-05 ch1 实测：整章管线常跑 1-2h+、跨天「继续」续跑必超 30min →
// 累积的整章镜头表（最贵的 LLM 产出）静默蒸发、estimate 报 empty_clips。24h 覆盖隔夜续跑；
// 真正的跨重启持久层在 video_runs.story_plan（async.ts 每批落库 + estimate miss 回填）。
const ACCUM_TTL_MS = 24 * 60 * 60 * 1000;
const ACCUM_TTL_SEC = 24 * 60 * 60;
const MAX_ENTRIES = 300;
const MAX_CLIPS_PER_RUN = 60; // 单章分段硬上限（防失控累积）
const REDIS_KEY_PREFIX = "clipaccum:";

type AccumEntry = { clips: unknown[]; expiresAt: number };
const store = new Map<string, AccumEntry>();

function prune(now: number): void {
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
}

export type AppendResult = { total: number; added: number; truncated: boolean };

/**
 * 追加一批分段到 runId 的累积区（同步内存 + 尽力 redis）。
 * `reset:true` 先清空该 runId 再追加（小T 重新分批/修订时首批用，防旧批残留污染·OCR#3）。
 * 返回 {total 累积后总段数, added 实际被接受的段数, truncated 是否因超 MAX 丢尾(OCR#1)}。
 */
/** redis 权威读基底（2026-07-14 ch27 根治）：redis 可用时以它为准（key 缺失=权威空）；不可用才退内存。 */
async function loadBaseClips(id: string, now: number): Promise<{ clips: unknown[]; fromRedis: boolean }> {
  try {
    const redis = getSharedRedis();
    if (redis) {
      const raw = await redis.get(`${REDIS_KEY_PREFIX}${id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return { clips: parsed, fromRedis: true };
      }
      return { clips: [], fromRedis: true };
    }
  } catch {
    /* redis 异常 → 内存降级 */
  }
  const e = store.get(id);
  return { clips: e && e.expiresAt > now ? e.clips : [], fromRedis: false };
}

export async function appendAccumulatedClips(
  runId: string,
  clips: unknown[],
  now: number = Date.now(),
  reset = false,
): Promise<AppendResult> {
  const id = String(runId ?? "").trim();
  if (!id || !Array.isArray(clips) || clips.length === 0) {
    const base = await loadBaseClips(id, now);
    return { total: base.clips.length, added: 0, truncated: false };
  }
  prune(now);
  if (reset) {
    store.delete(id);
    try {
      const redis = getSharedRedis();
      if (redis) await redis.del(`${REDIS_KEY_PREFIX}${id}`);
    } catch {
      // ignore
    }
  }
  // 【跨进程互踩根治·2026-07-14 ch27 实证】基底必须取 redis 权威——旧实现以本进程内存为基底
  // 整包 SET 覆盖 redis：api/worker 轮流回灌时，后写进程用局部视图把对方灌的批清出 redis
  //（ch27-v1 缺镜 [0,1,2,3] → estimate clips_incomplete → run 报废 → 小T 手工重做 40min）。
  // 写路径 driver 有 run 级驱动锁串行化，残余 RMW 竞态窗口可接受。
  const base = reset ? { clips: [] as unknown[], fromRedis: true } : await loadBaseClips(id, now);
  const beforeLen = base.clips.length;
  const merged = [...base.clips, ...clips];
  const capped = merged.slice(0, MAX_CLIPS_PER_RUN);
  const truncated = merged.length > capped.length;
  if (truncated) {
    console.warn(
      `[clip-accumulator] runId=${id} 累积超上限 ${MAX_CLIPS_PER_RUN}，丢尾 ${merged.length - capped.length} 段（本批部分未纳入）。`,
    );
  }
  store.set(id, { clips: capped, expiresAt: now + ACCUM_TTL_MS });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  try {
    const redis = getSharedRedis();
    if (redis) {
      // 必须 await：紧随其后的 loadAccumulatedClips（midWriteLint/estimate）要立即看到本批。
      await redis.set(`${REDIS_KEY_PREFIX}${id}`, JSON.stringify(capped), "EX", ACCUM_TTL_SEC);
    }
  } catch {
    // 内存已记，降级可接受
  }
  return { total: capped.length, added: capped.length - beforeLen, truncated };
}

/** 取回 runId 的累积分段（内存快路径→redis 持久层回落）。无返回 []。 */
export async function loadAccumulatedClips(
  runId: string,
  now: number = Date.now(),
): Promise<unknown[]> {
  const id = String(runId ?? "").trim();
  if (!id) return [];
  // 【redis 权威读·2026-07-14 ch27 根治】旧实现内存命中即返回——api/worker 各自内存只有
  // 自己回灌过的批，跨进程读到局部视图。现 redis 可用时恒以 redis 为准，内存仅作降级缓存。
  const base = await loadBaseClips(id, now);
  if (base.fromRedis) {
    store.set(id, { clips: base.clips, expiresAt: now + ACCUM_TTL_MS });
  }
  // OCR#2：返回浅拷贝，隔离内部 store——下游对数组或元素 mutation 不污染累积区。
  return base.clips.slice();
}

/**
 * 用一份已验证的权威 clips 精确覆盖整个累积区。
 * v2 authoring 只在冻结工件完成双哈希校验后调用；它不是追加或局部修订语义。
 */
export async function replaceAccumulatedClips(
  runId: string,
  clips: readonly unknown[],
  now: number = Date.now(),
): Promise<{ total: number }> {
  const id = String(runId ?? "").trim();
  if (!id) throw new Error("replace_accumulated_clips_run_id_required");
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error("replace_accumulated_clips_non_empty_array_required");
  }
  if (clips.length > MAX_CLIPS_PER_RUN) {
    throw new Error(`replace_accumulated_clips_limit_exceeded:${clips.length}`);
  }

  const serialized = JSON.stringify(clips);
  const normalized = JSON.parse(serialized) as unknown;
  if (!Array.isArray(normalized) || normalized.length !== clips.length) {
    throw new Error("replace_accumulated_clips_serialization_invalid");
  }

  prune(now);
  store.set(id, { clips: normalized, expiresAt: now + ACCUM_TTL_MS });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }

  try {
    const redis = getSharedRedis();
    if (redis) {
      await redis.set(`${REDIS_KEY_PREFIX}${id}`, serialized, "EX", ACCUM_TTL_SEC);
    }
  } catch {
    // 内存已完成权威替换；Redis 是跨副本加速层，故障不得反向否决本次业务写入。
  }
  return { total: normalized.length };
}

/**
 * 【单段外科替换·质检左移配套（2026-07-04）】按全局镜号(0-based)原位替换一段，其余段不动。
 * 病根：以前修一个错字只能整批 reset 重发（ch3 实测 21 段灌 4 遍）。lint 在 add_clips 当场报
 * 「镜N 有问题」后，小T 用 replaceAtIndex 只重发那一段。索引越界/累积区为空返回 ok:false。
 */
export async function replaceAccumulatedClip(
  runId: string,
  index: number,
  clip: unknown,
  now: number = Date.now(),
): Promise<{ ok: boolean; total: number; message?: string }> {
  const id = String(runId ?? "").trim();
  if (!id || !Number.isInteger(index) || index < 0 || clip == null) {
    return { ok: false, total: 0, message: "replaceAtIndex 需要合法的 runId/index(0-based)/单段 clip。" };
  }
  const clips = await loadAccumulatedClips(id, now);
  if (!clips.length) {
    return { ok: false, total: 0, message: "该 runId 累积区为空（已过期/被 start 清空）——请重新 add_clips 分批提交。" };
  }
  if (index >= clips.length) {
    return {
      ok: false,
      total: clips.length,
      message:
        `replaceAtIndex=${index} 越界（当前累积 ${clips.length} 段，合法 0~${clips.length - 1}）。` +
        (index === clips.length
          ? ` 该段是缺失的新槽位：保留 clips[0].clipIndex=${index}，重新调用 add_clips 时不要传 replaceAtIndex、不要 reset。`
          : " replaceAtIndex 只允许修改已存在的槽位；补缺失槽位时不要传 replaceAtIndex。"),
    };
  }
  clips[index] = clip;
  store.set(id, { clips, expiresAt: now + ACCUM_TTL_MS });
  try {
    const redis = getSharedRedis();
    if (redis) {
      await redis.set(`${REDIS_KEY_PREFIX}${id}`, JSON.stringify(clips), "EX", ACCUM_TTL_SEC);
    }
  } catch {
    // ignore
  }
  return { ok: true, total: clips.length };
}

/**
 * 【显式 clipIndex 乱序累积·并发扩写前提（2026-07-04 用户拍板 map-reduce）】
 * 每段带全局 clipIndex(0-based) → 按位放置（稀疏数组，洞=null），批次乱序到达也各归其位。
 * 配套：estimate 前用 findAccumulatedHoles 做齐全性校验，有洞拒绝拼装。
 */
export async function placeAccumulatedClipsAt(
  runId: string,
  entries: Array<{ clipIndex: number; clip: unknown }>,
  now: number = Date.now(),
): Promise<AppendResult & { holes: number[] }> {
  const id = String(runId ?? "").trim();
  if (!id || !entries.length) return { total: 0, added: 0, truncated: false, holes: [] };
  prune(now);
  // 【跨进程互踩根治·2026-07-14 ch27-v1 被踩现场】按镜号回灌是状态机主路径——基底取 redis
  // 权威（旧实现取本进程内存：api/worker 轮流回灌时后写者用局部视图整包覆盖 redis，
  // 缺镜 [0,1,2,3] 实证）。
  const base = await loadBaseClips(id, now);
  const clips: unknown[] = base.clips.slice();
  const beforeFilled = clips.filter((c) => c != null).length;
  let truncated = false;
  for (const { clipIndex, clip } of entries) {
    if (!Number.isInteger(clipIndex) || clipIndex < 0) continue;
    if (clipIndex >= MAX_CLIPS_PER_RUN) {
      truncated = true;
      continue;
    }
    while (clips.length <= clipIndex) clips.push(null);
    clips[clipIndex] = clip;
  }
  store.set(id, { clips, expiresAt: now + ACCUM_TTL_MS });
  try {
    const redis = getSharedRedis();
    if (redis) {
      await redis.set(`${REDIS_KEY_PREFIX}${id}`, JSON.stringify(clips), "EX", ACCUM_TTL_SEC);
    }
  } catch {
    // ignore
  }
  const afterFilled = clips.filter((c) => c != null).length;
  return {
    total: afterFilled,
    added: afterFilled - beforeFilled,
    truncated,
    holes: findHoles(clips),
  };
}

function findHoles(clips: unknown[]): number[] {
  const holes: number[] = [];
  clips.forEach((c, i) => {
    if (c == null) holes.push(i);
  });
  return holes;
}

/** 齐全性校验：返回累积区中的空洞下标（乱序按位提交后 estimate 前必查，有洞禁拼装）。 */
export async function findAccumulatedHoles(runId: string): Promise<number[]> {
  return findHoles(await loadAccumulatedClips(runId));
}

/** 清空累积（estimate/start 成功后可清；重跑 runId 复用前也清）。 */
/**
 * 【落库回填·跨重启/超 TTL 兜底】把从 video_runs.story_plan 读回的分段重新灌入内存+redis，
 * 使后续 replaceAtIndex/estimate 走正常快路径。不做追加语义，整体覆盖。
 */
export function hydrateAccumulatedClips(
  runId: string,
  clips: unknown[],
  now: number = Date.now(),
): void {
  const id = String(runId ?? "").trim();
  if (!id || !Array.isArray(clips) || clips.length === 0) return;
  const capped = clips.slice(0, MAX_CLIPS_PER_RUN);
  store.set(id, { clips: capped, expiresAt: now + ACCUM_TTL_MS });
  try {
    const redis = getSharedRedis();
    if (redis) {
      void redis
        .set(`${REDIS_KEY_PREFIX}${id}`, JSON.stringify(capped), "EX", ACCUM_TTL_SEC)
        .catch(() => {});
    }
  } catch {
    // ignore
  }
}

export function clearAccumulatedClips(runId: string): void {
  const id = String(runId ?? "").trim();
  if (!id) return;
  store.delete(id);
  try {
    const redis = getSharedRedis();
    if (redis) void redis.del(`${REDIS_KEY_PREFIX}${id}`).catch(() => {});
  } catch {
    // ignore
  }
}

/** 测试辅助：清空全部累积。 */
export function __clearAllAccumulatedClips(): void {
  store.clear();
}
