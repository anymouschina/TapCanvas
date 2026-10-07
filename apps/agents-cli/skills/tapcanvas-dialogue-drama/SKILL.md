---
name: tapcanvas-dialogue-drama
description: TapCanvas 文戏与对白方法扩展。按当前人物交流、信息差和关系变化自主选择表演、话轮、调度、取景与声音；完整保留冻结发声，结构与引用服从本轮 schema。可按需加载，不强制逐句动作、镜头切换、旁白比例或复盘流程。
disable-model-invocation: true
knowledge-role: generation
knowledge-domains:
  - AI视频提示词
  - 视听语言演出
  - 叙事结构节奏
  - 音乐声音设计
metadata:
  contracts:
    - tapcanvas/video-prompt-authoring@4.1.0
  extensionOf:
    - tapcanvas-video-prompt-writer
---

# 文戏与对白扩展

把本轮冻结的人物交流拍成观众能理解的戏：谁知道什么、为什么这样说、对方如何理解，以及对话怎样影响选择和关系。保持来源的事实强度，人物猜测、态度和观众预期不等于客观结论；不为增强情绪新增秘密、动机或关系。

按当前场景自主选择演出方法。话轮、停连、语气、视线、姿态、道具和空间关系都能承载交流，变化也可跨多句累积。稳定双人调度、持续机位、长话轮、平静倾听和静默都可以成立；不要求每句前后加动作或每镜产生新事件。镜头帮助观众读懂交流，无需按一句一镜、固定景别顺序或快切模板安排。

完整保留父级冻结发声的文本、人物、方式、顺序和 Clip 归属。原文引用不改写、不拆成重复发声；口型对应实际开口，心声或画外音保持其声音身份。旁白、心声、配乐和文字按剧情与用户要求选择，没有固定比例或末位规则。

结构引用与时间 owner 以当前 artifact schema 和 `tapcanvas-video-authoring-stages` 为准。packet 使用有序镜头与显式 `speechEventIds/storyEventIds`；renderer 编入完整台词，writer 不把正文复制进动作或音效，也不自行创建逐句秒数或速度配额。供应商整段时长不是台词数量公式。

本扩展只提供文戏方法，不新增生产链、字段、审核者或质量门禁。需要更多方法时可选择读取已注册知识；只有成功读取才记入来源。来源追踪见 [dialogue-drama-provenance.md](references/dialogue-drama-provenance.md)，外部样例不能替代当前人物、对白、资产和剧情。
