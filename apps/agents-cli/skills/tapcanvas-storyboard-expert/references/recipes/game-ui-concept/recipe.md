# 配方：游戏UI概念（game-ui-concept）

## 定位
游戏概念/伪实机：生成含 HUD(小地图/血条/技能/任务) 的游戏 UI 截图 → Seedance 扩展成实机片段。游戏/插画风审核更宽松。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张游戏 UI 截图风画面，含 HUD 元素(小地图、血条、技能栏、选项浮层)，第三人称视角，[城市/世界] 环境。内容来自组内：[组内世界观/玩法]。

## seedancePromptTemplate（下游图生视频复用）
Image-to-video. The model reads the HUD layout and extends it into a coherent gameplay sequence. camera follows the player, smooth motion.

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
