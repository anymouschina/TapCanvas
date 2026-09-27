---
name: tapcanvas-video-authoring-stages
description: 一键成片的分步创作合同。仅在已保存 Workflow IR 的章节编排、共享资产提取、逐 Clip 设计节点中使用；按本节点 artifact 类型交付，禁止把其它阶段内容重新塞回章节稿。
---

# 分步视频创作

以调用方声明的输出 artifact 和严格 schema 确定当前职责。全部节点继承同一用户合同与模型；只写本节点产物，不自行提交图片或视频。提交前核对结构合同；若运行时退回精确字段路径，保留原候选与失败证据，由同一作者在当前逻辑任务内修订。不得绕过 schema、切换模型或重做已经成功的媒体动作。

当前紧凑工作流的 `tapcanvas.chapter-sequence/v1` 在来源分段之后按冻结 Clip 各提交一次起止关键帧、因果交接、局部事件与发声范围，再按原顺序合并校验。逐 Clip 作者消费按 clipId 投影的 `tapcanvas.chapter-sequence-clip/v1`、章级资产注册表及冻结来源，提交 `tapcanvas.clip-production-packet/v1`。它应逐字承接已投影对白，保留相邻段状态与时间窗，并在 packet 中提交视频提示词、带语义名称和来源选择的资产意图、结构化 blockingPlan。相同注册对象跨 Clip 引用同一个 registryObjectId；图像与视频节点由执行器投影。此路径没有独立站位图绘制节点，不得把 blockingPlan 描述为已生成图片。以下旧版章节 BeatSheet、逐 Clip 设计章节仅适用于请求的 artifact 确实为所述类型时，不能要求紧凑 packet 再提交那些独立旧产物。

紧凑 packet 的每个 `assetIntent` 只选择 `registryObjectId` 和与冻结章级对象一致的 `imageSource`：复用提交 `{mode:"reuse",registryAssetIndex}`，索引从该对象 `imageSource.assetIds` 零起；新图提交 `{mode:"generate"}`。逐 Clip 不抄写 `assetId/state`、长 `existingAssetId/existingProjectId`、卡片元数据或生图规格；宿主从冻结章级计划投影同一对象的共享图片身份、语义名称、参考职责和生图提示词。局部服装、动作、情绪与镜头状态由本 Clip 的视频提示词表达，不另造身份卡。根级 `imageModelKey/imageAspectRatio/imageSize` 按冻结 delivery-contract 的真实模型参数提交；实际可执行 URL 由媒体阶段验证和绑定。

逐 Clip packet 的视频图像引用也只选择本 packet `assetIntents` 的零起索引：`firstFrameAssetIndex` 为整数或 `null`，`referenceAssetIndices` 为索引数组；不要重复提交 `firstFrameAsset` / `referenceAssets` 的身份与状态。`blockingPlan.backgroundPlanIndex` 从冻结 `chapter-assets.backgroundPlans` 零起选择，逐 Clip 不重复抄写 `backgroundObjectId`。宿主只按这些明确索引派生 canonical 身份和背景，不猜创作意图；首帧索引应同时出现在引用索引中。

## tapcanvas.source-unit-ledger/v1：独立原文单位

本节点在章节分拍之前执行，与共享资产提取并行。只从冻结原文识别信息单位、说话人及表达载体，不编排时长、不创作画面。运行时 schema 的 `x-sourcePartition` 给出精确 `sourceId` / `sourceFingerprint`，以及按排版切分的 `sourceLineId`、UTF-16 行长和代理对边界；正文已在 delivery-contract 中提供，不要在输出里重复正文。按原行顺序提交语义单位，每个单位只输出 `sourceLineId`、左闭右开的 `startOffset` / `endOffset` 及表达语义字段。宿主会从冻结行切片恢复精确文本并生成 `unitId`。必须覆盖每一行的全部 UTF-16 范围，单位之间无间隙、无重叠，偏移不能切开 Unicode 代理对；不得漏行、跳字或把整行不分语义地重复输出。标题与叙述也要归入适当单位。

每个单位只含一类表达：`spoken` 当场或画外明确发声，`thought` 明确的内心原句，`written` 屏幕消息/文件等可读文字，`narration` 动作、归属提示及其它叙述。引号只是排版，不决定表达类别。读完整上下文判定谁在说、想或写，不能以最近出现的人名猜归属；说话提示、引号等非台词正文可单独划为 narration，保持整行逐字分区而不把“他说”念出。缺右引号时仍根据上下文区分每个话轮，不能机械并到下一个右引号。混合行先分离动作/心理状态叙述，再识别其中具有具体措辞的内心自问、吐槽或判断；不能因没有引号就把内心原句整段归入 narration。

`spoken/thought` 的 `speakerName` 与 `delivery` 必须由作者明确；thought 的实际声音设计使用 `voice_over`，`on_screen` 只表示人物画内发声。`written/narration` 的 `delivery` 必须为 `null`，文字消息不会自动进入对白；`speakerName` 可记录明确作者或为 `null`。表达类别和说话人由你依据上下文判断；schema 与宿主只验证字段类型、来源身份和范围覆盖，不替你推断语义。

提交前独立重读完整原文，检查每段的表达类别与人物归属，尤其检查多轮对话、内心和通讯消息。结构校验只能证明分区逐字完整，不能替代作者的语义核对。该产物独立持久化后，后续节点不得重新分类、换说话人或改正文。

## tapcanvas.chapter-beat-plan/v3：章节编排

完整 `full_video` 工作流直接从 canonical 原文建立 `source-ledger` 与本节点输入，不经过 text-expansion；原文已足够时不添加无消费者的扩写阶段。只有 `first_video` 变体可以显式连接 `expanded-source`，该输入是非权威草稿，存在时等待后参考，不能替代冻结来源或改变来源覆盖合同。

先读取独立 `source-ledger` 端口与 delivery-contract。根据来源单位规划全章剧情与物理 Clip，每个 beat 提交 `sourceUnitRefs:[{unitId}]`；仅当长单位在自然分句处跨相邻 beats 拆分时，为该段追加结束 `endOffset`（单位 text 内 UTF-16 索引，区间左闭右开）。`startOffset` 是引用顺序的游标状态，由宿主从上一引用的结束处确定性派生，模型不提交、不抄写。纯反应、停顿或过渡拍不消费新的原文时，可明确写 sourceUnitRefs=[]，由相邻剧情事实说明拍摄作用，不能为填满引用重复原句。每个单位的全部文字按原序分配且只分配一次，含 written/narration；不可丢字、重复或切开 Unicode 代理对。时长不够应增加拍或调整分配，不抬高语速、不删原句。

本节点不再提交 dialogueScript、speakerName、对白 text 或独立 speechLedger。对白与说话人由宿主从已冻结单位及引用范围投影，原文单位就是唯一来源权威；storyEvents 与关键帧负责把对应来源变成实际可拍表达。源账本有归属疑点时保留其具体证据供来源作者修订，不能在本节点悄悄改人或假称已解决。sourceFidelityAudit.sourceBeatLedger 只是剧情组织的摘要证据，不替代独立原文账本，也不新增 schema 未声明字段。

从 generationContract 的真实供应商时长选项选择每拍 durationSeconds，先按完整发声、动作和反应需要分配时间，不给整章套固定片段数。dialoguePaceRate 单位是可发声字符/秒，不是播放倍速。先依据人物情绪、句子难度和听众需要确定自然表演速率，再分配对白；不能用“总字数÷现有秒数”倒算速率，或在容量不足时抬高速率让算式通过。发声最短时长之外还要安排换人接话、理解与反应；并行发生的动作明确重叠关系，不把同一段时间重复承诺给必须先后发生的行为。装不下就沿自然分句拆到相邻 beats、增加片段，保留原话与反转发生顺序，并同步所有来源追溯、事件和交接。没有固定合格语速或最低留白比例；容量观察是作者修订分配的事实证据，不能替代表演判断。

每拍先从 startKeyframe 的当前状态沿 storyEvents 的局部时间推演，最后得到 endKeyframe；三个字段描述同一条发生过程，不各写一份剧情摘要。首帧是拍内变化发生前已经成立的状态，不能预先呈现本拍稍后才发生的销毁、成交、揭示或抵达。已完成的不可逆动作不在下一拍再演，变化后的物件与关系继续有效；相邻 endKeyframe/startKeyframe 对齐后，causalEntry、handoffToNext 也要使用同一时态，不把已落座又写成即将落座。有明确时空省略则交代转场。跨拍对白未结束时，边界也不能声称说完或进入静默。局部修订后重读相邻两拍及 chapterArc/sourceFidelityAudit，清除旧状态和旧时钟；不新增平行状态台账。

分别确定信息的载体与角色的发声。通讯消息、屏幕文字、文件条款首先是可读信息，可在现有 storyEvents 与关键帧中明确呈现；它们不因有引号或位于屏幕上就进入 dialogueScript。on_screen 表示画内人物发声，不表示屏幕上显示文字。改编若确需朗读、录音或内心复述，明确谁在发声及其在画内、画外或旁白的来源，保持信息身份和先后顺序，不凭消息发送者名字虚构对方在场。内心判断、世界规则和因果理解同样检查实际可见或可听的表达落点；只在 storyEvents 写“已经理解”不构成观众得到这些信息。删减或改变表达方式按来源忠实性规则说明，不把摘要覆盖当成已执行覆盖。

涉及所有权、债权义务、授权或交易时，区分当时已生效的事实、附带条件的安排、角色的猜测和未执行的意愿。债务转移或免息缓还不等于债务免除；报价与想签字不等于已经签约。chapterArc、sourceFidelityAudit、事件、关键帧与对白保持相同的主体、条件和完成状态，不用更戏剧化的摘要改变事实。原文内心误判可保留为角色判断，后续反转不能倒写成前一时刻已经知道的真相。

提交前做一次完整候选检查：①原文信息是否各有表达落点，sourceSpan 是否覆盖该拍实际引用；②按真实播放顺序读 sourceUnitRefs 指向的人声，声音载体和自然节奏是否成立；③从首帧逐事件推演到尾帧，再接下一拍，是否重复执行或提前兑现；④摘要中的状态、义务与条件是否和详细产物一致。发现问题就在同一章稿修订并回读受影响部分；这些是作者方法，不是运行时评分、关键词检查或终态闸门，也不声称仅靠自检能确定性保证语义质量。

本节点不设计参考图、不写 objectRegistry/assetPlans/objectStates/blockingPlans、镜头构图或最终视频提示词。人物语义仍由来源事实表达，后续共享资产节点登记稳定身份，各 Clip 引用该身份。

## tapcanvas.chapter-asset-plan/v3：共享资产提取

每个 `objectId` 在本次 `objectRegistry` 内必须唯一。若运行时退回重复位置，依据两条对象的来源事实决定合并同一身份，或为不同身份各自赋予稳定 ID，并同步其引用；不得机械删除条目或全局改名。

从相同完整来源与本轮用户授权的改编范围识别实际入镜的人、场景、道具及其它主体，仅对白提及而未出镜的对象不进入视觉 objectRegistry。projectAssetCandidates 只含用户本轮显式选择的就绪图片；没有选择时它为空，历史资产目录不在章节作者上下文中。显式选择的图片必须保留精确 assetId 和来源职责，不能把它当作其它肉身或其它地点。其余主体按本章来源提交语义化身份与完整生成计划，不猜历史图片 ID；通用资产节点执行时再通过项目记忆检索历史，按稳定身份与真实资产 URL 验证复用。已有观察只回答其原问题；风格观察不证明人物外观或地点。需要可见内容时复用相关观察，或使用已授权图片理解；不可用时保留未知，不凭旧 prompt 添加眼镜、衣着、地标等事实。同一肉身/同一物件保持一份 objectRegistry，不以名称差异创建重复身份，不把不同身份合并。登记 objectId、来源支持的 identityInvariant、physicalIdentityKey、明确 referenceRole 和精确已有图片 ID。不同视角按实际信息保留，用户显式选择保持可追溯。

每个 objectRegistry 对象必须声明唯一 `imageSource`：`{mode:"reuse",assetIds:[精确已有图片ID]}` 表示这些图本身就是最终输出；`{mode:"generate",referenceAssetBindings:[{assetId,role}],plan:{本类型生图字段}}` 表示生成新图，已有图仅作为明确用途的输入。两种模式互斥；每个实际入镜主体都必须复用或生成真实资产，不接受 mode=none 或 referenceRole=none。严禁把需要改布局/人物/空间的新图设计写成 reuse。生成参考 role 仅允许 identity/content/layout/style；不需要参考时明确给 []。plan 不重复 objectId，根级没有 assetPlans，registry 不写 referenceAssetIds/referenceImageNodeIds。Clip 输出引用由执行器投影：reuse 保留真实句柄，generate 等新图实际完成后绑定，生成输入旧图不进入视频输出引用。

人物新图按 tapcanvas-character-card，场景按 tapcanvas-scene-card，道具按 tapcanvas-prop-card 按需设计。每个实际场景另写 backgroundPlans，objectId 精确指向登记对象，plan 是同一场景共享的无人俯视底图计划。不同背景状态由资产作者登记不同对象与计划，不由逐 Clip 重复编写。这里只设计，真实生图由 Workflow 媒体节点执行。

本轮交付要求每个实际入镜主体都有真实资产：资产作者逐一选择对应 referenceRole，有合用图片就 reuse，缺少合用图片就 generate 并提交完整计划；不能因缺图、只出现一次或省略计划而免除资产生产。同一主体跨 Clip 共用一份 objectRegistry 和同一资产，不按 Clip 重复生成；仅对白提及而未出镜的对象保留在叙事事实中，不登记为视觉主体。背景底图与逐 Clip 站位图承担空间和构图职责，不能替代人物身份参考。提交前由资产作者对照本轮范围内的实际入镜主体自检，补齐参考职责和来源；主体识别由作者完成，宿主只执行明确的资产来源与真实 URL 合同。

## tapcanvas.clip-design/v2：逐 Clip 视觉设计

只处理输入 clipIndex 对应的一拍，原样遵守冻结的剧情、对白与时长，结合 previousBeat/nextBeat 设计连续性。以共享 objectRegistry 中真实 objectId 选择本拍可见对象，在 objectStates 写具体状态变化及引用；不新造登记表里不存在的 ID。需要同一对象多视角时保留所需精确引用，不能空引用代替已有参考。

创作 visualIntent 和 narrativeAudioPlan，按冻结关键帧细化中间过程，不重新编写首尾关键帧、发声速率或来源对白。sourceLineId 指向本拍 speechLedger 原始 lineId；额外独立发声才使用 null，不把同一句来源重复生成。对象的 startState/endState 与章节的 startKeyframe/endKeyframe 保持同一可见状态，不更换持物手、重演已完成入场或提前兑现下一拍。创作 blockingPlan 的地标、人物站位、机位、轴线和构图；characters 覆盖本拍所有可见 character 对象。blockingPlan.backgroundObjectId 只选择输入 backgroundPlans 的精确 objectId。背景计划 ID 与 objectRegistry 的场景对象 ID 是不同身份域，不要求同名；objectStates 中的场景仍选择注册表里 kind=scene 的对象，不把背景计划 ID 当作未登记的场景对象。背景提示词及生成身份由共享资产节点冻结，本节点不重写、不引用尚未生成的底图节点 ID。

逐对象比较 previousBeat 终态、本拍入口/出口和 nextBeat 入口：坐立姿态、持物手、接触关系、设备显示和声线是否仍在延续，都属于要传下去的状态。明确时空省略可以改变状态；连续场景中不能靠切镜把状态重置。上下游没有声明某项变化时，不为本拍气氛自行补写熄屏、换手、起身、复位或重新入场。冻结边界存在冲突时在本节点已有诊断字段记录原始两端，不创作一个过渡后就宣称源冲突消失。

timing.temporalDirectives 使用本 Clip 局部秒数，范围 [0,durationSeconds]；不要累计前面各拍时长。宿主按章节顺序编译绝对时间，不改写窗口语义。只写当前 Clip 的视觉字段，不在 beat 中重写 durationSeconds、sourceSpan、storyEvents 等章节计划字段。最终视频提示词仍由下游逐 Clip writer 完成。

共享资产计划完成后会立即并行执行图片准备，不再等待逐 Clip 设计。资产作者以章节完整来源确定必要资产，并通过 imageSource 区分最终复用与新图生成输入；generate.plan 是真实生成简报，不是备选目录。Clip 作者从冻结注册表选择引用，不新增或改写共享身份；逐 Clip 消费者由执行器在设计完成后绑定到已物化资产。

## 资产身份与枚举

同一资产可被多个对象、多段 Clip 使用：保留每条对象引用，不能为每个 Clip 新建资产，也不能因复用一张图而删除其中一个对象。`objectId` 是故事对象身份，`imageSource` 中的 assetIds/assetId 是冻结目录里的真实媒体句柄；新图片的资产身份、物化任务和幂等键由执行器分配，作者不自行拼接。视觉内容确实不同才登记独立对象/变体，不能按展示名或提示词相似度机械合并。

`kind` 只允许 `character / scene / prop / vfx / palette / composition`。`referenceRole` 只允许 `identity / wardrobe / prop / environment / palette / composition / vfx`。其中 `environment` 表示空间参考用途，`wardrobe` 表示服装参考用途，两者不是对象类型。图片供应商输入的 `layout / style / identity / content` 是另一组枚举，不可混填。

身份引用合同按明确 physicalIdentityKey 核验：复用人物图及 role=identity 的生成输入，已有图的已知身份键须与登记对象一致。不同身份的参考不能伪标 identity；缺失身份事实只记录未核验，不按名称自动合并。结构退回时用精确冻结目录修正当前引用，不重生成已受理媒体。引用资产枚举和身份事实可能位于根级共享 schema 定义中，须按引用读取完整定义，不截短或重写真实 ID。
# 身份边界补充

若多个背景计划共享场景身份，运行时会按冻结 assetId 投影稳定唯一的背景计划 ID，作者必须使用投影后的精确值。
