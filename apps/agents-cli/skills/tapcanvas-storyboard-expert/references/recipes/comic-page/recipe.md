# 配方：漫画页（comic-page）

## 定位
美式漫画多格页：对角布局 + 对白气泡 + 清晰阅读流。Seedance 按格序动画成连贯短片。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张美式漫画多格页，对角布局，6 格左右，电影叙事，清晰阅读顺序，含对白气泡。角色取自组内参考图保持一致。内容来自组内：[组内故事序列]。

## seedancePromptTemplate（下游图生视频复用）
Animate this comic page as a cinematic sequence. Follow the panel order top-left to bottom-right. Smooth transitions, maintain character consistency, cinematic camera movement.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
