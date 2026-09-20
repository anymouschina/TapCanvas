---
name: video-shotcraft
description: 产品/SaaS 宣传片镜头配方卡（蒸馏自 video-shotcraft 开源 skill 的 104 张卡 · 原版基于 Remotion 代码渲染，本版全部改绑 TapCanvas 现有能力）。提供三层落地判定——生成层（运镜意图写进 clipPrompt 交 AI 视频模型）、合成层（转场交 media-worker xfade）、不可行层（DOM/CSS 帧级精确动效，明确拒绝而非降级硬凑）。两种用法：①给叙事片补产品级运镜/节奏词汇；②走产品宣传片新路径（真实页面截图当关键帧素材）。当用户要求做产品片/宣传片/功能演示片、点名镜头卡名字（如 crash-zoom-punch / spotlight-hero-card）、或问「这个动效能不能做」时使用。
disable-model-invocation: false
knowledge-role: director
knowledge-domains:
  - 视听语言演出
  - AI视频提示词
  - AI视频剪辑衔接
  - 叙事结构节奏
---

# video-shotcraft：产品片镜头配方卡（TapCanvas 绑定版）

## 本 skill 与原版的根本差异（先读，决定你能承诺什么）

原版 video-shotcraft 用 **Remotion**：React 组件逐帧渲染真实页面截图，能控到
「克隆体透明度 100%→20% 线性衰减」「分割杆 12f 快甩 vs 48f 慢扫」这种帧级精度。

TapCanvas **没有代码渲染层**。能力只有两样：

1. **AI 视频生成**（seedance/pixverse 等）——按 clipPrompt 自然语言生成，
   拿不到帧级精度，但能理解真实摄影语汇（急推、跟移、俯冲、变速）。
2. **ffmpeg 合成**（`apps/media-worker` + `video-concat`）——xfade 转场、
   trim、scale/crop、色彩匹配。没有 `drawtext`/`overlay`/`zoompan`。

所以 104 张卡必须分层。**禁止把不可行层的卡降级硬凑成「近似效果」再交付**——
那是拿用户的额度换一个必然被拒的成品。判定表见
`references/shot-taxonomy.md`，逐卡标了层级和理由。

## 第 0 步：分层判定（先于选卡）

用户点名任何卡，或你想用任何卡，先查 `references/shot-taxonomy.md` 的层级：

| 层级 | 张数 | 落地方式 | 你的动作 |
|------|------|----------|----------|
| **G 生成层** | 34 | 运镜意图写进 clipPrompt，交 AI 视频模型 | 直接用，按 `references/tapcanvas-mapping.md` 翻译 |
| **C 合成层** | 9 | 交 media-worker xfade（需 `transition` 字段） | 直接用，查映射表取 xfade 值 |
| **X 不可行** | 61 | 无落地面 | **明确告知不可行 + 给同意图的 G 层替代卡**，不硬凑 |

用户点名 X 层卡时的标准话术：该卡是 DOM/CSS 帧级动效（说明具体是什么，如
「7 个克隆体按 120px 等距 + 透明度线性衰减」），TapCanvas 是 AI 生成 + ffmpeg
合成，给不了这个精度；同意图可用 `<G 层替代卡>`，差异是 `<具体差异>`。
要不要换？

## 两种用法

### 用法 A：给叙事片补产品级运镜词汇（默认，改动最小）

不新开题材。走 `tapcanvas-video-workflow` 既有整章链路，只在写 clipPrompt 时
从 G 层卡取运镜/节奏词汇。**本 skill 在这个用法里只是词汇表**，不接管流程，
不改 BeatSheet 结构，不新增阶段。

冲突时的真相源顺序不变：`tapcanvas-storyboard-expert` 的
`references/镜头语言规则.md` v2 > `tapcanvas-video-workflow` 的
`references/v3-visual-motion-standard.md` > 本 skill。本 skill 只补
「产品/科技感运镜」这一层原有知识域覆盖较薄的词汇（急推撞停、伪 dolly-zoom、
帧率量化突变、速度比节奏），不覆写任何既有硬判断。

### 用法 B：产品宣传片新路径

题材不同于叙事片：没有角色/章节/剧情连续性，主体是产品界面与功能卖点。
流程见 `references/product-pipeline.md`。核心差异：

- **素材来源是真实页面截图**，不是 AI 生图角色卡。截图当 image 关键帧喂
  图生视频，AI 只负责运镜与光影，不负责画 UI（AI 画不出可读的真实 UI 文字）。
- **无连续性资产链**：不需要角色卡/场景卡/道具卡/说话人验真。
- **文案不进画面**：typography 类卡全在 X 层（无 `drawtext`）。标题文案交
  用户后期加，或用截图里已有的真实文字。

## 硬约束

- 不新增全屏 Modal（项目设计原则）。本 skill 不产 UI。
- 一支片同一手法 ≤2 次（原版 P4 手法去重精神），急推类 ≤2 次。
- 原版卡里的帧数/参数表（6f 急推、120px 间隔、5:1 速度比）**是 Remotion 调校
  值，不要照抄进 clipPrompt**。AI 模型读不懂帧数，只读得懂「一拍之内急推」
  「快甩后以约五分之一速度慢扫」。翻译规则见 `references/tapcanvas-mapping.md`。
- 卡的「已知坑」段落里，凡涉及渲染实现（渲染顺序、透明度卸载阈值、
  `CameraMotionBlur` 采样数）的一律不适用；凡涉及**可感性阈值**
  （幅度须过肉眼阈值、少于 5 个读不出「队」、速度比 <3:1 对比不可感）的
  **仍然适用**——这些是人的感知规律，与实现层无关。

## 原始卡查阅

原版 104 张卡全文（含 Remotion 实现细节与 demo 源码路径）在
`~/.claude/skills/video-shotcraft/references/shots/<类别>/<卡名>.md`。
需要读原卡时只取「意图」「适用」「时长」「能量」和已知坑里的可感性条目，
跳过「动效核心」「参数表」「参考实现」三段。
