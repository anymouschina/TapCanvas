# 配方：选角试镜板（casting-grid）

## 定位
选角省额度：一张 4 格选角板，同一角色 4 位候选演员 → 各自用同一台词测试，挑出最佳再投入。

## gptImagePromptTemplate（生成 2K 故事板实例用）
Create a 16:9 horizontal cinematic casting board showing 4 different actor candidates for the same role. 同一风格/服装/世界观/打光。角色简介来自组内：[组内角色设定]。3/4 body, eye-level.

## seedancePromptTemplate（下游图生视频复用）
Each actor delivers the same dialogue line and action. Compare eye contact, expression, movement.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
