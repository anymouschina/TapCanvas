-- 006-add-seedream-imagesize-param.sql
-- Purpose: 在 doubao-seedream-5-0 系列的 params_def 中添加 imageSize 参数（2k/3k/4k）。
--
-- 当前 params_def 只有 size（宽高比）和 n（生成数量），缺少分辨率档位选择。
-- ARK adaptor 从 Extra["imageSize"] 读取档位，结合 size（宽高比）查表得像素尺寸。

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
    {"key":"imageSize","type":"enum","label":"分辨率","default":"2k",
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

-- 验证：
-- SELECT model_name,
--        params_def::json->1->'key'       AS second_param_key,
--        params_def::json->1->'default'   AS second_param_default
-- FROM models
-- WHERE model_name LIKE 'doubao-seedream-5-0%'
--   AND deleted_at IS NULL
-- ORDER BY model_name;
