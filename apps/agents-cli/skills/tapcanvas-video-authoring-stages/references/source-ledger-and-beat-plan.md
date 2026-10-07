# 原文单位与 source-ledger 编排

仅用于当前 schema 声明的 source-unit-ledger/v1 或 chapter-beat-plan/v3。以下完整文本分区是该协议的来源追溯合同，不要求最终影片逐句复述叙述；画面与声音表达由作者决定。

## tapcanvas.source-unit-ledger/v1

本节点在章节分拍前与共享资产提取并行，只识别冻结原文的信息单位、表达类别与归属，不编排时长或画面。schema 的 x-sourcePartition 提供精确 sourceId/sourceFingerprint、sourceLineId、UTF-16 行长及代理对边界；正文在 delivery-contract，输出不重复正文。

按原行顺序提交 sourceLineId、左闭右开的 startOffset/endOffset 与语义字段，宿主恢复精确文本并生成 unitId。每行全部 UTF-16 范围覆盖一次，无间隙、重叠或代理对切开，标题和叙述同样分区。

表达类别由完整上下文判断：spoken 是明确发声，thought 是内心原句，written 是可读文字，narration 是动作、归属提示和其它叙述。引号或最近人名不是分类与归属依据；混合行拆开表达类型，说话提示不能混进要念的台词。spoken/thought 明确 speakerName 与 delivery；thought 声音为 voice_over，on_screen 仅表示画内发声。written/narration 的 delivery 为 null，speakerName 可为明确作者或 null。

提交前回读表达与归属，结构完整不证明语义正确。冻结后下游不能私改说话人、分类或正文，有疑点沿授权来源修订路径处理。

## tapcanvas.chapter-beat-plan/v3

仅适用于独立 source-ledger 输入路径，不把本节“不提交对白字段”用于 chapter-sequence/v4。full_video 从 canonical 原文建立来源账本；first_video 可以显式接 expanded-source 作为非权威参考，不替代冻结来源。

先理解完整来源与用户目标，建立故事时间线再投影技术窗口。sourceUnitRefs:[{unitId}] 是来源归属，不是一单位一事件或一 Clip。长 narration 可沿自然分句跨窗，以 text 内 UTF-16 的 endOffset 结束；startOffset 由宿主从前次结束派生，作者不提交。每个单位按原序完整追溯一次，不丢字、重复或切代理对。无新来源的反应、停顿或过渡可以 sourceUnitRefs=[]，安排依据完整故事。

本节点不提交 dialogueScript、speakerName、对白 text 或独立 speechLedger；宿主从冻结单位与范围投影。storyEvents 和关键帧承载实际声画，必要信息不只写“已理解”；written 不自动成为发声，on_screen 不表示屏幕文字。sourceFidelityAudit.sourceBeatLedger 是摘要，不替代来源账本或新增 schema 字段。

每拍 durationSeconds 取真实 generationContract 选项。dialoguePaceRate 单位为可发声字符/秒，按自然表演考虑，不由既定短时长倒算快读；换话、理解、反应和先后依赖动作也需要容量。超载调整全局分配或合法窗口，不擅删原话，没有固定合格语速或留白比例。

startKeyframe、storyEvents、endKeyframe 是同一过程。事件秒数为拍内局部时间，跨拍核对累加全局时钟；首尾只含当时已发生的事实，未完动作及声音接力，明确时空省略可以改变状态。区分生效结果、附带条件、意愿与推测，摘要不能扩大原文事实。改稿后同步回读邻拍、chapterArc/sourceFidelityAudit 和引用。

只交当前章级字段，不写 objectRegistry/assetPlans/objectStates/blockingPlans、镜头构图或最终提示词。共享资产由后续节点登记，具体设计交 Clip 作者。发现问题同链修订，不把语义观察升级为 runtime 门禁。
