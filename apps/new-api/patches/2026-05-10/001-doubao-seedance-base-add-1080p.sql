-- 001-doubao-seedance-base-add-1080p.sql
-- Purpose: add 1080p resolution option to doubao-seedance-2.0 and
--          doubao-seedance-2.0-fast params_def.
--
-- Background:
--   The original seed patch only included 480p and 720p in the resolution
--   param options for these base models. 1080p was surfaced in hono-api via a
--   model_catalog_models meta override, not via new-api. Now that new-api is the
--   single source of truth for model metadata, the option must live here.
--   doubao-seedance-2.0-fast-face intentionally has no 1080p (not supported).
--   doubao-seedance-2.0-face already has 1080p in params_def — no change needed.
--
-- Idempotent: jsonb_set with the full resolution block; safe to re-run.
-- Scope: PostgreSQL (new-api DB), data-only.

\set ON_ERROR_STOP on

BEGIN;

UPDATE models
SET params_def = (
  SELECT jsonb_agg(
    CASE
      WHEN (elem->>'key') = 'resolution'
      THEN jsonb_set(
        elem,
        '{options}',
        '[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]'::jsonb
      )
      ELSE elem
    END
  )
  FROM jsonb_array_elements(params_def::jsonb) AS elem
)::text,
updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
  'doubao-seedance-2.0',
  'doubao-seedance-2.0-apimart',
  'doubao-seedance-2.0-fast',
  'doubao-seedance-2.0-fast-apimart'
);

\echo '----- resolution options after patch -----'
SELECT
  model_name,
  jsonb_path_query_array(params_def::jsonb, '$[*] ? (@.key == "resolution").options[*].value') AS resolutions
FROM models
WHERE model_name IN (
  'doubao-seedance-2.0',
  'doubao-seedance-2.0-apimart',
  'doubao-seedance-2.0-fast',
  'doubao-seedance-2.0-fast-apimart'
)
ORDER BY model_name;

COMMIT;
