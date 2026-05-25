-- 001-seed-apimart-video-params.sql
-- Purpose: seed kind/capabilities/params_def for APIMart-backed video models
--          and their vendor-suffixed aliases.
-- Background: 2026-04-22/008-add-apimart-channel.sql created the APIMart
--             model ids, but those rows never received params_def, so
--             GET /api/models/list returned video models with no runtime
--             parameter metadata. TapCanvas frontend therefore could not
--             expose duration / aspect ratio / resolution controls.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- veo3.1-fast / veo3.1-fast-apimart
UPDATE models
SET kind         = 'video',
    capabilities = '["reference_images","first_last_frame"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":8,
       "options":[{"value":4,"label":"4s"},{"value":6,"label":"6s"},{"value":8,"label":"8s"}]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
       "options":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"},{"value":"4k","label":"4K"}]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('veo3.1-fast', 'veo3.1-fast-apimart')
  AND deleted_at IS NULL;

-- kling-v3 / kling-v3-apimart
UPDATE models
SET kind         = 'video',
    capabilities = '["reference_images","first_last_frame"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":5,
       "options":[
         {"value":3,"label":"3s"},{"value":4,"label":"4s"},{"value":5,"label":"5s"},
         {"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},
         {"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},
         {"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},
         {"value":15,"label":"15s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
         {"value":"1:1","label":"1:1","aspectRatio":"1:1"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
       "options":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('kling-v3', 'kling-v3-apimart')
  AND deleted_at IS NULL;

-- doubao-seedance-2.0 / doubao-seedance-2.0-apimart
UPDATE models
SET kind         = 'video',
    capabilities = '["reference_images","first_last_frame"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":4,
       "options":[
         {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
         {"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},
         {"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},
         {"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"21:9","label":"21:9","aspectRatio":"21:9","orientation":"landscape"},
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"4:3","label":"4:3","aspectRatio":"4:3","orientation":"landscape"},
         {"value":"1:1","label":"1:1","aspectRatio":"1:1"},
         {"value":"3:4","label":"3:4","aspectRatio":"3:4","orientation":"portrait"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"480p",
       "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('doubao-seedance-2.0', 'doubao-seedance-2.0-apimart')
  AND deleted_at IS NULL;

-- doubao-seedance-2.0-fast / doubao-seedance-2.0-fast-apimart
UPDATE models
SET kind         = 'video',
    capabilities = '["reference_images","first_last_frame"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":4,
       "options":[
         {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
         {"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},
         {"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},
         {"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"21:9","label":"21:9","aspectRatio":"21:9","orientation":"landscape"},
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"4:3","label":"4:3","aspectRatio":"4:3","orientation":"landscape"},
         {"value":"1:1","label":"1:1","aspectRatio":"1:1"},
         {"value":"3:4","label":"3:4","aspectRatio":"3:4","orientation":"portrait"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"480p",
       "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('doubao-seedance-2.0-fast', 'doubao-seedance-2.0-fast-apimart')
  AND deleted_at IS NULL;

COMMIT;
