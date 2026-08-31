-- 工作流装配给小T的作用范围：current_user=仅装配用户可见/可用（默认），
-- all_users=管理员发布的系统级工作流，全体用户可见/可用。
ALTER TABLE "agent_capability_attachments"
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'current_user';

CREATE INDEX IF NOT EXISTS "idx_agent_capability_attachments_scope"
  ON "agent_capability_attachments"("scope");
