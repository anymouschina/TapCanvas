---
name: tapcanvas-video-authoring-stages
description: 一键成片的分步创作合同。仅在已保存 Workflow IR 的章节编排、共享资产提取、逐 Clip 设计节点中使用；按本节点 artifact 类型交付，禁止把其它阶段内容重新塞回章节稿。
metadata:
  artifact-preload:
    tapcanvas.chapter-sequence/v4:
      - SKILL.md
      - references/chapter-sequence.md
    tapcanvas.source-unit-ledger/v1:
      - SKILL.md
      - references/source-ledger-and-beat-plan.md
    tapcanvas.chapter-beat-plan/v3:
      - SKILL.md
      - references/source-ledger-and-beat-plan.md
    tapcanvas.chapter-asset-outline/v2:
      - SKILL.md
      - references/chapter-assets.md
    tapcanvas.chapter-asset-part/v1:
      - SKILL.md
      - references/chapter-assets.md
    tapcanvas.chapter-asset-plan/v3:
      - SKILL.md
      - references/chapter-assets.md
    tapcanvas.clip-design/v2:
      - SKILL.md
      - references/clip-design-and-packet.md
    tapcanvas.clip-production-packet/v2:
      - SKILL.md
      - references/clip-design-and-packet.md
---

# 本轮 artifact 与共同来源

按调用方已声明的 workflowAgentOutputArtifactType、动态 schema 与冻结 delivery-contract 确定当前字段职责，不按用户正文猜阶段。runtime 按 metadata.artifact-preload 预读共同正文和对应 reference；已在上下文的内容无需重复读。缺少正文时用 Skill 的精确 resource 或已提供 sectionId 读取，目录索引不冒充正文，读取失败如实诊断并修复。

| artifact | 字段合同 |
|---|---|
| tapcanvas.chapter-sequence/v4 | [chapter-sequence.md](references/chapter-sequence.md) |
| tapcanvas.source-unit-ledger/v1、tapcanvas.chapter-beat-plan/v3 | [source-ledger-and-beat-plan.md](references/source-ledger-and-beat-plan.md) 的对应章节 |
| 共享资产及其冻结身份 | [chapter-assets.md](references/chapter-assets.md) |
| tapcanvas.clip-design/v2、tapcanvas.clip-production-packet/v2 | [clip-design-and-packet.md](references/clip-design-and-packet.md) 的对应章节 |

只交当前节点产物，各节点继承同一用户合同与模型，不自行发起图片或视频。来源身份、工具权限、供应商硬边界和真实回执保持准确；结构拒收记录具体证据并在同一逻辑任务修订，不把局部拒收升级为总体失败，不重新提交已受理媒体或丢弃已有资产。

## 完整剧情与表达

先完成本轮范围的完整故事，再投影到技术 Clip。已有叙事保留事件因果、人物关系、知情变化与结尾；可删不承担剧情的信息，完整不等于全文照搬。简报约束整片，文字顺序或 source unit 不自动成为事件或 Clip 顺序。来源追溯不替代实际声画表达；原话引用与冻结声音逐字准确，改写和增补保留创作身份。

画面、对白、心声、旁白和文字由作者平等选择，必要信息在观众实际看到或听到的内容中成立。供应商字段写可拍、可听内容，规划、来源和修订说明放在 schema 已声明的内部字段或工作记忆。声音来源不自动成为可见人物；画外、镜头暂未拍到与离场是不同事实。

## 状态与技术边界

技术窗口不新造开场、蓄力或收束。相邻段接续真实位置、持物、动作和声音进程；回忆、时空省略及状态重置按来源与作者设计明确连接。首尾态只含该时刻已成立的事实，不能提前兑现结果或把背景、习惯与推测拍成当前现场事实。既有媒介、材质与色彩锚点共同继承；无明确媒介时章级作者依据真实视觉证据作创作选择，下游保持一致。

previousChapterExit 若由 canvasFacts 提供，是前章最近一次成功章序列的退出回执，仅作跨章进入态依据，不是本章原文；后续媒体可能失败。与本章来源冲突时保留两者身份，在作者链核对，不能把旧错升级为权威。来源未知的事实保持未知。

v4 从有序事件与 Clip 归属理解边界，不给内部镜头或对白分秒；只有 chapter-beat-plan/v3 当前合同提供全局时钟时才按时刻推演。修改后回读受影响的剧情、声音与相邻状态，修订实际内容；自审没有固定镜数、反转、声轨比例或知识读取量，也不成为宿主语义闸门。
