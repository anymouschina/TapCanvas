-- Unified one-click video delivery graph.
--
-- Scope is deliberately data-only: the existing authoring_artifacts table is
-- already sufficient for graph manifests and node evidence. No BeatSheet,
-- media URL, provider task, billing record, or run lifecycle state is removed
-- or overwritten.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "video_runs"
    WHERE "beat_sheet" IS NOT NULL
      AND (
        jsonb_typeof("beat_sheet"::jsonb -> 'beats') <> 'array'
        OR jsonb_array_length("beat_sheet"::jsonb -> 'beats') = 0
      )
  ) THEN
    RAISE EXCEPTION 'unified_video_delivery_graph: BeatSheet beats must be a non-empty JSON array';
  END IF;
END $$;

WITH clip_indexes AS (
  SELECT
    run."id" AS run_id,
    ARRAY_AGG(DISTINCT (beat.value ->> 'clipIndex')::integer ORDER BY (beat.value ->> 'clipIndex')::integer) AS indexes
  FROM "video_runs" AS run
  CROSS JOIN LATERAL jsonb_array_elements(run."beat_sheet"::jsonb -> 'beats') AS beat(value)
  WHERE run."beat_sheet" IS NOT NULL
  GROUP BY run."id"
), graph_payloads AS (
  SELECT
    run_id,
    jsonb_build_object(
      'protocolVersion', '1',
      'runId', run_id,
      'nodes',
        jsonb_build_array(
          jsonb_build_object('key', 'beat_sheet', 'kind', 'beat_sheet', 'dependsOn', jsonb_build_array()),
          jsonb_build_object('key', 'asset:coverage', 'kind', 'asset_coverage', 'dependsOn', jsonb_build_array('beat_sheet'))
        )
        || (
          SELECT jsonb_agg(
            jsonb_build_object(
              'key', 'clip:' || clip_index,
              'kind', 'clip_writer',
              'clipIndex', clip_index,
              'dependsOn', jsonb_build_array('asset:coverage')
            ) ORDER BY clip_index
          )
          FROM unnest(indexes) AS clip_index
        )
        || jsonb_build_array(
          jsonb_build_object(
            'key', 'assembly:verification',
            'kind', 'assembly',
            'dependsOn', (SELECT jsonb_agg('clip:' || clip_index ORDER BY clip_index) FROM unnest(indexes) AS clip_index)
          ),
          jsonb_build_object(
            'key', 'estimate:auto',
            'kind', 'estimate',
            'dependsOn', jsonb_build_array('assembly:verification', 'asset:coverage')
          ),
          jsonb_build_object(
            'key', 'production:handoff',
            'kind', 'production_handoff',
            'dependsOn', jsonb_build_array('estimate:auto')
          )
        )
        || (
          SELECT jsonb_agg(
            jsonb_build_object(
              'key', 'video-submission:' || clip_index,
              'kind', 'video_submission',
              'clipIndex', clip_index,
              'dependsOn', jsonb_build_array('production:handoff')
            ) ORDER BY clip_index
          )
          FROM unnest(indexes) AS clip_index
        )
        || (
          SELECT jsonb_agg(
            jsonb_build_object(
              'key', 'video-result:' || clip_index,
              'kind', 'video_result',
              'clipIndex', clip_index,
              'dependsOn', jsonb_build_array('video-submission:' || clip_index)
            ) ORDER BY clip_index
          )
          FROM unnest(indexes) AS clip_index
        )
        || jsonb_build_array(
          jsonb_build_object(
            'key', 'concat:auto',
            'kind', 'concat',
            'dependsOn', (SELECT jsonb_agg('video-result:' || clip_index ORDER BY clip_index) FROM unnest(indexes) AS clip_index)
          ),
          jsonb_build_object(
            'key', 'delivery:verify',
            'kind', 'delivery_verify',
            'dependsOn', jsonb_build_array('concat:auto')
          )
        )
    ) AS payload
  FROM clip_indexes
)
INSERT INTO "authoring_artifacts" (
  "id",
  "run_id",
  "artifact_key",
  "content_hash",
  "derived_from",
  "status",
  "payload",
  "error",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  graph.run_id,
  'graph:manifest',
  md5(graph.payload::text),
  '["beat_sheet"]',
  'ready',
  graph.payload::text,
  NULL,
  run."updated_at",
  run."updated_at"
FROM graph_payloads AS graph
JOIN "video_runs" AS run ON run."id" = graph.run_id
ON CONFLICT ("run_id", "artifact_key") DO UPDATE SET
  "content_hash" = EXCLUDED."content_hash",
  "derived_from" = EXCLUDED."derived_from",
  "status" = EXCLUDED."status",
  "payload" = EXCLUDED."payload",
  "error" = NULL;

-- Clip writer output is downstream of verified real-asset coverage, not merely
-- of the textual BeatSheet. Existing payload/hash/status facts remain intact.
UPDATE "authoring_artifacts" AS artifact
SET "derived_from" = '["asset:coverage"]'
FROM "video_runs" AS run
WHERE run."id" = artifact."run_id"
  AND run."beat_sheet" IS NOT NULL
  AND artifact."artifact_key" LIKE 'clip:%'
  AND artifact."derived_from" <> '["asset:coverage"]';

-- Historical authoring_done means the production state machine already took
-- ownership. Preserve that handoff as a graph fact without claiming provider
-- acceptance, clip success, concat success, or final delivery.
WITH handoffs AS (
  SELECT
    run."id" AS run_id,
    jsonb_build_object(
      'runId', run."id",
      'migratedFromAuthoringState', run."authoring_state",
      'migratedFromProductionState', run."state"
    ) AS payload,
    run."updated_at" AS occurred_at
  FROM "video_runs" AS run
  WHERE run."beat_sheet" IS NOT NULL
    AND run."authoring_state" = 'authoring_done'
)
INSERT INTO "authoring_artifacts" (
  "id",
  "run_id",
  "artifact_key",
  "content_hash",
  "derived_from",
  "status",
  "payload",
  "error",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  handoff.run_id,
  'production:handoff',
  md5(handoff.payload::text),
  '["estimate:auto"]',
  'ready',
  handoff.payload::text,
  NULL,
  handoff.occurred_at,
  handoff.occurred_at
FROM handoffs AS handoff
ON CONFLICT ("run_id", "artifact_key") DO NOTHING;

-- Provider submission intent is downstream of the durable production handoff.
UPDATE "authoring_artifacts" AS artifact
SET "derived_from" = '["production:handoff"]'
FROM "video_runs" AS run
WHERE run."id" = artifact."run_id"
  AND run."beat_sheet" IS NOT NULL
  AND artifact."artifact_key" LIKE 'video-submission:%'
  AND artifact."derived_from" <> '["production:handoff"]';
