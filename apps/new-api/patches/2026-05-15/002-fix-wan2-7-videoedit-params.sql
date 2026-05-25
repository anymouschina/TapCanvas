-- 002-fix-wan2-7-videoedit-params.sql
-- Purpose: fix params_def for wan2.7-videoedit — remove duration=0 ("保留原时长")
--   which caused ModelCatalogVideoDurationOptionSchema (value: z.number().positive())
--   to reject the entire durationOptions array → empty specCosts.
-- Also updates default duration from 0 to 5s.
--
-- Idempotent: the WHERE clause re-applies the correct state regardless of current value.
-- Scope: PostgreSQL, data-only.

\set ON_ERROR_STOP on

BEGIN;

UPDATE models
SET kind         = 'video',
    capabilities = '["reference_video","reference_images"]',
    params_def   = '[
      {"key":"duration","type":"enum","label":"时长","default":5,
       "options":[
         {"value":2,"label":"2s"},{"value":3,"label":"3s"},{"value":4,"label":"4s"},
         {"value":5,"label":"5s"},{"value":6,"label":"6s"},{"value":7,"label":"7s"},
         {"value":8,"label":"8s"},{"value":9,"label":"9s"},{"value":10,"label":"10s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
         {"value":"1:1","label":"1:1","aspectRatio":"1:1"},
         {"value":"4:3","label":"4:3","aspectRatio":"4:3"},
         {"value":"3:4","label":"3:4","aspectRatio":"3:4"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"1080P",
       "options":[
         {"value":"720P","label":"720P"},
         {"value":"1080P","label":"1080P"}
       ]}
    ]',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('wan2.7-videoedit', 'wan2.7-videoedit-apimart')
  AND deleted_at IS NULL;

\echo '----- wan2.7-videoedit params_def after fix -----'
SELECT model_name,
       (params_def::jsonb -> 0 ->> 'default')  AS duration_default,
       jsonb_array_length(params_def::jsonb -> 0 -> 'options') AS duration_option_count
FROM models
WHERE model_name IN ('wan2.7-videoedit', 'wan2.7-videoedit-apimart')
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
