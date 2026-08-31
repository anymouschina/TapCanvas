import { broadcastRunStatus } from "../chapter/canvas-sse.manager";
import { persistProductionGraphEvidence } from "./video-orchestrator.production-graph-persistence";
import { synchronizeVideoProductionWorkflowRun } from "./video-production-workflow-runtime";
import {
	getAuthoringClipProgressByRunIds,
	getChapterTitlesByIds,
	getProjectIdForFlow,
	updateVideoRunProgress,
	type VideoRunRow,
} from "./video-run.repo";
import { readAuthoringTotalClips } from "./video-run.status-snapshot";

async function resolveProjectId(run: VideoRunRow): Promise<string | null> {
	if (run.project_id) return run.project_id;
	return run.flow_id ? await getProjectIdForFlow(run.flow_id) : null;
}

async function resolveChapterTitle(chapterId: string | null): Promise<string | null> {
	if (!chapterId) return null;
	const titles = await getChapterTitlesByIds([chapterId]);
	return titles[chapterId] ?? null;
}

/**
 * Cross the durable composition boundary before starting the blocking external
 * concat call. At this boundary every clip already has a real durable URL, so
 * `concatenating` and `total/total` are observed facts rather than estimated
 * progress. Persistence failure prevents the external call from starting.
 */
export async function persistVideoRunConcatenatingPhase(input: {
	run: VideoRunRow;
	clips: unknown;
	nowIso: string;
}): Promise<void> {
	await persistProductionGraphEvidence({
		run: input.run,
		orchestration: {
			state: "concatenating",
			clips: input.clips,
		},
		nowIso: input.nowIso,
	});
	if (input.run.state !== "concatenating") {
		await updateVideoRunProgress({
			runId: input.run.id,
			state: "concatenating",
			clipsDone: input.run.total_clips,
			nowIso: input.nowIso,
			errorMessage: null,
			completed: false,
		});
	}
	await synchronizeVideoProductionWorkflowRun(input.run.id);

	const projectId = await resolveProjectId(input.run);
	if (!projectId) return;
	const authoringProgress = await getAuthoringClipProgressByRunIds([input.run.id]);
	broadcastRunStatus(projectId, {
		runId: input.run.id,
		flowId: input.run.flow_id,
		state: "concatenating",
		totalClips: input.run.total_clips,
		clipsDone: input.run.total_clips,
		errorMessage: null,
		completedAt: null,
		authoringState: input.run.authoring_state,
		authoringClipsReady: authoringProgress[input.run.id]?.ready ?? 0,
		authoringTotalClips: readAuthoringTotalClips(input.run),
		updatedAt: input.run.state === "concatenating" ? input.run.updated_at : input.nowIso,
		chapterId: input.run.chapter_id,
		chapterTitle: await resolveChapterTitle(input.run.chapter_id),
	});
}
