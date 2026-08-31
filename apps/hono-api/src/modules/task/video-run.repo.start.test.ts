import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    video_runs: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      upsert: mocks.upsert,
    },
  }),
}));

import { insertVideoRun, type VideoRunRow } from "./video-run.repo";

const startedRun: VideoRunRow = {
  id: "run-1",
  owner_id: "user-1",
  flow_id: "flow-1",
  project_id: "project-1",
  chapter_id: "chapter-1",
  recipe_id: null,
  state: "scheduled",
  story_plan: "{}",
  film_bible: null,
  adaptation_strategy: null,
  beat_sheet: "{}",
  authoring_state: "authoring_done",
  total_clips: 8,
  clips_done: 0,
  error_message: null,
  last_drive_at: null,
  created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T00:00:00.000Z",
  completed_at: null,
};

describe("insertVideoRun start handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.upsert.mockResolvedValue(startedRun);
  });

  it("atomically promotes collecting/estimate_ready to scheduled/authoring_done", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({
        state: "collecting",
        authoring_state: "estimate_ready",
      })
      .mockResolvedValueOnce(startedRun);

    const result = await insertVideoRun({
      runId: "run-1",
      ownerId: "user-1",
      flowId: "flow-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      storyPlan: { clips: [] },
      totalClips: 8,
      nowIso: "2026-07-22T00:00:00.000Z",
    });

    expect(result).toBe(startedRun);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "run-1" },
      select: { state: true, authoring_state: true },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        state: "collecting",
        authoring_state: "estimate_ready",
      },
      data: expect.objectContaining({
        state: "scheduled",
        authoring_state: "authoring_done",
        error_message: null,
        completed_at: null,
        last_drive_at: null,
      }),
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("fails explicitly when the authoring state changes before the CAS handoff", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      state: "collecting",
      authoring_state: "estimate_ready",
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      insertVideoRun({
        runId: "run-1",
        ownerId: "user-1",
        storyPlan: { clips: [] },
        totalClips: 8,
        nowIso: "2026-07-22T00:00:00.000Z",
      }),
    ).rejects.toThrow("video_run_start_state_changed");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not invent an authoring state for a legacy run", async () => {
    mocks.findUnique.mockResolvedValue({
      state: "collecting",
      authoring_state: null,
    });

    await insertVideoRun({
      runId: "run-1",
      ownerId: "user-1",
      storyPlan: { clips: [] },
      totalClips: 1,
      nowIso: "2026-07-22T00:00:00.000Z",
    });

    const call = mocks.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(call.update).not.toHaveProperty("authoring_state");
  });
});
