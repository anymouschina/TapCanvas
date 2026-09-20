---
name: tapcanvas-video-authoring-stages
description: 一键成片的分步创作合同。仅在已保存 Workflow IR 的章节编排、共享资产提取、逐 Clip 设计节点中使用；按本节点 artifact 类型交付，禁止把其它阶段内容重新塞回章节稿。
---

# 分步视频创作

以调用方声明的输出 artifact 和严格 schema 确定当前职责。全部节点继承同一用户合同与模型；只写本节点产物，不自行提交图片或视频。结构修复留在当前持久节点，保留其它节点产物。

## tapcanvas.chapter-beat-plan/v1：章节编排

阅读 delivery-contract.canvasFacts 的完整 authoritativeSources 与已确认 expandedSourceDraft。先逐项列出来源义务和原文对白，再安排物理 Clip。完整覆盖事件、因果、信息揭示、人物选择、状态变化和结尾；不以摘要替代来源，不为了速度压缩章节。对白逐字分配到 speechLedger，长台词可以按原顺序分为连续片段并分配不同 clipIndex，不改写台词或漏字。

从 generationContract 的真实供应商时长选项选择每拍 durationSeconds，按真实发声与动作需要增加 Clip，不给整章套固定片段数。每拍明确 sourceSpan、叙事职责、因果入口、不可逆结果、交接、storyEvents 及局部时间。全章共享 chapterArc 与 sourceFidelityAudit。

本节点不设计参考图、不写 objectRegistry/assetPlans/objectStates/blockingPlans、镜头构图或最终视频提示词。人物语义仍由来源事实表达，后续共享资产节点登记稳定身份，各 Clip 引用该身份。

## tapcanvas.chapter-asset-plan/v1：共享资产提取

从相同完整来源识别人、场景、道具及其它可见对象。projectAssetCandidates 是全部就绪图片的精简目录；需要详情时使用 tapcanvas_workflow_execution_inspect，传本 executionId、view="assets" 与候选中的精确 assetIds，按需读取，不设置最低读取数。以真实项目候选及需要时读取的详情决定复用或创建；同一肉身/同一物件保持一份 objectRegistry，不以名称差异创建重复身份，不把不同身份合并。登记 objectId、来源支持的 identityInvariant、physicalIdentityKey、明确 referenceRole 和精确已有图片 ID。

仅为确需新增参考图的对象写 assetPlans；已有合适素材时保留引用，不重复生图。计划用 objectId 引用已登记对象，每个新对象至多一份计划。人物参考图按 tapcanvas-character-card，场景按 tapcanvas-scene-card，道具按 tapcanvas-prop-card 按需读取与设计。不要把 registry 专属字段放入 assetPlans；只交付本节点 schema 中对应位置的字段。每个实际场景另写一份 backgroundPlans，objectId 精确指向登记对象，plan 是同一场景共享的无人俯视底图计划。不同背景状态由资产节点登记不同对象与计划，不由逐 Clip 作者重复编写。这里只设计，真实生图由后续 Workflow 媒体节点执行。

## tapcanvas.clip-design/v1：逐 Clip 视觉设计

只处理输入 clipIndex 对应的一拍，原样遵守冻结的剧情、对白与时长，结合 previousBeat/nextBeat 设计连续性。以共享 objectRegistry 中真实 objectId 选择本拍可见对象，在 objectStates 写具体状态变化及引用；不新造登记表里不存在的 ID。需要同一对象多视角时保留所需精确引用，不能空引用代替已有参考。

创作 visualIntent、首尾关键帧、明确发声速率和 narrativeAudioPlan。sourceLineId 指向本拍分配的 speechLedger 原始 lineId；额外独立发声才使用 null，不把同一句来源重复生成。创作 blockingPlan 的地标、人物站位、机位、轴线和构图；characters 覆盖本拍所有可见 character 对象。blockingPlan.backgroundObjectId 只选择输入 backgroundPlans 的精确 objectId。背景提示词及生成身份由共享资产节点冻结，本节点不重写、不引用尚未生成的底图节点 ID。

timing.temporalDirectives 使用本 Clip 局部秒数，范围 [0,durationSeconds]；不要累计前面各拍时长。宿主按章节顺序编译绝对时间，不改写窗口语义。只写当前 Clip 的视觉字段，不在 beat 中重写 durationSeconds、sourceSpan、storyEvents 等章节计划字段。最终视频提示词仍由下游逐 Clip writer 完成。

共享资产计划完成后会立即并行执行图片准备，不再等待逐 Clip 设计。资产作者以章节完整来源确定必要资产，并在 objectRegistry 中保留全部选定的既有图片精确 ID；assetPlans 是实际要生成的图片简报，不是推测性的备选目录。Clip 作者从冻结注册表选择引用，不新增或改写共享身份；逐 Clip 消费者由执行器在设计完成后绑定到已物化资产。

## 资产身份与枚举

同一资产可被多个对象、多段 Clip 使用：保留每条对象引用，不能为每个 Clip 新建资产，也不能因复用一张图而删除其中一个对象。`objectId` 是故事对象身份，`referenceAssetIds` 是冻结目录里的真实媒体句柄；新图片的资产身份、物化任务和幂等键由执行器分配，作者不自行拼接。视觉内容确实不同才登记独立对象/变体，不能按展示名或提示词相似度机械合并。

`kind` 只允许 `character / scene / prop / vfx / palette / composition`。`referenceRole` 只允许 `none / identity / wardrobe / prop / environment / palette / composition / vfx`。其中 `environment` 表示空间参考用途，`wardrobe` 表示服装参考用途，两者不是对象类型。图片供应商输入的 `layout / style / identity / content` 是另一组枚举，不可混填。
