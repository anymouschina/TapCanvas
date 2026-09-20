# 产品宣传片 TapCanvas 工作流

> 适用于用法 B（独立产品片），与叙事片 tapcanvas-video-workflow 并列，
> 不是叙事片的子集。两者唯一公共层是 media-worker 合成。

## 本工作流与叙事片工作流的核心差异

| 维度 | 叙事片（video-workflow） | 产品宣传片（本流程） |
|---|---|---|
| 关键帧来源 | AI 生图（角色卡/场景卡） | 真实页面截图 |
| 连续性 | 角色/场景/道具跨 clip 一致性 | 无跨 clip 连续性要求 |
| 文案入画 | 台词/字幕（规划外） | 不入画，交用户后期 |
| BeatSheet 驱动 | 章节原文 + 剧情时间轴 | 卖点清单 + 镜头卡序列 |
| 时长 | 章节长度（无固定上限） | 宣传片通常 30–90s |

## 阶段流程

### P0：范围判定（开工前必做）

- 产品是否有可截图的真实页面？→ 有：走截图路径；无：AI 生图代替截图
- 用户有没有点名卡？→ 有：先查 `shot-taxonomy.md` 层级，X 层卡给替代方案
- 时长预算？→ 30s 约 6–10 镜，60s 约 12–18 镜，90s 约 20–25 镜

### P1：卖点拆解（1–2 句/卖点）

从产品或用户提供的文案中提取核心卖点，每个卖点对应 1–2 个镜头。
卖点不超过 5 个（超出就是功能展示片不是宣传片，节奏会崩）。

输出格式：
```
卖点 1：[一句话]  → 镜头意图：[选哪张 G 层卡 or 自由描述]
卖点 2：[一句话]  → 镜头意图：[...]
...
开场：[品牌/情绪建立]
收场：[CTA / logo 定版]
```

### P2：截图采集（用户或 agent 操作）

- 每个卖点对应 1–2 张截图，截取最能代表该卖点的页面状态
- 尺寸建议：1920×1080（横屏）或 1080×1920（竖屏），与目标比例一致
- 截图上传到 R2，拿到 URL 后填入 P3 的 BeatSheet
- **禁止让 AI 生成产品 UI 截图**——生成的 UI 文字不可读

### P3：BeatSheet 草稿

使用 Keyframe BeatSheet v2 格式（与叙事片相同结构），差异字段：

```json
{
  "clipIndex": 0,
  "clipDuration": "medium",          // short/medium/long
  "startKeyframe": {
    "imageUrl": "<真实截图 URL>",
    "imageSource": "screenshot"      // 区分于 ai-generated
  },
  "endKeyframe": null,               // 单截图图生视频，不需要终态
  "shotCard": "crash-zoom-punch",    // 来自 G 层卡名
  "clipPrompt": "...",               // 按 tapcanvas-mapping.md 翻译
  "continuityMode": "none"           // 产品片无跨镜连续性
}
```

### P4：clipPrompt 翻译

按 `tapcanvas-mapping.md` 把 G 层卡的运镜意图翻成 AI 视频 prompt：
- 帧数 → 感知时间词
- easing → 动势词  
- 运镜参数 → 摄影语言
- 速度比 → 节奏对比词
- 可感性阈值（原版坑）→ 保留

走 `clip-prompt-preflight-audit.md` 的 7 道预检（与叙事片相同）。

### P5：生成 + 合成

- 生成：走 `tapcanvas-video-workflow` 的单镜路径（`add_clips`），
  逐镜按 BeatSheet 提交
- 合成：C 层转场镜头在 `ConcatClipSpec` 里加 `transition` 字段
  （取值见 `tapcanvas-mapping.md` 的 xfade 映射表）
- 最终拼接：media-worker concat，xfade 时长 0.3–0.6s

### P6：文案与字幕（交用户）

产品片没有 `drawtext`/`overlay`，文案不在 agent 职责范围内。
交付说明里注明：
- 标题文案建议在剪映/PR 后期叠加
- 或使用截图里已有的真实 UI 文字（已在画面里，无需叠加）

## 卡选型参考（按片型）

### 功能演示片（单卖点深度展示，30s）
```
opening:   spotlight-hero-card（聚光锁定功能卡）
feat-1:    crash-zoom-punch（推近功能核心）
feat-2:    depth-layer-moves（多层功能并列）
feat-3:    speed-ramp-freeze（慢下来让用户看清）
outro:     outro-group-photo-launch（元素汇聚）
```

### 产品发布片（多卖点概览，60s）
```
opening:   crane-rise-reveal（升起揭示全貌）
feat-1,2:  tension-camera-moves 的 slow-push（逐个功能压迫感）
feat-3,4:  beat-cut-moves（节奏加速串联多个截图）
hero:      crash-zoom-punch（最强卖点特写）
outro:     outro-group-photo-launch
transition:使用 bottom-push-stack-wipe / circle-match-iris 分隔段落
```

### 品牌情绪片（氛围建立，无具体功能，45s）
```
opening:   dataviz-landscape-open（暗场流线地景）
mid:       light-play-moves（光效显影）
            graze-face-tour（贴面游走质感）
rhythm:    sakuga-timing-shift（帧率量化突变制造张力）
outro:     轻 outro，配 logo 截图 + crane-rise-reveal 反向（拉远）
```
