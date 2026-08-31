import { describe, expect, it } from "vitest";
import {
  AUTHORING_STALL_CANCEL_MS,
  buildAuthoringProgressFingerprint,
  isAuthoringInternalStallState,
  nextAuthoringStallDecision,
  parseAuthoringStallWatermark,
} from "./video-orchestrator.authoring-stall";

const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse("2026-07-28T05:00:00.000Z");

describe("进度指纹", () => {
  it("相位推进即变（写作→组装）", () => {
    const artifacts = [{ artifact_key: "clip:0", status: "ready" }];
    expect(buildAuthoringProgressFingerprint({ authoringState: "writing_dispatched", artifacts }))
      .not.toBe(buildAuthoringProgressFingerprint({ authoringState: "assembling", artifacts }));
  });

  it("writer 交付即变（running→ready）", () => {
    const a = buildAuthoringProgressFingerprint({
      authoringState: "writing_dispatched",
      artifacts: [{ artifact_key: "clip:0", status: "running" }, { artifact_key: "clip:1", status: "running" }],
    });
    const b = buildAuthoringProgressFingerprint({
      authoringState: "writing_dispatched",
      artifacts: [{ artifact_key: "clip:0", status: "ready" }, { artifact_key: "clip:1", status: "running" }],
    });
    expect(a).not.toBe(b);
  });

  it("判失败进入重写也算变（不会把重写轮当停滞）", () => {
    const a = buildAuthoringProgressFingerprint({
      authoringState: "writing_dispatched",
      artifacts: [{ artifact_key: "clip:0", status: "running" }],
    });
    const b = buildAuthoringProgressFingerprint({
      authoringState: "writing_dispatched",
      artifacts: [{ artifact_key: "clip:0", status: "failed" }],
    });
    expect(a).not.toBe(b);
  });

  it("相同状态计数下的新 agent 执行代际也会重置停滞窗口", () => {
    const make = (agentId: string, repairAttempt: number) => buildAuthoringProgressFingerprint({
      authoringState: "writing_dispatched",
      artifacts: [{
        artifact_key: "clip:1",
        status: "running",
        payload: JSON.stringify({
          agentId,
          repairAttempt,
          dispatchedAt: `2026-08-01T00:0${repairAttempt}:00.000Z`,
        }),
      }],
    });
    expect(make("agent-old", 0)).not.toBe(make("agent-new", 1));
  });

  it("完全没动时指纹稳定（顺序无关，非 clip artifact 不干扰）", () => {
    const mk = (list: Array<{ artifact_key: string; status: string; payload?: string | null }>) =>
      buildAuthoringProgressFingerprint({ authoringState: "writing_dispatched", artifacts: list });
    expect(mk([
      { artifact_key: "clip:1", status: "running", payload: '{"agentId":"agent-1"}' },
      { artifact_key: "clip:0", status: "ready" },
      { artifact_key: "beat_sheet", status: "ready" },
    ])).toBe(mk([
      { artifact_key: "clip:0", status: "ready" },
      { artifact_key: "clip:1", status: "running", payload: '{"agentId":"agent-1"}' },
    ]));
  });
});

describe("停滞判据", () => {
  const fp = "writing_dispatched|running=2";

  it("首次见到即 mark，不判死", () => {
    const d = nextAuthoringStallDecision({
      fingerprint: fp, watermark: null, nowIso: iso(T0), stallCancelMs: AUTHORING_STALL_CANCEL_MS,
    });
    expect(d.action).toBe("mark");
    expect(d.watermark).toEqual({ fingerprint: fp, since: iso(T0) });
  });

  it("指纹变了就重置起点（真前进过，计时清零）", () => {
    const d = nextAuthoringStallDecision({
      fingerprint: "writing_dispatched|ready=1,running=1",
      watermark: { fingerprint: fp, since: iso(T0) },
      nowIso: iso(T0 + 40 * 60_000),
      stallCancelMs: AUTHORING_STALL_CANCEL_MS,
    });
    expect(d.action).toBe("mark");
    expect(d.watermark.since).toBe(iso(T0 + 40 * 60_000));
  });

  it("未满窗口时 hold，且绝不刷新起点", () => {
    const d = nextAuthoringStallDecision({
      fingerprint: fp,
      watermark: { fingerprint: fp, since: iso(T0) },
      nowIso: iso(T0 + 44 * 60_000),
      stallCancelMs: AUTHORING_STALL_CANCEL_MS,
    });
    expect(d.action).toBe("hold");
    expect(d.watermark.since).toBe(iso(T0));
  });

  it("窗口 > writer 超时：writer 合法跑 30min 不会被误杀", () => {
    expect(AUTHORING_STALL_CANCEL_MS).toBeGreaterThan(30 * 60 * 1000);
    const d = nextAuthoringStallDecision({
      fingerprint: fp,
      watermark: { fingerprint: fp, since: iso(T0) },
      nowIso: iso(T0 + 30 * 60_000),
      stallCancelMs: AUTHORING_STALL_CANCEL_MS,
    });
    expect(d.action).toBe("hold");
  });

  it("同一指纹卡满 45min 判死", () => {
    const d = nextAuthoringStallDecision({
      fingerprint: fp,
      watermark: { fingerprint: fp, since: iso(T0) },
      nowIso: iso(T0 + AUTHORING_STALL_CANCEL_MS),
      stallCancelMs: AUTHORING_STALL_CANCEL_MS,
    });
    expect(d.action).toBe("cancel");
    expect(d.stalledMs).toBe(AUTHORING_STALL_CANCEL_MS);
  });

  it("静默卡在不等 writer 的相位也会判死（beats_committed 该派发却没派发）", () => {
    const stuck = "beats_committed|";
    const d = nextAuthoringStallDecision({
      fingerprint: stuck,
      watermark: { fingerprint: stuck, since: iso(T0) },
      nowIso: iso(T0 + AUTHORING_STALL_CANCEL_MS + 1),
      stallCancelMs: AUTHORING_STALL_CANCEL_MS,
    });
    expect(d.action).toBe("cancel");
  });
});

describe("停滞计时适用阶段", () => {
  it("等待真实资产证据不是内部死锁阶段", () => {
    expect(isAuthoringInternalStallState("asset_repair_required")).toBe(false);
  });

  it("后台独占推进阶段仍受停滞截止时间约束", () => {
    expect(isAuthoringInternalStallState("beats_committed")).toBe(true);
    expect(isAuthoringInternalStallState("writing_dispatched")).toBe(true);
  });
});

describe("水位标读回", () => {
  it("坏/缺 payload 当无水位标，绝不因脏数据误杀", () => {
    expect(parseAuthoringStallWatermark(null)).toBeNull();
    expect(parseAuthoringStallWatermark("{坏json")).toBeNull();
    expect(parseAuthoringStallWatermark(JSON.stringify({ fingerprint: "x" }))).toBeNull();
  });

  it("正常读回", () => {
    expect(parseAuthoringStallWatermark(JSON.stringify({ fingerprint: "a|b", since: iso(T0) })))
      .toEqual({ fingerprint: "a|b", since: iso(T0) });
  });
});
