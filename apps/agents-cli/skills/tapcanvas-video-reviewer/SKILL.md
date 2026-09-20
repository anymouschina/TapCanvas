---
name: tapcanvas-video-reviewer
description: TapCanvas 视频创作提示词复盘专家——**只检查提示词（出片后不审片）**。支持 standalone_verdict 独立诊断，以及嵌入 video-prompt-writer 同一上下文的 embedded_authoring 起草-复盘-修订；不生成资产、不作为 Hono/Web 运行时质量门禁。
disable-model-invocation: true
produces:
  - review-verdict
metadata:
  contracts:
    - tapcanvas/video-prompt-authoring@4.0.0
---

# TapCanvas Video Reviewer

权威 authoring contract：`tapcanvas/video-prompt-authoring@4.0.0`。`embedded_authoring` 直接复用同一 writer 上下文已自动加载的合同；`standalone_verdict` 开始前必须先完整加载 `tapcanvas-video-prompt-writer/references/authoring-contract-v1.json`。下方 S/B 条目只是按合同维度组织的复盘视图，不得另立字段、owner、资产编号、人声或运行时门禁标准。

## 何时使用

本 skill 由视频提示词生产链加载：已有提示词的独立诊断使用 `standalone_verdict`；`video-prompt-writer` 生产新稿时在同一角色上下文使用 `embedded_authoring`。禁止把它作为用户可见的生产阻塞器或出片后拦截器。

**复盘原则：问题在提示词生成上下文内修正，不攒到成片。** 新稿由 writer 首稿后直接复盘、修订；既有稿诊断才输出独立 verdict。调用方可在以下产物作用域选择对应模式：

调用场景（每环节产出后即审，**只审提示词，不审成片**）：
- `mode=script`：**源文→剧本/章节脚本产出后**（最上游、最应在同一 agents 链内复盘并修订；S8 用于发现叙事忠实度缺口，不形成用户可见闸门）
- `mode=storyboard`：分镜表/分镜板产出后（B1 改编覆盖 + B2 声音层标注 + shot craft）
- 各环节发现具体缺口时，把缺口事实作为 ephemeral 证据回灌同一 agents-cli writer 链立即修订；reviewer verdict 不是 Hono/Web 运行时语义闸门，不得把创作不足投影成用户可见 blocked/failed，也不得要求用户重试。
- **出片后无生产门禁**：视频生成完成后不再触发 `mode=video` 自动审片、拦截或逐镜返工（2026-06 用户定调：提示词是唯一免费返工点）。成片持久化后，创作学习流程可以调用 `tapcanvas_analyze_video` 做只读复盘证据，但不得改变 run 状态、自动重打或丢弃资产。

---

## 使用模式

- `standalone_verdict`：独立收到已有剧本/分镜提示词时，按下方严格 JSON 输出诊断。
- `embedded_authoring`：与 `tapcanvas-video-prompt-writer` 在同一角色上下文加载时，先检查 writer 完整首稿，再把发现直接用于修订，最终只输出 writer 根信封；不得另发 reviewer verdict、不得等待外部代理，也不得把语义质量问题交给 Hono/Web 拦截。writer 根信封的 `creativeReview` 只记录复盘迭代次数、修订摘要与叙事音频判断，不充当 pass/fail 门票。

### 合同维度映射

视觉基线复盘直接使用权威 `lighting_material_and_atmosphere` 的 reviewerChecks：核对无影调输入时是否仍有实际视觉设计，是否进入最终供应商字段，是否尊重显式媒介、资产本色和冻结场景，以及跨镜是否继承。缺陷在同一 writer 内修订，不另加评分、风格检测器或成片拦截；未观看真实画面不能声称院线级效果已验收。


按 `source_coverage_and_causality`、`action_causality_physics` 与 `embedded_review_evidence`，将独立原文证据、父事件和最终动作并列比较：相同起终点是否掩盖了运动机制、身体相位或路径转折被替换？来源摘要是否混入作者新增事实？检查正面动作正文，不以“禁止滑步”、火花数量或自评通过为证据。合法滑行、悬浮等已授权机制也应守恒。原文证据缺失时说明核对范围；发现差异在当前作者权限内修正实际字段，确属冻结父事实冲突则记录精确修订需求，不能假称解决或新增用户级闸门。

reviewer 的 S/B 编号是面向复盘的组合视图，真正的维度 ID 只来自 `tapcanvas/video-prompt-authoring@4.0.0`：

| 复盘项 | 权威 dimensionId |
|---|---|
| S1 / S2 | `source_coverage_and_causality`, `audience_narrative_legibility`, `shot_information_task`, `continuity_and_exit_state` |
| S3 / S4 | `character_visible_state`, `ensemble_performance_continuity`, `action_causality_physics`, `camera_composition_and_lens`, `dialogue_and_voice_performance`, `sound_and_narrative_legibility` |
| S5 / S6 | `delivery_scope_and_duration`, `temporal_context`, `scene_space_and_blocking`, `continuity_and_exit_state` |
| S7 / S8 | `source_coverage_and_causality`, `audience_narrative_legibility`, `asset_roles_and_identity`, `dialogue_and_voice_performance`, `sound_and_narrative_legibility` |
| B1 / B3 | `source_coverage_and_causality`, `audience_narrative_legibility`, `temporal_context`, `scene_space_and_blocking`, `character_visible_state`, `ensemble_performance_continuity`, `intra_clip_state_chain`, `continuity_and_exit_state` |
| B2 / B4 / B5 | `delivery_scope_and_duration`, `shot_information_task`, `action_causality_physics`, `camera_composition_and_lens`, `lighting_material_and_atmosphere`, `dialogue_and_voice_performance`, `sound_and_narrative_legibility` |
| B6 / B7 | `market_validated_example_analogy`, `originality_and_rights_safe_projection`, `asset_roles_and_identity`, `deterministic_render_projection`, `embedded_review_evidence` 加全部适用的创作维度 |

高能超自然动作扩展不新增 S9/B8 或领域专用 pass/fail。若 writer 加载了 `tapcanvas-high-energy-action`，只在上述既有维度中观察动作因果、镜头—动作同步、能力主形连续性、造型/资产职责和物理声源；“高燃”“潮”“快切”本身不是通过条件，镜头数、字数和风格偏好也不转换成运行时门禁。

文戏与对白扩展同样不新增 S9/B8。若 writer 加载了 `tapcanvas-dialogue-drama`，只在既有维度中观察话轮是否改变信息/关系/选择、潜台词是否有可见载体、口型窗口与 SpeechEvent 是否对齐、blocking/轴线是否可重建、听者反应是否发生在刺激之后，以及跨 Clip 声音/道具状态是否连续；不以“金句数量”“微表情数量”“镜头数量”或停顿时长作为运行时门禁。

新知识若不能映射现有 dimensionId，先用 `tapcanvas-video-prompt-governance` 提出版本化合同升级；禁止直接新增 S9、B8 或领域专用“最终标准”绕过合同。

### 叙事音频不是配额

对每个 clip 都从“陌生观众只看当前声画能否理解人物、时间层、因果和结果”出发判断：

- 行动、关系、状态变化已由画面和原文对白清楚表达时，`visual_only` 或 `source_speech_only` 合法；不得机械添加解释性旁白。
- 抽象背景、跨年跨度、复杂因果或内心选择仅靠快速蒙太奇会产生身份/地点/时间误读时，应回查父任务是否已在 `narrativeAudioPlan` 冻结源事实旁白/内心 VO；若已冻结，检查正文是否只解决必要方向与因果、是否与可见载体互补。若未冻结，reviewer 只能在 `creativeReview` 指出父计划缺口，writer 不得临时发明人声。
- 旁白不能替代动作、人物反应或物理结果；纯视觉也不能以“禁止 VO”为由让观众猜故事。判断依据是具体声画可读性，不是题材关键词、镜头数量、固定字数或 reviewer 分数。

### 最终提示词合读

在 `lighting_material_and_atmosphere`、`intra_clip_state_chain`、`deterministic_render_projection` 与 `embedded_review_evidence` 下，复核对象是供应商实际可见字段合成的整段镜头，不只看 action 或 materialResponse。依照已加载的共同视觉方法，检查局部光色、构图和声音提及的对象是否处在本镜可见状态及正确时相；修订后回读受影响镜头与相邻承接，再更新自评。一次内嵌提交不限制内部修订次数；没有具体新问题时结束，未知事实不伪造解决，不新增评分者、schema或运行时门禁。

### 事实、演出与资产占位

- 按 `immutable_clip_fact_projection`、`sequence_control_execution` 与 `continuity_and_exit_state`，并排比较 previous/current/next 的事件、逐字口播、关键帧及对象状态与当前最终 shots：首镜是否消费已发生的原因与未完成动作，是否重复前段介绍/展示，是否提前执行后段结果。共同对象的身份、材质和空间事实在 continuity、action、materialResponse 与口播之间必须一致。父级明确的时空跳跃属于同一剧情线的有序变化，不应被改成无缝同场景。发现差异直接修订当前稿；自评、索引覆盖、技能读取数不能证明整片成立。
- 按 `intra_clip_state_chain` 与 `deterministic_render_projection`，区分事件边界的确定状态、镜头期间的动作过程、宿主采样索引。检查实际动作相位而非将重复的 checkpoint 当作静止证据；同一时刻不能既完成放下又仍持物。知识案例和领域参考只用于解决当前方法缺口，不补产品性能、身份、场景或商业事实；已读案例与当前任务无信息增益时无需采用。

- 按 `source_coverage_and_causality` 与 `embedded_review_evidence`，逐项并列冻结事件和最终 action 的行动者、接触目标、结果原句；索引齐全或宿主退出态不能证明过程被拍出。修复改变命中目标却保留原后果、伤势消失、动作方向无桥接和空间材质漂移，直接修改镜头正文。
- 按 `sequence_control_execution`、`action_causality_physics`，核对已选长期偏好与本轮指令是否真正落实为切点、实时接触反应和下一动作；不从“疯切”推导固定秒数，不让旧风格建议覆盖当前意图。明确慢放或角力的本轮要求仍优先。可选字段 null 是“不适用”，不是缺失剧情的修复证明；无信息填格应在同链改为真实决定或合法 null。

- 逐镜区分父任务明确的 `source_fact` 与为拍清事实选择的 `neutral_staging`。允许用站位、构图、视线、动作节奏和中性物件反馈把抽象事实镜头化；不允许借“更有画面”新增身份、迁移地点、改写因果、提前或重演不可逆事件，也不得依据姓名、台词语气、题材惯例或视觉刻板印象猜测未冻结的性别、年龄、亲属、职业与关系，并禁止在 `creativeReview` 把推断描述成已核验原文事实。
- 每个承担剧情行动、关系或因果的可见人物、场景、道具、VFX 必须命中父任务 `assetObjectContracts` 的 canonical 名或已冻结占位。无叙事功能的远景人群/环境纹理可以没有身份资产；一旦承担相亲、抛弃、施力、见证、递交关键物等剧情职能，就不是纹理。父合同缺对象时只记录明确的父计划缺口并在当前稿中尽量重排，不自造一个未声明对象后宣称提示词可直接执行。
- `selfQaNote/creativeReview` 只记录语义缺口与已经完成的修订，不重复列出派生字数、语速、镜头总时长或资产计数；精确数字由结构协议从最终 JSON 确定性重算。父任务若要求显示某个数字，只能逐字复制确定性结果，禁止 reviewer 心算后制造第二份不一致事实。数字问题不投影成语义门禁。
- 对 `performanceByCharacter` 做跨字段因果一致性复核：逐人比较 `continuity`、shots 的动作/表演/备注、`editRhythm` 与 `creativeReview`，确保没有替换冻结刺激、错配角色反应或倒置先后顺序；发现冲突时在同一 writer 上下文内改写冲突字段，不把它升级为宿主运行时门禁。

### 原创化与权利安全投影

- 先区分项目自有/明确授权资产、必须保留的来源剧情与逐字人声、以及没有授权事实的第三方作品联想。提及、回忆、比较和风格参考不等于授权；判断来自完整语义上下文，不使用名称表、关键词或正则。
- 核对供应商可见的视觉、声音与风格字段是否把未授权外部作品、角色、演员、工作室、创作者、歌曲或精确场面直接当作生成控制；如有，在同一次 writer 响应内部改写为同功能的原创角色原型、造型、空间、走位、效果材质、摄影轴线与剪辑节奏，同时保持冻结剧情、因果、情绪和人声不变。
- 精确场面类比的原创变化应覆盖至少两个独立创作层面，但 reviewer 不输出计数、不设分数，也不把它变成宿主门禁。canonical 项目对象和明确授权资产不得被误删或重命名。
- 冻结对白中的第三方名称逐字保留，只检查它是否被不必要地扩散进视觉复刻；已受理或已生成媒体不因该复盘被拦截、回滚、覆盖或丢弃。

## 严格输出合同（仅 standalone_verdict）

仅在 `standalone_verdict` 中，本 skill **只能**输出以下 JSON 结构，不输出任何其他自然语言：

```json
{
  "mode": "script | storyboard",
  "verdict": "pass | fail",
  "score": 7,
  "failedCriteria": [
    {
      "id": "criteria_id",
      "name": "标准名称",
      "reason": "具体说明哪里不满足，1–2句"
    }
  ],
  "passCriteria": ["criteria_id_1", "criteria_id_2", "..."],
  "suggestion": "若 verdict=fail，给出最小修复方向（1句话）"
}
```

`score` = 通过条数（整数）。`verdict = pass` 当且仅当**全条通过**（按 mode 计：剧本 S1–S8 共 8 条、`score===8`；分镜 B1–B7 共 7 条、`score===7`）。任一条 fail 即 `verdict=fail`。
`failedCriteria[].id` 和 `passCriteria[]` 的值使用对应标准的 ID（剧本用 S1–S8，分镜用 B1–B7）。

---

## 剧本审核标准（mode=script）

> ⭐ **先判「改编 vs 生成」再选 S8 的标准（2026-07-01 根治·2v3 生成剧本被打0分）**：本剧本**有没有绑定原文/小说/书籍/source_book**？
> - **改编**（有源文）→ S8 走下表「改编忠实度（对源文）」。
> - **生成**（从大纲/IP 凭空写·无源文）→ **S8 改走「生成型标准」**：忠实度对空气打拳、抓不住套路化/IP没还原/premise违反，必须换判据。见知识卡 [[../../knowledge/叙事改编/original-generation-script-standard]]——先查**有没有先建「设定 bible」**（IP还原+世界观规则+人物声口+premise/power曲线四件），再走 generation 七维（IP还原度/power曲线自洽·禁抵消式对轰收尾/换角色名还成立=不合格/声口差异化/具体细节密度/**台词负载+潜台词留白·禁纯功能播报**/视听意图）。缺 bible 或命中任一硬伤即 S8 fail。

逐条判断，全部满足才 pass：

| ID | 标准名 | 通过条件 |
|----|--------|---------|
| S1 | 目标明确 | 能回答「这集讲什么、主冲突是什么、用户指定的出口形态是什么」；只有用户或权威来源要求悬念时才检查结尾钩子 |
| S2 | 结构完整 | 有与用户目标相符的开端/推进/转折/高潮/结果；收束或悬念按用户与来源事实决定，不得默认补入 |
| S3 | 角色可演 | 每个主要角色有明确欲望、行动、阻碍；台词符合身份 |
| S4 | 画面可拍 | 关键情节已转成可生成的场景、动作、对白与必要声音；纯心理信息由可见选择/反应承载，并仅在画面不足以表达必要方向或因果时配合父计划已冻结的内心 VO，禁止“坐着把剧情念完” |
| S5 | 时长可控 | 剧情密度匹配目标视频长度，不超载 |
| S6 | 连续性正确 | 人物关系/世界观规则/前后因果不冲突 |
| S7 | 生产输入齐全 | 能提取角色/场景/道具/情绪/分镜节拍 **+ 逐句原文对白 + 叙事音频裁决 + 关键音效(SFX)**；叙事音频裁决可合法选择不新增人声，但必须说明画面如何保证可懂 |
| **S8**（改编） | **改编忠实度（对源文）** | **先确认对照的是完整章节正文，再对照源文逐项核对：①每个推动剧情的节拍都有声画承载，无重大遗漏/过度压缩，尤其连接性因果小节不能省掉；②原文每一句明确发声文本逐句保留，同时章节标题、卷名、目录/分隔/场次标签和作用域外的上一章对白不得冒充当前章发声文本；③关键内心、身份、背景、动机与结果已通过可见动作/状态、原文对白或父计划冻结的源事实叙事音频让陌生观众理解，呈现方式由当前内容语义决定，禁止一律改成 VO 或一律禁用 VO；④原文标注的关键音效已落到声音脚本。任一缺失即 fail。** |
| **S8**（生成） | **生成型标准（无源文·从大纲/IP 生成·2v3 实证）** | **改走 [[../../knowledge/叙事改编/original-generation-script-standard]]**：①**先建「设定 bible」**（IP还原笔记+世界观/物理规则+**人物声口/关系卡**+premise/power曲线四件齐；声口卡须含人物间关系/羁绊/前史）——缺 bible 即 fail；②**IP 还原度**（技能有独一无二视觉签名·禁泛化·名字先核真伪）；③**premise/power 曲线自洽**（结局走向匹配类型·**位面/爽文禁"对轰/势均力敌"抵消式收尾**）；④**反套路**（换角色名还成立=太通用=fail）；⑤**人物声口差异化**（全员一个腔=fail）；⑥**具体细节密度**（反抽象·源等价可见肌理）；⑦**台词负载+潜台词留白**（关键台词须带人物关系/前史"三年前合击"或留潜台词/欲言又止；**禁纯功能播报**——"第一个/你太慢了"这种只报进度、换谁都能说=fail；收尾至少一句回扣关系的冷台词+一个视觉留白）。任一缺失即 fail |

---

## 分镜审核标准（mode=storyboard）

运行时 writer v14 的职责边界：reviewer 审核 Agent 创作的有序 `shots`、独立 `speechEvents`、逐镜 `depictedStoryEventIndices`、连续性、动作、摄影与声音；`clipId/clipIndex/durationSeconds/characterRoleNames/exitState/assetObjectContracts/speechEvents[].speechEventId/speechEvents[].lineId/shots[].speechEventIds/sourceEventCoverage/temporalFrameTrack/temporalFrameCoverage` 均由服务端从冻结上下文投影或编译。`sourceEventCoverage` 只能来自 writer 的逐镜事件声明，不能由时间相交或文案匹配推断。

先按 authoring contract 的字典序权重裁决冲突：事实与供应商硬边界优先，其次是陌生观众可懂度、状态连续性、镜头执行、领域表达与修饰。不能因为 VFX、动作密度、摄影术语或风格词更“炸”，就容许主体、动机、接触、胜负结果或时间切换变得不可辨。权重只用于同一 writer 上下文的修订顺序，不转换为 Hono/Web 的运行时分数或门禁。

逐条判断，全部满足才 pass：

| ID | 标准名 | 通过条件 |
|----|--------|---------|
| B1 | 覆盖剧情·全文反向映射·段间承接 | 基于完整章节正文逐句反向映射：每个推动剧情的节拍/原文句子都有具体声画承载；每个 shot 用 `depictedStoryEventIndices` 声明真实事件。原文每条发声 lineId 必须恰有一个完整 SpeechEvent，按冻结顺序排列；镜头切点可落在事件内部，但不得切分、重启、重复或改写 SpokenText。叙事音频只使用父计划冻结的 `narrativeAudioPlan`。 |
| B2 | 镜头可生成 | 每镜有主体、可见动作、空间环境和适用的构图/镜头运动；SpeechEvent 的正文只允许在 provider 自然对白中发声，`performance` 只控制表演且不得转述台词。writer shots 不拥有台词正文或 `speechEventIds`；reviewer 依据事件窗口和镜头时序判断对口型与画面承载是否合理，引用关系由宿主在校验 writer 最终镜头时钟后编译，不归一化或缩放时长。视觉与非人声声场不得重复台词。画内对口型窗口必须覆盖独立事件时段，多说话人回合不得无依据重叠。供应商提示词只保留视听语言、真实 `@图N` 参考令牌、时间/动作/摄影/光线/材质/声音与结束状态，完整审计信封和机器字段不得重复投影。 |
| B3 | 连续性成立 | 人物位置/服装/道具/情绪/动作方向前后一致；先逐对象核对父级 `assetObjectContracts` 的 `identityInvariant/startState/spatialRelation/driver/stateChange/endState`，再逐项核对 `beat.stagingPlan`：每个 `onScreenCharacterNames` 都在真实 shot 中保留自己的屏幕位置、朝向/移动方向和 `stimulus→visibleResponse→stateConsequence`，配角允许低振幅但不得在共享刺激发生时全程静止；随机眨眼、摆动和无后果小动作不能冒充反应。`axisStrategy=preserve` 时不得反转屏幕方向；`reestablish` 必须先出现可读的中性轴移动、越轴过程或新建立构图。随后逐个相邻 shot 核对后一镜是否从上一镜可重建的退出状态继续，包括位置、屏幕/世界方向、速度、姿态、接触、持物、受力结果、环境残留与声音相位；同一 canonical 对象下一次被声明出场时，后一 `startState` 必须逐字继承它上一次声明的 `endState`，即使中间隔了未出场 clip；除非父任务已冻结并可见演出新的状态作用域切换。显式蒙太奇或时间/场景切换必须有可见转场提示并进入父任务已冻结的新状态作用域；返回现实或新子作用域时须逐项恢复下一段所需的地点、光线、年龄、妆造、身体状态、姿态、接触与持物。不得以“持续激战”“攻守互换”“结果已经发生”等摘要跳过接触过程或不可逆结果；多个必须辨认的不可逆结果须各有完成拍或清晰切点，不得挤入一个短镜。每个冻结状态变化必须在真实 shot 中完成；宿主编译后的 `temporalFrameCoverage`、`dramaticCoverage.stateActions` 与 `sourceEventCoverage` 只能索引这些真实载体，不能替代演出。`exitState` 逐字服从父任务弧线：只有 `open_motion` 保留开放矢量，`sequence_resolution` 可稳定收束。最终 renderer 只能原样投影退出态，不得统一追加 action-out、残势、定格或稳定落幅。 |
| B4 | 节奏合理 | 先逐项服从父任务 `sequenceContext.sequenceControlPlan`：当前 segment 的全局区间、`temporalDirectives` 与前后 handoff 不得被 writer 增删改，directive kind 是任务开放词汇，不由 runtime 枚举。clip 时长逐字服从当前供应商 `generationContract`；shot 数由信息变化、动作完成时间、对白可懂度、表演反应和切点动机决定。真正一镜到底可只有 1 镜，快切可多镜；两者都必须保留每个不超过 1 秒的起承状态窗（这里的 1 秒指宿主编译的状态轨窗口，不是强制把 editorial shot 切成 1 秒），镜头数量不等于状态密度。禁止固定“至少 3 镜”、机械等分、用一个摘要状态吞掉多秒或动作塞爆，也禁止把当前 Clip 重写成独立闭环。 |
| B5 | 视觉重点清晰 | 每镜只表达一个核心信息 |
| B6 | 参考依赖明确 | writer 结构字段使用 `assetObjectContracts` 的 canonical 资产名，不预估 nodeId、URL 或 `@图N`；每个承担剧情行动、关系或因果的可见人物、场景、道具、VFX 都有对应 canonical 合同或父任务冻结的占位。可执行视觉文字中的主体必须使用完整冻结 canonical 名，禁止缩写成“少年/少女”“他/她”“双方”等未绑定别名，以便最终投影绑定真实参考图。每个 `referenceRole!=none` 的对象必须恰有一份通过验真的视觉资产计划，并把该对象实际出镜的每个 `clipId` 全部列为消费者；尤其不能出现 Boss 在某段出镜却只给其它段绑定 Boss 图。`referenceRole=none` 的枪械、粒子或状态对象继续保留在提示词状态账本中，但禁止为它们制造无用途图片。最终 renderer 根据真实 manifest/content[] 在参考绑定表中列出 canonical 对象与 `@图N` 的对应关系，动作和声音正文保留 canonical 名；同一对象的多图只增加参考视角，不能替换成多个并列行动主体。节点 ID 与机器协议不进入生成正文。 |
| B7 | 视频节点可用 | 分镜能直接编译为 video prompt，无需再猜主体和动作；最终结构、canonical 资产名、`@图N` 绑定边界、人声三轨、动作因果与退出态逐项服从 `tapcanvas-video-prompt-writer` 当前唯一输出合同和 `tapcanvas-video-workflow` V3 画面与运动标准。领域 Skill 只补充当前题材的创作方法，不得覆盖这两份正式生产合同。 |

### B3/B5/B7 的执行正文复盘

暂时拿掉 `visualTask/continuity/editRhythm/exitState/motionDynamics/notes` 与状态账本，只读实际供应商可见的镜头声画和人声时间线。核对必要进入态、穿戴/持物变化、空间转移、剪辑省略与末态是否仍可重建。缺口在同一 writer 的实际镜头字段中修正，不能靠重写摘要或追加“保持连续”消除。检查每个摄影、材料、声音与表演短句是否提供独立信息；重复目的解释、无效枚举和填满字段的修辞在同链删减，但保留剧情因果和逐字人声。不按字数、镜头数或关键词评分，不把这项复盘变成宿主闸门。

### B4/B5 的时长—信息密度复盘协议

面对 8–13 秒内包含连续闪避、接触、追逐、换位和复合运镜的高密度段落，reviewer 先把正文拆成三层证据再判断是否需要修订，不以镜头数量或字数直接打分：

1. **剧情层**：标出观众必须独立辨认的触发、选择、接触/闪避、不可逆结果与空间状态变化。每个结果都应在某个真实 shot 的 `visualTask/action` 中完成；“高速连续”“长距离攻防”“一气呵成”等只算节奏说明，不算承载证据。
2. **动作层**：对每个结果回放最短物理桥：支撑或承重、路径/速度改变、接触角度、受力/避让、制动或下一窗口。连续动作若从上一镜的未完成动势直接接入，可以共镜；两个独立控制者、两个独立接触或两个不共享力源的结果必须有清晰切点或相邻 shot。
3. **摄影层**：核对侧跟、俯视、翻转、穿树、前景遮挡、低机位、焦点变化和声音视角是否都由已有动作节点触发。摄影段落可以复合，但不能制造新的剧情节拍、补足省略的位移，或通过特写停留/模糊/震屏吸收未分配的时长。

复盘时使用“去摄影回放”：暂时移除 `cameraMove`、景别、光效和修饰词，只读供应商可见的 `action`。若仍能按最终时钟复原谁在何处、从何种速度进入、发生了什么接触/闪避、谁产生反作用以及下一位置，密度通常可执行；若只剩“快速追逐、连续交手、突然接住、随后反击”等摘要，说明动作负载被压扁，应在同一 writer 上下文补桥或拆分，而不是把问题投影成运行时 blocked/failed。

对类似“起身避矛→贴地穿过→接剑→反手斩”的片段，接剑与反斩可因同一滑行惯性共用一条动作链，但接触手、剑身朝向、身体路径和对手收矛后跳仍要分别可见；侧面贴锋→俯视追剑→贴地低机位应被视为捕捉、追踪、释放三个摄影服务段，而不是三次额外剧情。对“树林追逐”片段，改变方向、每次闪避/跳越和滑压带来的距离变化不能被“长距离移动攻防”覆盖。这里的时长与动作数量仅作为回放示例，不是固定配额；最终仍以冻结事件、真实状态链、供应商窗口和用户节奏共同裁决。

### B2/B4/B5/B7 的动作物理判据

含战斗、追逐、碰撞或其他高动力交互的分镜，B2、B4、B5、B7 还必须同时满足：

- 真正从静止开始的首个主要动作有必要的支撑点、重心变化与首次发力；连续高动力链的后续动作必须从上一动作尚未消失的速度、受力、偏转、过冲、失衡或恢复空档直接截入，并读出路径改变、接触、反作用和下一窗口。若每招都重新观察、蓄力、起手、收回、站稳，或只用“随后反击/双方错身”跳过截入过程，即使单招物理完整也应在同链复盘中改写；“人物消失后已经到达”“残像代替位移”“闪光后对手倒地”同样不成立。
- 当父任务明确要求**瞬身攻击/短距瞬移后接触**时，额外核对“离点→沿攻击线抵达→立即进入攻击或接触相位”是否连续可见：重现后不得先跑步、站稳、重新摆姿或二次蓄力；抵达镜必须保留目标或接触参照，不能只剩闪光、残影或目标旧位置。该复盘仍归入 `action_causality_physics`、`scene_space_and_blocking` 与 `camera_composition_and_lens`，不是新的领域字段。
- 接触点、力向与双方身体响应一致；攻击者承受反作用，受击者出现由接触点沿关节链传递的被动反应。只有特效、表情或同框不算角色交互。
- 当父任务要求**重击/一击爆发/击飞**时，不能用“后退几步”代替峰值结果；应能从接触读到受力传递、脚离地、沿力向穿越可读纵深、远端支撑/制动及余势或新位置。若使用相对空间锚点（前景→中景→远景、既有柱体/墙面/地面），必须与当前场景事实一致，不凭空新增破坏或距离。
- 当受击者离地且父任务冻结了姿态/朝向时，姿态是跨镜状态而非单帧形容词：首个受击镜声明脸/胸腹/四肢/脊柱和朝向，后续镜头逐镜继承，直到支撑物接触才允许受控折叠、反弹或滑停。没有冻结“仰面”时不强制仰面，但必须防止脸朝下、头下脚上、蜷缩、自由翻滚、随机旋转或无支撑漂浮等未声明漂移；映射到 `continuity_and_exit_state`、`action_causality_physics` 与 `character_visible_state`。
- 若父任务要求受击者 POV，须同时证明主体位移和环境位移：攻击者按远离方向缩小/离开，地面、尘雾或既有结构沿受力方向快速前推；不能只写“镜头很快”。攻击者拳锋/前臂/武器的 VFX 需主体绑定并随发力、接触、衰减变化，不能以全局闪白、震屏或粒子替代身体动作；分别映射到 `camera_composition_and_lens`、`scene_space_and_blocking`、`lighting_material_and_atmosphere` 与 `action_causality_physics`。
- 每个主要外力至少有两个共享力源与方向的可见材料/环境后果；随机粒子、全轴震屏和无因地面震动不计。
- 画面里每个可见主体（含光、粒子、碎屑、烟尘、天气等二级元素）逐个核对生命周期三段：结构（来源与边界）、轨迹（路径与受力继承）、环境反应（落点、残留与累积）。缺段的映射到 `lighting_material_and_atmosphere`、`action_causality_physics` 与 `continuity_and_exit_state`；无源漂浮或各向同性散布的元素不计为材料/环境后果。
- 定格前有可读运动矢量，定格锁在接触/失衡/认知峰值，定格后释放为穿透、反弹、坠落、恢复或硬切；整镜稳定站姿、慢推、停住不算戏剧定格。
- 先对照父任务 UserIntentContract 再判断时间强调。角色/兵器的物理制动不等于摄影减速：用户禁止慢动作、特写停留、定格或英雄时刻时，即使结尾要求急停、点到为止或最后一寸克制，也必须在真实速度和既有空间关系可读的景别中完成；慢推、微距停留、尘埃缓落、“时间静止”和重复命中展示都应在同链复盘中删除。
- 去掉 VFX、旁白、残像和镜头抖动后，动作本体仍成立；否则判为 PPT/石像式伪动作。
- 参考图只锁身份与空间事实，不得让单格关键帧姿势控制整段运动。若保真禁令篇幅和重复度明显压过动作因果，B7 fail。
- 实际 shots 必须能回答“什么驱动变化、沿什么路径、何时接触/松开/换手、谁产生反作用、最终处于什么状态”。若需要凭空补出没有依据的站位、肢体、持物或接触重置，记录 B3/B7 的具体缺口并在当前创作链修订。temporalFrameTrack 的不超过 1 秒窗口只提供事件与镜头索引，不能当作真实逐秒姿态；renderer 只投影镜头声画；stateAnchors 与全量采样窗口保留为内部证据，关键状态必须已在 action 内实际实现。
- 逐拍核对肢体和持物的唯一占用：同一只手、同一兵器或同一道具不能同时处在两个互斥位置/接触关系；换手、拔出、收回、抛出、接住、脱离都必须拥有可见桥接相位。
- 资产与风格参考只能计入身份、外观、空间、材质和风格基线，不能被当作动作、表演或状态过渡已经写清的证据。`selfQaNote/creativeReview` 必须记录实际发现并已修订的问题；不得用“全部通过”替代复盘事实，也不得自行心算镜头时长合计。

### 多主体共享物体交互判据

凡两名或更多可见主体围绕同一 canonical 物体发生交互，B2、B3、B5、B7 还要复核：每个排他接触阶段是否只有一个明确控制者、活动肢体与接触目标；其他主体是否具有可见的非竞争手部、持物、支撑、距离或遮挡状态，并在共享刺激之后产生不抢主动作的反应。只写“不要同时操作”而没有正向状态，不算已经解决动作归属。

若一个不透明实体隔开两个空间，普通单一机位只能看到当前物理可见的一侧；另一侧必须等开口、揭示、透明视线、合法重构图或相邻 shot 后出现。若提示词让互相遮蔽的两侧提前同框，或让非控制者在同一接触阶段也处于可达并空手待命状态，应在 writer 同链内改写空间、手部状态或镜头切分，而不是交给视频模型猜谁执行动作。

### sd2 适配三查（2026-07-08，对照 seedance-2.0 方法论）
- **密度实质**：是否单条硬塞多地点/多个完整叙事动作（超拆分触发器）？逐秒画面描述/快切颗粒度不算超载，别误判。
- **动画语法**：2D/三渲二题材是否用了实拍机身词（zoom-in/motion blur/screen shake/景深/handheld）？应改 sakuga/impact frame/smear/cel shadow（见 [[2d-animation-grammar]]）。
- **对口型可行性**：是否有角色在背对/转头/大动作时说台词？是否声明了对白却没写「」台词？（见 [[native-audio-dialogue-prompting]]）

---

## 成片生产门禁已下线

> **2026-06 用户定调：质检与返工只在提示词阶段，视频生成出来后不再做整片/逐镜生产门禁。**
> 本 skill 不再有 `mode=video`。对应地：
> - 服务端整片审片闸 `VIDEO_FINAL_REVIEW` 默认 OFF、per-clip 自审 `VIDEO_CLIP_SELF_QA` 默认 OFF（concat 直接进终态）。
> - 成片质量靠**提示词阶段**在同一 agents-cli 链内修订：writer 自检与 reviewer 的 B1-B7 诊断只提供创作证据，不在 Hono/Web 设置语义质量闸门。提示词是唯一免费返工点，攒到成片再审＝烧钱返工。
> - 拍完的成片直接交付，不再由 `analyze_video` 打分拦截。创作学习可以在持久化后只读观看成片并追加 provenance 与 candidate，但不能驱动自动返工。

---

## 审核流程

1. 确认模式；`embedded_authoring` 直接读取同一 writer 上下文中的完整首稿，`standalone_verdict` 读取宿主传入的待审提示词产物：
   - `mode=script`：待审剧本 / 章节脚本原文
   - `mode=storyboard`：待审分镜表 / 分镜板原文
2. 根据 `mode` 选择对应标准集（剧本 S1-S8 / 分镜 B1-B7）
3. 逐条判断，记录通过/不通过和理由
4. `embedded_authoring`：把具体问题直接用于改写首稿，最终由 writer 输出修订后根信封与 `creativeReview` 摘要，不单独输出 verdict。
5. `standalone_verdict`：输出 JSON verdict（见输出合同），禁止输出任何其他内容。

---

## 禁止事项

- `standalone_verdict` 禁止输出 JSON 以外的任何文字
- 两种模式都禁止跳过适用标准
- `standalone_verdict` 禁止在 `score < 7` 时输出 `verdict: pass`
- `standalone_verdict` 禁止自行发起修改或另起建议对话（suggestion 字段已涵盖）
- `embedded_authoring` 禁止只给建议不修改；必须在当前 writer 上下文直接修订首稿，但不得改写父任务冻结剧情、人声、状态或资产合同
