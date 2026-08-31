ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "max_members" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "team_project_shares" (
  "project_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "access" TEXT NOT NULL DEFAULT 'edit',
  "shared_by_user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "team_project_shares_pkey" PRIMARY KEY ("project_id", "team_id"),
  CONSTRAINT "team_project_shares_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "team_project_shares_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "team_project_shares_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_team_project_shares_team"
  ON "team_project_shares" ("team_id", "updated_at");
