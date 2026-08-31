-- video_runs 叙事元数据两列（film_bible / adaptation_strategy）
--
-- 背景：这两列 2026-07-04 起由 `db:update:local`（prisma db push）加在本地库，
-- 一直没有对应 migration —— 远端环境 `migrate deploy` 报 "No pending migrations"
-- 却缺列，video_runs 的一切 Prisma 查询直接报
-- "column video_runs.film_bible does not exist"（2026-07-07 zezhou 环境实测，
-- 画布轮询每次都在炸）。
--
-- 用 IF NOT EXISTS 幂等：已经 db push 过的环境（本地）重放为 no-op，
-- 缺列的环境（远端）补列。
ALTER TABLE "video_runs" ADD COLUMN IF NOT EXISTS "film_bible" TEXT;
ALTER TABLE "video_runs" ADD COLUMN IF NOT EXISTS "adaptation_strategy" TEXT;
