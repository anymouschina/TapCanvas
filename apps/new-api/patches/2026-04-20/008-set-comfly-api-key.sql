-- 008-set-comfly-api-key.sql
-- Purpose: Fix comfly channel base_url (api → ai) and ensure it is enabled.
-- The channel API key must be set once via the new-api admin UI or DB — not stored here.
-- Idempotent: safe to re-run.

BEGIN;

UPDATE channels
SET
  base_url = 'https://ai.comfly.chat',
  status   = 1
WHERE name = 'comfly'
  AND type = 1;

COMMIT;
