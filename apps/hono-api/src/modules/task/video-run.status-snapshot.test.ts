import { beforeEach, describe, expect, it, vi } from "vitest";

const { getWatermark, listActive, getProgress, getTitles } = vi.hoisted(() => ({
  getWatermark: vi.fn(),
  listActive: vi.fn(),
  getProgress: vi.fn(),
  getTitles: vi.fn(),
}));

vi.mock("./video-run.repo", () => ({
  getVideoRunStatusWatermarkForProject: getWatermark,
  getVideoRunStatusWatermarkForChapter: vi.fn(),
  listActiveVideoRunsForProject: listActive,
  listActiveVideoRunsForChapter: vi.fn(),
  getAuthoringClipProgressByRunIds: getProgress,
  getChapterTitlesByIds: getTitles,
}));

import { buildProjectVideoRunStatusSnapshot } from "./video-run.status-snapshot";

const activeRun = {
  id: "run-1",
  owner_id: "owner-1",
  flow_id: "flow-1",
  project_id: "project-1",
  chapter_id: "chapter-1",
  recipe_id: null,
  state: "video_running",
  story_plan: null,
  film_bible: null,
  adaptation_strategy: null,
  beat_sheet: JSON.stringify({ beats: [{ clipIndex: 0 }] }),
  authoring_state: "authoring_done",
  total_clips: 1,
  clips_done: 0,
  error_message: null,
  last_drive_at: null,
  created_at: "2026-08-03T05:00:00.000Z",
  updated_at: "2026-08-03T05:30:00.000Z",
  completed_at: null,
};

describe("video run status snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWatermark.mockResolvedValue("2026-08-03T05:29:00.000Z");
    listActive.mockResolvedValue([activeRun]);
    getProgress.mockResolvedValue({ "run-1": { ready: 1 } });
    getTitles.mockResolvedValue({ "chapter-1": "第一章" });
  });

  it("reads the persisted watermark before active rows and emits one canonical snapshot", async () => {
    const snapshot = await buildProjectVideoRunStatusSnapshot("project-1");

    expect(getWatermark.mock.invocationCallOrder[0]).toBeLessThan(listActive.mock.invocationCallOrder[0]);
    expect(snapshot).toMatchObject({
      protocolVersion: "2",
      scopeType: "project",
      scopeId: "project-1",
      watermarkUpdatedAt: "2026-08-03T05:29:00.000Z",
      runs: [{
        protocolVersion: "2",
        runId: "run-1",
        state: "video_running",
        authoringClipsReady: 1,
        authoringTotalClips: 1,
        updatedAt: "2026-08-03T05:30:00.000Z",
      }],
    });
  });

  it("fails explicitly when persisted state violates the canonical status contract", async () => {
    listActive.mockResolvedValue([{ ...activeRun, state: "legacy_running_alias" }]);
    await expect(buildProjectVideoRunStatusSnapshot("project-1"))
      .rejects.toThrow("state is not canonical");
  });
});
