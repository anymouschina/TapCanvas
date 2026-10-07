# Clip 设计与生产包

按当前 artifact 的动态 schema 使用字段，两种产物的时间职责不同。共同来源、表达与连续性见 [SKILL.md](../SKILL.md)。

## tapcanvas.clip-production-packet/v2

上游冻结 Clip 归属、有序事件、完整 speechEvents、场景和相邻边界。只设计本段声画，不另写剧情或改冻结声音。

videoPrompt 为 {scene, shots}。scene 写必要稳定场景及开场空间关系；shots 数组顺序是镜头顺序，每镜写 action/camera/sound 与当前 schema 的 storyEventIds/speechEventIds。action 是可见过程，camera 是取景和运动，sound 写本轮作者的声音设计，可含环境声、动作声与配乐；没有声音设计要求时可空，发声内容仍通过 speechEventIds 引用。camera 无新增要求时也可空。没有每镜秒数或发声时钟，镜数与停留按内容和用户意图选择。

storyEventIds 关联实际承载事件，完整保留其剧情联系。speechEventIds 关联发声开始镜头，renderer 物化完整原句一次；长台词可跨后续反应镜头，不重复整句、拆字或在 sound 塞未经声明的对白。旁白、心声与画外音同样按完整事件引用，不要求说话者入镜或张嘴。源事件、声音或边界有缺口时，以现有 clipFacts 记录精确缺项并走已授权作者修订路径，不伪称上游已修好。

回读 renderer 实际输出的声画与完整台词，对照冻结事件和相邻状态；引用编号、覆盖矩阵或诊断不是剧情表达。内部追溯和修订说明留在已声明诊断字段或工作记忆，不写进供应商动作。

### 紧凑引用

assetIntents 每项仅用 registryObjectId 和与冻结对象一致的 imageSource：reuse 写 {mode:"reuse",registryAssetIndex}，索引从该对象 imageSource.assetIds 零起；generate 写 {mode:"generate"}。共享身份、用途、元数据与生图计划由宿主投影，不重抄 assetId/state 或自行新增身份卡。根级 imageModelKey/imageAspectRatio/imageSize 来自冻结真实合同，URL 由媒体阶段验证和绑定。

firstFrameAssetIndex 为本 packet assetIntents 的零起整数或 null，referenceAssetIndices 是索引数组；首帧索引同时包含在引用索引中，不重复 firstFrameAsset/referenceAssets 对象。blockingPlan 与站位图可省略；若提供 backgroundObjectId，使用冻结 backgroundPlans 的精确稳定 objectId，不能用列表序号。

## tapcanvas.clip-design/v2

只细化输入 clipIndex 的全局时间窗，继承冻结剧情、对白、时长及 previousBeat/nextBeat。objectStates 选择共享注册表真实 objectId，记录具体变化与精确参考。visualIntent/narrativeAudioPlan 细化冻结关键帧之间的过程，不重写关键帧、源对白或发声速率；sourceLineId 指向本拍 speechLedger 的原始 lineId，额外独立发声才用 null。

startState/endState 与章节 startKeyframe/endKeyframe 一致。按 schema 设计 blockingPlan，characters 覆盖本拍可见 character，backgroundObjectId 取输入 backgroundPlans 精确身份。背景计划和注册表场景对象是不同身份域；objectStates 的场景仍取 kind=scene，不能把背景 ID 当场景 ID。共享背景计划由上游冻结，本节点不重写或引用尚未生成的底图节点。

timing.temporalDirectives 为 Clip 局部秒数，范围 [0,durationSeconds]，宿主编译全局时间；不在 beat 重写 durationSeconds/sourceSpan/storyEvents 等章级字段。冻结边界冲突保留原两端及具体诊断，在授权修订路径处理，不用虚构过渡掩盖。最终视频提示词交下游 writer。
