-- 【章级出片规格·2026-07-11 ch17 clipChaining 丢失根治】用户在成片规格弹窗的选择（画幅/分辨率/
-- 镜头衔接/质检/自由度/备注）持久化到章，estimate/commit_beats 服务端权威合并——规格不再只活在
-- 对话链路一瞬（画幅 localStorage 不进链路是同类旧病）。幂等可重放。
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "film_spec" TEXT;
