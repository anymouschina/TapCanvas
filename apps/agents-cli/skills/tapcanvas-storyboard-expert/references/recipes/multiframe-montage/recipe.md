# 配方：多帧快切蒙太奇（multiframe-montage）

## 定位
12 格 4×3 快切蒙太奇。跟随帧序生成快切剪辑，适合节奏感强、多场景切换的蒙太奇风格内容。

## gptImagePromptTemplate（生成 2K 故事板实例用）
Output a single storyboard image with 12 panels arranged in a 4×3 grid showing the following montage sequence:
[从组内文本/剧情抽取的蒙太奇帧序]
Requirements:
- 12 panels arranged in 3 rows × 4 columns, left-to-right, top-to-bottom
- Each panel in 16:9 aspect ratio, dynamic cinematic composition
- Rapid visual tempo: each panel represents a distinct cut or angle change
- Character and subject recognizable across panels despite quick cuts（角色描述取自组内角色参考图）
- Varied shot sizes (close-up, medium, wide) to create montage rhythm
- Background context sufficient per panel（场景设定取自组内场景参考）
- No text, labels, or content outside the panel borders

## seedancePromptTemplate（下游图生视频复用）
follow the storyboard sequence of the 12 reference frames, fast cuts, 16:9, 24fps

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
