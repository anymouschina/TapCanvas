# 配方：成本可控8格（editorial-8panel）

## 定位
8 格 4 列编辑式网格。真人写实，先用便宜的图反复锁定分镜，再一次性出视频（视频迭代贵图 10–50×）。

## gptImagePromptTemplate（生成 2K 故事板实例用）
Create a single cinematic storyboard image containing 8 panels in a 4-column horizontal grid. Minimalist editorial layout, generous white space, ultra-thin low-contrast divider lines, panel number 01–08 at each top-left. Live-action cinematic realism. 内容来自组内剧情：[组内剧情/动作序列]，跨格保持角色与场景一致。No text outside panels.

## seedancePromptTemplate（下游图生视频复用）
Generate video based strictly on the storyboard. Follow each panel's composition, framing and action in order. Keep perfect visual continuity, no errors.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
