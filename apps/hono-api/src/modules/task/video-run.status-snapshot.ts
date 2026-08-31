import {
  VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  parseVideoRunStatusEvent,
  type VideoRunStatusEvent,
  type VideoRunStatusSnapshot,
} from "@tapcanvas/video-orchestrator-protocol";

import {
  getAuthoringClipProgressByRunIds,
  getChapterTitlesByIds,
  getVideoRunStatusWatermarkForChapter,
  getVideoRunStatusWatermarkForProject,
  listActiveVideoRunsForChapter,
  listActiveVideoRunsForProject,
  type VideoRunRow,
} from "./video-run.repo";

export function readAuthoringTotalClips(run: Pick<VideoRunRow, "id" | "beat_sheet">): number {
  if (!run.beat_sheet) return 0;
  const parsed: unknown = JSON.parse(run.beat_sheet);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`video run ${run.id} beat_sheet must be an object`);
  }
  const beats = (parsed as Record<string, unknown>).beats;
  if (!Array.isArray(beats)) {
    throw new Error(`video run ${run.id} beat_sheet.beats must be an array`);
  }
  return beats.length;
}

function buildRunStatusEvent(input: {
  run: VideoRunRow;
  authoringClipsReady: number;
  chapterTitle: string | null;
}): VideoRunStatusEvent {
  const candidate: unknown = {
    protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
    runId: input.run.id,
    flowId: input.run.flow_id,
    state: input.run.state,
    totalClips: input.run.total_clips,
    clipsDone: input.run.clips_done,
    errorMessage: input.run.error_message,
    completedAt: input.run.completed_at,
    authoringState: input.run.authoring_state,
    authoringClipsReady: input.authoringClipsReady,
    authoringTotalClips: readAuthoringTotalClips(input.run),
    chapterId: input.run.chapter_id,
    chapterTitle: input.chapterTitle,
    updatedAt: input.run.updated_at,
  };
  const parsed = parseVideoRunStatusEvent(candidate);
  if (!parsed.success) {
    throw new Error(`video run ${input.run.id} violates run-status contract: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function enrichSnapshotRuns(runs: readonly VideoRunRow[]): Promise<VideoRunStatusEvent[]> {
  const progress = await getAuthoringClipProgressByRunIds(runs.map((run) => run.id));
  const titles = await getChapterTitlesByIds(runs.map((run) => run.chapter_id));
  return runs.map((run) => buildRunStatusEvent({
    run,
    authoringClipsReady: progress[run.id]?.ready ?? 0,
    chapterTitle: run.chapter_id ? (titles[run.chapter_id] ?? null) : null,
  }));
}

/** Project canvas SSE handshake truth: one active-set snapshot plus a persisted ordering watermark. */
export async function buildProjectVideoRunStatusSnapshot(projectId: string): Promise<VideoRunStatusSnapshot> {
  const watermarkUpdatedAt = await getVideoRunStatusWatermarkForProject(projectId);
  const runs = await listActiveVideoRunsForProject(projectId);
  return {
    protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
    scopeType: "project",
    scopeId: projectId,
    generatedAt: new Date().toISOString(),
    watermarkUpdatedAt,
    runs: await enrichSnapshotRuns(runs),
  };
}

/** Chapter canvas SSE handshake truth; identical ordering semantics to the project scope. */
export async function buildChapterVideoRunStatusSnapshot(chapterId: string): Promise<VideoRunStatusSnapshot> {
  const watermarkUpdatedAt = await getVideoRunStatusWatermarkForChapter(chapterId);
  const runs = await listActiveVideoRunsForChapter(chapterId);
  return {
    protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
    scopeType: "chapter",
    scopeId: chapterId,
    generatedAt: new Date().toISOString(),
    watermarkUpdatedAt,
    runs: await enrichSnapshotRuns(runs),
  };
}
