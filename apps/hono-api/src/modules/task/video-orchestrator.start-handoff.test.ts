import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { VideoRunRow } from "./video-run.repo";

const mocks = vi.hoisted(() => ({
  insertVideoRun: vi.fn(),
  upsertVideoRunStatusNode: vi.fn(),
}));

vi.mock("./video-run.repo", () => ({
  insertVideoRun: mocks.insertVideoRun,
}));

vi.mock("./video-orchestrator.status-node", () => ({
  upsertVideoRunStatusNode: mocks.upsertVideoRunStatusNode,
}));

import { persistStartedVideoRunHandoff } from "./video-orchestrator.start-handoff";

const context = {} as AppContext;
const run: VideoRunRow = {
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

describe("persistStartedVideoRunHandoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertVideoRun.mockResolvedValue(run);
    mocks.upsertVideoRunStatusNode.mockResolvedValue({ status: "updated" });
  });

  it("projects the persisted scheduled facts to the shared status node", async () => {
    const result = await persistStartedVideoRunHandoff({
      c: context,
      run: {
        runId: "run-1",
        ownerId: "user-1",
        flowId: "flow-1",
        projectId: "project-1",
        chapterId: "chapter-1",
        durableExecutablePlan: {
          protocolVersion: "1",
          executablePlanHash: "frozen-hash",
          clips: [],
        },
        totalClips: 8,
        nowIso: "2026-07-22T00:00:00.000Z",
      },
    });

    expect(result).toEqual({ run, statusProjection: { status: "updated" } });
    expect(mocks.insertVideoRun).toHaveBeenCalledWith(expect.objectContaining({
      storyPlan: expect.objectContaining({
        protocolVersion: "1",
        executablePlanHash: "frozen-hash",
      }),
    }));
    expect(mocks.upsertVideoRunStatusNode).toHaveBeenCalledWith({
      c: context,
      runId: "run-1",
      runCreatedAt: "2026-07-22T00:00:00.000Z",
      ownerId: "user-1",
      flowId: "flow-1",
      chapterId: "chapter-1",
      authoringState: "authoring_done",
      productionState: "scheduled",
      statusLine: "0/8 镜头完成\n等待生成",
    });
  });
});
