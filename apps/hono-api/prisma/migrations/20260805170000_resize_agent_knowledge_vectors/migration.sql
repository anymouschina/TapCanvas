-- The Ark doubao-embedding-vision-251215 model returns 2048-dimensional vectors.
-- Reindexing is an explicit hard cutover: clear existing vectors, resize the
-- infrastructure column, then repopulate it from the current knowledge cards.
TRUNCATE TABLE agent_knowledge_vectors;

ALTER TABLE agent_knowledge_vectors
  ALTER COLUMN embedding TYPE vector(2048)
  USING embedding::vector(2048);
