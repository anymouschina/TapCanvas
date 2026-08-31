-- Add clone_count to projects for tracking template usage
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "clone_count" INTEGER NOT NULL DEFAULT 0;
