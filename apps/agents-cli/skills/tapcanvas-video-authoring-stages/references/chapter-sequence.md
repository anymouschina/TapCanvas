# chapter-sequence/v4：章节故事与 Clip 归属

读取动态 schema、冻结来源、用户范围及实时 generationContract。作者完成完整故事、场景、有序事件与声音及其 Clip 归属；视频模型安排每个 Clip 内的实际演出时间。

## 时间与字段

- clips 按交付顺序声明稳定 clipId 与真实供应商合法的 durationSeconds，只是单次请求总长。根据内容分配事件，不均分镜头或按源文字机械切段。
- scenes 与 beats 按发生顺序。场景写 setting/place、entryState/exitState、cast 及确需布局；beat 写 clipId、performance、picture、visible、来源和真实 enters/exits/moves。performance 取当前 schema 枚举。没有 beat 秒数或内部发声时钟。
- speech 写 speaker、voice、delivery、says 与来源归属；原文引用用真实编号，由宿主物化逐字文本，原创或获准改写写完整台词。memoryVoice 作为场景声音明确所属 clipId。
- 完整发声可跨同一 Clip 多个镜头延续，不逐镜复制或切字。独立供应商 Clip 不自动共享音频，跨段声音由作者安排接续内容。delivery 写表演与画面关系，不换算字速或镜头配额。
- 用户限定总长时使用合法请求组合；没有总长先承载完整剧情再选 Clip 数量。内容超载调整归属或增加合法段，不依赖下游补回删掉的剧情。宿主只累加请求时长，内部切点与发声交视频模型。

## 来源与可理解的声画

区分 narrative 与 brief：叙事提供人物、事件和因果，简报提供目标与边界。adaptation 记录真实来源跨度与取舍，source 引用精确；shows 表达画面承担的事实，conveys 表达声音承担的事实，编号不是观众已获得信息的证明。

完整保留本轮范围内的剧情联系、人物动机、关系、知情变化与结尾。可删不承担剧情的信息，无需逐句保留叙述或一来源一镜。原话引用与未经授权删改的源声音保留完整文字、说话人和顺序；画面中的“解释”“答应”不能代替必要内容。心理、往事与背景可以用画面、对白、心声或旁白表达，必要信息写完整，不让下游临场发明；新增表达标为作者创作。

visible/cast/enters 描述实际可见身份与在场关系，speech.speaker/voice 表达声音来源。被谈论或只发声的角色不因此有肉身入镜；确有可见形象时按来源与作者设计登记。picture 写真实可见过程，planning、来源说明与修订留在 adaptation/authoringRecord 或工作记忆。

## 回读与修订

从实际画面与完整声音理解故事，再对照来源核对观众能否获得后续行为所依赖的原因、关系和信息。关键首尾态与邻段保持一致，已完成不重演，未来结果不提前。发现缺失修订实际事件、声音及受影响 Clip 归属，不只补覆盖说明。authoringRecord 只记真实判断和改稿，不冒充独立审核或工具完成证明。

结构性拒收保留候选与具体证据，在同一逻辑任务修复；语义自审不成为 Hono/Web 门禁，保留已受理媒体与真实资产。
