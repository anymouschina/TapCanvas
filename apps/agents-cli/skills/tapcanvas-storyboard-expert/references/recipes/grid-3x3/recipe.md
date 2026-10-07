# 配方：3×3 网格分镜（grid-3x3）

## 定位
通用连续动作。9 格合成一张图，是最稳的图生视频喂法（失败率低于逐帧）。

## gptImagePromptTemplate（生成 2K 故事板实例用）
Output a single 3×3 grid storyboard image showing the following continuous action:
[从组内文本/剧情抽取的动作序列]
Requirements:
- 9 panels arranged left-to-right, top-to-bottom showing continuous motion
- Character position and scale consistent across all panels（角色描述取自组内角色参考图）
- Background consistent throughout（场景设定取自组内场景参考）
- No text, labels, or content outside the panel borders
- 16:9 panels, clean composition

## seedancePromptTemplate（下游图生视频复用）
turn this image into video, [style], 24fps

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
