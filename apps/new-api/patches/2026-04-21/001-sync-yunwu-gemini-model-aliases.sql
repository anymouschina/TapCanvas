-- 001-sync-yunwu-gemini-model-aliases.sql
-- Purpose: Ensure channels.yunwu-gemini.models contains the TapCanvas business
--   aliases (nanobanana2 / nano-banana-fast / nano-banana-pro) that abilities
--   already route to gemini-3.1-flash-image-preview / gemini-2.5-flash-image /
--   gemini-3-pro-image-preview on the yunwu-gemini channel.
-- Background:
--   patches/2026-04-18/003 and patches/2026-04-20/001 reset `models` to the 5
--   official Gemini model_names, so each redeploy dropped the aliases and
--   they only came back through manual admin UI edits. Abilities own the
--   actual routing; this patch keeps channels.models aligned so admin UI and
--   /api/channel/test stay honest and production matches the local state.
-- Regex guards:
--   `(^|,)<alias>(,|$)` ensures we match only a complete comma-separated token,
--   so `nano-banana-pro` is not falsely detected inside `nano-banana-pro-preview`.
-- Scope: PostgreSQL only, data-only, idempotent execution required.

BEGIN;

UPDATE channels
SET models = models || ',nanobanana2'
WHERE name = 'yunwu-gemini'
  AND type = 24
  AND "group" = 'default'
  AND models !~ '(^|,)nanobanana2(,|$)';

UPDATE channels
SET models = models || ',nano-banana-fast'
WHERE name = 'yunwu-gemini'
  AND type = 24
  AND "group" = 'default'
  AND models !~ '(^|,)nano-banana-fast(,|$)';

UPDATE channels
SET models = models || ',nano-banana-pro'
WHERE name = 'yunwu-gemini'
  AND type = 24
  AND "group" = 'default'
  AND models !~ '(^|,)nano-banana-pro(,|$)';

COMMIT;
