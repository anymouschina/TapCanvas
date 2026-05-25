-- 002-sync-yunwu-gemini-model-mapping.sql
-- Purpose: ensure channels.yunwu-gemini.model_mapping rewrites TapCanvas image
--   aliases (nanobanana2 / nano-banana-fast / nano-banana-pro) to the upstream
--   Gemini official model names before the adaptor's imagine-whitelist check.
-- Background:
--   new-api's Gemini adaptor (relay/channel/gemini/adaptor.go:124) rejects any
--   request whose UpstreamModelName is NOT in the hard-coded whitelist in
--   setting/model_setting/gemini.go:27:
--     gemini-2.0-flash-exp-image-generation, gemini-2.0-flash-exp,
--     gemini-3-pro-image-preview, gemini-2.5-flash-image,
--     gemini-3.1-flash-image-preview
--   Abilities route the aliases to yunwu-gemini as-is, so without model_mapping
--   the request is denied with:
--     "not supported model for image generation, only imagen and gemini imagine
--      models are supported"
-- Why unconditional overwrite (no merge):
--   A previous revision of this patch attempted
--     SET model_mapping = (COALESCE(NULLIF(TRIM(model_mapping),'')::jsonb,'{}') || NEW)::text
--   to preserve operator-added mappings. In production the column default from
--   patches/2026-04-18/003 is the literal string 'null' (JSON null scalar),
--   NOT NULL / not empty. TRIM + NULLIF kept it as 'null', which casts to a
--   jsonb null, and `jsonb_null || jsonb_object` in PostgreSQL performs
--   ARRAY CONCATENATION, producing `[null, {...}]`. Go's json.Unmarshal into
--   map[string]string then fails with `unmarshal_model_mapping_failed` on
--   every relay call (relay/helper/model_mapped.go:29-34).
--   The 3 alias→official rewrites are fully owned by this patch and nobody
--   else should be adding mappings to this channel, so unconditional overwrite
--   is both safer (self-healing from any corrupted prior state) and simpler.
-- Pairs with: 001-sync-yunwu-gemini-model-aliases.sql (which keeps channels.models
--   consistent). Both patches fixate state that was previously only added via the
--   admin UI on the local DB, keeping production deployments aligned.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

UPDATE channels
SET model_mapping = '{
  "nanobanana2":      "gemini-3.1-flash-image-preview",
  "nano-banana-fast": "gemini-2.5-flash-image",
  "nano-banana-pro":  "gemini-3-pro-image-preview"
}'
WHERE name = 'yunwu-gemini'
  AND type = 24
  AND "group" = 'default';

COMMIT;
