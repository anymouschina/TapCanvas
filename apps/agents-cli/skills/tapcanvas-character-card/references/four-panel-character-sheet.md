# 身份板模板编译边界

参考版式：竖版 2:3 整板，两列等宽；上排头肩近景约 41% 高，下排全身约 59% 高。比例用于提示词构图，不作为 schema 或质量闸门。模型不支持该画幅时，在其真实支持的画幅中保留上小下大的信息层级。仅作布局参考的示例不提供当前角色身份、服装或媒介。无上传身份图时，将下方 uploaded 来源声明改为真实角色事实与已授权设计来源；状态卡仅应用已授权差量。

下方是写实参考转身份板的模板。用户明确二维、插画或其它非写实媒介时，由角色作者在同一 prompt 编译中把 photographic / real pores / natural stubble 等写实专用描述替换为该媒介中真实存在的线条、色块和材质，不添加毛孔或胡茬，不改变已确认身份；四格布局、视角与服装保真不变。明确禁止写实阴影时遵守用户要求。BG/LIGHT 未指定且属于原创设计空间时由作者决定并标为设计，不要求用户选参；保真复现任务仍以真实参考与用户拍摄要求为准。身份本色与可读性优先，不把剧情情绪光烘焙进卡片。模板 no props 禁止新增场景道具与表演持物，不删除真实参考已有或原创身份已锁定的固定装备（如与服装一体的背带和邮袋）；不得借此添加未授权配件，用户明确无装备时仍优先。

IMAGE TASK: Convert the uploaded character reference image(s) into a 4-panel character sheet.

CRITICAL PRESERVATION OVERRIDE

The uploaded image(s) are the ONLY design source. Preserve EXACTLY: facial structure, eyes, nose,
mouth shape, hairline and hairstyle, age, skin tone and skin texture (real pores, natural stubble),
body proportion and weight, every garment detail (cut, fabric, seams, wear, hardware), footwear.

NO beautification, NO redesign, no style drift, NO "improving" the face.
The same person, four times — one identity across all panels.
FACIAL DETAIL DISTRIBUTION: Only PANEL 1 has a sharp, identifiable facial close-up.
Apply visible localized soft blur to facial features in PANELS 2 and 3; do not leave
recognizable eyes, nose or mouth detail there. Preserve hair, head silhouette, garments
and body sharply. PANEL 4 is strictly rear-facing with no visible face.
This localized blur takes precedence over skin-detail requirements outside PANEL 1;
it changes presentation, never the underlying identity. Do not blur the entire sheet.

OUTPUT FORMAT:
single portrait image, preferably 2:3 aspect ratio within supported model sizes.
2x2 layout with equal-width columns; the top row occupies approximately 41% of the height
and the bottom row approximately 59%, allowing complete full-body views.
Thin light dividers, small unobtrusive labels at the top-left of each panel:
"FACE FRONT / FACE SIDE / BODY FRONT / BACK".

PANEL 1 — TOP LEFT, FACE FRONT:
head-and-shoulders close-up, face directly toward camera, calm neutral expression,
eyes engaged but relaxed. This is the sole sharp facial identity reference on the sheet.

PANEL 2 — TOP RIGHT, FACE SIDE:
same head-and-shoulders scale as PANEL 1, clean true side profile facing image-left,
not a three-quarter view; facial area visibly soft-blurred with no readable facial features.
Retain the head silhouette, sharp hair volume and accessory placement in physical space.

PANEL 3 — BOTTOM LEFT, BODY FRONT:
full-body standing pose, front view, facial area visibly soft-blurred with no readable
facial features (PANEL 1 alone remains the facial identity authority),
weight natural, arms relaxed at sides; clothing and body remain sharp.
Include the entire silhouette from crown to soles, both shoes and the complete garment hem,
with small clear margins; do not crop feet or extend clothing beyond the panel.

PANEL 4 — BOTTOM RIGHT, BACK:
full-body standing pose, strictly rear-facing with no head turn or visible face —
hair from behind, garment back seams,
heel height, same standing pose, figure scale and floor baseline as PANEL 3.
Include crown, shoes and complete hem. Preserve garment layers, closures, straps and
hair ornaments consistently in three dimensions, not by mirroring the front design.
Unseen back details are conservative design inferences, not claimed reference facts.

STUDIO SETUP (all four panels identical):
seamless 【BG】 studio background,
【LIGHT】 tone, consistent restrained studio lighting, exposure and key-light direction.
Keep PANEL 1 facial structure, and all panels’ hair, textile layers and back construction readable.
Do not restore sharp facial details in PANELS 2 or 3.
Use explicit user lighting settings when provided; do not infer exact lighting equipment
or a mandatory hard key / no-fill setup from a layout reference.
No set dressing, no added props. Preserve natural grounding shadows on the floor.

QUALITY:
photographic character sheet for film production,
even exposure, accurate fabric weave,
matte skin, real pores in PANEL 1 only, no gloss; preserve localized facial blur elsewhere.
Clean, clinical, production-use.

AVOID:

- FACE (sharp PANEL 1 only; do not undo intentional facial blur in PANELS 2 and 3): no beauty-filter skin, no glossy TV-drama complexion, no idol makeup,
  no plastic skin, no face slimming, no enlarged eyes, no skin smoothing

- BODY: no pose change between panels, no body reshaping,
  no added accessories, no height change

- LIGHT: no ambient color spill, no rim-light drama
