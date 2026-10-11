-- Bootstrap the Factory API-key pool management surface (Droid channel 77).
-- PostgreSQL deployment data patch; no schema migration or private credentials.
--
-- The empty pool is visible in Account Sessions, but cannot relay requests:
-- it has no keys, models, protocol bindings, prices, or abilities and is
-- manually disabled. Administrators import their own Factory keys, select
-- authorized models from the dynamic catalog, configure explicit per-model
-- Droid protocols and pricing, then explicitly enable the channel.
--
-- An existing Droid channel already provides this management surface. Leave
-- all existing channels, credentials, account states, usage and configuration
-- untouched, including channels renamed or customized by administrators.
-- Repeated or concurrent application must not create another empty pool.

\set ON_ERROR_STOP on

BEGIN;

-- Channel names have no unique constraint. Serialize the existence check and
-- insert against other patch runs and channel writes within this transaction.
LOCK TABLE channels IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  seeded_channel_id channels.id%TYPE;
BEGIN
  IF (SELECT COUNT(*) FROM channels WHERE name = 'droid-factory') > 1 THEN
    RAISE EXCEPTION 'expected at most one droid-factory channel';
  END IF;

  IF EXISTS (
    SELECT 1 FROM channels WHERE name = 'droid-factory' AND type IS DISTINCT FROM 77
  ) THEN
    RAISE EXCEPTION 'droid-factory name is occupied by a non-Droid channel';
  END IF;

  INSERT INTO channels (
    name, type, "group", models, model_mapping, status, base_url, key,
    created_time, test_time, priority, weight, tag, setting, test_model,
    auto_ban, param_override, header_override, remark, channel_info
  )
  SELECT
    'droid-factory',
    77,
    'default',
    '',
    NULL,
    2,
    'https://api.factory.ai',
    '',
    EXTRACT(EPOCH FROM NOW())::bigint,
    0,
    0,
    100,
    'droid-factory',
    '{"model_protocols":{}}',
    '',
    1,
    NULL,
    NULL,
    'Factory API Key pool; import keys and configure authorized models, explicit Droid protocols and pricing before enabling',
    '{"is_multi_key":true,"multi_key_size":0,"multi_key_status_list":{},"multi_key_polling_index":0,"multi_key_mode":"polling"}'
  WHERE NOT EXISTS (SELECT 1 FROM channels WHERE type = 77)
  RETURNING id INTO seeded_channel_id;

  -- Validate only the new seed. Existing administrator-managed configuration
  -- is not deployment-owned and must neither be rewritten nor revalidated
  -- against the empty-pool defaults on a later application.
  IF seeded_channel_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM channels AS channel
      WHERE channel.id = seeded_channel_id
        AND channel.type = 77
        AND channel.status = 2
        AND channel.key = ''
        AND channel.models = ''
        AND channel.base_url = 'https://api.factory.ai'
        AND channel.setting::jsonb = '{"model_protocols":{}}'::jsonb
        AND channel.channel_info::jsonb = '{"is_multi_key":true,"multi_key_size":0,"multi_key_status_list":{},"multi_key_polling_index":0,"multi_key_mode":"polling"}'::jsonb
        AND NOT EXISTS (
          SELECT 1 FROM abilities WHERE channel_id = seeded_channel_id
        )
    ) THEN
      RAISE EXCEPTION 'Factory/Droid empty-pool seed invariant failed';
    END IF;
  END IF;
END
$$;

COMMIT;
