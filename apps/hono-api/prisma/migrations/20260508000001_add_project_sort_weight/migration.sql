ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sort_weight" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "idx_projects_sort_weight" ON "projects"("sort_weight" DESC);
