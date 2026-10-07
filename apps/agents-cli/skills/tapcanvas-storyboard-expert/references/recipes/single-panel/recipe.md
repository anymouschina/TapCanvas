# 配方：单张分镜（single-panel）

## 定位
单张 6 格标注分镜，适合品牌宣传/短剧场景。2×3 网格编排，每格带场景标注说明，清晰呈现镜头叙事节奏。

## gptImagePromptTemplate（生成 2K 故事板实例用）
Output a single storyboard image with 6 panels arranged in a 2×3 grid showing the following scene sequence:
[从组内文本/剧情抽取的场景节拍]
Requirements:
- 6 panels arranged in 2 rows × 3 columns, left-to-right, top-to-bottom
- Each panel in 16:9 aspect ratio, clean cinematic composition
- Character appearance and scale consistent across all panels（角色描述取自组内角色参考图）
- Background and lighting consistent throughout（场景设定取自组内场景参考）
- Brief scene label or shot number allowed inside each panel border
- No extra content outside the panel grid

## seedancePromptTemplate（下游图生视频复用）
slow camera push-in, follow the 6-panel storyboard sequence, 16:9, 3s

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
