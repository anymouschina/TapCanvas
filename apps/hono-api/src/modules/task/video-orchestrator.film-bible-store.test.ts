import { beforeEach, describe, expect, it, vi } from "vitest";

const getVideoRunMock = vi.fn();
const upsertNarrativeMock = vi.fn();

vi.mock("./video-run.repo", () => ({
  getVideoRun: (...args: unknown[]) => getVideoRunMock(...args),
  upsertVideoRunNarrativeMeta: (...args: unknown[]) => upsertNarrativeMock(...args),
}));

import {
  __clearNarrativeMetaCacheForTest,
  cacheAdaptationStrategyText,
  cacheFilmBible,
  loadAdaptationStrategyTextDurable,
  loadFilmBibleDurable,
  peekAdaptationStrategyText,
  peekFilmBible,
  persistRunNarrativeMeta,
} from "./video-orchestrator.film-bible-store";

const rowWith = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  state: "collecting",
  story_plan: null,
  film_bible: null,
  adaptation_strategy: null,
  ...over,
});

beforeEach(() => {
  __clearNarrativeMetaCacheForTest();
  getVideoRunMock.mockReset();
  upsertNarrativeMock.mockReset();
});

describe("filmBible 双层存取（进程读缓存 → video_runs 列回填）", () => {
  it("进程内缓存命中不触库", async () => {
    cacheFilmBible("run-1", { directorTone: "密室惊悚" });
    const bible = await loadFilmBibleDurable("run-1");
    expect(bible?.directorTone).toBe("密室惊悚");
    expect(getVideoRunMock).not.toHaveBeenCalled();
  });

  it("api 重启（缓存清空）后从 video_runs.film_bible 回填可读——落库根治静默丢失", async () => {
    // 模拟重启前落过库
    getVideoRunMock.mockResolvedValue(
      rowWith({ film_bible: JSON.stringify({ directorTone: "画皮夜戏", visualBible: "烛火低照度" }) }),
    );
    // 重启 = 进程缓存空（beforeEach 已清）
    const bible = await loadFilmBibleDurable("run-1");
    expect(bible?.directorTone).toBe("画皮夜戏");
    expect(bible?.visualBible).toBe("烛火低照度");
    // 回填后二读走缓存，不再触库
    getVideoRunMock.mockClear();
    const again = await loadFilmBibleDurable("run-1");
    expect(again?.directorTone).toBe("画皮夜戏");
    expect(getVideoRunMock).not.toHaveBeenCalled();
  });

  it("库里也没有 → null（由渲染层注入显式告警，不静默）", async () => {
    getVideoRunMock.mockResolvedValue(null);
    expect(await loadFilmBibleDurable("run-x")).toBeNull();
  });

  it("坏 JSON 当 miss，不抛", async () => {
    getVideoRunMock.mockResolvedValue(rowWith({ film_bible: "{broken" }));
    expect(await loadFilmBibleDurable("run-1")).toBeNull();
  });

  it("调用方已读到 run 行时传入 row，省一次查库", async () => {
    const row = rowWith({ film_bible: JSON.stringify({ hardRules: "无BGM" }) });
    const bible = await loadFilmBibleDurable("run-1", row as never);
    expect(bible?.hardRules).toBe("无BGM");
    expect(getVideoRunMock).not.toHaveBeenCalled();
  });
});

describe("adaptationStrategy 文本双层存取", () => {
  it("缓存命中 → 直接返回；miss → 库回填", async () => {
    cacheAdaptationStrategyText("run-1", '{"hook":"门后传来第二次剥皮声"}');
    expect(await loadAdaptationStrategyTextDurable("run-1")).toContain("剥皮声");

    __clearNarrativeMetaCacheForTest();
    getVideoRunMock.mockResolvedValue(
      rowWith({ adaptation_strategy: '{"cuts":[{"what":"县衙升堂戏","why":"信息冗余"}]}' }),
    );
    const text = await loadAdaptationStrategyTextDurable("run-1");
    expect(text).toContain("县衙升堂戏");
    expect(peekAdaptationStrategyText("run-1")).toBe(text); // 已回填读缓存
  });

  it("都没有 → null（触发响应软告警）", async () => {
    getVideoRunMock.mockResolvedValue(rowWith());
    expect(await loadAdaptationStrategyTextDurable("run-1")).toBeNull();
  });
});

describe("persistRunNarrativeMeta（best-effort 落库）", () => {
  it("透传 upsertVideoRunNarrativeMeta，成功返回 true", async () => {
    upsertNarrativeMock.mockResolvedValue(true);
    const ok = await persistRunNarrativeMeta({
      runId: "run-1",
      ownerId: "user-1",
      filmBibleText: '{"directorTone":"x"}',
    });
    expect(ok).toBe(true);
    expect(upsertNarrativeMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", ownerId: "user-1", filmBible: '{"directorTone":"x"}' }),
    );
  });

  it("落库抛错不外泄（退化进程内缓存），返回 false", async () => {
    upsertNarrativeMock.mockRejectedValue(new Error("db down"));
    const ok = await persistRunNarrativeMeta({ runId: "run-1", filmBibleText: "{}" });
    expect(ok).toBe(false);
  });
});

describe("peekFilmBible（start 兜底落库用·只读缓存）", () => {
  it("只看进程内，不触库", () => {
    expect(peekFilmBible("run-nope")).toBeNull();
    cacheFilmBible("run-1", { directorTone: "y" });
    expect(peekFilmBible("run-1")?.directorTone).toBe("y");
    expect(getVideoRunMock).not.toHaveBeenCalled();
  });
});
