-- 010-raise-apimart-priority.sql
-- Purpose: promote APIMart above the other providers so that any model id
--          served by multiple vendors (e.g. `gpt-image-2` on comfly+apimart,
--          `kling-v3` on yunwu-openai-video+apimart) routes to APIMart by
--          default. Operators can still flip individual abilities back via
--          the admin UI without editing a patch.
-- Strategy: raise priority to 1 on the apimart channel and on every
--          ability tagged 'apimart'. Weight stays at 0 so a single upstream
--          serves all traffic; bump both together if you add a second
--          apimart key and want round-robin.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

UPDATE channels
SET priority = 1
WHERE name = 'apimart' AND type = 59 AND "group" = 'default'
  AND priority < 1;

UPDATE abilities
SET priority = 1
WHERE tag = 'apimart'
  AND priority < 1;

COMMIT;
