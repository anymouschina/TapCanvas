import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";

// --- Mocks -----------------------------------------------------------------
// Object storage: always "configured".
const sendMock = vi.fn().mockResolvedValue({});
vi.mock("../asset/rustfs.client", () => ({
  resolveObjectStorageConfig: () => ({ bucket: "test-bucket", publicBase: "https://cdn.test" }),
  createObjectStorageClientFromConfig: () => ({ send: sendMock }),
}));

// child_process.execFile — only ffprobe is invoked by decompose itself (download +
// scene detect + frame extract + analyze are all mocked below). Returns json meta.
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, _args: unknown, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    if (cmd === "ffprobe") {
      callback(
        null,
        JSON.stringify({
          streams: [{ width: 1920, height: 1080, r_frame_rate: "24/1" }],
          format: { duration: "18.0" },
        }),
        "",
      );
      return;
    }
    callback(null, "", "");
  },
}));

// fs/promises — no real disk IO.
vi.mock("node:fs/promises", () => ({
  mkdtemp: async () => "/tmp/decompose-test",
  writeFile: async () => undefined,
  rm: async () => undefined,
}));

// scene-detect — returns two scenes by default; overridable per test.
const detectScenesMock = vi.fn();
vi.mock("./scene-detect", () => ({
  detectScenes: (...args: unknown[]) => detectScenesMock(...args),
}));

// extract-frames-at — echoes one frame per requested timestamp.
const extractFramesMock = vi.fn();
vi.mock("./agents-tool-bridge.extract-frames-at", () => ({
  extractFramesAtForAgent: (...args: unknown[]) => extractFramesMock(...args),
}));

// analyze-image — returns the 9-dim caption as strict JSON.
const analyzeImageMock = vi.fn();
vi.mock("./agents-tool-bridge.analyze-image", () => ({
  analyzeImageForAgent: (...args: unknown[]) => analyzeImageMock(...args),
}));

// stream-download — the byte-streaming download helper is unit-tested on its own
// (stream-download.test.ts); stub it so decompose logic runs without real IO.
const streamDownloadMock = vi.fn();
vi.mock("../asset/stream-download", () => ({
  streamDownloadToFile: (...args: unknown[]) => streamDownloadMock(...args),
}));

import { decomposeVideoForAgent } from "./agents-tool-bridge.decompose-video";

function makeRow(nodes: Array<Record<string, unknown>>): FlowRow {
  return {
    id: "flow-1",
    name: "Flow",
    data: JSON.stringify({ nodes, edges: [] }),
    owner_id: "user-1",
    project_id: "project-1",
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
  } as unknown as FlowRow;
}

const SOURCE = "https://example.invalid/source.mp4";

const CAPTION_JSON = JSON.stringify({
  shotSize: "中近景",
  cameraAngle: "平视",
  cameraMove: "缓推",
  focalLength: "35mm",
  subject: "白衬衫短发女性",
  action: "抬手喝咖啡",
  sceneEnv: "靠窗咖啡馆",
  lighting: "右前硬光 暖色",
  composition: "三分法 主体居右",
});

beforeEach(() => {
  sendMock.mockClear();
  detectScenesMock.mockReset();
  extractFramesMock.mockReset();
  analyzeImageMock.mockReset();
  streamDownloadMock.mockClear();
  streamDownloadMock.mockResolvedValue(undefined);

  detectScenesMock.mockResolvedValue([
    { index: 0, startSec: 0, endSec: 5.2, durationSec: 5.2, boundarySource: "scene-detect" },
    { index: 1, startSec: 5.2, endSec: 18.0, durationSec: 12.8, boundarySource: "scene-detect" },
  ]);

  // Echo one frame per requested timestamp (urls deterministic by time).
  extractFramesMock.mockImplementation(
    async (arg: { bodyArgs: { times: number[] } }) => ({
      ok: true as const,
      frames: arg.bodyArgs.times.map((t) => ({
        time: t,
        url: `https://cdn.test/gen/images/framesat/x_t${t}.webp`,
        width: 1920,
        height: 1080,
      })),
    }),
  );

  analyzeImageMock.mockResolvedValue({ ok: true, text: CAPTION_JSON, imageUrl: "x" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("decomposeVideoForAgent assembly", () => {
  it("assembles a ShotTable with probed meta, per-shot keyframes and 9-dim captions", async () => {
    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE },
    });

    expect(result.ok).toBe(true);
    const t = result.shotTable;
    expect(t.version).toBe(1);
    expect(t.sourceVideoUrl).toBe(SOURCE);
    expect(t.totalDurationSec).toBe(18.0);
    expect(t.aspectRatio).toBe("16:9");
    expect(t.fps).toBe(24);
    expect(t.mode).toBe("exact");
    expect(t.detectMethod).toBe("scenedetect");
    expect(t.shotCount).toBe(2);
    expect(t.cuts).toHaveLength(2);

    const cut0 = t.cuts[0]!;
    expect(cut0.index).toBe(0);
    expect(cut0.startSec).toBe(0);
    expect(cut0.endSec).toBe(5.2);
    expect(cut0.durationSec).toBe(5.2);
    expect(cut0.boundarySource).toBe("scene-detect");
    expect(cut0.replicateMode).toBe("exact");
    // in / mid / out keyframes
    expect(cut0.keyFrames.map((k) => k.role)).toEqual(["in", "mid", "out"]);
    expect(cut0.keyFrames.every((k) => k.url.endsWith(".webp"))).toBe(true);
    // 9-dim caption parsed from JSON
    expect(cut0.caption.shotSize).toBe("中近景");
    expect(cut0.caption.cameraMove).toBe("缓推");
    expect(cut0.caption.composition).toBe("三分法 主体居右");
    expect(cut0.captionRaw).toBeUndefined();

    // one extract + one analyze per shot
    expect(extractFramesMock).toHaveBeenCalledTimes(2);
    expect(analyzeImageMock).toHaveBeenCalledTimes(2);
  });

  it("samples in/mid/out timestamps with out pulled before the boundary", async () => {
    detectScenesMock.mockResolvedValue([
      { index: 0, startSec: 0, endSec: 4, durationSec: 4, boundarySource: "scene-detect" },
    ]);
    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE },
    });
    // requested times: in=0, mid=2, out=3.9
    const times = (extractFramesMock.mock.calls[0]![0] as { bodyArgs: { times: number[] } })
      .bodyArgs.times;
    expect(times).toEqual([0, 2, 3.9]);
    expect(result.shotTable.cuts[0]!.keyFrames.map((k) => k.timeSec)).toEqual([0, 2, 3.9]);
  });
});

describe("decomposeVideoForAgent mode passthrough", () => {
  it("propagates mode=swap to the table and every cut", async () => {
    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE, mode: "swap" },
    });
    expect(result.shotTable.mode).toBe("swap");
    expect(result.shotTable.cuts.every((c) => c.replicateMode === "swap")).toBe(true);
  });

  it("defaults unknown mode to exact", async () => {
    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE, mode: "garbage" },
    });
    expect(result.shotTable.mode).toBe("exact");
  });
});

describe("decomposeVideoForAgent video resolution", () => {
  it("resolves the source url from a flow node when only nodeId is given", async () => {
    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([{ id: "n1", type: "taskNode", data: { kind: "video", videoUrl: SOURCE } }]),
      bodyArgs: { nodeId: "n1" },
    });
    expect(result.shotTable.sourceVideoUrl).toBe(SOURCE);
  });

  it("throws missing-video when neither sourceUrl nor a resolvable node is given", async () => {
    const err = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_decompose_video_missing_video");
  });
});

describe("decomposeVideoForAgent empty-split degradation", () => {
  it("emits a single full-clip cut when scene detection returns nothing", async () => {
    detectScenesMock.mockResolvedValue([]);
    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE },
    });
    expect(result.shotTable.cuts).toHaveLength(1);
    const cut = result.shotTable.cuts[0]!;
    expect(cut.startSec).toBe(0);
    expect(cut.endSec).toBe(18.0);
    expect(cut.boundarySource).toBe("fallback-window");
    expect(result.shotTable.detectMethod).toBe("fixed-window-fallback");
  });
});

describe("decomposeVideoForAgent resilience", () => {
  it("keeps the cut with an empty caption when analyze_image fails for a shot", async () => {
    analyzeImageMock.mockRejectedValue(new Error("vision down"));
    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE },
    });
    expect(result.shotTable.cuts).toHaveLength(2);
    const cut0 = result.shotTable.cuts[0]!;
    expect(cut0.keyFrames.length).toBe(3); // frames still extracted
    expect(cut0.caption.shotSize).toBe(""); // caption empty
    expect(cut0.captionRaw).toContain("analyze_image failed");
  });

  it("wraps download/probe failures as a 502 decompose AppError", async () => {
    streamDownloadMock.mockRejectedValueOnce(new Error("network down"));
    const err = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_decompose_video_failed");
    expect((err as AppError).status).toBe(502);
  });
});

import { isVideoTooLongToDecompose, MAX_DECOMPOSE_DURATION_SEC } from "./agents-tool-bridge.decompose-video";

describe("isVideoTooLongToDecompose（复刻时长闸，治长视频 decompose 超时 fetch failed）", () => {
  it("超上限 → true（271s 实测会撞超时）", () => {
    expect(isVideoTooLongToDecompose(271)).toBe(true);
    expect(isVideoTooLongToDecompose(MAX_DECOMPOSE_DURATION_SEC + 1)).toBe(true);
  });
  it("上限内/边界 → false（可处理）", () => {
    expect(isVideoTooLongToDecompose(60)).toBe(false);
    expect(isVideoTooLongToDecompose(MAX_DECOMPOSE_DURATION_SEC)).toBe(false);
  });
  it("时长未知(0/NaN) → false（不拦，交后续真实处理）", () => {
    expect(isVideoTooLongToDecompose(0)).toBe(false);
    expect(isVideoTooLongToDecompose(Number.NaN)).toBe(false);
  });
});

import { mergeSegmentShotTables } from "./agents-tool-bridge.decompose-video";
import type { ShotTable } from "./agents-tool-bridge.decompose-video";

function stub(cuts: Array<{ index: number; startSec: number; endSec: number; t: number }>): ShotTable {
  return {
    version: 1, sourceVideoUrl: "seg", totalDurationSec: 120, aspectRatio: "16:9", fps: 24,
    mode: "exact", detectMethod: "scenedetect", shotCount: cuts.length,
    cuts: cuts.map((c) => ({
      index: c.index, startSec: c.startSec, endSec: c.endSec, durationSec: c.endSec - c.startSec,
      boundarySource: "scene-detect", keyFrames: [{ timeSec: c.t, url: "u", role: "in" }],
      caption: {} as never, replicateMode: "exact",
    })),
  };
}

describe("mergeSegmentShotTables（B 跨段合并:时间偏移+镜号连续）", () => {
  it("两窗合并:第二窗 cut 时间 +120、关键帧时间 +120、index 连续", () => {
    const merged = mergeSegmentShotTables({
      sourceVideoUrl: "orig", totalDurationSec: 200, mode: "exact",
      partials: [
        { startOffset: 0, shotTable: stub([{ index: 0, startSec: 0, endSec: 5, t: 2 }, { index: 1, startSec: 5, endSec: 12, t: 8 }]) },
        { startOffset: 120, shotTable: stub([{ index: 0, startSec: 0, endSec: 6, t: 3 }]) },
      ],
    });
    expect(merged.shotCount).toBe(3);
    expect(merged.cuts.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(merged.cuts[2]!.startSec).toBe(120);
    expect(merged.cuts[2]!.endSec).toBe(126);
    expect(merged.cuts[2]!.keyFrames[0]!.timeSec).toBe(123);
    expect(merged.sourceVideoUrl).toBe("orig");
    expect(merged.totalDurationSec).toBe(200);
  });
  it("任一窗回退 → detectMethod 整体回退", () => {
    const fallback = { ...stub([{ index: 0, startSec: 0, endSec: 5, t: 2 }]), detectMethod: "fixed-window-fallback" as const };
    const merged = mergeSegmentShotTables({
      sourceVideoUrl: "o", totalDurationSec: 240, mode: "exact",
      partials: [{ startOffset: 0, shotTable: stub([{ index: 0, startSec: 0, endSec: 5, t: 2 }]) }, { startOffset: 120, shotTable: fallback }],
    });
    expect(merged.detectMethod).toBe("fixed-window-fallback");
  });
});

import {
  DECOMPOSE_CAPTION_TIMEOUT_MS,
  DECOMPOSE_SHOT_CONCURRENCY,
} from "./agents-tool-bridge.decompose-video";

describe("decomposeVideoForAgent 逐镜限并发 + caption 超时（治多镜快剪打爆视觉上游 → fetch failed）", () => {
  it("逐镜视觉打标限并发 ≤ DECOMPOSE_SHOT_CONCURRENCY，不一次性全发", async () => {
    const scenes = Array.from({ length: 11 }, (_, i) => ({
      index: i,
      startSec: i * 2,
      endSec: i * 2 + 2,
      durationSec: 2,
      boundarySource: "scene-detect" as const,
    }));
    detectScenesMock.mockResolvedValue(scenes);
    let active = 0;
    let peak = 0;
    analyzeImageMock.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { ok: true as const, text: CAPTION_JSON, imageUrl: "x" };
    });

    const result = await decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE },
    });

    expect(result.shotTable.cuts).toHaveLength(11);
    // 峰值并发被压在上限内（治 11 镜一次性 Promise.all 打爆 gpt-5.5 → 429/500/fetch failed）。
    expect(peak).toBeLessThanOrEqual(DECOMPOSE_SHOT_CONCURRENCY);
    // 但确实并发执行（>1），不是退化成串行。
    expect(peak).toBeGreaterThan(1);
  });

  it("单镜 caption 超时 → 该镜降级空 caption + 保留帧，整体不挂", async () => {
    vi.useFakeTimers();
    // caption 永不 resolve → 必须由单镜超时切断，否则整个 decompose 永远挂着。
    analyzeImageMock.mockImplementation(() => new Promise(() => {}));

    const promise = decomposeVideoForAgent({
      c: { env: {} } as AppContext,
      requestUserId: "user-1",
      row: makeRow([]),
      bodyArgs: { sourceUrl: SOURCE },
    });

    await vi.advanceTimersByTimeAsync(DECOMPOSE_CAPTION_TIMEOUT_MS + 50);
    const result = await promise;
    vi.useRealTimers();

    expect(result.shotTable.cuts).toHaveLength(2);
    const cut0 = result.shotTable.cuts[0]!;
    expect(cut0.keyFrames.length).toBe(3); // 帧仍抽到（本质交付物保留）
    expect(cut0.caption.shotSize).toBe(""); // caption 降级为空
    expect(cut0.captionRaw).toContain("timed out");
  });
});
