# 配方：时间戳分段（timestamped-process）

## 定位
时间戳分段法。把 15 秒拆成 2 秒一段，每段定一个镜头角度+动作，给 Seedance 精确时间轴。适合美食/工艺/开箱/调酒。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张竖版(9:16)写实分镜，按时间戳分段组织镜头：[0-2s]…[2-4s]…[4-6s]… 每段写清机位与动作。内容来自组内：[组内工艺/流程]。dark rustic 背景，柔和戏剧光，浅景深，自然质感，无文字无字幕。

## seedancePromptTemplate（下游图生视频复用）
Ultra-realistic cinematic 9:16 video. [0-2s] top-down: hands touch [素材]. [2-4s] side close: [动作] slow motion. [4-6s] macro: [动作]. … 按时间戳逐段推进，机位+动作明确。

## invariants（三条横切不变量）
1. 网格优先、单图喂入。
2. 一致性三层：产品 `camera movement only, keep product unchanged`；character-card/v3 身份锚点+每格固定外观；场景顶部固定 setting。
3. 默认约束：16:9 避裁切、单片段 ≤3s、24fps、短提示词胜长提示词。
