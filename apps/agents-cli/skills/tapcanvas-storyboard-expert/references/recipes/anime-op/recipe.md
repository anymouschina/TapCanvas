# 配方：动漫OP（anime-op）

## 定位
动漫片头(OP)风格。场景设定关键视觉 → Seedance 自由高速剪辑。高冲击、快切。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张动漫 OP 风格关键视觉/分镜，日系全彩动画质感，强构图、强对比。内容来自组内：[组内角色/世界观/歌词意象]。保持角色设定一致。

## seedancePromptTemplate（下游图生视频复用）
Japanese full-color anime, fast cuts, high frame count, 24fps. [dark fantasy / 指定风格] anime OP style. High-impact sequence. Only [角色] appears.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
