import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    video_runs: {
      findMany: mocks.findMany,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  }),
}));

import { cancelStaleVideoRuns } from "./video-run.repo";

describe("cancelStaleVideoRuns client-concat wait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not strike or cancel an 8/8 video_success run waiting for WebAV", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "run-1",
        owner_id: "owner-1",
        flow_id: null,
        project_id: "project-1",
        chapter_id: "chapter-1",
        recipe_id: null,
        state: "video_success",
        story_plan: "{}",
        film_bible: null,
        adaptation_strategy: null,
        beat_sheet: "{}",
        authoring_state: "authoring_done",
        total_clips: 8,
        clips_done: 8,
        error_message: "noprogress:8:2026-07-22T11:00:00.000Z",
        last_drive_at: "2026-07-22T11:00:00.000Z",
        created_at: "2026-07-22T10:00:00.000Z",
        updated_at: "2026-07-22T11:00:00.000Z",
        completed_at: null,
      },
    ]);

    const cancelled = await cancelStaleVideoRuns({
      olderThanIso: "2026-07-22T12:00:00.000Z",
      notDrivenSinceIso: "2026-07-22T11:30:00.000Z",
      nowIso: "2026-07-22T12:30:00.000Z",
    });

    expect(cancelled).toEqual([]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not abort the stale sweep when a candidate changes before its strike write", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "run-raced",
        owner_id: "owner-1",
        flow_id: null,
        project_id: "project-1",
        chapter_id: null,
        recipe_id: null,
        state: "video_running",
        story_plan: "{}",
        film_bible: null,
        adaptation_strategy: null,
        beat_sheet: null,
        authoring_state: "authoring_done",
        total_clips: 2,
        clips_done: 0,
        error_message: null,
        last_drive_at: "2026-07-22T10:00:00.000Z",
        created_at: "2026-07-22T09:00:00.000Z",
        updated_at: "2026-07-22T10:00:00.000Z",
        completed_at: null,
      },
    ]);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(cancelStaleVideoRuns({
      olderThanIso: "2026-07-22T12:00:00.000Z",
      notDrivenSinceIso: "2026-07-22T11:30:00.000Z",
      nowIso: "2026-07-22T12:30:00.000Z",
    })).resolves.toEqual([]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "run-raced", state: "video_running", updated_at: "2026-07-22T10:00:00.000Z" },
      data: {
        error_message: "stall_strike:1",
        last_drive_at: "2026-07-22T12:30:00.000Z",
        updated_at: "2026-07-22T12:30:00.000Z",
      },
    });
  });
});
