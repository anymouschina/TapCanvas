-- 002-seed-pricing-options.sql
-- Purpose: seed or upsert canonical option values required by the current local new-api setup.
-- Source: local tapcanvas_new_api canonical data as of 2026-04-18.
-- Scope: options only. This patch intentionally writes the exact keys that currently exist locally.

BEGIN;

INSERT INTO options (key, value)
VALUES
  ('DemoSiteEnabled', 'false'),
  ('ModelCapabilityCatalog', '{"version":"2026-04-18","updatedAt":"2026-04-18","sourcePolicy":"official_web_docs","notes":["This catalog stores generic model capability metadata for new-api. It is platform-neutral and must not contain TapCanvas-specific product semantics.","Capabilities below are sourced from official vendor documentation. Defaults such as defaultDurationSeconds/defaultResolution/defaultSize are operational defaults chosen from the documented supported set unless the vendor explicitly documents a default."],"sources":[{"id":"byteplus-seedance-2-0-series-tutorial","title":"Seedance 2.0 series tutorial","url":"https://docs.byteplus.com/en/docs/ModelArk/2291680","vendor":"byteplus","accessedAt":"2026-04-18","facts":["Seedance 2.0 and Seedance 2.0 Fast both support 480p and 720p output.","Seedance 2.0 and Seedance 2.0 Fast both support 4–15 second duration.","Supported aspect ratios: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16."]},{"id":"google-veo-3-1-model-doc","title":"Veo 3.1","url":"https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate-preview","vendor":"google","accessedAt":"2026-04-18","facts":["Veo 3.1 Generate supports 4, 6, or 8 second videos; reference image-to-video only supports 8 seconds.","Veo 3.1 Fast Generate supports 4, 6, or 8 second videos.","Supported aspect ratios: 16:9 and 9:16.","Supported output resolutions: 720p, 1080p, and 4k (preview)."]},{"id":"google-veo-first-last-frames-doc","title":"Generate videos with Veo on Vertex AI using first and last video frames","url":"https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-first-and-last-frames","vendor":"google","accessedAt":"2026-04-18","facts":["When using first and last frames, Veo 3 models accept duration 4, 6, or 8 seconds.","When using first and last frames, aspect ratio supports 16:9 or 9:16.","When using first and last frames, Veo 3 models support 720p, 1080p, and 4k (preview)."]},{"id":"kling-video-3-user-guide","title":"Kling VIDEO 3.0 Model User Guide","url":"https://app.klingai.com/global/quickstart/klingai-video-3-model-user-guide","vendor":"kling","accessedAt":"2026-04-18","facts":["Kling VIDEO 3.0 supports text-to-video, image-to-video, and start-and-end-frames-to-video.","Kling VIDEO 3.0 supports up to 15 seconds, with flexible duration from 3 to 15 seconds.","Kling VIDEO 3.0 pricing explicitly covers 1080p and 720p output."]},{"id":"kling-text-to-video-prompt-guide","title":"Kling AI Text-to-Video","url":"https://klingai.com/quickstart/text-to-video-prompt-guide","vendor":"kling","accessedAt":"2026-04-18","facts":["Kling supports Standard Mode and Professional Mode.","Kling supports aspect ratios 16:9, 9:16, and 1:1.","Official examples show 5-second and 10-second clips."]}],"models":{"doubao-seedance-2-0-260128":{"kind":"video","vendor":"ark","upstreamModelId":"dreamina-seedance-2-0-260128","provenance":{"sourceIds":["byteplus-seedance-2-0-series-tutorial"]},"videoOptions":{"defaultDurationSeconds":4,"defaultSize":"16:9","defaultResolution":"480p","durationOptions":[{"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}],"sizeOptions":[{"value":"21:9","label":"21:9","aspectRatio":"21:9","orientation":"landscape"},{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},{"value":"4:3","label":"4:3","aspectRatio":"4:3","orientation":"landscape"},{"value":"1:1","label":"1:1","aspectRatio":"1:1"},{"value":"3:4","label":"3:4","aspectRatio":"3:4","orientation":"portrait"},{"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}],"resolutionOptions":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}],"orientationOptions":[{"value":"landscape","label":"Landscape"},{"value":"portrait","label":"Portrait"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"size","label":"画幅","binding":"size","optionSource":"sizeOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"},{"key":"orientation","label":"方向","binding":"orientation","optionSource":"orientationOptions"}]}},"doubao-seedance-2-0-fast-260128":{"kind":"video","vendor":"ark","upstreamModelId":"dreamina-seedance-2-0-fast-260128","provenance":{"sourceIds":["byteplus-seedance-2-0-series-tutorial"]},"videoOptions":{"defaultDurationSeconds":4,"defaultSize":"16:9","defaultResolution":"480p","durationOptions":[{"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}],"sizeOptions":[{"value":"21:9","label":"21:9","aspectRatio":"21:9","orientation":"landscape"},{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},{"value":"4:3","label":"4:3","aspectRatio":"4:3","orientation":"landscape"},{"value":"1:1","label":"1:1","aspectRatio":"1:1"},{"value":"3:4","label":"3:4","aspectRatio":"3:4","orientation":"portrait"},{"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}],"resolutionOptions":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}],"orientationOptions":[{"value":"landscape","label":"Landscape"},{"value":"portrait","label":"Portrait"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"size","label":"画幅","binding":"size","optionSource":"sizeOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"},{"key":"orientation","label":"方向","binding":"orientation","optionSource":"orientationOptions"}]}},"veo3.1-pro":{"kind":"video","vendor":"veo","upstreamModelId":"veo-3.1-generate-001","provenance":{"sourceIds":["google-veo-3-1-model-doc"]},"videoOptions":{"defaultDurationSeconds":8,"defaultSize":"16:9","defaultResolution":"720p","durationOptions":[{"value":4,"label":"4s"},{"value":6,"label":"6s"},{"value":8,"label":"8s"}],"sizeOptions":[{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},{"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"},{"value":"4k","label":"4K"}],"orientationOptions":[{"value":"landscape","label":"Landscape","size":"16:9","aspectRatio":"16:9"},{"value":"portrait","label":"Portrait","size":"9:16","aspectRatio":"9:16"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"size","label":"画幅","binding":"size","optionSource":"sizeOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"},{"key":"orientation","label":"方向","binding":"orientation","optionSource":"orientationOptions"}]}},"veo_3_1":{"kind":"video","vendor":"veo","upstreamModelId":"veo-3.1-generate-001","provenance":{"sourceIds":["google-veo-3-1-model-doc"],"inferenceNotes":["This is a provider alias that maps to the official Veo 3.1 Generate capability set."]},"videoOptions":{"defaultDurationSeconds":8,"defaultSize":"16:9","defaultResolution":"720p","durationOptions":[{"value":4,"label":"4s"},{"value":6,"label":"6s"},{"value":8,"label":"8s"}],"sizeOptions":[{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},{"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"},{"value":"4k","label":"4K"}],"orientationOptions":[{"value":"landscape","label":"Landscape","size":"16:9","aspectRatio":"16:9"},{"value":"portrait","label":"Portrait","size":"9:16","aspectRatio":"9:16"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"size","label":"画幅","binding":"size","optionSource":"sizeOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"},{"key":"orientation","label":"方向","binding":"orientation","optionSource":"orientationOptions"}]}},"veo3.1-fast":{"kind":"video","vendor":"veo","upstreamModelId":"veo-3.1-fast-generate-001","provenance":{"sourceIds":["google-veo-3-1-model-doc"]},"videoOptions":{"defaultDurationSeconds":8,"defaultSize":"16:9","defaultResolution":"720p","durationOptions":[{"value":4,"label":"4s"},{"value":6,"label":"6s"},{"value":8,"label":"8s"}],"sizeOptions":[{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},{"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"},{"value":"4k","label":"4K"}],"orientationOptions":[{"value":"landscape","label":"Landscape","size":"16:9","aspectRatio":"16:9"},{"value":"portrait","label":"Portrait","size":"9:16","aspectRatio":"9:16"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"size","label":"画幅","binding":"size","optionSource":"sizeOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"},{"key":"orientation","label":"方向","binding":"orientation","optionSource":"orientationOptions"}]}},"veo_3_1-fast":{"kind":"video","vendor":"veo","upstreamModelId":"veo-3.1-fast-generate-001","provenance":{"sourceIds":["google-veo-3-1-model-doc"],"inferenceNotes":["This is a provider alias that maps to the official Veo 3.1 Fast Generate capability set."]},"videoOptions":{"defaultDurationSeconds":8,"defaultSize":"16:9","defaultResolution":"720p","durationOptions":[{"value":4,"label":"4s"},{"value":6,"label":"6s"},{"value":8,"label":"8s"}],"sizeOptions":[{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},{"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"},{"value":"4k","label":"4K"}],"orientationOptions":[{"value":"landscape","label":"Landscape","size":"16:9","aspectRatio":"16:9"},{"value":"portrait","label":"Portrait","size":"9:16","aspectRatio":"9:16"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"size","label":"画幅","binding":"size","optionSource":"sizeOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"},{"key":"orientation","label":"方向","binding":"orientation","optionSource":"orientationOptions"}]}},"veo_3_1_i2v_s_fast_fl_landscape":{"kind":"video","vendor":"veo","upstreamModelId":"veo-3.1-fast-generate-001","provenance":{"sourceIds":["google-veo-3-1-model-doc","google-veo-first-last-frames-doc"],"inferenceNotes":["This catalog entry is a provider alias rather than an official Google model id.","Capabilities are mapped from the official Veo 3.1 Fast + first/last-frame documentation and narrowed to fixed landscape output because the alias name itself declares landscape."]},"videoOptions":{"defaultDurationSeconds":8,"defaultSize":"16:9","defaultResolution":"720p","defaultOrientation":"landscape","durationOptions":[{"value":4,"label":"4s"},{"value":6,"label":"6s"},{"value":8,"label":"8s"}],"sizeOptions":[{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"},{"value":"4k","label":"4K"}],"orientationOptions":[{"value":"landscape","label":"Landscape","size":"16:9","aspectRatio":"16:9"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"}]}},"kling-v3":{"kind":"video","vendor":"yunwu","upstreamModelId":"kling-v3","provenance":{"sourceIds":["kling-video-3-user-guide","kling-text-to-video-prompt-guide"],"inferenceNotes":["defaultDurationSeconds=5 and defaultSize=16:9 are operational defaults chosen from the documented supported set."]},"videoOptions":{"defaultDurationSeconds":5,"defaultSize":"16:9","defaultResolution":"720p","durationOptions":[{"value":3,"label":"3s"},{"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}],"sizeOptions":[{"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},{"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},{"value":"1:1","label":"1:1","aspectRatio":"1:1"}],"resolutionOptions":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}],"orientationOptions":[{"value":"landscape","label":"Landscape","size":"16:9","aspectRatio":"16:9"},{"value":"portrait","label":"Portrait","size":"9:16","aspectRatio":"9:16"}],"controls":[{"key":"duration","label":"时长","binding":"durationSeconds","optionSource":"durationOptions"},{"key":"size","label":"画幅","binding":"size","optionSource":"sizeOptions"},{"key":"resolution","label":"分辨率","binding":"resolution","optionSource":"resolutionOptions"},{"key":"orientation","label":"方向","binding":"orientation","optionSource":"orientationOptions"}]}}}}'),
  ('ModelPrice', '{"doubao-seedance-2-0-260128":0.3,"doubao-seedance-2-0-fast-260128":0.24}'),
  ('SelfUseModeEnabled', 'true'),
  ('TapCanvasModelCatalogMeta', '
{
  "doubao-seedance-2-0-260128": {
    "videoOptions": {
      "defaultDurationSeconds": 4,
      "defaultResolution": "480p",
      "defaultSize": "16:9",
      "durationOptions": [
        { "value": 4, "label": "4s" },
        { "value": 5, "label": "5s" },
        { "value": 6, "label": "6s" },
        { "value": 7, "label": "7s" },
        { "value": 8, "label": "8s" },
        { "value": 9, "label": "9s" },
        { "value": 10, "label": "10s" },
        { "value": 11, "label": "11s" },
        { "value": 12, "label": "12s" },
        { "value": 13, "label": "13s" },
        { "value": 14, "label": "14s" },
        { "value": 15, "label": "15s" }
      ],
      "resolutionOptions": [
        { "value": "480p", "label": "480p" },
        { "value": "720p", "label": "720p" },
        { "value": "1080p", "label": "1080p" }
      ],
      "sizeOptions": [
        { "value": "21:9", "label": "21:9", "orientation": "landscape", "aspectRatio": "21:9" },
        { "value": "16:9", "label": "16:9", "orientation": "landscape", "aspectRatio": "16:9" },
        { "value": "4:3", "label": "4:3", "orientation": "landscape", "aspectRatio": "4:3" },
        { "value": "1:1", "label": "1:1", "aspectRatio": "1:1" },
        { "value": "3:4", "label": "3:4", "orientation": "portrait", "aspectRatio": "3:4" },
        { "value": "9:16", "label": "9:16", "orientation": "portrait", "aspectRatio": "9:16" }
      ],
      "controls": [
        { "key": "duration", "label": "时长", "binding": "durationSeconds", "optionSource": "durationOptions" },
        { "key": "size", "label": "画幅", "binding": "size", "optionSource": "sizeOptions" },
        { "key": "resolution", "label": "分辨率", "binding": "resolution", "optionSource": "resolutionOptions" }
      ]
    }
  },
  "doubao-seedance-2-0-fast-260128": {
    "videoOptions": {
      "defaultDurationSeconds": 2,
      "defaultResolution": "480p",
      "defaultSize": "16:9",
      "durationOptions": [
        { "value": 2, "label": "2s" },
        { "value": 3, "label": "3s" },
        { "value": 4, "label": "4s" },
        { "value": 5, "label": "5s" },
        { "value": 6, "label": "6s" },
        { "value": 7, "label": "7s" },
        { "value": 8, "label": "8s" },
        { "value": 9, "label": "9s" },
        { "value": 10, "label": "10s" },
        { "value": 11, "label": "11s" },
        { "value": 12, "label": "12s" }
      ],
      "resolutionOptions": [
        { "value": "480p", "label": "480p" },
        { "value": "720p", "label": "720p" },
        { "value": "1080p", "label": "1080p" }
      ],
      "sizeOptions": [
        { "value": "21:9", "label": "21:9", "orientation": "landscape", "aspectRatio": "21:9" },
        { "value": "16:9", "label": "16:9", "orientation": "landscape", "aspectRatio": "16:9" },
        { "value": "4:3", "label": "4:3", "orientation": "landscape", "aspectRatio": "4:3" },
        { "value": "1:1", "label": "1:1", "aspectRatio": "1:1" },
        { "value": "3:4", "label": "3:4", "orientation": "portrait", "aspectRatio": "3:4" },
        { "value": "9:16", "label": "9:16", "orientation": "portrait", "aspectRatio": "9:16" }
      ],
      "controls": [
        { "key": "duration", "label": "时长", "binding": "durationSeconds", "optionSource": "durationOptions" },
        { "key": "size", "label": "画幅", "binding": "size", "optionSource": "sizeOptions" },
        { "key": "resolution", "label": "分辨率", "binding": "resolution", "optionSource": "resolutionOptions" }
      ]
    }
  },
  "veo3.1-pro": {
    "videoOptions": {
      "defaultDurationSeconds": 8,
      "defaultResolution": "720p",
      "defaultSize": "16:9",
      "durationOptions": [
        { "value": 4, "label": "4s" },
        { "value": 6, "label": "6s" },
        { "value": 8, "label": "8s" }
      ],
      "resolutionOptions": [
        { "value": "720p", "label": "720p" },
        { "value": "1080p", "label": "1080p" }
      ],
      "sizeOptions": [
        { "value": "16:9", "label": "16:9", "orientation": "landscape", "aspectRatio": "16:9" },
        { "value": "9:16", "label": "9:16", "orientation": "portrait", "aspectRatio": "9:16" }
      ],
      "controls": [
        { "key": "duration", "label": "时长", "binding": "durationSeconds", "optionSource": "durationOptions" },
        { "key": "size", "label": "画幅", "binding": "size", "optionSource": "sizeOptions" },
        { "key": "resolution", "label": "分辨率", "binding": "resolution", "optionSource": "resolutionOptions" }
      ]
    }
  },
  "veo_3_1": {
    "videoOptions": {
      "defaultDurationSeconds": 8,
      "defaultResolution": "720p",
      "defaultSize": "16:9",
      "durationOptions": [
        { "value": 4, "label": "4s" },
        { "value": 6, "label": "6s" },
        { "value": 8, "label": "8s" }
      ],
      "resolutionOptions": [
        { "value": "720p", "label": "720p" },
        { "value": "1080p", "label": "1080p" }
      ],
      "sizeOptions": [
        { "value": "16:9", "label": "16:9", "orientation": "landscape", "aspectRatio": "16:9" },
        { "value": "9:16", "label": "9:16", "orientation": "portrait", "aspectRatio": "9:16" }
      ],
      "controls": [
        { "key": "duration", "label": "时长", "binding": "durationSeconds", "optionSource": "durationOptions" },
        { "key": "size", "label": "画幅", "binding": "size", "optionSource": "sizeOptions" },
        { "key": "resolution", "label": "分辨率", "binding": "resolution", "optionSource": "resolutionOptions" }
      ]
    }
  },
  "veo_3_1-fast": {
    "videoOptions": {
      "defaultDurationSeconds": 8,
      "defaultResolution": "720p",
      "defaultSize": "16:9",
      "durationOptions": [
        { "value": 4, "label": "4s" },
        { "value": 6, "label": "6s" },
        { "value": 8, "label": "8s" }
      ],
      "resolutionOptions": [
        { "value": "720p", "label": "720p" },
        { "value": "1080p", "label": "1080p" }
      ],
      "sizeOptions": [
        { "value": "16:9", "label": "16:9", "orientation": "landscape", "aspectRatio": "16:9" },
        { "value": "9:16", "label": "9:16", "orientation": "portrait", "aspectRatio": "9:16" }
      ],
      "controls": [
        { "key": "duration", "label": "时长", "binding": "durationSeconds", "optionSource": "durationOptions" },
        { "key": "size", "label": "画幅", "binding": "size", "optionSource": "sizeOptions" },
        { "key": "resolution", "label": "分辨率", "binding": "resolution", "optionSource": "resolutionOptions" }
      ]
    }
  },
  "kling-v3": {
    "videoOptions": {
      "defaultDurationSeconds": 5,
      "defaultResolution": "720p",
      "defaultSize": "16:9",
      "durationOptions": [
        { "value": 5, "label": "5s" },
        { "value": 10, "label": "10s" },
        { "value": 15, "label": "15s" }
      ],
      "resolutionOptions": [
        { "value": "720p", "label": "720p" },
        { "value": "1080p", "label": "1080p" }
      ],
      "sizeOptions": [
        { "value": "16:9", "label": "16:9", "orientation": "landscape", "aspectRatio": "16:9" },
        { "value": "9:16", "label": "9:16", "orientation": "portrait", "aspectRatio": "9:16" },
        { "value": "1:1", "label": "1:1", "aspectRatio": "1:1" }
      ],
      "controls": [
        { "key": "duration", "label": "时长", "binding": "durationSeconds", "optionSource": "durationOptions" },
        { "key": "size", "label": "画幅", "binding": "size", "optionSource": "sizeOptions" },
        { "key": "resolution", "label": "分辨率", "binding": "resolution", "optionSource": "resolutionOptions" }
      ]
    }
  }
}
')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

COMMIT;
