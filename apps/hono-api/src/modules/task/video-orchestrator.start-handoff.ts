import type { AppContext } from "../../types";
import {
  insertVideoRun,
  type VideoRunRow,
} from "./video-run.repo";
import {
  upsertVideoRunStatusNode,
  type VideoRunStatusProjection,
} from "./video-orchestrator.status-node";

type InsertVideoRunInput = Parameters<typeof insertVideoRun>[0];
type StartedVideoRunInput = Omit<InsertVideoRunInput, "storyPlan"> & {
  /** 已通过版本与内容哈希校验的完整 executable-plan 信封，不是 validateStoryPlan 的业务投影。 */
  durableExecutablePlan: Record<string, unknown>;
};

export type StartedVideoRunHandoff = {
  run: VideoRunRow;
  statusProjection: VideoRunStatusProjection;
};

/** 持久化真实起跑状态，并把同一事实投影到幂等画布状态节点。 */
export async function persistStartedVideoRunHandoff(input: {
  c: AppContext;
  run: StartedVideoRunInput;
}): Promise<StartedVideoRunHandoff> {
  const { durableExecutablePlan, ...runFields } = input.run;
  const run = await insertVideoRun({ ...runFields, storyPlan: durableExecutablePlan });
  const statusProjection = await upsertVideoRunStatusNode({
    c: input.c,
    runId: run.id,
    runCreatedAt: run.created_at,
    ownerId: run.owner_id,
    flowId: run.flow_id,
    chapterId: run.chapter_id,
    authoringState: run.authoring_state,
    productionState: run.state,
    statusLine: `${run.clips_done}/${run.total_clips} 镜头完成\n等待生成`,
  });
  return { run, statusProjection };
}
