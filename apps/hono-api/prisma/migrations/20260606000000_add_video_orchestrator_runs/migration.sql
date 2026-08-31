-- 视频成片编排 run 的持久化 StoryPlan，供后台 worker 脱离 agent 续跑（reconcile→续写→concat）。
-- 纯增表，幂等，不删不改现有表。
-- state: pending（未拼接完成，worker 继续 drive）| done（state==concatenated）| failed（终态失败）。
CREATE TABLE IF NOT EXISTS "video_orchestrator_runs" (
    "run_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "chapter_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "story_plan_json" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "last_orchestrate_state" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "video_orchestrator_runs_pkey" PRIMARY KEY ("run_id")
);

CREATE INDEX IF NOT EXISTS "idx_video_orchestrator_runs_state_updated" ON "video_orchestrator_runs"("state", "updated_at");
