-- Add meta column to llm_node_presets for storing JSON metadata
-- (e.g. referenceImageUrl for style reference cards)
ALTER TABLE "llm_node_presets" ADD COLUMN "meta" TEXT;
