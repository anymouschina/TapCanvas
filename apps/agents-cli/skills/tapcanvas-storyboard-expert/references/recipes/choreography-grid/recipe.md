# 配方：舞蹈编舞网格（choreography-grid）

## 定位
4×4 共 16 格连续编舞分解网格，给 Seedance 16 个参考帧插值，动作更顺。适合舞蹈/武术/瑜伽等连续动作。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张 4×4(16 格)编舞分解网格，同一舞者按编号 1–16 连续动作，每格全身、机位一致、舞者身份一致。内容来自组内：[组内编舞/动作步骤]。clean spacing，编号清晰。

## seedancePromptTemplate（下游图生视频复用）
Character performs the dance following the 16-step breakdown in the reference grid, in order. Emphasize precise beat synchronization. Smooth transitions, no cuts.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
