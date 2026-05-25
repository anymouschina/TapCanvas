-- 007-fix-seedream-imagesize-key.sql
-- Purpose: 把 params_def 中分辨率参数的 key 从 "imageSize" 改为 "image_size"。
--
-- hono-api 的 paramsToImageOptions 查找 key === "image_size"（下划线），
-- 006 patch 误写为 "imageSize"（驼峰），导致 imageSizeOptions 始终为空。

BEGIN;

UPDATE models
SET params_def = $pd$[
    {"key":"size","type":"enum","label":"宽高比","default":"1:1",
     "options":[
       {"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9 横"},
       {"value":"9:16","label":"9:16 竖"},{"value":"4:3","label":"4:3"},
       {"value":"3:4","label":"3:4"},{"value":"3:2","label":"3:2"},
       {"value":"2:3","label":"2:3"},{"value":"21:9","label":"21:9 超宽"}
     ]},
    {"key":"image_size","type":"enum","label":"分辨率","default":"2k",
     "options":[
       {"value":"2k","label":"2K"},
       {"value":"3k","label":"3K"},
       {"value":"4k","label":"4K"}
     ]},
    {"key":"n","type":"integer","label":"生成数量","min":1,"max":10,"default":1}
  ]$pd$,
updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN (
    'doubao-seedream-5-0',
    'doubao-seedream-5-0-260128',
    'doubao-seedream-5-0-lite',
    'doubao-seedream-5-0-lite-260128'
)
  AND deleted_at IS NULL;

COMMIT;
