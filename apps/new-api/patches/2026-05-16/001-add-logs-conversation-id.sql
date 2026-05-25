-- 001-add-logs-conversation-id.sql
-- Purpose: add conversation_id column to logs table and create a supporting index.
--
-- Background:
--   Web 端发起的一次完整对话可能触发多次 new-api LLM 调用。
--   agents-cli 在每次调用中透传 x-tapcanvas-conversation-id header。
--   此列用于在使用日志中将同一会话的多条调用聚合展示，方便按会话维度统计
--   token 消耗、耗时、调用次数等指标。
--   GORM AutoMigrate 会在 dev/SQLite 环境自动兜底补列；
--   此 patch 用于 production PostgreSQL，确保列和索引在迁移前即存在。
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS；可安全重复执行。
-- Scope: PostgreSQL (new-api DB), DDL only.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE logs ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(64) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_logs_conversation_id ON logs(conversation_id);

\echo '----- logs.conversation_id column after patch -----'
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'logs' AND column_name = 'conversation_id';

COMMIT;
