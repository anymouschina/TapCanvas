import { hostedAssetUrl } from '../../../config/objectStorageAssets'

// apps/web/src/canvas/nodes/taskNode/emotionModel.ts
//
// 情绪调节的「情绪定位」模型 —— 对标 liblib「情绪调节」的 2D 情绪坐标盘。
// 二维情感环形模型（valence-arousal circumplex）：
//   纵轴 y（上→下）：激动 ↔ 平静（唤醒度 arousal）
//   横轴 x（左→右）：亲近 ↔ 疏离（亲近度/效价 valence）
// 5×5 = 25 格，中心 (2,2) = 淡然自若（中性）。
//
// 每格给：中文命名情绪 zh（面板「情绪定位」读数）+ 面部神态描述 cn（喂 i2i 的提示词片段）。
// 关键：情绪调节只改「面部表情与神态」，必须保住人物身份/发型/服装/光照/画风 —— 见 buildEmotionPrompt。

export type EmotionCell = {
  x: number // 0..4 左(亲近)→右(疏离)
  y: number // 0..4 上(激动)→下(平静)
  zh: string
  cn: string
}

// GRID[y][x]
const GRID: ReadonlyArray<ReadonlyArray<{ zh: string; cn: string }>> = [
  // 名称与 LibTV 当前线上情绪盘一致；描述只用于给生成模型提供可执行的面部语义。
  [
    { zh: '浅然莞尔', cn: '眉眼明亮、轻快微笑、情绪外显而亲近' },
    { zh: '含情凝望', cn: '眼神专注柔和、带有明显情感投入' },
    { zh: '骤然错愕', cn: '眉毛上扬、双眼睁大、嘴唇微张' },
    { zh: '难以置信', cn: '惊疑凝视、眉眼紧绷、神情强烈' },
    { zh: '暴怒沉怒', cn: '眉头压低、下颌紧绷、目光凌厉疏离' },
  ],
  [
    { zh: '满眼宠溺', cn: '眼神温暖宠溺、嘴角自然上扬' },
    { zh: '欣然愉悦', cn: '轻松愉快、含笑而自然' },
    { zh: '惊魂未定', cn: '呼吸未平、眼神游移、仍有惊惧' },
    { zh: '受惊后退', cn: '神情受惊、眉眼戒备、下意识疏离' },
    { zh: '眉宇凝霜', cn: '眉宇冷峻、眼神锐利、明显疏离' },
  ],
  [
    { zh: '万般无奈', cn: '无奈轻叹、眉眼柔软、情绪收敛' },
    { zh: '欲言又止', cn: '嘴唇微动、眼神犹疑、克制表达' },
    { zh: '淡然自若', cn: '平静从容、中性安然的神情、自然放松的脸' },
    { zh: '警觉审视', cn: '克制审视、目光警觉、保持距离' },
    { zh: '冷眼漠然', cn: '目光平直冷淡、面部几乎无表情' },
  ],
  [
    { zh: '默然垂泪', cn: '安静落泪、目光低垂、悲伤而克制' },
    { zh: '触景伤情', cn: '眼神湿润、眉眼低落、陷入回忆' },
    { zh: '疲惫失神', cn: '眼睑沉重、目光失焦、神情疲惫' },
    { zh: '积郁憋闷', cn: '嘴唇紧抿、眉间郁结、压抑不快' },
    { zh: '疏离冷淡', cn: '表情冷淡、目光避开、保持距离' },
  ],
  [
    { zh: '强忍悲戚', cn: '强忍悲伤、眼眶微红、表情极度克制' },
    { zh: '哀悼压抑', cn: '低垂眼帘、悲痛压抑、安静沉重' },
    { zh: '隐忍心伤', cn: '心伤而克制、嘴角下压、眼神疲惫' },
    { zh: '隐忍愠怒', cn: '压住怒意、眉头微蹙、嘴唇紧抿' },
    { zh: '心跳骤停', cn: '神情僵住、眼神凝滞、冷静中的惊惧' },
  ],
]

export const EMOTION_GRID_SIZE = 5

// 坐标轴端点标签（面板四边显示）
export const EMOTION_AXES = {
  top: '激动',
  bottom: '平静',
  left: '亲近',
  right: '疏离',
} as const

// 网格中心 = 默认选中（淡然自若）
export const EMOTION_DEFAULT_XY = { x: 2, y: 2 } as const

// 情绪预览：每格一张独立生成的「中性 3D 素模头」表情图（对标 liblib 左侧实时预览头像）。
// 单独生成 → 托管到 OSS 在线链接（表情各不相同、全分辨率），面板用 ManagedImage 随坐标即时切换。
// key = y{y}x{x}，与 GRID[y][x] 对齐。由 scratchpad/gen-emotion-25.mjs 批量生成后填入。
export const EMOTION_PREVIEW_URLS: Record<string, string> = {
  'y0x0': hostedAssetUrl('gen/images/18146279/20260715/62e4647a-9c5b-41fc-b437-d8f376b3c184.png'),
  'y0x1': hostedAssetUrl('gen/images/18146279/20260715/4abc7cea-35fc-4d53-9d1c-095d9c1d95b7.png'),
  'y0x2': hostedAssetUrl('gen/images/18146279/20260715/b45e9f8a-8365-4d96-8c32-75e610e103ab.png'),
  'y0x3': hostedAssetUrl('gen/images/18146279/20260715/b71f2488-2988-472b-8539-66a1d6675047.png'),
  'y0x4': hostedAssetUrl('gen/images/18146279/20260715/97bf5f64-a322-4d54-a137-b7d894d8eea0.png'),
  'y1x0': hostedAssetUrl('gen/images/18146279/20260715/9999da32-1f02-4b55-ba73-d0dedd53649f.png'),
  'y1x1': hostedAssetUrl('gen/images/18146279/20260715/dfe6f9f8-842e-4bf3-b74a-041983218b05.png'),
  'y1x2': hostedAssetUrl('gen/images/18146279/20260715/3d1e7880-5d02-4f02-b023-7f62a9b64d99.png'),
  'y1x3': hostedAssetUrl('gen/images/18146279/20260715/6be8fdac-6c42-4822-9eab-ffe7329e8835.png'),
  'y1x4': hostedAssetUrl('gen/images/18146279/20260715/74d788ca-2975-4194-b3bb-c7ae2c6d9917.png'),
  'y2x0': hostedAssetUrl('gen/images/18146279/20260715/bb91886c-0d55-4840-a737-76a138eac03b.png'),
  'y2x1': hostedAssetUrl('gen/images/18146279/20260715/0b708c71-12a1-47c2-9be1-deca3c4d7100.png'),
  'y2x2': hostedAssetUrl('gen/images/18146279/20260715/53480297-d842-4e02-9ffb-6745538ca25c.png'),
  'y2x3': hostedAssetUrl('gen/images/18146279/20260715/9f90acd2-e67c-454f-9ac2-afb27718b8ad.png'),
  'y2x4': hostedAssetUrl('gen/images/18146279/20260715/e8d6612a-83c4-4b31-b0a6-e281fc7f0113.png'),
  'y3x0': hostedAssetUrl('gen/images/18146279/20260715/3b5a8e29-8d2c-4f7c-a34f-3d889f801c17.png'),
  'y3x1': hostedAssetUrl('gen/images/18146279/20260715/aecf8854-26eb-4c7f-8d28-bccb930262a8.png'),
  'y3x2': hostedAssetUrl('gen/images/18146279/20260715/e07322e0-f19b-40b9-843f-8962975d87f3.png'),
  'y3x3': hostedAssetUrl('gen/images/18146279/20260715/d8944f9b-a580-4f31-a859-f5d3ec3b0cc1.png'),
  'y3x4': hostedAssetUrl('gen/images/18146279/20260715/23ba6fab-43d9-4ec8-9fe7-7f9816ab0ad5.png'),
  'y4x0': hostedAssetUrl('gen/images/18146279/20260715/ee4616a2-a96d-4d58-a8ea-bad76f5b6864.png'),
  'y4x1': hostedAssetUrl('gen/images/18146279/20260715/9c4352ab-a71b-4384-87ea-b77b901ab10d.png'),
  'y4x2': hostedAssetUrl('gen/images/18146279/20260715/b6431fda-1b5e-4568-86c0-32c70d4dafc5.png'),
  'y4x3': hostedAssetUrl('gen/images/18146279/20260715/6cc580e6-e0e8-4434-8715-cd7b08b569dc.png'),
  'y4x4': hostedAssetUrl('gen/images/18146279/20260715/54d2761e-dc39-4e80-bf69-58cde7945d46.png'),
}

export function emotionPreviewUrl(x: number, y: number): string {
  const n = EMOTION_GRID_SIZE - 1
  const cy = Math.min(n, Math.max(0, Math.round(y)))
  const cx = Math.min(n, Math.max(0, Math.round(x)))
  return EMOTION_PREVIEW_URLS[`y${cy}x${cx}`] || ''
}

export function getEmotionCell(x: number, y: number): EmotionCell {
  const cy = Math.min(EMOTION_GRID_SIZE - 1, Math.max(0, Math.round(y)))
  const cx = Math.min(EMOTION_GRID_SIZE - 1, Math.max(0, Math.round(x)))
  const cell = GRID[cy][cx]
  return { x: cx, y: cy, zh: cell.zh, cn: cell.cn }
}

// 情绪调节 = 保身份、仅改表情的 i2i 指令。身份/发型/服装/光照/画风一律锁定，只动面部神态。
export function buildEmotionPrompt(cell: EmotionCell): string {
  return [
    '保持人物的身份、五官、发型、服装、身体姿态、构图、光照和画面风格完全不变，',
    `仅将人物的面部表情与神态调整为「${cell.zh}」：${cell.cn}。`,
    '表情自然可信，符合原图人物的气质，不改变人物长相与画风。',
  ].join('')
}

export function buildLibTvEmotionPrompt(input: {
  expression: string
  faceBoundingBox: readonly [number, number, number, number]
}): string {
  return `以参考图一（原图）为主参考图，第2个人脸参考图的坐标是[${input.faceBoundingBox.join(',')}]设置成${input.expression}表情`
}
