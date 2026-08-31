import { describe, it, expect, vi, beforeEach } from "vitest";

// 防双提交双扣费（2026-06-14 实测 859/860 同 clip 双计费）：worker 与 agent 手动 drive
// 共用 last_drive_at 原子 CAS 互斥锁。本测试锁定 CAS 的 WHERE/count 语义与 claimDrivable 的逐行认领。

const mockUpdateMany = vi.fn(async () => ({ count: 1 }));
const mockFindMany = vi.fn(async () => [] as unknown[]);
const mockArtifactFindMany = vi.fn(async () => [] as unknown[]);

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    video_runs: {
      updateMany: mockUpdateMany,
      findMany: mockFindMany,
    },
    authoring_artifacts: {
      findMany: mockArtifactFindMany,
    },
  }),
}));

import {
  tryClaimVideoRunForDrive,
  claimDrivableVideoRuns,
  updateVideoRunProgress,
  VIDEO_RUN_TERMINAL_STATES,
  VIDEO_RUN_COLLECTING_STATE,
} from "./video-run.repo";

beforeEach(() => {
  mockUpdateMany.mockClear();
  mockFindMany.mockClear();
  mockArtifactFindMany.mockClear();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("tryClaimVideoRunForDrive（原子 CAS 认领驱动权）", () => {
  it("CAS WHERE 必含：生产态可驱动 + authoring 已交棒/历史生产 + 驱动锁可用", async () => {
    await tryClaimVideoRunForDrive({
      runId: "run-1",
      nowIso: "2026-06-14T13:00:00.000Z",
      staleBeforeIso: "2026-06-14T12:59:15.000Z",
    });
    // 2026-07-04 filmBible 落库：collecting 占位行（未 start·只存叙事元数据）不可被认领驱动，
    // 否则 worker 拿到 story_plan 为空的行直接判 failed、污染 runId。
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        AND: [
          {
            OR: [
              {
                state: { notIn: [...VIDEO_RUN_TERMINAL_STATES, VIDEO_RUN_COLLECTING_STATE] },
                OR: [
                  { beat_sheet: null, authoring_state: null },
                  { beat_sheet: { not: null }, authoring_state: "authoring_done" },
                ],
              },
            ],
          },
          {
            OR: [
              { last_drive_at: null },
              { last_drive_at: { lt: "2026-06-14T12:59:15.000Z" } },
            ],
          },
        ],
      },
      data: { last_drive_at: "2026-06-14T13:00:00.000Z" },
    });
  });

  it("count===1 → 抢到（true）", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    const ok = await tryClaimVideoRunForDrive({
      runId: "run-1",
      nowIso: "n",
      staleBeforeIso: "s",
    });
    expect(ok).toBe(true);
  });

  it("count===0 → 没抢到（false，别人正持锁 / 已终态）", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });
    const ok = await tryClaimVideoRunForDrive({
      runId: "run-1",
      nowIso: "n",
      staleBeforeIso: "s",
    });
    expect(ok).toBe(false);
  });
});

describe("claimDrivableVideoRuns（worker 逐行原子认领，只返回真正抢到的）", () => {
  it("候选三行、CAS 命中两行 → 只返回那两行（被 agent 抢走的一行剔除）", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "a", state: "scheduled", last_drive_at: null },
      { id: "b", state: "video_running", last_drive_at: null },
      { id: "c", state: "scheduled", last_drive_at: null },
    ] as unknown[]);
    // a 抢到、b 被 agent 抢走(count 0)、c 抢到
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const claimed = await claimDrivableVideoRuns({
      staleBeforeIso: "2026-06-14T12:59:15.000Z",
      limit: 5,
      nowIso: "2026-06-14T13:00:00.000Z",
    });

    expect(claimed.map((r) => r.id)).toEqual(["a", "c"]);
    // 每个候选都走一次原子 CAS（共 3 次）
    expect(mockUpdateMany).toHaveBeenCalledTimes(3);
    // 认领后的行回写了 last_drive_at=now
    expect(claimed[0].last_drive_at).toBe("2026-06-14T13:00:00.000Z");
  });

  it("无候选 → 不调 CAS、返回空", async () => {
    mockFindMany.mockResolvedValueOnce([] as unknown[]);
    const claimed = await claimDrivableVideoRuns({
      staleBeforeIso: "s",
      limit: 5,
      nowIso: "n",
    });
    expect(claimed).toEqual([]);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("候选查询只认领 authoring_done 或无 authoring 状态的历史生产 run", async () => {
    mockFindMany.mockResolvedValueOnce([] as unknown[]);
    await claimDrivableVideoRuns({
      staleBeforeIso: "2026-08-01T07:00:00.000Z",
      limit: 5,
      nowIso: "2026-08-01T07:00:45.000Z",
    });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              {
                state: { notIn: [...VIDEO_RUN_TERMINAL_STATES, VIDEO_RUN_COLLECTING_STATE] },
                OR: [
                  { beat_sheet: null, authoring_state: null },
                  { beat_sheet: { not: null }, authoring_state: "authoring_done" },
                ],
              },
            ],
          },
          {
            OR: [
              { last_drive_at: null },
              { last_drive_at: { lt: "2026-08-01T07:00:00.000Z" } },
            ],
          },
        ],
      },
      orderBy: [
        { last_drive_at: { sort: "asc", nulls: "first" } },
        { updated_at: "asc" },
      ],
      take: 5,
    });
  });

  it("reclaims a concatenated graph run only when its structured delivery receipt still lacks external evidence", async () => {
    mockArtifactFindMany.mockResolvedValueOnce([{
      run_id: "run-delivery-wait",
      status: "ready",
      payload: JSON.stringify({
        deliveryVerification: {
          satisfied: false,
          missingCriteria: ["finalMediaProbe"],
        },
      }),
    }]);
    mockFindMany.mockResolvedValueOnce([{
      id: "run-delivery-wait",
      state: "concatenated",
      last_drive_at: null,
    }] as unknown[]);

    const claimed = await claimDrivableVideoRuns({
      staleBeforeIso: "2026-08-10T16:00:00.000Z",
      limit: 5,
      nowIso: "2026-08-10T16:01:00.000Z",
    });

    expect(claimed.map((run) => run.id)).toEqual(["run-delivery-wait"]);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          {
            OR: [
              expect.objectContaining({ state: { notIn: expect.any(Array) } }),
              {
                id: { in: ["run-delivery-wait"] },
                state: "concatenated",
                beat_sheet: { not: null },
                authoring_state: "authoring_done",
              },
            ],
          },
          {
            OR: [
              { last_drive_at: null },
              { last_drive_at: { lt: "2026-08-10T16:00:00.000Z" } },
            ],
          },
        ],
      },
    }));
  });

  it("按从未驱动/最久未驱动轮转，持久错误 run 不得凭 updated_at 占满固定批次", async () => {
    mockFindMany.mockResolvedValueOnce([] as unknown[]);

    await claimDrivableVideoRuns({
      staleBeforeIso: "2026-08-01T10:30:15.000Z",
      limit: 5,
      nowIso: "2026-08-01T10:31:00.000Z",
    });

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { last_drive_at: { sort: "asc", nulls: "first" } },
        { updated_at: "asc" },
      ],
      take: 5,
    }));
  });
});

// 【终态不许被进度回写降级·2026-07-07 ch5-v1 实测】重叠 tick 竞态：87s 长 tick 迟到收尾，
// 把已 concatenated 的 run 覆盖回 video_running 5/8 → run 重新可认领被反复重驱动。
// 锁定契约：updateVideoRunProgress 的 WHERE 必须排除全部终态行。
describe("updateVideoRunProgress（终态降级守卫）", () => {
  it("WHERE 必含 state notIn 终态集（陈旧重叠 tick 不得覆盖 concatenated/failed/cancelled）", async () => {
    await updateVideoRunProgress({
      runId: "run-1",
      state: "video_running",
      clipsDone: 5,
      nowIso: "2026-07-07T00:20:00.000Z",
      errorMessage: null,
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        state: { notIn: [...VIDEO_RUN_TERMINAL_STATES] },
      },
      data: {
        state: "video_running",
        clips_done: 5,
        last_drive_at: "2026-07-07T00:20:00.000Z",
        updated_at: "2026-07-07T00:20:00.000Z",
        error_message: null,
      },
    });
  });

  it("completed=true 时写 completed_at（非终态行照常收尾）", async () => {
    await updateVideoRunProgress({
      runId: "run-2",
      state: "concatenated",
      clipsDone: 8,
      nowIso: "t",
      completed: true,
    });
    const arg = (mockUpdateMany.mock.calls.at(-1) as unknown as [Record<string, any>])[0];
    expect(arg.where.state.notIn).toEqual([...VIDEO_RUN_TERMINAL_STATES]);
    expect(arg.data.completed_at).toBe("t");
  });
});
