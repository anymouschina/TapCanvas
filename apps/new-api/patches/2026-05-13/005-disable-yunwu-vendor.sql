-- 005-disable-yunwu-vendor.sql
-- Purpose: hard-disable the Yunwu (云雾 AI) vendor across every layer.
--
-- Background:
--   Yunwu is the older upstream we used before APIMart became primary. Its
--   models (e.g. id=7 'kling-v3') still appear in /api/models/list because
--   they sit at status=1, but their pricing is configured as a flat per-call
--   credit (e.g. 14 credits) with no per-spec breakdown — confusing to end
--   users and irrelevant now that APIMart equivalents (kling-v3-apimart etc.)
--   carry full per-resolution × per-duration pricing.
--
-- This patch flips three switches so Yunwu disappears from every consumer:
--   1. models.status = 0          for every row with vendor_id = '云雾 AI'
--      → GetModelList (status=1 filter) stops returning them.
--   2. channels.status = 2        (ChannelStatusManuallyDisabled) for every
--      channel with name LIKE 'yunwu%'
--      → relay router stops dispatching to Yunwu.
--   3. abilities.enabled = false  for every ability bound to a Yunwu channel
--      → GetAllEnableAbilityWithChannels stops reporting these models.
--
-- All three statements are idempotent and re-runnable.
-- Scope: PostgreSQL, data-only.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: disable models owned by 云雾 AI ─────────────────────────────────

UPDATE models
SET status       = 0,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND status = 1
  AND vendor_id = (
    SELECT id FROM vendors
    WHERE name = '云雾 AI' AND deleted_at IS NULL
    LIMIT 1
  );

-- ── Step 2: disable yunwu-* channels ────────────────────────────────────────
-- ChannelStatusManuallyDisabled = 2 (apps/new-api/common/constants.go:219).

UPDATE channels
SET status = 2
WHERE name LIKE 'yunwu%'
  AND status <> 2;

-- ── Step 3: disable abilities bound to yunwu channels ───────────────────────

UPDATE abilities
SET enabled = false
WHERE enabled = true
  AND channel_id IN (
    SELECT id FROM channels WHERE name LIKE 'yunwu%'
  );

\echo '----- Yunwu disable report -----'
SELECT 'models disabled' AS what, COUNT(*) AS n
FROM models
WHERE vendor_id = (SELECT id FROM vendors WHERE name = '云雾 AI' AND deleted_at IS NULL LIMIT 1)
  AND status = 0
  AND deleted_at IS NULL
UNION ALL
SELECT 'channels disabled', COUNT(*) FROM channels WHERE name LIKE 'yunwu%' AND status = 2
UNION ALL
SELECT 'abilities disabled', COUNT(*)
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.name LIKE 'yunwu%' AND a.enabled = false;

COMMIT;
