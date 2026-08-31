-- 【画布多 tab 版本号防覆盖·2026-07-15】flows 表加乐观锁版本号列。
-- 入口 A(POST /flows) 的 source:'user' 保存据此挡旧覆盖新 → 前端 409 强制刷新。
-- 幂等可重放；存量行默认 0，不影响现有数据。禁 DropTable/DropColumn。
ALTER TABLE "flows" ADD COLUMN IF NOT EXISTS "canvas_revision" INTEGER NOT NULL DEFAULT 0;
