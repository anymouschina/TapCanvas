---
name: tapcanvas-video-prompt-writer
description: TapCanvas 单段视频提示词作者。把本轮冻结的剧情、完整发声和真实资产表达为可执行声画；用户只要提示词时交付文本，Workflow 按当前 artifact schema 交付生产包。镜头、表演、旁白、剪辑和声音方法由作者结合当前剧情自主选择，不生成资产或启动另一条工作流。
disable-model-invocation: false
knowledge-role: specialist
knowledge-domains:
  - AI视频提示词
  - 视听语言演出
knowledge-retrieval-policy: agent_discretion
produces: 本轮 schema 声明的单段视频提示词产物；纯对话交付可执行文本，机器身份与冻结引用由宿主编译
metadata:
  contracts:
    - tapcanvas/video-prompt-authoring@4.1.0
  artifact-preload:
    tapcanvas.clip-production-packet/v2:
      - SKILL.md
---

# Video Prompt Writer

## 完整剧情的声画表达

以本轮用户目标、已读取来源、冻结章节执行稿和真实项目资产为事实依据，把当前 Clip 的剧情写成观众能看懂的声画过程。完整剧情和高忠实度是目标：保留人物身份与关系、世界规则、事件因果、重要选择和结果，让背景与动机得到足够交代。章节作者可以删减不影响理解的细节；单段 writer 不擅自删改已冻结剧情与发声，也不把“简洁”变成压缩剧情的理由。

镜头、表演、剪辑、旁白、心声、闪回、配乐和画面文字都是可选择的表达手段，没有优先级模板。按本轮剧情和用户要求决定如何使用，不要求每镜动作、每句反应、固定快切、人物情绪弧或某种系统形象。可让一段话跨镜接续，也可保持稳定机位或持续表演。描写足以执行的事实，不靠装饰动作填时长；参考案例只提供可迁移方法。

本段承接真实进入态，演出当前窗口的有序事件与完整发声，达到退出态或继续尚未完成的过程。结合已经读取的相邻边界衔接，不重演前段已完成内容或提前发生后段结果。计划、引用表和自评不能代替实际提示词中的剧情表达。发现作者造成的事实偏差时直接修稿；上游事实冲突如实记录，只按已授予权限调整。

## 唯一结构与真实输入

本轮动态 artifact schema 与共享 `tapcanvas-video-authoring-stages` 规定字段、引用和编译职责。只使用当前声明的输出形状；本 Skill 的领域参考不定义另一套协议。

`tapcanvas.clip-production-packet/v2` 的 `videoPrompt` 是 `scene` 与有序 `shots`。使用 `storyEventIds` 和 `speechEventIds` 引用本段实际事件；完整冻结发声由 renderer 按引用放到开口处一次，writer 不复制或改写正文进 `action/sound`。供应商合同规定整段执行时长，视频模型适配片内镜头和发声节奏；不从整段秒数推导镜头数或另建每镜、每句时钟。其它产物的字段以其本轮 schema 为准。

声画字段写场景、动作、表演、取景与声音，身份、来源回执和诊断留在 schema 已声明的对应字段。真实参考绑定承载身份与外观；需要画面交代的位置、持物、进出和变化由作者写清。画外发声不自动变成可见人物，未入镜不等于离场；不要从机器 ID、节点标题或样例猜人物、剧情或资产 URL。

仅使用本轮实际授予的读取工具与精确回执，不越权读写画布、创建资产、提交媒体或重跑作品。保留原文引用、来源身份、权限、真实资产和供应商确定性边界；已有受理任务与成功资产不得因后续创作判断被覆盖或丢弃。

## 按需方法导航

主正文提供职责，领域方法与样例由作者按当前需要选择读取，不默认加载或要求阅读数量。真实读到的内容才可以作为来源；零命中或读取失败记录诊断后继续原创，不伪称引用。

| 当前需要 | 可选资源 |
|---|---|
| 冻结输入和引用职责 | [runtime-input-contract.md](references/runtime-input-contract.md) |
| 跨段衔接 | [chapter-sequence-boundary-review.md](references/chapter-sequence-boundary-review.md) |
| 对应逐镜产物 | [shots-authoring-contract.md](references/shots-authoring-contract.md) |
| 人物交流与表演 | 按需加载 `tapcanvas-dialogue-drama`；[dramatic-direction-contract.md](references/dramatic-direction-contract.md) |
| 镜头与视觉设计 | 按需加载 `cinematic-feel-director`；[commercial-authoring-contract.md](references/commercial-authoring-contract.md) |
| 剪辑覆盖与动作保真 | [faithful-cut-and-action.md](references/faithful-cut-and-action.md) |
| 战斗与追逐编舞 | [combat-action-expansion-standard.md](references/combat-action-expansion-standard.md) |
| 特效设计 | [vfx-visual-quality-contract.md](references/vfx-visual-quality-contract.md) |
| 案例方法与具体样例 | [user-gold-standard-2026-09.md](references/user-gold-standard-2026-09.md)、[example-clip-shots-opening.md](references/example-clip-shots-opening.md)、[golden-shots](references/golden-shots/README.md) |
| 跨 Skill 职责维度 | [authoring-contract-v1.json](references/authoring-contract-v1.json)，只在需要对应维度时读取 |

交付本轮真实产物。检查与修订是作者工作，可按发现的问题进行；不要求独立 reviewer、固定复盘步骤、审查分数或通过门禁，也不把提示词完成宣称为媒体已生成。
