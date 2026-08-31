-- The vector-only runtime knowledge retriever owns this infrastructure table directly.
-- It is intentionally not represented in Prisma Client because vector(2048) is
-- not a Prisma scalar; application code uses the typed agents-cli store instead.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_knowledge_vectors (
    source_root TEXT NOT NULL,
    card_id TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    source_path TEXT NOT NULL,
    domain TEXT NOT NULL,
    facet TEXT,
    title TEXT NOT NULL,
    role_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
    keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    body TEXT NOT NULL,
    embedding vector(2048) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_root, card_id)
);

CREATE INDEX IF NOT EXISTS agent_knowledge_vectors_source_model_idx
    ON agent_knowledge_vectors (source_root, embedding_model);
