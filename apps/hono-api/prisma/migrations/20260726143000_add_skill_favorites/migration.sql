CREATE TABLE "skill_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "skill_key" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "skill_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_skill_favorites_user_skill"
ON "skill_favorites"("user_id", "skill_key");

CREATE INDEX "idx_skill_favorites_user_created"
ON "skill_favorites"("user_id", "created_at" DESC);

ALTER TABLE "skill_favorites"
ADD CONSTRAINT "skill_favorites_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;
