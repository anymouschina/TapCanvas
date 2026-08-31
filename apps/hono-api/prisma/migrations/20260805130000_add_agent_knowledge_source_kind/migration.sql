ALTER TABLE agent_knowledge_vectors
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'filesystem';

ALTER TABLE agent_knowledge_vectors
  DROP CONSTRAINT IF EXISTS agent_knowledge_vectors_source_kind_check;

ALTER TABLE agent_knowledge_vectors
  ADD CONSTRAINT agent_knowledge_vectors_source_kind_check
  CHECK (source_kind IN ('filesystem', 'admin'));
