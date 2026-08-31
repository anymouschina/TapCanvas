import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import type { DirectorBreakdown } from "./agents-tool-bridge.distill-director-breakdown";

// distill：复用①拆解复刻片/原片，逐测试覆盖返回值。
const distillMock = vi.fn();
vi.mock("./agents-tool-bridge.distill-director-breakdown", () => ({
  distillDirectorBreakdownForAgent: (...a: unknown[]) => distillMock(...a),
}));

const relayMock = vi.fn();
vi.mock("../agents/agents-llm-proxy", () => ({
  readNewApiRelay: () => ({ baseUrl: "http://relay.test", token: "tok" }),
  relayCriticChat: (...args: unknown[]) => relayMock(...args),
}));

import { videoCompareForAgent, parseCompareScorecard } from "./agents-tool-bridge.video-compare";

function mkBreakdown(over?: Partial<DirectorBreakdown>): DirectorBreakdown {
  return {
    version: 1,
    sourceVideoUrl: "u",
    totalDurationSec: 22.72,
    aspectRatio: "16:9",
    fps: 25,
    logline: "x",
    narrativeStructure: "x",
    pacingMode: "montage",
    visualMotif: { light: "", color: "", motion: "" },
    signatureShot: "",
    shotCount: 0,
    shots: [],
    ...over,
  };
}

const SCORECARD = {
  dims: {
    narrative: { score: 88, note: "结构对齐" },
    pacing: { score: 80, note: "镜数略少" },
    camera: { score: 75, note: "运镜接近" },
    composition: { score: 82, note: "构图还原" },
    consistency: { score: 90, note: "画风统一" },
    overall: { score: 83, note: "基本学到位" },
  },
  diffs: ["镜3 运镜幅度偏小"],
  suggestions: ["镜3 加大跟摇幅度重生"],
};

const PARENT_EXECUTION = { model: "parent-model-exact", apiStyle: "chat" as const };

beforeEach(() => {
  distillMock.mockReset();
  relayMock.mockReset();
  relayMock.mockResolvedValue(JSON.stringify(SCORECARD));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("videoCompareForAgent", () => {
  it("已带原片拆解卡 → 只拆复刻片一次，输出逐维评分卡", async () => {
    distillMock.mockResolvedValueOnce({ breakdown: mkBreakdown({ shotCount: 6 }) }); // 复刻片
    const result = await videoCompareForAgent({
      c: { env: {} } as AppContext,
      row: null,
      parentAgentExecution: PARENT_EXECUTION,
      bodyArgs: {
        replicaUrl: "https://r2.test/replica.mp4",
        originalBreakdown: mkBreakdown({ shotCount: 6, sourceVideoUrl: "orig" }),
      },
    });
    expect(distillMock).toHaveBeenCalledTimes(1); // 原片卡已给，不再拆原片
    expect(result.scorecard.dims.overall.score).toBe(83);
    expect(result.scorecard.dims.narrative.score).toBe(88);
    expect(result.scorecard.diffs).toContain("镜3 运镜幅度偏小");
    expect(result.scorecard.suggestions[0]).toContain("镜3");
    expect(result.replicaBreakdown.shotCount).toBe(6);
    expect(relayMock).toHaveBeenCalledWith(
      { baseUrl: "http://relay.test", token: "tok" },
      expect.objectContaining({
        model: "parent-model-exact",
        apiStyle: "chat",
        system: expect.stringContaining("资深导演与剪辑监制"),
        temperature: 0,
        maxTokens: 4096,
        responseFormat: { type: "json_object" },
      }),
    );
  });

  it("未带原片拆解卡但给 originalUrl → 拆复刻片 + 原片各一次", async () => {
    distillMock
      .mockResolvedValueOnce({ breakdown: mkBreakdown({ shotCount: 6 }) }) // 复刻
      .mockResolvedValueOnce({ breakdown: mkBreakdown({ shotCount: 6, sourceVideoUrl: "orig" }) }); // 原片
    const result = await videoCompareForAgent({
      c: { env: {} } as AppContext,
      row: null,
      parentAgentExecution: PARENT_EXECUTION,
      bodyArgs: { replicaUrl: "https://r2.test/replica.mp4", originalUrl: "https://r2.test/orig.mp4" },
    });
    expect(distillMock).toHaveBeenCalledTimes(2);
    expect(result.scorecard.dims.consistency.score).toBe(90);
  });

  it("缺复刻片 → missing_replica", async () => {
    const err = await videoCompareForAgent({
      c: { env: {} } as AppContext,
      row: null,
      parentAgentExecution: PARENT_EXECUTION,
      bodyArgs: { originalUrl: "x" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_video_compare_missing_replica");
  });

  it("缺原片基准(无卡无URL) → missing_original", async () => {
    const err = await videoCompareForAgent({
      c: { env: {} } as AppContext,
      row: null,
      parentAgentExecution: PARENT_EXECUTION,
      bodyArgs: { replicaUrl: "https://r2.test/replica.mp4" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_video_compare_missing_original");
  });

  it("判分返回非 JSON → unparseable", async () => {
    distillMock.mockResolvedValueOnce({ breakdown: mkBreakdown() });
    relayMock.mockResolvedValue("不是对象");
    const err = await videoCompareForAgent({
      c: { env: {} } as AppContext,
      row: null,
      parentAgentExecution: PARENT_EXECUTION,
      bodyArgs: { replicaUrl: "x", originalBreakdown: mkBreakdown() },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_video_compare_unparseable");
  });
});

describe("parseCompareScorecard", () => {
  it("完整 JSON 分数 clamp 到 0-100", () => {
    const text = JSON.stringify({
      dims: {
        narrative: { score: 120, note: "a" },
        pacing: { score: 50, note: "p" },
        camera: { score: 50, note: "c" },
        composition: { score: 50, note: "o" },
        consistency: { score: 50, note: "k" },
        overall: { score: -5, note: "b" },
      },
      diffs: ["d"], suggestions: ["s"],
    });
    const sc = parseCompareScorecard(text);
    expect(sc).not.toBeNull();
    expect(sc!.dims.narrative.score).toBe(100); // clamp 上限
    expect(sc!.dims.overall.score).toBe(0); // clamp 下限
    expect(sc!.diffs).toEqual(["d"]);
  });
  it("围栏或缺失维度不做静默恢复", () => {
    const incomplete = JSON.stringify({
      dims: { narrative: { score: 90, note: "a" } },
      diffs: [], suggestions: [],
    });
    expect(parseCompareScorecard(`\`\`\`json\n${JSON.stringify(SCORECARD)}\n\`\`\``)).toBeNull();
    expect(parseCompareScorecard(incomplete)).toBeNull();
  });
  it("非 JSON → null", () => {
    expect(parseCompareScorecard("没有 JSON")).toBeNull();
  });
});
