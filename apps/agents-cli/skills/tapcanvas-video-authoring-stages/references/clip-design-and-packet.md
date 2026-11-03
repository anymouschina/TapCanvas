# Clip 设计与生产包

按当前 artifact 的动态 schema 使用字段，两种产物的时间职责不同。共同来源、表达与连续性见 [SKILL.md](../SKILL.md)。

## tapcanvas.clip-production-packet/v2

上游冻结 Clip 归属、有序事件、完整 speechEvents、场景和相邻边界。只设计本段声画，不另写剧情或改冻结声音。

读取冻结 `generationContract.clipPreference`，省略默认 `max_duration`（2026-11-02 起）。`single_shot` 的 `videoPrompt.shots` 恰好一项，真正设计成一个连续镜头：用持续取景、运镜和人物调度承载本段全部事件及完整发声，不把反打、回忆切入或蒙太奇伪装成同一项 action；无法连续完成的内容由章级授权修订调整 Clip 归属，不在本段偷偷删事件。`max_duration` 可按内容设计多镜，时长沿用冻结窗口，不由 Clip 作者拉长或缩短。上限来自真实模型与调用方 step；明确精确总时长或单段时长时，较短合法窗口可能为满足该显式合同而保留，这不改变普通 Clip 优先最长的偏好。

以编译序列中当前 Clip 自己的 startKeyframe/endKeyframe 为执行首尾；场景 entryState/exitState 是整场状态，不能覆盖场中切点。相邻边界用于核对同一物理身份及持续进程；对象回场时按需要查询 stateChain 中最近相关的已计划状态，再结合其后的事件取当前态，不只看紧邻 Clip，也不重演已完成过程。stateChain 是上游计划出口快照，不是对已生成视频的观察。当前必要问答或行为依据在上游缺失时，按已授权路径修订章级来源表达，不能用新动作或泛化对白掩盖。

videoPrompt 为 {scene, shots}。scene 写必要稳定场景及开场空间关系；shots 数组顺序是镜头顺序，每镜写 action/camera/sound 与当前 schema 的 storyEventIds/speechEventIds。action 是可见过程，camera 是取景和运动，sound 写现场环境声与动作音效，可空；本 packet 不写背景音乐或配乐，全章配乐由剪辑统一承担。发声内容通过 speechEventIds 引用。camera 无新增要求时也可空。没有每镜秒数或发声时钟，镜数与停留按内容和用户意图选择。

把冻结事件导演成可执行过程，而非仅换词复述。依据当前人物目标、对方的行为、空间及已知信息选择表演细节，决定观众能从什么距离、角度与遮挡关系读到它；动作、视线、停顿与声音可共同承担同一意思，不要求每句台词附一个新动作。camera 可继承已成立的有效取景，留空不能把本段理解所需的细节交给模型猜；sound 可保持静默，有意义的现场声则与其来源、动作阶段及空间远近对应。依据当前剧情安排揭示、持续与省略，保持章级调性，不给每个 Clip 强加局部起承转合。

实际首镜从本段进入态开始，实际末镜达到本段退出态。需要跨段承接时，把相关动作阶段、方向、持物、观察对象或声音延续写在真实镜头中；前段最后切到了别处就按实际末镜重新设计接点，不引用早先一镜冒充尾帧。不因“转场丰富”添加未经授权的回忆、动作结果或身份变化。没有实片与真实尾帧，只能确认提示词层的设计。

把状态承接与构图承接分开落实。普通剪辑接点在 camera 写清本段开镜的取景范围、观看方向与注意对象，在 action 从冻结切点的动作阶段继续；需要拉开景别时，直接以新的中景或全景开镜，不先复刻上一段特写再缓慢拉开。参考上一段真正的末镜设计可见差异，不只比较两段首镜；未提供末镜构图时保留未知，依据已知章级画面意图设计本镜，不伪称检查过实片。景别变化应体现在人物占比和可见空间上，仅换名称不足以证明变化；同景别反打或有意连续取景仍可成立，不机械轮换特写、中景、全景。保持已成立的轴线、视线和运动方向，不靠越轴或重演动作制造差异。冻结输入若已指定与目标切镜冲突的构图，记录准确冲突并按授权修订上游，不偷偷改首尾态。

若冻结输入声明 transitionIn，保留其真实剪辑职责，在 action/camera/sound 中设计与之相符的内容接点；不把物理淡化或叠化当成已经解决连续性的证据，也不擅自改冻结转场或另加不受支持的音频重叠。当前 schema 未声明该字段时不新增。生成模型的镜头表达与后期剪辑能力分别取真实合同，不声称仅凭文字实现了帧级无缝。

storyEventIds 关联实际承载事件，完整保留其剧情联系。speechEventIds 关联发声开始镜头，renderer 物化完整原句一次；长台词可跨后续反应镜头，不重复整句、拆字或在 sound 塞未经声明的对白。旁白、心声与画外音同样按完整事件引用，不要求说话者入镜或张嘴。源事件、声音或边界有缺口时，以现有 clipFacts 记录精确缺项并走已授权作者修订路径，不伪称上游已修好。

回读 renderer 实际输出的声画与完整台词，对照冻结事件和相邻状态；引用编号、覆盖矩阵或诊断不是剧情表达。内部追溯和修订说明留在已声明诊断字段或工作记忆，不写进供应商动作。

### 紧凑引用

决定 assetIntents 与 referenceAssetIndices 前，结合本段事件、取景、相邻边界及当前合同提供的 objectStates/sceneState，审视真实注册表里适用的场景、人物与道具。需要稳定空间布局、建筑身份或回场关系时，自主选择匹配的 kind=scene 基态或当前状态图片；已有候选不等于已经选中。色卡只提供色调与光影，不能承担场景的空间身份。特写不见环境、转场或当前来源没有适用场景时，可依真实拍摄意图不选场景，不规定场景必选或引用数量。

assetIntents 每项按动态 schema 写 registryObjectId、stateId、referenceFacts 与 referenceUsage。stateId=null 选择基态图片，真实 stateId 选择可用状态图片；二者都不替代本段剧情当前态。clipIds 只是状态候选适用范围，不表示开场已成立。图片来源（复用或生成）由宿主按冻结注册表决定，作者不写；只有基态复用了多张已有图时，schema 才要求 registryAssetIndex 选其中一张（零起）。referenceFacts 由作者显式选择该图在本段适用的 identityInvariant/stateName/stateLook，可写 {} 只用 referenceUsage 表达，不机械继承共享图中不适用的初态；它不修改共享资产源。其它共享元数据与生图计划由宿主投影，不重抄 assetId/state 或自行新增身份卡。根级图片规格来自冻结真实合同，URL 由媒体阶段验证和绑定。

referenceUsage 是会随图交给视频模型的具体用途：哪些外观保持、这张图表现什么状态、在本段何时适用。基态与状态可共同选用，也可只用能表达本段的图，由作者结合完整事件决定；不固定要求两张或一张。发生在段内的损伤、换装或空间破坏不能仅因状态图存在就提前到开场。必要变化写入 scene/shots 的实际过程，并说明状态参考只适用于该变化之后；不能一边绑定后期状态，一边要求模型猜回未受影响的开场。相同对象在多张图中仍是同一身份，图的顺序不替代用途说明。未知外貌不编造，使用已确认的身份不变量与真实引用。

最终把实际选中的 referenceFacts、referenceUsage 与 scene/shots 作为同一份声画指令核对：初态图上的损伤在本段已被修复时，图片只提供仍适用的身份、空间与材质，不能同时要求保留旧损伤；正文也应承接已完成结果。作者自检并修正自己引入的冲突，上游冲突留准确证据并走授权修订路径，不靠“同一 assetId”或“承接前段”的声明代替状态表达。

firstFrameAssetIndex 为本 packet assetIntents 的零起整数或 null，referenceAssetIndices 是索引数组；首帧索引同时包含在引用索引中，不重复 firstFrameAsset/referenceAssets 对象。blockingPlan 与站位图可省略。backgroundObjectId 是 blockingPlan 内部的字段，不是 packet 根级字段，只能写在 blockingPlan 内；若提供，使用冻结 backgroundPlans 的精确稳定 objectId，不能用列表序号；省略 blockingPlan 时不要单独提交 backgroundObjectId。

身份或场景参考图不自动成为开镜构图。只需继承外观、服装、材质或空间身份时，在 referenceUsage 明确这些用途与本段实际景别，不把参考图的拍摄角度、人物占比或旧动作姿态一并锁定。只有图片确实承担本段字面首帧、且符合本轮真实 videoInputMode 合同时才选择 firstFrameAssetIndex；不能仅为保持人物一致而让相邻段共用同一张首帧。模式要求首帧而现有图片不符时，走已授权资产规划/修订路径，不能伪造图片索引、只改 camera 掩盖冲突或静默更换模式。当前 Workflow IR 的 reference_to_video 是图片参考模式，不是续接上一段视频；不从其它链路引入未声明的 continuityMode、视频参考或尾帧抽取流程。

交付前把自己打算实际交给视频的图片逐项对照 assetIntents 和 referenceAssetIndices：写了场景名称、正文空间描述、objectStates 或 backgroundObjectId，都不会自动创建场景图片引用。若有意使用的真实场景漏选，在同一作者链修正选择及用途；若选择不使用，保持正文与该选择一致，不声称已绑定。只有取得节点物化回执后才能核对实际 referenceImageNodeIds 与图中输入边；没有图回执时只报告计划，不伪称连线已保存。自检不提交媒体、不改历史产物，也不要求宿主替作者强绑场景。

### 尾帧续写（一镜到底接上一段）

只有合同里 referenceAssetIndices 允许 -1 时（宿主已判定这条缝两边在同一场景、没有转场）才可以选。选了 -1，本段从上一段成片的最后一帧开始，镜头不断地接着拍：同一空间、同一时刻，人物、站位、手里的东西和运镜都从那一帧往下走。尾帧总是第一张参考图，占一个参考图槽位，本段仍按需要选自己的角色卡、场景卡、道具卡排在后面。

什么时候选：上一段结尾的动作还没做完，本段要在同一个镜头里把它做完（追跑、打斗中的连续动作、跟拍走位、一句话说到一半人还在动）；原文写明一气呵成、没有切换视角。

什么时候不选：本段第一镜是切到另一个机位、反打、另一个人的反应、特写插入；上一段已经停在一个完整的结果上，本段是新的一拍；拿不准时不选。续写段要等上一段出片才能生成，大部分 Clip 不该续写。

选了 -1 时，本段第一镜写成接着演：不要重复上一段已经完成的动作，不要重新交代环境，开头取景与上一段结尾一致，从这里继续运动。

## tapcanvas.clip-design/v2

只细化输入 clipIndex 的全局时间窗，继承冻结剧情、对白、时长及 previousBeat/nextBeat。objectStates 选择共享注册表真实 objectId，记录具体变化与精确参考。visualIntent/narrativeAudioPlan 细化冻结关键帧之间的过程，不重写关键帧、源对白或发声速率；sourceLineId 指向本拍 speechLedger 的原始 lineId，额外独立发声才用 null。

startState/endState 与章节 startKeyframe/endKeyframe 一致。按 schema 设计 blockingPlan，characters 覆盖本拍可见 character，backgroundObjectId 取输入 backgroundPlans 精确身份。背景计划和注册表场景对象是不同身份域；objectStates 的场景仍取 kind=scene，不能把背景 ID 当场景 ID。共享背景计划由上游冻结，本节点不重写或引用尚未生成的底图节点。

timing.temporalDirectives 为 Clip 局部秒数，范围 [0,durationSeconds]，宿主编译全局时间；不在 beat 重写 durationSeconds/sourceSpan/storyEvents 等章级字段。冻结边界冲突保留原两端及具体诊断，在授权修订路径处理，不用虚构过渡掩盖。最终视频提示词交下游 writer。
