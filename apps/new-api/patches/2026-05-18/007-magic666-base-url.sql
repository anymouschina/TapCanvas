-- 007-magic666-base-url.sql
-- Purpose: point the existing Magic666 channel at the current upstream host.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET base_url = 'http://152.53.38.70:3001'
WHERE name = 'magic666'
  AND type = 62;

COMMIT;
