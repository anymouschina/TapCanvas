import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoRunRow } from "./video-run.repo";

const mocks = vi.hoisted(() => ({
	order: [] as string[],
	persistProductionGraphEvidence: vi.fn(),
	updateVideoRunProgress: vi.fn(),
	synchronizeVideoProductionWorkflowRun: vi.fn(),
	getProjectIdForFlow: vi.fn(),
	getAuthoringClipProgressByRunIds: vi.fn(),
	getChapterTitlesByIds: vi.fn(),
	broadcastRunStatus: vi.fn(),
}));

vi.mock("./video-orchestrator.production-graph-persistence", () => ({
	persistProductionGraphEvidence: mocks.persistProductionGraphEvidence,
}));
vi.mock("./video-production-workflow-runtime", () => ({
	synchronizeVideoProductionWorkflowRun: mocks.synchronizeVideoProductionWorkflowRun,
}));
vi.mock("./video-run.repo", () => ({
	updateVideoRunProgress: mocks.updateVideoRunProgress,
	getProjectIdForFlow: mocks.getProjectIdForFlow,
	getAuthoringClipProgressByRunIds: mocks.getAuthoringClipProgressByRunIds,
	getChapterTitlesByIds: mocks.getChapterTitlesByIds,
}));
vi.mock("../chapter/canvas-sse.manager", () => ({
	broadcastRunStatus: mocks.broadcastRunStatus,
}));

import { persistVideoRunConcatenatingPhase } from "./video-orchestrator.production-phase";

const run: VideoRunRow = {
	id: "run-1",
	owner_id: "user-1",
	flow_id: "flow-1",
	project_id: "project-1",
	chapter_id: "chapter-1",
	recipe_id: null,
	state: "video_running",
	story_plan: "{}",
	film_bible: null,
	adaptation_strategy: null,
	beat_sheet: JSON.stringify({ beats: [{ clipIndex: 0 }, { clipIndex: 1 }] }),
	authoring_state: "authoring_done",
	total_clips: 2,
	clips_done: 1,
	error_message: null,
	last_drive_at: null,
	created_at: "2026-08-10T00:00:00.000Z",
	updated_at: "2026-08-10T00:01:00.000Z",
	completed_at: null,
};

describe("persistVideoRunConcatenatingPhase", () => {
	beforeEach(() => {
		mocks.order.length = 0;
		mocks.persistProductionGraphEvidence.mockReset().mockImplementation(async () => {
			mocks.order.push("graph");
		});
		mocks.updateVideoRunProgress.mockReset().mockImplementation(async () => {
			mocks.order.push("run");
		});
		mocks.synchronizeVideoProductionWorkflowRun.mockReset().mockImplementation(async () => {
			mocks.order.push("checkpoint");
		});
		mocks.getProjectIdForFlow.mockReset();
		mocks.getAuthoringClipProgressByRunIds.mockReset().mockResolvedValue({
			"run-1": { ready: 2 },
		});
		mocks.getChapterTitlesByIds.mockReset().mockResolvedValue({ "chapter-1": "第一章" });
		mocks.broadcastRunStatus.mockReset().mockImplementation(() => {
			mocks.order.push("broadcast");
		});
	});

	it("persists the truthful composition boundary before broadcasting it", async () => {
		const clips = [
			{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" },
			{ clipIndex: 1, status: "success", videoUrl: "https://cdn.example/1.mp4" },
		];
		await persistVideoRunConcatenatingPhase({
			run,
			clips,
			nowIso: "2026-08-10T00:02:00.000Z",
		});

		expect(mocks.order).toEqual(["graph", "run", "checkpoint", "broadcast"]);
		expect(mocks.persistProductionGraphEvidence).toHaveBeenCalledWith(expect.objectContaining({
			run,
			orchestration: { state: "concatenating", clips },
		}));
		expect(mocks.updateVideoRunProgress).toHaveBeenCalledWith(expect.objectContaining({
			runId: "run-1",
			state: "concatenating",
			clipsDone: 2,
			completed: false,
		}));
		expect(mocks.broadcastRunStatus).toHaveBeenCalledWith("project-1", expect.objectContaining({
			state: "concatenating",
			clipsDone: 2,
			totalClips: 2,
			completedAt: null,
		}));
	});

	it("does not expose or start a later phase when durable graph persistence fails", async () => {
		mocks.persistProductionGraphEvidence.mockRejectedValueOnce(new Error("artifact write failed"));
		await expect(persistVideoRunConcatenatingPhase({
			run,
			clips: [],
			nowIso: "2026-08-10T00:02:00.000Z",
		})).rejects.toThrow("artifact write failed");
		expect(mocks.updateVideoRunProgress).not.toHaveBeenCalled();
		expect(mocks.synchronizeVideoProductionWorkflowRun).not.toHaveBeenCalled();
		expect(mocks.broadcastRunStatus).not.toHaveBeenCalled();
	});

	it("replays checkpoint and broadcast without resetting an existing composition clock", async () => {
		await persistVideoRunConcatenatingPhase({
			run: { ...run, state: "concatenating", updated_at: "2026-08-10T00:01:30.000Z" },
			clips: [
				{ clipIndex: 0, status: "success", videoUrl: "https://cdn.example/0.mp4" },
				{ clipIndex: 1, status: "success", videoUrl: "https://cdn.example/1.mp4" },
			],
			nowIso: "2026-08-10T00:03:00.000Z",
		});
		expect(mocks.updateVideoRunProgress).not.toHaveBeenCalled();
		expect(mocks.synchronizeVideoProductionWorkflowRun).toHaveBeenCalledWith("run-1");
		expect(mocks.broadcastRunStatus).toHaveBeenCalledWith("project-1", expect.objectContaining({
			state: "concatenating",
			updatedAt: "2026-08-10T00:01:30.000Z",
		}));
	});
});
