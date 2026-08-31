// 【filmBible/adaptationStrategy 双层存取（2026-07-04 小说→分镜改造 3.4/3.5）】
//
// 病根：filmBible 曾只缓存在进程内 Map（现 video-orchestrator.execution.ts），api 重启即静默丢失——后续批次
// 渲染时导演基调/影调圣经整段缺失且不报错（评测探索代理实证）。
//
// 根治：随 run 持久化到 video_runs.film_bible / adaptation_strategy（JSON 文本），进程内 Map 降级为
// **读缓存**：读取先查 Map，miss 再查库回填；库里也没有 → 返回 null，由渲染层注入显式告警文本
// filmBible 仅供 writer 规划；最终视频 prompt 不再复制整章 Bible。
// 写路径：首批 add_clips 带 filmBible/adaptationStrategy 时即落库（run 行未建则建 collecting 占位行，
// 见 video-run.repo.ts upsertVideoRunNarrativeMeta）；start 时 insertVideoRun 再兜底落一次。

import type { FilmBible } from "./video-orchestrator.clip-shots";
import {
  getVideoRun,
  upsertVideoRunNarrativeMeta,
  type VideoRunRow,
} from "./video-run.repo";

const MAX_ENTRIES = 200;

const filmBibleByRun = new Map<string, FilmBible>();
const adaptationStrategyByRun = new Map<string, string>();

function lruSet<T>(map: Map<string, T>, key: string, value: T): void {
  map.set(key, value);
  if (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** 写读缓存（进程内）。 */
export function cacheFilmBible(runId: string, bible: FilmBible): void {
  const id = String(runId ?? "").trim();
  if (!id) return;
  lruSet(filmBibleByRun, id, bible);
}

/** 只读进程内缓存（不触库）：start 时把内存里的圣经序列化随 insertVideoRun 兜底落库用。 */
export function peekFilmBible(runId: string): FilmBible | null {
  return filmBibleByRun.get(String(runId ?? "").trim()) ?? null;
}

export function cacheAdaptationStrategyText(runId: string, text: string): void {
  const id = String(runId ?? "").trim();
  if (!id || !text.trim()) return;
  lruSet(adaptationStrategyByRun, id, text);
}

export function peekAdaptationStrategyText(runId: string): string | null {
  return adaptationStrategyByRun.get(String(runId ?? "").trim()) ?? null;
}

function parseFilmBibleText(raw: string | null | undefined): FilmBible | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FilmBible;
    }
  } catch {
    // 坏 JSON 当无（渲染层会显式告警）
  }
  return null;
}

/**
 * 读 filmBible：进程内 Map（读缓存）→ miss 查 video_runs.film_bible 回填 → 都没有返回 null。
 * @param row 调用方已读到的 run 行（如 add_clips 的脏 runId 检查已 getVideoRun 过）——传入省一次查库。
 */
export async function loadFilmBibleDurable(
  runId: string,
  row?: VideoRunRow | null,
): Promise<FilmBible | null> {
  const id = String(runId ?? "").trim();
  if (!id) return null;
  const mem = filmBibleByRun.get(id);
  if (mem) return mem;
  try {
    const runRow = row !== undefined ? row : await getVideoRun(id);
    const parsed = parseFilmBibleText(runRow?.film_bible);
    if (parsed) {
      lruSet(filmBibleByRun, id, parsed);
      return parsed;
    }
  } catch {
    // 查库失败当 miss（渲染层显式告警，不静默）
  }
  return null;
}

/** 读 adaptationStrategy JSON 文本：Map → 库回填 → null。critic 第21维审读用。 */
export async function loadAdaptationStrategyTextDurable(
  runId: string,
  row?: VideoRunRow | null,
): Promise<string | null> {
  const id = String(runId ?? "").trim();
  if (!id) return null;
  const mem = adaptationStrategyByRun.get(id);
  if (mem) return mem;
  try {
    const runRow = row !== undefined ? row : await getVideoRun(id);
    const text = String(runRow?.adaptation_strategy ?? "").trim();
    if (text) {
      lruSet(adaptationStrategyByRun, id, text);
      return text;
    }
  } catch {
    // 查库失败当 miss
  }
  return null;
}

/** 落库（best-effort·绝不抛，落不下去退化为进程内缓存并留日志）。 */
export async function persistRunNarrativeMeta(input: {
  runId: string;
  ownerId?: string | null;
  filmBibleText?: string | null;
  adaptationStrategyText?: string | null;
}): Promise<boolean> {
  try {
    return await upsertVideoRunNarrativeMeta({
      runId: input.runId,
      ownerId: input.ownerId ?? null,
      filmBible: input.filmBibleText ?? null,
      adaptationStrategy: input.adaptationStrategyText ?? null,
      nowIso: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(
      `[film-bible-store] runId=${input.runId} 叙事元数据落库失败（退化进程内缓存·api 重启会丢）: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/** 仅测试用：清空进程内读缓存，模拟 api 重启。 */
export function __clearNarrativeMetaCacheForTest(): void {
  filmBibleByRun.clear();
  adaptationStrategyByRun.clear();
}
