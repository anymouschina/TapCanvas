# 配方：角色登场卡（character-intro）

## 定位
角色登场：把角色重设计为 AAA 游戏角色 + 电影感登场画面(暗背景、戏剧光、角色名+信息 UI) → Seedance 做 reveal 动画。角色无关，可换任意角色。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张赛博朋克 AAA 游戏角色登场关键视觉，保留组内角色脸部身份，cinematic realism，强对比，景深，霓虹都市背景，角色名以 graffiti 排版小号嵌入，极简信息 UI 模块。内容来自组内：[组内角色]。

## seedancePromptTemplate（下游图生视频复用）
camera always follows the character closely, no cuts, smooth tracking. Character action then settles into final stance, turns to camera. UI builds progressively: character name reveals stroke-by-stroke.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
