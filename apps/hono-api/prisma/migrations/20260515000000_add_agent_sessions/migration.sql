-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "last_response_id" TEXT,
    "last_sync_index" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_session_messages" (
    "session_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "message" JSONB NOT NULL,

    CONSTRAINT "agent_session_messages_pkey" PRIMARY KEY ("session_id","seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_session_key_key" ON "agent_sessions"("session_key");

-- CreateIndex
CREATE INDEX "agent_sessions_user_id_idx" ON "agent_sessions"("user_id");

-- CreateIndex
CREATE INDEX "agent_sessions_session_key_idx" ON "agent_sessions"("session_key");

-- CreateIndex
CREATE INDEX "agent_session_messages_session_id_idx" ON "agent_session_messages"("session_id");

-- AddForeignKey
ALTER TABLE "agent_session_messages" ADD CONSTRAINT "agent_session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
