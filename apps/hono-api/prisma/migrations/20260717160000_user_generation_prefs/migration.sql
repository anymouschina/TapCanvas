-- 【用户全局生成偏好·2026-07-17】AI 对话入口的 生图模型/视频模型/规格 偏好，JSON 文本列。
-- 幂等可重放；存量行默认 NULL（全走系统默认）。禁 DropTable/DropColumn。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "generation_prefs" TEXT;
