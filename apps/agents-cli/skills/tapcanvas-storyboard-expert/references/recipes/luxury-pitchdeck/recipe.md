# 配方：奢侈品编辑分镜（luxury-pitchdeck）

## 定位
12 格 3×4 pitch-deck 竖版分镜，适合奢侈品/编辑美学场景。9:16 竖版构图，精准保持镜头顺序，追求高端视觉质感。

## gptImagePromptTemplate（生成 2K 故事板实例用）
Output a single storyboard image with 12 panels arranged in a 3×4 grid showing the following editorial sequence:
[从组内文本/剧情抽取的编辑美学场景序列]
Requirements:
- 12 panels arranged in 4 rows × 3 columns, left-to-right, top-to-bottom
- Each panel in 9:16 portrait aspect ratio, editorial luxury composition
- High-end aesthetic: dramatic lighting, precise framing, minimal negative space
- Product/subject rendered with photorealistic detail and consistency（视觉参考取自组内参考图）
- Background atmosphere consistent throughout（场景设定取自组内场景参考）
- Exact shot order preserved as specified
- No text, labels, or content outside the panel borders

## seedancePromptTemplate（下游图生视频复用）
preserve exact shot order, rack focus, luxury editorial style, 9:16, 24fps

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
