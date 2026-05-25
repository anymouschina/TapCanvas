-- 001-redirect-gemini-channels-to-beqlee-proxy.sql
-- Purpose: redirect all existing Gemini channels (type=24) from the official
--   generativelanguage.googleapis.com to the CF Worker proxy
--   generativelanguage.beqlee.icu, which forwards transparently.
-- Idempotent: channels already using the proxy or a custom base_url are skipped.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET base_url = 'https://generativelanguage.beqlee.icu'
WHERE type = 24
  AND (
    base_url = 'https://generativelanguage.googleapis.com'
    OR base_url = ''
    OR base_url IS NULL
  );

\echo '----- Gemini channels after redirect -----'
SELECT id, name, status, base_url
FROM channels
WHERE type = 24
ORDER BY id;

COMMIT;
