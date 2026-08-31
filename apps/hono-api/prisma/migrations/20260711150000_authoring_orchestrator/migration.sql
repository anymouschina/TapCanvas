-- 【编排域状态机 P1·2026-07-11】spec：docs/superpowers/specs/2026-07-11-authoring-orchestrator-ddd-design.md
-- 幂等迁移（IF NOT EXISTS）：迁移链已断禁 prisma migrate dev 生成，手写、可重放（模板=20260707000000_video_runs_narrative_meta）。

-- video_runs：BeatSheet 原子产物 + authoring 创作态（null=旧 agent 驱动路径，双轨判据）。
ALTER TABLE "video_runs" ADD COLUMN IF NOT EXISTS "beat_sheet" TEXT;
ALTER TABLE "video_runs" ADD COLUMN IF NOT EXISTS "authoring_state" TEXT;
CREATE INDEX IF NOT EXISTS "idx_video_runs_authoring_state" ON "video_runs"("authoring_state", "updated_at");

-- chapters：章级改编合同（run 只引用；重制 run 声明与章合同 diff→弱化/删项确定性告警）。
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "adaptation_contract" TEXT;

-- 8.1 build-system 底座：创作半场原子产物登记（内容 hash + 依赖边 + 状态）。
CREATE TABLE IF NOT EXISTS "authoring_artifacts" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "artifact_key" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "derived_from" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "payload" TEXT,
  "error" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "authoring_artifacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_authoring_artifacts_run_key" ON "authoring_artifacts"("run_id", "artifact_key");
CREATE INDEX IF NOT EXISTS "idx_authoring_artifacts_run_status" ON "authoring_artifacts"("run_id", "status");
