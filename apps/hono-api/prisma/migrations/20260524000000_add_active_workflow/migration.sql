-- Add active_workflow to projects for tracking which AI workflow is active
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "active_workflow" TEXT NOT NULL DEFAULT 'free_canvas';
