---
name: tapcanvas-video-authoring-stages
description: 一键成片的分步创作合同。仅在已保存 Workflow IR 的章节编排、共享资产提取、逐 Clip 设计节点中使用；按本节点 artifact 类型交付，禁止把其它阶段内容重新塞回章节稿。
knowledge-role: generation
knowledge-retrieval-policy: agent_discretion
knowledge-domains:
  - 叙事结构节奏
  - 角色一致性
  - 场景一致性
  - 状态连续性
  - 视听语言演出
  - AI视频提示词
metadata:
  artifact-preload:
    tapcanvas.chapter-sequence/v5:
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
      - references/face-design.md
    tapcanvas.chapter-asset-part/v1:
      - SKILL.md
      - references/chapter-assets.md
      - references/face-design.md
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
| tapcanvas.chapter-sequence/v5 | [chapter-sequence.md](references/chapter-sequence.md) |
| tapcanvas.source-unit-ledger/v1、tapcanvas.chapter-beat-plan/v3 | [source-ledger-and-beat-plan.md](references/source-ledger-and-beat-plan.md) 的对应章节 |
| 共享资产及其冻结身份 | [chapter-assets.md](references/chapter-assets.md) |
| 新建人物的六格设计表（脸、发型、体型、体态、主色、标志）与身份板 | [face-design.md](references/face-design.md) |
| tapcanvas.clip-design/v2、tapcanvas.clip-production-packet/v2 | [clip-design-and-packet.md](references/clip-design-and-packet.md) 的对应章节 |

只交当前节点产物，各节点继承同一用户合同与模型，不自行发起图片或视频。来源身份、工具权限、供应商硬边界和真实回执保持准确；结构拒收记录具体证据并在同一逻辑任务修订，不把局部拒收升级为总体失败，不重新提交已受理媒体或丢弃已有资产。

## 完整剧情与表达

先完成本轮范围的完整故事，再投影到技术 Clip。已有叙事保留事件因果、人物关系、知情变化与结尾；原文每段内容都要演到，可以压缩、合并，但不删；完整不等于全文照搬。简报约束整片，文字顺序或 source unit 不自动成为事件或 Clip 顺序。来源追溯不替代实际声画表达；原话引用与冻结声音逐字准确，改写和增补保留创作身份。

画面、对白、心声、旁白和文字由作者平等选择，必要信息在观众实际看到或听到的内容中成立。供应商字段写可拍、可听内容，规划、来源和修订说明放在 schema 已声明的内部字段或工作记忆。声音来源不自动成为可见人物；画外、镜头暂未拍到与离场是不同事实。

## 图片提示词的未成年人与性内容

写给图片模型的提示词（身份板、场景与站位参考、关键帧、首尾帧）里，原文的未成年人（含 16 岁；只写“学生、少年、少女”未写年龄的同样按未成年人处理）性情节或任何人物的露骨性描写，改画事后或他人知情的一格：未成年人不画“要发生”的铺垫，成年人之间用暗转或事后；不写年龄数字与身体细节，不靠改年龄、写“成熟”过审。这只约束图片提示词，视频提示词、剧情与台词按冻结内容原样处理，不因此删改。写法与范例见 [minor-and-sexual-content-rewrite.md](references/minor-and-sexual-content-rewrite.md)。

## 状态与技术边界

技术窗口不新造开场、蓄力或收束。相邻段接续真实位置、持物、动作和声音进程；回忆、时空省略及状态重置按来源与作者设计明确连接。首尾态只含该时刻已成立的事实，不能提前兑现结果或把背景、习惯与推测拍成当前现场事实。既有媒介、材质与色彩锚点共同继承；无明确媒介时章级作者依据真实视觉证据作创作选择，下游保持一致。

跨 Clip 衔接分别考虑故事状态与观看构图。普通切镜继承人物身份、空间关系、视线方向和动作阶段，不要求下一段复刻上一段末画面的景别、人物占比或姿态停留。章级作者在现有 picture 与 Clip 边界描述中设计接点：需要切镜时，优先考虑有叙事理由且肉眼清楚可辨的景别或视点变化，例如从特写切到能读清互动的中景、或能读清空间后果的全景；动作从切点继续，不重演已经发生的起势或结果。进入态与退出态写交接时刻已成立的事实，观看方式写在画面表达中，不能用换构图改人物位置或跳过必要动作。

不同景别名称不自动保证顺畅，同景别的正反打、主体切换或有意连续取景也可成立。对照的是上一段实际末镜与下一段实际首镜的观看距离、主体占比、视点和动作进程；仅改景别标签、轻微裁切或重复摆姿后再动，仍可能产生卡顿感。技术分段不强加收势、定格、再次开场或景别轮换；连续长镜头、静默和有意停留按本轮意图保留。此处是作者的非阻塞判断依据，不设重叠率、角度、镜数或质量门禁；无实片时只确认设计，不宣称已消除成片卡顿。

previousChapterExit 若由 canvasFacts 提供，是前章最近一次成功章序列的退出回执，仅作跨章进入态依据，不是本章原文；后续媒体可能失败。与本章来源冲突时保留两者身份，在作者链核对，不能把旧错升级为权威。来源未知的事实保持未知。

v4 从有序事件与 Clip 归属理解边界，不给内部镜头或对白分秒；只有 chapter-beat-plan/v3 当前合同提供全局时钟时才按时刻推演。修改后回读受影响的剧情、声音与相邻状态，修订实际内容；自审没有固定镜数、反转、声轨比例或知识读取量，也不成为宿主语义闸门。
