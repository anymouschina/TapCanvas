-- 002-disable-nano-banana-aliases.sql
-- Purpose: disable nanobanana2 / nano-banana-fast / nano-banana-pro and their
--          -suchuang channel variants as standalone listed models.
--          These are yunwu/suchuang routing aliases for gemini-3.1-flash-image-preview,
--          gemini-3-pro-image-preview, and gemini-2.5-flash-image-preview respectively.
--          Now that the canonical gemini-* keys are registered and enabled directly,
--          the aliases produce duplicate entries in the public model list.
--          They remain in channel model lists for routing purposes.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

UPDATE models
SET    status       = 0,
       updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE  model_name IN (
         'nanobanana2',          'nano-banana-fast',          'nano-banana-pro',
         'nanobanana2-suchuang', 'nano-banana-fast-suchuang', 'nano-banana-pro-suchuang'
       )
  AND  deleted_at IS NULL
  AND  status != 0;

COMMIT;
