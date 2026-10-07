# 配方：电商产品广告（product-ad）

## 定位
电商带货：从已有产品图出发生成场景分镜，强调产品一致性(只动相机不动产品)。适合 TikTok/Reels 短广告。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张竖版产品广告分镜，hero 产品居中，干净背景，商业级灯光。产品外观完全沿用组内产品参考图。内容来自组内：[组内产品/卖点]。

## seedancePromptTemplate（下游图生视频复用）
Cinematic product ad. keep the product appearance completely unchanged, camera movement only, no rotation. slow push-in, warm side lighting, clean background, no people. 3 seconds.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
