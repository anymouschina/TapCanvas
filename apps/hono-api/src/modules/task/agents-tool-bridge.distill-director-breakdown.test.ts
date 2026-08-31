import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";

// ffprobe（节点 child_process.execFile）→ 返回 meta JSON（width/height/fps + duration）。
const ffprobeJson = vi.fn(() =>
  JSON.stringify({
    streams: [{ width: 3958, height: 1548, r_frame_rate: "25/1" }],
    format: { duration: "22.72" },
  }),
);
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, _args: unknown, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(null, cmd === "ffprobe" ? ffprobeJson() : "", "");
  },
}));

// new-api relay：恒已配置。
vi.mock("../agents/agents-llm-proxy", () => ({
  readNewApiRelay: () => ({ baseUrl: "http://relay.test", token: "tok" }),
}));

// 切段 IO：probe 时长/大小 + 切段 + 代理转码，逐测试覆盖。
const probeDurationMock = vi.fn();
const probeSizeMock = vi.fn();
const splitSegmentsMock = vi.fn();
const transcodeProxyMock = vi.fn();
vi.mock("./agents-tool-bridge.video-split-io", () => ({
  probeVideoDurationSec: (...a: unknown[]) => probeDurationMock(...a),
  probeVideoSizeBytes: (...a: unknown[]) => probeSizeMock(...a),
  splitVideoUrlToSegments: (...a: unknown[]) => splitSegmentsMock(...a),
  transcodeToUnderstandingProxy: (...a: unknown[]) => transcodeProxyMock(...a),
}));

// 视频理解单段调用（复用自 analyze-video）→ 返回导演拆解 JSON 文本。
const analyzeOneMock = vi.fn();
vi.mock("./agents-tool-bridge.analyze-video", () => ({
  analyzeOneVideoUrl: (...a: unknown[]) => analyzeOneMock(...a),
}));

import {
  distillDirectorBreakdownForAgent,
  parseDirectorBreakdown,
  mergePartialBreakdowns,
  mergeCast,
  mergeLocations,
} from "./agents-tool-bridge.distill-director-breakdown";

const SOURCE = "https://example.invalid/oreo.mp4";

function breakdownJson(
  shots: number,
  opts?: { pacing?: string; cast?: Array<{ roleName: string; appearance: string }>; locations?: Array<{ name: string; description: string }> },
): string {
  return JSON.stringify({
    logline: "孩子按下播放键，世界随之起舞",
    narrativeStructure: "钩子(按键)→世界响应→回到孩子的笑",
    pacingMode: opts?.pacing ?? "montage",
    visualMotif: { light: "高调暖光", color: "蓝白×奶油", motion: "节拍驱动的快切" },
    signatureShot: "按下播放键的特写",
    ...(opts?.cast ? { cast: opts.cast } : {}),
    ...(opts?.locations ? { locations: opts.locations } : {}),
    shots: Array.from({ length: shots }, (_, i) => ({
      approxStartSec: i * 2,
      approxEndSec: i * 2 + 2,
      shotSize: "中近景",
      cameraAngle: "平视",
      cameraMove: "缓推",
      focalLength: "35mm",
      subject: "小孩",
      action: "按下播放键",
      sceneEnv: "明亮客厅",
      lighting: "顺光暖调",
      composition: "中心构图",
      editRelation: i === 0 ? "起幅" : "硬切",
      directorIntent: "建立按键=触发世界的因果",
    })),
  });
}

beforeEach(() => {
  ffprobeJson.mockClear();
  ffprobeJson.mockImplementation(() =>
    JSON.stringify({
      streams: [{ width: 3958, height: 1548, r_frame_rate: "25/1" }],
      format: { duration: "12.72" },
    }),
  );
  probeDurationMock.mockReset();
  probeSizeMock.mockReset();
  splitSegmentsMock.mockReset();
  transcodeProxyMock.mockReset();
  analyzeOneMock.mockReset();
  probeDurationMock.mockResolvedValue(22.72);
  probeSizeMock.mockResolvedValue(10 * 1024 * 1024); // 默认小文件，不触发代理/切段
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("distillDirectorBreakdownForAgent 单段(≤15s)", () => {
  it("用 ffprobe 真 meta + 解析逐镜，组装 DirectorBreakdown（不抽帧、不碰像素）", async () => {
    analyzeOneMock.mockResolvedValue(breakdownJson(5));

    const result = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: { sourceUrl: SOURCE },
    });

    expect(result.ok).toBe(true);
    const b = result.breakdown;
    expect(b.version).toBe(1);
    expect(b.sourceVideoUrl).toBe(SOURCE);
    // ffprobe 真值覆盖模型估值：超宽幅 25fps 12.72s。
    expect(b.totalDurationSec).toBe(12.72);
    expect(b.fps).toBe(25);
    // 3958x1548 超宽幅不在 snap 容差内 → 约分原值（②计划层再归一到 sd2 合法比例）。
    expect(b.aspectRatio).toBe("1979:774");
    expect(b.logline).toContain("播放键");
    expect(b.pacingMode).toBe("montage");
    expect(b.shotCount).toBe(5);
    expect(b.shots[0]!.index).toBe(0);
    expect(b.shots[0]!.approxDurationSec).toBe(2);
    expect(b.shots[0]!.directorIntent).toContain("因果");
    // 单段视频理解只调一次（无逐帧风暴）。
    expect(analyzeOneMock).toHaveBeenCalledTimes(1);
    // 没有走切段。
    expect(splitSegmentsMock).not.toHaveBeenCalled();
  });
});

describe("distillDirectorBreakdownForAgent 长片(>15s)切段合并", () => {
  it("切段逐段理解，按 startOffset 合并镜号与时间", async () => {
    // ffprobe 返回 50s → 触发切段。
    ffprobeJson.mockReturnValue(
      JSON.stringify({
        streams: [{ width: 1920, height: 1080, r_frame_rate: "24/1" }],
        format: { duration: "50.0" },
      }),
    );
    splitSegmentsMock.mockResolvedValue([
      { url: "seg0", startSec: 0, endSec: 15 },
      { url: "seg1", startSec: 15, endSec: 30 },
      { url: "seg2", startSec: 30, endSec: 50 },
    ]);
    analyzeOneMock
      .mockResolvedValueOnce(breakdownJson(2)) // seg0: 2 镜
      .mockResolvedValueOnce(breakdownJson(1))
      .mockResolvedValueOnce(breakdownJson(1)); // seg2: 1 镜

    const result = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: { sourceUrl: SOURCE },
    });

    const b = result.breakdown;
    expect(b.totalDurationSec).toBe(50);
    expect(b.aspectRatio).toBe("16:9");
    expect(b.shotCount).toBe(4);
    expect(b.shots.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(b.segments.map((segment) => segment.label)).toEqual([
      "S01 0.0-15.0s",
      "S02 15.0-30.0s",
      "S03 30.0-50.0s",
    ]);
    expect(b.segments.map((segment) => [segment.firstShotIndex, segment.lastShotIndex])).toEqual([
      [0, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(b.groups.map((group) => group.label)).toEqual([
      "G01 0.0-30.0s",
      "G02 30.0-50.0s",
    ]);
    expect(b.groups.map((group) => group.segmentSequences)).toEqual([[1, 2], [3]]);
    expect(b.groups.map((group) => [group.firstShotIndex, group.lastShotIndex])).toEqual([
      [0, 2],
      [3, 3],
    ]);
    // seg2 的镜时间 +30 偏移。
    expect(b.shots[3]!.approxStartSec).toBe(30);
    expect(b.shots[3]!.approxEndSec).toBe(32);
    expect(analyzeOneMock).toHaveBeenCalledTimes(3);
  });
});

describe("distillDirectorBreakdownForAgent 短但超 50MiB 的超宽幅片 → 先转代理再理解", () => {
  it("12.72s 但 57MiB → 转降分辨率代理片，单段理解代理(不切原片)，meta 仍取原片", async () => {
    probeSizeMock.mockResolvedValue(57 * 1024 * 1024); // 超 50MiB 上限 → 触发代理
    transcodeProxyMock.mockResolvedValue({ url: "https://r2.test/proxy.mp4", sizeBytes: 3 * 1024 * 1024 });
    analyzeOneMock.mockResolvedValue(breakdownJson(5));

    const result = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: { sourceUrl: SOURCE },
    });

    expect(transcodeProxyMock).toHaveBeenCalledTimes(1);
    // 代理后小文件 → 单段理解、不切段。
    expect(splitSegmentsMock).not.toHaveBeenCalled();
    // 喂给模型的是代理 URL，不是原片。
    expect(analyzeOneMock).toHaveBeenCalledTimes(1);
    expect(analyzeOneMock.mock.calls[0]![0].videoUrl).toBe("https://r2.test/proxy.mp4");
    // 但拆解卡的 meta（时长/比例/帧率/sourceVideoUrl）仍是原片真值。
    expect(result.breakdown.sourceVideoUrl).toBe(SOURCE);
    expect(result.breakdown.totalDurationSec).toBe(12.72);
    expect(result.breakdown.shotCount).toBe(5);
  });

  it("代理转码失败 → 退回原片 + 按大小切段兜底（每段 <50MiB）", async () => {
    probeSizeMock.mockResolvedValue(57 * 1024 * 1024);
    transcodeProxyMock.mockRejectedValue(new Error("ffmpeg down"));
    splitSegmentsMock.mockResolvedValue([
      { url: "segA", startSec: 0, endSec: 15 },
      { url: "segB", startSec: 8, endSec: 12.72 },
    ]);
    analyzeOneMock.mockResolvedValueOnce(breakdownJson(2)).mockResolvedValueOnce(breakdownJson(1));

    const result = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: { sourceUrl: SOURCE },
    });

    expect(splitSegmentsMock).toHaveBeenCalledTimes(1);
    const passedMaxSeg = splitSegmentsMock.mock.calls[0]![0].maxSegSec as number;
    expect(passedMaxSeg).toBeLessThan(15); // 大小压低的等效段长
    expect(result.breakdown.shotCount).toBe(3);
    expect(result.breakdown.shots[2]!.approxStartSec).toBe(8);
  });
});

describe("distillDirectorBreakdownForAgent 边界", () => {
  it("无 sourceUrl/nodeId → missing-video", async () => {
    const err = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_distill_breakdown_missing_video");
  });

  it("视频理解返回非 JSON → unparseable 502", async () => {
    analyzeOneMock.mockResolvedValue("抱歉我无法分析这段视频。");
    const err = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: { sourceUrl: SOURCE },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_distill_breakdown_unparseable");
    expect((err as AppError).status).toBe(502);
  });
});

describe("distillDirectorBreakdownForAgent 花名册/场景册（漫剧一致性 auto-split）", () => {
  it("单段：解析 cast/locations 进 breakdown", async () => {
    analyzeOneMock.mockResolvedValue(
      breakdownJson(3, {
        cast: [{ roleName: "小明", appearance: "少年/短发/校服" }],
        locations: [{ name: "教室", description: "明亮课桌" }],
      }),
    );
    const result = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: { sourceUrl: SOURCE },
    });
    expect(result.breakdown.cast).toEqual([{ roleName: "小明", appearance: "少年/短发/校服" }]);
    expect(result.breakdown.locations).toEqual([{ name: "教室", description: "明亮课桌" }]);
  });

  it("蒙太奇片无贯穿角色 → cast 空数组（不误建卡）", async () => {
    analyzeOneMock.mockResolvedValue(breakdownJson(3)); // 不带 cast
    const result = await distillDirectorBreakdownForAgent({
      c: { env: {} } as AppContext,
      row: null,
      bodyArgs: { sourceUrl: SOURCE },
    });
    expect(result.breakdown.cast).toEqual([]);
    expect(result.breakdown.locations).toEqual([]);
  });

  it("跨段同角色去重（按 roleName 归一化），保留首个非空 appearance", () => {
    const p1 = parseDirectorBreakdown(
      breakdownJson(1, { cast: [{ roleName: "小明", appearance: "短发校服" }], locations: [{ name: "教室", description: "" }] }),
    )!;
    const p2 = parseDirectorBreakdown(
      breakdownJson(1, { cast: [{ roleName: "小明", appearance: "" }, { roleName: "小红", appearance: "马尾" }], locations: [{ name: "教室", description: "明亮课桌" }] }),
    )!;
    const cast = mergeCast([p1, p2]);
    expect(cast.map((c) => c.roleName)).toEqual(["小明", "小红"]); // 小明去重
    expect(cast.find((c) => c.roleName === "小明")!.appearance).toBe("短发校服"); // 保留首个非空
    const locs = mergeLocations([p1, p2]);
    expect(locs.map((l) => l.name)).toEqual(["教室"]); // 去重
    expect(locs[0]!.description).toBe("明亮课桌"); // 补上后段非空描述
  });
});

describe("parseDirectorBreakdown 容错", () => {
  it("容忍 ```json 围栏 + 前后散文", () => {
    const wrapped = "这是分析：\n```json\n" + breakdownJson(2) + "\n```\n完毕。";
    const p = parseDirectorBreakdown(wrapped);
    expect(p).not.toBeNull();
    expect(p!.shots).toHaveLength(2);
    expect(p!.pacingMode).toBe("montage");
  });
  it("非 JSON → null", () => {
    expect(parseDirectorBreakdown("没有任何 JSON")).toBeNull();
  });
});

describe("mergePartialBreakdowns", () => {
  it("段内相对时间 + startOffset → 全局，镜号连续", () => {
    const mk = (shots: number) => parseDirectorBreakdown(breakdownJson(shots))!;
    const merged = mergePartialBreakdowns([
      { startOffset: 0, partial: mk(2) },
      { startOffset: 30, partial: mk(2) },
    ]);
    expect(merged.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(merged[2]!.approxStartSec).toBe(30);
    expect(merged[3]!.approxStartSec).toBe(32);
    expect(merged[0]!.approxDurationSec).toBe(2);
  });
});
